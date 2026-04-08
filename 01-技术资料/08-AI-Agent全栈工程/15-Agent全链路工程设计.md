# Agent 全链路工程设计

> 从用户在终端按下 Enter 键的那一刻起，追踪每一个数据包的完整旅程：CLI 客户端 → API 网关 → 推理引擎 → 流式响应，构建支撑 10 万到 1000 万 DAU 的 Agent 服务架构

## TL;DR

- Agent CLI 的核心是 Agentic Loop（思考→行动→观察循环），每轮循环都是一次完整的 LLM 调用 + 工具执行
- 系统上下文组装决定了 Agent 的能力边界——git 状态、项目结构、记忆文件、用户配置都是关键输入
- Tool 系统需要严格的权限分级（read/write/execute），每个工具用 Schema 定义输入输出，沙箱执行保证安全
- 从客户端到推理引擎的链路经过 6 层：CLI → TLS → API Gateway → Model Router → Inference Engine → Response Stream
- 流式响应（SSE）需要在每一层都正确处理：推理引擎逐 token 生成 → 网关透传 → 客户端增量渲染
- 背压控制（Backpressure）是全链路稳定性的关键——当客户端处理速度跟不上推理速度时，需要流控机制
- GPU 推理层的核心优化是 Continuous Batching + KV Cache + Prefill-Decode 分离
- 10 万 DAU 单区域部署即可支撑，1000 万 DAU 需要多区域 Active-Active + 请求队列 + 分级推理

## 相关链接

- 对应面试题：[Agent全链路工程设计面试题](../../02-面试指南/08-AI-Agent全栈工程面试/15-Agent全链路工程设计面试题.md)

## 目录

1. [全链路概览](#1-全链路概览)
2. [Agent 客户端架构](#2-agent-客户端架构)
3. [Agentic Loop 核心引擎](#3-agentic-loop-核心引擎)
4. [客户端到网关的链路](#4-客户端到网关的链路)
5. [API 网关层](#5-api-网关层)
6. [推理服务层](#6-推理服务层)
7. [流式响应全链路](#7-流式响应全链路)
8. [Tool Execution 与安全边界](#8-tool-execution-与安全边界)
9. [10 万 → 1000 万 DAU 扩展](#9-10-万--1000-万-dau-扩展)
10. [常见陷阱与最佳实践](#10-常见陷阱与最佳实践)

---

## 1. 全链路概览

### 1.1 为什么需要理解全链路？

想象你在网上买了一件衣服，点了「下单」之后就开始等快递。但你有没有想过，这个包裹经历了什么？从商家仓库打包 → 揽件员取件 → 分拣中心分拣 → 干线运输 → 目的地分拣 → 末端配送 → 签收。如果某个环节卡住了（比如分拣中心爆仓），你的包裹就迟迟不到。

Agent 全链路也是一样的。当你在终端输入 `"帮我重构这个函数"` 然后按下 Enter，你的请求要经过至少 6 个「分拣中心」才能最终变成一段重构后的代码出现在你面前。理解每一层在做什么、可能在哪里出问题，是构建生产级 Agent 系统的基本功。

### 1.2 全链路架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Agent 全链路请求路径                                 │
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │  用户终端  │    │ CLI 进程  │    │ TLS/HTTPS│    │   CDN / Edge Node   │   │
│  │          │───▶│          │───▶│  加密通道  │───▶│   (边缘节点缓存)     │   │
│  │ Terminal │    │ Agentic  │    │          │    │                      │   │
│  │          │    │   Loop   │    │ TCP + H2 │    │  静态资源 / API 路由  │   │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┬───────────┘   │
│       ▲                                                      │              │
│       │                                                      ▼              │
│       │              ┌──────────────────────────────────────────────┐       │
│       │              │            API Gateway 层                    │       │
│       │              │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │       │
│       │              │  │  Auth   │ │  Rate    │ │   Request    │  │       │
│       │              │  │ Service │ │ Limiter  │ │  Validator   │  │       │
│       │              │  └────┬────┘ └─────┬────┘ └──────┬───────┘  │       │
│       │              │       └────────┬───┘             │          │       │
│       │              │                ▼                 │          │       │
│       │              │  ┌──────────────────────────┐    │          │       │
│       │              │  │     Model Router         │◀───┘          │       │
│       │              │  │  (模型选择 + 队列调度)     │               │       │
│       │              │  └────────────┬─────────────┘               │       │
│       │              └───────────────┼─────────────────────────────┘       │
│       │                              │                                     │
│       │                              ▼                                     │
│       │              ┌──────────────────────────────────────────────┐       │
│       │              │          Inference Cluster (GPU)             │       │
│       │              │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │       │
│       │              │  │ Prefill  │  │  Decode   │  │ KV Cache │   │       │
│       │              │  │ Workers  │──│ Workers   │──│  Store   │   │       │
│       │              │  └──────────┘  └──────────┘  └──────────┘   │       │
│       │              └──────────────────┬───────────────────────────┘       │
│       │                                 │                                   │
│       │                                 ▼                                   │
│       │              ┌──────────────────────────────────────────────┐       │
│       │              │        Response Stream (SSE)                 │       │
│       │              │  Token-by-Token → 网关透传 → 客户端增量渲染   │       │
│       └──────────────│──────────────────────────────────────────────│       │
│         (流式响应)    └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 快递类比：理解每一层

| 全链路层级 | 快递类比 | 核心职责 |
|-----------|---------|---------|
| **用户终端** | 你在家里填写快递单 | 用户输入 prompt，触发请求 |
| **CLI 进程** | 快递员上门揽件、打包 | 组装系统上下文，运行 Agentic Loop，执行工具 |
| **TLS/HTTPS** | 快递运输车的安全锁 | 加密传输，防止中间人窃听和篡改 |
| **CDN/Edge** | 各城市的快递中转站 | 就近接入，减少网络延迟，可缓存部分静态资源 |
| **API Gateway** | 快递总部的分拣中心 | 身份认证、限流、请求校验、路由分发 |
| **Auth Service** | 检查寄件人身份证 | 验证 API Key / OAuth Token，确认用户身份和权限 |
| **Rate Limiter** | 限制每天最多寄多少件 | 防止单用户或单 IP 过量请求，保护下游服务 |
| **Model Router** | 根据包裹类型选择运输线路 | 根据模型名、负载情况选择最优推理集群 |
| **Inference Cluster** | 工厂加工中心 | GPU 集群执行模型推理，逐 token 生成响应 |
| **Response Stream** | 物流追踪 + 逐件配送 | SSE 流式返回，客户端实时渲染生成的文本 |

### 1.4 各层级延迟分布

理解延迟分布对性能优化至关重要——你只有知道时间花在哪里，才能对症下药：

```
                     延迟占比分布（典型 Agent 单轮请求）

  ┌────────────────────────────────────────────────────────────────┐
  │                      总延迟: 2-15 秒                           │
  │                                                                │
  │  客户端组装 (50-200ms)  ██                                     │
  │  ├─ 上下文组装          █                                      │
  │  └─ 序列化 + 压缩       █                                      │
  │                                                                │
  │  网络传输 (20-150ms)    █▌                                     │
  │  ├─ DNS 解析            ▌  (首次, 后续缓存)                     │
  │  ├─ TLS 握手            █  (首次, 后续复用)                     │
  │  └─ TCP + HTTP/2        ▌                                      │
  │                                                                │
  │  API 网关 (5-30ms)      ▌                                      │
  │  ├─ Auth 校验           ▌                                      │
  │  ├─ Rate Limit 检查     ▏                                      │
  │  └─ 请求路由            ▏                                      │
  │                                                                │
  │  排队等待 (0-5000ms)    ████████████████████  ← 高峰期瓶颈！    │
  │                                                                │
  │  推理 Prefill (100-2000ms)  ██████████                         │
  │  ├─ Prompt Token 编码        ████                              │
  │  └─ KV Cache 计算            ██████                            │
  │                                                                │
  │  推理 Decode (500-10000ms)  ████████████████████████████████   │
  │  ├─ 逐 Token 生成（主要耗时）  ██████████████████████████████   │
  │  └─ 采样 + 后处理              ██                              │
  │                                                                │
  │  流式回传 (与 Decode 并行)  ──────────────────────────          │
  │  └─ SSE 逐帧推送 + 客户端渲染                                   │
  └────────────────────────────────────────────────────────────────┘
```

**关键发现**：

- **推理 Decode** 占总延迟的 60-80%，这是不可避免的——模型就是要逐 token 生成
- **排队等待** 在高峰期可能成为最大瓶颈（0 到 5 秒不等），解决方案是扩容 + 请求队列
- **网络传输** 对于长连接场景（HTTP/2 + 连接复用），后续请求几乎可以忽略
- **API 网关** 通常只有个位数毫秒，但如果 Auth 服务挂了，这里就是致命瓶颈

流式响应（SSE）的妙处在于：虽然总推理时间不变，但用户从第一个 token 开始就能看到输出，**感知延迟**从"等 10 秒看到全部"变成了"等 0.5 秒开始看到逐字出现"。这就像快递从"一次性全部送到"变成了"分批次逐件配送"——虽然总配送时间一样，但你更早收到第一件。

---

## 2. Agent 客户端架构

### 2.1 CLI 框架设计

#### 为什么 Agent 要用 CLI？

在 Agent 工程化的世界里，CLI（命令行界面）是最自然的交互入口。想想看：开发者的日常工作就在终端里——`git commit`、`npm install`、`docker build`——Agent CLI 只是在这个工作流里加了一个新命令。

这就像你家厨房已经有了菜刀、砧板、炒锅，现在加了一个「智能切菜机」。你不需要搬到另一个厨房去用它，它就在你现有的工作台上。

#### 技术选型对比

构建 CLI 有三大主流技术栈，各有所长：

| 维度 | Node.js (Ink/React) | Rust (ratatui) | Go (Bubble Tea) |
|------|---------------------|----------------|-----------------|
| **渲染模型** | React 声明式组件 | 即时模式（Immediate Mode） | Elm 架构（Model-Update-View） |
| **启动速度** | 200-500ms（V8 启动） | 5-20ms（原生二进制） | 10-30ms（编译型） |
| **内存占用** | 50-150MB（Node.js 运行时） | 5-20MB | 10-30MB |
| **TUI 能力** | 强（React 组件生态） | 强（底层控制力最强） | 中等（社区组件丰富） |
| **异步模型** | Event Loop + async/await | tokio async | goroutine |
| **生态成熟度** | 最高（npm 生态） | 中等（快速增长） | 高（CLI 工具标杆） |
| **开发效率** | 最高（JSX/TSX 描述 UI） | 较低（需管理内存） | 高（简洁语法） |
| **典型代表** | Claude Code, Cursor CLI | — | gh copilot |

**选型建议**：

- **追求开发效率和 UI 丰富度** → Node.js (Ink)：React 组件模型让复杂 TUI 开发变得简单
- **追求极致性能和单文件分发** → Rust (ratatui)：零依赖二进制，适合嵌入到其他工具链
- **追求平衡和 DevOps 工具链整合** → Go (Bubble Tea)：编译快、部署简单、goroutine 天然适合并发

本教程以 **Node.js (TypeScript)** 为主要示例语言，因为大多数 AI Agent CLI（包括 Claude Code）都基于 Node.js 生态构建，读者更容易将知识直接应用到实际项目。

#### CLI 入口设计

一个 Agent CLI 的启动过程就像飞机起飞前的检查清单——必须按顺序完成每一步：

```
参数解析 → 配置加载 → 认证检查 → 会话初始化 → 上下文组装 → 进入主循环
```

以下是一个完整的 CLI 入口实现：

```typescript
// src/cli/main.ts — Agent CLI 入口
import { parseArgs } from "node:util";
import { AgentSession } from "./session";
import { AgenticLoop } from "./agentic-loop";
import { ContextAssembler } from "./context";
import { ToolRegistry } from "./tools/registry";
import { TerminalUI } from "./ui/terminal";
import { loadConfig, type AgentConfig } from "./config";
import { authenticate } from "./auth";

interface CLIArgs {
  prompt?: string;        // 直接传入的 prompt（非交互模式）
  model: string;          // 模型名称
  maxTurns: number;       // 最大循环次数
  workdir: string;        // 工作目录
  verbose: boolean;       // 调试模式
  resume?: string;        // 恢复之前的会话
}

function parseCLIArgs(): CLIArgs {
  const { values } = parseArgs({
    options: {
      prompt:    { type: "string",  short: "p" },
      model:     { type: "string",  short: "m", default: "claude-sonnet-4-20250514" },
      "max-turns": { type: "string", default: "10" },
      workdir:   { type: "string",  short: "w", default: process.cwd() },
      verbose:   { type: "boolean", short: "v", default: false },
      resume:    { type: "string",  short: "r" },
    },
    strict: true,
  });
  return {
    prompt: values.prompt,
    model: values.model!,
    maxTurns: parseInt(values["max-turns"]!, 10),
    workdir: values.workdir!,
    verbose: values.verbose!,
    resume: values.resume,
  };
}

async function main(): Promise<void> {
  // 1. 参数解析
  const args = parseCLIArgs();

  // 2. 配置加载（~/.agent/config.json + 项目级 .agent.json）
  const config: AgentConfig = await loadConfig(args.workdir);

  // 3. 认证检查（验证 API Key 或 OAuth Token）
  const authToken = await authenticate(config);

  // 4. 初始化核心组件
  const toolRegistry = new ToolRegistry(args.workdir, config.permissions);
  const contextAssembler = new ContextAssembler(args.workdir, config);
  const ui = new TerminalUI({ verbose: args.verbose });

  // 5. 会话初始化或恢复
  const session = args.resume
    ? await AgentSession.restore(args.resume)
    : AgentSession.create({ model: args.model, workdir: args.workdir });

  // 6. 进入 Agentic Loop
  const loop = new AgenticLoop({
    session,
    toolRegistry,
    contextAssembler,
    ui,
    authToken,
    model: args.model,
    maxTurns: args.maxTurns,
  });

  // 7. 运行（交互模式 or 单次执行模式）
  if (args.prompt) {
    await loop.runOnce(args.prompt);
  } else {
    await loop.runInteractive(); // REPL 交互循环
  }
}

main().catch((err) => {
  console.error("Agent 启动失败:", err.message);
  process.exit(1);
});
```

**代码解读**：

- **第 1 步（参数解析）**：使用 Node.js 内置的 `parseArgs` 而非第三方库（如 commander），减少依赖链。生产环境中可换用 `yargs` 以支持子命令
- **第 5 步（会话恢复）**：`--resume` 参数允许中断后恢复上一次会话的完整上下文，这对长时间任务至关重要
- **第 7 步（双模式运行）**：`runOnce` 适合 CI/CD 场景（如 `agent -p "写测试"`），`runInteractive` 适合开发者日常使用

### 2.2 系统上下文组装

#### 为什么上下文是 Agent 的生命线？

如果把 Agent 比作一个新来的实习生，**系统上下文就是你给他的入职培训手册**。手册里写了公司的代码规范、项目结构、你的偏好设置——没有这些信息，实习生就像无头苍蝇一样乱撞，写出的代码和你的项目风格格格不入。

上下文组装的核心原则是：**给 Agent 恰好足够的信息，既不遗漏关键细节，也不塞满无用噪音**。

#### 上下文的四大来源

```
┌─────────────────────────────────────────────────────────────┐
│                    系统上下文组装                             │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ 项目环境信息  │  │ 用户配置     │  │   记忆文件        │    │
│  │             │  │             │  │                  │    │
│  │ • git status│  │ • 模型偏好   │  │ • CLAUDE.md      │    │
│  │ • git diff  │  │ • 权限等级   │  │ • AGENTS.md      │    │
│  │ • 目录结构   │  │ • 自定义指令 │  │ • .agent-memory  │    │
│  │ • 文件类型   │  │ • 忽略规则   │  │ • 项目 README    │    │
│  │ • 依赖文件   │  │             │  │                  │    │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘    │
│         │                │                   │              │
│         └────────────────┼───────────────────┘              │
│                          ▼                                  │
│               ┌─────────────────────┐                       │
│               │  Context Assembler  │                       │
│               │  (优先级排序 + 裁剪) │                       │
│               └──────────┬──────────┘                       │
│                          ▼                                  │
│               ┌─────────────────────┐                       │
│               │   最终 System      │                       │
│               │   Prompt           │                       │
│               │   (≤ 20% 总预算)   │                       │
│               └─────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

**1. 项目环境信息**——Agent 的「现场勘查报告」：

- `git status`：知道哪些文件被修改了，才能理解当前工作进展
- `git diff`（staged）：知道用户正在做什么改动，才能给出相关建议
- 目录结构（前 2-3 层）：知道项目的整体架构
- 依赖文件（package.json, go.mod 等）：知道用什么技术栈

**2. 用户配置**——Agent 的「个人偏好设置」：

- 模型选择、温度参数
- 权限等级：是否允许直接写文件、执行命令
- 自定义系统指令：用户希望 Agent 遵循的额外规则

**3. 记忆文件**——Agent 的「长期记忆」：

- `CLAUDE.md` / `AGENTS.md`：项目级的 Agent 指令（类似 `.editorconfig` 之于编辑器）
- `.agent-memory`：跨会话持久化的记忆（如"这个项目用 tabs 而非 spaces"）

**4. 对话历史**——Agent 的「短期记忆」：

- 之前几轮对话中用户的指令和 Agent 的响应
- 工具调用的结果（文件内容、命令输出等）

#### 上下文预算分配

token 是宝贵资源，必须精打细算：

```
              上下文窗口预算分配（以 200K token 窗口为例）

  ┌──────────────────────────────────────────────────────────┐
  │  System Prompt (20%)          ████████                   │
  │  ├─ 核心指令 + 角色定义       ████                       │
  │  ├─ 项目上下文 (git/目录)     ██                         │
  │  └─ 记忆文件 (CLAUDE.md 等)   ██                         │
  │                                                          │
  │  Conversation History (60%)   ████████████████████████   │
  │  ├─ 最近 N 轮对话 (原文保留)  ████████████████           │
  │  └─ 更早对话 (摘要压缩)       ████████                   │
  │                                                          │
  │  Tool Results (15%)           ██████                     │
  │  ├─ 文件内容                  ████                       │
  │  └─ 命令输出                  ██                         │
  │                                                          │
  │  Safety Buffer (5%)           ██                         │
  │  └─ 预留给模型输出             ██                         │
  └──────────────────────────────────────────────────────────┘
```

#### ContextAssembler 实现

```typescript
// src/context/assembler.ts — 系统上下文组装器
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type AgentConfig } from "../config";

interface ContextBudget {
  systemPrompt: number;    // system prompt token 上限
  conversation: number;    // 对话历史 token 上限
  toolResults: number;     // 工具结果 token 上限
  safetyBuffer: number;    // 安全余量
}

interface AssembledContext {
  systemPrompt: string;
  conversationHistory: Message[];
  totalTokenEstimate: number;
}

// 粗略的 token 估算（实际应使用 tiktoken 等库）
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class ContextAssembler {
  private workdir: string;
  private config: AgentConfig;
  private budget: ContextBudget;

  constructor(workdir: string, config: AgentConfig) {
    this.workdir = workdir;
    this.config = config;
    const totalBudget = config.maxContextTokens ?? 200_000;
    this.budget = {
      systemPrompt:  Math.floor(totalBudget * 0.20),
      conversation:  Math.floor(totalBudget * 0.60),
      toolResults:   Math.floor(totalBudget * 0.15),
      safetyBuffer:  Math.floor(totalBudget * 0.05),
    };
  }

  async assemble(history: Message[]): Promise<AssembledContext> {
    // 按优先级组装 system prompt
    const sections: Array<{ label: string; content: string; priority: number }> = [];

    // P0: 核心角色指令（不可省略）
    sections.push({
      label: "core_instructions",
      content: this.getCoreInstructions(),
      priority: 0,
    });

    // P1: 记忆文件（项目级 Agent 指令）
    sections.push(...this.loadMemoryFiles().map((m) => ({ ...m, priority: 1 })));

    // P2: 项目环境（git 状态 + 目录结构）
    sections.push({
      label: "project_env",
      content: this.getProjectEnvironment(),
      priority: 2,
    });

    // P3: 用户自定义指令
    if (this.config.customInstructions) {
      sections.push({
        label: "custom_instructions",
        content: this.config.customInstructions,
        priority: 3,
      });
    }

    // 按优先级排序，然后按预算裁剪
    sections.sort((a, b) => a.priority - b.priority);
    const systemPrompt = this.fitToBudget(sections, this.budget.systemPrompt);

    // 裁剪对话历史
    const conversationHistory = this.trimConversation(history);

    return {
      systemPrompt,
      conversationHistory,
      totalTokenEstimate:
        estimateTokens(systemPrompt)
        + conversationHistory.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    };
  }

  /** 加载记忆文件：CLAUDE.md, AGENTS.md, .agent-memory */
  private loadMemoryFiles(): Array<{ label: string; content: string }> {
    const memoryFiles = ["CLAUDE.md", "AGENTS.md", ".agent-memory", "README.md"];
    const results: Array<{ label: string; content: string }> = [];

    for (const filename of memoryFiles) {
      const filepath = join(this.workdir, filename);
      if (existsSync(filepath)) {
        const content = readFileSync(filepath, "utf-8");
        results.push({
          label: `memory:${filename}`,
          content: `<file path="${filename}">\n${content}\n</file>`,
        });
      }
    }
    return results;
  }

  /** 获取项目环境信息 */
  private getProjectEnvironment(): string {
    const parts: string[] = [];

    // Git 状态
    try {
      const gitStatus = execSync("git status --short", {
        cwd: this.workdir, encoding: "utf-8", timeout: 5000,
      });
      parts.push(`<git_status>\n${gitStatus || "(clean)"}\n</git_status>`);
    } catch { /* 非 git 仓库，跳过 */ }

    // 目录结构（最多 2 层，排除 node_modules 等）
    const tree = this.getDirectoryTree(this.workdir, 2);
    parts.push(`<directory_tree>\n${tree}\n</directory_tree>`);

    return parts.join("\n\n");
  }

  /** 递归生成目录树 */
  private getDirectoryTree(dir: string, maxDepth: number, depth = 0): string {
    if (depth >= maxDepth) return "";
    const ignore = new Set(["node_modules", ".git", "dist", "__pycache__", ".next"]);
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !ignore.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const indent = "  ".repeat(depth);
    return entries
      .map((e) => {
        const prefix = e.isDirectory() ? "📁" : "📄";
        const line = `${indent}${prefix} ${e.name}`;
        if (e.isDirectory()) {
          const subtree = this.getDirectoryTree(join(dir, e.name), maxDepth, depth + 1);
          return subtree ? `${line}\n${subtree}` : line;
        }
        return line;
      })
      .join("\n");
  }

  /** 按 token 预算裁剪内容 */
  private fitToBudget(
    sections: Array<{ label: string; content: string; priority: number }>,
    maxTokens: number
  ): string {
    let totalTokens = 0;
    const included: string[] = [];

    for (const section of sections) {
      const tokens = estimateTokens(section.content);
      if (totalTokens + tokens <= maxTokens) {
        included.push(section.content);
        totalTokens += tokens;
      } else {
        // 超出预算 → 截断当前 section 的内容
        const remainingChars = Math.floor((maxTokens - totalTokens) * 3.5);
        if (remainingChars > 100) {
          included.push(section.content.slice(0, remainingChars) + "\n...[truncated]");
        }
        break; // 后续低优先级的全部丢弃
      }
    }
    return included.join("\n\n");
  }

  /** 裁剪对话历史：保留最近的，压缩最早的 */
  private trimConversation(history: Message[]): Message[] {
    const maxTokens = this.budget.conversation;
    let totalTokens = 0;

    // 从最新到最旧遍历，保留能放下的
    const kept: Message[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(history[i].content);
      if (totalTokens + tokens > maxTokens) break;
      kept.unshift(history[i]);
      totalTokens += tokens;
    }
    return kept;
  }

  private getCoreInstructions(): string {
    return [
      "You are an AI coding assistant operating inside a CLI tool.",
      "You have access to tools for reading/writing files, running commands, and searching code.",
      "Always explain your reasoning before taking actions.",
      `Current working directory: ${this.workdir}`,
      `Current time: ${new Date().toISOString()}`,
    ].join("\n");
  }
}

type Message = { role: "user" | "assistant" | "tool"; content: string };
```

**代码要点**：

1. **优先级裁剪**：当 token 预算不够时，按 P0→P3 的优先级保留——核心指令永远不会被丢弃，自定义指令最先被丢弃
2. **token 估算**：生产环境应使用 `tiktoken`（OpenAI）或 `@anthropic-ai/tokenizer` 做精确计算，这里用字符数 / 3.5 做粗略估算
3. **目录树过滤**：排除 `node_modules`、`.git` 等噪音目录，只展示有意义的项目结构
4. **对话历史保留策略**：从最新往最旧遍历，优先保留最近的对话（因为最近的对话与当前任务最相关）

### 2.3 终端 UI 渲染

#### 为什么终端渲染比你想象的难？

在终端里渲染 AI 生成的内容，就像在一张只有固定宽度的纸带上打印报纸——你需要处理换行、颜色、表格对齐，而且内容还是一个字一个字地「流」出来的。

核心挑战有三个：
1. **流式渲染**：模型逐 token 生成，UI 需要实时追加文本，而不是等全部完成再显示
2. **Markdown 渲染**：代码块需要语法高亮，表格需要对齐，列表需要缩进
3. **多区域布局**：同时显示输入提示、AI 响应、状态栏、进度条

```
┌──────────────────────────────────────────────────────┐
│  🤖 Agent v1.0  │ Model: claude-sonnet  │ Tokens: 2.3K│  ← 状态栏
├──────────────────────────────────────────────────────┤
│                                                      │
│  User: 帮我重构 auth 模块，把 JWT 验证抽成中间件       │  ← 用户输入
│                                                      │
│  Assistant:                                          │
│  我来分析一下当前的 auth 模块结构...                    │  ← AI 流式输出
│                                                      │
│  ```typescript                                       │
│  // src/middleware/auth.ts                            │  ← 语法高亮
│  export function jwtMiddleware(                      │     代码块
│    req: Request,                                     │
│    res: Response,                                    │
│    next: NextFunction                                │
│  ) {                                                 │
│    const token = req.headers.authorization;          │
│    // ...                                            │
│  }                                                   │
│  ```                                                 │
│                                                      │
│  ⠋ 正在执行: 读取 src/auth/index.ts ...              │  ← 工具执行进度
├──────────────────────────────────────────────────────┤
│  > _                                                 │  ← 输入区域
└──────────────────────────────────────────────────────┘
```

#### 流式文本渲染器

```typescript
// src/ui/stream-renderer.ts — 流式文本渲染（简化版）
import chalk from "chalk";

/** 增量渲染器：接收逐个 token 的流式输入，维护渲染状态 */
export class StreamRenderer {
  private buffer = "";             // 未完成的行缓冲
  private inCodeBlock = false;     // 是否在代码块内
  private codeLanguage = "";       // 代码块的语言标识
  private lineCount = 0;           // 已渲染行数

  /** 接收一个新的 token 并立即渲染 */
  onToken(token: string): void {
    this.buffer += token;

    // 检测代码块边界
    if (this.buffer.includes("```")) {
      this.handleCodeBlockToggle();
    }

    // 如果缓冲区包含完整的行，立即渲染
    while (this.buffer.includes("\n")) {
      const newlineIdx = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      this.renderLine(line);
    }

    // 对于不含换行的部分，直接输出（流式效果）
    if (this.buffer.length > 0 && !this.buffer.includes("```")) {
      process.stdout.write(this.stylize(this.buffer));
      this.buffer = "";
    }
  }

  /** 流结束时，刷新剩余缓冲 */
  flush(): void {
    if (this.buffer.length > 0) {
      this.renderLine(this.buffer);
      this.buffer = "";
    }
    if (this.inCodeBlock) {
      // 未闭合的代码块，强制关闭
      process.stdout.write(chalk.dim("```\n"));
      this.inCodeBlock = false;
    }
  }

  private renderLine(line: string): void {
    const styled = this.stylize(line);
    process.stdout.write(styled + "\n");
    this.lineCount++;
  }

  private stylize(text: string): string {
    if (this.inCodeBlock) {
      return chalk.green(text);  // 代码块内容用绿色
    }
    // Markdown 行内样式
    return text
      .replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold(p1))          // **粗体**
      .replace(/`([^`]+)`/g, (_, p1) => chalk.cyan(p1))              // `行内代码`
      .replace(/^(#{1,3})\s+(.*)/, (_, h, title) => chalk.bold.blue(title)) // 标题
      .replace(/^[-*]\s+/, (match) => chalk.yellow(match));           // 列表项
  }

  private handleCodeBlockToggle(): void {
    const match = this.buffer.match(/```(\w*)/);
    if (match) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true;
        this.codeLanguage = match[1] || "text";
        process.stdout.write(chalk.dim(`\n─── ${this.codeLanguage} ───\n`));
        this.buffer = this.buffer.replace(/```\w*\n?/, "");
      } else {
        // 关闭代码块
        this.buffer = this.buffer.replace(/```\n?/, "");
        process.stdout.write(chalk.dim(`─── end ───\n\n`));
        this.inCodeBlock = false;
        this.codeLanguage = "";
      }
    }
  }
}
```

#### 工具执行进度指示器

当 Agent 调用工具（读文件、执行命令）时，用户需要知道正在发生什么。这就像外卖 App 里的实时配送地图——你虽然不能加速骑手，但至少知道他到哪了：

```typescript
// src/ui/spinner.ts — 工具执行进度指示器
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class ToolSpinner {
  private frameIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private currentMessage = "";

  start(toolName: string, description: string): void {
    this.currentMessage = `${toolName}: ${description}`;
    this.frameIndex = 0;
    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
      // 使用 \r 回到行首，覆盖上一帧
      process.stderr.write(`\r  ${frame} 正在执行: ${this.currentMessage}  `);
      this.frameIndex++;
    }, 80);
  }

  succeed(result: string): void {
    this.stop();
    process.stderr.write(`\r  ✅ ${this.currentMessage} — ${result}\n`);
  }

  fail(error: string): void {
    this.stop();
    process.stderr.write(`\r  ❌ ${this.currentMessage} — ${error}\n`);
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
```

**渲染架构总结**：

| 组件 | 职责 | 更新频率 |
|------|------|---------|
| StreamRenderer | 逐 token 渲染 AI 输出 | 每个 token（~10-50ms） |
| ToolSpinner | 显示工具执行进度 | 每帧 80ms |
| StatusBar | 显示模型名、token 用量 | 每次 API 响应后 |
| InputArea | 接收用户输入 | 用户按键时 |

---

## 3. Agentic Loop 核心引擎

### 3.1 Think → Act → Observe 循环

#### 这是什么？

Agentic Loop 是 AI Agent 的「心脏」——它让 Agent 不再是一个问答机器（问一次答一次），而是一个能自主思考、行动、学习的「实习生」。

想象一个新手厨师做一道菜：
1. **Think（思考）**：看看菜谱，决定下一步该切什么菜
2. **Act（行动）**：拿起刀切菜 / 开火炒菜
3. **Observe（观察）**：看看切得怎么样、菜炒到什么程度了

如果菜没炒熟，他会回到 Step 1 继续思考接下来该怎么做。这个「思考→行动→观察」的循环会一直转，直到这道菜做好为止。

Agent 的工作方式完全一样：

```
                    Agentic Loop 状态机

        ┌──────────────────────────────────────┐
        │                                      │
        ▼                                      │
  ┌──────────┐     ┌──────────┐     ┌──────────┴───┐
  │          │     │          │     │              │
  │  THINK   │────▶│   ACT    │────▶│   OBSERVE    │
  │          │     │          │     │              │
  │ LLM 推理 │     │ 工具执行  │     │ 结果分析     │
  │ 决定下一步│     │ 文件/命令 │     │ 更新上下文   │
  │          │     │          │     │              │
  └──────────┘     └─────┬────┘     └──────────────┘
       ▲                 │
       │                 │  无需工具？直接输出
       │                 ▼
       │           ┌──────────┐
       │           │          │
       │           │ RESPOND  │──────▶ 结束循环
       │           │          │
       │           │ 返回结果  │
       │           │ 给用户    │
       │           └──────────┘
       │
       │  ┌──────────┐
       └──│ 终止条件  │
          │ 检查     │
          └──────────┘
           • 任务完成（模型输出 end_turn）
           • 达到最大轮次 (maxTurns)
           • 用户中断 (Ctrl+C)
           • 不可恢复的错误
```

#### 每个阶段详解

**THINK 阶段（调用 LLM）**：

将当前的全部上下文（系统 prompt + 对话历史 + 工具结果）发送给 LLM。LLM 会返回两类内容之一：
- **文本响应**：直接回答用户，循环结束
- **工具调用请求**：要求执行某个工具（如读文件、运行命令），循环继续

**ACT 阶段（执行工具）**：

根据 LLM 返回的工具调用请求，在本地环境中执行对应操作。关键是安全控制——不能让 LLM 随意执行 `rm -rf /`。

**OBSERVE 阶段（处理结果）**：

将工具的执行结果（文件内容、命令输出、错误信息）加入到对话历史中，作为下一轮 THINK 的输入。

#### AgenticLoop 完整实现

```typescript
// src/core/agentic-loop.ts — Agentic Loop 核心引擎
import { type Message, type ToolCall, type ToolResult } from "./types";
import { type ToolRegistry } from "../tools/registry";
import { type ContextAssembler } from "../context/assembler";
import { type TerminalUI } from "../ui/terminal";
import { type LLMClient, createLLMClient } from "../llm/client";
import { ContextWindowManager } from "./context-window";

interface AgenticLoopConfig {
  session: AgentSession;
  toolRegistry: ToolRegistry;
  contextAssembler: ContextAssembler;
  ui: TerminalUI;
  authToken: string;
  model: string;
  maxTurns: number;
}

type LoopState = "thinking" | "acting" | "observing" | "responding" | "terminated";

export class AgenticLoop {
  private config: AgenticLoopConfig;
  private llm: LLMClient;
  private history: Message[] = [];
  private state: LoopState = "responding";
  private turnCount = 0;
  private ctxManager: ContextWindowManager;

  // 中断信号
  private abortController = new AbortController();

  constructor(config: AgenticLoopConfig) {
    this.config = config;
    this.llm = createLLMClient({
      model: config.model,
      authToken: config.authToken,
    });
    this.ctxManager = new ContextWindowManager({
      maxTokens: 200_000,
      reservedForOutput: 16_000,
    });

    // 监听 Ctrl+C
    process.on("SIGINT", () => this.handleInterrupt());
  }

  /** 单次执行模式 */
  async runOnce(userPrompt: string): Promise<string> {
    this.history.push({ role: "user", content: userPrompt });
    return this.executeLoop();
  }

  /** 交互式 REPL 模式 */
  async runInteractive(): Promise<void> {
    this.config.ui.showWelcome();
    while (!this.abortController.signal.aborted) {
      const userInput = await this.config.ui.promptUser();
      if (!userInput || userInput === "/exit") break;

      // 处理斜杠命令
      if (userInput.startsWith("/")) {
        await this.handleSlashCommand(userInput);
        continue;
      }

      this.history.push({ role: "user", content: userInput });
      await this.executeLoop();
    }
  }

  /** 核心循环：Think → Act → Observe */
  private async executeLoop(): Promise<string> {
    this.turnCount = 0;
    let finalResponse = "";

    while (this.turnCount < this.config.maxTurns) {
      // 检查中断信号
      if (this.abortController.signal.aborted) {
        this.config.ui.showWarning("用户中断，停止执行");
        break;
      }

      this.turnCount++;
      this.config.ui.showTurnHeader(this.turnCount, this.config.maxTurns);

      // ═══ THINK ═══
      this.state = "thinking";
      const context = await this.config.contextAssembler.assemble(this.history);
      const llmResponse = await this.think(context);

      // 判断 LLM 是否要求调用工具
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        // 记录 assistant 消息（含工具调用请求）
        this.history.push({
          role: "assistant",
          content: llmResponse.text || "",
          toolCalls: llmResponse.toolCalls,
        });

        // 如果 LLM 有文本输出，先渲染
        if (llmResponse.text) {
          this.config.ui.streamText(llmResponse.text);
        }

        // ═══ ACT ═══
        this.state = "acting";
        const toolResults = await this.act(llmResponse.toolCalls);

        // ═══ OBSERVE ═══
        this.state = "observing";
        this.observe(toolResults);

        // 继续下一轮循环
        continue;
      }

      // LLM 直接输出文本（无工具调用） → 循环结束
      this.state = "responding";
      finalResponse = llmResponse.text || "";
      this.history.push({ role: "assistant", content: finalResponse });
      this.config.ui.streamText(finalResponse);
      break;
    }

    if (this.turnCount >= this.config.maxTurns) {
      this.config.ui.showWarning(
        `达到最大轮次限制 (${this.config.maxTurns})，自动停止`
      );
    }

    this.state = "terminated";
    return finalResponse;
  }

  /** THINK: 调用 LLM，获取下一步指令 */
  private async think(context: AssembledContext): Promise<LLMResponse> {
    this.config.ui.showSpinner("thinking", "正在思考...");
    try {
      const response = await this.llm.chat({
        systemPrompt: context.systemPrompt,
        messages: this.ctxManager.fitMessages(context.conversationHistory),
        tools: this.config.toolRegistry.getToolDefinitions(),
        signal: this.abortController.signal,
      });
      this.config.ui.hideSpinner();
      return response;
    } catch (error) {
      this.config.ui.hideSpinner();
      throw new AgenticLoopError(`LLM 调用失败: ${error.message}`, error);
    }
  }

  /** ACT: 执行工具调用 */
  private async act(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      this.config.ui.showSpinner("tool", `执行 ${call.name}...`);
      try {
        // 权限检查
        const permitted = await this.config.toolRegistry.checkPermission(call);
        if (!permitted) {
          // 需要用户确认的高危操作
          const approved = await this.config.ui.confirmToolExecution(call);
          if (!approved) {
            results.push({
              toolCallId: call.id,
              output: "用户拒绝了此操作",
              isError: true,
            });
            continue;
          }
        }

        const result = await this.config.toolRegistry.execute(call);
        results.push(result);
        this.config.ui.showToolResult(call.name, result);
      } catch (error) {
        results.push({
          toolCallId: call.id,
          output: `工具执行失败: ${error.message}`,
          isError: true,
        });
        this.config.ui.showToolError(call.name, error);
      }
    }
    return results;
  }

  /** OBSERVE: 将工具结果加入历史 */
  private observe(results: ToolResult[]): void {
    for (const result of results) {
      this.history.push({
        role: "tool",
        content: result.output,
        toolCallId: result.toolCallId,
      });
    }
  }

  private handleInterrupt(): void {
    if (this.state === "acting") {
      this.config.ui.showWarning("正在等待工具执行完成后安全退出...");
    }
    this.abortController.abort();
  }

  private async handleSlashCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.split(" ");
    switch (command) {
      case "/clear":
        this.history = [];
        this.config.ui.showInfo("对话历史已清空");
        break;
      case "/model":
        this.config.model = args[0] || this.config.model;
        this.config.ui.showInfo(`模型切换为: ${this.config.model}`);
        break;
      case "/history":
        this.config.ui.showHistory(this.history);
        break;
      default:
        this.config.ui.showWarning(`未知命令: ${command}`);
    }
  }
}

class AgenticLoopError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "AgenticLoopError";
  }
}
```

**代码要点深度解析**：

1. **循环控制**：`maxTurns` 是安全阀——防止 Agent 陷入无限循环。生产环境中通常设为 10-30 轮。每轮循环包含一次完整的 LLM 调用 + 可能的工具执行，所以 10 轮实际上已经能完成相当复杂的任务

2. **中断处理**：当用户按 Ctrl+C 时，如果 Agent 正在执行工具（`state === "acting"`），不能立刻终止——比如正在写文件写到一半，强制终止会导致文件损坏。正确做法是等当前工具执行完成后再安全退出

3. **权限确认**：高危操作（如写文件、执行 shell 命令）需要用户手动确认。这在代码中通过 `checkPermission` + `confirmToolExecution` 实现

4. **工具结果回注**：`observe` 阶段把工具执行结果以 `tool` 角色消息加入历史，这样下一轮 `think` 时 LLM 就能看到工具输出，并据此决定下一步

### 3.2 Tool 系统设计

#### 为什么 Tool 系统是 Agent 的手和脚？

如果 LLM 是 Agent 的大脑，那 Tool 系统就是它的手和脚。没有 Tool，Agent 只能"纸上谈兵"——它可以告诉你应该怎么改代码，但没法真的去改。有了 Tool，Agent 变成了一个能实际动手干活的开发者。

这就像你雇了一个很聪明的人，但你不给他电脑、不给他文件访问权限——他再聪明也什么都做不了。Tool 就是给这个聪明人配备的工具箱。

#### Tool 定义与 Schema

每个工具都需要严格的 Schema 定义——就像 API 文档一样，LLM 需要知道这个工具接受什么参数、返回什么结果：

```typescript
// src/tools/types.ts — 工具类型定义
import { z, type ZodSchema } from "zod";

