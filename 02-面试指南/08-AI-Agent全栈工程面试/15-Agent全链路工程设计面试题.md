# Agent 全链路工程设计面试题

> 覆盖从 CLI Agent 启动到 GPU 推理返回的完整工程链路

## 相关链接

- 对应技术资料：[Agent全链路工程设计](../../01-技术资料/08-AI-Agent全栈工程/15-Agent全链路工程设计.md)

## TL;DR 速览

1. **System Context 五要素**：系统指令、用户环境（OS/CWD/Shell）、项目规范（AGENTS.md）、可用工具清单、会话历史
2. **Agentic Loop 三阶段**：Think（LLM 推理决策）→ Act（执行工具调用）→ Observe（收集结果反馈）循环驱动
3. **SSE 单向流式**：服务端通过 `text/event-stream` 持久连接逐 token 推送，客户端被动接收并增量渲染
4. **Tool Schema 核心**：JSON Schema 定义参数约束 + 描述性 metadata 引导 LLM 正确选用工具
5. **Context Window 管理**：滑动窗口 + 摘要压缩 + 优先级淘汰，在有限 token 内保持最大信息密度
6. **全链路分层**：CLI → API Gateway → Orchestrator → Model Router → GPU Inference → 流式回传
7. **背压控制**：每一层都需要流量感知和反馈机制，避免下游过载导致级联故障
8. **可观测性三支柱**：Traces（分布式追踪）、Metrics（指标监控）、Logs（结构化日志）贯穿全链路

## 题目导航

| 难度 | 题号 | 题目 |
|------|------|------|
| ⭐ 基础 | Q1 | Agent CLI 的 System Context 组装包含哪些关键信息？ |
| ⭐ 基础 | Q2 | 请描述 Agentic Loop（Think→Act→Observe）的工作流程 |
| ⭐ 基础 | Q3 | SSE（Server-Sent Events）协议的工作原理是什么？ |
| ⭐ 基础 | Q4 | Agent 的 Tool 系统如何定义工具的输入输出 Schema？ |
| ⭐⭐ 进阶 | Q5 | 如何设计 Agent 的 Context Window 管理策略？ |
| ⭐⭐ 进阶 | Q6 | 多 Tool 并发执行时如何处理资源冲突？ |
| ⭐⭐ 进阶 | Q7 | API 网关层的限流策略如何设计？ |
| ⭐⭐ 进阶 | Q8 | 认证鉴权链路（API Key → JWT → OAuth2）如何选型？ |
| ⭐⭐ 进阶 | Q9 | 流式响应经过的每一层分别承担什么职责？ |
| ⭐⭐⭐ 高级 | Q10 | Prefill-Decode 分离架构的设计原理和收益是什么？ |
| ⭐⭐⭐ 高级 | Q11 | 如何设计 GPU 集群的模型调度策略？ |
| ⭐⭐⭐ 高级 | Q12 | 全链路背压控制（Backpressure）如何实现？ |
| ⭐⭐⭐ 高级 | Q13 | Sub-agent 多任务协调的工程挑战有哪些？ |
| 🎯 场景设计 | Q14 | 设计一个支撑 10 万 DAU 的 Agent 服务架构 |
| 🎯 场景设计 | Q15 | 从 10 万扩展到 1000 万 DAU 需要哪些架构改造？ |
| 🎯 场景设计 | Q16 | 设计 Agent 服务的全链路可观测性方案 |

---

## ⭐ 基础题

### Q1: Agent CLI 的 System Context 组装包含哪些关键信息？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Agent CLI 在每次会话启动时，需要将运行环境的关键上下文信息组装成 System Prompt 发送给 LLM。这个过程称为 **System Context 组装**，它是 Agent 理解"自己是谁、在哪里、能做什么"的基础。一个完整的 System Context 至少包含五个维度的信息。

第一维度是**系统指令（System Instructions）**，定义 Agent 的角色身份、行为边界和输出风格。例如告诉 LLM"你是一个终端助手，在非交互模式下工作，必须自主完成任务"。第二维度是**用户环境信息**，包括操作系统类型、当前工作目录（CWD）、Shell 类型、已安装的工具链等。这些信息让 Agent 能生成适配当前环境的命令。

第三维度是**项目规范文件**，如 `AGENTS.md`、`CLAUDE.md` 等，它们定义了项目级的编码规范、目录结构约束和操作流程。第四维度是**可用工具清单（Tool Definitions）**，以 JSON Schema 格式声明每个工具的名称、描述、参数类型和约束条件。第五维度是**会话历史（Conversation History）**，包含之前轮次的用户输入、Agent 输出和工具调用结果，为 LLM 提供连续对话的上下文。

#### 架构图

```
┌─────────────────────────────────────────────────────┐
│                   System Context                     │
├─────────────────────────────────────────────────────┤
│  ① System Instructions                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ 角色定义 │ 行为约束 │ 输出风格 │ 安全策略  │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ② Environment Context                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ OS: Linux │ CWD: /project │ Shell: bash     │    │
│  │ Git root: /project │ Dir snapshot: [...]    │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ③ Project Conventions (动态加载)                    │
│  ┌─────────────────────────────────────────────┐    │
│  │ AGENTS.md → 操作规范                         │    │
│  │ CLAUDE.md → 协作指南                         │    │
│  │ .editorconfig → 编辑器配置                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ④ Tool Definitions                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │ bash: { command, mode, shellId, ... }       │    │
│  │ edit: { path, old_str, new_str }            │    │
│  │ grep: { pattern, path, glob, ... }          │    │
│  │ view: { path, view_range }                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ⑤ Conversation History                             │
│  ┌─────────────────────────────────────────────┐    │
│  │ User: "修复这个 bug"                         │    │
│  │ Assistant: tool_call(grep, {...})           │    │
│  │ Tool Result: "found in line 42"             │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

#### 代码示例

```typescript
interface SystemContext {
  systemInstructions: string;
  environment: EnvironmentInfo;
  projectConventions: ConventionFile[];
  toolDefinitions: ToolSchema[];
  conversationHistory: Message[];
}

interface EnvironmentInfo {
  os: string;
  cwd: string;
  shell: string;
  gitRoot: string | null;
  directorySnapshot: string[];
}

async function assembleSystemContext(
  sessionId: string
): Promise<SystemContext> {
  // 1. 加载静态系统指令模板
  const systemInstructions = await loadTemplate("system-prompt.md");

  // 2. 收集运行时环境信息
  const environment: EnvironmentInfo = {
    os: process.platform,
    cwd: process.cwd(),
    shell: process.env.SHELL || "/bin/bash",
    gitRoot: await detectGitRoot(),
    directorySnapshot: await listDirectory(process.cwd(), { depth: 2 }),
  };

  // 3. 渐进式加载项目规范（避免上下文腐败）
  const conventionFiles = ["AGENTS.md", "CLAUDE.md", ".editorconfig"];
  const projectConventions = await Promise.all(
    conventionFiles
      .filter((f) => existsSync(path.join(environment.cwd, f)))
      .map(async (f) => ({
        filename: f,
        content: await readFile(path.join(environment.cwd, f), "utf-8"),
      }))
  );

  // 4. 注册可用工具的 JSON Schema
  const toolDefinitions = getRegisteredTools();

  // 5. 加载会话历史（受 Context Window 限制可能需要截断）
  const conversationHistory = await loadHistory(sessionId, {
    maxTokens: 120_000,
    strategy: "sliding-window-with-summary",
  });

  return {
    systemInstructions,
    environment,
    projectConventions,
    toolDefinitions,
    conversationHistory,
  };
}
```

#### 关键对比

| 维度 | 静态注入 | 动态加载 | 按需检索 |
|------|----------|----------|----------|
| 典型内容 | 系统指令、角色定义 | 环境信息、项目规范 | 历史对话、外部知识 |
| 加载时机 | 会话启动时一次性注入 | 每轮对话前检查更新 | LLM 主动请求时加载 |
| Token 成本 | 固定开销，可预估 | 中等，随项目规模变化 | 按需消耗，弹性最大 |
| 信息时效性 | 低（跨会话不变） | 中（会话内可能变化） | 高（实时最新） |
| 实现复杂度 | 低 | 中 | 高（需检索基础设施） |

#### 实际案例

GitHub Copilot CLI 在启动时的 System Context 组装是一个典型的工业级实现。它会读取当前目录的 `AGENTS.md` 和 `.github/copilot-instructions.md` 作为项目规范，收集 OS/CWD/Git 信息作为环境上下文，并将 `bash`、`edit`、`view`、`grep`、`glob` 等十余种工具的完整 JSON Schema 注入系统提示词。这些信息组合后可能占用 5000-10000 tokens，因此需要精心控制每个部分的长度，避免挤压留给实际对话的 token 空间。

#### 面试追问

1. 如果项目的 `AGENTS.md` 文件非常大（超过 5000 行），你会如何处理以避免上下文窗口溢出？
2. 环境信息中的目录快照（directory snapshot）应该递归到几层？太深和太浅各有什么问题？
3. 工具定义的 description 字段如何编写才能让 LLM 更准确地选择工具？有哪些反模式？

</details>

---

### Q2: 请描述 Agentic Loop（Think→Act→Observe）的工作流程

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Agentic Loop 是 Agent 系统的核心驱动机制，它将 LLM 的能力从"单轮问答"扩展为"多步推理执行"。整个循环包含三个阶段：**Think（思考）** — LLM 分析当前状态并决定下一步行动；**Act（行动）** — 执行 LLM 选择的工具调用；**Observe（观察）** — 收集工具执行结果，反馈给 LLM 进入下一轮循环。这个循环会持续运行直到 LLM 判断任务完成或达到最大迭代次数。

类比理解：想象一位侦探在办案。他先**思考**线索指向什么方向（Think），然后**行动**去调查某个地点或询问某个证人（Act），接着**观察**调查得到的新信息（Observe），再回到思考阶段整合所有已知线索。这个循环不断重复，直到案件告破。Agent 的工作方式完全一致——每一轮都在用新获得的信息推进任务。

Agentic Loop 与传统的 Chain-of-Thought（CoT）的关键区别在于：CoT 只是让 LLM 在输出前进行多步推理，但不与外部环境交互；而 Agentic Loop 的每个 Act 步骤都会真实地改变外部环境状态（如修改文件、运行命令），Observe 步骤则将这些真实变化反馈回推理过程。这种"接地"（Grounding）机制使得 Agent 能够处理需要多步操作的复杂任务。

#### 架构图

```
                    ┌──────────────┐
                    │   用户输入    │
                    └──────┬───────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   组装 System Context   │
              └────────────┬───────────┘
                           │
          ┌────────────────▼────────────────┐
          │          AGENTIC LOOP           │
          │                                 │
          │  ┌──────────┐                   │
          │  │  THINK   │ ◄─────────────┐   │
          │  │ LLM 推理  │              │   │
          │  └────┬─────┘              │   │
          │       │                    │   │
          │       ▼                    │   │
          │  ┌──────────┐              │   │
          │  │ 判断意图   │              │   │
          │  └──┬───┬───┘              │   │
          │     │   │                  │   │
          │  文本  工具调用              │   │
          │     │   │                  │   │
          │     │   ▼                  │   │
          │     │  ┌──────────┐        │   │
          │     │  │   ACT    │        │   │
          │     │  │ 执行工具   │        │   │
          │     │  └────┬─────┘        │   │
          │     │       │              │   │
          │     │       ▼              │   │
          │     │  ┌──────────┐        │   │
          │     │  │ OBSERVE  │        │   │
          │     │  │ 收集结果   │────────┘   │
          │     │  └──────────┘             │
          │     │                           │
          └─────┼───────────────────────────┘
                │
                ▼
          ┌───────────┐
          │  最终输出   │
          └───────────┘
```

#### 代码示例

```python
from dataclasses import dataclass
from typing import AsyncIterator

@dataclass
class ToolCall:
    name: str
    arguments: dict

@dataclass
class LoopResult:
    final_response: str
    total_turns: int
    tool_calls_made: list[dict]

async def agentic_loop(
    messages: list[dict],
    tools: list[dict],
    max_turns: int = 20
) -> AsyncIterator[str]:
    """Agentic Loop 核心实现：Think → Act → Observe 循环"""
    turn = 0

    while turn < max_turns:
        turn += 1

        # === THINK 阶段 ===
        # 将当前 messages（含历史 + 工具结果）发给 LLM
        response = await llm_chat(
            messages=messages,
            tools=tools,
            stream=True
        )

        # 收集 LLM 的完整响应
        assistant_message = await collect_stream(response)
        messages.append(assistant_message)

        # === 判断是否结束循环 ===
        if not assistant_message.get("tool_calls"):
            # LLM 输出纯文本 → 任务完成，退出循环
            yield assistant_message["content"]
            return

        # === ACT 阶段 ===
        # 并发执行所有工具调用（独立工具可并行）
        tool_results = await execute_tools_parallel(
            tool_calls=assistant_message["tool_calls"],
            sandbox=get_sandbox()
        )

        # === OBSERVE 阶段 ===
        # 将每个工具的执行结果追加到 messages
        for tool_call, result in zip(
            assistant_message["tool_calls"], tool_results
        ):
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": truncate_output(result, max_chars=50_000)
            })

        # 流式输出中间状态（可选）
        yield f"[Turn {turn}] 执行了 {len(tool_results)} 个工具调用"

    # 达到最大轮次限制
    yield "[警告] 达到最大迭代次数，强制停止"
```

#### 关键对比

| 维度 | 单轮问答 | Chain-of-Thought | Agentic Loop | Multi-Agent |
|------|----------|-------------------|--------------|-------------|
| 外部交互 | 无 | 无 | 每轮与环境交互 | 每轮 + Agent 间通信 |
| 推理步数 | 1 步 | 多步但一次输出 | 多轮迭代 | 多轮 + 多 Agent 协作 |
| 状态变化 | 无副作用 | 无副作用 | 真实修改环境状态 | 真实修改 + 共享状态 |
| 纠错能力 | 无 | 极弱 | 可根据结果调整 | 可交叉验证 |
| 适用场景 | 简单问答 | 数学推理 | 编程、调研 | 复杂工程任务 |
| Token 成本 | 低 | 中 | 高（累积上下文） | 极高 |

#### 实际案例

GitHub Copilot CLI 的 Agentic Loop 实现了一个典型的工业级循环。当用户请求"修复这个 bug"时，Agent 首先 Think — 分析错误信息，决定用 `grep` 搜索相关代码；然后 Act — 执行 `grep` 工具调用；接着 Observe — 读取搜索结果发现问题在 `src/auth.ts` 第 42 行。进入下一轮循环：Think — 决定用 `view` 查看具体代码；Act — 执行 `view`；Observe — 确认是空指针问题。再下一轮：Think — 决定用 `edit` 修复；Act — 执行 `edit`；Observe — 确认修改成功。最后一轮：Think — 决定运行测试验证；Act — 执行 `bash npm test`；Observe — 测试全部通过，输出最终文本响应，循环结束。整个过程经历了 4 轮 Think→Act→Observe 循环。

#### 面试追问

1. 如何设定合理的 `max_turns` 上限？设太小会怎样？设太大又有什么风险？
2. 在 Act 阶段，如果一次 LLM 响应包含多个 tool_calls，应该串行还是并行执行？判断依据是什么？
3. Observe 阶段如果工具返回了超大输出（如 10MB 的日志文件），你会如何截断？截断策略会影响 Agent 的决策质量吗？

</details>

---

### Q3: SSE（Server-Sent Events）协议的工作原理是什么？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

SSE（Server-Sent Events）是 Agent 系统中实现流式响应的核心协议。它是一种基于 HTTP 的单向通信机制：服务端可以持续地向客户端推送数据，而客户端只需建立一次 HTTP 连接即可持续接收。在 Agent 场景中，LLM 每生成一个 token 就通过 SSE 推送给客户端，实现了"边生成边显示"的打字机效果，极大提升了用户感知速度。

类比理解：传统 HTTP 请求像是去餐厅点餐——你下单后必须等所有菜做好才能上桌（Request-Response 模式）。而 SSE 像是火锅——食材一道一道端上来，你可以边吃边等下一道（流式推送模式）。对于 Agent 这种可能需要数十秒才能完成全部推理的场景，SSE 让用户在第一个 token 生成后就能看到输出，将感知延迟从"完整响应时间"降低到"首 token 时间（Time to First Token, TTFT）"。

SSE 与 WebSocket 的核心区别在于：SSE 是**单向**的（服务端 → 客户端），基于标准 HTTP 协议，天然支持断线重连和事件 ID 追踪；WebSocket 是**双向**的，使用独立协议（`ws://`），适合需要客户端频繁向服务端发送数据的场景（如聊天室、实时协作）。对于 Agent 的流式响应场景，SSE 是更简单、更合适的选择，因为客户端在等待响应时不需要向服务端发送额外数据。

