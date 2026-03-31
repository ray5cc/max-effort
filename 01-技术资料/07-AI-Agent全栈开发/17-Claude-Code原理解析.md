# 17-Claude Code 原理解析 — 技术资料

> 深度剖析 Anthropic Claude Code 的完整内部架构：从启动引导、QueryEngine 核心循环、40+ 工具系统、权限安全、多 Agent 协调，到 IDE Bridge、上下文管理、成本追踪与性能优化，全面揭示一个生产级 AI 编码 Agent 的工程实现细节。

## 相关链接

- 对应面试题：[17-Claude-Code原理解析面试题](../../02-面试指南/07-AI-Agent全栈开发面试/17-Claude-Code原理解析面试题.md)

## TL;DR 核心要点速览

- Claude Code 是 Anthropic 官方 CLI 编码 Agent，约 1,900 个文件、512,000+ 行 TypeScript，运行在 **Bun** 上，终端 UI 基于 **React + Ink**
- **QueryEngine** 是核心大脑，负责 LLM 对话循环、工具调用、重试、Token 计费和权限协调
- **Tool 系统** 采用注册表模式，40+ 工具（Bash/文件/搜索/Web/Agent/MCP/LSP 等）均遵循统一接口，用 **Zod v4** 校验输入
- **权限系统** 提供 5 种模式（default/plan/bypassPermissions/auto/ask），包含 ML 分类器自动审批安全操作
- **多 Agent 架构** 支持 Coordinator 模式，通过 AgentTool 产生子 Agent，TaskManager 管理并行任务，SendMessageTool 实现 Agent 间通信
- **Bridge 系统** 实现与 VS Code / JetBrains 的双向通信，基于 OAuth 2.0 + JWT 认证
- **Feature Flag** 利用 Bun 的编译时特性标记实现死代码消除，大幅缩减二进制体积
- **性能优化** 贯穿始终：并行 I/O 预取、懒加载重型模块、LRU 缓存、Prompt Cache 排序稳定性

---

## 目录

