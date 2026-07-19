"""
SQLite 数据库连接管理

- WAL 模式提升并发性能
- 线程局部连接：每个线程独立持有连接，避免多请求共享同一连接导致的 cursor/事务互相污染
"""

import sqlite3
import threading
from pathlib import Path

from app.config.settings import settings

# 线程局部存储：每个线程拥有自己的 sqlite3 连接。
# 注意：async 路由内的同步 sqlite3 调用仍会短时阻塞事件循环，但不再破坏正确性；
# 彻底把同步 DB I/O 卸载到线程池留作后续工作。
_local = threading.local()


def _create_connection() -> sqlite3.Connection:
    """创建一个新的数据库连接并应用 PRAGMA"""
    db_path = Path(settings.database_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row

    # WAL 模式：提升并发读写性能（数据库级持久设置，重复设置无副作用）
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA cache_size=-64000")  # 64MB 缓存

    return conn


def get_connection() -> sqlite3.Connection:
    """获取当前线程的数据库连接（线程局部单例）"""
    conn = getattr(_local, "connection", None)
    if conn is None:
        conn = _create_connection()
        _local.connection = conn
    return conn


def init_database() -> None:
    """初始化数据库表结构"""
    conn = get_connection()
    conn.executescript("""
        -- 用户表
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

        -- 会话表
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            user_id     TEXT,
            title       TEXT NOT NULL DEFAULT '新对话',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

        -- 消息表
        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content     TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, created_at);

        -- 日志文件表
        CREATE TABLE IF NOT EXISTS log_files (
            id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            session_id  TEXT NOT NULL,
            filename    TEXT NOT NULL,
            file_type   TEXT NOT NULL CHECK (file_type IN ('log', 'txt', 'csv')),
            file_size   INTEGER NOT NULL,
            line_count  INTEGER NOT NULL,
            content     TEXT,
            disk_path   TEXT,
            summary     TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_log_files_session_id ON log_files(session_id);

        -- AI 配置表
        CREATE TABLE IF NOT EXISTS ai_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- 用户是否手动设置过配置
        CREATE TABLE IF NOT EXISTS ai_settings_meta (
            key      TEXT PRIMARY KEY,
            user_set INTEGER NOT NULL DEFAULT 0
        );

        -- 错误模式表（知识图谱）
        CREATE TABLE IF NOT EXISTS error_patterns (
            id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            pattern     TEXT NOT NULL UNIQUE,
            description TEXT,
            severity    TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')),
            count       INTEGER NOT NULL DEFAULT 1,
            first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_error_patterns_pattern ON error_patterns(pattern);

        -- 组件关系表（知识图谱）
        CREATE TABLE IF NOT EXISTS component_relations (
            id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            source_component TEXT NOT NULL,
            target_component TEXT NOT NULL,
            relation_type   TEXT NOT NULL CHECK (relation_type IN ('depends_on', 'causes', 'related_to')),
            error_pattern   TEXT,
            count           INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(source_component, target_component, relation_type)
        );

        CREATE INDEX IF NOT EXISTS idx_component_relations_source ON component_relations(source_component);
        CREATE INDEX IF NOT EXISTS idx_component_relations_target ON component_relations(target_component);

        -- 解决方案表
        CREATE TABLE IF NOT EXISTS solutions (
            id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            error_pattern   TEXT NOT NULL,
            solution        TEXT NOT NULL,
            source_log_id   TEXT,
            success_count   INTEGER NOT NULL DEFAULT 0,
            fail_count      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (source_log_id) REFERENCES log_files(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_solutions_error_pattern ON solutions(error_pattern);

        -- 限流器记录表（支持多进程/多容器共享）
        CREATE TABLE IF NOT EXISTS rate_limits (
            id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            client_ip  TEXT NOT NULL,
            timestamp  REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time
            ON rate_limits(client_ip, timestamp);
    """)

    # 迁移：如果 sessions 表没有 user_id 列，添加它
    try:
        conn.execute("SELECT user_id FROM sessions LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
        conn.commit()

    # 迁移：sessions 加机型/SN/状态字段（多台相同失败检测 + 会话筛选用）
    for _col in ("model", "sn", "status"):
        try:
            conn.execute(f"SELECT {_col} FROM sessions LIMIT 1")
        except Exception:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {_col} TEXT")
            conn.commit()
    # status 默认 open；历史已解决会话（标题带前缀）标 resolved
    try:
        conn.execute("UPDATE sessions SET status = 'open' WHERE status IS NULL")
        conn.execute(
            "UPDATE sessions SET status = 'resolved' "
            "WHERE title LIKE '已解决%' AND status = 'open'"
        )
        conn.commit()
    except Exception:
        pass

    # 迁移：anomaly_events 表（多台相同失败检测，按机型+错误模式+时间聚合）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS anomaly_events (
            id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            model       TEXT,
            pattern     TEXT NOT NULL,
            session_id  TEXT,
            seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_anomaly_model_pattern "
        "ON anomaly_events(model, pattern, seen_at)"
    )
    conn.commit()

    # 迁移：repair_templates 表（维修操作模板库，从已解决案例聚合常用动作）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS repair_templates (
            id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            model      TEXT NOT NULL DEFAULT '',
            text       TEXT NOT NULL,
            count      INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_repair_templates_model "
        "ON repair_templates(model, count DESC)"
    )
    conn.commit()

    # 迁移：case_feedback 表（案例反馈，有用/无关，先收集后续优化检索）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS case_feedback (
            id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            filename   TEXT NOT NULL,
            helpful    INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()

    # 同步环境变量到数据库
    # 只更新用户未手动设置过的配置
    env_defaults = [
        ("base_url", settings.ai_base_url),
        ("api_key", settings.ai_api_key),
        ("model", settings.ai_model),
        ("ollama_base_url", settings.ollama_base_url),
    ]

    for key, env_value in env_defaults:
        # 检查是否是用户手动设置的
        row = conn.execute(
            "SELECT user_set FROM ai_settings_meta WHERE key = ?", (key,)
        ).fetchone()

        user_set = row["user_set"] if row else 0

        if not user_set:
            # 用户未手动设置，使用环境变量
            conn.execute(
                "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
                (key, env_value),
            )
        else:
            # 用户手动设置过，只在 key 不存在时插入
            conn.execute(
                "INSERT OR IGNORE INTO ai_settings (key, value) VALUES (?, ?)",
                (key, env_value),
            )

        # 确保 meta 记录存在
        conn.execute(
            "INSERT OR IGNORE INTO ai_settings_meta (key, user_set) VALUES (?, 0)",
            (key,),
        )

    conn.commit()


def mark_user_set(key: str) -> None:
    """标记某个配置为用户手动设置"""
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO ai_settings_meta (key, user_set) VALUES (?, 1)",
        (key,),
    )
    conn.commit()


def reset_user_settings() -> None:
    """重置所有用户设置，恢复为环境变量"""
    conn = get_connection()
    conn.execute("DELETE FROM ai_settings_meta")
    conn.execute("DELETE FROM ai_settings")
    conn.commit()
    # 重新初始化
    init_database()


def close_database() -> None:
    """关闭当前线程的数据库连接。

    线程局部连接下，仅关闭调用线程持有的连接；其它线程的连接随线程退出而回收。
    """
    conn = getattr(_local, "connection", None)
    if conn is not None:
        conn.close()
        _local.connection = None