#### 架构图

```
客户端（CLI/Web）                           服务端（API）
     │                                        │
     │  GET /v1/chat/completions               │
     │  Accept: text/event-stream              │
     │  ─────────────────────────────────────►  │
     │                                        │
     │  HTTP/1.1 200 OK                        │
     │  Content-Type: text/event-stream        │
     │  ◄─────────────────────────────────────  │
     │                                        │
     │  data: {"choices":[{"delta":{"content":  │
     │         "你"}}]}                        │
     │  ◄─────────────────────────────────────  │
     │                                        │
     │  data: {"choices":[{"delta":{"content":  │
     │         "好"}}]}                        │
     │  ◄─────────────────────────────────────  │
     │                                        │
     │  data: {"choices":[{"delta":{"content":  │
     │         "！"}}]}                        │
     │  ◄─────────────────────────────────────  │
     │                                        │
     │  data: [DONE]                           │
     │  ◄─────────────────────────────────────  │
     │                                        │
     │  ── 连接关闭 ──                          │
```

#### 代码示例

```typescript
// 服务端：SSE 流式推送 LLM 响应
import { Request, Response } from "express";

async function streamChatCompletion(req: Request, res: Response) {
  // 设置 SSE 响应头
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // 禁用 Nginx 缓冲
  });

  const { messages, model } = req.body;

  try {
    // 调用 LLM 推理引擎获取流式输出
    const stream = await inferenceEngine.chat({
      model,
      messages,
      stream: true,
    });

    let tokenCount = 0;

    for await (const chunk of stream) {
      tokenCount++;
      // SSE 协议格式：每个事件以 "data: " 开头，双换行结尾
      const payload = JSON.stringify({
        id: `chatcmpl-${req.id}`,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { content: chunk.text },
            finish_reason: null,
          },
        ],
      });
      res.write(`data: ${payload}\n\n`);
    }

    // 发送结束标记
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    // 通过 SSE event 类型发送错误信息
    res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
    res.end();
  }
}

// 客户端：解析 SSE 流
async function consumeSSEStream(url: string, body: object): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const json = JSON.parse(line.slice(6));
      const content = json.choices?.[0]?.delta?.content || "";
      fullContent += content;
      process.stdout.write(content); // 实时打印到终端
    }
  }
  return fullContent;
}
```

#### 关键对比

| 维度 | SSE | WebSocket | HTTP 长轮询 | gRPC Stream |
|------|-----|-----------|------------|-------------|
| 通信方向 | 单向（服务端→客户端） | 双向 | 模拟单向 | 双向 |
| 底层协议 | HTTP/1.1 或 HTTP/2 | 独立 ws:// 协议 | HTTP | HTTP/2 |
| 断线重连 | 内建支持 (Last-Event-ID) | 需自行实现 | 天然支持 | 需自行实现 |
| 代理兼容 | 优秀（标准 HTTP） | 较差（需升级协议） | 优秀 | 需 gRPC 代理 |
| 二进制支持 | 不支持（文本协议） | 支持 | 需编码 | 原生支持 |
| 适用场景 | LLM 流式输出 | 实时聊天/协作 | 兼容旧系统 | 微服务内部通信 |

#### 实际案例

OpenAI 的 Chat Completions API 是 SSE 协议在 Agent 领域最经典的应用。当请求中设置 `stream: true` 时，API 返回 `Content-Type: text/event-stream`，每个 SSE 事件包含一个 `chat.completion.chunk` 对象。客户端通过解析 `data:` 前缀的行来逐步拼接完整响应。值得注意的是，OpenAI 在 SSE 之上还实现了自定义的 `[DONE]` 结束标记，而非使用 SSE 原生的 `event: close` 机制，这已经成为行业事实标准——Anthropic、Google Gemini 等主流 LLM API 都采用了相同的约定。

#### 面试追问

1. SSE 连接在中间代理（如 Nginx、CDN）层容易被超时断开，如何解决？心跳机制怎么设计？
2. 如果需要在流式传输中发送结构化的 tool_call 事件（而非纯文本），SSE 的数据格式如何设计？
3. HTTP/2 的多路复用对 SSE 有什么影响？在高并发场景下，HTTP/1.1 和 HTTP/2 的 SSE 性能差异有多大？

</details>

---

### Q4: Agent 的 Tool 系统如何定义工具的输入输出 Schema？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Agent 的 Tool 系统是连接 LLM 推理能力与外部世界操作能力的桥梁。每个工具需要通过一套**严格的 Schema 定义**来告诉 LLM 三件事：这个工具能做什么（description）、需要什么参数（parameters）、参数有什么约束（type/enum/required）。这套 Schema 遵循 JSON Schema 标准，是 LLM Function Calling 功能的基础。

类比理解：工具的 Schema 就像一份"使用说明书"。想象你买了一台新家电，说明书会告诉你：这台机器用来做什么（功能描述），有哪些旋钮和按钮（参数列表），每个旋钮可以调到哪些档位（参数类型和取值范围），哪些按钮是必须按的、哪些是可选的（required 字段）。LLM 就是这个"用户"——它通过阅读 Schema 这份"说明书"来学会如何正确使用每个工具。

Schema 设计的好坏直接影响 Agent 的工具选择准确性。一个好的 Schema 需要做到：**description 精确且有区分度**（避免多个工具描述过于相似导致 LLM 混淆）、**参数类型严格约束**（用 enum 限制离散值、用 pattern 限制字符串格式）、**必选和可选参数区分明确**（减少 LLM 遗漏关键参数的概率）。工业实践中，工具 Schema 还会包含使用示例和使用场景说明，进一步引导 LLM 的决策。

#### 架构图

```
┌──────────────────────────────────────────────────────┐
│                    Tool Registry                      │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   bash       │  │   edit      │  │   grep      │  │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │  │
│  │ │ Schema  │ │  │ │ Schema  │ │  │ │ Schema  │ │  │
│  │ ├─────────┤ │  │ ├─────────┤ │  │ ├─────────┤ │  │
│  │ │Executor │ │  │ │Executor │ │  │ │Executor │ │  │
│  │ ├─────────┤ │  │ ├─────────┤ │  │ ├─────────┤ │  │
│  │ │Validator│ │  │ │Validator│ │  │ │Validator│ │  │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                       │
│  LLM 输出 ──► Schema 校验 ──► 参数解析 ──► 执行器     │
└──────────────────────────────────────────────────────┘
```

#### 代码示例

```python
from typing import Any
from pydantic import BaseModel, Field
from enum import Enum


class OutputMode(str, Enum):
    CONTENT = "content"
    FILES_WITH_MATCHES = "files_with_matches"
    COUNT = "count"


class GrepToolSchema(BaseModel):
    """基于 ripgrep 的快速代码搜索工具。
    用于在文件内容中搜索正则表达式模式。"""

    pattern: str = Field(
        description="要搜索的正则表达式模式"
    )
    path: str | None = Field(
        default=None,
        description="搜索的文件或目录路径，默认当前工作目录"
    )
    glob: str | None = Field(
        default=None,
        description="文件过滤 glob 模式，如 '*.py', '*.{ts,tsx}'"
    )
    output_mode: OutputMode = Field(
        default=OutputMode.FILES_WITH_MATCHES,
        description="输出格式：content 显示匹配行，"
                    "files_with_matches 仅显示路径，count 显示计数"
    )
    case_insensitive: bool = Field(
        default=False,
        alias="-i",
        description="是否大小写不敏感"
    )
    context_lines: int | None = Field(
        default=None,
        alias="-C",
        ge=0,
        le=20,
        description="匹配行前后的上下文行数（需要 output_mode='content'）"
    )


def schema_to_openai_tool(model: type[BaseModel]) -> dict[str, Any]:
    """将 Pydantic 模型转换为 OpenAI Function Calling 格式"""
    schema = model.model_json_schema()
    return {
        "type": "function",
        "function": {
            "name": model.__name__.replace("Schema", "").lower(),
            "description": model.__doc__ or "",
            "parameters": {
                "type": "object",
                "properties": schema.get("properties", {}),
                "required": schema.get("required", []),
            },
        },
    }


# 注册工具
TOOLS = [
    schema_to_openai_tool(GrepToolSchema),
]
```

#### 关键对比

| 维度 | JSON Schema (OpenAI) | MCP Protocol | LangChain Tools | 自定义 DSL |
|------|---------------------|--------------|-----------------|-----------|
| 标准化程度 | 行业事实标准 | Anthropic 主导新标准 | 框架内标准 | 团队内部标准 |
| LLM 兼容性 | 所有主流 LLM | Claude 系列原生 | 需适配层 | 需适配层 |
| 类型表达力 | 丰富（支持嵌套） | 丰富 + 资源抽象 | 中等 | 灵活但不通用 |
| 运行时校验 | 需额外实现 | 协议内建 | 框架内建 | 需自行实现 |
| 工具发现 | 静态注册 | 动态发现 | 静态注册 | 静态注册 |
| 适用场景 | 通用 API 调用 | 跨服务工具集成 | Python 生态 | 特定领域 |

#### 实际案例

Anthropic 推出的 MCP（Model Context Protocol）是工具 Schema 标准化的最新尝试。与 OpenAI 的 Function Calling 不同，MCP 将工具抽象为 `Tool`、`Resource`、`Prompt` 三种原语。Tool 对应可执行操作（如运行命令），Resource 对应可读取数据（如文件内容），Prompt 对应预置模板。这种分层抽象让 LLM 能更精确地理解"读取"和"执行"的语义区别。例如，`view` 是 Resource（只读），`edit` 是 Tool（有副作用），LLM 可以更安全地判断哪些操作需要用户确认。

#### 面试追问

1. 当两个工具的功能有部分重叠（如 `grep` 和 `search_code`），你会如何通过 Schema 设计帮助 LLM 正确区分和选择？
2. LLM 生成的工具调用参数可能不符合 Schema 约束（如类型错误、缺少必填字段），你会如何处理这些校验失败的情况？
3. 工具数量增加到 50+ 时，注入所有工具 Schema 到 System Prompt 会消耗大量 token，有什么优化策略？

</details>

---

## ⭐⭐ 进阶题

### Q5: 如何设计 Agent 的 Context Window 管理策略？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Context Window（上下文窗口）是 LLM 能同时处理的最大 token 数量，它是 Agent 系统中最宝贵也最容易被耗尽的资源。一个多轮 Agentic Loop 在执行过程中会不断累积 messages：每一轮的 LLM 输出、工具调用参数、工具返回结果都会追加到消息列表中。如果不加管理，context 很快就会被撑满，导致 LLM 无法继续工作或性能急剧下降。

类比理解：Context Window 就像你办公桌的桌面空间。你在处理一个复杂项目时，会不断地从文件柜里取出文件放到桌上。如果不及时整理，桌面很快就堆满了，你连新文件都没地方放。Context Window 管理就是"桌面整理术"——决定哪些文件放在手边（保留在 context 中）、哪些归档到文件柜（移出 context 但可检索）、哪些直接丢弃（永久移除）。

工业级的 Context Window 管理通常采用**分层策略**：第一层是**滑动窗口（Sliding Window）**，只保留最近 N 轮对话，丢弃最早的轮次；第二层是**摘要压缩（Summary Compression）**，将被丢弃的历史对话先用 LLM 生成摘要，保留关键信息；第三层是**优先级淘汰（Priority Eviction）**，根据内容类型设定保留优先级——系统指令永远保留、用户最新输入高优先级、中间工具调用结果低优先级。这三层策略组合使用，可以在有限的 token 空间内保持最大的信息密度。

#### 架构图

```
                    Context Window (200K tokens)
┌───────────────────────────────────────────────────────┐
│                                                        │
│  ┌──────────────────────────────────────────┐  永久   │
│  │  System Instructions (5K tokens)         │  保留   │
│  │  + Tool Definitions (3K tokens)          │  区域   │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  ┌──────────────────────────────────────────┐  压缩   │
│  │  Historical Summary (2K tokens)          │  摘要   │
│  │  "之前已完成：搜索了 auth 模块,           │  区域   │
│  │   修复了 3 个 bug, 更新了测试..."         │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  ┌──────────────────────────────────────────┐         │
│  │  Recent Conversation (滑动窗口)           │  活跃   │
│  │  ┌────────────────────────────────┐      │  对话   │
│  │  │ Turn N-4: user + assistant      │      │  区域   │
│  │  │ Turn N-3: user + assistant      │      │         │
│  │  │ Turn N-2: user + tool_results   │      │         │
│  │  │ Turn N-1: user + assistant      │      │         │
│  │  │ Turn N:   user (当前输入)        │      │         │
│  │  └────────────────────────────────┘      │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  ┌──────────────────────────────────────────┐  预留   │
│  │  Reserved for LLM Output (~4K tokens)    │  输出   │
│  └──────────────────────────────────────────┘  空间   │
│                                                        │
└───────────────────────────────────────────────────────┘

  淘汰流程：
  旧对话轮次 ──► LLM 摘要压缩 ──► 追加到 Summary 区域
              ──► 工具输出截断 ──► 保留首尾 N 行
              ──► 重复内容去重 ──► 合并相似工具结果
```

#### 代码示例

```python
from dataclasses import dataclass, field

@dataclass
class ContextWindowManager:
    max_tokens: int = 200_000
    reserved_for_output: int = 4_096
    system_prompt_tokens: int = 0
    summary: str = ""
    messages: list[dict] = field(default_factory=list)

    @property
    def available_tokens(self) -> int:
        return self.max_tokens - self.reserved_for_output - self.system_prompt_tokens

    def add_message(self, message: dict) -> None:
        self.messages.append(message)
        self._enforce_limits()

    def _enforce_limits(self) -> None:
        """分层淘汰策略"""
        total = self._count_tokens(self.messages)

        while total > self.available_tokens and len(self.messages) > 2:
            # 策略1：截断超长工具输出
            truncated = self._truncate_tool_outputs()
            if truncated:
                total = self._count_tokens(self.messages)
                continue

            # 策略2：压缩最旧的对话轮次为摘要
            oldest_turn = self._extract_oldest_turn()
            if oldest_turn:
                turn_summary = self._summarize_turn(oldest_turn)
                self.summary += f"\n{turn_summary}"
                total = self._count_tokens(self.messages)
                continue

            # 策略3：强制丢弃（最后手段）
            self.messages.pop(0)
            total = self._count_tokens(self.messages)

    def _truncate_tool_outputs(self, max_chars: int = 30_000) -> bool:
        """截断超长的工具执行结果，保留首尾内容"""
        truncated_any = False
        for msg in self.messages:
            if msg["role"] == "tool" and len(msg["content"]) > max_chars:
                content = msg["content"]
                head = content[:max_chars // 2]
                tail = content[-max_chars // 2:]
                msg["content"] = (
                    f"{head}\n\n... [截断了 "
                    f"{len(content) - max_chars} 字符] ...\n\n{tail}"
                )
                truncated_any = True
        return truncated_any

    def _extract_oldest_turn(self) -> list[dict] | None:
        """提取最旧的完整对话轮次（user + assistant + tool_results）"""
        if len(self.messages) < 4:
            return None
        turn = []
        while self.messages and self.messages[0]["role"] != "user":
            turn.append(self.messages.pop(0))
        if self.messages and self.messages[0]["role"] == "user":
            turn.append(self.messages.pop(0))
        return turn if turn else None

    def _summarize_turn(self, turn: list[dict]) -> str:
        """用 LLM 将旧对话轮次压缩为一句话摘要"""
        turn_text = "\n".join(m.get("content", "")[:500] for m in turn)
        # 实际实现中调用轻量级 LLM 生成摘要
        return f"[摘要] {turn_text[:200]}..."

    def _count_tokens(self, messages: list[dict]) -> int:
        """估算 token 数量（生产环境使用 tiktoken）"""
        return sum(len(m.get("content", "")) // 3 for m in messages)

    def build_prompt(self, system_prompt: str) -> list[dict]:
        """组装最终发送给 LLM 的 messages 列表"""
        result = [{"role": "system", "content": system_prompt}]
        if self.summary:
            result.append({
                "role": "system",
                "content": f"[历史操作摘要]\n{self.summary}"
            })
        result.extend(self.messages)
        return result
```