1. [概述与技术栈](#1-概述与技术栈)
2. [启动引导与入口点](#2-启动引导与入口点main-tsx)
3. [QueryEngine 核心引擎](#3-queryengine-核心引擎)
4. [Tool 工具系统](#4-tool-工具系统)
5. [Commands 命令系统](#5-commands-命令系统)
6. [权限系统](#6-权限系统)
7. [多 Agent 架构](#7-多-agent-架构)
8. [Bridge 系统（IDE 集成）](#8-bridge-系统ide-集成)
9. [上下文系统](#9-上下文系统)
10. [成本追踪](#10-成本追踪)
11. [服务层架构](#11-服务层架构)
12. [React + Ink 终端 UI](#12-react--ink-终端-ui)
13. [Feature Flag 与死代码消除](#13-feature-flag-与死代码消除)
14. [会话管理与恢复](#14-会话管理与恢复)
15. [记忆系统](#15-记忆系统)
16. [Thinking Mode 集成](#16-thinking-mode-集成)
17. [性能优化全景](#17-性能优化全景)
18. [错误处理与韧性](#18-错误处理与韧性)
19. [架构总览图](#19-架构总览图)
20. [常见陷阱与最佳实践](#20-常见陷阱与最佳实践)

---

## 1. 概述与技术栈

### 1.1 什么是 Claude Code

Claude Code 是 Anthropic 打造的**生产级 CLI 编码 Agent**。与传统 CLI 工具不同，它能够自主阅读代码、思考方案、编辑文件、执行命令、运行测试并迭代修复——形成完整的"感知—推理—行动"循环。

**类比**：把 Claude Code 想象成一位坐在你终端前的资深全栈工程师——你用自然语言描述需求，他会自行查看项目代码、分析架构、提出方案、实施变更、测试验证，直到任务完成。

### 1.2 技术栈全景

| 层级 | 技术选型 | 选型原因 |
|------|----------|----------|
| **运行时** | Bun | 比 Node.js 快 3-5 倍的启动速度，原生 TypeScript 支持 |
| **语言** | TypeScript (strict mode) | 类型安全，减少运行时错误 |
| **终端 UI** | React + Ink | 声明式组件模型用于 CLI 渲染，复用 React 生态 |
| **CLI 解析** | Commander.js (extra-typings) | 成熟的命令行框架，严格类型推导 |
| **Schema 校验** | Zod v4 | 每个工具输入的运行时校验 |
| **代码搜索** | ripgrep | 极快的文件内容搜索 |
| **API 客户端** | Anthropic SDK | 官方 SDK，支持流式、Tool Use、Thinking |
| **协议** | MCP (Model Context Protocol) + LSP | 外部工具和代码智能集成 |
| **认证** | OAuth 2.0, JWT, macOS Keychain | 多层认证安全 |
| **遥测** | OpenTelemetry + gRPC | 生产级可观测性 |
| **特性开关** | GrowthBook + Bun feature() | A/B 测试与编译期死代码消除 |

### 1.3 代码规模

```
总文件数:     ~1,900
总代码行数:   512,000+
语言:         100% TypeScript
关键文件:
  main.tsx          803KB   入口点 + CLI 解析
  QueryEngine.ts     46KB   LLM 核心引擎
  Tool.ts            29KB   工具类型定义
  commands.ts        25KB   命令注册表
  tools.ts           17KB   工具注册表
  cost-tracker.ts    11KB   成本追踪
  context.ts         6.4KB  上下文注入
```

---

## 2. 启动引导与入口点（main.tsx）

### 2.1 并行预取模式

**类比**：想象你早上出门——你不会先穿鞋再拿钥匙再带手机，而是同时拿好所有东西。Claude Code 的启动也是如此，通过并行 I/O 将多个互不依赖的初始化操作同时执行。

```typescript
// main.tsx 入口 — 三个并行 I/O 操作在重型导入之前就已触发
profileCheckpoint('main_tsx_entry')      // 1. 标记入口时间
startMdmRawRead()                         // 2. 异步读取 MDM（设备管理）配置
startKeychainPrefetch()                   // 3. 异步预取 macOS 钥匙串
//   ├── OAuth token 读取
//   └── Legacy API key 读取
```

**为什么这很重要？** macOS 钥匙串读取每次约 65ms。如果两次读取串行执行，启动延迟就是 ~130ms。通过并行执行，总延迟仅 ~65ms，节省了 50% 的启动时间。

```
串行执行（❌ 慢）:
  ├── MDM 读取 ──────────► 40ms
  ├── OAuth 钥匙串 ────────────────► 65ms
  └── API Key 钥匙串 ─────────────────────► 65ms
  总计: ~170ms

并行执行（✅ 快）:
  ├── MDM 读取 ──────────► 40ms
  ├── OAuth 钥匙串 ────────────────► 65ms
  └── API Key 钥匙串 ────────────────► 65ms（与上面同时）
  总计: ~65ms
```

### 2.2 CLI 解析与子命令

Claude Code 使用 Commander.js 解析命令行参数，支持多种子命令：

```typescript
// Commander.js 注册子命令
program
  .command('commit')   // claude commit
  .command('review')   // claude review
  .option('--tools <tools...>', '指定可用工具')
  .option('--model <model>', '指定模型')
  .option('--verbose', '详细输出')

// 无子命令时进入交互式 REPL 模式
if (!subcommand) {
  await launchRepl()  // 启动 React + Ink 交互界面
}
```

### 2.3 REPL 模式启动

`launchRepl()` 是交互式模式的入口，它创建一个 React + Ink 应用：

```typescript
async function launchRepl() {
  // 1. 初始化配置（工具、命令、MCP 客户端等）
  const config = await buildConfig()
  
  // 2. 创建 QueryEngine 实例
  const engine = new QueryEngine(config)
  
  // 3. 用 Ink 渲染终端 UI
  render(<ReplScreen engine={engine} />)
}
```

---

## 3. QueryEngine 核心引擎

### 3.1 职责概述

**类比**：QueryEngine 就像一个**交响乐指挥**——它不亲自演奏任何乐器（工具），但它决定什么时候谁来演奏、演奏什么、遇到问题如何调整。

QueryEngine 是 Claude Code 的核心大脑，一个 QueryEngine 实例管理一个完整的对话生命周期：

```typescript
export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]           // 可变消息存储
  private abortController: AbortController     // 中断控制
  private permissionDenials: SDKPermissionDenial[]  // 权限拒绝记录
  private totalUsage: NonNullableUsage         // 总 Token 用量
  private discoveredSkillNames = new Set<string>()   // 已发现的技能
  private loadedNestedMemoryPaths = new Set<string>() // 已加载的记忆路径

  constructor(config: QueryEngineConfig)
  async submitMessage(input: ProcessUserInputContext): Promise<void>
}
```

### 3.2 QueryEngineConfig 配置类型

```typescript
type QueryEngineConfig = {
  cwd: string                          // 工作目录
  tools: Tools                         // 可用工具列表
  commands: Command[]                  // 可用命令列表
  mcpClients: MCPServerConnection[]    // MCP 服务器连接
  agents: AgentDefinition[]            // Agent 定义
  canUseTool: CanUseToolFn             // 权限检查函数
  getAppState: () => AppState          // 获取应用状态
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]           // 初始消息（恢复会话用）
  customSystemPrompt?: string           // 自定义系统提示
  thinkingConfig?: ThinkingConfig       // 思考模式配置
  maxTurns?: number                     // 最大轮次
  maxBudgetUsd?: number                 // 预算上限（美元）
  // ... 20+ 更多配置字段
}
```

### 3.3 消息处理流程

这是 Claude Code 最核心的流程——LLM 对话循环：

```
用户输入 "帮我修复这个 bug"
         │
         ▼
  ┌──────────────────────┐
  │  1. submitMessage()  │ 接收用户输入
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  2. 收集上下文       │ git status, CLAUDE.md, 系统信息
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  3. POST /v1/messages│ 携带完整对话历史调用 API
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  4. 流式解析响应     │ 逐块解析文本和工具调用
  └──────────┬───────────┘
             │
        ┌────┴────┐
        │ 有工具  │
        │ 调用？  │
        └────┬────┘
        Yes  │  No ──► 返回最终文本
             │
             ▼
  ┌──────────────────────┐
  │  5. 校验输入 Schema  │ Zod v4 验证工具参数
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  6. 检查权限         │ 3 阶段权限流程
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  7. 执行工具         │ tool.invoke(input, context)
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  8. 发送工具结果     │ ToolResultBlock → Claude
  └──────────┬───────────┘
             │
             ▼
       回到步骤 3（继续对话循环）
```

### 3.4 重试与背压

```typescript
// QueryEngine 的重试策略
async function callAPI(messages: Message[]): Promise<Response> {
  const MAX_RETRIES = 5
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await anthropicClient.messages.create({
        model: config.model,
        messages,
        tools: config.tools.map(toSDKTool),
        stream: true,
      })
    } catch (error) {
      if (error.status === 429) {
        // 速率限制：指数退避
        const delay = Math.min(1000 * 2 ** attempt, 30000)
        await sleep(delay)
        continue
      }
      if (error.status === 401) {
        // 认证失败：刷新 token 后重试一次
        await refreshOAuthToken()
        continue
      }
      if (error.status >= 500) {
        // 服务端错误：重试
        await sleep(1000 * attempt)
        continue
      }
      throw error  // 其他 4xx 直接抛出
    }
  }
}
```

---

## 4. Tool 工具系统

### 4.1 工具接口定义

**类比**：工具系统就像一个**瑞士军刀**——每把刀片（工具）都有标准的接口（刀柄），可以独立替换、组合使用。模型只需要知道工具的名字和参数格式，不关心底层实现。

```typescript
// 核心工具接口（Tool.ts）
export interface Tool {
  name: string                    // 工具名称，如 "Bash"
  description: string             // 给模型看的描述
  inputSchema: z.ZodSchema        // Zod v4 输入校验 Schema
  canUseTool?: CanUseToolFn       // 工具级权限检查
  isEnabled?: () => boolean       // 是否启用（Feature Flag 控制）
  progressTracker?: ProgressTracker // 进度追踪
}

// 工具调用块（Anthropic SDK 格式）
type ToolUseBlock = {
  type: 'tool_use'
  id: string                      // 唯一调用 ID
  name: string                    // 工具名称
  input: Record<string, unknown>  // 工具参数
}

// 工具结果块
type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string             // 对应的调用 ID
  content: string | ToolResultBlockContent[]
}
```

### 4.2 工具执行上下文

每个工具执行时都会收到丰富的上下文信息：

```typescript
type ToolUseContext = {
  options: {
    commands: Command[]           // 可用命令列表
    mainLoopModel: string         // 主循环模型名
    tools: Tools                  // 可用工具列表
    verbose: boolean              // 详细模式
    thinkingConfig: ThinkingConfig // 思考模式配置
    mcpClients: MCPServerConnection[]
    agentDefinitions: AgentDefinitionsResult
  }
  abortController: AbortController  // 中断信号
  readFileState: FileStateCache     // 文件读取 LRU 缓存
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  setToolJSX?: SetToolJSXFn         // 设置终端 UI 反馈
  // ... 30+ 更多字段
}
```

### 4.3 工具注册表

```typescript
// tools.ts — 中央注册表
export function getAllBaseTools(): Tools {
  return [
    AgentTool,          // 产生子 Agent
    BashTool,           // Shell 命令执行
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    FileReadTool,       // 读取文件（文本/图片/PDF/Notebook）
    FileEditTool,       // 外科手术式编辑（字符串替换）
    FileWriteTool,      // 创建/覆盖文件
    NotebookEditTool,   // Jupyter Notebook 修改
    WebFetchTool,       // HTTP 请求
    WebSearchTool,      // 网页搜索
    TodoWriteTool,      // 任务列表
    // ... 30+ 更多工具，受 Feature Flag 控制
  ]
}

// 根据权限上下文过滤工具
export function getTools(permissionContext: ToolPermissionContext): Tools {
  // 1. 过滤被拒绝的工具
  // 2. SIMPLE 模式只保留 Bash/Read/Edit
  // 3. REPL 模式隐藏原始工具，用 VM 封装
  // 4. 根据 Feature Flag 启用/禁用
  // 5. 检查每个工具的 isEnabled()
}

// 组装最终工具池：内建 + MCP
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtinTools = getTools(permissionContext)
  const allTools = [...builtinTools, ...mcpTools]
  // 去重（按名称），内建工具优先
  // 排序以保证 Prompt Cache 稳定性
  return uniqBy(allTools, 'name')
}
```

### 4.4 核心工具详解

| 工具 | 用途 | 关键特性 |
|------|------|----------|
| **BashTool** | 执行 Shell 命令 | 流式输出，超时控制，危险命令拦截 |
| **FileReadTool** | 读取文件 | 多格式支持（文本/图片/PDF/Notebook），LRU 缓存 |
| **FileEditTool** | 精确编辑文件 | 字符串替换，原子操作，可回滚 |
| **FileWriteTool** | 创建/覆盖文件 | 原子写入，权限检查 |
| **GlobTool** | 文件模式匹配 | 基于 ripgrep，限制结果数量 |
| **GrepTool** | 内容搜索 | 基于 ripgrep，支持上下文行 |
| **WebFetchTool** | 获取 URL 内容 | 限流，超时处理，域名白名单 |
| **AgentTool** | 产生子 Agent | 自定义 Prompt，模型覆盖，预算约束 |
| **SkillTool** | 执行可复用技能 | 持久化工作流，用户可自定义 |
| **MCPTool** | 调用 MCP 服务器工具 | 桥接 MCP 生态系统 |
| **LSPTool** | 语言服务器协议 | IDE 级代码智能（符号搜索、悬停、诊断） |
| **TaskCreateTool** | 创建后台任务 | 并行工作编排 |
| **SendMessageTool** | Agent 间通信 | 多 Agent 协作必需 |
| **TeamCreateTool** | 创建 Agent 团队 | 群体协作管理 |
| **EnterPlanModeTool** | 进入计划模式 | 结构化思考阶段 |
| **EnterWorktreeTool** | 进入 Git 工作树 | 实验性更改的沙箱隔离 |
| **SyntheticOutputTool** | 结构化输出生成 | JSON/XML Schema 校验 |

### 4.5 工具执行流程示例

```typescript
// 模型返回了一个工具调用请求
const toolUse: ToolUseBlock = {
  type: 'tool_use',
  id: 'toolu_01abc123',
  name: 'FileEdit',
  input: {
    file_path: 'src/app.ts',
    old_string: 'console.log("hello")',
    new_string: 'console.log("Hello, World!")'
  }
}

// QueryEngine 处理流程：
// 1. 从注册表找到 FileEditTool
const tool = tools.find(t => t.name === toolUse.name)

// 2. Zod 校验输入
const parsed = tool.inputSchema.parse(toolUse.input)

// 3. 权限检查（详见第 6 节）
const permission = await canUseTool(tool, parsed, permissionContext)
if (permission === 'denied') {
  return { type: 'tool_result', tool_use_id: toolUse.id, content: '用户拒绝了此操作' }
}

// 4. 执行工具
const result = await tool.execute(parsed, toolUseContext)

// 5. 返回结果给 Claude
return { type: 'tool_result', tool_use_id: toolUse.id, content: result }
```

---

## 5. Commands 命令系统

### 5.1 两种命令类型

**类比**：Commands 就像餐厅里的两种服务——**点菜**（PromptCommand，把需求告诉厨师/Claude）和**自助**（ActionCommand，直接在吧台自己取餐/执行副作用）。

```typescript
// 命令类型定义
type Command = PromptCommand | ActionCommand

type PromptCommand = {
  type: 'prompt'
  name: string
  description: string
  // 返回文本，作为提示词发送给 Claude
  getPromptForCommand(args: string[], context: CommandContext): string
}

type ActionCommand = {
  type: 'action'
  name: string
  description: string
  // 直接执行副作用（如切换设置、管理认证等）
  execute(args: string[], context: CommandContext): Promise<void>
}
```

### 5.2 核心命令列表

| 命令 | 类型 | 用途 |
|------|------|------|
| `/commit` | action | 创建 Git 提交 |
| `/review` | prompt | 代码审查分析 |
| `/compact` | action | 压缩对话上下文 |
| `/mcp` | action | MCP 服务器管理 |
| `/config` | action | 设置管理 |
| `/doctor` | action | 环境诊断 |
| `/login` / `/logout` | action | 认证管理 |
| `/memory` | action | 持久化记忆管理 |
| `/skills` | action | 技能发现与加载 |
| `/tasks` | action | 后台任务管理 |
| `/vim` | action | Vim 模式切换 |
| `/diff` | prompt | 显示 Git 变更 |
| `/cost` | prompt | 使用成本报告 |
| `/theme` | action | 终端主题选择 |
| `/context` | prompt | 上下文可视化 |
| `/pr_comments` | action | 查看 PR 评论 |
| `/resume` | action | 恢复历史会话 |
| `/share` | action | 分享会话 |

### 5.3 动态命令加载

```typescript
// 命令不仅来自内建，还可以来自技能和插件
const skillCommands = getSkillDirCommands()   // 技能目录中的命令
const pluginCommands = getPluginCommands()     // 插件提供的命令
const allCommands = [...builtinCommands, ...skillCommands, ...pluginCommands]
```

---

## 6. 权限系统

### 6.1 为什么需要权限系统

**类比**：权限系统就像一栋办公楼的门禁——不同身份（访客/员工/管理员）能进入不同区域。AI Agent 能执行 Shell 命令、修改文件、发网络请求，如果没有权限控制，就像给了一个陌生人整栋楼的万能钥匙。

### 6.2 五种权限模式

```
┌──────────────────────────────────────────────────────────┐
│                    权限模式对比                           │
├──────────────┬───────────────────────────────────────────┤
│ default      │ 每次工具调用都询问用户，记住回答          │
│ plan         │ 研究阶段自动允许，执行阶段再询问          │
│ bypass       │ 自动批准所有工具（仅限无头模式，风险高）  │
│ auto         │ ML 分类器判断是否安全，不安全才询问       │
│ ask          │ 总是询问，从不记住（最安全）              │
└──────────────┴───────────────────────────────────────────┘
```

### 6.3 三阶段权限流程

```
工具执行触发
     │
     ▼
┌─────────────────────────────────────┐
│ 阶段 1: 全局拒绝规则过滤            │
│  - 检查 blanket deny rules          │
│  - 整体屏蔽某些 MCP 服务器工具      │
│  - 在模型看到工具之前就已过滤       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 阶段 2: Permission Hook 检查        │
│  - filePermissionHook: 文件路径校验  │
│  - bashPermissionHook: 命令黑名单    │
│  - webFetchPermissionHook: 限流/域名 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 阶段 3: 模式决策                     │
│  - alwaysAllow → 立即执行            │
│  - alwaysDeny  → 立即拒绝            │
│  - alwaysAsk   → 询问用户 → 缓存    │
│  - auto → ML 分类器判断              │
└──────────────┬──────────────────────┘
               │
               ▼
          执行工具
```

### 6.4 ML 分类器（yoloClassifier）

Claude Code 包含一个 ML 分类器用于自动审批安全操作：

```typescript
// "yoloClassifier" — 判断操作是否足够安全可以自动执行
// 自动批准的安全操作类型：
const SAFE_OPERATIONS = [
  '读取非可执行文件',
  '运行测试命令',
  '格式化代码',
  '构建项目',
  '搜索/解析文件',
  'Git status / diff / log',
]

// 不会自动批准的操作：
const UNSAFE_OPERATIONS = [
  '写入/删除文件',
  '执行任意 Shell 命令',
  '网络请求到未知域名',
  'Git push / force push',
  '安装包 (npm install / pip install)',
]
```

### 6.5 权限上下文类型

```typescript
type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource   // 正则匹配
  alwaysDenyRules: ToolPermissionRulesBySource     // 正则匹配
  alwaysAskRules: ToolPermissionRulesBySource      // 正则匹配
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean // 后台 Agent 使用
}>
```

---

## 7. 多 Agent 架构

### 7.1 Coordinator 模式

**类比**：Coordinator 模式就像一个**项目经理**——他自己不写代码，而是把任务分解、分配给不同的工程师（Worker Agent），追踪进度，最后整合结果。

```
┌─────────────────────────────────────────────────────┐
│                  Coordinator Agent                   │
│  "你是 Claude Code，负责编排多个 Worker 并行工作"    │
│                                                     │
│  可用工具:                                           │
│  ├── AgentTool      → 产生新 Worker                 │
│  ├── SendMessageTool → 向 Worker 发送消息           │
│  └── TaskStopTool   → 停止运行中的 Worker           │
└──────────┬──────────────────┬────────────────────────┘
           │                  │
    ┌──────▼──────┐   ┌──────▼──────┐
    │  Worker A   │   │  Worker B   │
    │ (调研代码)  │   │ (写测试)    │
    │             │   │             │
    │ 标准工具:   │   │ 标准工具:   │
    │ Bash,Read,  │   │ Bash,Read,  │
    │ Edit,MCP... │   │ Edit,MCP... │
    └─────────────┘   └─────────────┘
```

### 7.2 任务管理

```typescript
// 任务类型
type TaskType =
  | 'local_bash'         // 本地 Shell 任务
  | 'local_agent'        // 本地子 Agent
  | 'remote_agent'       // 远程 Agent
  | 'in_process_teammate' // 进程内协作者
  | 'local_workflow'     // 本地工作流
  | 'monitor_mcp'       // MCP 监控
  | 'dream'             // 梦境模式（探索性任务）

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

// 任务 ID 格式：前缀 + 8 位随机字符 (base-36)
// b_a1b2c3d4  → bash 任务
// a_e5f6g7h8  → agent 任务
// r_i9j0k1l2  → 远程任务
// t_m3n4o5p6  → 协作者任务
```

### 7.3 任务执行四阶段

```
1. 研究 (Research) — 并行
   ├── Worker A: 调查代码库结构
   ├── Worker B: 搜索相关文件
   └── Worker C: 分析依赖关系

2. 综合 (Synthesis) — Coordinator
   └── 理解调研结果，制定实施规范

3. 实施 (Implementation) — Worker
   └── 按照规范应用代码变更

4. 验证 (Verification) — Worker
   └── 运行测试，确认变更正确
```

### 7.4 跨 Worker 通信

Worker 之间通过 **Scratchpad 目录** 共享持久化信息：

```typescript
// Coordinator 的上下文注入
function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
): { [k: string]: string } {
  return {
    workerToolsContext: `Workers 可以使用: BashTool, FileReadTool, FileEditTool, [MCP 工具], Skills`,
    scratchpadInfo: `Scratchpad 目录: ${scratchpadDir} — Worker 间共享的持久化存储`,
  }
}
```

---

## 8. Bridge 系统（IDE 集成）

### 8.1 工作原理

**类比**：Bridge 系统就像一个**翻译官**——VS Code 和 JetBrains 说"IDE 语言"，Claude Code 说"CLI 语言"，Bridge 在两者之间实时翻译。

```
┌──────────────┐       HTTP/JWT        ┌──────────────┐
│   VS Code    │ ◄───────────────────► │  Bridge API  │
│  Extension   │     双向通信           │  (Anthropic) │
└──────────────┘                       └──────┬───────┘
                                              │
                                              │ 轮询
                                              ▼
                                       ┌──────────────┐
                                       │  Claude Code │
                                       │    CLI       │
                                       └──────────────┘
```

### 8.2 工作注册流程

```
1. CLI 启动 → POST /v1/environments/bridge
   ← 返回 environment_id + environment_secret

2. 轮询 → GET /v1/environments/{id}/work/poll
   ← 返回 WorkResponse（会话 ID + 用户提示）

3. 执行查询 → 流式结果返回

4. 确认完成 → POST /v1/environments/{id}/work/acknowledge

5. 心跳保活 → POST /v1/environments/{id}/work/heartbeat
   ← 返回 { lease_extended, state, ttl_seconds }

6. 退出 → DELETE /v1/environments/{id}
```

### 8.3 认证机制

```typescript
// Bridge 认证层级
// 1. OAuth 2.0 — 用户身份验证
// 2. JWT — 会话级令牌
// 3. Trusted Device Token — 提升安全级别

// Bridge API 客户端方法
registerBridgeEnvironment(config: BridgeConfig)
  → { environment_id, environment_secret }

pollForWork(environmentId, environmentSecret, signal?)
  → WorkResponse | null

heartbeatWork(environmentId, workId, sessionToken)
  → { lease_extended, state, ttl_seconds }

sendPermissionResponseEvent(sessionId, event, sessionToken)
  → void
```

### 8.4 错误处理

```typescript
class BridgeFatalError extends Error {
  readonly status: number
  readonly errorType: string | undefined

  // 401 → 认证失败（尝试刷新 token 后重试）
  // 403 → 访问拒绝 或 需要提升认证级别
  // 404 → 环境未找到
  // 410 → 会话过期 (environment_lifetime_exceeded)
}
```

---

## 9. 上下文系统

### 9.1 双层上下文注入

**类比**：上下文系统就像给 Claude 配备的**项目背景材料**——系统上下文是"项目基本信息"（代码仓库状态），用户上下文是"项目章程"（CLAUDE.md 中的规范和偏好）。

```typescript
// 系统上下文（每次对话自动注入）
export const getSystemContext = memoize(async () => {
  const gitStatus = await getGitStatus()
  return {
    gitStatus: `
      Current branch: main
      Main branch: main
      Git user: alice@example.com
      Status: [M] src/app.ts
      Recent commits: abc123 Fix auth bug
    `,
  }
})

// 用户上下文（从 CLAUDE.md 加载）
export const getUserContext = memoize(async () => {
  const claudeMd = shouldDisableClaudeMd
    ? null
    : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
  return {
    claudeMd: `# Project Guide\nUse TypeScript strict mode...`,
    currentDate: `Today's date is 2026-03-31.`,
  }
})
```

### 9.2 CLAUDE.md 记忆层级

```
~/.claude/CLAUDE.md          # 全局记忆（跨项目）
project-root/CLAUDE.md       # 项目级记忆
project-root/src/CLAUDE.md   # 目录级记忆（嵌套加载）
```

---

## 10. 成本追踪

### 10.1 追踪数据结构

```typescript
type ModelUsage = {
  inputTokens: number              // 输入 token 数
  outputTokens: number             // 输出 token 数
  cacheReadInputTokens: number     // 缓存读取 token
  cacheCreationInputTokens: number // 缓存创建 token
  webSearchRequests: number        // 网页搜索次数
  costUSD: number                  // 美元成本
  contextWindow: number            // 上下文窗口大小
  maxOutputTokens: number          // 最大输出 token
}
```

### 10.2 成本计算流程

```
API 调用返回
     │
     ▼
提取 Usage 对象 → calculateUSDCost(model, usage) → 美元金额
     │
     ▼
累加 → addToTotalSessionCost(cost, usage, model)
     │
     ▼
持久化 → 保存到 .claude/config.json
```

### 10.3 成本展示

```
Total cost:            $0.25
Total duration (API):  2.5s
Total duration (wall): 5.2s
Total code changes:    42 lines added, 8 lines removed

Usage by model:
  claude-sonnet-4:   185K input, 2.3K output, 0 cache read ($0.20)
  claude-opus:       12K input, 156 output ($0.05)
```

---

## 11. 服务层架构

| 服务 | 目录 | 职责 |
|------|------|------|
| **API 客户端** | `services/api/` | Anthropic SDK 封装、引导数据、文件上传 |
| **MCP 管理** | `services/mcp/` | MCP 服务器发现、连接、工具暴露 |
| **OAuth** | `services/oauth/` | OAuth 2.0 认证流程 |
| **LSP** | `services/lsp/` | 语言服务器协议集成 |
| **分析** | `services/analytics/` | GrowthBook 特性标记、遥测 |
| **压缩** | `services/compact/` | 对话上下文压缩算法 |
| **Token 估算** | `services/tokenEstimation.ts` | Token 计数 |
| **团队记忆** | `services/teamMemorySync/` | 多用户记忆同步 |
| **策略** | `services/policyLimits/` | 组织级策略执行 |
| **远程设置** | `services/remoteManagedSettings/` | MDM 风格远程配置 |
| **记忆提取** | `services/extractMemories/` | 从对话自动提取记忆 |

---

## 12. React + Ink 终端 UI

### 12.1 为什么选择 React + Ink

**类比**：Ink 就像"终端版的 React"——你用 JSX 写 UI 组件，Ink 帮你渲染成终端字符，而不是 HTML。声明式组件模型让复杂的 CLI 界面变得容易管理。

```typescript
// 一个简化的 Claude Code 终端组件
import { Box, Text } from 'ink'

function ToolProgress({ name, status }: { name: string; status: string }) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text color="cyan">⚙</Text>
      <Text bold>{name}</Text>
      <Text dimColor>{status}</Text>
    </Box>
  )
}

// 使用方式
<ToolProgress name="FileEdit" status="正在编辑 src/app.ts..." />
// 终端输出: ⚙ FileEdit 正在编辑 src/app.ts...
```

### 12.2 组件规模

Claude Code 包含约 **140 个 React/Ink 组件**，覆盖：
- 状态显示、进度条、加载动画
- 输入框、确认弹窗、权限提示
- 文件查看器、代码差异展示
- 表格、列表、树形视图
- 对话界面、消息气泡

---

## 13. Feature Flag 与死代码消除

### 13.1 编译时特性标记

**类比**：Feature Flag 就像建筑设计中的"预留接口"——管道已经埋好，但阀门可以控制哪些房间通水。更妙的是，Claude Code 在编译时就把"不通水的管道"整个移除，减少建筑重量。

```typescript
// Bun 的编译时 Feature Flag
import { feature } from 'bun:bundle'

// 编译时决定是否包含语音模式代码
const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.js').default
  : null

// 编译时决定是否包含多 Agent 协调模式
const coordinatorMode = feature('COORDINATOR_MODE')
  ? require('./coordinator/coordinatorMode.js')
  : null

// 编译时决定是否包含主动模式
const proactiveMode = feature('PROACTIVE') || feature('KAIROS')
  ? require('./commands/proactive.js').default
  : null
```

### 13.2 已知 Feature Flag

| Flag | 功能 | 说明 |
|------|------|------|
| `VOICE_MODE` | 语音输入 | 语音交互支持 |
| `COORDINATOR_MODE` | 多 Agent 编排 | Coordinator 模式 |
| `PROACTIVE` / `KAIROS` | 主动模式 | Agent 主动发起操作 |
| `BRIDGE_MODE` | IDE 集成 | VS Code / JetBrains 桥接 |
| `DAEMON` | 守护进程 | 持久化后台服务 |
| `AGENT_TRIGGERS` | Agent 触发器 | 定时/事件触发 Agent |
| `HISTORY_SNIP` | 对话裁剪 | 上下文窗口管理 |
| `WORKFLOW_SCRIPTS` | 工作流脚本 | 自定义自动化 |
| `WEB_BROWSER_TOOL` | 浏览器工具 | 浏览器自动化 |
| `MONITOR_TOOL` | 监控工具 | 可观测性 |
| `UDS_INBOX` | Unix Socket 收件箱 | IPC 通信 |
| `CONTEXT_COLLAPSE` | 上下文折叠 | 上下文检查工具 |

---

## 14. 会话管理与恢复

### 14.1 会话生命周期

```
创建 (Create)  →  活跃 (Active)  →  归档 (Archive)
                      │                    │
                      ▼                    ▼
                恢复 (Resume)      分享 (Share)
```

### 14.2 会话状态

```typescript
// 会话包含的状态
interface SessionState {
  sessionId: string             // 唯一会话 ID
  messages: Message[]           // 对话消息历史
  totalCostUSD: number          // 累计成本
  modelUsage: ModelUsageMap     // 各模型用量
  lastSessionId?: string        // 上一次会话（用于成本恢复）
  mdmSettings?: MDMSettings     // 设备管理设置缓存
  featureFlags?: FeatureFlags   // Feature Flag 覆盖
}

// 恢复会话
function restoreCostStateForSession(sessionId: string): boolean {
  const data = getStoredSessionCosts(sessionId)
  setCostStateForRestore(data)
  return !!data
}
```

---

## 15. 记忆系统

### 15.1 三层记忆架构

```
┌──────────────────────────────────────────┐
│  层 1: 全局记忆 (~/.claude/CLAUDE.md)    │
│  → 跨所有项目生效的个人偏好              │
├──────────────────────────────────────────┤
│  层 2: 项目记忆 (project/CLAUDE.md)      │
│  → 项目级规范、技术栈约定                │
├──────────────────────────────────────────┤
│  层 3: 目录记忆 (dir/CLAUDE.md)          │
│  → 特定目录/模块的局部规范               │
└──────────────────────────────────────────┘
```

### 15.2 自动记忆提取

`services/extractMemories/` 模块能从对话中自动提取有价值的记忆：

```
对话: "项目使用 pnpm，不要用 npm install"
  → 自动提取: "本项目使用 pnpm 作为包管理器"
  → 写入: project/CLAUDE.md
```

### 15.3 团队记忆同步

`services/teamMemorySync/` 支持团队成员间的记忆共享，确保整个团队的 Agent 实例拥有一致的项目知识。

---

## 16. Thinking Mode 集成

### 16.1 三种思考模式

```typescript
type ThinkingConfig =
  | { type: 'disabled' }                    // 关闭思考
  | { type: 'enabled'; budgetTokens?: number } // 启用，可设 token 预算
  | { type: 'adaptive' }                    // 自适应（复杂查询自动启用）
```

### 16.2 思考块在消息中的表现

启用思考模式后，Claude 的推理过程会作为 `thinking` 块出现在消息历史中，帮助用户理解 Agent 的决策过程。

---

## 17. 性能优化全景

| 优化策略 | 实现方式 | 效果 |
|----------|----------|------|
| **并行 I/O** | 启动时 MDM + 钥匙串并行读取 | 启动时间减半 |
| **懒加载** | OpenTelemetry (~400KB) / gRPC (~700KB) 动态 import | 减少初始加载 1MB+ |
| **LRU 缓存** | FileStateCache 缓存文件读取结果 | 避免重复磁盘 I/O |
| **Memoization** | 系统/用户上下文缓存 | 每次对话只计算一次 |
| **Feature Flags** | 编译时死代码消除 | 减少二进制体积 |
| **Prompt Cache** | 工具列表排序保证缓存命中 | 减少 API token 消耗 |
| **去重** | uniqBy() 合并工具池 | 避免重复工具定义 |
| **流式输出** | 工具输出实时流式传输 | 用户无需等待完整结果 |

---

## 18. 错误处理与韧性

### 18.1 重试策略

```
429 (Rate Limit) → 指数退避重试（最多 5 次，上限 30s）
401 (Unauthorized) → 刷新 OAuth token → 重试一次
5xx (Server Error) → 线性退避重试
4xx (其他) → 直接抛出，不重试
```

### 18.2 中断机制

```typescript
// AbortController 贯穿整个调用链
const controller = new AbortController()

// 用户按 Ctrl+C 时
process.on('SIGINT', () => {
  controller.abort()  // 取消所有进行中的请求和工具执行
})
```

### 18.3 错误类型

```typescript
BridgeFatalError     // Bridge 不可恢复错误（401/403/404/410）
PermissionDenial     // 用户拒绝工具执行
OrphanedPermission   // 权限提示无响应
```

---

## 19. 架构总览图

```
┌──────────────────────────────────────────────────────────────┐
│                    main.tsx (入口点)                          │
│                  优化启动（3 路并行 I/O）                     │
└─────────────────────────┬──────────────────────────────────┘
                          │
                ┌─────────┴──────────┐
                │                    │
        ┌───────▼────────┐  ┌────────▼──────────┐
        │   Commander    │  │  launchRepl()     │
        │  (CLI 解析)    │  │  (React + Ink UI) │
        └────────┬───────┘  └────────┬──────────┘
                 │                   │
                 └────────┬──────────┘
                          │
                ┌─────────▼──────────────────┐
                │       QueryEngine          │
                │    (LLM 对话核心循环)       │
                │  • 消息管理                │
                │  • 工具调用循环            │
                │  • 重试与背压              │
                │  • 权限协调                │
                │  • Token 计费              │
                └─┬──────────────────────────┘
                  │
        ┌─────────┼──────────┬──────────┐
        │         │          │          │
    ┌───▼──┐ ┌────▼────┐ ┌──▼────┐ ┌──▼────┐
    │Tools │ │Commands │ │Bridge │ │MCP    │
    │(40+) │ │(50+)    │ │(IDE)  │ │Servers│
    └──┬───┘ └─────────┘ └───────┘ └───────┘
       │
    ┌──▼───────────────────────────────────┐
    │  Permission System (权限系统)         │
    │  • 全局拒绝规则                      │
    │  • Permission Hook                   │
    │  • 模式决策 (default/auto/plan/...)  │
    │  • ML 分类器 (yoloClassifier)        │
    └──┬───────────────────────────────────┘
       │
    ┌──▼───────────────────────────────────┐
    │  Services (服务层)                    │
    │  • Anthropic API    • OAuth          │
    │  • Cost Tracking    • MCP 管理       │
    │  • GrowthBook       • Context 压缩   │
    │  • LSP              • 团队记忆同步   │
    └──────────────────────────────────────┘
```

---

## 20. 常见陷阱与最佳实践

### ❌ 不好的做法 vs ✅ 推荐做法

| 场景 | ❌ 错误做法 | ✅ 正确做法 |
|------|-----------|-----------|
| **工具注册** | 工具直接硬编码在 QueryEngine 中 | 使用注册表模式 + Feature Flag 动态加载 |
| **权限控制** | 所有操作都自动批准 | 分层权限（deny → hook → mode），敏感操作必须询问 |
| **启动性能** | 所有模块同步加载 | 并行 I/O 预取 + 重型模块懒加载 |
| **错误处理** | 所有错误统一重试 | 按状态码区分策略（429 退避 / 401 刷新 / 5xx 重试 / 4xx 抛出） |
| **上下文管理** | 一次性加载所有 CLAUDE.md | 按目录层级渐进加载，用 memoize 避免重复读取 |
| **多 Agent** | 所有任务串行执行 | Coordinator 分解 → Worker 并行 → Scratchpad 共享结果 |
| **Token 成本** | 不追踪 API 调用成本 | 每次调用计费，会话级累计，支持预算上限 |
| **工具池组装** | 内建和 MCP 工具随机排列 | 排序保证 Prompt Cache 命中，内建工具作为连续前缀 |
| **IDE 集成** | 直接内嵌 IDE 逻辑 | Bridge 模式解耦，通过 HTTP 轮询 + JWT 通信 |
| **会话管理** | 关闭即丢失 | 支持 Resume（恢复）、Archive（归档）、Share（分享） |

### 设计启示

1. **注册表模式** 使工具系统高度可扩展，新增工具只需实现接口并注册
2. **三阶段权限** 在安全性和易用性之间取得平衡
3. **编译时 Feature Flag** 在不增加运行时开销的前提下支持功能开关
4. **Coordinator-Worker 模式** 是 Agent 并行化的有效范式
5. **Bridge 架构** 证明了 CLI 工具和 IDE 可以优雅解耦

---

> **参考源**: [nirholas/claude-code (backup branch)](https://github.com/nirholas/claude-code/tree/backup) — Claude Code 源码分析
