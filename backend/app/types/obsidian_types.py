"""
Obsidian 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class SaveNoteRequest(BaseModel):
    """保存笔记请求"""
    title: str
    model: str = ""             # 机型（子目录），如 7500S, 7DPC
    log_summary: str = ""
    log_snippet: str = ""
    analysis: str = ""
    repair_notes: str = ""      # 用户填写的实际维修操作过程
    session_id: str = ""        # 关联的会话ID，保存时自动标记已解决
    resolved: bool = False
    body: str = ""              # 前端组装好的笔记正文（6 段结构）；非空则直接落盘


class CompileDraftRequest(BaseModel):
    """编译案例草稿请求：从整段对话+日志整理成结构化草稿"""
    session_id: str


class ObsidianSettingsResponse(BaseModel):
    """知识库配置响应"""
    webdav_url: str
    webdav_user: str
    webdav_configured: bool
    vault_path: str
    browse_paths: list[str] = []
    resolved_path: str = ""
    auto_save: bool


class UpdateObsidianSettingsRequest(BaseModel):
    """更新知识库配置请求"""
    webdav_url: str | None = None
    webdav_user: str | None = None
    webdav_pass: str | None = None
    vault_path: str | None = None
    browse_paths: list[str] | None = None
    resolved_path: str | None = None
    auto_save: bool | None = None