/** 工具权限等级 */
export enum ToolPermission {
  READ = "read",         // 只读操作：读文件、搜索、列目录
  WRITE = "write",       // 写操作：创建/编辑文件
  EXECUTE = "execute",   // 执行操作：运行 shell 命令
}

/** 工具定义接口 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;                        // 工具名称（唯一标识）
  description: string;                 // 工具描述（LLM 靠这个理解工具用途）
  permission: ToolPermission;          // 权限等级
  inputSchema: ZodSchema<TInput>;      // 输入参数 Schema（Zod 验证）
  outputSchema?: ZodSchema<TOutput>;   // 输出 Schema（可选）
  execute: (input: TInput) => Promise<TOutput>;  // 执行函数
}

/** 工具调用请求（LLM → Agent） */
export interface ToolCall {
  id: string;              // 唯一调用 ID
  name: string;            // 工具名称
  arguments: unknown;      // 调用参数（JSON）
}

/** 工具执行结果（Agent → LLM） */
export interface ToolResult {
  toolCallId: string;      // 对应的调用 ID
  output: string;          // 执行结果（文本）
  isError: boolean;        // 是否执行失败
}
```

#### 具体工具实现示例

```typescript
// src/tools/implementations/read-file.ts — 读文件工具
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ToolDefinition, ToolPermission } from "../types";

const inputSchema = z.object({
  path: z.string().describe("要读取的文件路径（相对于工作目录）"),
  startLine: z.number().optional().describe("起始行号（从 1 开始）"),
  endLine: z.number().optional().describe("结束行号"),
});

export function createReadFileTool(workdir: string): ToolDefinition {
  return {
    name: "read_file",
    description: "读取指定文件的内容。可选指定行范围。",
    permission: ToolPermission.READ,
    inputSchema,
    async execute(input) {
      const absPath = resolve(workdir, input.path);

      // 安全检查：防止路径穿越
      if (!absPath.startsWith(resolve(workdir))) {
        throw new Error(`安全错误：不允许访问工作目录之外的文件: ${input.path}`);
      }

      const content = await readFile(absPath, "utf-8");
      const lines = content.split("\n");

      if (input.startLine || input.endLine) {
        const start = (input.startLine ?? 1) - 1;
        const end = input.endLine ?? lines.length;
        const sliced = lines.slice(start, end);
        return sliced.map((line, i) => `${start + i + 1}. ${line}`).join("\n");
      }

      // 添加行号
      return lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
    },
  };
}

// src/tools/implementations/bash.ts — 执行命令工具
import { z } from "zod";
import { spawn } from "node:child_process";
import { type ToolDefinition, ToolPermission } from "../types";

const bashInputSchema = z.object({
  command: z.string().describe("要执行的 Bash 命令"),
  timeout: z.number().optional().default(30000).describe("超时时间（毫秒）"),
});

