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