#### 关键对比

| 策略 | Token 利用率 | 信息保真度 | 实现复杂度 | 延迟影响 |
|------|-------------|-----------|-----------|---------|
| 简单截断（丢弃最旧） | 低 | 低（丢失历史上下文） | 极低 | 无 |
| 滑动窗口 | 中 | 中（保留最近 N 轮） | 低 | 无 |
| 摘要压缩 | 高 | 中高（摘要有信息损失） | 中（需额外 LLM 调用） | 增加 1-2 秒 |
| RAG 检索增强 | 高 | 高（按需精确检索） | 高（需向量库基础设施） | 增加 0.5-1 秒 |
| 混合策略（推荐） | 最高 | 最高 | 高 | 增加 1-3 秒 |

#### 实际案例

Claude 的 200K context window 看似很大，但在复杂的 Agentic 任务中仍然会被快速消耗。以一个"重构整个项目的认证模块"任务为例：System Prompt 占用约 8K tokens，项目规范文件占用 5K，工具定义占用 3K，留给实际对话的空间约 180K。如果每轮 Agentic Loop 平均消耗 3K tokens（LLM 输出 1K + 工具结果 2K），那么大约 60 轮后 context 就会被耗尽。GitHub Copilot CLI 的解决方案是采用混合策略：工具输出超过 50K 字符时自动截断（保留首尾各 25K）；超过 15 轮的历史对话使用摘要压缩；系统指令和工具定义作为固定开销始终保留。这种策略使得 Agent 可以处理超过 100 轮迭代的复杂任务而不会丢失关键上下文。

#### 面试追问

1. 摘要压缩时使用的 LLM 模型应该和主推理模型相同吗？使用更小的模型做摘要有什么权衡？
2. 当 Agent 需要引用很久之前的对话内容（如"按照我们之前讨论的方案来做"）时，滑动窗口策略会丢失这些信息，如何解决？
3. 不同类型的消息（系统指令、用户输入、工具结果、LLM 输出）应该分配怎样的 token 预算比例？你会如何设计这个预算分配策略？

</details>
### Q6: 多 Tool 并发执行时如何处理资源冲突？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

在 Agent 系统中，LLM 的一次推理可能触发多个 Tool 并发调用——例如同时查询数据库、调用外部 API、读写文件系统。当多个 Tool 同时操作同一资源（如同一张数据库表、同一个文件、同一个第三方 API 配额）时，就会出现资源冲突。处理不当会导致数据不一致、竞态条件甚至死锁。

资源冲突的本质可以类比为"多个厨师同时使用一个灶台"。如果两个厨师都想在同一时间用同一个锅，要么排队（互斥锁），要么各用各的锅（资源隔离），要么提前协调好分工（调度策略）。Agent 工程中的资源冲突管理本质上就是这三种思路的技术映射。

核心挑战在于：Agent 的 Tool 调用顺序具有不确定性（由 LLM 推理决定），传统的静态并发控制策略无法完全适用。我们需要在 Tool 执行层引入**动态冲突检测**和**自适应调度**机制，在保证正确性的前提下最大化并行度。

#### 架构图

```
┌─────────────────────────────────────────────┐
│              LLM Planning Layer              │
│  tool_calls: [tool_A, tool_B, tool_C]       │
└──────────────────┬──────────────────────────┘
                   │ 并发 Tool 请求
                   ▼
┌─────────────────────────────────────────────┐
│           Conflict Detector (冲突检测器)      │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │资源标签  │  │依赖分析   │  │冲突矩阵   │  │
│  │提取     │  │          │  │查询       │  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
│       └────────────┼──────────────┘         │
│                    ▼                        │
│           ┌────────────────┐                │
│           │ 调度决策引擎    │                │
│           └───┬────┬───┬──┘                │
└───────────────┼────┼───┼────────────────────┘
          ┌─────┘    │   └─────┐
          ▼          ▼         ▼
    ┌──────────┐ ┌────────┐ ┌──────────┐
    │ 并行执行  │ │串行队列│ │ 合并执行  │
    │ (无冲突) │ │(有冲突) │ │ (可合并) │
    └──────────┘ └────────┘ └──────────┘
```

#### 代码示例

```python
import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine

class ConflictType(Enum):
    NONE = "none"
    READ_WRITE = "read_write"
    WRITE_WRITE = "write_write"

@dataclass
class ResourceDescriptor:
    """每个 Tool 声明自己需要访问的资源及读写模式"""
    resource_id: str          # 如 "db:users", "file:/config.yaml"
    mode: str = "read"        # "read" | "write"

@dataclass
class ToolTask:
    name: str
    resources: list[ResourceDescriptor]
    execute: Callable[..., Coroutine]
    args: dict = field(default_factory=dict)

class ConflictAwareScheduler:
    """基于资源声明的冲突感知调度器"""

    def __init__(self):
        self._resource_locks: dict[str, asyncio.Lock] = {}
        self._rw_locks: dict[str, _RWLock] = {}

    def detect_conflicts(self, tasks: list[ToolTask]) -> dict[str, ConflictType]:
        """分析所有任务间的冲突关系"""
        resource_map: dict[str, list[tuple[str, str]]] = {}
        for task in tasks:
            for res in task.resources:
                resource_map.setdefault(res.resource_id, []).append(
                    (task.name, res.mode)
                )
        conflicts = {}
        for res_id, accessors in resource_map.items():
            writers = [name for name, mode in accessors if mode == "write"]
            readers = [name for name, mode in accessors if mode == "read"]
            if len(writers) > 1:
                conflicts[res_id] = ConflictType.WRITE_WRITE
            elif writers and readers:
                conflicts[res_id] = ConflictType.READ_WRITE
        return conflicts

    async def execute_all(self, tasks: list[ToolTask]) -> dict[str, Any]:
        """冲突感知地执行所有 Tool 任务"""
        conflicts = self.detect_conflicts(tasks)
        groups = self._build_execution_groups(tasks, conflicts)
        results = {}
        for group in groups:
            # 同一组内的任务可以安全并行
            group_results = await asyncio.gather(
                *[self._safe_execute(task) for task in group],
                return_exceptions=True,
            )
            for task, result in zip(group, group_results):
                results[task.name] = result
        return results

    def _build_execution_groups(
        self, tasks: list[ToolTask], conflicts: dict
    ) -> list[list[ToolTask]]:
        """将任务划分为可并行的执行组"""
        if not conflicts:
            return [tasks]  # 无冲突，全部并行

        # 简化策略：写冲突任务串行，其余并行
        serial_tasks, parallel_tasks = [], []
        conflict_resources = set(conflicts.keys())
        for task in tasks:
            task_resources = {r.resource_id for r in task.resources if r.mode == "write"}
            if task_resources & conflict_resources:
                serial_tasks.append(task)
            else:
                parallel_tasks.append(task)

        groups = []
        if parallel_tasks:
            groups.append(parallel_tasks)
        for task in serial_tasks:
            groups.append([task])
        return groups

    async def _safe_execute(self, task: ToolTask) -> Any:
        """带资源锁保护地执行单个 Tool"""
        locks_to_acquire = []
        for res in task.resources:
            if res.resource_id not in self._resource_locks:
                self._resource_locks[res.resource_id] = asyncio.Lock()
            if res.mode == "write":
                locks_to_acquire.append(self._resource_locks[res.resource_id])

        # 按 resource_id 排序获取锁，避免死锁
        locks_to_acquire.sort(key=lambda l: id(l))
        for lock in locks_to_acquire:
            await lock.acquire()
        try:
            return await task.execute(**task.args)
        finally:
            for lock in locks_to_acquire:
                lock.release()
```

#### 关键对比

| 维度 | 互斥锁（Mutex） | 读写锁（RWLock） | 乐观并发控制（OCC） | 资源隔离 |
|------|-----------------|-------------------|---------------------|----------|
| 并发度 | 最低 | 读并行，写串行 | 高（冲突时重试） | 最高 |
| 实现复杂度 | 低 | 中 | 高 | 中 |
| 适用场景 | 简单工具 | 读多写少 | 冲突罕见 | 资源可拷贝 |
| 死锁风险 | 有（需排序） | 有 | 无 | 无 |
| 典型延迟开销 | 队列等待 | 写者等待 | 重试开销 | 内存/拷贝开销 |

#### 实际案例

在 LangChain 的 `AgentExecutor` 中，当启用 `max_concurrency` 参数时，多个 Tool 会并发执行。实际生产环境中，某金融公司的 Agent 系统同时调用"查询账户余额"（读 DB）和"转账操作"（写 DB）时遇到了竞态条件——余额查询读到了转账前的快照，导致 Agent 基于过时数据做出了错误决策。解决方案是在 Tool 注册时声明资源访问模式，调度器自动将有写冲突的 Tool 编入串行组，读操作则可以通过 MVCC 快照隔离保持并发。

#### 面试追问

1. 如果 Tool 的资源访问模式在运行时才能确定（如动态 SQL），冲突检测该如何处理？
2. 大规模 Agent 系统中，锁粒度如何选择？表级锁 vs 行级锁 vs 乐观锁的权衡？
3. 分布式环境下多个 Agent 实例同时调用相同 Tool，如何实现跨节点的资源冲突控制？

</details>

---

### Q7: API 网关层的限流策略如何设计？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

API 网关是 Agent 系统面向外部的第一道防线，承担着流量管控、请求路由、安全过滤等核心职责。对于 Agent 系统而言，限流策略的设计尤为关键，原因有三：第一，LLM 推理调用成本高昂（每次请求可能消耗数千 Token）；第二，下游 LLM Provider（如 OpenAI、Anthropic）本身有 TPM/RPM 限制；第三，Agent 的多轮 Tool 调用会产生**请求放大效应**——用户的一个请求可能触发 5-10 次内部 API 调用。

限流的本质可以类比为"高速公路的收费站"。收费站的作用不是阻止车辆通行，而是控制进入高速的车流速度，避免道路拥堵。同样，API 网关的限流不是拒绝用户，而是通过平滑流量、分级管控来保护后端服务的稳定运行。

设计限流策略需要回答三个核心问题：按什么维度限（用户/IP/API Key/模型）、用什么算法限（令牌桶/滑动窗口/漏桶）、超限后怎么办（拒绝/排队/降级）。在 Agent 场景下还需额外考虑 Token 维度的限流——不同于传统 API 只计算请求数，LLM API 需要同时计算请求数和 Token 消耗量。

#### 架构图

```
                    用户请求
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              API Gateway (网关层)              │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 身份识别  │→│ 限流判定  │→│ 路由分发   │  │
│  │ (API Key) │  │          │  │           │  │
│  └──────────┘  └────┬─────┘  └───────────┘  │
│                     │                        │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│   ┌──────────┐ ┌─────────┐ ┌─────────┐      │
│   │ RPM 限流 │ │TPM 限流 │ │并发限流  │      │
│   │(请求/分) │ │(Token/分)│ │(同时在线)│      │
│   └──────────┘ └─────────┘ └─────────┘      │
│         │           │           │            │
│         └───────────┼───────────┘            │
│                     ▼                        │
│            ┌────────────────┐                │
│            │  超限处理策略    │                │
│            │ 429 / Queue /  │                │
│            │ Degrade / Shed │                │
│            └────────────────┘                │
└──────────────────────────────────────────────┘
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
     ┌──────────┐ ┌─────────┐ ┌─────────┐
     │ LLM 推理  │ │ Tool 服务│ │ 向量检索 │
     │ 集群      │ │ 集群     │ │ 服务    │
     └──────────┘ └─────────┘ └─────────┘
```

#### 代码示例

```python
import time
import asyncio
from dataclasses import dataclass
from collections import defaultdict

@dataclass
class RateLimitConfig:
    """多维度限流配置"""
    rpm: int = 60            # Requests Per Minute
    tpm: int = 100_000       # Tokens Per Minute
    concurrent: int = 10     # 最大并发数
    burst_multiplier: float = 1.5  # 突发流量倍率

class SlidingWindowCounter:
    """滑动窗口计数器 — 兼顾精度与内存效率"""

    def __init__(self, window_seconds: int = 60, granularity: int = 6):
        self.window = window_seconds
        self.granularity = granularity
        self.slot_duration = window_seconds / granularity
        self.slots: list[tuple[float, int]] = []

    def _cleanup(self, now: float):
        cutoff = now - self.window
        self.slots = [(ts, count) for ts, count in self.slots if ts > cutoff]

    def add(self, now: float, count: int = 1):
        self._cleanup(now)
        current_slot = int(now / self.slot_duration) * self.slot_duration
        for i, (ts, c) in enumerate(self.slots):
            if ts == current_slot:
                self.slots[i] = (ts, c + count)
                return
        self.slots.append((current_slot, count))

    def total(self, now: float) -> int:
        self._cleanup(now)
        return sum(count for _, count in self.slots)

class AgentRateLimiter:
    """Agent 场景的多维度限流器"""

    def __init__(self):
        self._configs: dict[str, RateLimitConfig] = {}
        self._rpm_counters: dict[str, SlidingWindowCounter] = defaultdict(SlidingWindowCounter)
        self._tpm_counters: dict[str, SlidingWindowCounter] = defaultdict(SlidingWindowCounter)
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._request_queue: dict[str, asyncio.Queue] = {}

    def register_tier(self, tier: str, config: RateLimitConfig):
        self._configs[tier] = config
        self._semaphores[tier] = asyncio.Semaphore(config.concurrent)
        self._request_queue[tier] = asyncio.Queue(maxsize=config.rpm * 2)

    async def check_and_acquire(
        self, api_key: str, tier: str, estimated_tokens: int
    ) -> dict:
        """检查限流并获取执行许可，返回限流状态"""
        config = self._configs.get(tier)
        if not config:
            return {"allowed": False, "reason": "unknown_tier"}

        now = time.time()

        # 维度一：RPM 检查
        rpm_current = self._rpm_counters[api_key].total(now)
        if rpm_current >= config.rpm:
            retry_after = self._estimate_retry_after(api_key, config)
            return {
                "allowed": False,
                "reason": "rpm_exceeded",
                "retry_after": retry_after,
                "current_rpm": rpm_current,
                "limit_rpm": config.rpm,
            }

        # 维度二：TPM 检查
        tpm_current = self._tpm_counters[api_key].total(now)
        if tpm_current + estimated_tokens > config.tpm:
            return {
                "allowed": False,
                "reason": "tpm_exceeded",
                "current_tpm": tpm_current,
                "limit_tpm": config.tpm,
            }

        # 维度三：并发检查
        sem = self._semaphores[tier]
        if sem.locked() and sem._value == 0:
            return {"allowed": False, "reason": "concurrent_exceeded"}

        # 通过所有检查 → 记录并放行
        self._rpm_counters[api_key].add(now)
        self._tpm_counters[api_key].add(now, estimated_tokens)
        await sem.acquire()
        return {"allowed": True, "semaphore": sem}

    def _estimate_retry_after(self, api_key: str, config: RateLimitConfig) -> float:
        """估算客户端应等待的时间"""
        now = time.time()
        counter = self._rpm_counters[api_key]
        if counter.slots:
            oldest_slot_time = min(ts for ts, _ in counter.slots)
            return max(0, oldest_slot_time + 60 - now)
        return 1.0
```

#### 关键对比

| 维度 | 固定窗口 | 滑动窗口 | 令牌桶 | 漏桶 |
|------|---------|---------|--------|------|
| 精度 | 低（边界突刺） | 高 | 中 | 高 |
| 内存消耗 | 极低 | 中 | 低 | 低 |
| 突发处理 | 允许窗口初期突发 | 平滑 | 允许可控突发 | 完全平滑 |
| 实现难度 | 简单 | 中等 | 中等 | 简单 |
| Agent 场景适用性 | 不推荐 | RPM 限流首选 | TPM 限流首选 | 排队场景 |