export function createBashTool(workdir: string): ToolDefinition {
  return {
    name: "bash",
    description: "在工作目录中执行 Bash 命令。用于运行测试、安装依赖、查看文件等。",
    permission: ToolPermission.EXECUTE,  // 最高权限
    inputSchema: bashInputSchema,
    async execute(input) {
      return new Promise((resolve, reject) => {
        const proc = spawn("bash", ["-c", input.command], {
          cwd: workdir,
          timeout: input.timeout,
          env: { ...process.env, TERM: "dumb" }, // 禁用颜色等
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => { stdout += chunk; });
        proc.stderr.on("data", (chunk) => { stderr += chunk; });

        proc.on("close", (code) => {
          const output = [
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
            `exit code: ${code}`,
          ].filter(Boolean).join("\n");

          // 截断过长的输出
          const maxLen = 50_000;
          resolve(output.length > maxLen
            ? output.slice(0, maxLen) + "\n...[output truncated]"
            : output
          );
        });

        proc.on("error", (err) => reject(err));
      });
    },
  };
}
```

#### Tool Registry：工具注册中心

```typescript
// src/tools/registry.ts — 工具注册中心
import { type ToolDefinition, type ToolCall, type ToolResult, ToolPermission } from "./types";
import { createReadFileTool } from "./implementations/read-file";
import { createBashTool } from "./implementations/bash";

/** 权限策略：哪些操作需要用户确认 */
interface PermissionPolicy {
  autoApprove: ToolPermission[];     // 自动批准的权限等级
  requireConfirmation: ToolPermission[]; // 需要用户确认的权限等级
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private policy: PermissionPolicy;

  constructor(workdir: string, policy?: Partial<PermissionPolicy>) {
    this.policy = {
      autoApprove: policy?.autoApprove ?? [ToolPermission.READ],
      requireConfirmation: policy?.requireConfirmation ?? [
        ToolPermission.WRITE,
        ToolPermission.EXECUTE,
      ],
    };

    // 注册内置工具
    this.register(createReadFileTool(workdir));
    this.register(createBashTool(workdir));
    // ... 更多内置工具：write_file, search, list_directory 等
  }

  /** 注册新工具 */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已存在，不允许重复注册`);
    }
    this.tools.set(tool.name, tool);
  }

  /** 动态加载外部工具（插件机制） */
  async loadPlugin(pluginPath: string): Promise<void> {
    const plugin = await import(pluginPath);
    if (typeof plugin.createTool === "function") {
      const tool = plugin.createTool();
      this.register(tool);
    }
  }

  /** 检查工具调用是否需要用户确认 */
  checkPermission(call: ToolCall): boolean {
    const tool = this.tools.get(call.name);
    if (!tool) return false;
    return this.policy.autoApprove.includes(tool.permission);
  }

  /** 执行工具调用 */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        output: `未知工具: ${call.name}`,
        isError: true,
      };
    }

    // 使用 Zod 验证输入参数
    const parsed = tool.inputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        output: `参数校验失败: ${parsed.error.message}`,
        isError: true,
      };
    }

    try {
      const output = await tool.execute(parsed.data);
      return {
        toolCallId: call.id,
        output: typeof output === "string" ? output : JSON.stringify(output),
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: call.id,
        output: `执行错误: ${(error as Error).message}`,
        isError: true,
      };
    }
  }

  /** 生成工具定义列表（发送给 LLM） */
  getToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.zodToJsonSchema(tool.inputSchema),
      },
    }));
  }

  /** 将 Zod Schema 转为 JSON Schema（LLM API 需要） */
  private zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
    // 实际使用 zod-to-json-schema 库
    // 这里简化为概念展示
    return { type: "object", properties: {} };
  }
}

interface LLMToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
```

**权限分级策略详解**：

```
             Tool 权限金字塔

              ┌─────────┐
              │ EXECUTE │  ← 最高风险：执行任意命令
              │ (shell) │     需要用户逐次确认
              ├─────────┤
              │  WRITE  │  ← 中等风险：修改文件
              │ (files) │     首次确认，可选"信任本次会话"
              ├─────────┤
              │  READ   │  ← 低风险：读取信息
              │ (search)│     自动批准，无需确认
              └─────────┘
```

### 3.3 Context Window 管理

#### 为什么 Context Window 管理如此重要？

Context Window 就像一个人的工作记忆（Working Memory）——容量有限，装得太多就会忘掉之前的内容。LLM 的 context window 虽然从 4K 增长到了 200K 甚至更多，但它仍然是有限的，而且 **越长的上下文，推理质量越容易下降**（"Lost in the Middle" 现象）。

这就像你在一个堆满了文件的办公桌上工作——虽然桌子很大，但如果上面放了 100 份文件，你反而找不到需要的那份。高效的做法是：把最重要的文件放在手边，不常用的归档到抽屉里，需要时再取出来。

#### 管理策略

```
           Context Window 管理策略

  ┌──────────────────────────────────────────────────┐
  │          200K Token Context Window                │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ System Prompt (固定区域，不可压缩)          │  │
  │  │ • 核心指令、角色定义                        │  │
  │  │ • 项目上下文、记忆文件                      │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ 摘要区域 (老对话的压缩版)                   │  │
  │  │ "[前 5 轮对话摘要]: 用户要求重构 auth       │  │
  │  │  模块，Agent 已读取了 3 个文件并提出了      │  │
  │  │  重构方案..."                               │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ 最近对话 (原文保留)                         │  │
  │  │ • 最近 3-5 轮完整对话                       │  │
  │  │ • 包含所有工具调用和结果                     │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ 输出预留 (给模型生成响应的空间)             │  │
  │  │ • 通常预留 4K-16K tokens                    │  │
  │  └────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────┘
```

#### ContextWindowManager 实现

```typescript
// src/core/context-window.ts — Context Window 管理器
import { type Message } from "./types";

interface WindowConfig {
  maxTokens: number;          // context window 总容量
  reservedForOutput: number;  // 预留给模型输出的 tokens
  summaryThreshold: number;   // 超过此轮数开始摘要
  recentTurnsToKeep: number;  // 保留最近几轮的原文
}

export class ContextWindowManager {
  private config: WindowConfig;

  constructor(config: Partial<WindowConfig> & Pick<WindowConfig, "maxTokens">) {
    this.config = {
      maxTokens: config.maxTokens,
      reservedForOutput: config.reservedForOutput ?? 16_000,
      summaryThreshold: config.summaryThreshold ?? 6,
      recentTurnsToKeep: config.recentTurnsToKeep ?? 4,
    };
  }

  /**
   * 将消息列表裁剪到 context window 预算内。
   *
   * 策略：
   * 1. 如果全部消息能放下 → 原样返回
   * 2. 如果放不下 → 保留最近 N 轮原文，更早的消息生成摘要
   * 3. 如果还放不下 → 截断最早的工具结果（通常最占 token）
   */
  fitMessages(messages: Message[]): Message[] {
    const budget = this.config.maxTokens - this.config.reservedForOutput;
    const totalTokens = this.estimateTotalTokens(messages);

    // Case 1: 全部放得下
    if (totalTokens <= budget) {
      return messages;
    }

    // Case 2: 需要摘要
    const turns = this.groupIntoTurns(messages);
    if (turns.length > this.config.summaryThreshold) {
      return this.applySlidiingWindowWithSummary(turns, budget);
    }

    // Case 3: 轮次不多但单条消息太大 → 截断工具结果
    return this.truncateLargeMessages(messages, budget);
  }

  /** 将消息分组为"轮次"（一轮 = user + assistant + tool results） */
  private groupIntoTurns(messages: Message[]): Message[][] {
    const turns: Message[][] = [];
    let currentTurn: Message[] = [];

    for (const msg of messages) {
      if (msg.role === "user" && currentTurn.length > 0) {
        turns.push(currentTurn);
        currentTurn = [];
      }
      currentTurn.push(msg);
    }
    if (currentTurn.length > 0) turns.push(currentTurn);
    return turns;
  }

  /** 滑动窗口 + 摘要策略 */
  private applySlidiingWindowWithSummary(
    turns: Message[][],
    budget: number
  ): Message[] {
    const keepCount = this.config.recentTurnsToKeep;
    const recentTurns = turns.slice(-keepCount);
    const olderTurns = turns.slice(0, -keepCount);

    // 为老对话生成摘要
    const summary = this.summarizeTurns(olderTurns);
    const summaryMessage: Message = {
      role: "user",
      content: `[前 ${olderTurns.length} 轮对话摘要]:\n${summary}`,
    };

    const result = [summaryMessage, ...recentTurns.flat()];

    // 检查是否在预算内
    if (this.estimateTotalTokens(result) <= budget) {
      return result;
    }

    // 仍然超预算 → 进一步截断
    return this.truncateLargeMessages(result, budget);
  }

  /** 截断大消息（主要是工具结果） */
  private truncateLargeMessages(messages: Message[], budget: number): Message[] {
    let totalTokens = this.estimateTotalTokens(messages);
    if (totalTokens <= budget) return messages;

    // 从最旧的消息开始，截断 tool 角色的消息
    const result = [...messages];
    for (let i = 0; i < result.length && totalTokens > budget; i++) {
      if (result[i].role === "tool") {
        const originalTokens = this.estimateTokens(result[i].content);
        const maxChars = 500;  // 截断到 500 字符
        if (result[i].content.length > maxChars) {
          result[i] = {
            ...result[i],
            content: result[i].content.slice(0, maxChars) + "\n...[truncated]",
          };
          totalTokens -= originalTokens - this.estimateTokens(result[i].content);
        }
      }
    }
    return result;
  }

  /** 生成对话摘要（实际应用中可调用 LLM 做摘要） */
  private summarizeTurns(turns: Message[][]): string {
    // 简化版：提取每轮的用户问题和 assistant 关键动作
    return turns
      .map((turn, i) => {
        const userMsg = turn.find((m) => m.role === "user");
        const assistantMsg = turn.find((m) => m.role === "assistant");
        const toolMsgs = turn.filter((m) => m.role === "tool");

        return [
          `轮次 ${i + 1}:`,
          userMsg ? `  用户: ${userMsg.content.slice(0, 100)}...` : "",
          assistantMsg ? `  Agent: ${(assistantMsg.content || "").slice(0, 100)}...` : "",
          toolMsgs.length > 0 ? `  工具调用: ${toolMsgs.length} 次` : "",
        ].filter(Boolean).join("\n");
      })
      .join("\n");
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private estimateTotalTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
  }
}
```

**关键设计决策**：

| 决策 | 选择 | 原因 |
|------|------|------|
| 摘要时机 | 超过 6 轮时触发 | 太早摘要丢失细节，太晚导致 token 浪费 |
| 保留轮次 | 最近 4 轮原文 | 最近的对话与当前任务最相关 |
| 截断目标 | 优先截断 tool 结果 | 工具输出通常占 token 最多且信息密度低 |
| 摘要方式 | 文本提取（可升级为 LLM 摘要） | 简单可靠，不引入额外 API 调用 |

### 3.4 Sub-agent 模式

#### 什么时候需要 Sub-agent？

想象你是一个项目经理，手下有一个大型代码重构任务。你可以：
- **方案 A**：自己一个人从头到尾做完——慢，但不容易出协调问题
- **方案 B**：把任务拆成几块，分配给几个开发者同时做——快，但需要协调

Sub-agent 就是方案 B。当任务可以被并行化时（比如同时编辑 5 个文件、同时调研 3 个技术方案），主 Agent 可以"派遣"多个 Sub-agent 同时工作。

```
                    Sub-agent 架构

  ┌──────────────────────────────────────────────────────┐
  │                   Parent Agent                       │
  │                                                      │
  │  ┌────────────────────────────────────────────────┐  │
  │  │            Task Decomposer                     │  │
  │  │  将大任务拆分为独立子任务                        │  │
  │  └──────────────────┬─────────────────────────────┘  │
  │                     │                                │
  │         ┌───────────┼───────────┐                    │
  │         ▼           ▼           ▼                    │
  │  ┌────────────┐ ┌────────────┐ ┌────────────┐       │
  │  │ Sub-agent  │ │ Sub-agent  │ │ Sub-agent  │       │
  │  │     #1     │ │     #2     │ │     #3     │       │
  │  │            │ │            │ │            │       │
  │  │ 编辑文件A  │ │ 编辑文件B  │ │ 调研方案    │       │
  │  │ 独立上下文 │ │ 独立上下文 │ │ 独立上下文  │       │
  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘       │
  │        │              │              │               │
  │        └──────────────┼──────────────┘               │
  │                       ▼                              │
  │  ┌────────────────────────────────────────────────┐  │
  │  │            Result Aggregator                   │  │
  │  │  收集子结果、合并冲突、生成最终响应              │  │
  │  └────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────┘
```

#### Sub-agent 适用场景

| 场景 | 并行度 | 示例 |
|------|--------|------|
| **并行文件编辑** | 高 | 重命名一个函数，需要同时修改 10 个引用文件 |
| **多方案调研** | 中 | 同时调研 React、Vue、Svelte 三种方案的优劣 |
| **测试 + 修复** | 低 | 运行测试 → 发现失败 → 修复 → 重新测试 |
| **代码审查** | 高 | 同时审查 PR 中的 20 个文件变更 |

#### 实现要点

```typescript
// src/core/sub-agent.ts — Sub-agent 管理器
import { AgenticLoop } from "./agentic-loop";
import { type Message } from "./types";

interface SubAgentTask {
  id: string;
  description: string;           // 子任务描述
  prompt: string;                // 发送给 sub-agent 的指令
  constraints?: string[];        // 约束条件（如"只修改这个文件"）
  parentContext?: string;        // 从父 agent 传递的上下文
}

interface SubAgentResult {
  taskId: string;
  success: boolean;
  output: string;                // sub-agent 的执行结果
  filesModified: string[];       // 修改了哪些文件
  error?: string;
}

export class SubAgentManager {
  private maxConcurrency: number;
  private activeAgents = new Map<string, AgenticLoop>();

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 并行执行多个子任务
   *
   * 关键设计：
   * 1. 每个 sub-agent 有独立的 context window（不共享父 agent 的历史）
   * 2. 并发数受限（防止同时发出太多 LLM 请求）
   * 3. 文件锁机制防止两个 sub-agent 同时修改同一个文件
   */
  async executeParallel(tasks: SubAgentTask[]): Promise<SubAgentResult[]> {
    // 冲突检测：检查是否有两个任务要修改同一个文件
    this.detectConflicts(tasks);

    // 并发控制：使用信号量限制同时运行的 sub-agent 数量
    const semaphore = new Semaphore(this.maxConcurrency);
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        await semaphore.acquire();
        try {
          return await this.executeSingleSubAgent(task);
        } finally {
          semaphore.release();
        }
      })
    );

    return results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        taskId: tasks[i].id,
        success: false,
        output: "",
        filesModified: [],
        error: (r.reason as Error).message,
      };
    });
  }

  /** 执行单个 sub-agent */
  private async executeSingleSubAgent(task: SubAgentTask): Promise<SubAgentResult> {
    // 构建 sub-agent 的系统 prompt
    const systemPrompt = [
      "You are a sub-agent executing a specific subtask.",
      `Task: ${task.description}`,
      ...(task.constraints ?? []).map((c) => `Constraint: ${c}`),
      task.parentContext ? `Context from parent:\n${task.parentContext}` : "",
    ].join("\n");

    // 创建独立的 AgenticLoop（独立 context window）
    const loop = new AgenticLoop({
      // ... 配置省略，关键是独立的 session 和 context
      maxTurns: 5,  // sub-agent 限制更少的轮次
    });

    this.activeAgents.set(task.id, loop);

    try {
      const output = await loop.runOnce(task.prompt);
      return {
        taskId: task.id,
        success: true,
        output,
        filesModified: loop.getModifiedFiles(),
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        output: "",
        filesModified: [],
        error: (error as Error).message,
      };
    } finally {
      this.activeAgents.delete(task.id);
    }
  }

  /** 冲突检测 */
  private detectConflicts(tasks: SubAgentTask[]): void {
    // 检查是否有多个任务声明要修改同一个文件
    // 如果有，抛出错误或将它们序列化执行
    const fileTargets = new Map<string, string[]>();
    for (const task of tasks) {
      // 从 task.prompt 中解析可能修改的文件
      // 实际实现需要更精确的分析
    }
  }
}

/** 简单的信号量实现，用于并发控制 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}
```

#### Sub-agent 的三大核心约束

**1. 上下文隔离**

每个 sub-agent 有自己独立的 context window。为什么？因为如果共享父 agent 的完整上下文，每个 sub-agent 都会消耗大量 token（且多数信息对子任务无用），API 费用会爆炸式增长。

```
     ❌ 错误：共享上下文                ✅ 正确：隔离上下文

  ┌──────────────────┐            ┌──────────────────┐
  │   Parent (200K)  │            │  Parent (200K)   │
  │   ┌──────────┐   │            │                  │
  │   │ Sub-1    │   │            └────────┬─────────┘
  │   │ (200K)   │   │                     │ 只传递必要信息
  │   ├──────────┤   │              ┌──────┴──────┐
  │   │ Sub-2    │   │              ▼             ▼
  │   │ (200K)   │   │       ┌──────────┐  ┌──────────┐
  │   ├──────────┤   │       │ Sub-1    │  │ Sub-2    │
  │   │ Sub-3    │   │       │ (20K)    │  │ (20K)    │
  │   │ (200K)   │   │       └──────────┘  └──────────┘
  │   └──────────┘   │
  └──────────────────┘       总消耗: 240K tokens
  总消耗: 800K tokens         (节省 70%!)
```

**2. 文件锁与冲突检测**

两个 sub-agent 不能同时修改同一个文件——这和 Git 的merge conflict 是一个道理。解决方案：

- **预检测**：在分配任务前分析哪些文件可能被修改，有冲突的任务串行执行
- **乐观锁**：每个 sub-agent 在修改前记录文件 hash，修改后检查 hash 是否变化
- **最后汇总**：父 agent 检查所有 sub-agent 的修改是否有冲突，必要时人工仲裁

**3. 错误传播与降级**

Sub-agent 失败不应导致整个任务失败：

```typescript
// 错误处理策略
const results = await subAgentManager.executeParallel(tasks);

const succeeded = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);

if (failed.length > 0 && succeeded.length > 0) {
  // 部分成功：向用户报告成功的部分 + 失败的原因
  ui.showPartialSuccess(succeeded, failed);
} else if (failed.length === tasks.length) {
  // 全部失败：回退到串行模式
  ui.showWarning("并行执行全部失败，切换到串行模式重试");
  for (const task of tasks) {
    await subAgentManager.executeSingleSubAgent(task);
  }
}
```

**Sub-agent 与主 Agent 的关系总结**：

| 维度 | 主 Agent | Sub-agent |
|------|---------|-----------|
| **生命周期** | 持续整个会话 | 单个子任务完成即销毁 |
| **上下文** | 完整的项目上下文 + 对话历史 | 最小化上下文（只含子任务相关） |
| **工具权限** | 完整权限 | 可限制为子集（如只允许 READ） |
| **最大轮次** | 10-30 轮 | 3-5 轮 |
| **错误处理** | 向用户报告 | 向父 Agent 报告，由父 Agent 决策 |
| **并发** | 单线程 | 可多个同时运行（受限于 maxConcurrency） |
## 4. 客户端到网关的链路

> **生活类比**：想象你要给远方的朋友寄一封重要信件。你不会直接把信扔出窗外——你需要先找到邮局（DNS 解析）、验证身份（认证鉴权）、把信装进信封并密封（请求封装与加密）、然后交给邮递员（发送请求）。如果邮递员告诉你今天太忙了，你需要知道什么时候再来（限流与重试）。

Agent 客户端完成了 Agentic Loop 的一次迭代、准备好了 API 请求之后，下一步就是把请求安全、高效地送达到 API 网关。这段链路看似简单——"不就是发个 HTTP 请求吗？"——但在生产级 Agent 系统中，这段链路的每一个环节都可能成为性能瓶颈或故障点。

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端 → 网关链路全景                       │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │ DNS 解析  │ →  │ TLS 握手  │ →  │ 认证鉴权  │ →  │ 发送   │ │
│  │          │    │          │    │          │    │ 请求   │ │
│  └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│       ↑                                              │      │
│       │          ┌──────────────────────┐             │      │
│       └──────────│  断线重连 / 重试机制   │←────────────┘      │
│                  └──────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.1 HTTPS 连接管理

#### 为什么需要 HTTPS？

Agent 系统与 LLM 服务之间传输的数据包含：用户隐私信息、企业敏感数据、API 密钥等。如果这些数据在网络上以明文传输，就像在明信片上写银行密码一样危险。HTTPS（HTTP over TLS）为这条通信链路加了一层"密封信封"。

#### TLS 1.3 握手流程

TLS 1.3 相比 TLS 1.2 最大的改进是将握手从 2-RTT 减少到 1-RTT（甚至 0-RTT 恢复），这对 Agent 系统的响应延迟至关重要。

```
┌──────────────┐                              ┌──────────────┐
│  Agent 客户端 │                              │  API 网关     │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  ① ClientHello                              │
       │  - 支持的密码套件列表                          │
       │  - 客户端随机数                               │
       │  - 支持的密钥交换组 (x25519)                   │
       │  - 客户端密钥共享 (key_share)                  │
       │─────────────────────────────────────────────→│
       │                                             │
       │  ② ServerHello + EncryptedExtensions         │
       │  - 选定的密码套件 (AES-256-GCM)               │
       │  - 服务端密钥共享 (key_share)                  │
       │  - 服务端证书 (Certificate)                   │
       │  - 证书验证签名 (CertificateVerify)           │
       │  - 握手完成 (Finished)                        │
       │←─────────────────────────────────────────────│
       │                                             │
       │  ③ 客户端验证证书 + Finished                   │
       │─────────────────────────────────────────────→│
       │                                             │
       │  ✅ 加密通道建立（1-RTT）                      │
       │  ④ 开始发送加密的 HTTP 请求                    │
       │═════════════════════════════════════════════→│
       │                                             │
```

> **关键优化**：TLS 1.3 的 1-RTT 握手意味着只需要一个网络往返就能建立安全连接。对于 Agent 频繁调用 LLM 的场景，这比 TLS 1.2 的 2-RTT 节省了宝贵的延迟。

#### 连接池管理

每次 Agent 迭代都重新建立 TCP + TLS 连接是极大的浪费。生产环境必须使用连接池：

```python
import httpx
import asyncio
from typing import Optional


class ConnectionManager:
    """
    Agent 客户端连接池管理器
    
    类比：就像公司前台有多条电话线路，
    不需要每次打电话都重新申请一条新线路，
    而是从已有的线路池中取一条空闲的来用。
    """
    
    def __init__(
        self,
        base_url: str = "https://api.llm-provider.com",
        max_connections: int = 20,      # 最大连接数
        max_keepalive: int = 10,        # 保持活跃的连接数
        keepalive_expiry: float = 30.0, # 空闲连接超时（秒）
    ):
        # HTTP/2 多路复用：一条 TCP 连接上并行发送多个请求
        # 类比：一条高速公路上有多个车道，不同请求走不同车道
        self._client = httpx.AsyncClient(
            base_url=base_url,
            http2=True,  # 启用 HTTP/2 多路复用
            limits=httpx.Limits(
                max_connections=max_connections,
                max_keepalive_connections=max_keepalive,
                keepalive_expiry=keepalive_expiry,
            ),
            timeout=httpx.Timeout(
                connect=5.0,    # 连接超时
                read=120.0,     # 读取超时（流式响应需要较长时间）
                write=10.0,     # 写入超时
                pool=10.0,      # 等待连接池分配的超时
            ),
        )
    
    async def send_request(self, endpoint: str, payload: dict) -> httpx.Response:
        """发送请求，自动复用连接"""
        return await self._client.post(endpoint, json=payload)
    
    async def close(self):
        """优雅关闭所有连接"""
        await self._client.aclose()
```

#### DNS 解析链路

在建立连接之前，客户端需要将域名解析为 IP 地址：

```
DNS 解析链路（以 api.llm-provider.com 为例）：

┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 本地缓存  │ ──→ │ 递归解析器    │ ──→ │ .com 权威DNS  │ ──→ │ 目标权威DNS   │
│ (OS/App) │     │ (ISP/公共DNS) │     │              │     │              │
│          │     │              │     │              │     │              │
│ TTL内命中 │     │ 8.8.8.8 等   │     │ 返回 NS 记录  │     │ 返回 A 记录   │
│ → 直接返回│     │ 逐级查询      │     │              │     │ → IP 地址    │
└──────────┘     └──────────────┘     └──────────────┘     └──────────────┘

优化策略：
  ① 应用层 DNS 缓存（避免重复解析）
  ② DNS 预取（Agent 启动时预解析所有可能的 endpoint）
  ③ 使用 DNS-over-HTTPS 防止 DNS 劫持
```

---

### 4.2 认证鉴权链路

Agent 系统需要向 API 网关证明"我是谁"以及"我有权做什么"。常见的认证方式有三种：

#### 认证方式对比

| 维度 | API Key | JWT | OAuth2 |
|------|---------|-----|--------|
| **复杂度** | ⭐ 最简单 | ⭐⭐ 中等 | ⭐⭐⭐ 最复杂 |
| **适用场景** | 服务端调用、快速原型 | 用户级认证、多租户 | 第三方授权、企业集成 |
| **安全性** | 🟡 密钥泄露风险高 | 🟢 短时效 + 签名验证 | 🟢 最安全，权限粒度细 |
| **有效期** | 永久（直到轮换） | 分钟~小时级 | Access Token 短 + Refresh Token 长 |
| **吊销能力** | 需要服务端黑名单 | 过期自动失效 | 可随时吊销 |
| **典型厂商** | OpenAI、Anthropic | 企业内部 Agent 平台 | Google Cloud、Azure |

#### Token 刷新流程（长时间运行的 Agent 会话）

Agent 执行复杂任务时可能运行数小时。如果 JWT 在任务中间过期，会导致整个任务链中断。因此需要透明的 Token 刷新机制：

```
┌─────────────┐                    ┌──────────────┐
│ Agent Client │                    │  Auth Server  │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │  使用 access_token 调用 API        │
       │─────────────────────────────────→│
       │                                  │
       │  ✅ 200 OK（token 有效）           │
       │←─────────────────────────────────│
       │                                  │
       │  ... Agent 继续执行多轮迭代 ...     │
       │                                  │
       │  使用 access_token 调用 API        │
       │─────────────────────────────────→│
       │                                  │
       │  ❌ 401 Unauthorized（token 过期） │
       │←─────────────────────────────────│
       │                                  │
       │  自动使用 refresh_token 刷新       │
       │─────────────────────────────────→│
       │                                  │
       │  ✅ 新的 access_token + refresh    │
       │←─────────────────────────────────│
       │                                  │
       │  使用新 access_token 重试原请求     │
       │─────────────────────────────────→│
       │                                  │
       │  ✅ 200 OK                        │
       │←─────────────────────────────────│
```

#### 代码示例：AuthClient 认证客户端

```python
import time
import asyncio
import httpx
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TokenInfo:
    access_token: str
    refresh_token: str
    expires_at: float  # Unix 时间戳


class AuthClient:
    """
    认证客户端：自动管理 Token 生命周期
    
    类比：就像你的门禁卡——平时刷卡就能进门，
    卡过期了会自动去前台换一张新卡，
    整个过程对你来说是透明的。
    """
    
    def __init__(self, auth_url: str, client_id: str, client_secret: str):
        self._auth_url = auth_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: Optional[TokenInfo] = None
        self._lock = asyncio.Lock()
        self._refresh_buffer = 60  # 提前 60 秒刷新，避免边界过期
    
    async def get_access_token(self) -> str:
        """获取有效的 access_token，过期自动刷新"""
        async with self._lock:
            if self._token is None:
                await self._authenticate()
            elif self._is_expiring_soon():
                await self._refresh()
            return self._token.access_token
    
    def _is_expiring_soon(self) -> bool:
        return time.time() >= (self._token.expires_at - self._refresh_buffer)
    
    async def _authenticate(self):
        """首次认证：使用 client credentials 获取 token"""
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self._auth_url}/token", data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            })
            resp.raise_for_status()
            data = resp.json()
            self._token = TokenInfo(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", ""),
                expires_at=time.time() + data["expires_in"],
            )
    
    async def _refresh(self):
        """使用 refresh_token 刷新 access_token"""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(f"{self._auth_url}/token", data={
                    "grant_type": "refresh_token",
                    "refresh_token": self._token.refresh_token,
                    "client_id": self._client_id,
                })
                resp.raise_for_status()
                data = resp.json()
                self._token = TokenInfo(
                    access_token=data["access_token"],
                    refresh_token=data.get("refresh_token", self._token.refresh_token),
                    expires_at=time.time() + data["expires_in"],
                )
        except httpx.HTTPStatusError:
            # refresh_token 也过期了，重新完整认证
            await self._authenticate()
```

#### mTLS：服务间双向认证

在微服务架构中，Agent 网关与推理服务之间使用 mTLS（双向 TLS）：不仅客户端验证服务端证书，服务端也验证客户端证书，确保只有授权的服务才能相互通信。

```
普通 TLS（单向）：     客户端 验证 → 服务端证书   ✅
mTLS（双向）：         客户端 验证 → 服务端证书   ✅
                      服务端 验证 → 客户端证书   ✅

类比：普通 TLS 就像你去银行，你要验证这是真的银行（看营业执照）。
     mTLS 就像银行也要验证你是真正的客户（看你的身份证）。
```

---

### 4.3 请求封装与序列化

Agent 的一次 LLM 调用需要精心构造请求体。这不是简单地发送一段文本，而是一个结构化的指令包。

#### 请求体结构

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant..."},
    {"role": "user", "content": "帮我分析这份代码..."},
    {"role": "assistant", "content": "我来分析一下...", "tool_calls": [
      {"id": "call_abc", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\": \"main.py\"}"}}
    ]},
    {"role": "tool", "tool_call_id": "call_abc", "content": "def main():\n    ..."}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取指定路径的文件内容",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {"type": "string", "description": "文件路径"}
          },
          "required": ["path"]
        }
      }
    }
  ],
  "temperature": 0.1,
  "max_tokens": 4096,
  "stream": true
}
```

#### 序列化格式对比

| 维度 | JSON | Protocol Buffers |
|------|------|------------------|
| **可读性** | ✅ 人类可读 | ❌ 二进制格式 |
| **序列化速度** | 🟡 较慢 | ✅ 快 3-10 倍 |
| **payload 大小** | 🟡 较大（含字段名） | ✅ 小 30-50% |
| **Schema 验证** | 🟡 需额外工具 | ✅ 编译时检查 |
| **生态兼容** | ✅ 所有 LLM API 支持 | 🟡 需要自建网关 |
| **适用场景** | 直接调用公有 LLM API | 企业内部高吞吐量网关 |

> **实践建议**：对外调用公有 LLM API 用 JSON；企业内部 Agent 平台在网关到推理服务之间用 Protobuf，可显著降低序列化开销。

#### 请求压缩

当 Agent 上下文窗口很大（100K+ tokens）时，请求体可能达到数百 KB。启用压缩可以显著减少传输时间：

```
压缩效果对比（典型 Agent 请求体）：

