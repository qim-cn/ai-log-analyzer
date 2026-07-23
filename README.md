# AI Log Analyzer

AI 驱动的日志分析工具。上传日志文件，用自然语言提问，AI 帮你分析错误、定位根因、生成排查步骤。

## 功能特性

- 📁 **日志上传**：支持 `.log` / `.txt` / `.csv`，最大 50MB
- 💬 **对话式分析**：像聊天一样问 AI 关于日志的问题
- 🔄 **多轮上下文**：后续提问自动引用之前的日志和分析结果
- ⚡ **流式输出**：打字机效果，实时看到 AI 回复
- 📊 **智能解析**：自动识别日志格式，生成结构化统计
- 🎯 **快捷分析**：一键总结错误、找出根因、生成排查步骤
- 🕵️ **AI Agent 自主排查**：一键触发固定流水线排查（错误定位 -> 相似案例 -> 同批次模式检测 -> 知识库/维修模板 -> 根因报告），过程实时流式可见；报告自动存入会话，可保存知识库/导出
- 📋 **维修 SOP 自动生成**：输入机型号 + 故障描述，自动搜索知识库生成标准维修作业程序（诊断命令 → 维修流程 → 注意事项），聊天 `/sop` 命令或知识库页一键生成
- 🔧 **模型切换**：运行时切换 AI 模型和 API 地址，无需重启
- 🌙 **暗色主题**：默认暗色，支持切换亮色
- 🧠 **Obsidian 集成**：分析结果自动存入知识库
- 👤 **用户管理**：多用户 + JWT 认证
- 🔗 **Webhook**：自动通知外部系统
- 📋 **规则引擎**：自定义日志分析规则
- 📝 **模板系统**：可复用分析模板
- 📈 **时间线**：日志事件按时间轴查看
- 🔍 **日志对比**：多份日志横向对比
- 📤 **导出**：分析结果导出

## 快速开始

```bash
git clone git@github.com:qim-cn/ai-log-analyzer.git
cd ai-log-analyzer
cp .env.example .env
# 编辑 .env 填写 AI_BASE_URL / AI_API_KEY / AI_MODEL
docker compose up -d
```

访问：
- **前端** → http://localhost:8880
- **后端 API** → http://localhost:8000
- **健康检查** → http://localhost:8000/api/health

## Docker Compose 部署

```bash
cp .env.example .env
# 编辑 .env 填写 AI_BASE_URL / AI_API_KEY / AI_MODEL / JWT_SECRET
docker compose up -d
```

部署说明：

- 默认暴露端口：`8000`（后端）、`8880`（前端）
- 数据库和上传日志持久化到 Docker volume `app-data`
- 已解决案例通过 `docker-compose.yml` 中的 volumes 持久化到宿主机，容器重建后不丢失
- 运行日志：`docker compose logs -f backend`
- 更新重启：`docker compose up -d --build`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_BASE_URL` | `https://api.openai.com/v1` | AI API 地址（OpenAI 兼容） |
| `AI_API_KEY` | - | API Key |
| `AI_MODEL` | `gpt-4o` | 模型名称 |
| `MAX_FILE_SIZE_MB` | `50` | 上传文件大小限制 |
| `MAX_CONTEXT_TOKENS` | `8000` | 上下文 token 上限 |
| `OBSIDIAN_LOCAL_PATH` | `/vault` | Obsidian vault 挂载路径 |
| `RATE_LIMITER_BACKEND` | `sqlite` | 限流器后端 |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana 管理员密码 |

## 项目结构

```
ai-log-analyzer/
├── frontend/                  # React 18 + TypeScript + Tailwind + shadcn/ui
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   ├── stores/            # Zustand 状态管理
│   │   ├── services/          # API 请求封装
│   │   └── types/             # TypeScript 类型
│   └── Dockerfile
├── backend/                   # Python 3.11 + FastAPI
│   ├── app/
│   │   ├── routes/            # API 路由（18个模块）
│   │   ├── services/          # 业务逻辑
│   │   ├── models/            # 数据模型
│   │   ├── repositories/      # 数据访问层
│   │   └── utils/             # 工具函数
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## API 概览

| 模块 | 路由前缀 | 说明 |
|------|----------|------|
| 健康检查 | `GET /api/health` | 服务状态 |
| 用户认证 | `/api/auth` | 登录、注册、密码重置 |
| 用户管理 | `/api/users` | 用户 CRUD |
| 会话管理 | `/api/sessions` | 创建/列表/删除会话 |
| 消息 | `/api/messages` | 历史消息 |
| 日志文件 | `/api/logs` | 上传/统计/聚类/相似度 |
| AI 对话 | `POST /api/chat` | SSE 流式对话 |
| 配置 | `/api/settings` | 运行时 AI 配置切换 |
| 知识库 | `/api/obsidian` | Obsidian 读写 |
| 规则 | `/api/rules` | 分析规则 CRUD |
| 模板 | `/api/templates` | 分析模板 CRUD |
| Webhook | `/api/webhooks` | Webhook CRUD + 测试 |
| 时间线 | `/api/timeline` | 日志事件时间轴 |
| 对比 | `/api/compare` | 多份日志对比 |
| 导出 | `/api/export` | 分析结果导出 |
| 审计 | `/api/audit` | 操作审计日志 |
| CI/CD | `/api/cicd` | CI/CD 集成 |

> 详细 API 文档见 [Wiki](https://github.com/qim-cn/ai-log-analyzer/wiki/API-Reference)

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 后端 | Python 3.11 + FastAPI |
| 数据库 | SQLite（WAL 模式） |
| 向量存储 | ChromaDB |
| AI | OpenAI 兼容 API / Ollama |
| 部署 | Docker Compose + Nginx |

## 常见问题

### Q: 数据存储在哪里？

Docker volume `app-data` 挂载到 `/data`：
- `/data/app.db` — SQLite 数据库
- `/data/logs/` — 上传的日志文件

### Q: 如何连接 Obsidian 知识库？

```yaml
# docker-compose.yml
volumes:
  - /path/to/your/vault:/vault:rw
```

```env
OBSIDIAN_LOCAL_PATH=/vault
```

### Q: 如何查看后端日志？

```bash
docker compose logs -f backend
```

### Q: 如何更新部署？

```bash
git pull origin main
docker compose up -d --build
```

## License

MIT