#### 实际案例

OpenAI 的 API 限流采用 RPM + TPM 双维度设计：免费用户 3 RPM / 40K TPM，付费用户根据 Tier 逐级提升至 10K RPM / 2M TPM。在生产环境中，某 SaaS 公司的 Agent 平台在接入 100+ 企业客户后，单纯的 RPM 限流无法公平分配资源——某个客户发送少量请求但每次消耗 128K Token，挤占了其他客户的 TPM 配额。最终方案是引入**加权公平队列（WFQ）**，按 Token 消耗量而非请求数分配带宽，同时为每个 Tier 预留最低保障 Token 额度。

#### 面试追问

1. 分布式网关集群中，如何实现全局一致的限流计数？Redis + Lua 脚本的原子性如何保证？
2. Agent 的 Tool 调用产生的内部请求是否应纳入限流计算？如何避免用户级限流误杀合法的多轮对话？
3. 如何根据后端 LLM 的实时负载动态调整限流阈值（自适应限流）？

</details>

---

### Q8: 认证鉴权链路（API Key → JWT → OAuth2）如何选型？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Agent 系统的认证鉴权链路需要解决三个层面的身份验证问题：**用户是谁**（Authentication）、**用户能做什么**（Authorization）、**Agent 代替用户操作时的权限边界是什么**（Delegation）。第三个问题是 Agent 系统独有的挑战——传统 Web 应用的用户直接操作资源，而 Agent 系统中存在"用户 → Agent → Tool → 资源"的间接调用链，鉴权模型需要覆盖整条链路。

三种主流认证方案可以类比为三种"通行证"：API Key 像一把万能钥匙——简单直接但丢了就完了；JWT 像一张写有详细权限的员工证——自包含、可验证、有过期时间；OAuth2 像一套完整的委托授权体系——"我授权这个 Agent 代替我在 GitHub 上读取仓库，但不能删除"。

在 Agent 全链路中，这三种方案往往不是互斥选择，而是分层组合使用：外层用 API Key 做服务间快速认证，中间层用 JWT 传递用户身份和权限声明，Agent 调用第三方服务时用 OAuth2 进行委托授权。关键在于理解每一层解决什么问题，以及它们如何串联成一条完整的鉴权链路。

#### 架构图

```
用户/客户端
    │
    │ API Key (X-API-Key Header)
    ▼
┌────────────────────────────────────────┐
│          API Gateway (网关层)           │
│  ① 验证 API Key → 识别租户/应用        │
│  ② 签发短期 JWT（含 user_id, scopes） │
└──────────────────┬─────────────────────┘
                   │ JWT (Authorization: Bearer)
                   ▼
┌────────────────────────────────────────┐
│          Agent Service (代理层)         │
│  ③ 验证 JWT 签名 + 过期时间            │
│  ④ 提取 scopes，构建权限上下文          │
│  ⑤ 按 scopes 过滤可用 Tool 列表        │
└──────────────────┬─────────────────────┘
                   │ 需要访问第三方服务
                   ▼
┌────────────────────────────────────────┐
│       OAuth2 Token Exchange            │
│  ⑥ 用户预先授权的 OAuth2 Token         │
│  ⑦ Agent 携带 access_token 调用       │
│  ⑧ 权限范围严格限定于用户授权的 scope   │
└──────────────────┬─────────────────────┘
                   │ OAuth2 access_token
                   ▼
           ┌───────────────┐
           │  第三方服务     │
           │ (GitHub/Slack) │
           └───────────────┘
```

#### 代码示例

```typescript
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';

// === 三层认证体系实现 ===

interface AuthContext {
  tenantId: string;
  userId: string;
  scopes: string[];
  oauthTokens: Record<string, string>;  // provider → access_token
}

// 第一层：API Key 验证 + JWT 签发
class ApiKeyAuthenticator {
  private readonly jwtSecret: string;
  private readonly keyStore: Map<string, { tenantId: string; tier: string }>;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
    this.keyStore = new Map();
  }

  async authenticate(apiKey: string): Promise<string> {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const record = this.keyStore.get(keyHash);
    if (!record) {
      throw new AuthError('INVALID_API_KEY', 'API Key 无效或已过期');
    }

    // 签发短期 JWT（15 分钟有效期）
    const token = jwt.sign(
      {
        tenant_id: record.tenantId,
        tier: record.tier,
        scopes: await this.loadTenantScopes(record.tenantId),
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      { expiresIn: '15m', algorithm: 'HS256' }
    );
    return token;
  }

  private async loadTenantScopes(tenantId: string): Promise<string[]> {
    // 从数据库加载租户权限
    return ['agent:chat', 'tool:web_search', 'tool:code_exec'];
  }
}

// 第二层：JWT 验证 + 权限过滤
class JwtAuthorizer {
  private readonly jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }

  verify(token: string): AuthContext {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as any;
      return {
        tenantId: payload.tenant_id,
        userId: payload.sub ?? payload.tenant_id,
        scopes: payload.scopes ?? [],
        oauthTokens: {},
      };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AuthError('TOKEN_EXPIRED', 'JWT 已过期，请重新认证');
      }
      throw new AuthError('INVALID_TOKEN', 'JWT 验证失败');
    }
  }

  filterToolsByScope(allTools: string[], scopes: string[]): string[] {
    const allowedPrefixes = scopes
      .filter(s => s.startsWith('tool:'))
      .map(s => s.replace('tool:', ''));
    return allTools.filter(tool =>
      allowedPrefixes.some(prefix => tool.startsWith(prefix))
    );
  }
}

// 第三层：OAuth2 委托授权
class OAuthDelegator {
  private readonly tokenStore: Map<string, Map<string, OAuthToken>>;

  constructor() {
    this.tokenStore = new Map();
  }

  async getAccessToken(userId: string, provider: string): Promise<string> {
    const userTokens = this.tokenStore.get(userId);
    if (!userTokens || !userTokens.has(provider)) {
      throw new AuthError(
        'OAUTH_NOT_CONNECTED',
        `用户未授权 ${provider}，请先完成 OAuth 授权流程`
      );
    }

    const token = userTokens.get(provider)!;
    if (token.expiresAt < Date.now()) {
      return await this.refreshToken(userId, provider, token);
    }
    return token.accessToken;
  }

  private async refreshToken(
    userId: string, provider: string, token: OAuthToken
  ): Promise<string> {
    // 使用 refresh_token 刷新 access_token
    // 省略具体 HTTP 调用逻辑
    return token.accessToken;
  }
}

interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
```

#### 关键对比

| 维度 | API Key | JWT | OAuth2 |
|------|---------|-----|--------|
| 核心用途 | 服务/租户识别 | 用户身份+权限传递 | 第三方委托授权 |
| 有状态/无状态 | 有状态（需查库） | 无状态（自验证） | 有状态（Token 存储） |
| 过期机制 | 手动吊销 | 自动过期（exp） | access_token 短期 + refresh |
| 权限粒度 | 粗（租户级） | 中（scopes 声明） | 细（resource-level） |
| Agent 场景角色 | 入口认证 | 链路传递 | Tool 调用第三方 |
| 安全风险 | 泄漏=全权限 | 泄漏=短期有限权限 | 泄漏=限定 scope 权限 |

#### 实际案例

OpenAI 的 GPTs（Custom GPTs）在调用第三方 Actions 时采用了典型的分层认证设计：用户通过 API Key 访问 OpenAI 平台，OpenAI 内部使用 JWT 传递用户身份，当 GPT 需要调用外部 API（如 Zapier）时，通过 OAuth2 委托授权获取用户在 Zapier 上的操作权限。这样即使 GPT 被恶意 Prompt Injection 攻击，其能做的操作也被 OAuth2 scope 严格限定（如只能读邮件，不能发邮件），实现了**最小权限原则**。

#### 面试追问

1. Agent 调用 Tool 时，如何防止 Prompt Injection 绕过鉴权？（如恶意 Prompt 让 Agent 调用未授权的 Tool）
2. 多租户 Agent 平台中，租户 A 的 Agent 是否可能越权访问租户 B 的数据？如何通过鉴权链路杜绝？
3. JWT 无状态特性意味着无法即时吊销——如果发现 Token 泄漏，如何快速失效已签发的 JWT？

</details>

---

### Q9: 流式响应经过的每一层分别承担什么职责？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

LLM 的推理过程是逐 Token 生成的，为了降低用户感知的首 Token 延迟（Time To First Token, TTFT），Agent 系统采用流式响应（Streaming Response）将生成的 Token 实时推送给前端，而非等待完整生成后一次性返回。但在 Agent 全链路中，一个 Token 从 GPU 生成到用户屏幕上渲染，要经过 5-7 层中间件，每一层都有独特的职责。

可以将流式响应类比为"自来水管道系统"。水（Token）从水厂（GPU）出发，经过净水厂（安全过滤）、加压站（协议转换）、主干管（网关）、支线管（负载均衡）、水表（计量计费）、最终到达水龙头（浏览器渲染）。任何一个环节出现"堵塞"或"断裂"，用户端的体验都会受到影响。

流式响应设计的核心挑战在于：每一层既要"透传"数据（低延迟），又要"处理"数据（各层职责），还要"容错"（某一层出错时优雅降级）。这要求整条链路的每个组件都支持流式处理，任何一个组件如果"先收集完再转发"，都会破坏端到端的流式效果。

#### 架构图

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: LLM Inference Engine (推理引擎层)              │
│  职责：逐 Token 生成 → 输出 logprobs + token_id         │
│  协议：内部 gRPC stream / NCCL                          │
└───────────────────────┬─────────────────────────────────┘
                        │ token stream
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Model Server (模型服务层 / vLLM / TGI)         │
│  职责：Detokenize → 安全审查 → 组装 SSE chunk           │
│  处理：stop sequence 检测 / tool_call JSON 累积          │
└───────────────────────┬─────────────────────────────────┘
                        │ SSE: data: {"choices":[{"delta":{"content":"你"}}]}
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Agent Orchestrator (编排层)                     │
│  职责：解析 tool_call → 拦截执行 → 拼接 Tool 结果        │
│  关键：流中检测 function_call 时暂停输出 → 执行 → 恢复   │
└───────────────────────┬─────────────────────────────────┘
                        │ SSE (含 tool 执行状态事件)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 4: API Gateway (网关层)                           │
│  职责：限流计数（按 Token）/ 日志采集 / 响应头注入        │
│  注意：不可缓冲 → 必须逐 chunk 转发（chunked encoding） │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP/1.1 chunked / HTTP/2 stream
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 5: CDN / Load Balancer (接入层)                    │
│  职责：TLS 终止 / 连接保活 / 超时配置                     │
│  陷阱：默认 proxy_buffering on 会破坏流式！               │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS stream
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 6: Client SDK (客户端 SDK 层)                      │
│  职责：SSE 解析 / 断线重连 / Token 拼接为完整消息         │
│  实现：EventSource API / fetch + ReadableStream          │
└───────────────────────┬─────────────────────────────────┘
                        │ parsed tokens
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 7: UI Rendering (前端渲染层)                       │
│  职责：逐字渲染 / Markdown 实时解析 / 代码高亮            │
│  优化：requestAnimationFrame 批量更新 / 虚拟滚动          │
└─────────────────────────────────────────────────────────┘
```

#### 代码示例

```python
import asyncio
import json
from typing import AsyncIterator
from dataclasses import dataclass

@dataclass
class StreamChunk:
    """统一的流式数据块"""
    event_type: str          # "token" | "tool_call" | "tool_result" | "done" | "error"
    content: str = ""
    tool_name: str = ""
    metadata: dict = None

    def to_sse(self) -> str:
        payload = {"type": self.event_type, "content": self.content}
        if self.tool_name:
            payload["tool"] = self.tool_name
        if self.metadata:
            payload["metadata"] = self.metadata
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

class StreamingOrchestrator:
    """编排层：流式响应的核心中间层"""

    def __init__(self, tool_registry: dict):
        self.tools = tool_registry
        self._buffer = ""  # 用于累积可能的 tool_call JSON

    async def process_stream(
        self, upstream: AsyncIterator[str]
    ) -> AsyncIterator[StreamChunk]:
        """处理上游 LLM 的 token 流，识别并执行 tool_call"""
        tool_call_mode = False
        tool_call_buffer = ""

        async for raw_chunk in upstream:
            delta = self._parse_delta(raw_chunk)

            if delta.get("tool_calls"):
                # 进入 tool_call 模式：暂停向下游输出文本
                tool_call_mode = True
                tool_call_buffer += delta["tool_calls"][0].get("arguments", "")
                yield StreamChunk(event_type="tool_call", content="⏳ 正在调用工具...")
                continue

            if tool_call_mode and delta.get("finish_reason") == "tool_calls":
                # tool_call JSON 累积完毕 → 执行 Tool
                tool_result = await self._execute_tool(tool_call_buffer)
                yield StreamChunk(
                    event_type="tool_result",
                    content=tool_result,
                    tool_name=self._extract_tool_name(tool_call_buffer),
                )
                tool_call_mode = False
                tool_call_buffer = ""
                continue

            if not tool_call_mode:
                # 普通 token → 直接透传
                content = delta.get("content", "")
                if content:
                    yield StreamChunk(event_type="token", content=content)

        yield StreamChunk(event_type="done")

    async def _execute_tool(self, args_json: str) -> str:
        parsed = json.loads(args_json)
        tool_fn = self.tools.get(parsed.get("name"))
        if not tool_fn:
            return f"未知工具: {parsed.get('name')}"
        return await tool_fn(**parsed.get("arguments", {}))

    def _extract_tool_name(self, buffer: str) -> str:
        try:
            return json.loads(buffer).get("name", "unknown")
        except json.JSONDecodeError:
            return "unknown"

    def _parse_delta(self, raw: str) -> dict:
        try:
            obj = json.loads(raw.removeprefix("data: "))
            return obj.get("choices", [{}])[0].get("delta", {})
        except (json.JSONDecodeError, IndexError):
            return {}
```

#### 关键对比

| 层级 | 延迟贡献 | 常见陷阱 | 关键配置 |
|------|---------|---------|---------|
| 推理引擎 | TTFT: 200ms~2s | batch 过大导致排队 | `max_batch_size` |
| 模型服务 | <5ms/chunk | stop sequence 漏检 | `stream=True` |
| 编排层 | Tool 执行耗时 | tool_call 检测不完整 | 流式 JSON 解析 |
| API 网关 | <1ms/chunk | 缓冲整个响应后转发 | `proxy_buffering off` |
| CDN/LB | <2ms/chunk | 空闲超时断连 | `proxy_read_timeout 300s` |
| 客户端 SDK | <1ms | SSE 重连策略缺失 | `EventSource` 配置 |
| UI 渲染 | 16ms (60fps) | 每个 token 触发重排 | `rAF` 批量更新 |

#### 实际案例

ChatGPT 的流式响应链路是一个经典参考：GPU 集群上的推理引擎（据推测使用了定制的 TritonServer）逐 Token 输出，经过 Azure 的内部网关层到达 ChatGPT 的 API 服务，再通过 Cloudflare CDN 到达用户浏览器。曾有开发者发现 ChatGPT 在某些地区响应突然变慢——原因是中间某层 CDN 节点启用了 `gzip` 压缩，导致 CDN 需要先缓冲足够数据才能压缩输出，破坏了流式效果。OpenAI 后来在响应头中添加了 `X-Accel-Buffering: no` 以禁止中间层缓冲。

#### 面试追问

1. 当 Agent 在流式输出过程中需要调用 Tool（如搜索），如何优雅地"暂停"文本流、展示 Tool 执行状态、再"恢复"文本流？
2. 流式响应中如何实现 Token 级别的计费？每个 chunk 只包含一个 Token 吗？
3. 如果用户中途取消请求（关闭页面），如何让整条流式链路优雅地终止推理、释放 GPU 资源？

</details>

---

### Q10: Prefill-Decode 分离架构的设计原理和收益是什么？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Prefill-Decode 分离（又称 Disaggregated Serving / PD 分离）是 LLM 推理服务架构的一次重大范式转变。传统 LLM 推理将 Prefill（处理输入 Prompt，计算 KV Cache）和 Decode（逐 Token 自回归生成）放在同一块 GPU 上执行。PD 分离的核心思想是将这两个阶段拆到不同的 GPU 集群上独立执行，中间通过高速网络传输 KV Cache。

要理解为什么需要分离，先看这两个阶段的本质差异。Prefill 阶段是**计算密集型**——需要并行处理整个 Prompt 的所有 Token（类似矩阵乘法），GPU 算力利用率高，属于 compute-bound。Decode 阶段是**访存密集型**——每次只生成一个 Token，需要反复读取巨大的 KV Cache，GPU 大部分时间在等内存搬运数据，属于 memory-bandwidth-bound。

这可以类比为一家餐厅的"备菜"和"炒菜"环节：备菜（Prefill）需要大案板和多把刀，效率取决于切菜速度（计算力）；炒菜（Decode）需要反复取调料，效率取决于调料台是否就在手边（内存带宽）。传统做法是一个厨师在同一个工位上既备菜又炒菜，但备菜占用大案板时炒菜无法进行。分离后，备菜区和炒菜区独立运作，各自效率最大化。

PD 分离的直接收益包括：独立扩缩容（Prefill 和 Decode 按各自负载独立扩容）、硬件异构（Prefill 用算力强的 GPU 如 H100 SXM，Decode 可用显存大但算力稍弱的 GPU）、调度灵活（Prefill 可以 preempt 让路给紧急请求，而不影响正在 Decode 的请求）。

#### 架构图

```
                    用户请求 (Prompt)
                         │
                         ▼
              ┌─────────────────────┐
              │   Global Scheduler   │
              │  (全局调度器)         │
              │  · 请求分类           │
              │  · Prefill 节点选择   │
              │  · Decode 节点选择    │
              └────────┬────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