原始大小   │ gzip 压缩  │ Brotli 压缩 │ 压缩率
──────────┼───────────┼────────────┼──────────
  50 KB   │   12 KB   │   10 KB    │ 75-80%
 200 KB   │   45 KB   │   38 KB    │ 77-81%
 500 KB   │  105 KB   │   88 KB    │ 79-82%

结论：文本内容压缩率高，大上下文场景收益明显
```

#### 代码示例：RequestBuilder

```python
import json
import gzip
from dataclasses import dataclass, field
from typing import Any


@dataclass
class LLMRequest:
    model: str
    messages: list[dict]
    tools: list[dict] = field(default_factory=list)
    temperature: float = 0.1
    max_tokens: int = 4096
    stream: bool = True


class RequestBuilder:
    """
    请求构建器：负责封装、压缩和序列化 LLM 请求
    
    类比：就像快递打包员——把物品（请求参数）装箱（序列化），
    如果箱子太大就压缩一下，最后贴上运单（HTTP headers）。
    """
    
    COMPRESSION_THRESHOLD = 10_000  # 超过 10KB 才压缩
    
    def build(self, request: LLMRequest) -> tuple[bytes, dict[str, str]]:
        """
        构建 HTTP 请求体和 headers
        Returns: (body_bytes, headers_dict)
        """
        payload = {
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream,
        }
        if request.tools:
            payload["tools"] = request.tools
        
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        
        # 大请求自动压缩
        if len(body) > self.COMPRESSION_THRESHOLD:
            body = gzip.compress(body, compresslevel=6)
            headers["Content-Encoding"] = "gzip"
        
        return body, headers
    
    @staticmethod
    def estimate_tokens(messages: list[dict]) -> int:
        """粗略估算 token 数（用于客户端预检）"""
        text = "".join(m.get("content", "") or "" for m in messages)
        # 粗略估算：英文 ~4 chars/token，中文 ~2 chars/token
        return len(text) // 3
```

---

### 4.4 客户端限流与断线重连

在生产环境中，网络不是永远可靠的，API 也有速率限制。Agent 客户端必须优雅地处理这些情况。

#### 客户端令牌桶限流

> **类比**：想象一个水龙头（API），水桶里有固定数量的水滴（令牌）。每次请求消耗一个水滴，水龙头以固定速率往桶里滴水。如果桶空了，你就必须等待。

```python
import asyncio
import time


class ClientThrottler:
    """
    客户端令牌桶限流器
    在客户端主动限流，避免被服务端 429 拒绝
    """
    
    def __init__(self, rate: float = 10.0, burst: int = 20):
        """
        Args:
            rate: 每秒补充的令牌数（对应 API 的 RPM/60）
            burst: 桶的最大容量（允许的突发请求数）
        """
        self._rate = rate
        self._burst = burst
        self._tokens = float(burst)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """获取一个令牌，如果桶空则等待"""
        async with self._lock:
            self._refill()
            if self._tokens < 1.0:
                wait_time = (1.0 - self._tokens) / self._rate
                await asyncio.sleep(wait_time)
                self._refill()
            self._tokens -= 1.0
    
    def _refill(self):
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self._burst, self._tokens + elapsed * self._rate)
        self._last_refill = now
```

#### 指数退避重试

当请求失败时，不能立即疯狂重试（这会加剧服务端压力），而应该使用指数退避：

```
指数退避示意：

第 1 次重试：等待 1 秒    ▊
第 2 次重试：等待 2 秒    ▊▊
第 3 次重试：等待 4 秒    ▊▊▊▊
第 4 次重试：等待 8 秒    ▊▊▊▊▊▊▊▊
第 5 次重试：等待 16 秒   ▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊
     (加上随机抖动 jitter，避免多个客户端同时重试"惊群"效应)
```

```python
import asyncio
import random
import httpx
from typing import Optional


async def retry_with_backoff(
    request_fn,
    max_retries: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
) -> httpx.Response:
    """
    带指数退避的重试机制
    
    类比：像排队买奶茶——第一次被告知"请稍等"你 1 分钟后回来，
    还是没好就 2 分钟后再来，然后 4 分钟... 越等越久但总会买到。
    """
    last_error: Optional[Exception] = None
    
    for attempt in range(max_retries + 1):
        try:
            response = await request_fn()
            
            if response.status_code == 429:
                # 服务端限流，读取 Retry-After 头
                retry_after = float(response.headers.get("Retry-After", 0))
                delay = max(retry_after, base_delay * (2 ** attempt))
            elif response.status_code >= 500:
                # 服务端错误，使用指数退避
                delay = base_delay * (2 ** attempt)
            else:
                return response  # 成功或客户端错误，直接返回
            
        except (httpx.ConnectError, httpx.ReadTimeout) as e:
            last_error = e
            delay = base_delay * (2 ** attempt)
        
        # 添加随机抖动（±25%），防止惊群效应
        delay = min(delay, max_delay)
        jitter = delay * 0.25 * (2 * random.random() - 1)
        await asyncio.sleep(delay + jitter)
    
    raise ConnectionError(f"重试 {max_retries} 次后仍然失败: {last_error}")
```

#### 会话状态持久化与断线恢复

Agent 在长时间运行过程中断线后，需要能恢复到断线前的状态，而不是从头开始：

```
断线恢复策略：

┌───────────────────────────────────────────────────┐
│  持久化检查点（每轮迭代后保存）                        │
│                                                   │
│  checkpoint = {                                   │
│    "session_id": "sess_abc123",                   │
│    "iteration": 7,                                │
│    "messages": [...前 7 轮的消息历史...],             │
│    "pending_tool_calls": [...],                    │
│    "partial_response": "已接收的部分流式响应...",      │
│    "timestamp": "2025-01-15T10:30:00Z"            │
│  }                                                │
│                                                   │
│  恢复流程：                                         │
│  1. 检测到连接断开                                   │
│  2. 加载最近的 checkpoint                           │
│  3. 重新建立连接                                    │
│  4. 从上次中断的迭代点继续执行                         │
│  5. 如果有 partial_response，丢弃并重新请求该轮       │
└───────────────────────────────────────────────────┘
```

---

## 5. API 网关层

> 📖 **深入学习**：本节为全链路视角概述，详细原理与实践请参阅 [高性能API网关内核设计](./09-高性能API网关内核设计.md) 和 [AI网关与流量治理](./10-AI网关与流量治理.md)

> **生活类比**：API 网关就像机场安检口——每个旅客（请求）都必须经过身份验证（登机牌）、安全检查（内容审核）、行李扫描（请求校验），然后被引导到正确的登机口（路由到后端服务）。它还控制着每小时能通过的旅客数量（限流），并记录每个旅客的通行信息（可观测性）。

API 网关是 Agent 全链路中的"咽喉要道"——所有请求必须经过这里。它承担着认证、路由、限流、可观测性等关键职责。

```
┌─────────────────────────────────────────────────────────┐
│                    API 网关层全景                         │
│                                                         │
│  Request                                                │
│    │                                                    │
│    ▼                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ 认证鉴权  │→ │ 流量控制  │→ │ 请求预处理 │→ │ 路由分发 │  │
│  │ Auth     │  │ Rate     │  │ Pre-     │  │ Route  │  │
│  │ Gateway  │  │ Limiter  │  │ Process  │  │ Match  │  │
│  └──────────┘  └──────────┘  └──────────┘  └────┬───┘  │
│       │              │             │             │      │
│       ▼              ▼             ▼             ▼      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              可观测性（贯穿所有环节）                │    │
│  │    Tracing │ Metrics │ Logging │ Alerting       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                    │    │
│                                              ┌─────▼──┐ │
│                                              │ 后端   │ │
│                                              │ 推理层 │ │
│                                              └────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

### 5.1 网关在全链路中的角色

网关不只是一个"转发器"，它是整个系统的策略执行点。在 Agent 全链路中，网关承担以下核心职责：

| 职责 | 说明 | 类比 |
|------|------|------|
| **身份验证** | 验证请求来源合法性 | 安检验登机牌 |
| **流量控制** | 保护后端不被过载 | 控制高速公路入口流量 |
| **请求路由** | 将请求导向正确的后端服务 | 机场指引牌指向登机口 |
| **协议转换** | HTTP ↔ gRPC 转换 | 翻译官 |
| **请求预处理** | 校验、转换、增强请求 | 安检行李扫描 |
| **可观测性** | 记录所有请求的生命周期 | 监控摄像头 |

#### 请求经过网关的完整流程

```
请求生命周期（每个阶段都可能拒绝请求）：

  Request ───→ [SSL Termination]
                     │
                     ▼
              [认证] ─── 失败 → 401 Unauthorized
                     │
                     ▼
              [限流] ─── 超限 → 429 Too Many Requests
                     │
                     ▼
              [预处理] ── 校验失败 → 400 Bad Request
                     │
                     ▼
              [路由] ─── 未匹配 → 404 Not Found
                     │
                     ▼
              [转发到后端推理服务]
                     │
                     ▼
              [响应后处理 + 返回]
```

---

### 5.2 请求路由

请求路由决定了每个请求应该被发送到哪个后端服务。在 Agent 推理场景中，路由逻辑比普通 Web 应用复杂得多。

#### 路由策略详解

**① 路径路由（Path-based）**
```
/v1/chat/completions  → inference-service-chat
/v1/embeddings        → inference-service-embedding
/v1/images/generate   → inference-service-image
```

**② Header 路由（Header-based）**
```
X-Model-ID: gpt-4o      → gpu-cluster-a100
X-Model-ID: gpt-4o-mini → gpu-cluster-l40s
X-Model-ID: o1           → gpu-cluster-h100
```

**③ 租户路由（Tenant-based）**
```
tier: enterprise  → dedicated GPU pool（独占资源，低延迟）
tier: pro         → shared GPU pool（共享资源，中等延迟）
tier: free        → spot GPU pool（抢占式资源，高延迟）
```

**④ 金丝雀路由（Canary routing）**

```
                    ┌──────────────┐
                95% │  Model v2.0  │  ← 稳定版本
  Request ──→ ─────┤  (Production)│
                    └──────────────┘
                5%  ┌──────────────┐
               ─────│  Model v2.1  │  ← 新版本（灰度测试）
                    │  (Canary)    │
                    └──────────────┘
```

#### 代码示例：RequestRouter

```typescript
// request-router.ts
// 请求路由器：基于多维策略将请求路由到正确的后端

interface RouteRule {
  name: string;
  match: (req: IncomingRequest) => boolean;
  backend: string;
  weight?: number; // 用于金丝雀路由的权重（0-100）
}

interface IncomingRequest {
  path: string;
  headers: Record<string, string>;
  tenantTier: "enterprise" | "pro" | "free";
  modelId: string;
}

interface BackendTarget {
  name: string;
  url: string;
  healthy: boolean;
}

class RequestRouter {
  private rules: RouteRule[] = [];
  private backends: Map<string, BackendTarget[]> = new Map();

  addRule(rule: RouteRule): void {
    this.rules.push(rule);
  }

  registerBackend(name: string, targets: BackendTarget[]): void {
    this.backends.set(name, targets);
  }

  /**
   * 路由请求到后端
   * 按规则优先级匹配，支持金丝雀分流
   */
  route(req: IncomingRequest): BackendTarget {
    for (const rule of this.rules) {
      if (!rule.match(req)) continue;

      // 金丝雀路由：按权重概率决定是否使用新版本
      if (rule.weight !== undefined && rule.weight < 100) {
        const roll = Math.random() * 100;
        if (roll >= rule.weight) continue; // 未命中金丝雀，尝试下一条规则
      }

      const targets = this.backends.get(rule.backend);
      if (!targets?.length) continue;

      // 在健康的后端中进行加权轮询
      const healthy = targets.filter((t) => t.healthy);
      if (healthy.length === 0) continue;

      return healthy[Math.floor(Math.random() * healthy.length)];
    }

    throw new Error(`No route matched for: ${req.path}`);
  }
}

// 使用示例
const router = new RequestRouter();

// 规则 1：金丝雀路由（5% 流量到新模型版本）
router.addRule({
  name: "canary-v2.1",
  match: (req) => req.path === "/v1/chat/completions",
  backend: "inference-canary",
  weight: 5,
});

// 规则 2：企业用户走专用集群
router.addRule({
  name: "enterprise-dedicated",
  match: (req) => req.tenantTier === "enterprise",
  backend: "inference-dedicated",
});

// 规则 3：默认路由
router.addRule({
  name: "default",
  match: (req) => req.path.startsWith("/v1/"),
  backend: "inference-shared",
});
```

---

### 5.3 流量控制

流量控制是网关最核心的保护机制之一。没有流量控制，一个失控的 Agent（如无限循环调用 LLM）就能拖垮整个推理集群。

#### 令牌桶算法

> **类比**：想象一个固定容量的水桶，每秒有固定数量的水滴落入桶中。每个请求需要从桶中取走一滴水。如果桶空了，请求就必须等待。桶的容量决定了突发流量的上限。

```
令牌桶工作原理：

  令牌以固定速率 r 补充              桶容量 = B（最大突发量）
        │                          ┌─────────┐
        ▼                          │ ● ● ● ● │ ← 桶中有令牌
  ● ──→ ┌──────────────────────────│ ● ● ●   │
        │         令牌桶            │ ● ●     │
        └──────────────────────────│ ●       │
                                   └────┬────┘
                                        │
                                   每个请求消耗
                                   一个令牌
                                        │
                                        ▼
                          ┌─────────────────────────┐
                          │  桶中有令牌 → 放行请求    │
                          │  桶空       → 拒绝 (429) │
                          └─────────────────────────┘
```

#### 代码示例：RateLimiter（基于 Redis 的分布式限流器）

```python
import time
import redis.asyncio as redis
from dataclasses import dataclass
from enum import Enum


class RateLimitResult(Enum):
    ALLOWED = "allowed"
    THROTTLED = "throttled"


@dataclass
class RateLimitInfo:
    result: RateLimitResult
    remaining: int       # 剩余令牌数
    reset_at: float      # 下次重置时间
    retry_after: float   # 建议重试等待时间（秒）


class DistributedRateLimiter:
    """
    基于 Redis 的分布式滑动窗口限流器
    
    类比：全国各地的 Agent 客户端都在调用同一个 API，
    就像多个城市的人同时去抢同一场演唱会的票。
    需要一个全局计数器（Redis）来确保总票数不超卖。
    """
    
    # Lua 脚本保证原子性——在 Redis 服务端一次性执行
    SLIDING_WINDOW_SCRIPT = """
    local key = KEYS[1]
    local window_size = tonumber(ARGV[1])
    local max_requests = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local window_start = now - window_size
    
    -- 移除窗口之外的旧记录
    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
    
    -- 计算当前窗口内的请求数
    local current_count = redis.call('ZCARD', key)
    
    if current_count < max_requests then
        -- 未超限：添加当前请求并放行
        redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
        redis.call('EXPIRE', key, window_size + 1)
        return {1, max_requests - current_count - 1}
    else
        -- 超限：返回最早记录的时间（用于计算 retry_after）
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local oldest_time = tonumber(oldest[2] or now)
        return {0, oldest_time}
    end
    """
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self._redis = redis.from_url(redis_url)
        self._script_sha: str | None = None
    
    async def _ensure_script(self):
        if self._script_sha is None:
            self._script_sha = await self._redis.script_load(
                self.SLIDING_WINDOW_SCRIPT
            )
    
    async def check_rate_limit(
        self,
        user_id: str,
        max_requests: int = 60,      # 窗口内最大请求数
        window_seconds: int = 60,     # 窗口大小（秒）
    ) -> RateLimitInfo:
        """
        检查用户是否超过速率限制
        
        Args:
            user_id: 用户标识（也可以是 API Key、租户 ID 等）
            max_requests: 窗口期内允许的最大请求数
            window_seconds: 滑动窗口的时间范围
        """
        await self._ensure_script()
        
        key = f"rate_limit:{user_id}"
        now = time.time()
        
        result = await self._redis.evalsha(
            self._script_sha,
            1,                  # key 数量
            key,                # KEYS[1]
            window_seconds,     # ARGV[1]
            max_requests,       # ARGV[2]
            now,                # ARGV[3]
        )
        
        allowed = bool(result[0])
        
        if allowed:
            return RateLimitInfo(
                result=RateLimitResult.ALLOWED,
                remaining=int(result[1]),
                reset_at=now + window_seconds,
                retry_after=0,
            )
        else:
            oldest_time = float(result[1])
            retry_after = oldest_time + window_seconds - now
            return RateLimitInfo(
                result=RateLimitResult.THROTTLED,
                remaining=0,
                reset_at=oldest_time + window_seconds,
                retry_after=max(0, retry_after),
            )
    
    async def close(self):
        await self._redis.close()


# 网关中间件集成示例
async def rate_limit_middleware(request, rate_limiter: DistributedRateLimiter):
    """网关限流中间件"""
    user_id = request.headers.get("X-User-ID", "anonymous")
    
    # 根据用户等级设置不同限额
    tier = request.headers.get("X-Tier", "free")
    limits = {
        "enterprise": (1000, 60),  # 1000 次/分钟
        "pro":        (200, 60),   # 200 次/分钟
        "free":       (20, 60),    # 20 次/分钟
    }
    max_req, window = limits.get(tier, (20, 60))
    
    info = await rate_limiter.check_rate_limit(user_id, max_req, window)
    
    if info.result == RateLimitResult.THROTTLED:
        return {
            "status": 429,
            "headers": {
                "Retry-After": str(int(info.retry_after)),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(info.reset_at)),
            },
            "body": {"error": "Rate limit exceeded. Try again later."},
        }
    
    # 放行并附加限流信息到响应 headers
    return None  # 继续处理请求
```

---

### 5.4 可观测性

在分布式 Agent 系统中，一个请求可能跨越十几个服务。如果出了问题，没有可观测性就像在黑暗中找针。

> **类比**：可观测性的三大支柱就像医院诊断病人的三种手段——体温记录（Metrics 指标）、病历日志（Logs 日志）、CT 扫描（Traces 链路追踪）。三者结合才能精准定位"病因"。

#### 可观测性三大支柱

```
┌──────────────────────────────────────────────────────┐
│                  可观测性三大支柱                       │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │  Metrics   │  │   Logs     │  │   Traces       │  │
│  │  指标      │  │   日志     │  │   链路追踪      │  │
│  │            │  │            │  │                │  │
│  │ • 延迟 P99 │  │ • 结构化   │  │ • 请求在各服务 │  │
│  │ • 错误率   │  │ • 可搜索   │  │   间的完整轨迹 │  │
│  │ • 吞吐量   │  │ • 按级别   │  │ • 瀑布图展示   │  │
│  │ • GPU利用率│  │   过滤     │  │ • 耗时定位     │  │
│  └────────────┘  └────────────┘  └────────────────┘  │
│        ▲               ▲               ▲             │
│        └───────────────┴───────────────┘             │
│                OpenTelemetry SDK                     │
└──────────────────────────────────────────────────────┘
```

