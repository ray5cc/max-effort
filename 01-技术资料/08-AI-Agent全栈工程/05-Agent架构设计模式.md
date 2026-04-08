# Agent 架构设计模式

> 从 Codex CLI、Claude Code 到 OpenHands，深入剖析生产级 AI Agent 的架构设计模式与工程实践

## 相关链接

- 对应面试题：[Agent架构设计模式面试题](../../02-面试指南/08-AI-Agent全栈工程面试/05-Agent架构设计模式面试题.md)

## TL;DR 速览

- Agent 架构的核心是 **感知-推理-行动（Perceive-Reason-Act）** 循环，所有变体都是这个循环的工程实现
- **ReAct 模式** 是最基础的 Agent 范式：思考 → 行动 → 观察 → 再思考，Claude Code 和 Codex CLI 均基于此
- **Harness 模式**（Claude Code 首创）：Agent 运行在受控环境中，Harness 提供工具、沙箱、权限边界
- **状态图模式**（LangGraph）：将 Agent 工作流建模为有向图，支持条件分支、循环、人工审批
- 生产级 Agent 必须解决三大工程挑战：**上下文管理、错误恢复、人机协同**
- **CLAUDE.md/AGENTS.md** 等项目级配置文件是 Agent 理解项目上下文的关键工程创新
- 多 Agent 系统有三种拓扑：**Hub-Spoke**（中心调度）、**Pipeline**（流水线）、**Peer-to-Peer**（对等通信）

## 目录

