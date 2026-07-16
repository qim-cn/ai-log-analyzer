"""
Obsidian 知识库服务

通过 WebDAV 或本地文件系统连接 Obsidian 仓库，自动生成 DEBUG 记录笔记。

模式：
- WebDAV 模式：设置 OBSIDIAN_WEBDAV_URL 后通过 WebDAV 协议访问远程仓库
- 本地模式（默认）：当 WebDAV 未配置时，直接读取本地文件系统上的仓库
"""

import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

import httpx

from app.config.database import get_connection

logger = logging.getLogger(__name__)

# WebDAV 配置
DEFAULT_WEBDAV_URL = os.getenv("OBSIDIAN_WEBDAV_URL", "")
DEFAULT_WEBDAV_USER = os.getenv("OBSIDIAN_WEBDAV_USER", "")
DEFAULT_WEBDAV_PASS = os.getenv("OBSIDIAN_WEBDAV_PASS", "")
DEFAULT_VAULT_PATH = os.getenv("OBSIDIAN_VAULT_PATH", "/服务器维修笔记/AI分析记录/")
DEFAULT_RESOLVED_PATH = os.getenv("OBSIDIAN_RESOLVED_PATH", "/服务器维修笔记/已解决/")

# 本地文件系统配置
LOCAL_VAULT_PATH = os.getenv("OBSIDIAN_LOCAL_PATH", "/vault")


def _get_settings() -> dict:
    """从数据库获取 Obsidian 配置"""
    conn = get_connection()
    rows = conn.execute(
        "SELECT key, value FROM ai_settings WHERE key LIKE 'obsidian_%'"
    ).fetchall()
    config = {row["key"]: row["value"] for row in rows}

    return {
        "webdav_url": config.get("obsidian_webdav_url", DEFAULT_WEBDAV_URL),
        "webdav_user": config.get("obsidian_webdav_user", DEFAULT_WEBDAV_USER),
        "webdav_pass": config.get("obsidian_webdav_pass", DEFAULT_WEBDAV_PASS),
        "vault_path": config.get("obsidian_vault_path", DEFAULT_VAULT_PATH),
        "auto_save": config.get("obsidian_auto_save", "false") == "true",
    }


def _make_webdav_url(base_url: str, path: str) -> str:
    """构建 WebDAV URL"""
    base = base_url.rstrip("/")
    path = path.lstrip("/")
    return f"{base}/{path}"


def _webdav_auth(user: str, password: str) -> httpx.BasicAuth | None:
    """构建 WebDAV 认证"""
    if user:
        return httpx.BasicAuth(user, password)
    return None


async def _webdav_mkdir(url: str, auth: httpx.BasicAuth | None, path: str) -> None:
    """递归创建 WebDAV 目录"""
    parts = [p for p in path.split("/") if p]
    current = url.rstrip("/")

    for part in parts:
        current = f"{current}/{part}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.request("MKCOL", current, auth=auth)
                if resp.status_code not in (200, 201, 405):
                    logger.warning(f"MKCOL {current} failed: {resp.status_code}")
        except Exception as e:
            logger.warning(f"MKCOL {current} error: {e}")


async def _webdav_put(url: str, auth: httpx.BasicAuth | None, content: str) -> bool:
    """上传文件到 WebDAV"""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.put(
                url,
                content=content.encode("utf-8"),
                headers={"Content-Type": "text/markdown; charset=utf-8"},
                auth=auth,
            )
            return resp.status_code in (200, 201, 204)
    except Exception as e:
        logger.error(f"WebDAV PUT failed: {e}")
        return False