┌─────────────────────┐  ┌─────────────────────┐
│  Prefill Cluster     │  │  Decode Cluster      │
│  (预填充集群)         │  │  (解码集群)           │
│                     │  │                     │
│  ┌───────────────┐  │  │  ┌───────────────┐  │
│  │ GPU Node P1   │  │  │  │ GPU Node D1   │  │
│  │ (H100 SXM)    │  │  │  │ (H100/A100)   │  │
│  │ · Compute     │  │  │  │ · Large VRAM  │  │
│  │   Optimized   │  │  │  │ · High BW     │  │
│  └───────────────┘  │  │  └───────────────┘  │
│  ┌───────────────┐  │  │  ┌───────────────┐  │
│  │ GPU Node P2   │  │  │  │ GPU Node D2   │  │
│  └───────────────┘  │  │  └───────────────┘  │
│  ┌───────────────┐  │  │  ┌───────────────┐  │
│  │ GPU Node P3   │  │  │  │ GPU Node D3   │  │
│  └───────────────┘  │  │  └───────────────┘  │
└──────────┬──────────┘  └──────────▲──────────┘
           │                        │
           │    KV Cache Transfer   │
           │  (RDMA / NVLink /      │
           │   PCIe / InfiniBand)   │
           └────────────────────────┘

Prefill 流程:                    Decode 流程:
Prompt → Attention计算           KV Cache → 逐Token生成
     → KV Cache生成              → 每步读取全部KV
     → 传输KV至Decode节点         → 追加新KV
```

#### 代码示例

```python
import asyncio
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

@dataclass
class KVCache:
    """KV Cache 数据结构"""
    key: np.ndarray       # shape: [num_layers, seq_len, num_heads, head_dim]
    value: np.ndarray
    seq_len: int
    model_id: str

    def size_bytes(self) -> int:
        return self.key.nbytes + self.value.nbytes

@dataclass
class InferenceRequest:
    request_id: str
    prompt_tokens: list[int]
    max_new_tokens: int = 512
    priority: int = 0      # 0=normal, 1=high, 2=realtime

@dataclass
class PrefillResult:
    request_id: str
    kv_cache: KVCache
    first_token_id: int
    prefill_latency_ms: float

class PrefillNode:
    """Prefill 专用节点 — 优化计算吞吐"""

    def __init__(self, node_id: str, gpu_type: str = "H100_SXM"):
        self.node_id = node_id
        self.gpu_type = gpu_type
        self.active_prefills = 0
        self.max_concurrent = 8  # Prefill 高并行度

    async def prefill(self, request: InferenceRequest) -> PrefillResult:
        """执行 Prefill 阶段：处理完整 Prompt，生成 KV Cache"""
        self.active_prefills += 1
        try:
            seq_len = len(request.prompt_tokens)
            # 模拟 Prefill 计算（实际是 GPU kernel）
            # 耗时与 seq_len 近似线性 —— 长 prompt 更耗时
            compute_time = seq_len * 0.5  # ms per token (batch内)
            await asyncio.sleep(compute_time / 1000)

            # 生成 KV Cache（实际由 GPU Attention 计算产生）
            num_layers, num_heads, head_dim = 32, 32, 128
            kv_cache = KVCache(
                key=np.zeros((num_layers, seq_len, num_heads, head_dim), dtype=np.float16),
                value=np.zeros((num_layers, seq_len, num_heads, head_dim), dtype=np.float16),
                seq_len=seq_len,
                model_id="llama-70b",
            )

            return PrefillResult(
                request_id=request.request_id,
                kv_cache=kv_cache,
                first_token_id=42,  # 模拟第一个生成的 token
                prefill_latency_ms=compute_time,
            )
        finally:
            self.active_prefills -= 1

class DecodeNode:
    """Decode 专用节点 — 优化内存带宽利用"""

    def __init__(self, node_id: str, max_batch: int = 256):
        self.node_id = node_id
        self.max_batch = max_batch
        self.active_sequences: dict[str, KVCache] = {}

    async def receive_kv_cache(self, result: PrefillResult):
        """接收 Prefill 节点传输过来的 KV Cache"""
        transfer_time_ms = result.kv_cache.size_bytes() / (25 * 1e9) * 1000  # 25GB/s RDMA
        await asyncio.sleep(transfer_time_ms / 1000)
        self.active_sequences[result.request_id] = result.kv_cache

    async def decode_step(self, request_id: str) -> Optional[int]:
        """单步 Decode：生成一个 Token"""
        kv = self.active_sequences.get(request_id)
        if not kv:
            return None
        # 实际是 GPU Attention + MLP forward
        # 耗时取决于内存带宽而非计算力
        await asyncio.sleep(0.01)  # ~10ms per token
        kv.seq_len += 1
        return np.random.randint(0, 32000)  # 模拟 token_id

class PDDisaggregatedScheduler:
    """PD 分离的全局调度器"""

    def __init__(self):
        self.prefill_nodes: list[PrefillNode] = []
        self.decode_nodes: list[DecodeNode] = []

    def select_prefill_node(self, request: InferenceRequest) -> PrefillNode:
        """选择负载最低的 Prefill 节点"""
        return min(self.prefill_nodes, key=lambda n: n.active_prefills)

    def select_decode_node(self, kv_cache: KVCache) -> DecodeNode:
        """选择有足够显存的 Decode 节点"""
        return min(
            self.decode_nodes,
            key=lambda n: len(n.active_sequences),
        )

    async def serve_request(self, request: InferenceRequest) -> list[int]:
        """端到端服务一个推理请求"""
        # Phase 1: Prefill（在 Prefill 集群执行）
        p_node = self.select_prefill_node(request)
        prefill_result = await p_node.prefill(request)

        # Phase 2: KV Cache Transfer（跨节点传输）
        d_node = self.select_decode_node(prefill_result.kv_cache)
        await d_node.receive_kv_cache(prefill_result)

        # Phase 3: Decode（在 Decode 集群逐 Token 生成）
        output_tokens = [prefill_result.first_token_id]
        for _ in range(request.max_new_tokens - 1):
            token = await d_node.decode_step(request.request_id)
            if token is None or token == 2:  # EOS
                break
            output_tokens.append(token)

        # 清理
        d_node.active_sequences.pop(request.request_id, None)
        return output_tokens
```

#### 关键对比

| 维度 | 传统合并部署 | PD 分离架构 |
|------|------------|------------|
| GPU 利用率 | Prefill 和 Decode 互相干扰，利用率 30-50% | 各阶段独立优化，利用率可达 70-85% |
| TTFT（首 Token 延迟） | 受 Decode batch 排队影响，不可控 | Prefill 独立调度，TTFT 可预测 |
| 吞吐量 | 受限于 Decode 的内存带宽瓶颈 | Prefill 集群高吞吐，Decode 集群高并发 |
| 扩缩容 | Prefill 和 Decode 必须同比例扩容 | 各自独立扩缩容，成本优化空间大 |
| 硬件选型 | 只能选通用型 GPU | Prefill 用算力型，Decode 用带宽型 |
| 额外开销 | 无 | KV Cache 传输延迟（RDMA 可控制在 ms 级） |
| 系统复杂度 | 低 | 高（全局调度 + KV Cache 管理 + 传输优化） |
| 适用场景 | 小规模 / 延迟不敏感 | 大规模 / 多租户 / 成本敏感 |

#### 实际案例

**Mooncake（月饼）**是 Moonshot AI（月之暗面）发布的开源 PD 分离推理框架。其核心创新是利用 KVCache-centric 的设计理念，将 KV Cache 存储在一个分布式的 `KVCache Pool` 中（基于 RDMA 互连），Prefill 节点计算完 KV Cache 后写入 Pool，Decode 节点直接从 Pool 读取。Moonshot AI 报告称，在 Kimi（长上下文场景，128K+ tokens）的生产环境中，PD 分离架构相比传统合并部署在相同 SLO（TTFT < 3s）下吞吐提升了 **75%**，GPU 成本降低了 **30%**。

同样，DeepSeek 在其 V3/R1 模型的推理服务中也采用了 PD 分离架构。DeepSeek 的特点是使用了 MLA（Multi-head Latent Attention）来压缩 KV Cache 的大小，使得跨节点传输的数据量大幅减少，从而进一步降低了 PD 分离架构的传输开销。在 671B MoE 模型上，其 KV Cache 传输时间控制在了 **2-5ms**，几乎可以忽略不计。

#### 面试追问

1. KV Cache 的传输是 PD 分离的核心瓶颈——对于 128K 上下文的 70B 模型，KV Cache 大小约为多少？传输延迟如何计算和优化？
2. 在 PD 分离架构中，如果 Prefill 节点突然宕机，已经部分计算的 KV Cache 如何恢复？是否需要引入 checkpoint 机制？
3. Continuous Batching 在 PD 分离架构下如何工作？Decode 节点的 batch 策略与合并部署时有何不同？

</details>
### Q11: 如何设计 GPU 集群的模型调度策略？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

GPU 集群调度是 Agent 服务中最昂贵的资源管理问题。与传统 CPU 微服务不同，GPU 推理任务具有三个独特特征：**显存占用大且不可压缩**（一个 70B 模型需要 ~140GB 显存）、**任务执行时间差异极大**（从 100ms 的分类任务到 60s 的长文本生成）、**批处理效率对吞吐量影响成数量级**（continuous batching 可将吞吐提升 5-10x）。因此，照搬 Kubernetes 默认调度器是行不通的。

生产级 GPU 调度需要解决三层问题：**集群级调度**（哪个请求发往哪台机器）、**实例级调度**（同一 GPU 上如何做 batching 和抢占）、**显存级管理**（KV Cache 的分配与回收策略）。业界的做法是将这三层解耦为独立子系统：全局路由层（类似 vLLM 的 Router）、本地 Batch Scheduler（类似 Orca 的 iteration-level scheduling）、以及 PagedAttention 式的显存管理器。

调度策略的核心目标是在 **SLO 达标率**（如 P99 < 2s）和 **GPU 利用率**（目标 > 70%）之间取得平衡。实际中还需考虑多模型共存（同一集群部署不同大小的模型）、弹性伸缩（高峰期自动扩容）、以及故障转移（单卡故障不影响服务）。

#### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Global Router                         │
│  ┌─────────────┬──────────────┬────────────────────┐    │
│  │ Queue Mgr   │ Model Router │ Load Balancer      │    │
│  │ (优先级队列) │ (模型→节点)  │ (加权轮询+探测)    │    │
│  └──────┬──────┴──────┬───────┴─────────┬──────────┘    │
└─────────┼─────────────┼─────────────────┼───────────────┘
          │             │                 │
    ┌─────▼─────┐ ┌─────▼─────┐   ┌──────▼──────┐
    │  Node A    │ │  Node B    │   │  Node C      │
    │ 8×A100     │ │ 8×A100     │   │ 8×A100       │
    │            │ │            │   │              │
    │ ┌────────┐ │ │ ┌────────┐ │   │ ┌────────┐  │
    │ │Model-7B│ │ │ │Model-7B│ │   │ │Model-70B│ │
    │ │(2 GPU) │ │ │ │(2 GPU) │ │   │ │(8 GPU)  │ │
    │ └────────┘ │ │ └────────┘ │   │ └────────┘  │
    │ ┌────────┐ │ │ ┌────────┐ │   │              │
    │ │Model-7B│ │ │ │Model-  │ │   │ Tensor      │
    │ │(2 GPU) │ │ │ │13B     │ │   │ Parallel    │
    │ └────────┘ │ │ │(4 GPU) │ │   │ across all  │
    │ ┌────────┐ │ │ └────────┘ │   │ 8 GPUs      │
    │ │Model-  │ │ │ ┌────────┐ │   │              │
    │ │13B     │ │ │ │Standby │ │   │              │
    │ │(4 GPU) │ │ │ │(2 GPU) │ │   │              │
    │ └────────┘ │ │ └────────┘ │   │              │
    └────────────┘ └────────────┘   └──────────────┘
```

#### 代码示例

```python
import heapq
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import time

class Priority(Enum):
    REALTIME = 0   # 用户交互请求，SLO < 2s
    HIGH = 1       # Agent tool-call，SLO < 5s
    BATCH = 2      # 离线批处理，无严格 SLO

@dataclass
class InferenceRequest:
    request_id: str
    model_name: str
    input_tokens: int
    max_output_tokens: int
    priority: Priority
    enqueue_time: float = field(default_factory=time.time)
    deadline: Optional[float] = None  # 绝对截止时间

@dataclass(order=True)
class PrioritizedRequest:
    sort_key: tuple
    request: InferenceRequest = field(compare=False)

class GPUNode:
    def __init__(self, node_id: str, total_gpu_memory_gb: int, num_gpus: int):
        self.node_id = node_id
        self.total_memory = total_gpu_memory_gb
        self.num_gpus = num_gpus
        self.allocated_memory = 0
        self.running_requests = 0
        self.loaded_models: set[str] = set()
        self.health_score: float = 1.0  # 0.0 = 不可用, 1.0 = 完全健康

    @property
    def available_memory(self) -> int:
        return self.total_memory - self.allocated_memory

    @property
    def utilization(self) -> float:
        return self.allocated_memory / self.total_memory

class ClusterScheduler:
    """GPU 集群全局调度器 — 基于 EDF + 亲和性的混合策略"""

    def __init__(self):
        self.queue: list[PrioritizedRequest] = []
        self.nodes: dict[str, GPUNode] = {}
        self.model_memory_map: dict[str, int] = {}  # 模型 → 显存需求(GB)
        self.target_utilization = 0.75

    def enqueue(self, req: InferenceRequest):
        if req.deadline is None:
            slo_map = {Priority.REALTIME: 2.0, Priority.HIGH: 5.0, Priority.BATCH: 300.0}
            req.deadline = req.enqueue_time + slo_map[req.priority]

        sort_key = (req.priority.value, req.deadline, req.enqueue_time)
        heapq.heappush(self.queue, PrioritizedRequest(sort_key, req))

    def select_node(self, req: InferenceRequest) -> Optional[GPUNode]:
        candidates = []
        mem_needed = self.model_memory_map.get(req.model_name, 0)

        for node in self.nodes.values():
            if node.health_score < 0.5:
                continue
            if node.available_memory < mem_needed and req.model_name not in node.loaded_models:
                continue

            affinity_bonus = 2.0 if req.model_name in node.loaded_models else 0.0
            load_score = 1.0 - node.utilization
            health_weight = node.health_score
            score = (affinity_bonus + load_score) * health_weight
            candidates.append((score, node))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]

    def schedule_batch(self, max_batch: int = 32) -> list[tuple[InferenceRequest, GPUNode]]:
        assignments = []
        skipped = []

        while self.queue and len(assignments) < max_batch:
            item = heapq.heappop(self.queue)
            req = item.request

            if time.time() > req.deadline:
                continue  # 已超时，丢弃并上报 metrics

            node = self.select_node(req)
            if node:
                node.running_requests += 1
                assignments.append((req, node))
            else:
                skipped.append(item)

        for item in skipped:
            heapq.heappush(self.queue, item)

        return assignments
```

