# 09-多Agent系统 — 技术资料

> 深入讲解多智能体（Multi-Agent）系统的架构设计、通信模式与编排策略，涵盖 Microsoft AutoGen、Dify LLMOps 平台与 Agent 设计模式，帮助开发者构建可协作、可扩展的 AI Agent 系统。

## 目录

- [1. 概述](#1-概述)
- [2. 多Agent核心概念](#2-多agent核心概念)
- [3. Microsoft AutoGen](#3-microsoft-autogen)
  - [3.1 核心架构](#31-核心架构)
  - [3.2 双Agent对话模式](#32-双agent对话模式)
  - [3.3 GroupChat 多人对话](#33-groupchat-多人对话)
  - [3.4 Nested Chat 嵌套对话](#34-nested-chat-嵌套对话)
- [4. Dify：LLMOps 平台](#4-difyllmops-平台)
  - [4.1 平台架构](#41-平台架构)
  - [4.2 工作流编排](#42-工作流编排)
  - [4.3 Agent 节点设计](#43-agent-节点设计)
- [5. Agent 设计模式](#5-agent-设计模式)
- [6. 通信协议与消息总线](#6-通信协议与消息总线)
- [7. 实战示例](#7-实战示例)
- [8. 最佳实践与反模式](#8-最佳实践与反模式)
- [导航](#导航)

---

## 1. 概述

### 1.1 为什么需要多 Agent

单个 Agent 的能力受到以下限制：
- **上下文窗口限制**：复杂任务超出单次对话容量
- **专业能力边界**：一个模型难以同时精通代码、数学、写作
- **并行效率**：单 Agent 只能串行执行子任务
- **错误传播**：单点失败导致整体失败

多 Agent 系统通过**分工协作**解决这些问题：

```
用户需求（复杂）
        │
  ┌─────▼──────┐
  │ 协调器 Agent │  ← 任务分解、调度
  └─────┬──────┘
        │ 分发
  ┌─────┼─────┐
  │     │     │
 研究  代码  写作    ← 专业化 Agent
 Agent Agent Agent
  │     │     │
  └─────┼─────┘
        │ 汇总
  ┌─────▼──────┐
  │   最终结果   │
  └────────────┘
```

### 1.2 单 Agent vs 多 Agent

| 维度 | 单 Agent | 多 Agent |
|------|---------|---------|
| 适用任务 | 简单、线性任务 | 复杂、并行、跨域任务 |
| 延迟 | 低 | 较高（通信开销） |
| 成本 | 低 | 较高 |
| 容错性 | 差 | 好（可重试单个 Agent） |
| 可维护性 | 简单 | 复杂（需管理 Agent 间状态） |

---

## 2. 多Agent核心概念

### 2.1 Agent 角色分类

```
多 Agent 系统中的角色
├── 用户代理（User Proxy Agent）
│     代表人类用户，执行代码、审批决策
├── 助手代理（Assistant Agent）
│     调用 LLM 生成回答或计划
├── 专家代理（Domain Expert Agent）
│     数学家、程序员、法律顾问等专业角色
├── 协调者（Orchestrator）
│     分配任务、汇总结果、决定终止条件
└── 评判者（Critic / Reviewer）
      审查其他 Agent 的输出，提供反馈
```

### 2.2 消息传递模型

多 Agent 系统中，Agent 间通过**结构化消息**通信：

```json
{
  "role": "assistant",
  "name": "CodeAgent",
  "content": "这是实现排序算法的 Python 代码：\n```python\n...\n```",
  "metadata": {
    "token_count": 256,
    "tool_calls": [],
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

### 2.3 终止条件

多 Agent 对话必须有明确的终止条件，否则会无限循环：

| 终止条件类型 | 说明 | 示例 |
|-----------|------|------|
| 关键词检测 | 检测到特定词语 | 消息包含 "TERMINATE" |
| 最大轮次 | 限制对话轮数 | `max_turns=10` |
| 任务完成确认 | 用户或协调者确认 | 人工审批 |
| 代码执行成功 | 代码无错误退出 | 单元测试全部通过 |

---

## 3. Microsoft AutoGen

> 项目参考：[microsoft/autogen](https://github.com/microsoft/autogen)

AutoGen 是微软研究院开发的多 Agent 对话框架，核心特点是 **"可对话 Agent（Conversable Agents）"**——每个 Agent 都可以发起和参与对话。

### 3.1 核心架构

```
AutoGen 核心层次

ConversableAgent（基类）
├── AssistantAgent    ← LLM 驱动的助手
├── UserProxyAgent    ← 代理人类，可执行代码
├── GroupChatManager  ← GroupChat 的主持人
└── 自定义 Agent      ← 继承 ConversableAgent 实现
```

**Agent 初始化模板：**

```python
import autogen

# LLM 配置
llm_config = {
    "config_list": [
        {"model": "gpt-4o", "api_key": "YOUR_API_KEY"}
    ],
    "temperature": 0.7,
    "timeout": 120,
}

# 创建助手 Agent（LLM 驱动）
assistant = autogen.AssistantAgent(
    name="Assistant",
    system_message="""你是一个 Python 专家。
    当任务完成时，请在消息末尾加上 'TERMINATE'。""",
    llm_config=llm_config,
)

# 创建用户代理（可执行代码）
user_proxy = autogen.UserProxyAgent(
    name="User",
    human_input_mode="NEVER",  # 全自动；或 "ALWAYS"/"TERMINATE"
    code_execution_config={
        "work_dir": "./workspace",
        "use_docker": False,     # 生产环境建议使用 Docker 沙箱
    },
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
)
```

---

### 3.2 双Agent对话模式

最简单的 AutoGen 使用场景：一个 User Proxy + 一个 Assistant 的"二人对话"。

```python
# 启动对话
result = user_proxy.initiate_chat(
    assistant,
    message="用 Python 写一个快速排序函数，并添加单元测试。",
    max_turns=10,
)

# 对话流程示意：
# User → "写快速排序"
# Assistant → "好的，代码如下：```python ...```"
# User（执行代码）→ "代码执行成功，输出：[...]"
# Assistant → "测试通过！TERMINATE"
```

**工作原理：**

1. `UserProxyAgent` 将用户消息发给 `AssistantAgent`
2. `AssistantAgent` 调用 LLM 生成回复（可能含代码块）
3. `UserProxyAgent` 检测代码块，自动执行并将结果回传
4. 循环直到触发终止条件

---

### 3.3 GroupChat 多人对话

`GroupChat` 允许多个 Agent 在一个"群聊"中协作，类似于一个会议室。

```python
import autogen

# 定义多个专业 Agent
planner = autogen.AssistantAgent(
    name="Planner",
    system_message="你是项目规划专家，负责将需求分解为子任务。",
    llm_config=llm_config,
)

coder = autogen.AssistantAgent(
    name="Coder",
    system_message="你是 Python 开发专家，负责编写高质量代码。",
    llm_config=llm_config,
)

reviewer = autogen.AssistantAgent(
    name="Reviewer",
    system_message="你是代码审查专家，负责检查代码质量和安全问题。",
    llm_config=llm_config,
)

user_proxy = autogen.UserProxyAgent(
    name="User",
    human_input_mode="TERMINATE",
    code_execution_config={"work_dir": "./workspace"},
)

# 创建 GroupChat
group_chat = autogen.GroupChat(
    agents=[user_proxy, planner, coder, reviewer],
    messages=[],
    max_round=20,
    speaker_selection_method="auto",  # LLM 决定下一个发言者
    # 或 "round_robin"（轮流发言）、"random"（随机）
)

# GroupChat 主持人（协调发言顺序）
manager = autogen.GroupChatManager(
    groupchat=group_chat,
    llm_config=llm_config,
)

# 启动群聊
user_proxy.initiate_chat(
    manager,
    message="开发一个 RESTful API 用于用户管理，包含 CRUD 操作。",
)
```

**GroupChat 发言顺序策略：**

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `"auto"` | LLM 根据上下文决定谁发言 | 通用场景，最智能 |
| `"round_robin"` | 按顺序轮流 | 每个 Agent 都需要参与 |
| `"random"` | 随机选择 | 需要多样性 |
| 自定义函数 | 编程控制发言顺序 | 复杂业务逻辑 |

---

### 3.4 Nested Chat 嵌套对话

嵌套对话允许 Agent 在其内部启动一个子对话，用于复杂的子任务分解。

```python
# 外层：用户与协调者对话
# 内层：协调者内部启动 Planner↔Coder 子对话

# 注册嵌套对话回调
assistant.register_nested_chats(
    trigger=user_proxy,
    chat_queue=[
        {
            "recipient": planner,
            "message": lambda recipient, messages, sender, config: 
                f"请规划以下任务：{messages[-1]['content']}",
            "max_turns": 3,
            "summary_method": "last_msg",  # 用最后一条消息作为子对话摘要
        },
        {
            "recipient": coder,
            "message": "请根据规划编写代码",
            "max_turns": 5,
            "summary_method": "reflection_with_llm",  # 用 LLM 总结
        },
    ],
)
```

---

## 4. Dify：LLMOps 平台

> 项目参考：[langgenius/dify](https://github.com/langgenius/dify)

Dify 是一个开源的 LLMOps（LLM 运营）平台，提供可视化的 Agent 构建、工作流编排和应用部署能力。

### 4.1 平台架构

```
Dify 整体架构
┌──────────────────────────────────────────────┐
│                   前端 Web UI                 │
│  工作流编辑器 │ 应用管理 │ 数据集管理 │ 监控   │
└──────────────────────┬───────────────────────┘
                       │ REST API
┌──────────────────────▼───────────────────────┐
│                   后端 API                    │
│  Flask/Celery │ 工作流引擎 │ LLM 代理层        │
└────┬──────────────────┬────────────────┬─────┘
     │                  │                │
┌────▼────┐      ┌──────▼───┐    ┌───────▼────┐
│ PostgreSQL│     │  Redis   │    │  向量数据库  │
│（元数据）  │     │（队列/缓存）│    │（Weaviate等）│
└──────────┘     └──────────┘    └────────────┘
```

**技术栈：**
- 后端：Python + Flask + SQLAlchemy + Celery
- 前端：React + TypeScript + Tailwind CSS
- 工作流引擎：自研 DAG 引擎
- 支持模型：OpenAI、Anthropic、Azure OpenAI、本地 Ollama 等 100+ 模型

### 4.2 工作流编排

Dify 的工作流（Workflow）是一个 **有向无环图（DAG）**，每个节点是一种处理单元：

```
用户输入
    │
    ▼
[LLM 节点] → 调用 GPT-4 生成初稿
    │
    ▼
[代码节点] → Python 代码处理数据
    │
    ▼
[条件分支] → 如果字数 > 1000 → [摘要节点]
            └─ 否则 ──────────► [输出节点]
```

**节点类型：**

| 节点类型 | 功能 |
|---------|------|
| LLM 节点 | 调用 LLM 生成文本 |
| 知识检索节点 | 从向量数据库检索相关文档 |
| 代码节点 | 执行 Python/JavaScript 代码 |
| HTTP 请求节点 | 调用外部 API |
| 条件分支节点 | 根据条件走不同路径 |
| 迭代节点 | 对列表中每个元素执行子流程 |
| 工具节点 | 调用内置工具（搜索、计算器等） |
| Agent 节点 | 嵌入一个 ReAct/Function Calling Agent |

### 4.3 Agent 节点设计

Dify 的 Agent 节点支持两种推理模式：

**Function Calling 模式（推荐）：**
- 适用于 GPT-4、Claude 等支持 Function Calling 的模型
- 模型自主决定调用哪些工具
- 更稳定，工具使用更精准

**ReAct 模式（兼容性好）：**
- 适用于不支持 Function Calling 的开源模型
- 通过 Thought → Action → Observation 循环推理
- 实现更简单但需要更好的 Prompt 设计

```yaml
# Dify Agent 节点 DSL 配置示例
nodes:
  - id: agent_node_1
    type: agent
    title: 研究助手
    config:
      model: gpt-4o
      strategy: function_calling
      tools:
        - type: builtin
          name: web_search
        - type: builtin
          name: calculator
        - type: api
          name: custom_api
          url: https://api.example.com/search
      max_iterations: 10
      system_prompt: |
        你是一个专业的研究助手。
        使用提供的工具完成用户的研究任务。
```

---

## 5. Agent 设计模式

> 参考：[datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents)

### 5.1 反思模式（Reflection）

Agent 生成回答后，由另一个 Agent 或自身进行审查和反思：

```
生成者 Agent ──► 初步回答 ──► 反思者 Agent ──► 批评/改进建议
      ▲                                              │
      └──────────────── 修订 ◄────────────────────────┘
                    （循环 N 次）
```

```python
# 反思模式实现示例
class ReflectionSystem:
    def __init__(self, generator, critic, max_iterations=3):
        self.generator = generator
        self.critic = critic
        self.max_iterations = max_iterations
    
    def run(self, task):
        response = self.generator.generate(task)
        for i in range(self.max_iterations):
            feedback = self.critic.critique(task, response)
            if feedback.is_satisfactory:
                break
            response = self.generator.revise(response, feedback)
        return response
```

### 5.2 规划执行模式（Plan and Execute）

先规划再执行，适合复杂多步骤任务：

```
用户任务
    │
[规划器] → 步骤列表：[步骤1, 步骤2, 步骤3]
    │
[执行器] 逐一执行每个步骤
    ├── 步骤1：搜索信息
    ├── 步骤2：分析数据
    └── 步骤3：生成报告
    │
[终止判断] 所有步骤完成？
```

### 5.3 工具使用模式（Tool Use / ReAct）

```
Thought: 我需要搜索最新数据
Action: web_search("2024年AI市场规模")
Observation: 搜索结果显示...

Thought: 我需要计算增长率
Action: calculator("(2024值 - 2023值) / 2023值 * 100")
Observation: 增长率为 35.2%

Thought: 我已经有足够的信息
Final Answer: 2024年AI市场规模约为...
```

### 5.4 多Agent辩论模式（Multi-Agent Debate）

多个 Agent 持不同观点，通过辩论得出更好的答案：

```python
# 辩论模式
positions = ["正方：AI 将替代大部分工作", "反方：AI 将创造更多工作"]
agents = [AssistantAgent(system_message=pos) for pos in positions]

# 三轮辩论后，裁判 Agent 总结共识
judge = AssistantAgent(system_message="请综合双方观点，给出平衡的结论")
```

### 5.5 监督者-工作者模式（Supervisor-Worker）

```
┌──────────────────────────────────────────────┐
│              监督者 Supervisor                │
│  任务分解 │ 工作者分配 │ 结果验证 │ 质量控制   │
└───────────┬──────────────────────────────────┘
            │ 分配子任务
    ┌────────┼────────┐
    │        │        │
┌───▼───┐ ┌──▼──┐ ┌───▼───┐
│工作者1 │ │工作者2│ │工作者3 │
│数据收集│ │分析  │ │报告生成│
└───────┘ └─────┘ └───────┘
```

---

## 6. 通信协议与消息总线

### 6.1 Agent 间通信方式

| 方式 | 特点 | 适用场景 |
|------|------|---------|
| 直接调用 | 同步、低延迟 | 简单二人对话 |
| 消息队列（Redis/RabbitMQ） | 异步、解耦 | 大规模分布式 Agent |
| 共享内存/黑板系统 | 高效共享状态 | 需要全局状态的协作 |
| 事件总线 | 发布/订阅模式 | 松耦合、可扩展 |

### 6.2 Agent 状态管理

多 Agent 系统中，状态管理是核心挑战：

```python
# 使用 LangGraph 管理多 Agent 状态
from langgraph.graph import StateGraph
from typing import TypedDict, Annotated
import operator

class MultiAgentState(TypedDict):
    messages: Annotated[list, operator.add]  # 消息历史（append-only）
    current_agent: str                        # 当前活跃 Agent
    task_status: dict                         # 各子任务状态
    final_result: str                         # 最终结果

# 构建状态机
workflow = StateGraph(MultiAgentState)
workflow.add_node("researcher", researcher_agent)
workflow.add_node("writer", writer_agent)
workflow.add_node("reviewer", reviewer_agent)

# 定义路由逻辑
def route(state: MultiAgentState):
    if state["task_status"]["research"] == "done":
        return "writer"
    elif state["task_status"]["writing"] == "done":
        return "reviewer"
    return END

workflow.add_conditional_edges("researcher", route)
```

### 6.3 冲突解决策略

当多个 Agent 给出矛盾结果时：

| 策略 | 说明 |
|------|------|
| 多数投票 | 多个 Agent 投票，取多数 |
| 加权平均 | 根据 Agent 专业度加权 |
| 仲裁者决定 | 指定更高级的 LLM 做最终判断 |
| 置信度排序 | 选择置信度最高的结果 |
| 人工确认 | 高风险决策需人工审批 |

---

## 7. 实战示例

### 构建研究报告生成系统

```python
import autogen

llm_config = {"config_list": [{"model": "gpt-4o", "api_key": "sk-..."}]}

# 研究员 Agent
researcher = autogen.AssistantAgent(
    name="Researcher",
    system_message="""你是专业研究员。负责：
    1. 分析用户的研究主题
    2. 提出需要调查的关键问题
    3. 整合信息形成研究发现
    完成后输出 'RESEARCH_DONE'""",
    llm_config=llm_config,
)

# 写作者 Agent
writer = autogen.AssistantAgent(
    name="Writer",
    system_message="""你是专业技术作家。负责：
    1. 将研究发现整理为结构化报告
    2. 使用清晰易懂的语言
    3. 包含摘要、正文、结论
    完成后输出 'WRITING_DONE'""",
    llm_config=llm_config,
)

# 审查者 Agent
reviewer = autogen.AssistantAgent(
    name="Reviewer",
    system_message="""你是质量审查专家。负责：
    1. 检查报告的准确性和完整性
    2. 提出改进建议
    3. 满意后输出 'TERMINATE'""",
    llm_config=llm_config,
)

# 用户代理
user_proxy = autogen.UserProxyAgent(
    name="User",
    human_input_mode="NEVER",
    is_termination_msg=lambda x: "TERMINATE" in x.get("content", ""),
)

# 创建 GroupChat
group_chat = autogen.GroupChat(
    agents=[user_proxy, researcher, writer, reviewer],
    messages=[],
    max_round=15,
    speaker_selection_method="auto",
)

manager = autogen.GroupChatManager(groupchat=group_chat, llm_config=llm_config)

# 启动
user_proxy.initiate_chat(
    manager,
    message="请研究并撰写一份关于'大语言模型在医疗诊断中的应用'的技术报告",
)
```

---

## 8. 最佳实践与反模式

### 最佳实践

1. **明确终止条件**：每个 Agent 必须有清晰的"任务完成"标志，否则会无限循环
2. **角色单一职责**：每个 Agent 只做一件事，避免"万能 Agent"
3. **人工审批节点**：高风险操作（删除数据、发布代码）前插入人工确认
4. **日志与可观测性**：记录每条 Agent 消息，便于调试和审计
5. **成本控制**：设置 `max_turns` 和 Token 预算，防止失控的对话消耗大量费用

### 常见反模式

| 反模式 | 问题 | 解决方案 |
|--------|------|---------|
| Agent 过多 | 通信开销大，调试困难 | 先用单 Agent，确认需要才拆分 |
| 缺乏终止条件 | 无限循环，高费用 | 强制设置 `max_turns` |
| 共享可变状态 | 竞态条件，结果不一致 | 使用不可变消息 + 事件溯源 |
| 过度信任 Agent | Agent 可能编造数据 | 关键结果需要验证（代码执行/API 查询） |
| 忽略错误处理 | 一个 Agent 失败导致全系统崩溃 | 实现错误恢复和重试逻辑 |

---

## 导航

- ← [08-LLM微调技术](./08-LLM微调技术.md)
- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md)
- → [10-AI-CLI与代码Agent](./10-AI-CLI与代码Agent.md)
