# Claude Code 项目规范

> 本文件是 Claude Code 的强制性指令，所有代码生成必须严格遵循。

---

## 一、项目技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Node.js + TypeScript + Express/Koa 或 Python + FastAPI
- **数据库**: PostgreSQL / SQLite
- **包管理**: pnpm（前端）/ pip 或 uv（Python）
- **运行环境**: Node.js >= 20

> 如果实际项目不同，以项目中 `package.json` / `pyproject.toml` / `requirements.txt` 为准。

---

## 二、代码风格（通用）

### 2.1 命名规范

| 类型 | 规则 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `getUserById`, `isActive` |
| 类/接口/类型 | PascalCase | `UserService`, `UserProfile` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `API_BASE_URL` |
| 文件名 | kebab-case（前端）/ snake_case（Python） | `user-profile.tsx`, `user_service.py` |
| CSS 类名 | BEM 或 kebab-case | `card__title--active` |
| 数据库字段 | snake_case | `created_at`, `user_id` |

### 2.2 代码格式

- 缩进：**2 空格**（JS/TS），**4 空格**（Python）
- 分号：**始终使用**（JS/TS）
- 引号：**单引号** `'`（JS/TS），**双引号** `"`（Python）
- 尾逗号：**始终使用**（对象/数组最后一项后加逗号）
- 行宽限制：**100 字符**
- 每个文件**只导出一个主要概念**（一个组件 / 一个类 / 一个函数）

### 2.3 TypeScript 强制规则

- **严格模式**：`tsconfig.json` 中 `"strict": true`
- **禁止** `any`，使用 `unknown` + 类型守卫
- **优先使用** `interface` 定义对象形状，`type` 用于联合/交叉类型
- **所有函数**必须有显式返回类型注解
- **所有 props**必须定义 interface/type

```typescript
// ✅ 正确
interface UserCardProps {
  user: User;
  onSelect: (userId: string) => void;
  isHighlighted?: boolean;
}

const UserCard: React.FC<UserCardProps> = ({ user, onSelect, isHighlighted = false }) => {
  // ...
};

// ❌ 错误
const UserCard = ({ user, onSelect, isHighlighted }) => {
  // ...
};
```

---

## 三、文件结构规范

### 3.1 前端项目结构

```
src/
├── components/         # 可复用组件
│   └── ui/             # 基础 UI 组件（Button, Input, Modal）
│   └── features/       # 业务组件
├── hooks/              # 自定义 Hooks
├── services/           # API 请求封装
├── stores/             # 状态管理（Zustand/Redux）
├── types/              # 全局类型定义
├── utils/              # 工具函数
├── constants/          # 常量
├── pages/              # 页面组件
└── styles/             # 全局样式
```

### 3.2 后端项目结构

```
src/
├── controllers/        # 请求处理层
├── services/           # 业务逻辑层
├── repositories/       # 数据访问层
├── models/             # 数据模型/实体
├── middlewares/        # 中间件
├── routes/             # 路由定义
├── utils/              # 工具函数
├── types/              # 类型定义
└── config/             # 配置文件
```

---

## 四、组件开发规范（React）

### 4.1 组件文件结构

每个组件文件按以下顺序组织：

```
1. Imports（外部库 → 内部模块 → 类型）
2. Props interface/type
3. 常量/工具函数
4. 组件函数
5. 导出
```

### 4.2 Hooks 规则

- **自定义 Hook** 以 `use` 开头：`useUser`, `useDebounce`
- **每个 Hook 一个职责**，不要在一个 Hook 里塞多个不相关的逻辑
- Hook 内部不要产生副作用（除了 `useEffect`）
- **依赖数组必须完整**，不要省略依赖

### 4.3 组件设计原则

- **受控组件优先**：优先使用受控模式，非受控模式仅在必要时使用
- **组合优于继承**：用 `children` 和 render props 组合，不要用继承
- **一个组件一个职责**：如果一个组件超过 200 行，考虑拆分
- **Props 尽量少**：超过 5 个 props 时，考虑用组合模式或拆分组件

---

## 五、状态管理规范

### 5.1 选择原则

| 场景 | 方案 |
|------|------|
| 组件内局部状态 | `useState` / `useReducer` |
| 跨组件共享状态 | Zustand / Context |
| 服务端状态 | TanStack Query (React Query) |
| 表单状态 | React Hook Form / Formik |

### 5.2 状态存放位置

- **能用 props 传递的**，不提升到全局状态
- **能用 URL 参数的**，不存到状态管理器
- **服务端数据**用 React Query，不手动管理缓存

---

## 六、API 请求规范

### 6.1 请求封装

- 所有 API 调用封装在 `services/` 目录
- 使用统一的 HTTP 客户端（axios/fetch 封装）
- 所有请求函数返回**强类型**

```typescript
// services/user.ts
export const getUserById = async (id: string): Promise<User> => {
  const response = await httpClient.get<User>(`/users/${id}`);
  return response.data;
};
```

