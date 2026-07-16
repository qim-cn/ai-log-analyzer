"""
Obsidian 相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class SaveNoteRequest(BaseModel):
    """保存笔记请求"""
    title: str
    save_path: str = ""         # 用户指定保存子目录（如 7500S），空=根目录
    log_summary: str = ""
    log_snippet: str = ""
    analysis: str
    resolved: bool = False


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
    browse_paths: list[str] | None = None
    auto_save: bool | None = None