#### 关键对比

| 调度策略 | 吞吐量 | P99 延迟 | GPU 利用率 | 适用场景 |
|---------|--------|---------|-----------|---------|
| 轮询（Round-Robin） | 低 | 高且不稳定 | 40-50% | 仅限测试环境 |
| 最小连接数（Least-Conn） | 中 | 中 | 55-65% | 同构模型集群 |
| 模型亲和性 + 加权 | 高 | 较低 | 65-75% | 多模型混部 |
| EDF + 亲和性（推荐） | 高 | 低且可控 | 70-80% | 多优先级生产环境 |
| Preemptive（可抢占） | 最高 | 实时任务极低 | 75-85% | 严格 SLO + 离线混跑 |

#### 实际案例

某 AI 平台在从简单轮询切换到 EDF + 亲和性调度后的实测数据：
- **集群规模**：3 个节点 × 8 × A100-80GB = 24 GPU
- **模型配置**：7B（2 GPU）×4 副本 + 70B（8 GPU）×1 副本
- **优化前**：GPU 利用率 42%，P99 延迟 8.3s，SLO 达标率 71%
- **优化后**：GPU 利用率 73%，P99 延迟 1.8s，SLO 达标率 96%
- **成本节约**：相同 QPS 下减少 40% 的 GPU 用量，月省约 ¥12 万
- 关键发现：模型亲和性单项就贡献了 ~15% 的利用率提升（避免重复加载模型权重）

#### 面试追问

1. **如何实现 GPU 推理的可抢占调度？低优先级任务被抢占时如何保存 KV Cache？**
2. **多租户场景下如何做 GPU 资源隔离和公平调度（Fair Scheduling）？配额机制怎么设计？**
3. **当 GPU 节点发生故障（如显存 ECC 错误），如何实现无感知的请求重试和模型迁移？**

</details>

---

### Q12: 全链路背压控制（Backpressure）如何实现？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

背压（Backpressure）是分布式系统中应对过载的核心机制。在 Agent 服务中，这个问题尤其突出：一个用户请求可能触发 LLM 推理 → Tool 调用 → 二次推理 → 结果聚合的长链路，任何一环的延迟抖动都会在上游形成请求堆积。如果不加控制，堆积的请求会耗尽内存和连接池，最终引发级联故障（cascading failure）。

**生活类比**：高速公路上的车流管理。当前方发生拥堵（下游过载），收费站（入口）需要限制进入车辆数量（入口限流），已在路上的车需要降速（速率匹配），而不是让所有车都涌入然后堵死。没有背压机制的系统就像没有红绿灯的城市——一个路口堵死，全城瘫痪。

Agent 全链路背压需要在四个层面实现：**接入层**（API Gateway 的全局限流）、**编排层**（Agent 引擎的并发控制）、**推理层**（LLM 服务的队列管理）、**工具层**（外部 API 的熔断与降级）。关键设计原则是 **快速失败优于无限等待**——当系统检测到过载时，应尽早拒绝请求并返回有意义的错误，而不是让请求在队列中无限排队直到超时。

#### 架构图

```
用户请求流 ──────────────────────────────────────────────────►

┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌────────┐
│ API      │    │ Agent        │    │ LLM      │    │ Tool   │
│ Gateway  │───►│ Orchestrator │───►│ Inference│───►│ Service│
│          │    │              │    │          │    │        │
│ ┌──────┐ │    │ ┌──────────┐ │    │ ┌──────┐ │    │ ┌────┐ │
│ │令牌桶│ │    │ │信号量    │ │    │ │队列  │ │    │ │熔断│ │
│ │限流器│ │    │ │并发控制  │ │    │ │深度  │ │    │ │器  │ │
│ └──┬───┘ │    │ └────┬─────┘ │    │ │监控  │ │    │ └─┬──┘ │
│    │     │    │      │       │    │ └──┬───┘ │    │   │    │
│ ┌──▼───┐ │    │ ┌────▼─────┐ │    │ ┌──▼───┐ │    │ ┌─▼──┐ │
│ │拒绝/ │ │◄───│ │背压信号  │ │◄───│ │背压  │ │◄───│ │降级│ │
│ │排队  │ │    │ │传播      │ │    │ │上报  │ │    │ │响应│ │
│ └──────┘ │    │ └──────────┘ │    │ └──────┘ │    │ └────┘ │
└──────────┘    └──────────────┘    └──────────┘    └────────┘

◄────────────────────────────────────────────────────────────
背压信号流（反向传播）
```

#### 代码示例

```python
import asyncio
import time
from dataclasses import dataclass
from enum import Enum
from collections import deque

class PressureLevel(Enum):
    NORMAL = "normal"        # 一切正常
    ELEVATED = "elevated"    # 开始降级非关键功能
    HIGH = "high"            # 拒绝低优先级请求
    CRITICAL = "critical"    # 仅允许健康检查通过

@dataclass
class BackpressureSignal:
    source: str              # 产生背压的组件
    level: PressureLevel
    queue_depth: int
    estimated_wait_ms: int
    timestamp: float = 0.0

    def __post_init__(self):
        self.timestamp = self.timestamp or time.time()

class AdaptiveRateLimiter:
    """自适应令牌桶 — 根据下游背压信号动态调整发放速率"""

    def __init__(self, base_rate: float = 100.0, max_rate: float = 500.0):
        self.base_rate = base_rate
        self.max_rate = max_rate
        self.current_rate = base_rate
        self.tokens = base_rate
        self.last_refill = time.time()
        self._lock = asyncio.Lock()

        # AIMD 参数（加法增大 / 乘法减小）
        self.additive_increase = 5.0   # 每秒增加的令牌
        self.multiplicative_decrease = 0.5

        # 背压监控
        self.pressure_history: deque[PressureLevel] = deque(maxlen=60)

    async def acquire(self, priority: int = 0) -> bool:
        async with self._lock:
            self._refill()
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            return False

    def _refill(self):
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.current_rate, self.tokens + self.current_rate * elapsed)
        self.last_refill = now

    def on_backpressure(self, signal: BackpressureSignal):
        self.pressure_history.append(signal.level)

        if signal.level == PressureLevel.CRITICAL:
            self.current_rate = self.base_rate * 0.1
        elif signal.level == PressureLevel.HIGH:
            self.current_rate *= self.multiplicative_decrease
        elif signal.level == PressureLevel.ELEVATED:
            self.current_rate *= 0.8
        elif signal.level == PressureLevel.NORMAL:
            self.current_rate = min(
                self.max_rate,
                self.current_rate + self.additive_increase
            )

        self.current_rate = max(1.0, self.current_rate)

class CircuitBreaker:
    """熔断器 — 三态状态机（关闭/打开/半开）"""

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 30.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0.0
        self.state = "closed"  # closed / open / half_open

    async def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"
            else:
                raise CircuitOpenError(f"熔断器开启，预计 "
                    f"{self.recovery_timeout - (time.time() - self.last_failure_time):.0f}s 后恢复")

        try:
            result = await func(*args, **kwargs)
            if self.state == "half_open":
                self.state = "closed"
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.state = "open"
            raise

class CircuitOpenError(Exception):
    pass
```

#### 关键对比

| 背压策略 | 响应速度 | 资源消耗 | 用户体验 | 实现复杂度 |
|---------|---------|---------|---------|-----------|
| 无限排队 | 慢（长尾超时） | 内存持续增长 | 极差（长等待后超时） | 低 |
| 固定限流 | 快 | 可控 | 中（高峰被拒） | 低 |
| AIMD 自适应 | 快 | 可控 | 较好（自动适配） | 中 |
| 多级背压传播 | 最快 | 最优 | 好（分级降级） | 高 |
| 背压 + 优先级队列 | 最快 | 最优 | 最好（VIP 不受影响） | 最高 |

#### 实际案例

某 Agent SaaS 服务在接入背压控制前后的对比（高峰期 QPS 约 2000）：
- **改造前**：高峰期请求堆积导致 OOM，每周至少一次服务重启，P99 延迟从 3s 飙至 45s
- **改造后**：
  - API Gateway 层：令牌桶 + 优先级队列，低优先级请求在过载时返回 429 + Retry-After
  - Agent 引擎层：并发信号量从固定 200 改为根据推理队列深度动态调整（50-300）
  - LLM 推理层：队列深度 > 100 时触发 ELEVATED，> 500 时触发 HIGH
  - 工具层：外部 API 熔断器，5 次连续失败后熔断 30s
- **效果**：P99 延迟稳定在 4.2s，零 OOM 事故（连续运行 90 天），SLO 达标率从 82% 升至 97%

#### 面试追问

1. **如何区分"真正的过载"和"瞬时毛刺"？背压信号的去抖（debounce）策略如何设计？**
2. **在多级背压系统中，如果中间层的背压信号传播延迟较高（如跨机房），如何避免震荡（oscillation）？**
3. **Streaming SSE 场景下，客户端消费速度慢导致的背压如何处理？TCP 窗口和应用层缓冲区如何协调？**

</details>

---

### Q13: Sub-agent 多任务协调的工程挑战有哪些？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Sub-agent 架构（又称 Multi-Agent Orchestration）是指一个主 Agent 将复杂任务拆解为多个子任务，分配给专门的 Sub-agent 并行或串行执行，最终汇总结果。这种模式在处理复杂用户意图时非常强大——例如"帮我分析这份财报并生成投资建议"可以拆解为：数据提取 Agent、财务分析 Agent、市场对比 Agent、报告生成 Agent。

**生活类比**：Sub-agent 协调就像一个项目经理带领专家团队。项目经理（Orchestrator Agent）理解客户需求后，把任务分给前端工程师、后端工程师、设计师（各个 Sub-agent）。挑战在于：怎么拆分任务避免重复劳动？各人进度不一样怎么协调？一个人的输出是另一个人的输入怎么传递？有人搞砸了怎么回退？

工程层面的核心挑战可以归纳为五大类：**任务分解与分配的正确性**（如何保证拆分不遗漏、不重叠）、**数据流与上下文共享**（Sub-agent 间如何传递中间结果）、**并发控制与依赖管理**（DAG 编排与死锁预防）、**错误处理与部分失败**（一个 Sub-agent 失败是否需要全部回滚）、**资源竞争与成本控制**（多个 Sub-agent 同时调用 LLM 的 token 消耗）。

#### 架构图

```
                    ┌─────────────────────┐
                    │  Orchestrator Agent  │
                    │  (任务分解 & 汇总)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    Task DAG Engine   │
                    │                      │
                    │  ┌──┐   ┌──┐   ┌──┐ │
                    │  │T1│──►│T3│──►│T5│ │
                    │  └──┘   └──┘   └──┘ │
                    │  ┌──┐   ┌──┐    ▲   │
                    │  │T2│──►│T4│────┘   │
                    │  └──┘   └──┘        │
                    └──┬───┬───┬───┬──────┘
                       │   │   │   │
              ┌────────▼┐ ┌▼───▼┐ ┌▼────────┐
              │Research  │ │Code │ │Analysis │
              │Agent     │ │Agent│ │Agent    │
              │          │ │     │ │         │
              │•Web搜索  │ │•代码│ │•数据分析│
              │•文档检索  │ │ 生成│ │•图表生成│
              │•摘要提取  │ │•测试│ │•洞察提取│
              └──────────┘ └─────┘ └─────────┘
                    │         │         │
              ┌─────▼─────────▼─────────▼─────┐
              │      Shared Context Store      │
              │  (Redis / 向量数据库 / 消息队列) │
              └────────────────────────────────┘
```

#### 代码示例