#### 关键指标

| 指标 | 含义 | 告警阈值（参考） |
|------|------|----------------|
| `request_latency_p50` | 50% 的请求在此时间内完成 | < 500ms |
| `request_latency_p95` | 95% 的请求在此时间内完成 | < 2s |
| `request_latency_p99` | 99% 的请求在此时间内完成 | < 5s |
| `error_rate` | 错误请求占总请求的比例 | < 1% |
| `tokens_per_second` | 每秒生成的 token 数 | 监控趋势 |
| `active_connections` | 当前活跃连接数 | < 连接池上限的 80% |
| `queue_depth` | 排队等待的请求数 | < 100 |

#### 代码示例：TracingMiddleware

```python
import time
import uuid
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from contextvars import ContextVar

# 使用 ContextVar 在异步上下文中传播 trace_id
current_trace_id: ContextVar[str] = ContextVar("trace_id", default="")
current_span_id: ContextVar[str] = ContextVar("span_id", default="")


@dataclass
class Span:
    """一次操作的追踪记录"""
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    operation: str
    start_time: float
    end_time: float = 0
    attributes: dict[str, Any] = field(default_factory=dict)
    status: str = "OK"


class TracingMiddleware:
    """
    分布式追踪中间件
    
    为每个请求创建 trace，记录它在网关各阶段的耗时，
    并将 trace_id 传播给下游服务。
    """
    
    def __init__(self, service_name: str = "api-gateway"):
        self._service_name = service_name
        self._logger = logging.getLogger(service_name)
    
    async def handle_request(self, request: dict, next_handler) -> dict:
        """网关请求处理中间件"""
        # 提取或生成 trace_id（支持上游传播）
        trace_id = request.get("headers", {}).get(
            "X-Trace-ID", uuid.uuid4().hex[:16]
        )
        span_id = uuid.uuid4().hex[:8]
        
        current_trace_id.set(trace_id)
        current_span_id.set(span_id)
        
        span = Span(
            trace_id=trace_id,
            span_id=span_id,
            parent_span_id=request.get("headers", {}).get("X-Parent-Span-ID"),
            operation="gateway.handle_request",
            start_time=time.time(),
            attributes={
                "http.method": "POST",
                "http.path": request.get("path", ""),
                "user.id": request.get("headers", {}).get("X-User-ID", ""),
                "model": request.get("body", {}).get("model", ""),
                "service": self._service_name,
            },
        )
        
        try:
            # 调用下游处理器
            response = await next_handler(request)
            span.status = "OK"
            span.attributes["http.status_code"] = response.get("status", 200)
            return response
        except Exception as e:
            span.status = "ERROR"
            span.attributes["error.message"] = str(e)
            raise
        finally:
            span.end_time = time.time()
            latency_ms = (span.end_time - span.start_time) * 1000
            span.attributes["duration_ms"] = round(latency_ms, 2)
            
            # 结构化日志输出
            self._logger.info(
                "request_completed",
                extra={
                    "trace_id": span.trace_id,
                    "span_id": span.span_id,
                    "operation": span.operation,
                    "duration_ms": span.attributes["duration_ms"],
                    "status": span.status,
                    "model": span.attributes.get("model"),
                    "user_id": span.attributes.get("user.id"),
                },
            )
```

---

### 5.5 请求预处理

在请求被路由到推理服务之前，网关需要对请求进行一系列预处理，确保请求的合法性和完整性。

#### 输入校验

```python
from dataclasses import dataclass


@dataclass
class ValidationResult:
    valid: bool
    error: str = ""


def validate_request(payload: dict) -> ValidationResult:
    """
    请求校验——在请求到达推理服务之前拦截非法请求
    
    类比：就像餐厅前台先看一眼订单——
    没写菜名？退回。点了 100 道菜？不合理，退回。
    """
    # 必填字段检查
    if "model" not in payload:
        return ValidationResult(False, "Missing required field: model")
    if "messages" not in payload or not payload["messages"]:
        return ValidationResult(False, "Missing or empty: messages")
    
    # 消息格式验证
    valid_roles = {"system", "user", "assistant", "tool"}
    for i, msg in enumerate(payload["messages"]):
        if msg.get("role") not in valid_roles:
            return ValidationResult(False, f"Invalid role in messages[{i}]")
        if "content" not in msg and "tool_calls" not in msg:
            return ValidationResult(False, f"messages[{i}] has no content")
    
    # Token 数预估检查（避免明显超限的请求浪费推理资源）
    estimated_tokens = sum(
        len(m.get("content", "") or "") // 3
        for m in payload["messages"]
    )
    max_context = 128_000  # 模型最大上下文窗口
    if estimated_tokens > max_context:
        return ValidationResult(
            False,
            f"Estimated tokens ({estimated_tokens}) exceeds model limit ({max_context})"
        )
    
    return ValidationResult(True)
```

#### 请求增强

网关还可以在转发前对请求进行增强——注入系统提示、添加安全策略、补充上下文：

```
请求增强流程：

  原始请求                          增强后的请求
  ┌─────────────────┐              ┌─────────────────────────┐
  │ messages: [     │              │ messages: [             │
  │   {user: "..."}│    增强 →     │   {system: "安全策略..."} │  ← 注入
  │ ]               │              │   {system: "租户配置..."} │  ← 注入
  │                 │              │   {user: "..."}         │
  │ model: "gpt-4o" │              │ ]                       │
  │                 │              │ model: "gpt-4o"         │
  └─────────────────┘              │ _internal: {            │  ← 内部元数据
                                   │   tenant_id: "...",     │
                                   │   priority: "high",     │
                                   │   trace_id: "..."       │
                                   │ }                       │
                                   └─────────────────────────┘
```

---

## 6. 推理服务层

> 📖 **深入学习**：本节为全链路视角概述，详细原理与实践请参阅 [LLM推理服务工程](./01-LLM推理服务工程.md) 和 [Prompt Cache工程与路由优化](./12-Prompt-Cache工程与路由优化.md)

> **生活类比**：推理服务层就像一座智能工厂。原材料（用户请求）进入流水线，经过一系列加工工序（模型前向计算），最终产出成品（模型输出的 tokens）。工厂的核心挑战是——如何让昂贵的机器（GPU）一刻不停地运转，而不是傻傻地等某一批货做完了再开工下一批。

这一层是 Agent 全链路中技术密度最高的部分。它直接决定了系统的吞吐量、延迟和成本。

```
┌───────────────────────────────────────────────────────────┐
│                   推理服务层架构概览                         │
│                                                           │
│  ┌─────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │ 请求队列 │ → │ 批调度器      │ → │ GPU Worker 集群      │ │
│  │ Request │   │ Batch        │   │                     │ │
│  │ Queue   │   │ Scheduler    │   │ ┌─────┐  ┌─────┐   │ │
│  │         │   │              │   │ │GPU 0│  │GPU 1│   │ │
│  │ 优先级  │   │ Continuous   │   │ ├─────┤  ├─────┤   │ │
│  │ 排序    │   │ Batching     │   │ │GPU 2│  │GPU 3│   │ │
│  └─────────┘   └──────────────┘   │ └─────┘  └─────┘   │ │
│       ↑                           └──────────┬──────────┘ │
│       │                                      │            │
│       │              ┌───────────┐            │            │
│       └──────────────│ 输出缓冲区 │←───────────┘            │
│                      │ Output    │                        │
│                      │ Buffer    │ → SSE 流式返回           │
│                      └───────────┘                        │
└───────────────────────────────────────────────────────────┘
```

---

### 6.1 模型服务器架构

现代 LLM 推理服务器（如 vLLM、TGI、TensorRT-LLM）的核心目标只有一个：**最大化 GPU 利用率**。这意味着 GPU 的每一个计算周期都应该在做有用的工作，而不是在等待或空转。

#### 核心组件

```
模型服务器内部架构：

  HTTP/gRPC Server
       │
       ▼
  ┌──────────────┐     新请求不断到达
  │  请求接收器   │ ←────────────────
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐     按优先级排列
  │  优先队列     │     企业用户 > 普通用户 > 免费用户
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐     核心调度逻辑
  │  批调度器     │     决定哪些请求可以放进同一个 batch
  │  (Scheduler) │     以及何时执行 prefill vs decode
  └──────┬───────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Prefill│ │Decode │    两种不同的计算模式
│Worker │ │Worker │    prefill: 处理输入，填充 KV cache
└───┬───┘ └───┬───┘    decode:  逐 token 生成输出
    │         │
    ▼         ▼
┌──────────────────┐
│   KV Cache 管理   │   GPU 显存中最大的消耗者
│   (PagedAttention)│
└──────────────────┘
```

---

### 6.2 Continuous Batching（连续批处理）

#### 为什么静态批处理浪费 GPU？

传统的静态批处理方式是：收集一批请求，一起处理，等所有请求都完成后再处理下一批。问题在于：不同请求的输出长度差异巨大。

```
静态批处理的浪费：

请求 A: "翻译这个词"      → 输出 3 tokens    ████░░░░░░░░░░░░  早就完了，GPU 在空等
请求 B: "写一首诗"         → 输出 50 tokens   ████████████████  正在生成
请求 C: "总结一下"         → 输出 20 tokens   ██████████░░░░░░  完了，GPU 在空等

  问题：整个 batch 必须等最慢的请求 B 完成后才能接受新请求
  结果：请求 A 和 C 完成后，它们占用的 GPU 资源在空转
  浪费率：可达 50-70%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

连续批处理的改进：

时间步 1:  [A, B, C] 一起 decode
时间步 2:  [A, B, C] — A 完成 → 移除 A，插入新请求 D → [D_prefill, B, C]
时间步 3:  [D, B, C] 一起 decode
时间步 4:  [D, B, C] — C 完成 → 移除 C，插入新请求 E → [D, B, E_prefill]
...

  优势：GPU 永远在做有用的工作，不存在"等待最慢请求"的问题
  提升：吞吐量提升 2-10 倍
```

> **类比**：静态批处理就像餐厅等一桌客人全部吃完才翻台；连续批处理就像有人吃完立即翻台安排新客人坐下——餐厅（GPU）永远满座。

#### 代码示例：BatchScheduler 核心概念

```python
from dataclasses import dataclass, field
from typing import Optional
import heapq
import time


@dataclass(order=True)
class InferenceRequest:
    """推理请求"""
    priority: int                             # 优先级（数字越小越优先）
    request_id: str = field(compare=False)
    tokens_in: list[int] = field(compare=False, default_factory=list)
    tokens_out: list[int] = field(compare=False, default_factory=list)
    max_new_tokens: int = field(compare=False, default=512)
    state: str = field(compare=False, default="waiting")  # waiting → prefill → decoding → done
    arrival_time: float = field(compare=False, default_factory=time.time)


class BatchScheduler:
    """
    连续批处理调度器（概念实现）
    
    核心思想：每个 decode 步骤后检查是否有请求完成，
    如果有，立刻将等待队列中的新请求填补进来。
    
    类比：就像机场的候补旅客名单——
    有人取消航班（请求完成），候补旅客立刻补位（新请求加入 batch）。
    """
    
    def __init__(self, max_batch_size: int = 32, max_total_tokens: int = 16384):
        self.max_batch_size = max_batch_size
        self.max_total_tokens = max_total_tokens  # batch 内总 token 上限
        self.waiting_queue: list[InferenceRequest] = []  # 最小堆（优先队列）
        self.active_batch: list[InferenceRequest] = []
    
    def add_request(self, request: InferenceRequest):
        """新请求入队"""
        heapq.heappush(self.waiting_queue, request)
    
    def schedule_step(self) -> list[InferenceRequest]:
        """
        每个推理步骤前调用：
        1. 移除已完成的请求
        2. 用等待队列中的请求填充空位
        3. 返回本步骤要执行的 batch
        """
        # 移除已完成的请求（输出达到 max 或遇到 EOS token）
        self.active_batch = [
            req for req in self.active_batch
            if req.state != "done"
        ]
        
        # 计算当前 batch 的总 token 数
        current_tokens = sum(
            len(req.tokens_in) + len(req.tokens_out)
            for req in self.active_batch
        )
        
        # 从等待队列填充空位
        while (
            self.waiting_queue
            and len(self.active_batch) < self.max_batch_size
        ):
            candidate = self.waiting_queue[0]
            candidate_tokens = len(candidate.tokens_in) + candidate.max_new_tokens
            
            if current_tokens + candidate_tokens > self.max_total_tokens:
                break  # 显存不够，不再添加
            
            request = heapq.heappop(self.waiting_queue)
            request.state = "prefill"
            self.active_batch.append(request)
            current_tokens += candidate_tokens
        
        return self.active_batch
    
    def mark_completed(self, request_id: str):
        """标记请求为已完成"""
        for req in self.active_batch:
            if req.request_id == request_id:
                req.state = "done"
                break
```

---

### 6.3 KV Cache 管理

#### 什么是 KV Cache？

在 Transformer 的自注意力机制中，每一层都会计算 Key 和 Value 矩阵。为了避免重复计算，推理引擎会将已计算的 KV 张量缓存在 GPU 显存中。这就是 KV Cache。

```
KV Cache 原理：

  输入: "今天天气"（4 个 token）
  
  没有 KV Cache 时：
    生成第 5 个 token → 重新计算 token 1,2,3,4 的 KV → 再算 token 5
    生成第 6 个 token → 重新计算 token 1,2,3,4,5 的 KV → 再算 token 6
    → 大量重复计算！
  
  有 KV Cache 时：
    生成第 5 个 token → 从缓存读取 token 1,2,3,4 的 KV → 只算 token 5 的 KV
    生成第 6 个 token → 从缓存读取 token 1-5 的 KV → 只算 token 6 的 KV
    → 避免重复计算，decode 阶段每步只需计算一个 token 的 KV

  代价：KV Cache 占用大量 GPU 显存
```

#### 显存占用计算

```
KV Cache 显存公式：

  显存 = layers × heads × head_dim × 2(K和V) × num_tokens × dtype_size

  以 LLaMA-70B (FP16) 为例：
  - layers = 80
  - heads = 64 (GQA 中 KV heads = 8)
  - head_dim = 128
  - dtype_size = 2 bytes (FP16)
  - num_tokens = 4096 (单个请求的上下文长度)

  单个请求的 KV Cache：
  = 80 × 8 × 128 × 2 × 4096 × 2
  = 80 × 8 × 128 × 2 × 4096 × 2
  = 1,073,741,824 bytes
  ≈ 1 GB

  如果同时处理 32 个请求：32 GB 仅用于 KV Cache！
  而 A100 80GB 的总显存中，模型权重已占 ~35GB (FP16) 或 ~70GB (FP32)

  → KV Cache 是 GPU 显存的最大消费者之一
```

#### PagedAttention：虚拟内存式的 KV Cache 管理

> **类比**：传统 KV Cache 管理就像给每个进程（请求）分配一整块连续内存——浪费严重。PagedAttention 借鉴了操作系统的虚拟内存分页机制，将 KV Cache 分成固定大小的"页"，按需分配、动态回收。

```
传统方式 vs PagedAttention：

传统（连续分配）：
  请求 A: [████████████░░░░░░░░]  预分配了 max_len，实际只用了一半
  请求 B: [██████░░░░░░░░░░░░░░]  浪费更多
  请求 C: [等待中... 显存不足]     无法调度
  → 显存碎片化 + 浪费 60-80%

PagedAttention（分页分配）：
  物理页表: [A₁][B₁][A₂][B₂][A₃][C₁][B₃][C₂]...
  
  请求 A 的逻辑视图: [A₁][A₂][A₃]         ← 3 页（按需分配）
  请求 B 的逻辑视图: [B₁][B₂][B₃]         ← 3 页
  请求 C 的逻辑视图: [C₁][C₂]             ← 2 页（新请求成功分配！）
  
  → 无碎片、按需分配、内存利用率接近 100%

类比：
  传统 = 酒店给每个客人预留 10 间房，哪怕只住 2 间
  Paged = 酒店按需分配房间，客人需要时再给，退房后立即回收
```

---

### 6.4 Prefill-Decode 分离（PD Disaggregation）

#### 为什么要分离？

LLM 推理有两个截然不同的阶段，它们对硬件资源的需求完全相反：

```
Prefill 阶段 vs Decode 阶段：

┌────────────────────────┬──────────────────────────┐
│      Prefill 阶段       │       Decode 阶段         │
├────────────────────────┼──────────────────────────┤
│ 处理：整个输入序列       │ 处理：每次只生成 1 个 token│
│ 计算量：巨大（矩阵乘法） │ 计算量：小（单 token 计算） │
│ 瓶颈：算力（Compute）    │ 瓶颈：显存带宽（Memory BW）│
│ GPU 利用率：高           │ GPU 利用率：低             │
│ 适合：高算力 GPU (H100) │ 适合：高带宽 GPU (多卡)    │
│ 耗时：几十~几百毫秒      │ 耗时：每 token 几十毫秒    │
│                        │ 总耗时 = token数 × 单步耗时│
└────────────────────────┴──────────────────────────┘

问题：如果 Prefill 和 Decode 跑在同一个 GPU 上——
  - Prefill 的大量计算会阻塞 Decode 的逐 token 输出 → 增加延迟
  - Decode 的低计算密度让 GPU 大部分时间在空转 → 浪费算力
```

#### PD 分离架构

```
PD 分离架构：

  用户请求
     │
     ▼
┌───────────────────────────────────────────────────────────┐
│                     调度层 (Scheduler)                      │
│  根据请求阶段分发到不同的 GPU 池                               │
└───────────┬─────────────────────────────────┬─────────────┘
            │                                 │
            ▼                                 ▼
┌────────────────────┐              ┌────────────────────┐
│   Prefill Workers   │              │   Decode Workers    │
│                    │              │                    │
│  ┌──────┐ ┌──────┐│   KV Cache   │ ┌──────┐ ┌──────┐ │
│  │H100  │ │H100  ││ ──传输──→    │ │A100  │ │A100  │ │
│  │高算力│ │高算力││  (RDMA/     │ │高带宽│ │高带宽│ │
│  └──────┘ └──────┘│  NVLink)    │ └──────┘ └──────┘ │
│                    │              │                    │
│ 特点：              │              │ 特点：              │
│ • 高计算密度        │              │ • 高显存带宽需求     │
│ • 处理输入序列      │              │ • 逐 token 生成     │
│ • 填充 KV Cache    │              │ • 读取 KV Cache     │
│ • 短时高负载        │              │ • 长时低负载         │
└────────────────────┘              └────────────────────┘

工作流程：
  1. 请求到达 → 调度到 Prefill Worker
  2. Prefill Worker 处理完整输入，生成 KV Cache
  3. 通过高速互联（RDMA/NVLink）将 KV Cache 传输到 Decode Worker
  4. Decode Worker 使用 KV Cache 逐 token 生成输出
  5. 输出通过 SSE 流式返回给用户
```

#### KV Cache 传输

Prefill 和 Decode 分离后，KV Cache 需要在不同的 GPU（甚至不同的节点）之间高速传输：

```
KV Cache 传输方式对比：

  方式         │ 带宽        │ 延迟     │ 适用场景
  ─────────────┼────────────┼─────────┼──────────────
  NVLink       │ 900 GB/s   │ ~1 μs   │ 同节点 GPU 间
  PCIe 5.0     │ 64 GB/s    │ ~5 μs   │ 同节点（无NVLink）
  RDMA (IB)    │ 400 Gb/s   │ ~2 μs   │ 跨节点
  TCP/IP       │ 100 Gb/s   │ ~50 μs  │ 跨机房（不推荐）

  以 LLaMA-70B 单请求 4K context 的 KV Cache (~1GB) 为例：
  - NVLink:  ~1.1 ms
  - RDMA:    ~20 ms
  - TCP/IP:  ~80 ms（不可接受，会显著增加 TTFT）
```

#### 收益分析

| 维度 | 混合部署（传统） | PD 分离 | 提升 |
|------|----------------|---------|------|
| GPU 利用率 | 30-50% | 70-90% | +40-60% |
| 吞吐量 | 基准 | 1.5-3x | 显著提升 |
| TTFT（首 token 延迟） | 高（被 Decode 阻塞） | 低（专用 Prefill） | 降低 2-3x |
| 可扩展性 | Prefill/Decode 绑定 | 独立扩缩容 | 灵活 |

---

### 6.5 GPU 集群编排

当模型太大，单张 GPU 放不下时，需要将模型拆分到多张 GPU 上。这涉及三种并行策略。

#### 三种并行策略

```
以 4 层 Transformer 模型为例，分布在 4 张 GPU 上：

━━━ ① 张量并行 (Tensor Parallelism, TP) ━━━
同一层拆分到多张 GPU 上：

  Layer 1 的矩阵乘法：
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ GPU 0    │  │ GPU 1    │  │ GPU 2    │  │ GPU 3    │
  │ 矩阵 1/4 │  │ 矩阵 2/4 │  │ 矩阵 3/4 │  │ 矩阵 4/4 │
  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       └──────────────┴──────────────┴──────────────┘
                      AllReduce 汇总结果
  
  特点：需要高带宽互联（NVLink），适合同节点内
  通信量：每层 2 次 AllReduce

━━━ ② 流水线并行 (Pipeline Parallelism, PP) ━━━
不同层分配到不同 GPU：

  GPU 0: [Layer 1] → GPU 1: [Layer 2] → GPU 2: [Layer 3] → GPU 3: [Layer 4]
  
  Micro-batch 流水线：
  时间 →
  GPU 0: [B1][B2][B3][B4]
  GPU 1:    [B1][B2][B3][B4]
  GPU 2:       [B1][B2][B3][B4]
  GPU 3:          [B1][B2][B3][B4]
  
  特点：通信量小（只传激活值），适合跨节点
  气泡问题：流水线启动和结束时 GPU 空闲（Pipeline Bubble）

━━━ ③ 数据并行 (Data Parallelism, DP) ━━━
完整模型复制到多组 GPU，每组处理不同请求：

  组 1 (GPU 0-3): 完整模型副本 → 处理请求 A, B, C
  组 2 (GPU 4-7): 完整模型副本 → 处理请求 D, E, F
  
  特点：线性扩展吞吐量，适合请求量大的场景
```

#### 不同模型规模的部署策略

```
模型规模 → 推荐并行策略：

  7B 模型 (FP16 ~14GB):
    → 单卡 A100 80GB 即可
    → 用 DP 扩展吞吐量

  70B 模型 (FP16 ~140GB):
    → TP=4 (4×A100 80GB, 同节点 NVLink 互联)
    → 用 DP 扩展：多组 4 卡

  405B 模型 (FP16 ~810GB):
    → TP=8 (同节点) × PP=2 (跨节点) = 16 卡
    → 或 TP=8 × PP=4 = 32 卡 (更低延迟)

  万亿参数 MoE 模型：
    → Expert Parallelism + TP + PP
    → 可能需要 128+ 卡
```

#### 量化部署：精度 vs 速度 vs 显存

| 量化格式 | 模型大小（70B） | 显存占用 | 推理速度 | 精度损失 | 适用场景 |
|----------|----------------|---------|---------|---------|---------|
| FP16 | 140 GB | 基准 | 基准 | 无 | 精度敏感任务 |
| INT8 | 70 GB | 50% | 1.5-2x | 微小 | 生产环境首选 |
| FP8 | 70 GB | 50% | 1.8-2.2x | 极小 | H100/H200 推荐 |
| INT4 (GPTQ) | 35 GB | 25% | 2-3x | 轻微 | 显存受限场景 |
| INT4 (AWQ) | 35 GB | 25% | 2-3x | 比GPTQ略好 | 显存受限场景 |

