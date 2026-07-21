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
from app.services.obsidian_service import get_resolved_base, obsidian_service
from app.types.obsidian_types import (
    CompileDraftRequest,
    ObsidianSettingsResponse,
    SaveNoteRequest,
    UpdateObsidianSettingsRequest,
)
from app.utils.auth import require_session_owner as _require_session_owner

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
    if not body.analysis and not body.body:
        raise ValidationError("分析结果或正文不能为空")

    user = request.state.user
    # 如果前端没传日志，从数据库根据 session_id 补
    log_snippet = body.log_snippet or ""
    log_summary = body.log_summary or ""
    if (not log_snippet or not log_summary) and body.session_id:
        try:
            from app.repositories.log_repository import log_repository
            logs = log_repository.get_by_session(body.session_id)
            if logs:
                if not log_snippet:
                    log_snippet = "\n".join(
                        (l.content or "")[:3000] for l in logs if l.content
                    )[:10000]
                if not log_summary:
                    log_summary = ", ".join(l.filename for l in logs)
        except Exception:
            pass
    result = await obsidian_service.save_note(
        title=body.title,
        save_path=body.model,  # 机型作为子目录
        log_summary=log_summary,
        log_snippet=log_snippet,
        analysis=body.analysis,
        repair_notes=body.repair_notes,
        user=user.username,
        resolved=body.resolved,
        body=body.body,
    )

    if result["success"] and body.session_id:
        # 保存为已解决 -> status=resolved + 标题加一次前缀；未解决 -> status=open，不动标题
        try:
            from app.services.session_service import session_service as _ss2
            if body.resolved:
                _ss2.update_status(body.session_id, "resolved")
                existing = _ss2.get_session(body.session_id)
                if existing and not existing.title.startswith("已解决"):
                    _ss2.update_title(body.session_id, f"已解决 - {body.title}")
                # 增量更新维修操作模板库
                try:
                    from app.services.repair_template_service import repair_template_service
                    repair_template_service.record_from_body(body.model, body.body)
                except Exception:
                    pass
            else:
                _ss2.update_status(body.session_id, "open")
        except Exception:
            pass
        return {"code": 0, "message": result["message"], "data": result}
    else:
        raise ValidationError(result["message"])


@router.post("/compile-draft", response_model=dict)
async def compile_draft(body: CompileDraftRequest, request: Request):
    """从整段对话+日志编译结构化案例草稿（6 段：原始日志/故障原因/AI建议/DEBUG诊断/定位过程/维修操作）"""
    _require_session_owner(body.session_id, request.state.user)
    draft = await obsidian_service.compile_case_draft(body.session_id)
    return {"code": 0, "data": draft}


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
            browse_paths=settings.get("browse_paths", []),
            resolved_path=settings.get("resolved_path", ""),
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
    if body.resolved_path is not None:
        update_data["resolved_path"] = body.resolved_path

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
            browse_paths=settings.get("browse_paths", []),
            resolved_path=settings.get("resolved_path", ""),
            auto_save=settings["auto_save"],
        ),
    }


# ============================================================
# 已解决记录（本地文件系统，不依赖 WebDAV）
# ============================================================

from pathlib import Path


def _resolved_dir() -> Path:
    return get_resolved_base()


@router.get("/resolved/list", response_model=dict)
async def list_resolved():
    """列出已解决的故障记录（支持子目录）"""
    rd = _resolved_dir()
    files = []
    if rd.exists():
        for md in sorted(rd.rglob("*.md"), key=lambda p: p.name, reverse=True):
            if md.name == "index.md" or ".obsidian" in md.parts or ".trash" in md.parts:
                continue
            rel = md.relative_to(rd)
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
    """读取已解决记录的内容"""
    rd = _resolved_dir().resolve()
    try:
        file_path = (rd / filename).resolve()
    except OSError:
        return {"code": 404, "message": "文件不存在", "data": None}
    # 安全校验：解析后必须在 resolved 目录内（防止 ../ 穿越）
    try:
        file_path.relative_to(rd)
    except ValueError:
        return {"code": 404, "message": "文件不存在", "data": None}
    if not file_path.exists() or not file_path.is_file():
        return {"code": 404, "message": "文件不存在", "data": None}
    content = file_path.read_text(encoding="utf-8")
    return {"code": 0, "message": "success", "data": {"filename": filename, "content": content}}


@router.delete("/resolved/file", response_model=dict)
async def delete_resolved_file(filename: str, request: Request):
    """删除已解决记录（仅管理员）"""
    user = request.state.user
    if user.role != UserRole.ADMIN:
        return {"code": 403, "message": "权限不足，仅管理员可操作", "data": None}
    rd = _resolved_dir().resolve()
    try:
        file_path = (rd / filename).resolve()
    except OSError:
        return {"code": 404, "message": "文件不存在", "data": None}
    try:
        file_path.relative_to(rd)
    except ValueError:
        return {"code": 404, "message": "文件不存在", "data": None}
    if not file_path.exists() or not file_path.is_file():
        return {"code": 404, "message": "文件不存在", "data": None}
    try:
        file_path.unlink()
        return {"code": 0, "message": "已删除", "data": None}
    except Exception as e:
        return {"code": 500, "message": f"删除失败: {e}", "data": None}

@router.post("/feedback", response_model=dict)
async def case_feedback(body: dict, request: Request):
    """案例反馈（有用/无关），先收集，后续用于优化检索排序"""
    filename = body.get("filename", "").strip()
    if not filename:
        raise ValidationError("filename 不能为空")
    helpful = 1 if body.get("helpful") else 0
    from app.config.database import get_connection
    conn = get_connection()
    conn.execute(
        "INSERT INTO case_feedback (filename, helpful) VALUES (?, ?)",
        (filename, helpful),
    )
    conn.commit()
    return {"code": 0, "message": "已记录反馈"}