```typescript
import { EventEmitter } from 'events';

interface SubTask {
  id: string;
  agentType: string;
  input: Record<string, unknown>;
  dependencies: string[];   // 前置任务 ID
  timeout: number;          // 单任务超时(ms)
  retryPolicy: { maxRetries: number; backoffMs: number };
}

interface TaskResult {
  taskId: string;
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  output?: unknown;
  error?: string;
  tokenUsage: { input: number; output: number };
  durationMs: number;
}

type CompensationFn = (taskId: string, result: TaskResult) => Promise<void>;

class SubAgentOrchestrator extends EventEmitter {
  private results = new Map<string, TaskResult>();
  private running = new Set<string>();
  private compensations = new Map<string, CompensationFn>();
  private totalTokenBudget: number;
  private usedTokens = 0;

  constructor(private tasks: SubTask[], tokenBudget: number = 100_000) {
    super();
    this.totalTokenBudget = tokenBudget;
  }

  async execute(): Promise<Map<string, TaskResult>> {
    while (this.results.size < this.tasks.length) {
      const ready = this.getReadyTasks();
      if (ready.length === 0 && this.running.size > 0) {
        await this.waitForAny();
        continue;
      }
      if (ready.length === 0) break; // 死锁检测

      // 并行执行所有就绪任务
      const promises = ready.map(task => this.executeTask(task));
      await Promise.allSettled(promises);
    }

    return this.results;
  }

  private getReadyTasks(): SubTask[] {
    return this.tasks.filter(task => {
      if (this.results.has(task.id) || this.running.has(task.id)) return false;
      return task.dependencies.every(dep => {
        const result = this.results.get(dep);
        return result?.status === 'success';
      });
    });
  }

  private async executeTask(task: SubTask): Promise<void> {
    this.running.add(task.id);
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= task.retryPolicy.maxRetries; attempt++) {
      if (this.usedTokens >= this.totalTokenBudget) {
        this.recordResult(task.id, 'cancelled', undefined, 'Token budget exceeded');
        return;
      }

      try {
        const depOutputs = this.gatherDependencyOutputs(task);
        const enrichedInput = { ...task.input, ...depOutputs };

        const result = await this.callAgent(task.agentType, enrichedInput, task.timeout);
        this.usedTokens += result.tokenUsage.input + result.tokenUsage.output;

        this.recordResult(task.id, 'success', result.output);
        return;
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt < task.retryPolicy.maxRetries) {
          await this.sleep(task.retryPolicy.backoffMs * Math.pow(2, attempt));
        }
      }
    }

    this.recordResult(task.id, 'failed', undefined, lastError);
    await this.handleFailure(task);
  }

  private async handleFailure(task: SubTask): Promise<void> {
    // Saga 模式：逆序执行补偿操作
    const completedDeps = task.dependencies
      .filter(dep => this.results.get(dep)?.status === 'success');

    for (const depId of completedDeps.reverse()) {
      const compensation = this.compensations.get(depId);
      if (compensation) {
        await compensation(depId, this.results.get(depId)!);
      }
    }
    this.emit('taskFailed', { taskId: task.id, cascadeCancelled: completedDeps });
  }

  private gatherDependencyOutputs(task: SubTask): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const depId of task.dependencies) {
      outputs[`dep_${depId}`] = this.results.get(depId)?.output;
    }
    return outputs;
  }

  private recordResult(id: string, status: TaskResult['status'],
                       output?: unknown, error?: string) {
    this.results.set(id, {
      taskId: id, status, output, error,
      tokenUsage: { input: 0, output: 0 }, durationMs: 0
    });
    this.running.delete(id);
    this.emit('taskComplete', id);
  }

  private async callAgent(type: string, input: unknown, timeout: number): Promise<TaskResult> {
    // 实际实现：调用对应类型的 Sub-agent 服务
    throw new Error('需由具体 Agent 运行时实现');
  }

  private waitForAny(): Promise<void> {
    return new Promise(resolve => this.once('taskComplete', resolve));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### 关键对比

| 协调模式 | 并行度 | 错误恢复 | 上下文共享 | 适用任务 |
|---------|--------|---------|-----------|---------|
| 串行链式（Sequential） | 无 | 简单回滚 | 单向传递 | 流水线任务 |
| 并行扇出（Fan-out） | 最高 | 独立重试 | 无共享 | 独立子任务 |
| DAG 编排（推荐） | 高 | 拓扑感知重试 | 依赖传递 | 复杂依赖关系 |
| 黑板模式（Blackboard） | 中 | 状态回退 | 全局共享 | 迭代收敛任务 |
| 拍卖/竞标模式 | 动态 | 自然容错 | 竞争共享 | 动态任务分配 |

#### 实际案例

某企业知识助手的 Multi-Agent 架构实测（日均 5 万次复杂查询）：
- **架构**：Orchestrator + 4 类 Sub-agent（检索 / 分析 / 计算 / 生成）
- **DAG 深度**：平均 3 层，最大 5 层
- **并行度**：平均每次查询并行运行 2.3 个 Sub-agent
- **Token 消耗**：引入 Token Budget 后，单次查询平均 token 从 15K 降至 9K（-40%）
- **错误率**：Sub-agent 单次失败率 3.2%，经重试后端到端成功率 99.1%
- **延迟分布**：串行模式平均 12s → DAG 并行后平均 5.8s（-52%）
- **关键教训**：最初尝试让 LLM 自己做任务拆分，准确率仅 ~70%；改为规则引擎 + LLM 混合拆分后提升至 93%

#### 面试追问

1. **Sub-agent 之间如何共享长期记忆（如对话历史）？全局上下文和局部上下文如何隔离？**
2. **DAG 中出现环形依赖（如 Agent A 需要 B 的结果，B 又需要 A 的中间输出），如何检测和处理？**
3. **多 Sub-agent 同时调用同一个外部 API（如 Google Search），如何做全局速率控制避免被限流？**

</details>

---

### Q14: 设计一个支撑 10 万 DAU 的 Agent 服务架构

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

10 万 DAU 是 Agent 服务从"内部工具"走向"正式产品"的关键里程碑。这个规模下，技术挑战从"能不能用"转变为"稳不稳定、快不快、贵不贵"。设计时需要从三个维度思考：**流量模型**（QPS 估算和峰值预测）、**资源模型**（GPU/CPU/存储的配置与成本）、**可靠性模型**（SLA 目标和容灾方案）。

首先做流量估算：10 万 DAU，假设每用户日均 10 次交互，峰值系数 3x → 日均 100 万次请求 → 平均 QPS ≈ 12，峰值 QPS ≈ 36。假设 30% 请求为简单意图识别（走小模型），50% 为标准对话（走 7B 模型），20% 为复杂任务（走 70B 模型或多轮 Agent）。每次 LLM 调用平均 500 input tokens + 200 output tokens。

在这个规模下，架构设计的核心原则是 **分层解耦 + 弹性扩缩**。不需要过度设计——单 Region 部署足够，但需要做好监控和自动告警，为后续扩展预留接口。

#### 架构图

```
                          ┌────────────────────────────┐
                          │         CDN / WAF          │
                          │    (静态资源 + DDoS 防护)   │
                          └─────────────┬──────────────┘
                                        │
                          ┌─────────────▼──────────────┐
                          │       Load Balancer         │
                          │    (Nginx / ALB, SSL终止)   │
                          └─────────────┬──────────────┘
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 │                      │                      │
        ┌────────▼────────┐   ┌────────▼────────┐   ┌────────▼────────┐
        │  API Gateway ×2 │   │  API Gateway ×2 │   │  WebSocket GW   │
        │  (认证/限流/路由) │   │  (认证/限流/路由) │   │  (SSE 推送)     │
        └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
                 │                      │                      │
        ┌────────▼──────────────────────▼──────────────────────▼────────┐
        │                     Kubernetes Cluster                        │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐   │
        │  │ Agent Engine  │  │ Agent Engine  │  │ Agent Engine      │   │
        │  │ ×4 pods       │  │ ×4 pods       │  │ ×4 pods           │   │
        │  │ (编排/Tool/   │  │               │  │                   │   │
        │  │  Memory 管理) │  │               │  │                   │   │
        │  └──────┬───────┘  └──────┬────────┘  └───────┬───────────┘   │
        │         │                  │                    │              │
        │  ┌──────▼──────────────────▼────────────────────▼───────┐     │
        │  │              Message Queue (Redis Streams)           │     │
        │  └──────┬──────────────────┬────────────────────┬───────┘     │
        │         │                  │                    │              │
        │  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼────────┐    │
        │  │ LLM Service  │  │ LLM Service  │  │ Tool Executor   │    │
        │  │ (7B × 2GPU)  │  │ (7B × 2GPU)  │  │ ×4 pods         │    │
        │  │ 2 replicas   │  │ 2 replicas   │  │ (搜索/计算/API) │    │
        │  └──────────────┘  └──────────────┘  └─────────────────┘    │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐                         │
        │  │ LLM Service  │  │ Embedding    │                         │
        │  │ (70B, 8GPU)  │  │ Service      │                         │
        │  │ 1 replica    │  │ ×2 pods      │                         │
        │  └──────────────┘  └──────────────┘                         │
        └───────────────────────────────────────────────────────────────┘
                 │                      │
        ┌────────▼────────┐   ┌────────▼────────┐
        │   PostgreSQL    │   │     Redis       │
        │  (主从, 用户/   │   │  (Session/      │
        │   会话/日志)    │   │   Cache/Queue)  │
        │  500GB SSD      │   │  64GB × 2 节点  │
        └─────────────────┘   └─────────────────┘
```

#### 资源估算与成本

```
== GPU 资源 ==
7B 模型:  2 × A100-40GB per replica × 2 replicas  =  4 GPU
70B 模型: 8 × A100-80GB per replica × 1 replica   =  8 GPU
Embedding: 1 × A10G per replica × 2 replicas      =  2 GPU
备用 GPU（弹性扩容池）                               =  2 GPU
──────────────────────────────────────────────────────
GPU 合计: 16 GPU

== CPU 资源 ==
API Gateway:     2 pods × 2 vCPU × 4GB   =   4 vCPU,  8GB
Agent Engine:   12 pods × 4 vCPU × 8GB   =  48 vCPU, 96GB
Tool Executor:   4 pods × 2 vCPU × 4GB   =   8 vCPU, 16GB
WebSocket GW:    2 pods × 2 vCPU × 4GB   =   4 vCPU,  8GB
──────────────────────────────────────────────────────
CPU 合计: 64 vCPU, 128GB RAM

== 存储 ==
PostgreSQL: 500GB SSD (主) + 500GB SSD (从)
Redis: 64GB × 2 节点 (主从)
对象存储(用户文件): ~1TB

== 月度成本估算（云厂商按需价格）==
GPU (16 × A100):     ¥160,000 ~ ¥200,000
CPU 计算:            ¥15,000 ~ ¥20,000
数据库 + 存储:        ¥8,000 ~ ¥12,000
网络 + CDN:          ¥3,000 ~ ¥5,000
监控 + 日志:          ¥2,000 ~ ¥3,000
──────────────────────────────────────────
月度总计: ¥188,000 ~ ¥240,000
单用户月成本: ¥1.88 ~ ¥2.40
```

#### 代码示例

```python
from dataclasses import dataclass
from enum import Enum

class ModelTier(Enum):
    LIGHT = "light"      # 意图分类、简单问答
    STANDARD = "standard" # 标准对话
    HEAVY = "heavy"       # 复杂推理、多步 Agent

@dataclass
class CapacityPlan:
    dau: int
    interactions_per_user: int = 10
    peak_factor: float = 3.0
    model_distribution: dict = None  # tier → 比例

    def __post_init__(self):
        if self.model_distribution is None:
            self.model_distribution = {
                ModelTier.LIGHT: 0.30,
                ModelTier.STANDARD: 0.50,
                ModelTier.HEAVY: 0.20,
            }

    @property
    def daily_requests(self) -> int:
        return self.dau * self.interactions_per_user

    @property
    def avg_qps(self) -> float:
        return self.daily_requests / 86400

    @property
    def peak_qps(self) -> float:
        return self.avg_qps * self.peak_factor

    def gpu_requirement(self) -> dict:
        throughput_per_gpu = {
            ModelTier.LIGHT: 50,    # QPS per GPU (小模型)
            ModelTier.STANDARD: 8,  # QPS per GPU (7B)
            ModelTier.HEAVY: 1.5,   # QPS per GPU (70B)
        }
        result = {}
        for tier, ratio in self.model_distribution.items():
            tier_qps = self.peak_qps * ratio
            gpus_needed = tier_qps / throughput_per_gpu[tier]
            result[tier] = {
                "qps": round(tier_qps, 1),
                "gpus": max(1, round(gpus_needed * 1.3)),  # 30% 余量
            }
        return result

# 示例使用
plan = CapacityPlan(dau=100_000)
print(f"日均请求: {plan.daily_requests:,}")
print(f"平均 QPS: {plan.avg_qps:.1f}")
print(f"峰值 QPS: {plan.peak_qps:.1f}")
for tier, req in plan.gpu_requirement().items():
    print(f"  {tier.value}: {req['qps']} QPS → {req['gpus']} GPU")
```

#### 分阶段部署计划

| 阶段 | 时间 | DAU 目标 | 关键动作 |
|------|------|---------|---------|
| Phase 0 | 第 1-2 周 | 内测 1K | 单节点部署，手动运维，收集基线数据 |
| Phase 1 | 第 3-4 周 | 公测 1 万 | K8s 部署，基础监控，自动扩缩 HPA |
| Phase 2 | 第 5-8 周 | 正式 5 万 | 多副本 LLM，Redis 缓存，CDN 接入 |
| Phase 3 | 第 9-12 周 | 目标 10 万 | GPU 弹性池，全链路追踪，灰度发布 |

#### 面试追问

1. **如果 70B 模型的 GPU 成本过高，有哪些降本策略？量化（INT4/INT8）对质量的影响如何评估？**
2. **用户对话历史越来越长（平均 20 轮），上下文窗口管理和存储方案如何设计？**
3. **如果要支持多租户（SaaS 模式），资源隔离和计费体系如何设计？**

</details>

---

### Q15: 从 10 万扩展到 1000 万 DAU 需要哪些架构改造？

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

从 10 万到 1000 万 DAU 是 **100 倍**的规模跃迁，这不是简单"加机器"就能解决的。根据架构演进的经验法则，每增长 10 倍都需要重新审视和改造架构。100 倍的增长意味着几乎每一层都需要重新设计。核心挑战体现在三个方面：

**流量挑战**：峰值 QPS 从 ~36 跃升至 ~3600，且需要处理突发流量（如热点事件导致的瞬时 10x 峰值）。单 Region 已无法满足延迟要求——北京用户访问上海机房的网络延迟约 30ms，对于需要多次 LLM 调用的 Agent 请求，多出的 RTT 累积效应显著。

**成本挑战**：线性扩展意味着 GPU 成本从 ¥20 万/月飙升至 ¥2000 万/月，这在商业上不可接受。必须通过模型优化（量化/蒸馏/缓存）、智能路由（小模型处理简单请求）、以及混合部署（预留实例 + Spot 实例）来将成本控制在 ¥500-800 万/月。

**组织挑战**：10 万 DAU 时一个团队（5-8 人）可以维护全部服务；1000 万 DAU 需要多个团队（20-40 人），服务拆分和团队边界必须对齐（Conway's Law）。

#### 架构图

```
                        ┌─────────────────────┐
                        │   Global DNS/GSLB   │
                        │  (智能流量调度)       │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼─────────┐ ┌───────▼──────────┐ ┌───────▼──────────┐
    │   Region: 华北     │ │  Region: 华东     │ │  Region: 华南     │
    │   (北京)           │ │  (上海)           │ │  (广州)           │
    └─────────┬─────────┘ └───────┬──────────┘ └───────┬──────────┘
              │                    │                     │
              │         ┌─────────▼──────────┐          │
              │         │  Region 内部架构    │          │
              │         │                     │          │
              │         │  ┌───────────────┐  │          │
              │         │  │Edge / POP     │  │          │
              │         │  │(缓存+预处理)  │  │          │
              │         │  └───────┬───────┘  │          │
              │         │          │          │          │
              │         │  ┌───────▼───────┐  │          │
              │         │  │API Gateway    │  │          │
              │         │  │Cluster (×6)   │  │          │
              │         │  └───────┬───────┘  │          │
              │         │          │          │          │
              │         │  ┌───────▼───────┐  │          │
              │         │  │Agent Engine   │  │          │
              │         │  │Cluster (×40)  │  │          │
              │         │  └───────┬───────┘  │          │
              │         │          │          │          │
              │         │  ┌───────▼───────┐  │          │
              │         │  │GPU Inference  │  │          │
              │         │  │Pool           │  │          │
              │         │  │• 7B × 20 rep  │  │          │
              │         │  │• 70B × 4 rep  │  │          │
              │         │  │• Router Model │  │          │
              │         │  └───────────────┘  │          │
              │         │                     │          │
              │         │  ┌───────────────┐  │          │
              │         │  │Data Layer     │  │          │
              │         │  │• PG Cluster   │  │          │
              │         │  │• Redis Cluster│  │          │
              │         │  │• Kafka        │  │          │
              │         │  └───────────────┘  │          │
              │         └─────────────────────┘          │
              │                    │                     │
              └────────────────────┼─────────────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  Cross-Region Sync  │
                        │  • 用户数据同步      │
                        │  • 模型版本同步      │
                        │  • 配置中心同步      │
                        └─────────────────────┘
```

#### 关键架构改造清单

```
┌────────────────────────────────────────────────────────────────┐
│                    10 万 → 1000 万 改造项                       │
├─────────────┬──────────────────┬───────────────────────────────┤
│    层级      │   10 万 DAU 方案  │    1000 万 DAU 方案           │
├─────────────┼──────────────────┼───────────────────────────────┤
│ 流量入口     │ 单 Region + LB   │ 多 Region + GSLB 智能调度     │
│ API 网关     │ 2 实例           │ 每 Region 6 实例 + 限流升级   │
│ Agent 引擎   │ 12 pods 单集群   │ 每 Region 40 pods + 异步化   │
│ LLM 推理     │ 16 GPU           │ 每 Region 80+ GPU + 量化     │
│ 模型策略     │ 单一路由          │ 智能路由（小模型优先 + 缓存） │
│ 数据库       │ PG 主从           │ PG 分库分表 + 读写分离       │
│ 缓存         │ Redis 主从        │ Redis Cluster 多分片         │
│ 消息队列     │ Redis Streams    │ Kafka 集群                   │
│ 可观测性     │ 基础监控          │ 全链路追踪 + AIOps 告警      │
│ 部署方式     │ 手动灰度          │ GitOps + 自动金丝雀发布      │
│ 团队组织     │ 1 团队 5-8 人     │ 3-5 团队 20-40 人            │
└─────────────┴──────────────────┴───────────────────────────────┘
```

#### 代码示例

```python
from dataclasses import dataclass, field

@dataclass
class RegionConfig:
    name: str
    gpu_7b_replicas: int
    gpu_70b_replicas: int
    agent_engine_pods: int
    pg_shards: int
    redis_nodes: int
    estimated_dau_share: float  # 该 Region 承担的 DAU 比例