```
量化决策树：

  需要最高精度？ ──是→ FP16
       │
       否
       │
  使用 H100/H200？ ──是→ FP8（最佳性价比）
       │
       否
       │
  显存是否充裕？ ──是→ INT8
       │
       否
       │
  INT4 (AWQ > GPTQ)
```

---

### 6.6 模型版本管理

在生产环境中，模型需要持续更新（微调、对齐、能力升级）。但模型更新不能像网页部署那样直接替换——一个有 bug 的模型版本可能导致所有 Agent 产出错误结果。

#### 蓝绿部署

```
蓝绿部署（Blue-Green Deployment）：

  阶段 1：当前生产环境运行 v2.0（蓝色环境）
  
  ┌─────────────────┐
  │  Load Balancer   │
  │  100% → Blue     │
  └────────┬────────┘
           │
           ▼
  ┌────────────────┐     ┌────────────────┐
  │ Blue (v2.0)    │     │ Green (v2.1)   │
  │ ✅ 正在服务     │     │ 🔄 部署中/预热  │
  │ GPU Cluster A  │     │ GPU Cluster B  │
  └────────────────┘     └────────────────┘

  阶段 2：验证 Green 环境就绪后，切换流量
  
  ┌─────────────────┐
  │  Load Balancer   │
  │  100% → Green    │    ← 瞬间切换
  └────────┬────────┘
           │
           ▼
  ┌────────────────┐     ┌────────────────┐
  │ Blue (v2.0)    │     │ Green (v2.1)   │
  │ 🔶 待命（回滚用）│     │ ✅ 正在服务     │
  │ 保持温热 30 分钟 │     │ GPU Cluster B  │
  └────────────────┘     └────────────────┘

  优势：切换瞬间完成，回滚只需再切回 Blue
  代价：需要双倍 GPU 资源（但只在切换窗口期间）
```

#### 金丝雀发布

```
金丝雀发布（Canary Release）：渐进式放量

  阶段 1: 1% 流量 → v2.1（试探）
  ┌─────────┐
  │ 99% v2.0│████████████████████████████████████████████░
  │  1% v2.1│░
  └─────────┘
  观察指标：错误率、延迟、用户反馈（持续 1-2 小时）
  
  阶段 2: 10% 流量 → v2.1（小规模验证）
  ┌─────────┐
  │ 90% v2.0│████████████████████████████████████████░░░░
  │ 10% v2.1│░░░░
  └─────────┘
  观察指标：同上 + A/B 测试对比（持续 2-4 小时）
  
  阶段 3: 50% 流量 → v2.1（大规模验证）
  ┌─────────┐
  │ 50% v2.0│████████████████████░░░░░░░░░░░░░░░░░░░░░░░
  │ 50% v2.1│░░░░░░░░░░░░░░░░░░░░░░░
  └─────────┘
  评估指标：全面对比（持续 4-8 小时）
  
  阶段 4: 100% 流量 → v2.1（全量上线）
  ┌─────────┐
  │  0% v2.0│
  │100% v2.1│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  └─────────┘
  保留 v2.0 模型权重，30 分钟内可回滚
```

#### 回滚策略

```python
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class DeploymentStatus(Enum):
    ACTIVE = "active"       # 正在服务
    STANDBY = "standby"     # 待命（可快速切换）
    ARCHIVED = "archived"   # 已归档（需重新加载）


@dataclass
class ModelVersion:
    version: str
    status: DeploymentStatus
    gpu_cluster: str
    deployed_at: datetime
    traffic_percent: int = 0
    health_score: float = 1.0  # 0.0-1.0，基于错误率/延迟等计算


class ModelVersionManager:
    """
    模型版本管理器：管理部署、灰度、回滚
    
    核心原则：
    1. 永远保留上一个稳定版本处于 STANDBY 状态
    2. 出现异常自动触发回滚
    3. 灰度过程中持续监控健康指标
    """
    
    HEALTH_THRESHOLD = 0.95  # 健康分数低于此值触发自动回滚
    
    def __init__(self):
        self.versions: dict[str, ModelVersion] = {}
        self.active_version: str | None = None
        self.canary_version: str | None = None
    
    def deploy_canary(self, version: str, initial_traffic: int = 1):
        """部署金丝雀版本"""
        self.canary_version = version
        self.versions[version] = ModelVersion(
            version=version,
            status=DeploymentStatus.ACTIVE,
            gpu_cluster="canary-cluster",
            deployed_at=datetime.now(),
            traffic_percent=initial_traffic,
        )
        # 减少稳定版本的流量
        if self.active_version:
            self.versions[self.active_version].traffic_percent = 100 - initial_traffic
    
    def promote_canary(self, new_traffic: int):
        """提升金丝雀流量比例"""
        if not self.canary_version:
            raise ValueError("No canary deployment active")
        
        canary = self.versions[self.canary_version]
        
        # 检查健康状态
        if canary.health_score < self.HEALTH_THRESHOLD:
            self.rollback(reason=f"Health score {canary.health_score} below threshold")
            return
        
        canary.traffic_percent = new_traffic
        if self.active_version:
            self.versions[self.active_version].traffic_percent = 100 - new_traffic
        
        # 100% 流量意味着全量上线
        if new_traffic >= 100:
            self._finalize_promotion()
    
    def rollback(self, reason: str = "manual"):
        """回滚到上一个稳定版本"""
        if not self.active_version:
            raise ValueError("No stable version to roll back to")
        
        # 将所有流量切回稳定版本
        self.versions[self.active_version].traffic_percent = 100
        
        if self.canary_version:
            self.versions[self.canary_version].traffic_percent = 0
            self.versions[self.canary_version].status = DeploymentStatus.ARCHIVED
            self.canary_version = None
        
        print(f"[ROLLBACK] Rolled back to {self.active_version}. Reason: {reason}")
    
    def _finalize_promotion(self):
        """金丝雀全量上线，旧版本转为待命"""
        old_active = self.active_version
        self.active_version = self.canary_version
        self.canary_version = None
        
        if old_active:
            self.versions[old_active].status = DeploymentStatus.STANDBY
            self.versions[old_active].traffic_percent = 0
```

---

> **小结**：本部分覆盖了 Agent 全链路中从客户端到推理服务的三个核心层。客户端层负责安全高效地发送请求（4.1-4.4），网关层负责认证、路由、限流和可观测性（5.1-5.5），推理服务层则通过 Continuous Batching、KV Cache 管理、PD 分离等技术最大化 GPU 利用率（6.1-6.6）。下一部分将继续深入流式响应返回链路、端到端可观测性和全链路优化策略。
## 7. 流式响应全链路

> 📖 **深入学习**：本节为全链路视角概述，详细原理与实践请参阅 [流式传输与实时通信](./03-流式传输与实时通信.md) 和 [SSE分布式推送与数据一致性](./04-SSE分布式推送与数据一致性.md)

> **生活类比**：想象你在餐厅点了一桌菜。传统 API 是等所有菜做完、一次性端上来（你饿了 30 秒）；流式响应是做一道上一道——第一盘沙拉 3 秒就到，边吃边等后面的菜。LLM 的流式输出就是这个"做一道上一道"的模式。

### 7.1 SSE 协议详解

在 LLM 应用中，主流的实时数据推送方案有三种，我们逐一对比：

```
┌──────────────┬───────────────┬──────────────────┬──────────────────┐
│     特性      │     SSE       │    WebSocket      │  gRPC Streaming  │
├──────────────┼───────────────┼──────────────────┼──────────────────┤
│ 方向         │ 单向（服→客）  │ 双向              │ 双向/单向         │
│ 协议         │ HTTP/1.1+     │ 独立协议(ws://)    │ HTTP/2           │
│ 重连机制     │ 内置自动重连   │ 需手动实现         │ 需手动实现        │
│ 数据格式     │ 纯文本(UTF-8) │ 文本或二进制       │ Protobuf(二进制)  │
│ 浏览器支持   │ 原生 EventSource│ 原生 WebSocket   │ 需 grpc-web 代理  │
│ 代理/CDN     │ 完美兼容       │ 需要升级协议       │ 需特殊配置        │
│ 连接开销     │ 低（复用HTTP） │ 中（握手升级）     │ 低（HTTP/2复用）  │
│ 典型延迟     │ ~1-5ms/帧     │ ~0.5-2ms/帧       │ ~0.5-2ms/帧      │
│ 适用场景     │ LLM流式输出    │ 聊天室/协作编辑    │ 微服务间通信      │
└──────────────┴───────────────┴──────────────────┴──────────────────┘
```

**SSE 报文格式详解：**

```
// 一条完整的 SSE 消息
id: msg-001                          ← 事件 ID（用于断线重连）
event: token                         ← 事件类型（默认 "message"）
retry: 3000                          ← 重连间隔（毫秒）
data: {"token": "你", "index": 0}    ← 数据负载（可多行）
data: {"continued": true}            ← 多行 data 会被 \n 连接
                                     ← 空行表示消息结束（\n\n）
```

**为什么 LLM 场景首选 SSE？**

1. **单向即可**：LLM 生成是"我说你听"，不需要客户端反向推送
2. **HTTP 原生**：不需要协议升级，所有 CDN/代理/负载均衡器天然兼容
3. **自动重连**：浏览器 `EventSource` API 内置断线重连，设置 `retry` 字段即可
4. **简单调试**：纯文本格式，`curl` 就能测试，Chrome DevTools 直接可视化

**TypeScript SSE 解析器实现：**

```typescript
// sse-parser.ts — 从原始 ReadableStream 中解析 SSE 事件
interface SSEEvent {
  id?: string;
  event: string;
  data: string;
  retry?: number;
}

async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n'); // 双换行分割消息
      buffer = parts.pop() || '';        // 最后一段可能不完整

      for (const part of parts) {
        if (!part.trim()) continue;

        const event: SSEEvent = { event: 'message', data: '' };
        const dataLines: string[] = [];

        for (const line of part.split('\n')) {
          if (line.startsWith('id: '))    event.id = line.slice(4);
          if (line.startsWith('event: ')) event.event = line.slice(7);
          if (line.startsWith('retry: ')) event.retry = parseInt(line.slice(7));
          if (line.startsWith('data: '))  dataLines.push(line.slice(6));
        }

        event.data = dataLines.join('\n');
        if (event.data) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// 使用示例
const response = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: '你好' }) });
for await (const event of parseSSEStream(response.body!)) {
  if (event.event === 'token') {
    const { token } = JSON.parse(event.data);
    process.stdout.write(token); // 逐 token 输出
  }
}
```

### 7.2 流式传输每一层

一个 Token 从 GPU 生成到用户眼前，要穿越 6 层。每一层都有自己的职责和"禁忌"：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Token 流式传输全链路                          │
│                                                                 │
│  ┌─────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐        │
│  │ GPU │───→│ 推理引擎  │───→│ 模型服务  │───→│ API 网关 │        │
│  │     │    │(vLLM/TGI)│    │(FastAPI) │    │(Nginx)  │        │
│  └─────┘    └──────────┘    └──────────┘    └─────────┘        │
│   ~0.5ms      ~1ms            ~1ms            ~2ms             │
│   Token       Detokenize      SSE 封装        转发(不缓冲!)     │
│   生成         + 队列          + 日志                            │
│                                                                 │
│  ┌─────────┐    ┌──────────┐                                    │
│  │  CDN/   │───→│  Client  │                                    │
│  │  Edge   │    │(Browser) │                                    │
│  └─────────┘    └──────────┘                                    │
│    ~5-50ms       ~1ms                                           │
│    透传(不缓存)   渲染 DOM                                       │
│                                                                 │
│  总延迟: 10-60ms (端到端，含网络)                                 │
└─────────────────────────────────────────────────────────────────┘
```

**各层职责与注意事项：**

| 层级 | 职责 | 缓冲策略 | 常见问题 |
|------|------|---------|---------|
| GPU | 生成 token logits | 无缓冲 | GPU 显存不足导致 OOM |
| 推理引擎 | Detokenize + 批处理调度 | 微缓冲(1-3 tokens) | 批处理等待导致延迟抖动 |
| 模型服务 | SSE 封装 + 业务日志 | 行缓冲(flush per event) | 忘记 flush 导致"卡顿" |
| API 网关 | 认证 + 限流 + 转发 | **禁止缓冲** | 开了 proxy_buffering 导致"一次性吐出" |
| CDN/Edge | TLS 终止 + 就近路由 | 透传(不缓存) | 某些 CDN 默认缓冲响应体 |
| 客户端 | 解析 SSE + 渲染 | UI 渲染队列 | 过于频繁更新导致掉帧 |

**Nginx 流式配置（这里的每一行都很关键）：**

```nginx
# nginx.conf — LLM 流式响应代理配置
location /api/chat/stream {
    proxy_pass http://llm_backend;

    # === 关键：禁用所有缓冲 ===
    proxy_buffering off;           # 禁用代理缓冲（最重要！）
    proxy_cache off;               # 禁用缓存
    proxy_request_buffering off;   # 禁用请求体缓冲

    # === 流式传输必需头 ===
    proxy_set_header Connection '';
    proxy_http_version 1.1;        # SSE 需要 HTTP/1.1 长连接
    chunked_transfer_encoding on;  # 启用分块传输

    # === 超时配置（LLM 生成可能很慢）===
    proxy_read_timeout 300s;       # 5 分钟读超时
    proxy_send_timeout 300s;       # 5 分钟写超时

    # === SSE 特有头 ===
    add_header Content-Type text/event-stream;
    add_header Cache-Control no-cache;
    add_header X-Accel-Buffering no;  # 告诉上游代理也别缓冲
}
```

> **常见陷阱**：90% 的"流式不流畅"问题都是因为某一层开了缓冲。排查时从客户端往回查，逐层确认 `proxy_buffering off`。

### 7.3 背压控制（Backpressure）

> **类比**：想象一个水管系统——水泵（GPU）以每秒 300 升的速度往管道里灌水，但水龙头（客户端 3G 网络）每秒只能流出 10 升。如果没有背压控制，水管就会爆掉（内存溢出）。背压机制就像管道中的压力阀——当下游消费不过来时，向上游发出信号："慢点！"

**问题场景：**

```
推理引擎: 300 tokens/s → 网关: 300 tokens/s → 客户端(3G): 20 tokens/s
                                                    ↑
                                            280 tokens/s 堆积在哪？
                                            → 内存中！直到 OOM
```

**TCP 层背压（自动生效）：**

TCP 协议本身就有背压机制：

1. 客户端接收缓慢 → TCP 接收窗口缩小
2. 发送端 socket 写缓冲区满 → `write()` 系统调用阻塞
3. 阻塞沿链路向上传播，最终减慢推理引擎的输出

但 TCP 背压有局限：粒度太粗（只有"能写"和"不能写"两个状态），且异步框架中可能被绕过。

**应用层背压控制：**

```python
# backpressure_handler.py — 应用层背压控制器
import asyncio
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional
from collections import deque

@dataclass
class BackpressureMetrics:
    """背压监控指标"""
    tokens_buffered: int = 0          # 当前缓冲 token 数
    tokens_dropped: int = 0           # 被丢弃的 token 数
    max_buffer_reached: int = 0       # 历史最高缓冲量
    backpressure_events: int = 0      # 触发背压次数

class BackpressureHandler:
    """
    基于令牌桶的背压控制器。
    当下游消费速度跟不上生产速度时，自动减慢上游。
    """

    def __init__(
        self,
        max_buffer_size: int = 100,          # 最多缓冲 100 个 token
        high_watermark: float = 0.8,         # 80% 时开始减速
        low_watermark: float = 0.3,          # 30% 时恢复全速
        check_interval: float = 0.01,        # 10ms 检查间隔
    ):
        self.max_buffer_size = max_buffer_size
        self.high_watermark = int(max_buffer_size * high_watermark)
        self.low_watermark = int(max_buffer_size * low_watermark)
        self.check_interval = check_interval

        self._buffer: deque = deque(maxlen=max_buffer_size)
        self._paused = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # 初始状态：不暂停
        self.metrics = BackpressureMetrics()

    async def produce(self, token: str) -> bool:
        """生产端：尝试将 token 放入缓冲区"""
        self.metrics.tokens_buffered = len(self._buffer)

        if len(self._buffer) >= self.max_buffer_size:
            self.metrics.tokens_dropped += 1
            return False  # 缓冲区满，拒绝

        # 超过高水位线 → 暂停生产
        if len(self._buffer) >= self.high_watermark and not self._paused:
            self._paused = True
            self._pause_event.clear()
            self.metrics.backpressure_events += 1

        # 等待消费端腾出空间
        if self._paused:
            await self._pause_event.wait()

        self._buffer.append(token)
        self.metrics.max_buffer_reached = max(
            self.metrics.max_buffer_reached, len(self._buffer)
        )
        return True

    async def consume(self) -> AsyncIterator[str]:
        """消费端：从缓冲区逐个取出 token"""
        while True:
            if self._buffer:
                token = self._buffer.popleft()
                self.metrics.tokens_buffered = len(self._buffer)

                # 低于低水位线 → 恢复生产
                if self._paused and len(self._buffer) <= self.low_watermark:
                    self._paused = False
                    self._pause_event.set()

                yield token
            else:
                await asyncio.sleep(self.check_interval)

    @property
    def pressure_ratio(self) -> float:
        """当前背压比率（0.0 无压力 → 1.0 满载）"""
        return len(self._buffer) / self.max_buffer_size
```

### 7.4 流中断恢复

> **类比**：你在看一部在线电影，看到 1:23:45 时网络断了。重新连接后，你不希望从头开始——你希望从 1:23:45 继续。流中断恢复就是给每个 SSE 事件打上"时间码"，让客户端从上次断开的地方续播。

**SSE 内置的恢复机制：**

```
// 服务端发送时带上 id
id: seq-042
data: {"token": "的"}

id: seq-043
data: {"token": "架"}

// 客户端断线重连时，浏览器自动发送：
// GET /stream HTTP/1.1
// Last-Event-ID: seq-043
//
// 服务端从 seq-044 开始续发
```

**服务端流恢复实现：**

```typescript
// stream-recovery.ts — 基于检查点的流中断恢复

interface StreamCheckpoint {
  requestId: string;
  sequenceId: number;
  generatedTokens: string[];    // 已生成的所有 token（用于恢复上下文）
  modelState?: string;          // KV cache snapshot key（高级）
  createdAt: number;
  expiresAt: number;            // 过期时间（默认 5 分钟）
}