async def _webdav_get(url: str, auth: httpx.BasicAuth | None) -> Optional[str]:
    """从 WebDAV 下载文件"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, auth=auth)
            if resp.status_code == 200:
                return resp.text
            return None
    except Exception as e:
        logger.error(f"WebDAV GET failed: {e}")
        return None


async def _webdav_list(url: str, auth: httpx.BasicAuth | None) -> list[dict]:
    """列出 WebDAV 目录内容"""
    try:
        headers = {"Depth": "1"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.request("PROPFIND", url, headers=headers, auth=auth)
            if resp.status_code != 207:
                return []

            items = []
            text = resp.text

            # 解析 XML 响应 - 支持 D: 和 d: 前缀
            href_pattern = re.compile(r"<(?:d:|D:)href>([^<]+)</(?:d:|D:)href>")
            collection_pattern = re.compile(r"<(?:d:|D:)collection\b[^>]*/>")
            response_pattern = re.compile(r"<(?:d:|D:)response>(.*?)</(?:d:|D:)response>", re.DOTALL)

            responses = response_pattern.findall(text)

            for resp_text in responses:
                href_match = href_pattern.search(resp_text)
                if not href_match:
                    continue

                href = href_match.group(1)
                name = unquote(href.rstrip("/").split("/")[-1])

                is_collection = bool(collection_pattern.search(resp_text))

                items.append({
                    "name": name,
                    "href": href,
                    "is_collection": is_collection,
                })

            return items
    except Exception as e:
        logger.error(f"WebDAV LIST failed: {e}")
        return []


def _sanitize_filename(title: str) -> str:
    """生成安全的文件名"""
    safe = re.sub(r'[<>:"/\\|?*]', '', title)
    if len(safe) > 50:
        safe = safe[:50]
    return safe.strip()


def generate_note_content(
    title: str,
    model: str,
    log_summary: str,
    log_snippet: str,
    analysis: str,
    user: str = "admin",
) -> str:
    """生成已解决的笔记内容：机型+标题、关键字段+原因+方法+方案+改善"""
    now = datetime.utcnow().isoformat() + "Z"
    sections = parse_analysis(analysis)

    # 提取日志关键字段（前 10 行非空行）
    key_lines = [l for l in log_snippet.strip().split("\n") if l.strip()][:10]
    key_fields = "\n".join(key_lines) if key_lines else log_snippet[:500]

    content = f"""---
model: {model}
title: {title}
date: {now}
user: {user}
type: resolved
tags:
  - resolved
  - {model}
---

# [{model}] {title}

## 📋 日志关键字段
```log
{key_fields}
```

## 🔍 AI 分析 — 可能原因
{sections.get('cause', '（分析结果解析失败，请查看原始分析）')}

## 🛠️ 排查方法
{sections.get('method', '（待补充）')}

## ✅ 解决方案
{sections.get('solution', '（分析结果解析失败，请查看原始分析）')}

