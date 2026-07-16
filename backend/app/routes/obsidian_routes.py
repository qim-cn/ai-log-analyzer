"""
Obsidian 知识库路由

POST /api/obsidian/save      → 保存分析结果到知识库
GET  /api/obsidian/notes     → 笔记列表
GET  /api/obsidian/notes/:filename → 笔记内容
GET  /api/obsidian/tree      → 文件树结构
GET  /api/obsidian/file      → 获取文件内容
GET  /api/obsidian/search    → 全文搜索
GET  /api/obsidian/settings  → 知识库配置
PUT  /api/obsidian/settings  → 更新配置
"""

from fastapi import APIRouter, Request

from app.middlewares.error_handler import ValidationError
from app.models.user import UserRole
from app.services.obsidian_service import obsidian_service
from app.types.obsidian_types import (
    ObsidianSettingsResponse,
    SaveNoteRequest,
    UpdateObsidianSettingsRequest,
)

router = APIRouter()


@router.post("/save", response_model=dict)
async def save_note(body: SaveNoteRequest, request: Request):
    """
    保存分析结果到 Obsidian 知识库

    请求体：
    {
        "title": "服务器内存报错",
        "log_summary": "...",
        "log_snippet": "...",
        "analysis": "..."
    }
    """
    if not body.title:
        raise ValidationError("标题不能为空")
    if not body.analysis:
        raise ValidationError("分析结果不能为空")

    user = request.state.user
    result = await obsidian_service.save_note(
        title=body.title,
        save_path=body.save_path,
        log_summary=body.log_summary or "",
        log_snippet=body.log_snippet or "",
        analysis=body.analysis,
        user=user.username,
        resolved=body.resolved,
    )

    if result["success"]:
        return {"code": 0, "message": result["message"], "data": result}
    else:
        raise ValidationError(result["message"])


@router.get("/notes", response_model=dict)
async def list_notes():
    """获取笔记列表"""
    notes = await obsidian_service.list_notes()
    return {
        "code": 0,
        "message": "success",
        "data": {"notes": notes},
    }


@router.get("/notes/{filename}", response_model=dict)
async def get_note(filename: str):
    """获取笔记内容"""
    content = await obsidian_service.get_note_content(filename)
    if content is None:
        raise ValidationError("笔记不存在或无法访问")

    return {
        "code": 0,
        "message": "success",
        "data": {"filename": filename, "content": content},
    }


@router.get("/tree", response_model=dict)
async def get_file_tree(path: str = ""):
    """
    获取文件树结构

    Query Params:
        path: 相对于 vault_path 的子路径（可选）
    """
    tree = await obsidian_service.get_file_tree(path)
    return {
        "code": 0,
        "message": "success",
        "data": {"tree": tree},
    }


@router.get("/file", response_model=dict)
async def get_file_content(path: str):
    """
    获取文件内容

    Query Params:
        path: 相对于 vault_path 的文件路径
    """
    if not path:
        raise ValidationError("文件路径不能为空")

    content = await obsidian_service.get_file_content(path)
    if content is None:
        raise ValidationError("文件不存在或无法访问")

    return {
        "code": 0,
        "message": "success",
        "data": {"path": path, "content": content},
    }


@router.get("/search", response_model=dict)
async def search_notes(q: str = ""):
    """
    全文搜索笔记

    Query Params:
        q: 搜索关键词
    """
    if not q:
        raise ValidationError("搜索关键词不能为空")

    results = await obsidian_service.search_notes(q)
    return {
        "code": 0,
        "message": "success",
        "data": {"results": results, "total": len(results)},
    }


@router.get("/browse-paths", response_model=dict)
async def get_browse_paths():
    """获取浏览目录配置（公开，无敏感信息）"""
    config = obsidian_service.get_settings()
    return {"code": 0, "message": "success", "data": {"browse_paths": config.get("browse_paths", [])}}


@router.get("/settings", response_model=dict)
async def get_settings(request: Request):
    """获取知识库配置（需登录）"""
    settings = obsidian_service.get_settings()
    return {
        "code": 0,
        "message": "success",
        "data": ObsidianSettingsResponse(
            webdav_url=settings["webdav_url"],
            webdav_user=settings["webdav_user"],
            webdav_configured=bool(settings["webdav_url"]),
            vault_path=settings["vault_path"],
            auto_save=settings["auto_save"],
        ),
    }


@router.put("/settings", response_model=dict)
async def update_settings(body: UpdateObsidianSettingsRequest, request: Request):
    """更新知识库配置（仅管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        raise ValidationError("权限不足，仅管理员可操作")

    update_data = {}
    if body.webdav_url is not None:
        update_data["webdav_url"] = body.webdav_url
    if body.webdav_user is not None:
        update_data["webdav_user"] = body.webdav_user
    if body.webdav_pass is not None:
        update_data["webdav_pass"] = body.webdav_pass
    if body.vault_path is not None:
        update_data["vault_path"] = body.vault_path
    if body.auto_save is not None:
        update_data["auto_save"] = "true" if body.auto_save else "false"
    if body.browse_paths is not None:
        update_data["browse_paths"] = body.browse_paths

    obsidian_service.update_settings(update_data)

    # 返回更新后的配置
    settings = obsidian_service.get_settings()
    return {
        "code": 0,
        "message": "配置已更新",
        "data": ObsidianSettingsResponse(
            webdav_url=settings["webdav_url"],
            webdav_user=settings["webdav_user"],
            webdav_configured=bool(settings["webdav_url"]),
            vault_path=settings["vault_path"],
            auto_save=settings["auto_save"],
        ),
    }


# ============================================================
# 已解决记录（本地文件系统，不依赖 WebDAV）
# ============================================================

from pathlib import Path

RESOLVED_DIR = Path("/resolved")


@router.get("/resolved/list", response_model=dict)
async def list_resolved():
    """列出已解决的故障记录（支持机型子目录）"""
    files = []
    if RESOLVED_DIR.exists():
        for md in sorted(RESOLVED_DIR.rglob("*.md"), key=lambda p: p.name, reverse=True):
            if md.name == "index.md" or ".obsidian" in md.parts or ".trash" in md.parts:
                continue
            rel = md.relative_to(RESOLVED_DIR)
            stat = md.stat()
            model = str(rel.parent) if str(rel.parent) != "." else ""
            files.append({
                "filename": str(rel),
                "title": md.stem,
                "model": model,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return {"code": 0, "message": "success", "data": files}


@router.get("/resolved/file", response_model=dict)
async def get_resolved_file(filename: str):
    """读取已解决记录的内容（路径相对于 /resolved/）"""
    file_path = (RESOLVED_DIR / filename).resolve()
    if not str(file_path).startswith(str(RESOLVED_DIR.resolve())) or not file_path.exists():
        return {"code": 404, "message": "文件不存在", "data": None}
    content = file_path.read_text(encoding="utf-8")
    return {"code": 0, "message": "success", "data": {"filename": filename, "content": content}}