### 6.2 错误处理

- **统一错误拦截**：在 HTTP 客户端层拦截 401/403/500
- **组件层**：使用 try-catch 或 React Query 的 `onError`
- **不要静默吞掉错误**：至少 `console.error` 一行，更好的做法是上报到错误监控
- **错误信息用户友好化**：给用户看翻译后的提示，不是原始错误堆栈

### 6.3 接口约定

```
POST   /api/resource        → 创建
GET    /api/resource/:id    → 查询单个
GET    /api/resource        → 查询列表（支持分页/筛选）
PUT    /api/resource/:id    → 全量更新
PATCH  /api/resource/:id    → 部分更新
DELETE /api/resource/:id    → 删除
```

响应格式统一：
```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

---

## 七、Git 提交规范

### 7.1 Commit Message 格式

```
<type>(<scope>): <简短描述>

<详细说明（可选）>
```

**Type 类型：**

| Type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改变功能） |
| `style` | 代码格式（不影响逻辑） |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建/工具/依赖 |

```
feat(user): add user profile editing page
fix(auth): prevent duplicate login requests
refactor(api): extract shared error handler
```

### 7.2 分支命名

```
feature/user-profile    # 新功能
fix/login-crash         # Bug 修复
refactor/api-layer      # 重构
hotfix/urgent-auth-fix  # 紧急修复
```

---

## 八、测试规范

### 8.1 测试文件位置

- **就近原则**：测试文件与源文件同目录
- **命名**：`*.test.ts` 或 `*.spec.ts`

```
src/
├── components/
│   └── UserCard.tsx
│   └── UserCard.test.tsx
├── services/
│   └── user.ts
│   └── user.test.ts
```

### 8.2 测试写法

- **单元测试**：工具函数、Hooks、Service 层
- **集成测试**：关键业务流程
- **不要测试实现细节**：测试行为，不测试内部状态
- **一个测试一个断言主题**

```typescript
// ✅ 正确
describe('UserService', () => {
  describe('getUserById', () => {
    it('should return user when valid id is provided', async () => {
      const user = await getUserById('123');
      expect(user).toHaveProperty('id', '123');
    });

    it('should throw NotFoundError when user does not exist', async () => {
      await expect(getUserById('invalid')).rejects.toThrow(NotFoundError);
    });
  });
});
```

---

## 九、安全规范

- **永远不要**在前端代码中硬编码密钥/Token
- **所有用户输入**必须验证和转义（防 XSS / SQL 注入）
- **敏感数据**（密码、Token）不打印到日志
- **API 接口**必须有鉴权中间件（除非是公开接口）
- **使用 httpOnly Cookie** 存储 JWT，不用 localStorage

---

## 十、性能规范

- **列表渲染**：长列表使用虚拟滚动（react-virtualized / react-window）
- **图片**：使用懒加载 + 合适的格式（WebP）+ 尺寸
- **代码分割**：路由级别的懒加载 `React.lazy`
- **API 请求**：使用防抖/节流，避免重复请求
- **Memo 使用**：只在性能瓶颈处使用 `React.memo` / `useMemo`，不滥用

---

## 十一、文档规范

- **README.md**：每个项目必须有，包含项目描述、启动方式、部署方式
- **注释**：
  - **函数**：复杂逻辑必须写注释说明**为什么**，而不是**做了什么**
  - **魔法数字**：用常量替代并命名
  - **TODO**：格式 `// TODO(author): 描述，预期解决时间`
- **类型即文档**：好的类型定义本身就是最好的文档

---

## 十二、Claude Code 行为约束

以下是对 Claude 的强制要求：

1. **每次修改代码前**，先读取相关文件，理解上下文再动手
2. **不引入新的第三方依赖**，除非明确告知并说明理由
3. **不修改 `package.json` 的版本号**，除非被要求
4. **保持向后兼容**：修改现有 API 时，不破坏已有调用方
5. **代码生成后**：如果涉及新文件，简述为什么需要这个文件
6. **遇到不确定的需求**：先澄清，再实现，不猜测
7. **不在生产代码中留 `console.log`**（调试日志需删除或降级为 logger）
8. **提交代码时**：确保 ESLint / TypeScript 编译通过，无类型错误
9. **大改动先拆分**：超过 5 个文件的改动，先说明计划再执行
10. **回复使用中文**，代码注释使用英文

---

## 十三、错误记忆系统（LESSONS.md）

**强制规则：每次生成代码前，必须读取 `LESSONS.md` 文件。**

- 修复 Bug 后，Claude **必须**自动将错误记录追加到 `LESSONS.md` 对应分类
- 记录内容包括：日期、问题描述、错误代码、正确代码、根因、教训
- 用户说"记住这个"时，立即将当前错误写入 `LESSONS.md`
- 生成代码时，主动检查 `LESSONS.md` 中是否有相关历史教训，有则避免重犯