class StreamRecoveryManager {
  private checkpoints = new Map<string, StreamCheckpoint>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private ttlMs: number = 5 * 60 * 1000) {
    // 定期清理过期检查点
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  saveCheckpoint(requestId: string, seqId: number, tokens: string[]): void {
    this.checkpoints.set(requestId, {
      requestId,
      sequenceId: seqId,
      generatedTokens: [...tokens],
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  canResume(requestId: string, lastEventId: string): boolean {
    const cp = this.checkpoints.get(requestId);
    if (!cp) return false;
    if (Date.now() > cp.expiresAt) {
      this.checkpoints.delete(requestId);
      return false;
    }
    return cp.sequenceId >= parseInt(lastEventId.replace('seq-', ''));
  }

  async *resumeStream(
    requestId: string,
    lastEventId: string,
    continueGeneration: (context: string) => AsyncGenerator<string>
  ): AsyncGenerator<string> {
    const cp = this.checkpoints.get(requestId)!;
    const lastSeq = parseInt(lastEventId.replace('seq-', ''));

    // 1. 快速重放断点之后、已缓存的 token
    for (let i = lastSeq + 1; i <= cp.sequenceId; i++) {
      yield `id: seq-${String(i).padStart(3, '0')}\ndata: ${
        JSON.stringify({ token: cp.generatedTokens[i], replayed: true })
      }\n\n`;
    }

    // 2. 用已生成上下文继续推理
    const context = cp.generatedTokens.join('');
    let seq = cp.sequenceId;
    for await (const token of continueGeneration(context)) {
      seq++;
      cp.generatedTokens.push(token);
      cp.sequenceId = seq;
      yield `id: seq-${String(seq).padStart(3, '0')}\ndata: ${
        JSON.stringify({ token, replayed: false })
      }\n\n`;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, cp] of this.checkpoints) {
      if (now > cp.expiresAt) this.checkpoints.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}
```

### 7.5 Token-by-Token vs Chunk Streaming

两种流式策略各有优劣，真实生产环境中通常采用**自适应策略**：

```
┌──────────────────┬────────────────────────┬──────────────────────┐
│      维度         │  Token-by-Token        │   Chunk Streaming    │
├──────────────────┼────────────────────────┼──────────────────────┤
│ 每次发送量        │ 1 token（2-6字节）     │ N tokens（如 5-20）   │
│ 网络包数          │ 极多（每 token 一包）  │ 少（合并后一包）      │
│ TTFT (首 token)  │ 最低 ⚡                │ 稍高（等凑齐 N 个）   │
│ 吞吐量           │ 低（包头开销大）        │ 高（更好的 TCP 利用）  │
│ CPU 开销          │ 高（频繁 SSE 编码）    │ 低（批量编码）        │
│ 用户体感          │ 逐字打字机效果          │ 逐词/逐句出现         │
│ 适合场景          │ 对话式 UI              │ 代码生成/长文生成      │
│ 网络带宽利用率    │ ~15%（MTU 利用率低）   │ ~60%+                 │
└──────────────────┴────────────────────────┴──────────────────────┘
```

**自适应分块策略（生产推荐）：**

```python
# adaptive_chunking.py — 自适应分块：兼顾 TTFT 和吞吐量
import asyncio
import time
from typing import AsyncIterator

async def adaptive_chunk_stream(
    token_source: AsyncIterator[str],
    ttft_tokens: int = 3,              # 前 N 个 token 逐个发送（保证 TTFT）
    chunk_size: int = 10,              # 之后每 N 个 token 合并发送
    max_wait_ms: float = 50,           # 凑不齐 chunk 时的最大等待时间
) -> AsyncIterator[str]:
    """
    策略：前几个 token 逐个发（快速显示第一个字），
    之后切换到批量发送（提高吞吐量）。
    """
    count = 0
    chunk_buffer = []
    last_flush = time.monotonic()

    async for token in token_source:
        count += 1

        # Phase 1: 前 N 个 token 立即逐个发送（最低 TTFT）
        if count <= ttft_tokens:
            yield token
            continue

        # Phase 2: 之后合并发送
        chunk_buffer.append(token)
        elapsed_ms = (time.monotonic() - last_flush) * 1000

        if len(chunk_buffer) >= chunk_size or elapsed_ms >= max_wait_ms:
            yield ''.join(chunk_buffer)
            chunk_buffer.clear()
            last_flush = time.monotonic()

    # 发送剩余 token
    if chunk_buffer:
        yield ''.join(chunk_buffer)
```

---

## 8. Tool Execution 与安全边界

> 📖 **深入学习**：本节为全链路视角概述，详细原理与实践请参阅 [MCP协议与工具生态](./06-MCP协议与工具生态.md) 和 [安全沙箱与权限体系](./13-安全沙箱与权限体系.md)

> **生活类比**：LLM 调用工具就像你雇了一个聪明但没有街头智慧的实习生。他很会分析问题、给出方案，但如果你让他直接去操作服务器……你需要给他一间"安全屋"（沙箱），一份"权限清单"，和一个"监护人"（权限管理器），确保他只能做你允许的事。

### 8.1 工具执行架构

一次完整的工具调用，从 LLM 产生意图到结果反馈，经历以下步骤：

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Tool Execution Pipeline                         │
│                                                                     │
│  ┌─────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐          │
│  │ LLM │───→│  解析器   │───→│ 权限检查  │───→│  沙箱执行  │          │
│  │     │    │(tool_call│    │(Permit?) │    │(Sandbox) │          │
│  │     │    │ parser)  │    │          │    │          │          │
│  └──┬──┘    └──────────┘    └────┬─────┘    └────┬──────┘          │
│     │                           │                │                  │
│     │    ┌─────────────┐        │   ┌────────┐   │                  │
│     │    │ 结果格式化   │←───────┘   │用户确认│   │                  │
│     │    │(truncate/   │            │(Y/N/  │   │                  │
│     │    │ summarize)  │            │Always)│   │                  │
│     │    └──────┬──────┘            └────────┘   │                  │
│     │           │                                │                  │
│     ←───────────┘     结果注入到下一轮对话上下文     │                  │
│                                                  │                  │
│  完整链路延迟: 解析(~5ms) + 权限(~2ms) +          │                  │
│              确认(0-∞ms) + 执行(10ms-30s) +      │                  │
│              格式化(~5ms) = 动态                   │                  │
└──────────────────────────────────────────────────────────────────────┘
```

**工具调用的 JSON 协议（OpenAI 格式）：**

```json
// LLM 输出的 tool_call
{
  "tool_calls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "file_read",
      "arguments": "{\"path\": \"src/main.py\", \"line_range\": [1, 50]}"
    }
  }]
}

// 工具执行结果（注入到下一轮）
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "1. import os\n2. import sys\n3. ..."
}
```

### 8.2 沙箱设计

工具执行必须在隔离环境中进行。一个生产级沙箱需要三层隔离：

```
┌─────────────────────────────────────────┐
│           沙箱隔离三层模型               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Layer 3: 进程沙箱               │    │
│  │ • CPU: 最多 2 核                │    │
│  │ • 内存: 最多 512MB              │    │
│  │ • 时间: 最多 30 秒              │    │
│  │ • PID: 独立 PID namespace       │    │
│  │  ┌──────────────────────────┐   │    │
│  │  │ Layer 2: 网络沙箱        │   │    │
│  │  │ • 出站: 仅允许白名单域名  │   │    │
│  │  │ • 入站: 全部禁止          │   │    │
│  │  │ • DNS: 受控解析           │   │    │
│  │  │  ┌───────────────────┐   │   │    │
│  │  │  │ Layer 1: 文件沙箱 │   │   │    │
│  │  │  │ • 根目录: /sandbox│   │   │    │
│  │  │  │ • 只读: /usr,/lib │   │   │    │
│  │  │  │ • 读写: /workspace│   │   │    │
│  │  │  │ • 禁止: /etc,/proc│   │   │    │
│  │  │  └───────────────────┘   │   │    │
│  │  └──────────────────────────┘   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**沙箱实现：**

```python
# sandbox.py — 生产级工具执行沙箱
import subprocess
import os
import signal
import resource
from dataclasses import dataclass
from typing import Optional
from pathlib import Path

@dataclass
class SandboxLimits:
    """沙箱资源限制配置"""
    max_cpu_seconds: int = 30         # CPU 时间限制
    max_memory_mb: int = 512          # 内存限制（MB）
    max_file_size_mb: int = 10        # 单文件大小限制
    max_processes: int = 10           # 最大子进程数
    max_output_bytes: int = 1_000_000 # 输出截断阈值（1MB）
    timeout_seconds: int = 30         # 墙钟时间限制
    allowed_network: list = None      # 允许访问的域名列表

    def __post_init__(self):
        if self.allowed_network is None:
            self.allowed_network = []

@dataclass
class SandboxResult:
    """沙箱执行结果"""
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    memory_exceeded: bool
    duration_ms: float

class Sandbox:
    """
    进程隔离沙箱，用于安全执行 LLM 产生的工具调用。
    生产环境建议使用 Docker/gVisor/Firecracker 替代进程级隔离。
    """

    def __init__(
        self,
        workspace: str,
        limits: Optional[SandboxLimits] = None,
    ):
        self.workspace = Path(workspace).resolve()
        self.limits = limits or SandboxLimits()
        self._validate_workspace()

    def _validate_workspace(self) -> None:
        """确保 workspace 存在且在安全路径下"""
        if not self.workspace.exists():
            self.workspace.mkdir(parents=True, exist_ok=True)
        # 防止路径穿越
        dangerous_paths = ['/etc', '/root', '/proc', '/sys', '/dev']
        for dp in dangerous_paths:
            if str(self.workspace).startswith(dp):
                raise ValueError(f"Workspace cannot be under {dp}")

    def _set_resource_limits(self) -> None:
        """在子进程中设置资源限制（preexec_fn 调用）"""
        # CPU 时间限制
        resource.setrlimit(resource.RLIMIT_CPU,
            (self.limits.max_cpu_seconds, self.limits.max_cpu_seconds))
        # 内存限制
        mem_bytes = self.limits.max_memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        # 文件大小限制
        file_bytes = self.limits.max_file_size_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
        # 子进程数限制
        resource.setrlimit(resource.RLIMIT_NPROC,
            (self.limits.max_processes, self.limits.max_processes))

    def execute(self, command: str, env: dict = None) -> SandboxResult:
        """在沙箱中执行命令"""
        import time
        start = time.monotonic()

        safe_env = {
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'HOME': str(self.workspace),
            'LANG': 'en_US.UTF-8',
        }
        if env:
            safe_env.update(env)

        timed_out = False
        memory_exceeded = False

        try:
            proc = subprocess.run(
                ['bash', '-c', command],
                cwd=str(self.workspace),
                env=safe_env,
                capture_output=True,
                timeout=self.limits.timeout_seconds,
                preexec_fn=self._set_resource_limits,
            )
            stdout = proc.stdout.decode('utf-8', errors='replace')
            stderr = proc.stderr.decode('utf-8', errors='replace')
            exit_code = proc.returncode

        except subprocess.TimeoutExpired:
            stdout, stderr = '', 'Execution timed out'
            exit_code = -1
            timed_out = True

        # 截断过长输出
        if len(stdout) > self.limits.max_output_bytes:
            stdout = stdout[:self.limits.max_output_bytes] + \
                     f'\n... [truncated, {len(stdout)} bytes total]'

        duration_ms = (time.monotonic() - start) * 1000

        return SandboxResult(
            stdout=stdout, stderr=stderr, exit_code=exit_code,
            timed_out=timed_out, memory_exceeded=memory_exceeded,
            duration_ms=round(duration_ms, 2),
        )
```

### 8.3 权限模型

> **类比**：权限模型就像公司的门禁系统。实习生（LLM）有工位区的门卡（读权限），要进机房（写权限）需要主管审批，要碰生产服务器（执行权限）必须 VP 签字。

**三层权限体系：**

```
┌──────────────────────────────────────────────────┐
│                 权限层级模型                       │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Tier 1: READ（自动批准）                  │    │
│  │ • file_read — 读取文件内容                │    │
│  │ • search — 搜索文件/代码                  │    │
│  │ • list_dir — 列出目录                     │    │
│  │ • get_diagnostics — 获取错误信息          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Tier 2: WRITE（需确认/会话级授权）         │    │
│  │ • file_edit — 修改文件                    │    │
│  │ • file_create — 创建文件                  │    │
│  │ • git_commit — 提交代码                   │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Tier 3: EXECUTE（始终需确认）              │    │
│  │ • shell_exec — 执行 shell 命令            │    │
│  │ • network_request — 发起网络请求           │    │
│  │ • db_query — 数据库操作                   │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

```python
# permission_manager.py — 工具调用权限管理器
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import fnmatch

class PermissionTier(Enum):
    READ = "read"           # 自动批准
    WRITE = "write"         # 需确认或会话级授权
    EXECUTE = "execute"     # 始终需确认

class Decision(Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"             # 需要用户确认

@dataclass
class ToolPermission:
    tool_name: str
    tier: PermissionTier
    allowed_paths: list = field(default_factory=lambda: ["**"])
    blocked_paths: list = field(default_factory=lambda: [
        "/etc/**", "/root/**", "**/.env", "**/secrets/**"
    ])
    blocked_commands: list = field(default_factory=lambda: [
        "rm -rf /*", "sudo *", "curl * | bash", "chmod 777 *"
    ])

class PermissionManager:
    """管理 LLM 工具调用的权限检查"""

    # 默认工具权限配置
    DEFAULT_PERMISSIONS = {
        "file_read":     ToolPermission("file_read", PermissionTier.READ),
        "search":        ToolPermission("search", PermissionTier.READ),
        "list_dir":      ToolPermission("list_dir", PermissionTier.READ),
        "file_edit":     ToolPermission("file_edit", PermissionTier.WRITE),
        "file_create":   ToolPermission("file_create", PermissionTier.WRITE),
        "shell_exec":    ToolPermission("shell_exec", PermissionTier.EXECUTE),
        "network_fetch": ToolPermission("network_fetch", PermissionTier.EXECUTE),
    }

    def __init__(self):
        self.permissions = dict(self.DEFAULT_PERMISSIONS)
        self._session_grants: set[str] = set()   # 会话级授权的工具
        self._audit_log: list[dict] = []          # 审计日志

    def check(self, tool_name: str, args: dict) -> Decision:
        """检查工具调用权限，返回决策"""
        perm = self.permissions.get(tool_name)
        if not perm:
            self._log(tool_name, args, Decision.DENY, "unknown tool")
            return Decision.DENY

        # 路径安全检查
        path = args.get("path", "")
        if path and self._is_blocked_path(path, perm.blocked_paths):
            self._log(tool_name, args, Decision.DENY, f"blocked path: {path}")
            return Decision.DENY

        # 命令安全检查
        command = args.get("command", "")
        if command and self._is_blocked_command(command, perm.blocked_commands):
            self._log(tool_name, args, Decision.DENY, f"blocked cmd: {command}")
            return Decision.DENY

        # Tier 1: 自动批准
        if perm.tier == PermissionTier.READ:
            self._log(tool_name, args, Decision.ALLOW, "auto-approved (read)")
            return Decision.ALLOW

        # 会话级授权检查
        if tool_name in self._session_grants:
            self._log(tool_name, args, Decision.ALLOW, "session grant")
            return Decision.ALLOW

        # Tier 2/3: 需要确认
        self._log(tool_name, args, Decision.ASK, "requires confirmation")
        return Decision.ASK

    def grant_session(self, tool_name: str) -> None:
        """授予工具会话级自动批准权限"""
        self._session_grants.add(tool_name)

    def _is_blocked_path(self, path: str, patterns: list) -> bool:
        return any(fnmatch.fnmatch(path, p) for p in patterns)

    def _is_blocked_command(self, cmd: str, patterns: list) -> bool:
        return any(fnmatch.fnmatch(cmd, p) for p in patterns)

    def _log(self, tool: str, args: dict, decision: Decision, reason: str):
        self._audit_log.append({
            "tool": tool, "args": args,
            "decision": decision.value, "reason": reason,
        })
```

### 8.4 MCP (Model Context Protocol) 集成

> **类比**：MCP 就像 USB 协议。在 USB 之前，每个外设（打印机、鼠标、键盘）都有自己的专用接口。USB 统一了物理接口和通信协议。MCP 对 AI 工具做了同样的事——不管是文件系统、数据库、还是 API，都通过统一的 JSON-RPC 协议暴露给 LLM。

**MCP 架构全景：**

```
┌───────────────────────────────────────────────────────────┐
│                    MCP 生态架构                            │
│                                                           │
│  ┌─────────┐  JSON-RPC   ┌──────────────────────────┐    │
│  │  LLM    │◄───────────→│    MCP Client (Host)     │    │
│  │  Agent  │             │  • 发现 MCP Servers       │    │
│  │         │             │  • 列举可用工具            │    │
│  └─────────┘             │  • 路由工具调用            │    │
│                          └──────────┬───────────────┘    │
│                                     │                     │
│               ┌─────────────────────┼──────────────┐     │
│               │                     │              │     │
│        ┌──────▼─────┐  ┌───────────▼──┐  ┌───────▼────┐│
│        │ MCP Server │  │ MCP Server   │  │ MCP Server ││
│        │ (文件系统)  │  │ (GitHub)     │  │ (数据库)   ││
│        │            │  │              │  │            ││
│        │ Tools:     │  │ Tools:       │  │ Tools:     ││
│        │ • read     │  │ • search     │  │ • query    ││
│        │ • write    │  │ • pr_create  │  │ • schema   ││
│        │ • list     │  │ • issues     │  │ • migrate  ││
│        │            │  │              │  │            ││
│        │ Resources: │  │ Resources:   │  │ Resources: ││
│        │ • file://  │  │ • repo://    │  │ • table:// ││
│        └────────────┘  └──────────────┘  └────────────┘│
└───────────────────────────────────────────────────────────┘
```

**MCP 的三大原语：**

| 原语 | 说明 | 示例 |
|------|------|------|
| **Tools** | LLM 可调用的函数 | `file_read(path)`, `web_search(query)` |
| **Resources** | LLM 可读取的数据源 | `file:///src/main.py`, `repo://org/repo` |
| **Prompts** | 预定义的 prompt 模板 | `code_review(diff)`, `explain(code)` |

**MCP Client 实现：**

```typescript
// mcp-client.ts — MCP 客户端：发现并调用 MCP 服务器上的工具
import { EventEmitter } from 'events';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;  // JSON Schema
}

interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;       // stdio 模式的启动命令
  url?: string;           // HTTP 模式的端点
  env?: Record<string, string>;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, any>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class MCPClient extends EventEmitter {
  private servers = new Map<string, MCPServerConfig>();
  private tools = new Map<string, { server: string; tool: MCPTool }>();
  private requestId = 0;

  async addServer(config: MCPServerConfig): Promise<void> {
    this.servers.set(config.name, config);
    // 初始化连接并发现工具
    const tools = await this.listTools(config.name);
    for (const tool of tools) {
      this.tools.set(`${config.name}.${tool.name}`, {
        server: config.name,
        tool,
      });
    }
    this.emit('server:connected', config.name, tools.length);
  }

  async listTools(serverName: string): Promise<MCPTool[]> {
    const response = await this.sendRequest(serverName, {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'tools/list',
    });
    return response.result?.tools || [];
  }

  async invokeTool(
    toolId: string,           // 格式: "server.tool_name"
    args: Record<string, any>
  ): Promise<any> {
    const entry = this.tools.get(toolId);
    if (!entry) throw new Error(`Tool not found: ${toolId}`);

    const response = await this.sendRequest(entry.server, {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'tools/call',
      params: { name: entry.tool.name, arguments: args },
    });

    if (response.error) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  }

  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values()).map(e => e.tool);
  }

  getToolsForLLM(): Array<{ type: 'function'; function: any }> {
    return this.getAllTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  private async sendRequest(
    serverName: string,
    request: JSONRPCRequest
  ): Promise<JSONRPCResponse> {
    const config = this.servers.get(serverName);
    if (!config) throw new Error(`Unknown server: ${serverName}`);

    // 根据 transport 类型选择通信方式
    if (config.transport === 'streamable-http' && config.url) {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      return res.json();
    }

    // stdio 模式：通过子进程 stdin/stdout 通信
    throw new Error(`Transport '${config.transport}' not yet implemented`);
  }
}

// 使用示例
async function main() {
  const client = new MCPClient();

  await client.addServer({
    name: 'filesystem',
    transport: 'streamable-http',
    url: 'http://localhost:3001/mcp',
  });

  // 列出所有可用工具
  const tools = client.getAllTools();
  console.log('Available tools:', tools.map(t => t.name));

  // 调用工具
  const result = await client.invokeTool('filesystem.file_read', {
    path: 'src/main.py',
  });
  console.log('File content:', result);
}
```

---

## 9. 10 万 → 1000 万 DAU 扩展

> **生活类比**：这就像开餐厅。10 万 DAU 是一家生意不错的社区餐厅——一个厨师、几张桌子就够了。100 万 DAU 是连锁餐厅——需要中央厨房、配送体系、标准化流程。1000 万 DAU 是全国快餐巨头——需要区域仓储、供应链管理、动态定价、甚至自己养鸡场。

### 9.1 容量规划

**从 DAU 到 QPS 的推导公式：**

```
QPS = DAU × 平均会话数/天 × 平均轮次/会话 ÷ 86400秒 × 峰值因子

假设：
- 平均每用户每天 2 个会话
- 平均每会话 5 轮对话
- 峰值因子: 4x（晚 8-10 点高峰）
```

**各规模容量速查表：**

```
┌──────────┬────────────┬────────────┬───────────┬──────────────┬──────────────┐
│   DAU    │  日请求总量  │ 平均 QPS   │ 峰值 QPS  │ GPU 节点数    │ 推理集群配置  │
│          │            │            │           │ (H100 基准)  │              │
├──────────┼────────────┼────────────┼───────────┼──────────────┼──────────────┤
│  10 万   │  100 万     │  ~12       │  ~50      │ 2-4 台       │ 单集群       │
│  50 万   │  500 万     │  ~58       │  ~230     │ 8-15 台      │ 单集群+备份   │
│ 100 万   │ 1000 万    │  ~116      │  ~460     │ 20-40 台     │ 多 AZ        │
│ 500 万   │ 5000 万    │  ~580      │  ~2300    │ 80-150 台    │ 多区域       │
│1000 万   │ 1 亿       │  ~1160     │  ~4600    │ 200+ 台      │ 全球多活     │
└──────────┴────────────┴────────────┴───────────┴──────────────┴──────────────┘
```

**GPU 吞吐量参考（单卡，70B 模型，FP16/INT8 量化）：**

| GPU 型号 | 显存 | 推理吞吐量 (tokens/s) | 并发请求数 | 单卡成本/月 |
|---------|------|---------------------|-----------|-----------|
| A100 80GB | 80GB | ~120-180 | 8-16 | ~$2,000 |
| H100 80GB | 80GB | ~250-350 | 16-32 | ~$3,500 |
| H200 141GB | 141GB | ~400-550 | 32-48 | ~$5,000 |
| MI300X 192GB | 192GB | ~300-450 | 24-40 | ~$3,000 |

> **注意**：以上数字假设使用 vLLM + continuous batching，实际吞吐量受模型大小、序列长度、量化策略等因素影响。

### 9.2 架构演进路径

**Phase 1：10 万 DAU — "社区餐厅"**

```
┌─────────────────────────────────────────────────────────┐
│               Phase 1: 单区域简单架构                    │
│                                                         │
│  用户 ──→ [CloudFlare CDN] ──→ [Nginx LB]              │
│                                    │                     │
│                          ┌─────────┼─────────┐          │
│                          │         │         │          │
│                     [App Pod 1] [App Pod 2] [App Pod 3] │
│                          │         │         │          │
│                          └─────────┼─────────┘          │
│                                    │                     │
│                          ┌─────────┴─────────┐          │
│                          │                   │          │
│                     [GPU Node 1]        [GPU Node 2]    │
│                     (vLLM, H100)        (vLLM, H100)    │
│                                                         │
│  存储层: Redis(会话) + PostgreSQL(持久化)                 │
│  监控: Prometheus + Grafana (基础)                       │
│  部署: 单 K8s 集群, 单 AZ                                │
│                                                         │
│  ✅ 优点: 简单、成本低、易维护                             │
│  ⚠️ 风险: 单点故障、无法跨区域容灾                        │
└─────────────────────────────────────────────────────────┘
```

**Phase 2：100 万 DAU — "连锁餐厅"**

```
┌──────────────────────────────────────────────────────────────┐
│               Phase 2: 多 AZ + 队列 + 自动扩缩               │
│                                                              │
│  用户 ──→ [Global LB] ──→ [API Gateway (Kong/Envoy)]        │
│                                │                              │
│                     ┌──────────┼──────────┐                  │
│                     │          │          │                  │
│                [AZ-1 App]  [AZ-2 App]  [AZ-3 App]           │
│                     │          │          │                  │
│                     └──────────┼──────────┘                  │
│                                │                              │
│                        [Request Queue]                        │
│                        (Kafka/NATS)                           │
│                     ┌──────────┼──────────┐                  │
│                     │          │          │                  │
│               [GPU Pool AZ-1] [GPU Pool AZ-2]                │
│               (10-15 x H100)  (10-15 x H100)                │
│               Auto-scaling    Auto-scaling                    │
│                                                              │
│  缓存层: Redis Cluster (KV cache 共享)                        │
│  存储层: PostgreSQL (主从) + S3 (审计日志)                     │
│  监控: Prometheus + Grafana + PagerDuty                      │
│  新增: 请求队列 + 优先级调度 + HPA 自动扩缩                    │
└──────────────────────────────────────────────────────────────┘
```

**Phase 3：1000 万 DAU — "全球快餐巨头"**

```
┌────────────────────────────────────────────────────────────────────┐
│               Phase 3: 全球多活 + 边缘计算 + 全分片                 │
│                                                                    │
│           ┌──────────── [Global DNS (GeoDNS)] ──────────┐         │
│           │                    │                         │         │
│     ┌─────▼─────┐       ┌─────▼─────┐            ┌─────▼─────┐   │
│     │ US Region │       │ EU Region │            │ Asia Region│   │
│     │           │       │           │            │           │   │
│     │ [Edge LB] │       │ [Edge LB] │            │ [Edge LB] │   │
│     │     │     │       │     │     │            │     │     │   │
│     │ [Gateway] │       │ [Gateway] │            │ [Gateway] │   │
│     │     │     │       │     │     │            │     │     │   │
│     │ [Queue]   │       │ [Queue]   │            │ [Queue]   │   │
│     │     │     │       │     │     │            │     │     │   │
│     │ [GPU 80+] │       │ [GPU 60+] │            │ [GPU 60+] │   │
│     │           │       │           │            │           │   │
│     │ [DB shard]│◄─────►│ [DB shard]│◄──────────►│ [DB shard]│   │
│     │ [Cache]   │ CRDT  │ [Cache]   │   CRDT     │ [Cache]   │   │
│     └───────────┘  sync └───────────┘    sync    └───────────┘   │
│                                                                    │
│  边缘计算: 小模型推理(意图识别、安全检查)在 Edge 完成               │
│  数据同步: CRDT 无冲突复制，最终一致性                              │
│  模型路由: 简单问题 → 小模型(低成本)，复杂问题 → 大模型(高质量)      │
│  灰度发布: 按区域/用户群 canary 发布新模型版本                      │
└────────────────────────────────────────────────────────────────────┘
```

### 9.3 请求队列系统

> **类比**：银行叫号系统。VIP 客户（付费用户）拿到的号码优先被叫到；普通客户按先来后到排队；当排队太长时，显示屏上出现"预计等待 15 分钟"。

**为什么需要队列？**

1. **削峰填谷**：GPU 集群无法瞬时扩容，队列平滑突发流量
2. **优先级调度**：付费用户不应和免费用户抢同一个 GPU
3. **重试与容错**：请求失败可重新入队，不丢失用户请求
4. **可观测性**：队列深度直接反映系统负载

**队列架构实现：**

```python
# request_queue.py — 基于 Redis Sorted Set 的优先级请求队列
import redis
import json
import time
from enum import IntEnum
from dataclasses import dataclass, asdict
from typing import Optional

class Priority(IntEnum):
    """优先级越小，越先处理"""
    PREMIUM = 1       # 付费用户
    STANDARD = 5      # 标准用户
    FREE = 10         # 免费用户
    BATCH = 20        # 批量/离线任务

@dataclass
class QueuedRequest:
    request_id: str
    user_id: str
    priority: int
    payload: dict
    enqueued_at: float
    estimated_wait_s: float = 0.0

class RequestQueue:
    """
    基于 Redis Sorted Set 的优先级队列。
    Score = priority * 1e12 + timestamp，保证同优先级 FIFO。
    """

    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.from_url(redis_url)
        self.queue_key = "llm:request_queue"
        self.metrics_key = "llm:queue_metrics"

    def enqueue(self, request: QueuedRequest) -> int:
        """入队，返回当前队列位置"""
        score = request.priority * 1e12 + request.enqueued_at
        self.redis.zadd(
            self.queue_key,
            {json.dumps(asdict(request)): score}
        )
        position = self.redis.zrank(self.queue_key, json.dumps(asdict(request)))
        # 更新预估等待时间
        request.estimated_wait_s = self._estimate_wait(position or 0)
        return position or 0

    def dequeue(self) -> Optional[QueuedRequest]:
        """出队：取出优先级最高（score 最小）的请求"""
        result = self.redis.zpopmin(self.queue_key, count=1)
        if not result:
            return None
        data, score = result[0]
        return QueuedRequest(**json.loads(data))

    def get_position(self, request_id: str) -> Optional[int]:
        """查询请求在队列中的位置"""
        members = self.redis.zrange(self.queue_key, 0, -1)
        for i, member in enumerate(members):
            data = json.loads(member)
            if data.get('request_id') == request_id:
                return i
        return None

    def depth(self) -> dict:
        """获取各优先级的队列深度"""
        total = self.redis.zcard(self.queue_key)
        return {
            "total": total,
            "estimated_drain_time_s": self._estimate_wait(total),
        }

    def _estimate_wait(self, position: int) -> float:
        """估算等待时间（基于历史处理速度）"""
        avg_process_time = float(
            self.redis.get(f"{self.metrics_key}:avg_time") or 3.0
        )
        return position * avg_process_time

    def record_completion(self, duration_s: float) -> None:
        """记录完成时间，更新滑动平均"""
        pipe = self.redis.pipeline()
        pipe.lpush(f"{self.metrics_key}:durations", duration_s)
        pipe.ltrim(f"{self.metrics_key}:durations", 0, 999)
        pipe.execute()
        # 重算平均值
        durations = self.redis.lrange(f"{self.metrics_key}:durations", 0, -1)
        avg = sum(float(d) for d in durations) / len(durations)
        self.redis.set(f"{self.metrics_key}:avg_time", avg)
```

### 9.4 数据库层

不同类型的数据需要不同的存储引擎——"一把钥匙开一把锁"：

```
┌────────────────────────────────────────────────────────────┐
│                    数据库分层架构                            │
│                                                            │
│  ┌────────────────┐  热数据(秒级访问)                       │
│  │ Redis Cluster  │  • 活跃会话上下文                       │
│  │ (内存)         │  • KV Cache 索引                        │
│  │                │  • 速率限制计数器                        │
│  │  TTL: 30min    │  • 请求队列                             │
│  └───────┬────────┘                                        │
│          │ 过期/持久化                                      │
│  ┌───────▼────────┐  温数据(分钟级访问)                     │
│  │ PostgreSQL     │  • 用户信息 & 配置                      │
│  │ (关系型)       │  • 会话历史(最近 30 天)                  │
│  │                │  • API Key & 权限                       │
│  │  分区: 按月    │  • 账单 & 用量统计                      │
│  └───────┬────────┘                                        │
│          │ 归档                                             │
│  ┌───────▼────────┐  冷数据(小时级访问)                     │
│  │ S3/GCS         │  • 历史会话归档(30天+)                  │
│  │ (对象存储)     │  • 审计日志                             │
│  │                │  • 模型推理日志                          │
│  │  生命周期:按年 │  • 训练数据/评估数据集                   │
│  └───────┬────────┘                                        │
│          │ 分析                                             │
│  ┌───────▼────────┐  分析数据                               │
│  │ TimescaleDB    │  • QPS/延迟时序数据                     │
│  │ (时序)         │  • GPU 利用率历史                        │
│  │                │  • 用户行为分析                          │
│  └────────────────┘                                        │
└────────────────────────────────────────────────────────────┘
```

### 9.5 监控告警体系

**四大黄金指标（Google SRE 经典方法论）：**

```
┌──────────────────────────────────────────────────────┐
│              Four Golden Signals                      │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐                   │
│  │  延迟        │  │  流量        │                   │
│  │  (Latency)  │  │  (Traffic)  │                   │
│  │             │  │             │                   │
│  │ • TTFT p50  │  │ • QPS       │                   │
│  │ • TTFT p99  │  │ • 并发连接数 │                   │
│  │ • 总生成时间 │  │ • tokens/s  │                   │
│  └─────────────┘  └─────────────┘                   │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐                   │
│  │  错误率      │  │  饱和度      │                   │
│  │  (Errors)   │  │(Saturation) │                   │
│  │             │  │             │                   │
│  │ • 5xx 率    │  │ • GPU 利用率 │                   │
│  │ • 超时率    │  │ • 内存使用率  │                   │
│  │ • 工具失败率 │  │ • 队列深度   │                   │
│  └─────────────┘  └─────────────┘                   │
└──────────────────────────────────────────────────────┘
```

**LLM 特有的监控指标：**

| 指标类别 | 具体指标 | 告警阈值 | 采集方式 |
|---------|---------|---------|---------|
| **推理性能** | TTFT (Time To First Token) | p99 > 3s | Prometheus histogram |
| | 生成速度 (tokens/s) | < 20 tok/s | 推理引擎 metrics |
| | 端到端延迟 | p99 > 30s | 应用层打点 |
| **GPU 健康** | GPU 利用率 | 持续 < 30% 或 > 95% | nvidia-smi / DCGM |
| | GPU 显存使用 | > 90% | DCGM exporter |
| | GPU 温度 | > 85°C | DCGM exporter |
| **业务指标** | 任务成功率 | < 90% | 应用层日志 |
| | 工具调用失败率 | > 5% | 应用层打点 |
| | 用户满意度(👍率) | < 70% | 用户反馈 |
| **队列** | 队列深度 | > 1000 | Redis metrics |
| | 队列等待时间 | p95 > 60s | 应用层打点 |
| | 请求丢弃率 | > 1% | 队列 metrics |

**告警升级策略：**

```
Level 1: 自动处理（无需人工介入）
├── 单节点 GPU 内存 > 90%  →  自动迁移请求到其他节点
├── 队列深度 > 500          →  触发 HPA 扩容
└── 单请求超时              →  自动重试到其他节点

Level 2: Slack 通知（工程师知晓）
├── 多节点 GPU 利用率 > 95% →  通知 #ops-alerts
├── 错误率 > 2%             →  通知 #ops-alerts
└── TTFT p99 > 5s          →  通知 #ops-alerts

Level 3: PagerDuty 呼叫（工程师响应）
├── 全集群 GPU 利用率 > 98% →  值班工程师
├── 错误率 > 10%            →  值班工程师 + 技术负责人
└── 服务完全不可用          →  全员告警 + 自动切换灾备区域

Level 4: 自动止血（最后防线）
├── 错误率 > 30% 持续 5 分钟 →  自动切流量到灾备
├── 全区域不可用             →  DNS 切换到其他区域
└── 数据库主节点故障         →  自动 failover 到从节点
```

### 9.6 成本估算

> **真话**：LLM 服务是个"烧钱机器"。GPU 成本占总成本的 60-80%。成本控制是从 Day 1 就要考虑的事，而不是"等用户多了再说"。

**各规模成本速查表（基于 2025 年云厂商公开价格）：**

```
┌──────────┬──────────────┬───────────┬──────────┬──────────┬───────────────┐
│   DAU    │  GPU 计算     │  带宽     │ 存储     │ 其他基础  │   月总成本     │
│          │ (主要成本)    │          │          │ 设施     │   (估算)      │
├──────────┼──────────────┼───────────┼──────────┼──────────┼───────────────┤
│  10 万   │ $3-6K        │ $0.5-1K   │ $0.2-0.5K│ $1-2K    │ $5-10K       │
│          │ 2-4x H100    │           │          │          │              │
├──────────┼──────────────┼───────────┼──────────┼──────────┼───────────────┤
│  50 万   │ $20-35K      │ $3-5K     │ $1-2K    │ $5-8K    │ $30-50K      │
│          │ 8-15x H100   │           │          │          │              │
├──────────┼──────────────┼───────────┼──────────┼──────────┼───────────────┤
│ 100 万   │ $50-80K      │ $8-12K    │ $3-5K    │ $10-15K  │ $70-110K     │
│          │ 20-40x H100  │           │          │          │              │
├──────────┼──────────────┼───────────┼──────────┼──────────┼───────────────┤
│ 500 万   │ $200-350K    │ $30-50K   │ $10-20K  │ $40-60K  │ $280-480K    │
│          │ 80-150x H100 │           │          │          │              │
├──────────┼──────────────┼───────────┼──────────┼──────────┼───────────────┤
│1000 万   │ $400-700K    │ $60-100K  │ $20-40K  │ $80-120K │ $560K-960K   │
│          │ 200+ H100    │           │          │          │              │
└──────────┴──────────────┴───────────┴──────────┴──────────┴───────────────┘
```

**降本关键手段：**

| 策略 | 节省幅度 | 实施难度 | 说明 |
|------|---------|---------|------|
| 模型量化 (INT8/INT4) | 30-50% GPU | 低 | 牺牲少量质量，大幅降低显存和算力 |
| KV Cache 优化 | 10-20% GPU | 中 | PagedAttention 等技术 |
| 模型路由 | 20-40% GPU | 中 | 简单问题用小模型，复杂问题用大模型 |
| 预留实例 (RI) | 30-60% GPU | 低 | 1年/3年预留比按需便宜很多 |
| Spot/竞价实例 | 50-70% GPU | 高 | 可能被抢占，需要完善的容错机制 |
| 请求合并 (Batching) | 15-25% GPU | 中 | 同时处理多请求，提高 GPU 利用率 |
| 缓存热门回答 | 5-15% 总成本 | 低 | 相同/相似问题直接返回缓存结果 |

---

## 10. 常见陷阱与最佳实践

> 以下是在生产环境中反复踩过的坑，用 ❌ vs ✅ 对照格式展示。每一条都是从真实事故中提炼出来的教训。

### 客户端陷阱

**❌ 陷阱 1：上下文窗口溢出**

```python
# ❌ 错误：无脑把所有历史消息塞进去
messages = load_all_history(user_id)  # 可能有 200 轮对话
response = llm.chat(messages=messages)
# 结果：超出 128K 上下文限制 → 500 错误 或 截断关键信息
```

```python
# ✅ 正确：滑动窗口 + 摘要压缩
def build_context(history: list, max_tokens: int = 60000) -> list:
    """保留最近 N 轮 + 早期摘要"""
    recent = history[-10:]  # 最近 10 轮完整保留
    token_count = count_tokens(recent)

    if token_count < max_tokens and len(history) > 10:
        # 对早期历史生成摘要
        early_summary = summarize(history[:-10])
        return [{"role": "system", "content": early_summary}] + recent

    return recent
```

**❌ 陷阱 2：流式响应中不做重试**

```typescript
// ❌ 错误：SSE 连接断了就完了
const es = new EventSource('/api/stream');
es.onmessage = (e) => renderToken(e.data);
es.onerror = () => showError('连接断开');  // 就这样？
```

```typescript
// ✅ 正确：指数退避重试 + 断点续传
function createResilientStream(url: string, lastEventId?: string) {
  const headers: Record<string, string> = {};
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;

  let retries = 0;
  const maxRetries = 5;

  const connect = () => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      retries = 0;  // 成功收到消息，重置重试次数
      lastEventId = e.lastEventId;
      renderToken(JSON.parse(e.data).token);
    };
    es.onerror = () => {
      es.close();
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 30000);
        retries++;
        setTimeout(connect, delay);
      }
    };
  };
  connect();
}
```

**❌ 陷阱 3：工具执行时阻塞 UI**

```typescript
// ❌ 错误：工具执行期间 UI 冻结，用户以为卡了
const result = await executeTool(toolCall);  // 可能 30 秒
updateUI(result);
```

```typescript
// ✅ 正确：显示工具执行状态 + 支持取消
async function executeWithFeedback(toolCall: ToolCall) {
  showToolStatus(`正在执行: ${toolCall.name}...`, 'running');
  const controller = new AbortController();
  showCancelButton(() => controller.abort());

  try {
    const result = await executeTool(toolCall, controller.signal);
    showToolStatus(`完成: ${toolCall.name}`, 'success');
    return result;
  } catch (e) {
    if (e.name === 'AbortError') {
      showToolStatus(`已取消: ${toolCall.name}`, 'cancelled');
    } else {
      showToolStatus(`失败: ${toolCall.name}`, 'error');
    }
  }
}
```

### 网关层陷阱

**❌ 陷阱 4：网关缓冲 SSE 响应**

```nginx
# ❌ 错误：Nginx 默认开启 proxy_buffering
location /api/stream {
    proxy_pass http://backend;
    # proxy_buffering 默认是 on！
    # 后果：所有 token 被缓冲，直到响应结束才一次性发给客户端
    # 用户看到：等了 10 秒 → 突然"哗"全出来了
}
```

```nginx
# ✅ 正确：关闭所有缓冲
location /api/stream {
    proxy_pass http://backend;
    proxy_buffering off;            # 关键！
    proxy_cache off;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    add_header X-Accel-Buffering no;
    proxy_read_timeout 300s;
}
```

**❌ 陷阱 5：没有速率限制**

```python
# ❌ 错误：任何人可以无限制发请求
@app.post("/api/chat")
async def chat(request: ChatRequest):
    return await llm.generate(request.messages)
    # 后果：一个用户写个循环就能把 GPU 集群打满
```

```python
# ✅ 正确：多维度速率限制
from slowapi import Limiter

limiter = Limiter(key_func=get_user_id)

@app.post("/api/chat")
@limiter.limit("10/minute")          # 每分钟 10 次
@limiter.limit("100/hour")           # 每小时 100 次
@limiter.limit("500/day")            # 每天 500 次
async def chat(request: ChatRequest):
    # 还可以按 token 消耗量限制
    check_token_quota(request.user_id, estimated_tokens=2000)
    return await llm.generate(request.messages)
```

**❌ 陷阱 6：响应中缺少 Trace ID**

```python
# ❌ 错误：出了问题无法追踪
@app.post("/api/chat")
async def chat(request: ChatRequest):
    result = await llm.generate(request.messages)
    return {"content": result}
    # 用户反馈"有时候回答不对"——你根本无法定位是哪个请求
```

```python
# ✅ 正确：全链路 Trace ID
import uuid

@app.post("/api/chat")
async def chat(request: ChatRequest):
    trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4()))
    logger.info(f"[{trace_id}] Request received", extra={"trace_id": trace_id})

    result = await llm.generate(request.messages, trace_id=trace_id)

    return JSONResponse(
        content={"content": result, "trace_id": trace_id},
        headers={"X-Trace-ID": trace_id}
    )
```

### 推理层陷阱

**❌ 陷阱 7：使用静态批处理**

```python
# ❌ 错误：等凑齐 batch_size 个请求才一起处理
batch = []
while len(batch) < BATCH_SIZE:      # BATCH_SIZE = 32
    batch.append(await queue.get())  # 等不满 32 个就干等着
results = model.forward(batch)       # 等最长的那个请求生成完才返回
# 后果：短请求被长请求拖累，延迟不可预测
```

```python
# ✅ 正确：使用 continuous batching (vLLM 默认支持)
# vLLM 配置
engine = AsyncLLMEngine.from_engine_args(
    EngineArgs(
        model="meta-llama/Llama-3-70B",
        max_num_seqs=256,             # 最大并发序列数
        enable_chunked_prefill=True,  # 分块预填充
        # continuous batching 自动生效
        # 请求完成一个立即释放，新请求立即加入
    )
)
```

**❌ 陷阱 8：不管理 KV Cache**

```python
# ❌ 错误：KV Cache 无限增长，直到 OOM
def generate(prompt):
    kv_cache = {}
    for token in model.generate(prompt, kv_cache=kv_cache):
        yield token
    # kv_cache 在内存中一直存在，永远不释放
    # 并发 100 个长对话 → 显存爆了
```

```python
# ✅ 正确：使用 PagedAttention + 自动管理
# vLLM 的 PagedAttention 自动管理 KV Cache：
# - 按需分配显存页（类似操作系统虚拟内存）
# - 请求完成后自动回收
# - 支持 KV Cache 在多个请求间共享（prefix caching）
engine = AsyncLLMEngine.from_engine_args(
    EngineArgs(
        model="meta-llama/Llama-3-70B",
        gpu_memory_utilization=0.9,       # 使用 90% 显存
        enable_prefix_caching=True,       # 共享前缀的 KV Cache
        swap_space=4,                     # 4GB CPU 内存作为 swap
    )
)
```

**❌ 陷阱 9：GPU 单点故障**

```yaml
# ❌ 错误：只有一个 GPU 节点，挂了全完了
deployment:
  replicas: 1
  resources:
    limits:
      nvidia.com/gpu: 4  # 4 张 GPU 全在一台机器上
```

```yaml
# ✅ 正确：多节点 + 健康检查 + 自动转移
deployment:
  replicas: 3               # 至少 3 个节点
  strategy:
    rollingUpdate:
      maxUnavailable: 1     # 滚动更新时最多挂 1 个
  affinity:
    podAntiAffinity:        # 强制分散到不同物理机
      requiredDuringSchedulingIgnoredDuringExecution:
        - topologyKey: kubernetes.io/hostname
  readinessProbe:
    httpGet:
      path: /health
      port: 8000
    periodSeconds: 10
    failureThreshold: 3     # 3 次失败后踢出
```

### 扩展性陷阱

**❌ 陷阱 10：没有容量规划**

```
# ❌ 错误：拍脑袋买 GPU
"Product: 我们下个月要上线！"
"Infra: 买几张卡？"
"Product: 先来 2 张吧！"
# 结果：上线第二天 QPS 超出承受能力，紧急扩容要 2 周交付周期
```

```
# ✅ 正确：基于数据的容量规划
1. 收集基准数据：
   - 单卡吞吐：H100 处理 70B 模型 ≈ 300 tokens/s
   - 平均请求：输入 500 tokens + 输出 300 tokens
   - 单请求耗时：~1s prefill + ~1s decode = ~2s

2. 推算需求：
   - 目标 DAU: 50万
   - 峰值 QPS: 50万 × 10轮/天 ÷ 86400 × 4(峰值) ≈ 230 QPS
   - 所需吞吐: 230 × 800 tokens/req ≈ 184K tokens/s
   - 所需 GPU: 184K ÷ 300 ≈ 614 → 取整 8 卡 × ~80 台（含冗余）

3. 分阶段采购：先 60% 容量上线，剩余 40% 按需扩容
```

**❌ 陷阱 11：单体部署**

```
# ❌ 错误：所有组件跑在一个进程里
def main():
    app = Flask(__name__)
    model = load_model()          # 占 40GB 显存
    cache = InMemoryCache()       # 占 8GB 内存
    queue = InMemoryQueue()       # 无持久化

    @app.route("/chat")
    def chat():
        result = model.generate(request.json)
        cache.set(request.json["id"], result)
        return jsonify(result)

    app.run(port=8080)
# 后果：没法独立扩缩推理层和应用层；一个 OOM 全服务挂掉
```

```
# ✅ 正确：微服务拆分，独立扩缩
┌─────────┐     ┌──────────┐     ┌──────────┐
│ API 网关 │ ──→ │ 应用服务  │ ──→ │ 推理服务  │
│ (Nginx)  │     │ (FastAPI) │     │ (vLLM)   │
│ 水平扩展 │     │ 水平扩展  │     │ GPU 扩展  │
│ 无状态   │     │ 无状态    │     │ 有状态    │
└─────────┘     └──────────┘     └──────────┘
      ↓               ↓               ↓
  独立扩缩          独立扩缩        独立扩缩
  CPU 密集          CPU 密集        GPU 密集
```

**❌ 陷阱 12：没有优雅降级**

```python
# ❌ 错误：GPU 不够就直接返回 503
@app.post("/chat")
async def chat(request):
    if gpu_queue.full():
        raise HTTPException(503, "服务繁忙")
    # 后果：高峰期大量用户看到错误页面，用户流失
```

```python
# ✅ 正确：多级降级策略
@app.post("/chat")
async def chat(request):
    # Level 1: 正常服务（大模型 + 全功能）
    if gpu_available():
        return await generate_with_large_model(request)

    # Level 2: 降级到小模型（质量略降，但能响应）
    if small_model_available():
        return await generate_with_small_model(request)

    # Level 3: 返回缓存的相似回答
    cached = find_similar_cached_response(request.message)
    if cached:
        return {"content": cached, "degraded": True,
                "note": "基于缓存的回答，可能不够精确"}

    # Level 4: 排队等待（而非直接拒绝）
    position = await queue.enqueue(request)
    return {"queued": True, "position": position,
            "estimated_wait": f"{position * 3}秒"}
```

### 安全陷阱

**❌ 陷阱 13：不加沙箱执行 LLM 生成的代码**

```python
# ❌ 错误：直接 exec() LLM 生成的代码
tool_code = llm_response.tool_calls[0].code
exec(tool_code)  # LLM 可能生成 os.system("rm -rf /")
```

```python
# ✅ 正确：沙箱内执行 + 白名单
result = sandbox.execute(
    command=tool_code,
    limits=SandboxLimits(
        max_cpu_seconds=10,
        max_memory_mb=256,
        allowed_network=[],       # 禁止网络访问
    ),
    allowed_modules=["math", "json", "re"],  # 只允许安全模块
)
```

**❌ 陷阱 14：工具调用不做权限检查**

```python
# ❌ 错误：LLM 说读什么就读什么
def file_read(path: str) -> str:
    return open(path).read()
    # LLM 可以读 /etc/passwd, ~/.ssh/id_rsa, .env ...
```

```python
# ✅ 正确：权限管理器把关
def file_read(path: str, permission_mgr: PermissionManager) -> str:
    decision = permission_mgr.check("file_read", {"path": path})
    if decision == Decision.DENY:
        return f"[Permission Denied] Cannot read: {path}"
    if decision == Decision.ASK:
        if not await ask_user_confirmation(f"Allow reading {path}?"):
            return "[User Denied] Read permission not granted"
    return open(path).read()
```

**❌ 陷阱 15：将内部错误信息暴露给用户**

```python
# ❌ 错误：直接返回异常堆栈
@app.post("/chat")
async def chat(request):
    try:
        return await generate(request)
    except Exception as e:
        return {"error": str(e)}
        # 用户看到: "CUDA error: out of memory at /src/cuda_kernels.cu:142"
        # 暴露了：技术栈、文件路径、GPU 信息……
```

```python
# ✅ 正确：统一错误格式 + 内部日志
@app.post("/chat")
async def chat(request):
    trace_id = generate_trace_id()
    try:
        return await generate(request)
    except Exception as e:
        # 内部记录完整错误
        logger.error(f"[{trace_id}] {type(e).__name__}: {e}",
                     exc_info=True)
        # 用户只看到友好提示
        return JSONResponse(
            status_code=500,
            content={
                "error": "服务暂时出现问题，请稍后重试",
                "trace_id": trace_id,  # 用于工单追踪
            }
        )
```

> **总结**：这 15 个陷阱覆盖了从客户端到 GPU 的全链路。记住一个原则——**在开发环境不会出现的问题，在生产环境一定会出现，而且会在最不方便的时候出现**。防御性编程不是多余的，是必需的。
