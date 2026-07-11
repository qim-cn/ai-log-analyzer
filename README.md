# AI Log Analyzer

AI 驱动的日志分析工具。上传日志文件，用自然语言提问，AI 帮你分析错误、定位根因、生成排查步骤。

<!-- PLACEHOLDER_SCREENSHOT -->

## 功能特性

- 📁 **日志上传**：支持 `.log` / `.txt` / `.csv`，最大 50MB
- 💬 **对话式分析**：像聊天一样问 AI 关于日志的问题
- 🔄 **多轮上下文**：后续提问自动引用之前的日志和分析结果
- ⚡ **流式输出**：打字机效果，实时看到 AI 回复
- 📊 **智能解析**：自动识别日志格式，生成结构化统计
- 🎯 **快捷分析**：一键总结错误、找出根因、生成排查步骤
- 🔧 **模型切换**：运行时切换 AI 模型和 API 地址，无需重启
- 🌙 **暗色主题**：默认暗色，支持切换亮色

## 快速开始

### 1. 克隆项目

```bash
git clone <repo-url>
cd ai-log-analyzer
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写 AI API 配置：

```env
# OpenAI 兼容 API
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-xxx
AI_MODEL=gpt-4o

# 或使用 Ollama 本地模型
# AI_BASE_URL=http://host.docker.internal:11434/v1
# AI_API_KEY=
# AI_MODEL=qwen2.5
```

### 3. 启动服务

```bash
docker compose up -d
```

### 4. 访问

- **前端**：http://localhost:8080
- **后端 API**：http://localhost:8000
- **健康检查**：http://localhost:8000/api/health

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_BASE_URL` | `https://api.openai.com/v1` | AI API 地址（OpenAI 兼容） |
| `AI_API_KEY` | - | AI API Key |
| `AI_MODEL` | `gpt-4o` | 使用的模型名称 |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama 服务地址 |
| `MAX_FILE_SIZE_MB` | `50` | 单文件最大大小（MB） |
| `MAX_CONTEXT_TOKENS` | `8000` | 上下文最大 token 数 |

## API 文档

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sessions` | 创建会话 |
| `GET` | `/api/sessions` | 会话列表 |
| `GET` | `/api/sessions/:id` | 获取单个会话 |
| `DELETE` | `/api/sessions/:id` | 删除会话 |

### 消息

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/messages/:session_id` | 获取历史消息 |

### 日志文件

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/logs/upload?session_id=xxx` | 上传日志文件 |
| `GET` | `/api/logs/:session_id` | 获取日志文件列表 |
| `GET` | `/api/logs/:id/statistics` | 获取日志统计 |
| `DELETE` | `/api/logs/:id` | 删除日志文件 |

### AI 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 发送消息（SSE 流式返回） |

**请求体**：
```json
{
  "session_id": "xxx",
  "content": "这段错误是什么原因？"
}
```

**响应**（SSE 流）：
```
data: {"content": "根据"}
data: {"content": "日志分析"}
data: {"content": "..."}
data: {"done": true}
```

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/settings/ai` | 获取当前 AI 配置 |
| `PUT` | `/api/settings/ai` | 更新 AI 配置（运行时生效） |
| `GET` | `/api/settings/models` | 获取可用模型列表 |

## 项目结构

```
ai-log-analyzer/
├── frontend/                  # React + TypeScript + Tailwind
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   ├── stores/            # Zustand 状态管理
│   │   ├── services/          # API 请求封装
│   │   └── types/             # TypeScript 类型
│   └── Dockerfile
│
├── backend/                   # Python FastAPI
│   ├── app/
│   │   ├── routes/            # API 路由
│   │   ├── services/          # 业务逻辑
│   │   ├── models/            # 数据模型
│   │   ├── repositories/      # 数据访问层
│   │   └── utils/             # 工具函数
│   └── Dockerfile
│
├── docker-compose.yml
├── .env.example
└── README.md
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 后端 | Python 3.11 + FastAPI |
| 数据库 | SQLite（WAL 模式） |
| AI | OpenAI 兼容 API / Ollama |
| 部署 | Docker Compose + Nginx |

## 常见问题

### Q: 如何使用 Ollama 本地模型？

1. 确保 Ollama 已运行：`ollama serve`
2. 修改 `.env`：
   ```env
   AI_BASE_URL=http://host.docker.internal:11434/v1
   AI_API_KEY=
   AI_MODEL=qwen2.5
   ```
3. 重启服务：`docker compose restart backend`

### Q: 如何查看后端日志？

```bash
docker compose logs -f backend
```

### Q: 数据存储在哪里？

Docker volume `app-data` 挂载到 `/data`，包含：
- `/data/app.db` - SQLite 数据库
- `/data/logs/` - 上传的日志文件

### Q: 如何更新部署？

```bash
git pull
docker compose up -d --build
```

## License

MIT