## 📈 后续改善
{sections.get('improvement', '（待补充）')}
"""
    return content


def parse_analysis(analysis: str) -> dict:
    """解析 AI 分析结果为结构化内容"""
    sections = {
        "summary": "",
        "cause": "",
        "method": "",
        "solution": "",
        "conclusion": "",
        "improvement": "",
    }

    lines = analysis.split("\n")
    current_section = None
    current_content = []

    for line in lines:
        lower = line.lower().strip()

        if any(kw in lower for kw in ["日志概要", "日志摘要", "概要"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "summary"
            current_content = []
        elif any(kw in lower for kw in ["故障原因", "原因分析", "根因", "可能原因"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "cause"
            current_content = []
        elif any(kw in lower for kw in ["排查方法", "排查过程", "诊断方法", "方法"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "method"
            current_content = []
        elif any(kw in lower for kw in ["解决方案", "解决方法", "处理方案", "维修建议"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "solution"
            current_content = []
        elif any(kw in lower for kw in ["后续改善", "改善建议", "预防措施", "改进", "后续"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "improvement"
            current_content = []
        elif any(kw in lower for kw in ["总结", "结论"]):
            if current_section and current_content:
                sections[current_section] = "\n".join(current_content)
            current_section = "conclusion"
            current_content = []
        elif current_section:
            current_content.append(line)

    if current_section and current_content:
        sections[current_section] = "\n".join(current_content)

    if not any(sections.values()):
        sections["summary"] = analysis

    return sections


class ObsidianService:
    """Obsidian 知识库服务 - 支持 WebDAV 和本地文件系统双模式"""

    # ============================================================
    # 模式判断
    # ============================================================

    def _is_webdav_configured(self) -> bool:
        """判断是否配置了 WebDAV"""
        config = _get_settings()
        return bool(config["webdav_url"])

    def _get_local_vault_dir(self, resolved: bool = False) -> Path:
        """获取本地仓库目录"""
        config = _get_settings()
        if resolved:
            vault_path = DEFAULT_RESOLVED_PATH.strip("/")
        else:
            vault_path = config.get("vault_path", DEFAULT_VAULT_PATH).strip("/")
        local_base = Path(LOCAL_VAULT_PATH)
        return local_base / vault_path

    def _get_target_path(self, resolved: bool = False) -> str:
        """获取 WebDAV 保存目标路径"""
        config = _get_settings()
        if resolved:
            return DEFAULT_RESOLVED_PATH.strip("/")
        return config.get("vault_path", DEFAULT_VAULT_PATH).strip("/")

    # ============================================================
    # 本地文件系统操作
    # ============================================================

    def _local_get_file_tree(self, path: str = "") -> list[dict]:
        """从本地文件系统获取文件树"""
        vault_dir = self._get_local_vault_dir()
        target_dir = vault_dir / path.strip("/") if path else vault_dir

        if not target_dir.exists() or not target_dir.is_dir():
            logger.warning(f"Local vault directory not found: {target_dir}")
            return []

        return self._local_list_dir(target_dir, vault_dir)

    def _local_list_dir(self, current_dir: Path, vault_base: Path) -> list[dict]:
        """递归列目录"""
        result = []

        try:
            entries = sorted(current_dir.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return []

        for entry in entries:
            # 跳过隐藏文件和特定目录
            if entry.name.startswith("."):
                continue
            if entry.name in (".obsidian", ".trash", ".git"):
                continue

            try:
                rel_path = str(entry.relative_to(vault_base)).replace("\\", "/")
            except ValueError:
                rel_path = entry.name

            if entry.is_dir():
                children = self._local_list_dir(entry, vault_base)
                result.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "folder",
                    "children": children,
                })
            elif entry.suffix.lower() == ".md":
                result.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "file",
                })

        return result

    def _local_get_file_content(self, path: str) -> Optional[str]:
        """从本地文件系统读取文件内容"""
        vault_dir = self._get_local_vault_dir()

        # 处理路径：移除可能的 vault_path 前缀重复
        clean_path = path
        vault_path_str = str(vault_dir).replace("\\", "/")

        # 尝试多种路径组合
        candidates = [
            vault_dir / clean_path,
            vault_dir.parent / clean_path,  # 如果 path 包含 vault 名
        ]

        # 如果 path 是绝对路径（从根开始的），也尝试
        if clean_path.startswith("/"):
            candidates.insert(0, Path(clean_path))

        for file_path in candidates:
            try:
                resolved = file_path.resolve()
                if resolved.exists() and resolved.is_file():
                    return resolved.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError, PermissionError):
                continue

        logger.warning(f"Local file not found: {path}, tried: {[str(c) for c in candidates]}")
        return None

    def _local_list_notes(self) -> list[dict]:
        """从本地文件系统获取笔记列表"""
        vault_dir = self._get_local_vault_dir()

        if not vault_dir.exists():
            return []

        notes = []
        for entry in vault_dir.rglob("*.md"):
            if entry.name == "index.md":
                continue
            # 跳过隐藏目录
            if any(part.startswith(".") for part in entry.parts):
                continue
            if ".obsidian" in entry.parts or ".trash" in entry.parts:
                continue

            name = entry.name
            parts = name.replace(".md", "").split("_", 1)
            date = parts[0] if len(parts) > 0 else ""
            title = parts[1] if len(parts) > 1 else name

            try:
                rel_path = str(entry.relative_to(vault_dir)).replace("\\", "/")
            except ValueError:
                rel_path = name

            notes.append({
                "filename": name,
                "path": rel_path,
                "date": date,
                "title": title,
            })

        notes.sort(key=lambda x: x["date"], reverse=True)
        return notes

    def _local_save_note(
        self,
        title: str,
        save_path: str,
        log_summary: str,
        log_snippet: str,
        analysis: str,
        user: str = "admin",
        resolved: bool = False,
    ) -> dict:
        """保存笔记到本地文件系统"""
        vault_dir = self._get_local_vault_dir(resolved)
        vault_dir.mkdir(parents=True, exist_ok=True)

        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        safe_title = _sanitize_filename(title)
        filename = f"{date_str}_{safe_title}.md"

        content = generate_note_content(
            title=title, model=save_path,
            log_summary=log_summary,
            log_snippet=log_snippet,
            analysis=analysis,
            user=user,
        )

        file_path = vault_dir / filename
        try:
            file_path.write_text(content, encoding="utf-8")
            logger.info(f"Note saved locally: {file_path}")
            return {"success": True, "filename": filename, "message": "笔记保存成功"}
        except Exception as e:
            logger.error(f"Failed to save note locally: {e}")
            return {"success": False, "filename": "", "message": f"保存失败: {e}"}

    def _local_search_notes(self, query: str) -> list[dict]:
        """本地全文搜索笔记"""
        vault_dir = self._get_local_vault_dir()
        results = []

        if not vault_dir.exists():
            return []

        md_files = list(vault_dir.rglob("*.md"))
        for file_path in md_files[:50]:  # 限制搜索数量
            if file_path.name == "index.md":
                continue
            if any(part.startswith(".") for part in file_path.parts):
                continue
            if ".obsidian" in file_path.parts or ".trash" in file_path.parts:
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            title = file_path.stem
            if query.lower() in title.lower() or query.lower() in content.lower():
                snippet = self._extract_snippet(content, query)
                try:
                    rel_path = str(file_path.relative_to(vault_dir)).replace("\\", "/")
                except ValueError:
                    rel_path = file_path.name
                results.append({
                    "filename": file_path.name,
                    "path": rel_path,
                    "title": title,
                    "snippet": snippet,
                })

        return results

    # ============================================================
    # 公共 API
    # ============================================================

    def get_settings(self) -> dict:
        """获取知识库配置"""
        config = _get_settings()
        config["local_vault_path"] = LOCAL_VAULT_PATH
        config["is_local_mode"] = not bool(config["webdav_url"])
        return config

    def update_settings(self, settings: dict) -> None:
        """更新知识库配置"""
        conn = get_connection()
        for key, value in settings.items():
            db_key = f"obsidian_{key}"
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                (db_key, str(value)),
            )
        conn.commit()

    async def save_note(
        self,
        title: str,
        save_path: str = "",
        log_summary: str = "",
        log_snippet: str = "",
        analysis: str = "",
        user: str = "admin",
        resolved: bool = False,
    ) -> dict:
        """保存笔记。resolved=True → 写入本地 /resolved/{save_path}/"""
        if resolved:
            return self._save_resolved_local(title, save_path, log_summary, log_snippet, analysis, user)
        if self._is_webdav_configured():
            return await self._save_note_webdav(title, save_path, log_summary, log_snippet, analysis, user, False)
        else:
            return self._local_save_note(title, save_path, log_summary, log_snippet, analysis, user, False)

    def _save_resolved_local(
        self, title: str, save_path: str, log_summary: str, log_snippet: str,
        analysis: str, user: str = "admin",
    ) -> dict:
        """已解决 → /resolved/{用户指定子目录}/{标题}.md"""
        # 用户手动指定的子路径，空 = 根目录
        clean_path = save_path.strip().strip("/")
        target_dir = Path("/resolved") / _sanitize_filename(clean_path) if clean_path else Path("/resolved")
        target_dir.mkdir(parents=True, exist_ok=True)

        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        safe_title = _sanitize_filename(title)
        filename = f"{date_str}_{safe_title}.md"

        content = generate_note_content(
            title=title, model=clean_path, log_summary=log_summary, log_snippet=log_snippet,
            analysis=analysis, user=user,
        )

        file_path = target_dir / filename
        rel = str(file_path.relative_to(Path("/resolved")))
        try:
            file_path.write_text(content, encoding="utf-8")
            logger.info(f"Resolved note saved: {file_path}")
            return {"success": True, "filename": rel, "message": f"已保存到 已解决/{clean_path}"}
        except Exception as e:
            logger.error(f"Failed to save resolved note: {e}")
            return {"success": False, "filename": "", "message": f"保存失败: {e}"}

    async def _save_note_webdav(
        self,
        title: str,
        save_path: str,
        log_summary: str,
        log_snippet: str,
        analysis: str,
        user: str = "admin",
        resolved: bool = False,
    ) -> dict:
        """通过 WebDAV 保存笔记"""
        config = _get_settings()

        if not config["webdav_url"]:
            return {"success": False, "filename": "", "message": "未配置 WebDAV 地址"}

        auth = _webdav_auth(config["webdav_user"], config["webdav_pass"])
        base_url = config["webdav_url"].rstrip("/")
        vault_path = self._get_target_path(resolved)

        await _webdav_mkdir(base_url, auth, vault_path)

        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        safe_title = _sanitize_filename(title)
        filename = f"{date_str}_{safe_title}.md"

        content = generate_note_content(
            title=title, model=save_path,
            log_summary=log_summary,
            log_snippet=log_snippet,
            analysis=analysis,
            user=user,
        )

        file_url = _make_webdav_url(base_url, f"{vault_path}/{filename}")
        success = await _webdav_put(file_url, auth, content)

        if success:
            await self._update_index(base_url, auth, vault_path, filename, title)
            return {"success": True, "filename": filename, "message": "笔记保存成功"}
        else:
            return {"success": False, "filename": "", "message": "笔记保存失败"}

    async def _update_index(self, base_url, auth, vault_path, filename, title):
        """更新 index.md 索引表"""
        index_url = _make_webdav_url(base_url, f"{vault_path}/index.md")
        date_str = datetime.utcnow().strftime("%Y-%m-%d")

        existing = await _webdav_get(index_url, auth)

        if existing:
            if "| 日期 |" in existing:
                new_row = f"| {date_str} | {title} | [[{filename.replace('.md', '')}]] |"
                lines = existing.rstrip().split("\n")
                lines.append(new_row)
                content = "\n".join(lines) + "\n"
            else:
                content = existing.rstrip() + "\n\n"
                content += "| 日期 | 标题 | 链接 |\n|------|------|------|\n"
                content += f"| {date_str} | {title} | [[{filename.replace('.md', '')}]] |\n"
        else:
            content = f"""---