@dataclass
class ScaleUpPlan:
    target_dau: int = 10_000_000
    regions: list[RegionConfig] = field(default_factory=list)

    def __post_init__(self):
        if not self.regions:
            self.regions = [
                RegionConfig("华北-北京", gpu_7b_replicas=20, gpu_70b_replicas=4,
                             agent_engine_pods=40, pg_shards=8, redis_nodes=6,
                             estimated_dau_share=0.40),
                RegionConfig("华东-上海", gpu_7b_replicas=16, gpu_70b_replicas=3,
                             agent_engine_pods=32, pg_shards=6, redis_nodes=6,
                             estimated_dau_share=0.35),
                RegionConfig("华南-广州", gpu_7b_replicas=12, gpu_70b_replicas=2,
                             agent_engine_pods=24, pg_shards=4, redis_nodes=4,
                             estimated_dau_share=0.25),
            ]

    def total_gpus(self) -> int:
        total = 0
        for r in self.regions:
            total += r.gpu_7b_replicas * 2   # 7B: 2 GPU per replica
            total += r.gpu_70b_replicas * 8  # 70B: 8 GPU per replica
        return total

    def monthly_cost_estimate(self) -> dict:
        gpu_count = self.total_gpus()
        gpu_cost_per_unit = 10_000  # ¥/月/GPU (A100 预留实例均价)
        spot_ratio = 0.3            # 30% 使用 Spot 实例
        spot_discount = 0.4         # Spot 实例打 4 折

        gpu_reserved = gpu_count * (1 - spot_ratio) * gpu_cost_per_unit
        gpu_spot = gpu_count * spot_ratio * gpu_cost_per_unit * spot_discount
        gpu_total = gpu_reserved + gpu_spot

        return {
            "GPU 计算": f"¥{gpu_total:,.0f}",
            "CPU 计算": f"¥{gpu_total * 0.08:,.0f}",
            "数据库 + 存储": f"¥{gpu_total * 0.06:,.0f}",
            "网络 + CDN": f"¥{gpu_total * 0.04:,.0f}",
            "监控 + 运维": f"¥{gpu_total * 0.02:,.0f}",
            "月度总计": f"¥{gpu_total * 1.20:,.0f}",
            "单用户月成本": f"¥{gpu_total * 1.20 / self.target_dau:.2f}",
        }

plan = ScaleUpPlan()
print(f"总 GPU 数: {plan.total_gpus()}")
for k, v in plan.monthly_cost_estimate().items():
    print(f"  {k}: {v}")
```

#### 关键优化策略与预期收益

| 优化项 | 实现方式 | 预期收益 |
|-------|---------|---------|
| 语义缓存（Semantic Cache） | 相似问题复用已有回答（余弦相似度 > 0.95） | 减少 30-40% LLM 调用 |
| 智能模型路由 | 用 0.5B 分类器判断请求复杂度，简单问题走 7B | 降低 50% 的 70B 调用 |
| KV Cache 复用 | 共享 System Prompt 的 KV Cache（Prefix Caching） | 推理延迟降低 20-30% |
| INT4 量化 | 70B 模型量化至 INT4，显存需求从 140GB 降至 40GB | GPU 需求减半 |
| Spot 实例混合部署 | 30% 推理负载使用 Spot 实例 + 自动迁移 | 成本降低 18-20% |
| 请求合并（Batching） | 相似请求在 50ms 窗口内合并为 batch | 吞吐提升 3-5x |

#### 分阶段演进计划

| 阶段 | DAU | 核心改造 | 投入 | 周期 |
|------|-----|---------|------|------|
| S1: 基础扩容 | 10 万 → 50 万 | GPU 扩容 + 语义缓存 + 智能路由 | 3 人 | 6 周 |
| S2: 多 Region | 50 万 → 200 万 | 双 Region 部署 + 数据库分片 | 8 人 | 10 周 |
| S3: 深度优化 | 200 万 → 500 万 | 模型量化 + KV Cache 复用 + Spot | 6 人 | 8 周 |
| S4: 全面铺开 | 500 万 → 1000 万 | 三 Region + AIOps + 自动弹性 | 10 人 | 12 周 |

#### 面试追问

1. **跨 Region 数据一致性如何保证？用户在北京发起的对话，切换到上海 Region 后能否无缝继续？**
2. **Spot 实例被回收时，正在进行的推理请求如何处理？KV Cache 能否跨节点迁移？**
3. **从单一模型架构迁移到智能路由架构，如何做灰度验证确保路由策略不降低回答质量？**

</details>

---

### Q16: 设计 Agent 服务的全链路可观测性方案

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Agent 服务的可观测性比传统微服务复杂得多。传统服务的一个请求通常经过 3-5 个微服务就完成了；而 Agent 请求可能包含 LLM 推理（不确定执行时间）→ 工具调用（外部 API，不可控）→ 二次推理 → Sub-agent 分发 → 结果聚合的复杂链路，一个请求的调用链深度可能达到 10-20 层，跨越 GPU 推理、CPU 计算、外部网络三种截然不同的计算环境。

**生活类比**：如果传统微服务监控像是给一条流水线装摄像头，Agent 服务的可观测性就像给一座迷宫装监控——你不知道"玩家"（请求）会走哪条路，会在哪个房间停留多久，甚至可能走回头路（Agent 循环推理）。你需要在每个分叉路口、每扇门、每个房间都安装传感器，并且能实时拼出"玩家"的完整路径。

全链路可观测性需要覆盖三大支柱：**Metrics**（指标：系统和业务层面的数值度量）、**Traces**（链路追踪：单个请求的完整执行路径）、**Logs**（日志：详细的执行上下文和错误信息）。在 Agent 场景下，还需要增加第四根支柱：**LLM 评估（Evals）**——对模型输出质量的持续监控。

#### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent 全链路可观测性架构                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   数据采集层                              │    │
│  │                                                          │    │
│  │  ┌────────┐  ┌──────────┐  ┌────────┐  ┌────────────┐  │    │
│  │  │API GW  │  │Agent     │  │LLM     │  │Tool        │  │    │
│  │  │Metrics │  │Engine    │  │Service │  │Executor    │  │    │
│  │  │        │  │Traces    │  │Traces  │  │Logs        │  │    │
│  │  │• QPS   │  │• Span    │  │• TTFT  │  │• 调用状态  │  │    │
│  │  │• 延迟  │  │• 状态    │  │• TPS   │  │• 耗时      │  │    │
│  │  │• 错误率│  │• Token   │  │• 显存  │  │• 错误      │  │    │
│  │  └───┬────┘  └────┬─────┘  └───┬────┘  └─────┬──────┘  │    │
│  └──────┼────────────┼────────────┼──────────────┼──────────┘    │
│         │            │            │              │               │
│  ┌──────▼────────────▼────────────▼──────────────▼──────────┐    │
│  │                   数据管道层                                │    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────┐     │    │
│  │  │OpenTelemetry │  │ Kafka / Vector │  │ Sampling │     │    │
│  │  │Collector     │──│ (缓冲 & 路由)  │──│ Engine   │     │    │
│  │  │(统一采集)    │  │               │  │ (采样率)  │     │    │
│  │  └──────────────┘  └────────────────┘  └──────────┘     │    │
│  └──────┬────────────────────┬──────────────────┬───────────┘    │
│         │                    │                  │                │
│  ┌──────▼──────┐  ┌─────────▼────────┐  ┌─────▼──────────┐     │
│  │  Metrics    │  │  Traces          │  │  Logs          │     │
│  │  Store      │  │  Store           │  │  Store         │     │
│  │             │  │                  │  │                │     │
│  │ Prometheus  │  │ Jaeger / Tempo   │  │ Elasticsearch  │     │
│  │ + Thanos    │  │                  │  │ / Loki         │     │
│  └──────┬──────┘  └─────────┬────────┘  └─────┬──────────┘     │
│         │                    │                  │                │
│  ┌──────▼────────────────────▼──────────────────▼───────────┐    │
│  │                    可视化 & 告警层                          │    │
│  │                                                          │    │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │    │
│  │  │ Grafana    │  │ Alert      │  │ LLM Eval         │  │    │
│  │  │ Dashboard  │  │ Manager    │  │ Dashboard        │  │    │
│  │  │            │  │            │  │                   │  │    │
│  │  │ • 全局概览 │  │ • PagerDuty│  │ • 回答质量趋势   │  │    │
│  │  │ • GPU 监控 │  │ • Slack    │  │ • 幻觉率追踪     │  │    │
│  │  │ • 链路拓扑 │  │ • 自动升级 │  │ • 工具调用准确率 │  │    │
│  │  └────────────┘  └────────────┘  └───────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

#### Agent 专属 Metrics 体系

```
┌─────────────────────────────────────────────────────────────┐
│                    四层 Metrics 模型                          │
│                                                              │
│  Layer 1: 基础设施                                           │
│  ├── gpu_utilization_percent        GPU 利用率               │
│  ├── gpu_memory_used_bytes          GPU 显存使用             │
│  ├── cpu_usage_percent              CPU 使用率               │
│  └── network_io_bytes               网络吞吐                │
│                                                              │
│  Layer 2: 服务质量                                           │
│  ├── request_total                  请求总数（by 状态码）     │
│  ├── request_duration_seconds       请求延迟（P50/P95/P99）  │
│  ├── llm_time_to_first_token_ms    首 Token 延迟            │
│  ├── llm_tokens_per_second         Token 吞吐率             │
│  └── error_rate_percent             错误率                   │
│                                                              │
│  Layer 3: Agent 业务                                        │
│  ├── agent_steps_per_request        每请求 Agent 步数        │
│  ├── tool_call_count                工具调用次数             │
│  ├── tool_call_success_rate         工具调用成功率           │
│  ├── token_usage_per_request        每请求 Token 消耗        │
│  └── agent_loop_detection_count     循环检测触发次数         │
│                                                              │
│  Layer 4: 质量评估                                           │
│  ├── answer_relevance_score         回答相关性评分           │
│  ├── hallucination_rate             幻觉率                   │
│  ├── tool_selection_accuracy        工具选择准确率           │
│  └── user_satisfaction_score        用户满意度               │
└─────────────────────────────────────────────────────────────┘
```

#### 代码示例

```python
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class AgentSpan:
    """Agent 链路追踪的最小单元"""
    trace_id: str
    span_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    parent_span_id: Optional[str] = None
    operation: str = ""
    service: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    attributes: dict = field(default_factory=dict)
    events: list = field(default_factory=list)

    @property
    def duration_ms(self) -> float:
        return (self.end_time - self.start_time) * 1000

class AgentTracer:
    """Agent 全链路追踪器 — 扩展 OpenTelemetry 标准 Span"""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.spans: list[AgentSpan] = []
        self._current_span: Optional[AgentSpan] = None

    @contextmanager
    def start_span(self, operation: str, parent: Optional[AgentSpan] = None):
        span = AgentSpan(
            trace_id=parent.trace_id if parent else uuid.uuid4().hex[:32],
            parent_span_id=parent.span_id if parent else None,
            operation=operation,
            service=self.service_name,
            start_time=time.time(),
        )
        prev = self._current_span
        self._current_span = span
        try:
            yield span
        except Exception as e:
            span.attributes["error"] = True
            span.attributes["error.message"] = str(e)
            span.events.append({"name": "exception", "timestamp": time.time(),
                                "attributes": {"exception.type": type(e).__name__}})
            raise
        finally:
            span.end_time = time.time()
            self.spans.append(span)
            self._current_span = prev

    @contextmanager
    def trace_llm_call(self, model: str, parent: Optional[AgentSpan] = None):
        with self.start_span(f"llm.{model}", parent) as span:
            span.attributes["llm.model"] = model
            span.attributes["llm.provider"] = "self-hosted"
            yield span
            # 调用方负责设置 token 计数
            # span.attributes["llm.input_tokens"] = ...
            # span.attributes["llm.output_tokens"] = ...
            # span.attributes["llm.ttft_ms"] = ...

    @contextmanager
    def trace_tool_call(self, tool_name: str, parent: Optional[AgentSpan] = None):
        with self.start_span(f"tool.{tool_name}", parent) as span:
            span.attributes["tool.name"] = tool_name
            yield span

    @contextmanager
    def trace_agent_step(self, step_number: int, parent: Optional[AgentSpan] = None):
        with self.start_span(f"agent.step.{step_number}", parent) as span:
            span.attributes["agent.step"] = step_number
            yield span

    def export_summary(self) -> dict:
        if not self.spans:
            return {}
        root = next((s for s in self.spans if s.parent_span_id is None), self.spans[0])
        llm_spans = [s for s in self.spans if s.operation.startswith("llm.")]
        tool_spans = [s for s in self.spans if s.operation.startswith("tool.")]

        total_input = sum(s.attributes.get("llm.input_tokens", 0) for s in llm_spans)
        total_output = sum(s.attributes.get("llm.output_tokens", 0) for s in llm_spans)

        return {
            "trace_id": root.trace_id,
            "total_duration_ms": round(root.duration_ms, 1),
            "span_count": len(self.spans),
            "llm_calls": len(llm_spans),
            "tool_calls": len(tool_spans),
            "total_llm_time_ms": round(sum(s.duration_ms for s in llm_spans), 1),
            "total_tool_time_ms": round(sum(s.duration_ms for s in tool_spans), 1),
            "total_tokens": {"input": total_input, "output": total_output},
            "errors": [s.attributes.get("error.message")
                       for s in self.spans if s.attributes.get("error")],
        }

# 告警规则定义
ALERT_RULES = {
    "high_p99_latency": {
        "expr": 'histogram_quantile(0.99, rate(request_duration_seconds_bucket[5m])) > 5',
        "severity": "critical",
        "description": "P99 延迟超过 5 秒，可能存在推理队列堆积",
    },
    "high_error_rate": {
        "expr": 'rate(request_total{status="error"}[5m]) / rate(request_total[5m]) > 0.05',
        "severity": "critical",
        "description": "错误率超过 5%，需立即排查",
    },
    "gpu_memory_pressure": {
        "expr": "gpu_memory_used_bytes / gpu_memory_total_bytes > 0.90",
        "severity": "warning",
        "description": "GPU 显存使用超过 90%，可能导致 OOM",
    },
    "agent_loop_detected": {
        "expr": "rate(agent_loop_detection_count[5m]) > 0",
        "severity": "warning",
        "description": "检测到 Agent 循环推理，需检查 Prompt 或停止条件",
    },
    "hallucination_spike": {
        "expr": "avg_over_time(hallucination_rate[1h]) > 0.15",
        "severity": "warning",
        "description": "幻觉率超过 15%，模型输出质量下降",
    },
    "tool_call_timeout": {
        "expr": 'rate(tool_call_duration_seconds_count{status="timeout"}[5m]) > 1',
        "severity": "warning",
        "description": "工具调用超时频率升高，检查外部依赖",
    },
}
```

#### 关键对比

| 可观测性方案 | Metrics | Traces | Logs | LLM Evals | 成本/月 | 适用规模 |
|-------------|---------|--------|------|-----------|--------|---------|
| 基础方案（Prometheus + ELK） | ✅ | ❌ | ✅ | ❌ | ¥5K | < 10 万 DAU |
| 标准方案（+ Jaeger + 自建 Eval） | ✅ | ✅ | ✅ | 基础 | ¥20K | 10-100 万 DAU |
| 完整方案（+ LLM Judge + AIOps） | ✅ | ✅ | ✅ | ✅ | ¥80K | 100 万+ DAU |
| 托管方案（Datadog / Arize） | ✅ | ✅ | ✅ | ✅ | ¥150K+ | 任意（贵） |

#### 实际案例

某 Agent 平台接入全链路可观测性后的运维数据（100 万 DAU 规模）：
- **数据量**：日均产生 500 万条 Trace、2 亿个 Metric 数据点、50GB 日志
- **采样策略**：正常请求 1% 采样，错误请求 100% 采样，延迟 > P95 的请求 100% 采样
- **MTTR（平均修复时间）**：从引入前的 45 分钟降至 12 分钟（-73%）
- **故障发现**：87% 的故障在用户投诉前被告警系统发现
- **质量监控**：通过 LLM-as-Judge 实时评估发现了一次模型更新导致的幻觉率从 5% 飙升至 22%，在影响 <1% 用户时就回滚了模型版本
- **成本节约**：通过 Token 消耗 Dashboard 发现某个 Tool 的 System Prompt 含有冗余描述（占用 2K tokens/次），优化后月省 ¥8 万 Token 费用
- **存储优化**：Trace 数据 7 天热存 + 30 天温存 + 365 天冷存，存储成本控制在 ¥1.5 万/月

#### 面试追问

1. **如何在不显著影响性能的前提下实现 100% 的 Trace 采集？Head-based 和 Tail-based sampling 各自的优劣？**
2. **LLM-as-Judge 的评估结果本身也可能不准确，如何校准评估模型？是否需要 Human-in-the-loop？**
3. **当 Agent 执行链路包含用户敏感数据（如个人信息、财务数据），如何在保证可观测性的同时满足数据合规（GDPR/个保法）？**

</details>