1. [为什么需要 Agent 架构设计？](#_1-为什么需要-agent-架构设计)
2. [Agent 核心循环与基础模式](#_2-agent-核心循环与基础模式)
3. [Coding Agent 架构深度解析](#_3-coding-agent-架构深度解析)
4. [状态图与工作流编排](#_4-状态图与工作流编排)
5. [上下文管理工程](#_5-上下文管理工程)
6. [多 Agent 系统架构](#_6-多-agent-系统架构)
7. [人机协同设计模式](#_7-人机协同设计模式)
8. [常见陷阱与最佳实践](#_8-常见陷阱与最佳实践)
9. [延伸与前沿](#_9-延伸与前沿)

---

## 1. 为什么需要 Agent 架构设计？

### 1.1 从"单次问答"到"自主执行"

传统 LLM 应用是"单次问答"——用户提问，LLM 回答，结束。Agent 则是"自主执行"——给定一个目标，Agent 自主规划步骤、调用工具、处理异常、完成任务。

**类比**：传统 LLM 像一个只能回答问题的"百科全书"，Agent 像一个能独立完成任务的"实习生"——你给他一个需求，他会自己思考步骤、查资料、写代码、测试、修复问题。

### 1.2 Agent 的工程复杂性

让 Agent 可靠地工作，远比"调一次 API"复杂：

| 挑战 | 说明 | 工程方案 |
|------|------|---------|
| 上下文窗口有限 | LLM 的上下文窗口是有限的（4K-200K tokens） | 上下文压缩、摘要、分层记忆 |
| 工具调用可能失败 | 文件操作、API 调用、命令执行都可能出错 | 重试、错误恢复、回滚 |
| 推理可能出错 | LLM 可能产生幻觉、选择错误工具 | 验证循环、自我纠正 |
| 安全风险 | Agent 有执行权限，错误操作后果严重 | 沙箱隔离、权限最小化 |
| 成本不可控 | Agent 循环可能导致 Token 消耗暴增 | Token 预算、步数上限 |

---

## 2. Agent 核心循环与基础模式

### 2.1 感知-推理-行动循环

所有 Agent 架构的本质都是这个循环：

```
┌─────────────────────────────────────────┐
│           Agent 核心循环                 │
│                                         │
│    ┌──────────┐                         │
│    │  感知     │ ← 用户输入 / 工具输出   │
│    │ Perceive │                         │
│    └────┬─────┘                         │
│         ▼                               │
│    ┌──────────┐                         │
│    │  推理     │ ← LLM 决策             │
│    │ Reason   │                         │
│    └────┬─────┘                         │
│         ▼                               │
│    ┌──────────┐                         │
│    │  行动     │ → 调用工具 / 输出结果   │
│    │  Act     │                         │
│    └────┬─────┘                         │
│         │                               │
│         └──── 循环直到任务完成 ──────────┘
│
└─────────────────────────────────────────┘
```

### 2.2 ReAct 模式

ReAct（Reasoning + Acting）是最基础也是最实用的 Agent 模式：

```
用户：帮我查看 src/app.py 中是否有未处理的异常

Agent 思考：我需要先读取文件内容
Agent 行动：read_file("src/app.py")
Agent 观察：[文件内容...]

Agent 思考：我看到第 42 行有一个 bare except，需要改进
Agent 行动：search_pattern("except:", "src/app.py")
Agent 观察：找到 3 处 bare except

Agent 思考：我应该将 bare except 改为具体的异常类型
Agent 行动：edit_file("src/app.py", ...)
Agent 观察：文件修改成功

Agent 回答：已发现并修复 3 处未处理异常...
```

**核心伪代码**：

```python
def react_loop(user_message, tools, max_steps=20):
    messages = [{"role": "user", "content": user_message}]
    
    for step in range(max_steps):
        # 推理：LLM 决定下一步行动
        response = llm.chat(messages, tools=tools)
        
        if response.has_tool_calls:
            # 行动：执行工具调用
            for tool_call in response.tool_calls:
                result = execute_tool(tool_call)
                messages.append({"role": "tool", "content": result})
        else:
            # 任务完成，返回最终回答
            return response.content
    
    raise MaxStepsExceeded()
```

### 2.3 Plan-and-Execute 模式

先制定完整计划，再逐步执行。适合复杂任务：

```
用户：重构整个认证模块，从 session 迁移到 JWT

Agent 规划阶段：
  1. 分析当前 session 认证的所有代码
  2. 设计 JWT 认证的架构
  3. 实现 JWT 生成和验证模块
  4. 修改所有使用 session 的中间件
  5. 更新单元测试
  6. 运行测试验证

Agent 执行阶段：
  Step 1: [执行] → [观察结果] → [更新计划]
  Step 2: [执行] → [观察结果] → [更新计划]
  ...
```

---

## 3. Coding Agent 架构深度解析

### 3.1 Claude Code — Harness Engineering 模式

Claude Code（Anthropic）开创了 "Harness Engineering" 模式，核心理念：**Agent 不是独立运行的程序，而是运行在受控 Harness 中的 LLM。**

```
┌─────────────────────────────────────────────────────┐
│                   Harness (宿主环境)                  │
│                                                      │
│  ┌────────────┐   ┌──────────┐   ┌──────────────┐  │
│  │ CLAUDE.md   │   │ 工具集    │   │ 权限系统     │  │
│  │ (项目上下文)│   │ (沙箱化) │   │ (最小权限)   │  │
│  └──────┬─────┘   └────┬─────┘   └──────┬───────┘  │
│         │              │                │           │
│  ┌──────▼──────────────▼────────────────▼───────┐   │
│  │                Agent (LLM)                    │   │
│  │    System Prompt + CLAUDE.md + 对话历史       │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │                           │
│  ┌──────────────────────▼───────────────────────┐   │
│  │              Tool Execution Layer             │   │
│  │  ┌────────┐  ┌────────┐  ┌──────────────┐   │   │
│  │  │ 文件读写 │  │ 终端执行 │  │ 搜索 (grep) │   │   │
│  │  └────────┘  └────────┘  └──────────────┘   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              沙箱 (Sandbox)                    │   │
│  │  网络限制 │ 文件系统隔离 │ 进程隔离            │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**CLAUDE.md 的工程设计**：

CLAUDE.md 是 Claude Code 最重要的工程创新之一——让 Agent 理解项目上下文的配置文件：

```markdown
# CLAUDE.md

## 项目概述
这是一个 Next.js 电商平台，使用 TypeScript + Prisma + PostgreSQL

## 代码规范
- 使用 single quotes
- 组件使用 PascalCase
- API 路由使用 RESTful 命名

## 常见命令
- 构建：npm run build
- 测试：npm run test
- Lint：npm run lint

## 架构决策
- 认证使用 NextAuth.js
- 状态管理使用 Zustand
- 数据库迁移使用 Prisma Migrate
```

**记忆层级设计**：

```
优先级从高到低：
1. 项目级 CLAUDE.md（最高优先级）
2. 目录级 CLAUDE.md（覆盖项目级的对应设置）
3. 用户全局配置（~/.claude/settings.json）
4. LLM 的参数化记忆（训练时学到的知识）
```

### 3.2 Codex CLI — AGENTS.md 与模块化设计

Codex CLI（OpenAI）采用模块化的 Agent 架构，通过 AGENTS.md 提供项目规范：

**核心架构特点**：
- **快照测试**：每次代码修改后运行测试，确保不引入回归
- **模块化提示**：System Prompt 按功能模块组合，而非单一大 Prompt
- **API 约定**：严格的函数签名和返回值约定，减少 LLM 理解歧义

```
AGENTS.md 示例：
┌─────────────────────────────────────────┐
│ # AGENTS.md                              │
│                                          │
│ ## Build & Test                          │
│ - Build: make build                      │
│ - Test: make test                        │
│ - Lint: make lint                        │
│                                          │
│ ## Code Conventions                      │
│ - Error handling: use ErrKind wrapper    │
│ - Tests: use table-driven tests          │
│ - Naming: snake_case for functions       │
│                                          │
│ ## Architecture                          │
│ - Entry point: src/main.rs               │
│ - Config: config/default.toml            │
└─────────────────────────────────────────┘
```

### 3.3 OpenHands — 完全自主的开发 Agent

OpenHands（原 OpenDevin, github.com/All-Hands-AI/OpenHands）是一个完全自主的软件开发 Agent：

**架构特点**：
- **Docker 沙箱**：每个 Agent 运行在独立的 Docker 容器中
- **事件流架构**：所有操作记录为事件流，可回放、可审计
- **Observation-Action 循环**：类似 ReAct，但增加了更多结构化的 Observation 类型

```
┌─────────────────────────────────────┐
│            OpenHands 架构            │
│                                      │
│  ┌─────────────┐                    │
│  │ Controller   │ ← 事件循环管理     │
│  └──────┬──────┘                    │
│         ▼                           │
│  ┌─────────────┐   ┌────────────┐  │
│  │ Agent        │──→│ Runtime    │  │
│  │ (LLM Loop)  │   │ (Docker    │  │
│  │              │←──│  Sandbox)  │  │
│  └─────────────┘   └────────────┘  │
│         │                           │
│  ┌──────▼──────┐                    │
│  │ Event Stream │ ← 完整审计日志     │
│  └─────────────┘                    │
└─────────────────────────────────────┘
```

### 3.4 三大 Coding Agent 范式对比

| 特性 | Claude Code | Codex CLI | OpenHands |
|------|------------|-----------|-----------|
| 交互模式 | 交互式 CLI | CLI + 非交互 | Web UI |
| 沙箱机制 | 内置沙箱 | 系统级隔离 | Docker 容器 |
| 上下文配置 | CLAUDE.md 层级 | AGENTS.md | 代码库索引 |
| 多 Agent | Subagent 模式 | 单 Agent | Controller+Agent |
| 工具调用 | Read/Write/Bash/Search | Read/Write/Bash | 全操作系统权限 |
| CI 集成 | GitHub Actions | GitHub Actions | 内置 |
| 适用场景 | 日常开发 | 自动化修复 | 全自主开发 |

---

## 4. 状态图与工作流编排

### 4.1 LangGraph 状态图模式

LangGraph 将 Agent 工作流建模为有向图，支持条件分支、循环、并行执行：

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal

class AgentState(TypedDict):
    messages: list
    next_step: str
    retry_count: int

def should_continue(state: AgentState) -> Literal["tools", "end"]:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "end"

# 构建状态图
workflow = StateGraph(AgentState)
workflow.add_node("agent", call_model)
workflow.add_node("tools", execute_tools)
workflow.add_node("human_review", wait_for_approval)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    "end": END
})
workflow.add_edge("tools", "agent")  # 工具执行后回到 Agent

graph = workflow.compile()
```

### 4.2 常见工作流模式

**模式 1：线性管道**
```
Input → Agent A → Agent B → Agent C → Output
```

**模式 2：路由分发**
```
         ┌→ 代码Agent → 合并 →┐
Input →  ├→ 测试Agent → 合并 →├→ Output
         └→ 文档Agent → 合并 →┘
```

**模式 3：Human-in-the-Loop**
```
Agent → 生成方案 → [人工审批] → 执行 → 验证
                      ↑                  │
                      └── 不通过 ← 修改 ←┘
```

---

## 5. 上下文管理工程

### 5.1 上下文窗口是最稀缺的资源

LLM 的上下文窗口是有限的（即使 200K tokens 也不够装下整个代码库）。上下文管理是 Agent 工程的核心挑战。

### 5.2 上下文管理策略

**策略 1：渐进式加载**

```
不要一次性加载整个代码库！
Step 1: 加载项目结构（目录树）
Step 2: 根据任务加载相关文件
Step 3: 只保留相关代码片段

类比：你不会把整个图书馆搬到桌上，而是先看目录，
      找到相关章节，只翻开需要的页面。
```

**策略 2：滑动窗口与摘要**

```python
def manage_context(messages, max_tokens=100000):
    """当消息超过上下文窗口时，压缩旧消息"""
    total_tokens = count_tokens(messages)
    
    if total_tokens > max_tokens:
        # 保留系统提示和最近的消息
        system = messages[0]
        recent = messages[-10:]
        
        # 对中间消息生成摘要
        middle = messages[1:-10]
        summary = llm.summarize(middle)
        
        return [system, {"role": "system", "content": f"之前对话摘要: {summary}"}] + recent
    
    return messages
```

**策略 3：Claude Code 的记忆层级**

```
┌─────────────────────────────────┐
│ 上下文窗口 (短期记忆)             │
│ - 当前对话                       │
│ - 最近的工具调用结果              │
├─────────────────────────────────┤
│ 项目配置 (中期记忆)               │
│ - CLAUDE.md                      │
│ - 项目结构缓存                   │
├─────────────────────────────────┤
│ 全局设置 (长期记忆)               │
│ - 用户偏好                       │
│ - 代码风格规则                   │
├─────────────────────────────────┤
│ 参数化记忆 (永久记忆)             │
│ - LLM 训练数据中的知识           │
└─────────────────────────────────┘
```

---

## 6. 多 Agent 系统架构

### 6.1 三种拓扑模式

**Hub-Spoke（中心调度）**：

```
                ┌──────────┐
         ┌─────│ 调度 Agent │─────┐
         │     └──────────┘     │
         ▼          ▼           ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │代码Agent│ │测试Agent│ │文档Agent│
    └────────┘ └────────┘ └────────┘
```

优点：逻辑清晰，易于监控和调试
缺点：调度 Agent 成为瓶颈，扩展性受限

**Pipeline（流水线）**：

```
    输入 → [需求分析Agent] → [设计Agent] → [编码Agent] → [测试Agent] → 输出
```

优点：每个环节专注、职责明确
缺点：上游错误逐级放大，反馈循环慢

**Peer-to-Peer（对等通信）**：

```
    ┌────────┐ ←→ ┌────────┐
    │Agent A  │    │Agent B  │
    └────┬───┘    └────┬───┘
         │             │
         └──────┬──────┘
                ▼
          ┌────────┐
          │Agent C  │
          └────────┘
```

优点：灵活性最高，适合协作密集的任务
缺点：通信复杂，难以调试

### 6.2 实际案例：AutoGen 多 Agent 对话

```python
from autogen import AssistantAgent, UserProxyAgent

# 创建专家 Agent
coder = AssistantAgent(
    name="Coder",
    system_message="你是一个高级 Python 开发者，负责编写代码。",
    llm_config={"model": "gpt-4o"}
)

reviewer = AssistantAgent(
    name="Reviewer",
    system_message="你是代码审查专家，负责审查代码质量和安全性。",
    llm_config={"model": "gpt-4o"}
)

# 用户代理（Human-in-the-Loop）
user = UserProxyAgent(
    name="User",
    human_input_mode="TERMINATE",
    code_execution_config={"work_dir": "workspace"}
)

# 启动多 Agent 对话
user.initiate_chat(
    coder,
    message="实现一个带有限流的 API 网关"
)
```

---

## 7. 人机协同设计模式

### 7.1 四个介入级别

| 级别 | 名称 | 说明 | 适用场景 |
|------|------|------|---------|
| L0 | 全自动 | Agent 独立完成，无人介入 | 低风险自动化任务 |
| L1 | 通知确认 | 关键操作前通知人类，等待确认 | 代码部署、数据修改 |
| L2 | 主动审查 | 每 N 步主动暂停，等待审查 | 新 Agent、不熟悉的任务 |
| L3 | 实时协作 | 人类和 Agent 交替操作 | 日常开发、对话式编程 |

### 7.2 权限分级实现

```python
class PermissionSystem:
    LEVELS = {
        "read": 0,     # 读取文件、搜索代码
        "write": 1,    # 修改文件、创建文件
        "execute": 2,  # 运行命令、执行脚本
        "network": 3,  # 网络请求、API 调用
        "deploy": 4,   # 部署、发布操作
    }
    
    def check_permission(self, action, auto_approve_level=1):
        action_level = self.LEVELS.get(action.type, 99)
        if action_level <= auto_approve_level:
            return True  # 自动批准
        else:
            return self.request_human_approval(action)
```

---

## 8. 常见陷阱与最佳实践

### ❌ 陷阱 1：无限循环

```python
# ❌ 错误：没有设置最大步数，Agent 可能无限循环
while not task_complete:
    response = agent.step()

# ✅ 正确：设置步数上限和 Token 预算
MAX_STEPS = 50
MAX_TOKENS = 200000
for step in range(MAX_STEPS):
    if total_tokens > MAX_TOKENS:
        break
    response = agent.step()
```

### ❌ 陷阱 2：将所有上下文塞入 System Prompt

```python
# ❌ 错误：把整个代码库塞进上下文
system_prompt = f"Here is the entire codebase:\n{all_files_content}"

# ✅ 正确：按需加载，渐进式提供上下文
system_prompt = "Use read_file tool to explore the codebase as needed."
```

### ❌ 陷阱 3：忽略工具调用的错误处理

```python
# ❌ 错误：假设工具调用总是成功
result = execute_tool(tool_call)
messages.append({"role": "tool", "content": result})

# ✅ 正确：处理工具执行失败的情况
try:
    result = execute_tool(tool_call)
    messages.append({"role": "tool", "content": result})
except ToolExecutionError as e:
    messages.append({
        "role": "tool", 
        "content": f"Error: {e}. Please try a different approach."
    })
```

### ❌ 陷阱 4：多 Agent 系统没有明确的职责边界

```python
# ❌ 错误：所有 Agent 都是"万能助手"
agent_a = Agent(system_message="You are a helpful assistant")
agent_b = Agent(system_message="You are a helpful assistant")

# ✅ 正确：每个 Agent 有明确的专业领域
coder = Agent(system_message="You write code. You do NOT review or test code.")
tester = Agent(system_message="You write tests. You do NOT modify production code.")
```

### ❌ 陷阱 5：不提供项目级上下文文件

```bash
# ❌ 错误：让 Agent 从零开始理解项目
# Agent 需要多次文件读取才能理解项目结构和规范

# ✅ 正确：提供 CLAUDE.md / AGENTS.md
# Agent 启动时立即获得项目的关键上下文
echo "# CLAUDE.md
## Build: npm run build
## Test: npm test
## Style: Use TypeScript strict mode" > CLAUDE.md
```

### ❌ 陷阱 6：Agent 直接操作生产环境

```python
# ❌ 错误：Agent 可以直接访问生产数据库
agent_tools = [ProductionDBTool(), ProductionAPITool()]

# ✅ 正确：Agent 只能在沙箱中操作，部署需要人工审批
agent_tools = [SandboxDBTool(), StagingAPITool()]
deploy_tool = HumanApprovalRequired(ProductionDeployTool())
```

---

## 9. 延伸与前沿

### 9.1 Agent 评估体系

评估 Agent 质量是开放挑战：
- **SWE-bench**：软件工程任务基准测试（修复 GitHub Issue）
- **HumanEval**：代码生成正确性评估
- **WebArena**：Web 自动化任务评估
- 企业内部：基于历史任务的回归测试

### 9.2 Agent 可靠性工程

- **确定性回退**：当 LLM 不确定时，回退到规则引擎
- **多数投票**：多次运行取共识结果
- **监督学习**：用人类反馈微调 Agent 的决策

### 9.3 2026 年趋势

1. **Agent 即服务**：Agent 作为微服务部署，通过 A2A 协议互操作
2. **自进化 Agent**：Agent 从历史执行中学习，自动优化工作流
3. **多模态 Agent**：结合视觉、语音、代码理解的全模态 Agent
4. **Agent OS**：类似操作系统的 Agent 运行环境，管理 Agent 的生命周期、资源、权限