title: DEBUG 记录索引
updated: {datetime.utcnow().isoformat()}Z
---

# DEBUG 记录索引

| 日期 | 标题 | 链接 |
|------|------|------|
| {date_str} | {title} | [[{filename.replace('.md', '')}]] |
"""

        await _webdav_put(index_url, auth, content)

    async def list_notes(self) -> list[dict]:
        """获取笔记列表（WebDAV 优先，本地回退）"""
        if self._is_webdav_configured():
            return await self._list_notes_webdav()
        else:
            return self._local_list_notes()

    async def _list_notes_webdav(self) -> list[dict]:
        """通过 WebDAV 获取笔记列表"""
        config = _get_settings()

        auth = _webdav_auth(config["webdav_user"], config["webdav_pass"])
        base_url = config["webdav_url"].rstrip("/")
        vault_path = config["vault_path"].strip("/")

        dir_url = _make_webdav_url(base_url, vault_path)
        items = await _webdav_list(dir_url, auth)

        notes = []
        for item in items:
            name = item["name"]
            if item.get("is_collection") or name == "index.md":
                continue
            parts = name.replace(".md", "").split("_", 1)
            date = parts[0] if len(parts) > 0 else ""
            title = parts[1] if len(parts) > 1 else name
            notes.append({"filename": name, "date": date, "title": title})

        notes.sort(key=lambda x: x["date"], reverse=True)
        return notes

    async def get_note_content(self, filename: str) -> Optional[str]:
        """获取笔记内容（WebDAV 优先，本地回退）"""
        if self._is_webdav_configured():
            return await self._get_note_content_webdav(filename)
        else:
            return self._local_get_file_content(filename)

    async def _get_note_content_webdav(self, filename: str) -> Optional[str]:
        """通过 WebDAV 获取笔记内容"""
        config = _get_settings()

        auth = _webdav_auth(config["webdav_user"], config["webdav_pass"])
        base_url = config["webdav_url"].rstrip("/")
        vault_path = config["vault_path"].strip("/")

        file_url = _make_webdav_url(base_url, f"{vault_path}/{filename}")
        return await _webdav_get(file_url, auth)

    async def get_file_tree(self, path: str = "") -> list[dict]:
        """获取文件树结构（WebDAV 优先，本地回退）"""
        if self._is_webdav_configured():
            return await self._get_file_tree_webdav(path)
        else:
            return self._local_get_file_tree(path)

    async def _get_file_tree_webdav(self, path: str = "") -> list[dict]:
        """通过 WebDAV 获取文件树（从 Vault 根目录开始浏览）"""
        config = _get_settings()
        auth = _webdav_auth(config["webdav_user"], config["webdav_pass"])
        base_url = config["webdav_url"].rstrip("/")

        from urllib.parse import urlparse
        p = urlparse(base_url)
        self._webdav_root = f"{p.scheme}://{p.netloc}"
        self._base_path = unquote(p.path.strip("/"))  # e.g. "Obsidian Vault"

        dir_url = f"{self._webdav_root}/{self._base_path}/{path.strip('/')}" if path.strip("/") else base_url
        return await self._list_dir(auth, dir_url)

    async def _list_dir(self, auth, dir_url):
        """列出目录内容 (WebDAV)，href 直接用于递归拼接"""
        items = await _webdav_list(dir_url, auth)
        from urllib.parse import urlparse
        cur = urlparse(dir_url).path.rstrip("/")

        result = []
        for item in items:
            name = item["name"]
            href = item["href"]
            if name.startswith("."): continue
            if unquote(href.rstrip("/")) == unquote(cur): continue

            # 相对路径：去掉 /Obsidian Vault/ 前缀
            raw = unquote(href).lstrip("/")
            bp = self._base_path + "/" if self._base_path else ""
            rel = raw.removeprefix(bp) if bp else raw

            if item.get("is_collection"):
                children = await self._list_dir(auth, f"{self._webdav_root}{href}")
                result.append({"name": name, "path": rel, "type": "folder", "children": children})
            elif name.endswith((".md", ".canvas", ".txt", ".log", ".csv", ".json", ".yaml", ".yml", ".py", ".sh", ".conf")):
                result.append({"name": name, "path": rel, "type": "file"})

        # 排序：目录在前，文件在后
        result.sort(key=lambda x: (0 if x["type"] == "folder" else 1, x["name"].lower()))
        return result

    async def get_file_content(self, path: str) -> Optional[str]:
        """获取指定路径的文件内容（WebDAV 优先，本地回退）"""
        if self._is_webdav_configured():
            return await self._get_file_content_webdav(path)
        else:
            return self._local_get_file_content(path)

    async def _get_file_content_webdav(self, path: str) -> Optional[str]:
        """通过 WebDAV 获取文件内容"""
        config = _get_settings()

        auth = _webdav_auth(config["webdav_user"], config["webdav_pass"])
        base_url = config["webdav_url"].rstrip("/")
        vault_path = config["vault_path"].strip("/")

        # path 已经是相对于 vault_path 的相对路径（来自 tree 接口）
        # 如果传入的是旧版带 Obsidian Vault 前缀的绝对路径，尝试清理
        clean_path = path
        for prefix in ("Obsidian Vault/", vault_path + "/"):
            if clean_path.startswith(prefix):
                clean_path = clean_path[len(prefix):]
        if clean_path.startswith("/"):
            clean_path = clean_path.lstrip("/")

        file_url = _make_webdav_url(base_url, f"{vault_path}/{clean_path}")
        return await _webdav_get(file_url, auth)

    async def search_notes(self, query: str) -> list[dict]:
        """全文搜索笔记（WebDAV 优先，本地回退）"""
        if self._is_webdav_configured():
            return await self._search_notes_webdav(query)
        else:
            return self._local_search_notes(query)

    async def _search_notes_webdav(self, query: str) -> list[dict]:
        """通过 WebDAV 搜索笔记"""
        notes = await self._list_notes_webdav()
        results = []

        for note in notes[:20]:
            content = await self._get_note_content_webdav(note["filename"])
            if not content:
                continue

            if query.lower() in note.get("title", "").lower() or query.lower() in content.lower():
                snippet = self._extract_snippet(content, query)
                results.append({
                    "filename": note["filename"],
                    "path": note["filename"],
                    "title": note.get("title", note["filename"]),
                    "snippet": snippet,
                })

        return results

    def _extract_snippet(self, content: str, query: str, context_chars: int = 100) -> str:
        """提取包含查询词的文本片段"""
        lower_content = content.lower()
        lower_query = query.lower()
        idx = lower_content.find(lower_query)

        if idx == -1:
            return content[:200] + "..." if len(content) > 200 else content

        start = max(0, idx - context_chars)
        end = min(len(content), idx + len(query) + context_chars)

        snippet = ""
        if start > 0:
            snippet += "..."
        snippet += content[start:end]
        if end < len(content):
            snippet += "..."

        return snippet


# 全局实例
obsidian_service = ObsidianService()
