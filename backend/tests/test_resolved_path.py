"""
已解决目录配置单元测试

验证 get_resolved_base / search_resolved / repair_template_service.rebuild
会读取配置的 resolved_path，不是硬编码在 /resolved 根目录。
"""

import tempfile
from pathlib import Path

import pytest


class FakeConn:
    """简单的 SQLite-style 记录连接，仅支持测试所需的 execute/commit"""

    def __init__(self):
        self._rows: list[tuple] = []
        self._deleted = False
        self._queries: list[str] = []

    def execute(self, sql: str, params=()):
        self._queries.append(sql)
        if "DELETE" in sql.upper():
            self._deleted = True
        return self

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def commit(self):
        pass


def test_get_resolved_base_reads_config(monkeypatch):
    """get_resolved_base 应使用数据库中的 resolved_path 配置"""
    monkeypatch.setattr(
        "app.services.obsidian_service._get_settings",
        lambda: {"resolved_path": "服务器维修笔记/已解决"},
    )
    from app.services.obsidian_service import get_resolved_base

    base = get_resolved_base()
    assert str(base) == "/resolved/服务器维修笔记/已解决"


def test_get_resolved_base_defaults_to_root(monkeypatch):
    """空配置时默认返回 /resolved"""
    monkeypatch.setattr(
        "app.services.obsidian_service._get_settings",
        lambda: {"resolved_path": ""},
    )
    from app.services.obsidian_service import get_resolved_base

    base = get_resolved_base()
    assert str(base) == "/resolved"


def test_search_resolved_uses_configured_path(monkeypatch):
    """当 resolved_path 配置为子目录时，search_resolved 应搜索该子目录"""
    from app.services.local_analysis_service import search_resolved

    with tempfile.TemporaryDirectory() as tmp:
        sub = Path(tmp) / "sub_dir"
        sub.mkdir()
        (sub / "2024-01-01_内存故障.md").write_text(
            "---\ntitle: 内存故障\n---\nmemory error corrected\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            "app.services.local_analysis_service._resolved_dir", lambda: sub
        )
        results = search_resolved("memory error")
        assert len(results) == 1
        assert results[0]["title"] == "内存故障"
        assert results[0]["filename"] == "2024-01-01_内存故障.md"


def test_rebuild_scans_configured_path(monkeypatch):
    """rebuild 模板库时应扫描配置的 resolved_path 子目录"""
    from app.services.repair_template_service import repair_template_service

    fake = FakeConn()
    monkeypatch.setattr("app.config.database.get_connection", lambda: fake)

    with tempfile.TemporaryDirectory() as tmp:
        sub = Path(tmp) / "cases"
        sub.mkdir()
        (sub / "case.md").write_text(
            "model: DELL-7500\n\n## 维修操作\n- 更换内存\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            "app.services.repair_template_service.get_resolved_base",
            lambda: sub,
        )
        count = repair_template_service.rebuild()
        assert count == 1
        assert fake._deleted
