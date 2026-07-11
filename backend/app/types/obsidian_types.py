"""
Obsidian 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class SaveNoteRequest(BaseModel):
    """保存笔记请求"""
    title: str
    log_summary: str = ""
    log_snippet: str = ""
    analysis: str


class ObsidianSettingsResponse(BaseModel):
    """知识库配置响应"""
    webdav_url: str
    webdav_user: str
    webdav_configured: bool
    vault_path: str
    auto_save: bool


class UpdateObsidianSettingsRequest(BaseModel):
    """更新知识库配置请求"""
    webdav_url: str | None = None
    webdav_user: str | None = None
    webdav_pass: str | None = None
    vault_path: str | None = None
    auto_save: bool | None = None
