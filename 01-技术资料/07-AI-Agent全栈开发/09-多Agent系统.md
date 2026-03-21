# 09-多Agent系统 — 技术资料

> 多 Agent 系统通过让多个具有专属角色的 AI Agent 协同分工，突破单 Agent 上下文与能力瓶颈，实现复杂任务的自动化流水线。

## 相关链接

- 对应面试题：[09-多Agent系统面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md)

## 目录

1. [概述](#1-概述)
2. [核心设计模式](#2-核心设计模式)
3. [AutoGen 框架深度解析](#3-autogen-框架深度解析)
4. [Dify LLMOps 平台](#4-dify-llmops-平台)
5. [通信协议与状态管理](#5-通信协议与状态管理)
6. [实战：构建多 Agent 代码审查系统](#6-实战构建多-agent-代码审查系统)
7. [最佳实践](#7-最佳实践)
8. [常见问题](#8-常见问题)
9. [Agent 通信协议与消息标准化](#9-agent-通信协议与消息标准化)
10. [生产级多 Agent 可靠性](#10-生产级多-agent-可靠性)
11. [成本控制与优化](#11-成本控制与优化)
12. [多 Agent 编排模式对比](#12-多-agent-编排模式对比)
13. [常见陷阱与最佳实践](#13-常见陷阱与最佳实践)

---

## 1. 概述

### 1.1 什么是多 Agent 系统

**类比**：把多 Agent 系统想象成一家软件公司——产品经理（PM Agent）梳理需求，架构师（Architect Agent）设计方案，工程师（Coder Agent）编写代码，测试员（QA Agent）验证结果，项目经理（Orchestrator Agent）统筹全局。每个角色专注自己的领域，通过"工位间的便签纸"（消息队列）相互传递任务，最终协作完成整个项目。

**正式定义**：多 Agent 系统（Multi-Agent System，MAS）是由两个或多个 Agent 组成的网络，每个 Agent 感知自身环境、独立做出决策，通过通信协议相互协作，共同完成单个 Agent 无法高效完成的复杂任务。

**系统总览（ASCII 图）**：

```
┌─────────────────────────────────────────────────────────────────┐
│                     多 Agent 系统全景                             │
│                                                                   │
│  ┌──────────────┐    消息/事件     ┌──────────────────────────┐  │
│  │  Orchestrator │ ─────────────► │      Agent Pool           │  │
│  │  (编排者)     │ ◄───────────── │  ┌────────┐ ┌──────────┐ │  │
│  │               │   结果/状态     │  │ Agent A│ │ Agent B  │ │  │
│  └───────┬───────┘                │  │(研究员)│ │(代码工程)│ │  │
│          │                        │  └────────┘ └──────────┘ │  │
│          │ 协调                   │  ┌────────┐ ┌──────────┐ │  │
│          ▼                        │  │ Agent C│ │ Agent D  │ │  │
│  ┌──────────────┐                 │  │(评审员)│ │(文档写作)│ │  │
│  │  Shared State │                │  └────────┘ └──────────┘ │  │
│  │  (共享状态)  │                 └──────────────────────────┘  │
│  │  - 任务队列  │                                                │
│  │  - 中间结果  │    ┌──────────────────────────────────────┐   │
│  │  - 历史对话  │    │           工具层 (Tools)              │   │
│  └──────────────┘    │  搜索 | 代码执行 | 数据库 | API 调用  │   │
│                       └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 单 Agent vs 多 Agent：何时选择

| 维度 | 单 Agent | 多 Agent |
|------|----------|----------|
| **任务复杂度** | 简单、线性、依赖较少 | 复杂、并行、高度依赖 |
| **上下文窗口** | 单个任务可在一个窗口内完成 | 超长任务需多个窗口接力 |
| **专业化需求** | 通用能力足够 | 需要不同领域专家协作 |
| **并行处理** | 不需要并发 | 需要多任务并行加速 |
| **错误隔离** | 失败影响全局 | 单 Agent 失败可被替换或重试 |
| **维护成本** | 低 | 高（需管理 Agent 间协议） |
| **延迟** | 低（单路径） | 可能更高（通信开销） |
| **典型场景** | 问答、翻译、摘要 | 软件开发、研究报告、流程自动化 |

**选择建议**：
- 任务可被拆解为独立子任务 → 多 Agent
- 需要专业知识组合（法律 + 技术 + 财务）→ 多 Agent
- 需要互相审校（peer review）→ 多 Agent
- 单一线性任务，上下文不超限 → 单 Agent

---

## 2. 核心设计模式

### 2.1 反思（Reflection）模式

**原理**：Agent 生成初步输出后，由自身或另一个 "评审 Agent" 进行批评与改进，形成迭代优化循环。

```
┌─────────────────────────────────────────────┐
│              Reflection 模式                 │
│                                              │
│   ┌──────────┐   初稿    ┌──────────────┐   │
│   │Generator │ ───────► │   Critic      │   │
│   │(生成者)  │ ◄─────── │  (批评者)    │   │
│   └──────────┘  改进建议 └──────────────┘   │
│        │                                     │
│        │  迭代 N 次后                        │
│        ▼                                     │
│   ┌──────────┐                              │
│   │  Final   │                              │
│   │  Output  │                              │
│   └──────────┘                              │
└─────────────────────────────────────────────┘
```

**代码示意**：
```python
# 伪代码示意 Reflection 模式
for i in range(max_iterations):
    draft = generator_agent.generate(task)
    critique = critic_agent.evaluate(draft)
    if critique.is_satisfactory:
        break
    task = f"根据以下反馈改进：{critique.feedback}\n原文：{draft}"
```

### 2.2 工具使用（Tool Use）模式

Agent 调用外部工具（搜索引擎、代码解释器、API）来扩展能力边界。工具调用是多 Agent 系统中每个 Agent 的基础能力。

```
Agent
  │
  ├── 决策：需要外部信息
  │
  ├── 调用工具：web_search("latest AI papers")
  │
  ├── 获取结果：[{"title": ..., "url": ...}, ...]
  │
  └── 整合到上下文，继续推理
```

常见工具类型：

| 工具类别 | 代表实现 | 典型用途 |
|---------|---------|---------|
| **搜索** | Tavily、SerpAPI、Bing | 获取实时信息 |
| **代码执行** | Python REPL、E2B Sandbox | 数据分析、验证逻辑 |
| **数据库** | SQL 查询、向量检索 | 结构化数据获取 |
| **文件系统** | 读写文件、解析 PDF | 长文档处理 |
| **外部 API** | GitHub、Slack、Jira | 系统集成 |
| **浏览器** | Playwright、Browser Use | 网页交互、表单填写 |

### 2.3 规划（Planning）模式

**两种典型规划策略**：

| 策略 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **ReAct**（逐步推理） | Reason → Act → Observe 循环 | 灵活适应动态环境 | 长任务可能迷失方向 |
| **Plan-and-Execute** | 先生成完整计划，再逐步执行 | 全局视角，结构清晰 | 计划一旦错误难以中途修正 |
| **ToT（Tree of Thoughts）** | 维护多条推理路径，选最优 | 探索性强，质量高 | 计算成本高 |
| **LLM Compiler** | 并行规划 DAG，批量执行 | 显著降低延迟 | 实现复杂 |

### 2.4 多 Agent 协作模式

**三大拓扑架构**：

```
1. Hub-Spoke（中心辐射）       2. P2P（点对点）            3. 分层（Hierarchical）
                                                              
    ┌──────────┐                  A ──── B                  ┌────────────────────┐
    │Orchestrat│                  │ ╲  ╱ │                  │   Top Orchestrator │
    └──┬───┬───┘                  │  ╳  │                  └───┬────────────┬───┘
       │   │                      │ ╱  ╲ │                      │            │
    ┌──┘ ┌─┘                   C ──── D                  ┌────┴──┐     ┌───┴───┐
    │    │                                                │Sub-   │     │Sub-   │
  Agent Agent                 每个 Agent 可直接              │Orch 1 │     │Orch 2 │
   A     B                    与其他 Agent 通信            └──┬────┘     └──┬────┘
                                                              │              │
                              优点：去中心，弹性强           A B C         D E F
                              缺点：协调难度高               Agents        Agents
```

**模式选择指南**：
- **Hub-Spoke**：任务有明确主控方，适合流水线场景（LangGraph、AutoGen GroupChat with manager）
- **P2P**：Agent 高度自治、任务动态分配，适合去中心化探索场景
- **分层**：大规模复杂系统，子任务可独立并行，适合企业级工作流

---

## 3. AutoGen 框架深度解析

AutoGen（微软开源）是目前最成熟的多 Agent 对话框架之一，核心抽象是 `ConversableAgent`——任何能收发消息的实体都是 Agent。

### 3.1 ConversableAgent 架构

```
┌─────────────────────────────────────────────────────────┐
│                   ConversableAgent                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  LLM Config  │  │  Human Input │  │  Code Exec    │  │
│  │  (模型配置)  │  │  (人工介入)  │  │  (代码执行)   │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            消息处理管道                          │    │
│  │  receive() → process() → generate_reply()        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │      终止条件 (is_termination_msg)               │    │
│  │      最大轮次 (max_consecutive_auto_reply)       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Agent 类型层次**：

| 类型 | 说明 | 典型用法 |
|------|------|---------|
| `ConversableAgent` | 基类，所有 Agent 的父类 | 自定义 Agent |
| `AssistantAgent` | 预置为 AI 助手，可使用工具 | 任务执行者 |
| `UserProxyAgent` | 代理人类用户，可执行代码 | 人机交互节点 |
| `GroupChatManager` | 管理 GroupChat 中的发言顺序 | 多 Agent 协调者 |

### 3.2 GroupChat 多轮对话

GroupChat 允许多个 Agent 在同一个"聊天室"中协作，类似微信群。核心参数 `speaker_selection_method` 决定下一个发言者：

| 选择策略 | 描述 | 适用场景 |
|---------|------|---------|
| `"auto"` | 由 LLM 根据对话内容智能选择下一个发言者 | 通用协作 |
| `"round_robin"` | 轮询，按固定顺序发言 | 流水线处理 |
| `"random"` | 随机选择 | 探索性讨论 |
| `"manual"` | 人工指定下一个发言者 | 调试/演示 |
| 自定义函数 | `Callable[[GroupChat], Agent]`，完全自定义逻辑 | 复杂业务规则 |

**防止无限循环的关键参数**：

```python
GroupChat(
    agents=[...],
    max_round=20,              # 最大对话轮次
    allow_repeat_speaker=False # 禁止同一 Agent 连续发言
)
```

### 3.3 Nested Chat（嵌套对话）

嵌套对话允许在一次对话的触发下，在幕后启动另一个完整的子对话流程，再将结果返回主流程。

```
主对话流程
│
├── UserProxy ──► AssistantAgent（"请生成一份报告"）
│                     │
│                     │ 触发嵌套对话
│                     ▼
│               ┌─────────────────────────────┐
│               │ 子对话：研究团队              │
│               │  Researcher ──► WebSearch    │
│               │  Researcher ──► Summarizer   │
│               └─────────┬───────────────────┘
│                         │ 返回研究摘要
│                         ▼
│               AssistantAgent（整合为最终报告）
│
└── 最终报告返回 UserProxy
```

### 3.4 代码示例：构建一个研究助手团队

```python
import autogen
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

# ── 配置 LLM ──────────────────────────────────────────────────────────
llm_config = {
    "model": "gpt-4o",
    "api_key": "YOUR_API_KEY",
    "temperature": 0.1,
}

# ── 定义工具函数 ──────────────────────────────────────────────────────
def web_search(query: str) -> str:
    """搜索网页，返回摘要（此处为伪实现）"""
    # 实际可接入 Tavily API
    return f"[搜索结果] 关于 '{query}' 的最新资讯：..."

def save_to_file(filename: str, content: str) -> str:
    """将内容写入文件"""
    with open(filename, "w", encoding="utf-8") as f:
        f.write(content)
    return f"文件 {filename} 写入成功"

# ── 创建 Agent ────────────────────────────────────────────────────────

# 研究员：负责收集信息
researcher = AssistantAgent(
    name="Researcher",
    system_message="""你是专业研究员，擅长信息检索与整合。
    职责：使用 web_search 工具收集最新资料，输出结构化研究摘要。
    规则：每次搜索后必须总结关键发现，不要直接转述搜索结果。""",
    llm_config={
        **llm_config,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "web_search",
                    "description": "搜索网页获取最新信息",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "搜索关键词"}
                        },
                        "required": ["query"]
                    }
                }
            }
        ]
    }
)

# 写作者：负责撰写报告
writer = AssistantAgent(
    name="Writer",
    system_message="""你是专业技术写作者。
    职责：根据研究员提供的资料，撰写清晰、结构化的技术报告。
    格式要求：使用 Markdown，包含摘要、正文、结论三部分。
    规则：内容必须基于研究员提供的事实，不要凭空捏造数据。""",
    llm_config=llm_config,
)

# 评审者：负责质量把控
reviewer = AssistantAgent(
    name="Reviewer",
    system_message="""你是严格的技术评审专家。
    职责：检查报告的准确性、完整性和可读性，给出具体改进建议。
    评分标准：准确性(40%)、结构(30%)、可读性(30%)。
    规则：如果报告质量达标（总分 ≥ 80），回复 "APPROVED"；否则给出改进意见。""",
    llm_config=llm_config,
)

# 用户代理：代表人类执行代码，也是对话的发起者
user_proxy = UserProxyAgent(
    name="UserProxy",
    human_input_mode="NEVER",   # 全自动，不需要人工介入
    max_consecutive_auto_reply=0,  # 只发起一次
    is_termination_msg=lambda msg: "APPROVED" in msg.get("content", ""),
    code_execution_config={
        "work_dir": "./workspace",
        "use_docker": False,  # 生产环境建议使用 Docker
    },
)

# ── 注册工具执行 ─────────────────────────────────────────────────────
# AutoGen 0.2+ 风格：由 UserProxyAgent 实际执行工具
@user_proxy.register_for_execution()
@researcher.register_for_llm(description="搜索网页获取最新信息")
def web_search_tool(query: str) -> str:
    return web_search(query)

# ── 创建 GroupChat ────────────────────────────────────────────────────
group_chat = GroupChat(
    agents=[user_proxy, researcher, writer, reviewer],
    messages=[],
    max_round=15,
    speaker_selection_method="auto",  # LLM 智能选择下一位发言者
    allow_repeat_speaker=False,
)

manager = GroupChatManager(
    groupchat=group_chat,
    llm_config=llm_config,
)

# ── 启动对话 ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    result = user_proxy.initiate_chat(
        manager,
        message="""请研究 2024 年大型语言模型（LLM）推理优化技术的最新进展，
        并撰写一份 800 字的技术报告，保存到 llm_inference_report.md。
        Researcher 负责收集资料，Writer 撰写报告，Reviewer 审查质量。""",
    )
    print(f"\n对话共进行了 {len(group_chat.messages)} 轮")
```

**关键设计决策说明**：

1. `human_input_mode="NEVER"`：全自动运行，适合生产环境；调试时可改为 `"TERMINATE"` 让人类在关键节点介入
2. `is_termination_msg`：通过检测 "APPROVED" 关键词自动终止，避免无限循环
3. `speaker_selection_method="auto"`：让 LLM 根据上下文决定谁来说话，比 round_robin 更智能

---

## 4. Dify LLMOps 平台

Dify 是一个开源的 LLMOps 平台，提供可视化的工作流（Workflow）编排，适合快速搭建多 Agent 应用。

### 4.1 工作流（Workflow）设计

Dify Workflow 的核心是 **节点（Node）** 的有向无环图（DAG）：

```
┌──────────────────────────────────────────────────────────────────┐
│                    Dify Workflow 结构                             │
│                                                                   │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  Start  │───►│  LLM节点  │───►│  条件分支 │───►│  工具节点 │  │
│  │ (触发器) │    │ (提取意图) │    │(if/else) │    │(API调用) │  │
│  └─────────┘    └──────────┘    └──┬───┬───┘    └──────────┘   │
│                                    │   │                          │
│                              ┌─────┘   └──────┐                  │
│                              │                 │                  │
│                         ┌────▼───┐       ┌────▼───┐             │
│                         │知识库  │       │Agent   │             │
│                         │检索节点│       │节点    │             │
│                         └────┬───┘       └────┬───┘             │
│                              │                 │                  │
│                              └────────┬────────┘                  │
│                                       ▼                           │
│                                  ┌─────────┐                     │
│                                  │  End节点 │                     │
│                                  └─────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

**Workflow vs Chatflow 区别**：

| 特性 | Workflow | Chatflow |
|------|---------|---------|
| **触发方式** | 一次性任务触发 | 持续对话 |
| **状态保持** | 无状态（每次独立） | 有状态（保留对话历史） |
| **适用场景** | 批处理、自动化任务 | 客服、问答助手 |
| **调试方式** | 单步调试每个节点 | 对话式测试 |

### 4.2 Agent 节点与工具集成

Dify 的 Agent 节点支持 **ReAct** 和 **Function Calling** 两种推理策略：

```python
# Dify 工具定义（OpenAPI 格式）
{
    "name": "get_stock_price",
    "description": "获取指定股票的实时价格",
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "股票代码，如 AAPL、TSLA"
            }
        },
        "required": ["symbol"]
    }
}
```

**工具集成方式**：

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| **内置工具** | Dify 预置：搜索、天气、维基百科 | 快速原型 |
| **自定义工具（OpenAPI）** | 上传 Swagger/OpenAPI 规范 | 接入自有 API |
| **工作流工具** | 将一个 Workflow 作为工具调用 | 复杂子任务封装 |
| **插件市场** | 社区贡献的第三方工具 | 扩展生态 |

### 4.3 知识库与 RAG 集成

Dify 的知识库节点（Knowledge Retrieval）将 RAG 流程可视化：

```
文档上传
    │
    ▼
┌───────────────────────────────────────────────────────┐
│                  Dify 知识库处理流程                   │
│                                                        │
│  文档解析 → 分块(Chunking) → Embedding → 向量存储     │
│                                                        │
│  检索时：                                              │
│  用户查询 → Embedding → 向量相似度搜索 → TopK 召回    │
│           → 关键词搜索（可选混合检索）                 │
│           → Rerank 重排序 → 注入 LLM Context          │
└───────────────────────────────────────────────────────┘
```

**检索策略对比**：

| 策略 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **语义检索** | Embedding 余弦相似度 | 语义理解强 | 精确匹配弱 |
| **关键词检索** | BM25/全文索引 | 精确匹配好 | 语义泛化弱 |
| **混合检索** | 语义 + 关键词融合 | 兼顾两者 | 需调权重 |
| **带 Rerank** | 二阶段重排（如 Cohere） | 召回精度最高 | 延迟增加 |

---

## 5. 通信协议与状态管理

### 5.1 Agent 间消息格式

良好的消息格式是多 Agent 系统可靠运行的基础。推荐的结构化消息格式：

```python
from dataclasses import dataclass, field
from typing import Any, Optional
from datetime import datetime
import uuid

@dataclass
class AgentMessage:
    """Agent 间通信的标准消息格式"""
    
    # 必填字段
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    sender: str = ""           # 发送方 Agent 名称
    receiver: str = ""         # 接收方 Agent 名称（"*" 表示广播）
    content: str = ""          # 消息正文
    
    # 元数据
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    message_type: str = "chat"   # chat | task | result | error | status
    priority: int = 5            # 1（最高）~ 10（最低）
    
    # 任务追踪
    task_id: Optional[str] = None       # 关联的任务 ID
    parent_message_id: Optional[str] = None  # 回复的消息 ID
    
    # 结构化数据
    metadata: dict = field(default_factory=dict)  # 附加结构化信息
    
    def to_dict(self) -> dict:
        return {
            "message_id": self.message_id,
            "sender": self.sender,
            "receiver": self.receiver,
            "content": self.content,
            "timestamp": self.timestamp,
            "message_type": self.message_type,
            "task_id": self.task_id,
            "metadata": self.metadata,
        }
```

### 5.2 共享状态 vs 消息传递

```
┌──────────────────────────────────────────────────────────────────┐
│             两种协调机制对比                                       │
│                                                                   │
│  共享状态（Shared State）          消息传递（Message Passing）    │
│  ┌───────┐  ┌───────┐             ┌───────┐   消息   ┌───────┐  │
│  │Agent A│  │Agent B│             │Agent A│ ───────► │Agent B│  │
│  └───┬───┘  └───┬───┘             └───────┘           └───────┘  │
│      │   读写   │                                                  │
│      ▼          ▼                 优点：松耦合，易扩展             │
│  ┌─────────────────┐              缺点：消息可能丢失，顺序复杂     │
│  │   Shared State  │                                              │
│  │  (Redis/DB/内存) │             典型实现：消息队列（Kafka/RabbitMQ） │
│  └─────────────────┘              Actor Model（Akka）            │
│                                                                   │
│  优点：数据一致，读写方便                                          │
│  缺点：竞争条件，需要锁机制                                        │
└──────────────────────────────────────────────────────────────────┘
```

**实践中的混合策略**：

```python
# 使用 Redis 作为共享状态 + 消息队列
import redis
import json
from typing import Optional

class AgentStateManager:
    """Agent 状态管理器：共享状态 + 消息队列混合方案"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.from_url(redis_url, decode_responses=True)
    
    # ── 共享状态操作 ──────────────────────────────────────────────────
    def set_task_status(self, task_id: str, status: str, result: Optional[dict] = None):
        """更新任务状态（写入共享状态）"""
        state = {
            "status": status,     # pending | running | completed | failed
            "result": result or {},
            "updated_at": datetime.utcnow().isoformat()
        }
        self.redis.setex(
            f"task:{task_id}:state",
            3600,  # 1小时 TTL，防止状态泄漏
            json.dumps(state)
        )
    
    def get_task_status(self, task_id: str) -> Optional[dict]:
        """读取任务状态"""
        raw = self.redis.get(f"task:{task_id}:state")
        return json.loads(raw) if raw else None
    
    # ── 消息队列操作 ──────────────────────────────────────────────────
    def send_message(self, receiver: str, message: AgentMessage):
        """向指定 Agent 的队列发送消息"""
        self.redis.lpush(
            f"agent:{receiver}:inbox",
            json.dumps(message.to_dict())
        )
    
    def receive_message(self, agent_name: str, timeout: int = 5) -> Optional[dict]:
        """从自己的收件箱取出一条消息（阻塞式）"""
        result = self.redis.brpop(f"agent:{agent_name}:inbox", timeout=timeout)
        if result:
            _, raw = result
            return json.loads(raw)
        return None
```

### 5.3 冲突解决与仲裁

当多个 Agent 对同一问题给出不同答案时，需要仲裁机制：

| 策略 | 原理 | 适用场景 |
|------|------|---------|
| **投票（Voting）** | 多数Agent意见获胜 | 意见判断类任务 |
| **权重置信度** | 每个Agent有信任分数，加权平均 | Agent能力差异较大 |
| **Judge Agent** | 专门的仲裁Agent做最终裁决 | 需要高质量输出 |
| **人工介入** | 低置信度时上升到人工 | 高风险决策 |
| **并行验证** | 多Agent独立执行，结果一致才采用 | 代码生成、数值计算 |

```python
# Judge Agent 仲裁模式示例
class JudgeAgent:
    """仲裁 Agent：汇总多个 Agent 的意见，给出最终决策"""
    
    def __init__(self, llm_client):
        self.llm = llm_client
    
    def arbitrate(self, task: str, opinions: list[dict]) -> dict:
        """
        opinions: [{"agent": "A", "answer": "...", "confidence": 0.8}, ...]
        """
        opinions_text = "\n".join([
            f"Agent {o['agent']}（置信度 {o['confidence']:.0%}）：{o['answer']}"
            for o in opinions
        ])
        
        prompt = f"""你是公正的仲裁专家。
        
任务：{task}

各 Agent 的意见：
{opinions_text}

请综合以上意见，给出最终答案。说明你的选择理由，并标注最终置信度（0-1）。
输出格式：{{"final_answer": "...", "reasoning": "...", "confidence": 0.0}}"""
        
        response = self.llm.complete(prompt)
        return json.loads(response)
```

---

## 6. 实战：构建多 Agent 代码审查系统

### 6.1 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                  多 Agent 代码审查系统架构                           │
│                                                                      │
│   开发者提交 PR                                                      │
│        │                                                            │
│        ▼                                                            │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │                  Orchestrator Agent                        │     │
│   │  职责：拆分任务 → 分发给专家 → 汇总报告 → 决定是否通过   │     │
│   └─────┬──────────────────────────────┬──────────────────┘     │
│         │                              │                           │
│    ┌────┴────────────────────────┐     │                           │
│    │                             │     │                           │
│    ▼                             ▼     ▼                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │Security Agent│  │Performance   │  │Style Agent   │            │
│  │安全审查       │  │Agent         │  │代码风格      │            │
│  │- SQL注入     │  │性能审查       │  │- 命名规范    │            │
│  │- XSS漏洞     │  │- N+1 查询    │  │- 注释完整性  │            │
│  │- 权限控制    │  │- 内存泄漏    │  │- 函数长度    │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                  │                      │
│         └─────────────────┴──────────────────┘                     │
│                           │                                         │
│                           ▼                                         │
│                  ┌────────────────┐                                 │
│                  │  Report Agent  │                                 │
│                  │  汇总生成报告   │                                 │
│                  └────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 完整代码示例

```python
import asyncio
import json
from typing import Optional
from dataclasses import dataclass

# ── 数据结构 ──────────────────────────────────────────────────────────

@dataclass
class ReviewIssue:
    severity: str    # critical | major | minor | suggestion
    category: str    # security | performance | style | logic
    line: Optional[int]
    message: str
    suggestion: str

@dataclass  
class ReviewResult:
    agent_name: str
    issues: list[ReviewIssue]
    score: int       # 0-100
    summary: str
    approved: bool

# ── 基础审查 Agent ─────────────────────────────────────────────────────

class CodeReviewAgent:
    """单个代码审查 Agent 的基类"""
    
    def __init__(self, name: str, specialty: str, llm_client):
        self.name = name
        self.specialty = specialty
        self.llm = llm_client
        self.retry_count = 3
    
    async def review(self, code: str, language: str) -> ReviewResult:
        """执行代码审查，带重试机制"""
        for attempt in range(self.retry_count):
            try:
                return await self._do_review(code, language)
            except json.JSONDecodeError as e:
                if attempt == self.retry_count - 1:
                    # 最后一次重试失败，返回降级结果
                    return ReviewResult(
                        agent_name=self.name,
                        issues=[],
                        score=50,
                        summary=f"审查失败（JSON解析错误）：{e}",
                        approved=False
                    )
                await asyncio.sleep(1 * (attempt + 1))  # 指数退避
    
    async def _do_review(self, code: str, language: str) -> ReviewResult:
        prompt = f"""你是专业的{self.specialty}代码审查专家。
        
请审查以下 {language} 代码，专注于{self.specialty}相关问题。

```{language}
{code}
```

以 JSON 格式输出审查结果（不要包含代码块标记）：
{{
    "issues": [
        {{
            "severity": "critical|major|minor|suggestion",
            "category": "{self.specialty}",
            "line": null,
            "message": "问题描述",
            "suggestion": "改进建议"
        }}
    ],
    "score": 85,
    "summary": "总体评价（2-3句话）",
    "approved": true
}}"""
        
        response = await self.llm.acomplete(prompt)
        data = json.loads(response.text)
        
        issues = [ReviewIssue(**issue) for issue in data["issues"]]
        return ReviewResult(
            agent_name=self.name,
            issues=issues,
            score=data["score"],
            summary=data["summary"],
            approved=data["approved"]
        )

# ── Orchestrator ───────────────────────────────────────────────────────

class CodeReviewOrchestrator:
    """编排多个审查 Agent，汇总结果"""
    
    def __init__(self, llm_client):
        self.agents = [
            CodeReviewAgent("SecurityAgent", "安全漏洞（SQL注入/XSS/权限控制）", llm_client),
            CodeReviewAgent("PerformanceAgent", "性能问题（复杂度/内存/数据库查询）", llm_client),
            CodeReviewAgent("StyleAgent", "代码风格（命名/注释/可读性）", llm_client),
        ]
        self.llm = llm_client
        self.pass_threshold = 75  # 综合分低于此值则拒绝合并
    
    async def review_pr(self, pr_diff: str, language: str) -> dict:
        """
        并行执行所有 Agent 的审查，汇总结果
        并行是关键：3 个 Agent 同时工作，而非串行等待
        """
        print(f"🔍 启动 {len(self.agents)} 个审查 Agent（并行执行）...")
        
        # 并行执行所有审查任务
        tasks = [agent.review(pr_diff, language) for agent in self.agents]
        results: list[ReviewResult] = await asyncio.gather(*tasks)
        
        # 汇总统计
        all_issues = []
        for result in results:
            all_issues.extend(result.issues)
        
        # 计算加权综合分（安全权重最高）
        weights = {"SecurityAgent": 0.4, "PerformanceAgent": 0.35, "StyleAgent": 0.25}
        weighted_score = sum(
            result.score * weights.get(result.agent_name, 0.33)
            for result in results
        )
        
        # 有任何 critical 问题则强制拒绝
        has_critical = any(
            issue.severity == "critical" 
            for issue in all_issues
        )
        
        final_approved = (
            weighted_score >= self.pass_threshold 
            and not has_critical
        )
        
        return {
            "approved": final_approved,
            "weighted_score": round(weighted_score, 1),
            "has_critical_issues": has_critical,
            "total_issues": len(all_issues),
            "issues_by_severity": self._group_by_severity(all_issues),
            "agent_reports": [
                {
                    "agent": r.agent_name,
                    "score": r.score,
                    "approved": r.approved,
                    "summary": r.summary,
                    "issues": len(r.issues)
                }
                for r in results
            ],
            "all_issues": [
                {
                    "severity": i.severity,
                    "category": i.category,
                    "line": i.line,
                    "message": i.message,
                    "suggestion": i.suggestion
                }
                for i in sorted(all_issues, key=lambda x: 
                    {"critical": 0, "major": 1, "minor": 2, "suggestion": 3}[x.severity])
            ]
        }
    
    def _group_by_severity(self, issues: list[ReviewIssue]) -> dict:
        result = {"critical": 0, "major": 0, "minor": 0, "suggestion": 0}
        for issue in issues:
            result[issue.severity] = result.get(issue.severity, 0) + 1
        return result


# ── 使用示例 ───────────────────────────────────────────────────────────

async def main():
    # 模拟 llm_client（实际使用 OpenAI/Anthropic SDK）
    class MockLLM:
        async def acomplete(self, prompt):
            class Response:
                text = json.dumps({
                    "issues": [
                        {
                            "severity": "major",
                            "category": "security",
                            "line": 15,
                            "message": "SQL 查询未使用参数化查询，存在注入风险",
                            "suggestion": "使用 cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))"
                        }
                    ],
                    "score": 72,
                    "summary": "代码功能基本正确，但存在安全隐患需修复。",
                    "approved": False
                })
            return Response()
    
    sample_code = """
def get_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    # 危险：直接字符串拼接
    cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
    return cursor.fetchone()
"""
    
    orchestrator = CodeReviewOrchestrator(MockLLM())
    report = await orchestrator.review_pr(sample_code, "python")
    
    print(f"\n{'='*50}")
    print(f"审查结论：{'✅ 通过' if report['approved'] else '❌ 拒绝'}")
    print(f"综合评分：{report['weighted_score']}/100")
    print(f"发现问题：{report['total_issues']} 个")
    print(f"严重程度分布：{report['issues_by_severity']}")

if __name__ == "__main__":
    asyncio.run(main())
```

### 6.3 错误处理与重试

多 Agent 系统的健壮性取决于每个环节的容错设计：

```python
import asyncio
from functools import wraps

def with_retry(max_attempts: int = 3, backoff_base: float = 1.5):
    """
    通用重试装饰器，支持指数退避
    适用于任何 Agent 的工具调用或 LLM 请求
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except (TimeoutError, ConnectionError) as e:
                    # 网络/超时错误：重试
                    last_exception = e
                    wait = backoff_base ** attempt
                    print(f"⚠️ {func.__name__} 第{attempt+1}次失败，{wait:.1f}s 后重试: {e}")
                    await asyncio.sleep(wait)
                except (ValueError, json.JSONDecodeError) as e:
                    # 数据格式错误：不重试（重试也无效）
                    raise e
            raise last_exception
        return wrapper
    return decorator

# 使用示例
@with_retry(max_attempts=3, backoff_base=2.0)
async def call_external_api(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            return await resp.json()
```

**错误分类与处理策略**：

| 错误类型 | 原因 | 处理策略 |
|---------|------|---------|
| LLM 响应格式错误 | 输出不是合法 JSON | 重试 + 修正 Prompt |
| LLM API 限流（429） | Token 超配额 | 指数退避重试 |
| 工具调用超时 | 外部服务慢 | 超时设置 + 降级返回 |
| Agent 死循环 | 终止条件未触发 | max_round 强制截断 |
| 消息序列化失败 | 特殊字符/大对象 | 压缩/截断 + 日志告警 |
| 并发写入冲突 | 多 Agent 同时写共享状态 | 乐观锁/Redis 事务 |

---

## 7. 最佳实践

### 7.1 Agent 设计原则

1. **单一职责**：每个 Agent 只做一件事，system_message 聚焦专一领域
2. **明确终止条件**：每个对话流程都必须有清晰的退出机制（关键词、轮次上限、置信度阈值）
3. **防御性输出**：要求 Agent 以结构化格式（JSON Schema）输出，避免自由文本解析失败
4. **最小权限原则**：每个 Agent 只获得完成自己任务所需的工具，不授予多余权限

### 7.2 性能优化

| 优化手段 | 效果 | 实现方式 |
|---------|------|---------|
| **并行执行独立任务** | 降低 50-80% 延迟 | `asyncio.gather()` |
| **结果缓存** | 减少重复 LLM 调用 | Redis + 内容哈希做 key |
| **流式输出** | 改善用户感知延迟 | SSE/WebSocket |
| **轻量 Agent** | 降低 Token 消耗 | 简短 system_message + 小模型 |
| **批量工具调用** | 减少 API 往返 | Function Calling 批量模式 |

### 7.3 可观测性

```python
# 为 Agent 消息添加追踪 ID（OpenTelemetry 风格）
from opentelemetry import trace

tracer = trace.get_tracer("multi_agent_system")

async def traced_agent_call(agent_name: str, task: str):
    with tracer.start_as_current_span(f"agent.{agent_name}") as span:
        span.set_attribute("agent.name", agent_name)
        span.set_attribute("task.length", len(task))
        
        result = await agent.execute(task)
        
        span.set_attribute("result.tokens", result.token_count)
        span.set_attribute("result.success", result.success)
        return result
```

---

## 8. 常见问题

**Q1：多 Agent 系统比单 Agent 更贵吗？**

是的，通常更贵。多个 Agent 各自调用 LLM，Token 消耗倍增。优化策略：子 Agent 使用小模型（GPT-4o-mini），只有 Orchestrator 使用旗舰模型；对中间结果做缓存；合并相似的 Agent 职责。

**Q2：如何调试复杂的多 Agent 对话？**

推荐工具链：LangSmith（LangChain 生态）或 AutoGen Studio（可视化对话追踪）。关键技巧：给每条消息打 trace_id；在开发阶段设置 `human_input_mode="ALWAYS"` 手动控制流程；使用 `verbose=True` 输出完整日志。

**Q3：Agent 之间会产生"回声室"效应吗？**

会。当 Agent 缺少外部信息输入时，容易互相附和，强化错误观点。解法：引入 "Devil's Advocate" Agent 专门提出反对意见；强制要求 Agent 给出信息来源；定期注入外部事实核查工具。

**Q4：如何保证多 Agent 系统的一致性？**

核心是"单一事实源"（Single Source of Truth）：任务状态存储在中央状态管理器（Redis/数据库），Agent 只读取和写入状态，不互相持有对方的引用；关键操作使用事务保证原子性。

**Q5：GroupChat 中 speaker_selection_method 选 "auto" 还是 "round_robin"？**

- 流水线任务（步骤固定）→ `round_robin` 或自定义函数
- 探索性协作（需要根据上下文灵活决策）→ `auto`
- 调试阶段 → `manual`，手动控制，方便排查问题

---

## 9. Agent 通信协议与消息标准化

> 第 5 节介绍了基础消息格式和共享状态方案。本节深入探讨**通信协议的架构级设计**——消息该用什么结构、Agent 之间该如何"说话"、消息路由怎么走、版本升级时老 Agent 怎么兼容新消息。

### 9.1 结构化消息 vs 自然语言消息

**类比**：想象两种开会方式——方式 A：每个人写自由格式的便签纸互相传递（自然语言消息）；方式 B：每个人填写统一的表单，包含"发起人、议题、结论、下一步行动"（结构化消息）。便签灵活但混乱，表单规范但不够灵活。

| 维度 | 结构化消息（JSON Schema） | 自然语言消息 |
|------|---------------------------|-------------|
| **可解析性** | 确定性解析，无歧义 | 需要 LLM 理解，可能误判 |
| **灵活性** | 字段固定，扩展需改 Schema | 任意表达，无限灵活 |
| **调试难度** | 低，字段一目了然 | 高，需阅读长文本 |
| **Token 消耗** | 低（紧凑格式） | 高（冗余表达） |
| **适用场景** | Agent 间任务指令、状态同步 | 创意协作、开放式讨论 |

**实践建议：混合策略**——Agent 间的**控制信令**用结构化消息，**内容讨论**用自然语言：

```python
from pydantic import BaseModel, Field
from typing import Literal, Any
from datetime import datetime

class ControlMessage(BaseModel):
    """Agent 间控制信令——高优先级、强类型"""
    msg_type: Literal["task_assign", "status_update", "result_submit", "error_report"]
    sender: str
    receiver: str
    payload: dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ContentMessage(BaseModel):
    """Agent 间内容讨论——允许自然语言"""
    msg_type: Literal["discussion", "review", "suggestion"]
    sender: str
    receiver: str
    content: str          # 自然语言正文
    structured_hint: dict = Field(default_factory=dict)  # 可选的结构化摘要
    timestamp: datetime = Field(default_factory=datetime.utcnow)
```

### 9.2 通信模式：请求-响应 vs 发布-订阅 vs 事件驱动

**类比**：
- **请求-响应** = 打电话：你说一句，对方回一句，一对一阻塞
- **发布-订阅** = 广播电台：电台播新闻，所有调频的收音机都能收到
- **事件驱动** = 公告栏：有人贴通知，感兴趣的人自己来看

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  三种通信模式对比                                        │
│                                                                         │
│  1. 请求-响应（Request-Response）                                       │
│     Agent A ──请求──► Agent B                                           │
│     Agent A ◄──响应── Agent B       同步阻塞，简单可靠                  │
│                                                                         │
│  2. 发布-订阅（Pub-Sub）                                                │
│     Agent A ──发布──► [Topic: "review_done"]                            │
│                         │                                               │
│                    ┌────┴────┐                                          │
│                 Agent B   Agent C    多个订阅者异步接收                  │
│                                                                         │
│  3. 事件驱动（Event-Driven）                                            │
│     [Event Bus]                                                         │
│       │  ◄── Agent A 发出 "code_committed" 事件                        │
│       ├──► Agent B (触发代码审查)                                       │
│       └──► Agent C (触发测试执行)     解耦最彻底，但调试难              │
└─────────────────────────────────────────────────────────────────────────┘
```

| 模式 | 耦合度 | 延迟 | 可扩展性 | 调试难度 | 典型场景 |
|------|-------|------|---------|---------|---------|
| 请求-响应 | 高 | 同步等待 | 低 | 低 | 简单的任务分派与结果收集 |
| 发布-订阅 | 中 | 异步低延迟 | 高 | 中 | 状态变更通知、多方监听 |
| 事件驱动 | 低 | 异步 | 最高 | 高 | 复杂编排、微服务式 Agent |

```python
import asyncio
from collections import defaultdict
from typing import Callable, Any

class AgentEventBus:
    """轻量级事件总线——Agent 间发布-订阅 + 事件驱动的统一实现"""

    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._event_log: list[dict] = []

    def subscribe(self, event_type: str, handler: Callable):
        """订阅事件（发布-订阅模式）"""
        self._subscribers[event_type].append(handler)

    async def publish(self, event_type: str, data: dict[str, Any], sender: str):
        """发布事件，所有订阅者异步执行"""
        event = {"type": event_type, "data": data, "sender": sender}
        self._event_log.append(event)

        handlers = self._subscribers.get(event_type, [])
        if handlers:
            await asyncio.gather(*[h(event) for h in handlers])

    async def request(self, receiver_handler: Callable, request_data: dict) -> Any:
        """请求-响应模式：同步等待结果"""
        return await receiver_handler(request_data)


# ── 使用示例 ──────────────────────────────────────────────────────────
bus = AgentEventBus()

async def review_agent_handler(event: dict):
    print(f"审查 Agent 收到事件: {event['type']}，开始审查代码...")

async def test_agent_handler(event: dict):
    print(f"测试 Agent 收到事件: {event['type']}，开始运行测试...")

# 订阅
bus.subscribe("code_committed", review_agent_handler)
bus.subscribe("code_committed", test_agent_handler)

# 发布——两个 Agent 同时收到通知
# await bus.publish("code_committed", {"file": "main.py"}, sender="dev_agent")
```

### 9.3 消息路由策略

不同场景需要不同的消息分发策略。**类比**：就像公司的信息传递——全员邮件（广播）、点对点微信（定向）、按部门群发（基于角色）。

| 路由策略 | 机制 | 适用场景 | Token 开销 |
|---------|------|---------|-----------|
| **广播（Broadcast）** | 所有 Agent 都收到消息 | 系统公告、全局状态变更 | 最高（N 倍） |
| **定向（Direct）** | 指定接收方 Agent | 任务分配、一对一协作 | 最低 |
| **基于角色（Role-based）** | 按 Agent 角色分组发送 | "所有审查员"、"所有前端 Agent" | 中等 |
| **基于内容（Content-based）** | 根据消息内容自动路由 | 智能分发（如按语言路由到对应翻译 Agent） | 中等 + 路由 Agent 成本 |

```python
from enum import Enum
from dataclasses import dataclass

class RoutingStrategy(Enum):
    BROADCAST = "broadcast"
    DIRECT = "direct"
    ROLE_BASED = "role_based"
    CONTENT_BASED = "content_based"

@dataclass
class AgentRegistry:
    """Agent 注册表——消息路由的基础设施"""
    _agents: dict[str, dict] = None  # name → {role, handler, capabilities}

    def __post_init__(self):
        self._agents = {}

    def register(self, name: str, role: str, capabilities: list[str], handler):
        self._agents[name] = {
            "role": role,
            "capabilities": capabilities,
            "handler": handler,
        }

    def route(self, strategy: RoutingStrategy, **kwargs) -> list:
        """根据策略返回目标 Agent 列表"""
        if strategy == RoutingStrategy.BROADCAST:
            return list(self._agents.values())
        elif strategy == RoutingStrategy.DIRECT:
            target = self._agents.get(kwargs.get("target", ""))
            return [target] if target else []
        elif strategy == RoutingStrategy.ROLE_BASED:
            role = kwargs.get("role", "")
            return [a for a in self._agents.values() if a["role"] == role]
        elif strategy == RoutingStrategy.CONTENT_BASED:
            # 根据内容中的关键词匹配 Agent 能力
            content = kwargs.get("content", "").lower()
            return [
                a for a in self._agents.values()
                if any(cap in content for cap in a["capabilities"])
            ]
        return []
```

### 9.4 消息序列化与版本兼容

**类比**：想象你在和外国人通信——语言版本会随时间演变。如果你写信用的是 2025 版协议（多了一个"优先级"字段），而对方还在用 2024 版协议（没有这个字段），信就读不懂了。消息版本兼容就是确保"新旧系统能互相理解"。

**核心原则**：

1. **向后兼容**：新版本消息必须能被老版本 Agent 处理（忽略未知字段）
2. **必填字段不可删除**：一旦发布为必填，永远保留
3. **新字段设为可选**：添加新字段时提供默认值

```python
from pydantic import BaseModel, Field
from typing import Optional, Any

class MessageV1(BaseModel):
    """v1 消息格式——初始版本"""
    version: int = 1
    sender: str
    receiver: str
    content: str

class MessageV2(MessageV1):
    """v2 消息格式——新增优先级和元数据（可选字段，向后兼容）"""
    version: int = 2
    priority: int = Field(default=5, ge=1, le=10)       # v2 新增，默认值保证 v1 兼容
    metadata: Optional[dict[str, Any]] = None             # v2 新增，可选

class MessageAdapter:
    """消息版本适配器——不同版本 Agent 间的翻译官"""

    @staticmethod
    def normalize(raw: dict) -> MessageV2:
        """将任意版本的消息统一转换为最新版本"""
        version = raw.get("version", 1)
        if version == 1:
            return MessageV2(
                sender=raw["sender"],
                receiver=raw["receiver"],
                content=raw["content"],
                priority=5,          # v1 没有优先级，使用默认值
                metadata=None,
            )
        elif version == 2:
            return MessageV2(**raw)
        else:
            raise ValueError(f"未知消息版本: {version}")

    @staticmethod
    def downgrade(msg: MessageV2, target_version: int = 1) -> dict:
        """降级消息版本以兼容老 Agent"""
        data = msg.model_dump()
        if target_version == 1:
            data.pop("priority", None)
            data.pop("metadata", None)
            data["version"] = 1
        return data
```

---

## 10. 生产级多 Agent 可靠性

> 开发阶段"能跑就行"的多 Agent 系统，到了生产环境会面临真实世界的各种故障。本节系统性地介绍如何让多 Agent 系统在生产环境中稳定运行。

### 10.1 故障隔离：隔舱设计

**类比**：远洋轮船的船底分成多个独立隔舱，即使一个隔舱进水，水也不会蔓延到其他隔舱，船不会沉。多 Agent 系统也一样——单个 Agent 的崩溃不应导致整个系统瘫痪。

```
┌─────────────────────────────────────────────────────────────────────┐
│                    隔舱设计（Bulkhead Pattern）                      │
│                                                                     │
│  ┌──── 隔舱 1 ────┐  ┌──── 隔舱 2 ────┐  ┌──── 隔舱 3 ────┐     │
│  │  研究 Agent     │  │  编码 Agent     │  │  审查 Agent     │     │
│  │  ┌───────────┐ │  │  ┌───────────┐ │  │  ┌───────────┐ │     │
│  │  │独立进程   │ │  │  │独立进程   │ │  │  │独立进程   │ │     │
│  │  │独立内存   │ │  │  │独立内存   │ │  │  │独立内存   │ │     │
│  │  │独立 Token │ │  │  │独立 Token │ │  │  │独立 Token │ │     │
│  │  │   配额    │ │  │  │   配额    │ │  │  │   配额    │ │     │
│  │  └───────────┘ │  │  └───────────┘ │  │  └───────────┘ │     │
│  │  ⚡ 崩溃不扩散 │  │  ✅ 正常运行   │  │  ✅ 正常运行   │     │
│  └────────────────┘  └────────────────┘  └────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

```python
import asyncio
from dataclasses import dataclass, field
from typing import Optional, Any, Callable
from enum import Enum

class AgentHealthStatus(Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    FAILED = "failed"

@dataclass
class BulkheadConfig:
    """隔舱配置"""
    max_concurrent: int = 3       # 最大并发任务数
    timeout_seconds: float = 30   # 单任务超时时间
    max_failures: int = 5         # 最大连续失败次数
    recovery_seconds: float = 60  # 失败后恢复等待时间

class AgentBulkhead:
    """Agent 隔舱：限制并发 + 故障熔断 + 自动恢复"""

    def __init__(self, agent_name: str, config: BulkheadConfig):
        self.agent_name = agent_name
        self.config = config
        self._semaphore = asyncio.Semaphore(config.max_concurrent)
        self._failure_count = 0
        self._status = AgentHealthStatus.HEALTHY
        self._last_failure_time: Optional[float] = None

    @property
    def status(self) -> AgentHealthStatus:
        return self._status

    async def execute(self, func: Callable, *args, **kwargs) -> Any:
        """在隔舱保护下执行 Agent 任务"""
        # 熔断检查：连续失败过多，暂停服务
        if self._status == AgentHealthStatus.FAILED:
            elapsed = asyncio.get_event_loop().time() - (self._last_failure_time or 0)
            if elapsed < self.config.recovery_seconds:
                raise RuntimeError(
                    f"Agent [{self.agent_name}] 已熔断，"
                    f"剩余恢复时间 {self.config.recovery_seconds - elapsed:.0f}s"
                )
            # 恢复期到，尝试半开
            self._status = AgentHealthStatus.DEGRADED
            self._failure_count = 0

        # 信号量限制并发
        async with self._semaphore:
            try:
                result = await asyncio.wait_for(
                    func(*args, **kwargs),
                    timeout=self.config.timeout_seconds,
                )
                # 成功：重置失败计数
                self._failure_count = 0
                self._status = AgentHealthStatus.HEALTHY
                return result
            except (asyncio.TimeoutError, Exception) as e:
                self._failure_count += 1
                if self._failure_count >= self.config.max_failures:
                    self._status = AgentHealthStatus.FAILED
                    self._last_failure_time = asyncio.get_event_loop().time()
                raise
```

### 10.2 超时与降级策略

**类比**：外卖平台——如果骑手 30 分钟还没送达，系统会自动触发"超时补偿"：要么重新派单（重试），要么直接退款（降级返回默认结果）。Agent 超时同理。

**三级降级策略**：

```
正常响应 ───超时──► 重试（换模型） ───再超时──► 降级（缓存/默认值） ───仍失败──► 人工介入
```

```python
import asyncio
import time
from typing import Optional, Any

class DegradationLevel(Enum):
    FULL = "full"           # 完整能力
    REDUCED = "reduced"     # 降级：使用缓存或简化逻辑
    MINIMAL = "minimal"     # 最小化：返回默认值
    MANUAL = "manual"       # 人工介入

class GracefulAgent:
    """支持优雅降级的 Agent 包装器"""

    def __init__(self, agent_name: str, primary_model: str, fallback_model: str):
        self.agent_name = agent_name
        self.primary_model = primary_model
        self.fallback_model = fallback_model
        self._cache: dict[str, Any] = {}

    async def execute_with_degradation(
        self, task: str, timeout: float = 30.0
    ) -> dict[str, Any]:
        """带降级的任务执行"""
        # 第 1 级：使用主模型
        try:
            result = await asyncio.wait_for(
                self._call_llm(task, self.primary_model), timeout=timeout
            )
            self._cache[self._cache_key(task)] = result  # 缓存成功结果
            return {"level": DegradationLevel.FULL, "result": result}
        except asyncio.TimeoutError:
            pass

        # 第 2 级：使用备用轻量模型
        try:
            result = await asyncio.wait_for(
                self._call_llm(task, self.fallback_model), timeout=timeout / 2
            )
            return {"level": DegradationLevel.REDUCED, "result": result}
        except asyncio.TimeoutError:
            pass

        # 第 3 级：使用缓存
        cached = self._cache.get(self._cache_key(task))
        if cached:
            return {"level": DegradationLevel.MINIMAL, "result": cached, "from_cache": True}

        # 第 4 级：请求人工介入
        return {
            "level": DegradationLevel.MANUAL,
            "result": None,
            "message": f"Agent [{self.agent_name}] 全部降级策略已耗尽，请人工处理",
        }

    def _cache_key(self, task: str) -> str:
        return f"{self.agent_name}:{hash(task)}"

    async def _call_llm(self, task: str, model: str) -> str:
        # 实际调用 LLM API（此处为接口占位）
        raise NotImplementedError
```

### 10.3 幂等性保证

**类比**：电梯按钮——你按一次"3楼"和按十次"3楼"，电梯都只去一次 3 楼。Agent 操作的幂等性也是如此：同一个任务无论被发送一次还是重试五次，最终效果都只产生一次。

**为什么需要幂等？** 分布式系统中网络抖动、超时重试极其常见，如果 Agent 操作不是幂等的，重试可能导致数据重复写入、资源重复创建等副作用。

```python
import hashlib
import json
from typing import Optional, Any
from datetime import datetime, timedelta

class IdempotencyStore:
    """幂等性存储——记录已执行的操作，防止重复执行"""

    def __init__(self):
        self._executed: dict[str, dict] = {}  # idempotency_key → {result, expires_at}

    def _make_key(self, agent_name: str, task: str, params: dict) -> str:
        """生成幂等键：相同 Agent + 相同任务 + 相同参数 = 相同键"""
        raw = json.dumps({"agent": agent_name, "task": task, "params": params}, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()

    def check_and_set(
        self, agent_name: str, task: str, params: dict, ttl_hours: int = 24
    ) -> Optional[Any]:
        """
        检查是否已执行。
        - 已执行且未过期：返回缓存结果（跳过执行）
        - 未执行或已过期：返回 None（继续执行）
        """
        key = self._make_key(agent_name, task, params)
        entry = self._executed.get(key)
        if entry and datetime.utcnow() < entry["expires_at"]:
            return entry["result"]
        return None

    def record(self, agent_name: str, task: str, params: dict, result: Any, ttl_hours: int = 24):
        """记录已执行的操作"""
        key = self._make_key(agent_name, task, params)
        self._executed[key] = {
            "result": result,
            "expires_at": datetime.utcnow() + timedelta(hours=ttl_hours),
        }

# ── 使用示例 ──────────────────────────────────────────────────────────
store = IdempotencyStore()

async def idempotent_agent_execute(agent, task: str, params: dict) -> Any:
    """幂等执行：重试安全"""
    # 先检查是否已执行
    cached = store.check_and_set(agent.name, task, params)
    if cached is not None:
        print(f"⚡ 幂等命中：跳过重复执行 [{agent.name}] {task[:30]}...")
        return cached

    # 首次执行
    result = await agent.execute(task, **params)
    store.record(agent.name, task, params, result)
    return result
```

### 10.4 监控与告警

**类比**：ICU 病房的心电监护仪——持续监测心率、血压、血氧等关键指标，一旦超出阈值立即报警。多 Agent 系统也需要这样的"监护仪"来及时发现问题。

**必须监控的四大指标**：

| 指标类别 | 具体指标 | 告警阈值示例 | 含义 |
|---------|---------|-------------|------|
| **延迟** | Agent 响应 P99 延迟 | > 30s | 系统变慢，用户体验受损 |
| **成功率** | Agent 任务完成率 | < 95% | 频繁失败，需排查 |
| **Token 消耗** | 每分钟 Token 使用量 | > 预算 80% | 成本即将超限 |
| **队列深度** | 待处理消息数 | > 100 | 消费跟不上生产，需扩容或限流 |

```python
import time
from dataclasses import dataclass, field
from collections import deque

@dataclass
class AgentMetrics:
    """单个 Agent 的运行指标"""
    agent_name: str
    total_tasks: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_tokens: int = 0
    latencies: deque = field(default_factory=lambda: deque(maxlen=100))  # 最近 100 次延迟

    @property
    def success_rate(self) -> float:
        return self.success_count / max(self.total_tasks, 1)

    @property
    def p99_latency(self) -> float:
        if not self.latencies:
            return 0.0
        sorted_lats = sorted(self.latencies)
        idx = int(len(sorted_lats) * 0.99)
        return sorted_lats[min(idx, len(sorted_lats) - 1)]

    def record_task(self, success: bool, latency: float, tokens: int):
        self.total_tasks += 1
        if success:
            self.success_count += 1
        else:
            self.failure_count += 1
        self.latencies.append(latency)
        self.total_tokens += tokens

class MultiAgentMonitor:
    """多 Agent 系统监控中心"""

    def __init__(self):
        self._metrics: dict[str, AgentMetrics] = {}
        self._alerts: list[dict] = []

    def get_or_create(self, agent_name: str) -> AgentMetrics:
        if agent_name not in self._metrics:
            self._metrics[agent_name] = AgentMetrics(agent_name=agent_name)
        return self._metrics[agent_name]

    def check_health(self) -> list[dict]:
        """健康检查，返回告警列表"""
        alerts = []
        for name, m in self._metrics.items():
            if m.success_rate < 0.95 and m.total_tasks >= 10:
                alerts.append({
                    "agent": name,
                    "type": "low_success_rate",
                    "value": f"{m.success_rate:.1%}",
                    "severity": "critical" if m.success_rate < 0.8 else "warning",
                })
            if m.p99_latency > 30:
                alerts.append({
                    "agent": name,
                    "type": "high_latency",
                    "value": f"{m.p99_latency:.1f}s",
                    "severity": "warning",
                })
        return alerts

    def dashboard(self) -> str:
        """输出文本仪表盘"""
        lines = ["═══ Multi-Agent System Dashboard ═══"]
        for name, m in self._metrics.items():
            status = "✅" if m.success_rate >= 0.95 else "⚠️" if m.success_rate >= 0.8 else "🔴"
            lines.append(
                f"  {status} {name}: "
                f"成功率={m.success_rate:.1%} | "
                f"P99={m.p99_latency:.1f}s | "
                f"Token={m.total_tokens:,}"
            )
        return "\n".join(lines)
```

### 10.5 限流与背压

**类比**：高速公路匝道控制——当主路已经拥堵时，匝道的红绿灯会减慢上匝车辆的速度（限流），而不是让所有车都涌上去导致全线瘫痪（系统崩溃）。多 Agent 系统中，当下游 Agent 处理不过来时，上游 Agent 必须减速或暂停发送任务。

**两种保护机制**：

| 机制 | 方向 | 原理 | 类比 |
|------|------|------|------|
| **限流（Rate Limiting）** | 上游主动控制 | 限制每秒发送的任务数 | 水龙头控制出水量 |
| **背压（Backpressure）** | 下游反馈上游 | 下游告知上游"我忙不过来" | 工厂流水线前一个工位喊停 |

```python
import asyncio
import time
from collections import deque

class TokenBucketRateLimiter:
    """令牌桶限流器——控制 Agent 任务发送速率"""

    def __init__(self, rate: float, burst: int):
        """
        rate: 每秒补充的令牌数（= 允许的最大 QPS）
        burst: 桶容量（= 允许的突发量）
        """
        self.rate = rate
        self.burst = burst
        self._tokens = float(burst)
        self._last_refill = time.monotonic()

    async def acquire(self):
        """获取一个令牌（无令牌时阻塞等待）"""
        while True:
            self._refill()
            if self._tokens >= 1:
                self._tokens -= 1
                return
            # 等待直到下一个令牌生成
            wait_time = (1 - self._tokens) / self.rate
            await asyncio.sleep(wait_time)

    def _refill(self):
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self.burst, self._tokens + elapsed * self.rate)
        self._last_refill = now


class BackpressureQueue:
    """带背压的任务队列——队列满时拒绝新任务"""

    def __init__(self, max_size: int = 50, high_watermark: float = 0.8):
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=max_size)
        self._max_size = max_size
        self._high_watermark = high_watermark

    @property
    def pressure_level(self) -> float:
        """当前压力水平 (0.0 ~ 1.0)"""
        return self._queue.qsize() / self._max_size

    @property
    def should_slow_down(self) -> bool:
        """是否应该减速"""
        return self.pressure_level >= self._high_watermark

    async def submit(self, task: dict) -> bool:
        """提交任务。队列满时返回 False（背压信号）"""
        if self._queue.full():
            return False  # 背压：拒绝新任务
        await self._queue.put(task)
        return True

    async def consume(self) -> dict:
        """消费一个任务"""
        return await self._queue.get()


# ── 组合使用：限流 + 背压 ──────────────────────────────────────────
async def protected_task_dispatch(
    task: dict,
    limiter: TokenBucketRateLimiter,
    queue: BackpressureQueue,
):
    """带完整保护的任务分发"""
    # 第 1 层：背压检查
    if queue.should_slow_down:
        print(f"⚠️ 队列压力 {queue.pressure_level:.0%}，延迟提交...")
        await asyncio.sleep(2)  # 主动减速

    # 第 2 层：限流
    await limiter.acquire()

    # 第 3 层：入队
    success = await queue.submit(task)
    if not success:
        print("🔴 队列已满，任务被拒绝。请稍后重试。")
    return success
```

---

## 11. 成本控制与优化

> 多 Agent 系统的运营成本远高于单 Agent——每个 Agent 独立调用 LLM，Token 消耗呈倍数增长。不做成本控制，几个小时就能烧掉几百美元。

### 11.1 Token 预算分配

**类比**：家庭财务预算——总收入有限，要把钱分配到房租、餐饮、交通等不同类别。给每个 Agent 设置 Token "预算"，超支时触发限制，避免某个 Agent 失控烧光全部预算。

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class TokenBudget:
    """单个 Agent 的 Token 预算"""
    agent_name: str
    max_tokens_per_task: int = 4000      # 单任务上限
    max_tokens_per_hour: int = 100_000   # 每小时上限
    max_tokens_total: int = 1_000_000    # 总预算上限
    used_tokens: int = 0
    _hourly_used: int = 0

    @property
    def remaining(self) -> int:
        return self.max_tokens_total - self.used_tokens

    @property
    def budget_exhausted(self) -> bool:
        return self.used_tokens >= self.max_tokens_total

class BudgetManager:
    """多 Agent Token 预算管理器"""

    def __init__(self):
        self._budgets: dict[str, TokenBudget] = {}

    def set_budget(self, agent_name: str, **kwargs):
        self._budgets[agent_name] = TokenBudget(agent_name=agent_name, **kwargs)

    def request_tokens(self, agent_name: str, estimated_tokens: int) -> dict:
        """
        申请 Token。返回是否批准 + 可用额度。
        ❌ 超预算 → 拒绝
        ⚠️ 接近上限 → 批准但告警
        ✅ 正常 → 批准
        """
        budget = self._budgets.get(agent_name)
        if not budget:
            return {"approved": True, "warning": "未设置预算，不限制"}

        if budget.budget_exhausted:
            return {"approved": False, "reason": f"总预算已耗尽 ({budget.used_tokens:,} tokens)"}

        if estimated_tokens > budget.max_tokens_per_task:
            return {
                "approved": False,
                "reason": f"单任务预估 {estimated_tokens:,} 超过上限 {budget.max_tokens_per_task:,}",
            }

        remaining_pct = budget.remaining / budget.max_tokens_total
        budget.used_tokens += estimated_tokens

        if remaining_pct < 0.1:
            return {"approved": True, "warning": f"⚠️ 预算剩余不足 10% ({budget.remaining:,} tokens)"}
        return {"approved": True}

    def report(self) -> str:
        """预算使用报告"""
        lines = ["═══ Token Budget Report ═══"]
        for name, b in self._budgets.items():
            pct = b.used_tokens / b.max_tokens_total * 100
            bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
            lines.append(f"  {name}: [{bar}] {pct:.1f}% ({b.used_tokens:,}/{b.max_tokens_total:,})")
        return "\n".join(lines)
```

### 11.2 模型分层：关键决策用强模型，辅助任务用轻量模型

**类比**：医院分诊——普通感冒由全科医生处理（轻量模型），疑难杂症才请专家会诊（旗舰模型）。不是每个 Agent 都需要 GPT-4o 或 Claude Sonnet——对于简单格式化、信息提取等任务，小模型既快又便宜。

| Agent 角色 | 推荐模型层级 | 理由 | 成本比 |
|-----------|-------------|------|--------|
| **Orchestrator（编排者）** | 旗舰模型（GPT-4o / Claude Sonnet） | 需要复杂推理、全局决策 | 1× |
| **Coder（代码生成）** | 旗舰模型或代码专用模型 | 代码质量直接影响结果 | 1× |
| **Reviewer（审查员）** | 中等模型 | 按 Checklist 检查即可 | 0.3× |
| **Formatter（格式化）** | 轻量模型（GPT-4o-mini / Haiku） | 纯格式转换，无需深度推理 | 0.05× |
| **Router（路由分发）** | 轻量模型或规则引擎 | 分类任务，确定性高 | 0.05× |
| **Summarizer（摘要）** | 中等模型 | 需要理解但不需要创造 | 0.3× |

```python
from enum import Enum

class ModelTier(Enum):
    FLAGSHIP = "flagship"       # GPT-4o, Claude Sonnet 4
    MID = "mid"                 # GPT-4o-mini, Claude Haiku
    LIGHT = "light"             # 轻量模型或本地模型
    RULE = "rule"               # 不使用 LLM，纯规则引擎

# 模型分层配置
MODEL_TIER_MAP = {
    ModelTier.FLAGSHIP: {"model": "gpt-4o", "cost_per_1k_tokens": 0.005},
    ModelTier.MID:      {"model": "gpt-4o-mini", "cost_per_1k_tokens": 0.00015},
    ModelTier.LIGHT:    {"model": "local-qwen-7b", "cost_per_1k_tokens": 0.0},
    ModelTier.RULE:     {"model": None, "cost_per_1k_tokens": 0.0},
}

class SmartModelSelector:
    """根据任务复杂度自动选择模型层级"""

    @staticmethod
    def select(task_description: str, agent_role: str) -> ModelTier:
        """简单的基于规则的模型选择（生产环境可用 LLM 做更智能的判断）"""
        # 编排者和代码生成始终用旗舰模型
        if agent_role in ("orchestrator", "coder"):
            return ModelTier.FLAGSHIP

        # 简单任务用轻量模型
        simple_keywords = ["格式化", "排版", "转换格式", "提取字段", "分类"]
        if any(kw in task_description for kw in simple_keywords):
            return ModelTier.LIGHT

        # 其他用中等模型
        return ModelTier.MID
```

### 11.3 缓存与复用：Agent 间共享推理结果

**类比**：办公室的共享文件柜——第一个同事查到的资料放进文件柜，后面的同事直接取用，不需要重新去图书馆查。Agent 之间共享推理结果也一样，避免多个 Agent 重复进行相同的 LLM 调用。

```python
import hashlib
import json
import time
from typing import Optional, Any

class AgentResultCache:
    """Agent 推理结果缓存——跨 Agent 共享"""

    def __init__(self, max_entries: int = 1000, default_ttl: int = 3600):
        self._cache: dict[str, dict] = {}
        self._max_entries = max_entries
        self._default_ttl = default_ttl
        self._hits = 0
        self._misses = 0

    def _make_key(self, task: str, context: str = "") -> str:
        """语义相似的任务应命中同一缓存键"""
        raw = f"{task.strip().lower()}|{context.strip().lower()}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, task: str, context: str = "") -> Optional[Any]:
        key = self._make_key(task, context)
        entry = self._cache.get(key)
        if entry and time.time() < entry["expires_at"]:
            self._hits += 1
            return entry["result"]
        self._misses += 1
        return None

    def put(self, task: str, result: Any, context: str = "", ttl: Optional[int] = None):
        # 缓存满时淘汰最旧的条目
        if len(self._cache) >= self._max_entries:
            oldest_key = min(self._cache, key=lambda k: self._cache[k]["created_at"])
            del self._cache[oldest_key]

        key = self._make_key(task, context)
        self._cache[key] = {
            "result": result,
            "created_at": time.time(),
            "expires_at": time.time() + (ttl or self._default_ttl),
        }

    @property
    def hit_rate(self) -> float:
        total = self._hits + self._misses
        return self._hits / max(total, 1)


# ── 在 Agent 编排器中使用缓存 ─────────────────────────────────────────
shared_cache = AgentResultCache()

async def cached_agent_call(agent, task: str, context: str = "") -> Any:
    """缓存感知的 Agent 调用"""
    cached = shared_cache.get(task, context)
    if cached is not None:
        print(f"📦 缓存命中 (命中率 {shared_cache.hit_rate:.1%})：跳过 [{agent.name}]")
        return cached

    result = await agent.execute(task)
    shared_cache.put(task, result, context)
    return result
```

### 11.4 动态规模调整

**类比**：网约车平台——早高峰多派车，深夜少派车，根据实时需求动态调整运力。多 Agent 系统也应该根据任务量和复杂度动态增减 Agent 数量，而不是固定一个"满编"阵容。

**何时扩容 / 缩容**：

| 信号 | 动作 | 原因 |
|------|------|------|
| 任务队列深度 > 阈值 | 增加同类 Agent 实例 | 处理能力不足 |
| Agent 空闲时间 > 阈值 | 减少 Agent 实例 | 避免浪费（空闲也消耗基础资源） |
| 任务复杂度突增 | 升级 Agent 的模型层级 | 需要更强推理能力 |
| 任务复杂度降低 | 降级 Agent 的模型层级 | 节省成本 |
| 特定领域任务激增 | 临时创建专业 Agent | 比通用 Agent 更高效 |

```python
from dataclasses import dataclass

@dataclass
class ScalingPolicy:
    """自动伸缩策略"""
    min_agents: int = 1
    max_agents: int = 10
    scale_up_threshold: int = 20      # 队列深度超过此值 → 扩容
    scale_down_threshold: int = 3     # 队列深度低于此值 → 缩容
    cooldown_seconds: float = 60      # 扩缩容冷却时间

class AutoScaler:
    """Agent 自动伸缩器"""

    def __init__(self, policy: ScalingPolicy):
        self.policy = policy
        self.current_count = policy.min_agents
        self._last_scale_time = 0.0

    def evaluate(self, queue_depth: int, avg_latency: float) -> dict:
        """评估是否需要扩缩容"""
        now = time.time()
        if now - self._last_scale_time < self.policy.cooldown_seconds:
            return {"action": "none", "reason": "冷却期内"}

        if queue_depth > self.policy.scale_up_threshold and self.current_count < self.policy.max_agents:
            new_count = min(self.current_count + 2, self.policy.max_agents)
            self.current_count = new_count
            self._last_scale_time = now
            return {"action": "scale_up", "new_count": new_count, "reason": f"队列深度 {queue_depth}"}

        if queue_depth < self.policy.scale_down_threshold and self.current_count > self.policy.min_agents:
            new_count = max(self.current_count - 1, self.policy.min_agents)
            self.current_count = new_count
            self._last_scale_time = now
            return {"action": "scale_down", "new_count": new_count, "reason": f"队列空闲"}

        return {"action": "none", "reason": "无需调整"}
```

---

## 12. 多 Agent 编排模式对比

> 第 2.4 节概述了三种基本拓扑（Hub-Spoke、P2P、分层）。本节进一步展开，系统对比五种主流编排模式在实际落地时的权衡。

### 12.1 五种编排模式总览

**类比**：这五种模式就像五种团队管理风格——

| 模式 | 类比 |
|------|------|
| 层级式 | 公司组织架构：CEO → VP → 经理 → 员工，逐级下达指令 |
| 对等式 | 开源社区：每个人都可以自由协作，没有固定领导 |
| 市场式 | 自由职业平台（Upwork）：任务发布方发布需求，有能力的人抢单 |
| 流水线式 | 汽车装配线：焊接 → 喷漆 → 装配 → 质检，严格按顺序 |
| 辩论式 | 法庭审判：控方辩方轮流发言，法官最终裁决 |

### 12.2 模式详解

#### 12.2.1 层级式（Supervisor → Workers）

```
               ┌──────────────┐
               │  Supervisor  │
               │  (管理者)    │
               └──┬───┬───┬──┘
                  │   │   │
           ┌──────┘   │   └──────┐
           ▼          ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Worker A │ │ Worker B │ │ Worker C │
    │ (研究)   │ │ (编码)   │ │ (测试)   │
    └──────────┘ └──────────┘ └──────────┘
```

- **工作流程**：Supervisor 接收用户请求 → 拆分任务 → 分配给对应 Worker → 收集结果 → 汇总返回
- **适用场景**：任务可明确拆分、子任务相互独立、需要集中控制
- **典型实现**：AutoGen GroupChat with Manager、LangGraph Supervisor Node

#### 12.2.2 对等式（Peer-to-Peer）

```
    Agent A ◄──────► Agent B
       ▲  ╲            ╱  ▲
       │    ╲        ╱    │
       │      ╲    ╱      │
       ▼        ╳        ▼
    Agent D ◄──────► Agent C
```

- **工作流程**：任何 Agent 都可以直接与其他 Agent 通信，无中心协调者
- **适用场景**：探索性任务、创意头脑风暴、需要动态组队
- **典型实现**：AutoGen Two-Agent Chat、自定义 P2P 协议

#### 12.2.3 市场式（Task Marketplace）

```
    ┌──────────────────────────────────┐
    │        任务市场 (Marketplace)    │
    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
    │  │任务│ │任务│ │任务│ │任务│  │
    │  │ #1 │ │ #2 │ │ #3 │ │ #4 │  │
    │  └────┘ └────┘ └────┘ └────┘  │
    └──────┬───────────────┬─────────┘
           │  竞标/认领     │
    ┌──────┴──┐      ┌─────┴───┐
    │ Agent A │      │ Agent B │   按能力自主选择任务
    │ (擅长   │      │ (擅长   │
    │  前端)  │      │  后端)  │
    └─────────┘      └─────────┘
```

- **工作流程**：任务发布到公共市场 → Agent 根据自身能力评估并认领 → 完成后提交结果
- **适用场景**：异构 Agent 池、任务类型多样、需要弹性分配
- **典型实现**：自定义 Task Queue + Agent Capability Matching

#### 12.2.4 流水线式（Pipeline）

```
    输入 ──► Agent A ──► Agent B ──► Agent C ──► Agent D ──► 输出
             (解析)      (分析)      (生成)      (校验)
```

- **工作流程**：任务严格按顺序流过一系列 Agent，前一步的输出是后一步的输入
- **适用场景**：步骤固定、强依赖顺序的工作流（如 ETL 处理、文档生成流水线）
- **典型实现**：LangGraph Sequential Nodes、Dify Workflow

#### 12.2.5 辩论式（Debate / Adversarial）

```
    ┌──────────┐        ┌──────────┐
    │ Agent A  │  交替  │ Agent B  │
    │ (正方)   │◄─────►│ (反方)   │
    └────┬─────┘ 辩论   └────┬─────┘
         │                   │
         └─────────┬─────────┘
                   ▼
            ┌──────────┐
            │  Judge   │
            │ (裁判)   │
            └──────────┘
```

- **工作流程**：正方 Agent 提出方案 → 反方 Agent 批评 → 多轮辩论 → 裁判 Agent 综合裁决
- **适用场景**：需要高质量决策、方案评估、安全审查
- **典型实现**：AutoGen 多角色 GroupChat、自定义 Debate Loop

### 12.3 综合对比表

| 维度 | 层级式 | 对等式 | 市场式 | 流水线式 | 辩论式 |
|------|--------|--------|--------|---------|--------|
| **通信开销** | 中等（星形） | 高（网状） | 低（集中） | 最低（线性） | 中等（往返） |
| **实现复杂度** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐ |
| **可扩展性** | 中等 | 差（N² 通信） | 好 | 中等 | 差 |
| **容错能力** | 中等（单点在 Supervisor） | 好（无单点故障） | 好（任务可重新认领） | 差（断链即停） | 中等 |
| **适合任务类型** | 明确可拆分的复杂任务 | 探索性、创意性任务 | 异构任务池 | 固定步骤的流程 | 需要对抗验证的决策 |
| **Agent 数量建议** | 3-10 | 2-5 | 5-50 | 2-8 | 2-3 + 裁判 |
| **延迟** | 中等 | 不可预测 | 中等 | 累加（串行） | 高（多轮） |
| **代表框架** | AutoGen GroupChat、LangGraph | AutoGen Two-Agent | 自定义实现 | Dify Workflow | LangGraph Debate |

**选择决策树**：

```
任务特征判断：
│
├─ 步骤固定且有序？ ──────────────► 流水线式
│
├─ 需要对抗性验证？ ──────────────► 辩论式
│
├─ Agent 能力差异大、任务类型多？ ──► 市场式
│
├─ 任务可明确拆分为子任务？ ───────► 层级式
│
└─ 以上都不符合 / 探索性任务 ─────► 对等式
```

---

## 13. 常见陷阱与最佳实践

> 多 Agent 系统的设计和运维充满了反直觉的陷阱。以下总结了实践中最常见的 ❌ 错误做法和 ✅ 正确做法。

### 13.1 Agent 数量

**❌ 误区：Agent 数量越多越好**

> "任务复杂？加 Agent！效果不好？再加 Agent！"

这是最常见的直觉——觉得更多 Agent = 更强能力。实际上，每增加一个 Agent，通信开销、协调成本和故障概率都在增长。

**✅ 正确做法：最少化 Agent 数量，优先单 Agent 增强**

> 先尝试用一个强 Agent + 多工具解决问题。只有当单 Agent 的上下文窗口、专业知识或并行处理确实成为瓶颈时，才引入多 Agent。

```python
# ❌ 过度拆分：6 个 Agent 完成一个简单任务
agents = {
    "input_parser": Agent("解析用户输入"),
    "validator": Agent("验证输入合法性"),
    "formatter": Agent("格式化数据"),
    "processor": Agent("处理核心逻辑"),
    "output_formatter": Agent("格式化输出"),
    "responder": Agent("生成回复"),
}
# 问题：6 次 LLM 调用，大量通信开销，简单任务被过度工程化

# ✅ 简化：1 个 Agent + 工具完成同样任务
agent = Agent(
    name="all_in_one",
    system_message="你是一个全能助手，负责解析、验证、处理和回复用户请求。",
    tools=[validate_tool, format_tool, process_tool],
)
# 效果：1 次 LLM 调用（可能触发多次工具调用），延迟低，成本低
```

**判断是否需要多 Agent 的检查清单**：

- [ ] 单 Agent 的上下文窗口是否已不够用？
- [ ] 任务是否需要多个截然不同的专业角色？
- [ ] 是否需要并行处理以降低延迟？
- [ ] 是否需要 Agent 之间的对抗性审查？

> 如果以上全部回答"否"，那就不需要多 Agent。

### 13.2 模型选择

**❌ 误区：所有 Agent 用同一个模型**

> "统一用 GPT-4o 就行了，简单省事。"

这导致简单任务浪费昂贵的 Token，而真正需要强推理的任务却没有额外资源。

**✅ 正确做法：按角色选择合适的模型**

```python
# ❌ 全部用旗舰模型
orchestrator = Agent(model="gpt-4o")      # 需要强推理 ✅ 合理
router = Agent(model="gpt-4o")            # 只做分类 ❌ 浪费
formatter = Agent(model="gpt-4o")         # 只做格式化 ❌ 浪费
# 成本：$$$$$

# ✅ 按角色分层
orchestrator = Agent(model="gpt-4o")          # 核心决策：旗舰模型
reviewer = Agent(model="gpt-4o-mini")         # 审查校验：中等模型
router = Agent(model="gpt-4o-mini")           # 任务路由：轻量模型
formatter = Agent(model="local-qwen-7b")      # 格式转换：本地模型（零成本）
# 成本：$ （节省 60-80%）
```

### 13.3 循环控制

**❌ 误区：允许无限循环讨论**

> "让 Agent 们自由讨论，直到达成共识为止。"

没有终止条件的多 Agent 对话极易陷入无限循环——Agent A 提出方案，Agent B 反对，Agent A 修改后再提，Agent B 又反对……永远无法收敛。

**✅ 正确做法：设置最大轮次 + 裁判机制**

```python
# ❌ 无限循环：永远等待"共识"
while True:
    response_a = agent_a.respond(response_b)
    response_b = agent_b.respond(response_a)
    if "达成共识" in response_b:  # 这个条件可能永远不满足
        break

# ✅ 有限轮次 + 强制裁决
MAX_ROUNDS = 5

for round_num in range(MAX_ROUNDS):
    response_a = agent_a.respond(response_b)
    response_b = agent_b.respond(response_a)

    # 收敛检测：如果双方意见趋同，提前结束
    if similarity(response_a, response_b) > 0.9:
        break

# 无论是否收敛，裁判 Agent 做最终决策
final_answer = judge_agent.arbitrate(
    opinions=[response_a, response_b],
    instruction="综合正反双方意见，给出最终方案",
)
```

### 13.4 通信成本意识

**❌ 误区：忽略 Agent 间通信的 Token 成本**

> "Agent 之间传递消息又不是调用 API，不花钱吧？"

**大错特错**。在基于 LLM 的多 Agent 系统中，Agent 之间的每一条消息都会被塞进下一个 Agent 的 Prompt 里。这意味着：

- Agent A 给 Agent B 发了 500 Token 的消息
- Agent B 处理时，这 500 Token 作为上下文输入消耗
- Agent B 的输出又发给 Agent C，上下文继续膨胀

**✅ 正确做法：精简 Agent 间消息，做摘要压缩**

```python
# ❌ 完整传递：把 Agent A 的全部输出原封不动传给 Agent B
agent_b_input = {
    "context": agent_a_full_output,  # 可能有 2000+ Token
    "task": "请审查以上内容",
}

# ✅ 摘要传递：只传递关键信息
agent_b_input = {
    "context": summarize(agent_a_full_output, max_tokens=200),  # 压缩到 200 Token
    "key_findings": extract_key_points(agent_a_full_output),     # 结构化关键发现
    "task": "请审查以上要点",
}
# 节省：~80% 的上下文 Token
```

**消息大小控制的经验法则**：

| 消息类型 | 建议 Token 上限 | 原因 |
|---------|---------------|------|
| 任务指令 | 200-500 | 清晰明确即可 |
| 执行结果 | 500-1000 | 包含关键数据 + 简要总结 |
| 讨论消息 | 200-400 | 观点 + 理由，不要冗余 |
| 错误报告 | 100-200 | 错误类型 + 简短描述 |

### 13.5 故障处理

**❌ 误区：假设 Agent 永远不会出错**

> "反正 LLM 很智能，不会出问题的。"

LLM 可能返回格式错误、幻觉输出、超时无响应、甚至 API 500 错误。在多 Agent 系统中，一个 Agent 的失败如果没有处理，会像多米诺骨牌一样连锁导致整个系统崩溃。

**✅ 正确做法：每个 Agent 必须有降级方案**

```python
# ❌ 无容错：任何一个 Agent 失败都会导致整体崩溃
async def pipeline_no_protection(task: str) -> str:
    result_a = await agent_a.execute(task)           # 如果失败 → 整个函数崩溃
    result_b = await agent_b.execute(result_a)       # 上游失败 → 拿到 None → 出错
    result_c = await agent_c.execute(result_b)       # 连锁崩溃
    return result_c

# ✅ 有容错：每一步都有降级方案
async def pipeline_with_protection(task: str) -> str:
    # Agent A：有重试 + 降级
    try:
        result_a = await retry(agent_a.execute, task, max_attempts=2)
    except Exception:
        result_a = fallback_extract(task)  # 降级：使用规则引擎提取
        log_warning("Agent A 降级执行")

    # Agent B：有超时 + 默认值
    try:
        result_b = await asyncio.wait_for(agent_b.execute(result_a), timeout=20)
    except asyncio.TimeoutError:
        result_b = default_analysis(result_a)  # 降级：返回基础分析
        log_warning("Agent B 超时，使用默认分析")

    # Agent C：有熔断保护
    if agent_c_bulkhead.status != AgentHealthStatus.FAILED:
        try:
            result_c = await agent_c_bulkhead.execute(agent_c.execute, result_b)
        except Exception:
            result_c = result_b  # 降级：跳过最终处理，直接输出
    else:
        result_c = result_b
        log_warning("Agent C 已熔断，跳过")

    return result_c
```

### 13.6 陷阱速查表

| 序号 | ❌ 常见错误 | ✅ 正确做法 | 核心原因 |
|-----|-----------|------------|---------|
| 1 | Agent 数量越多越好 | 最少化 Agent，优先单 Agent + 多工具 | 通信开销 O(N²) 增长 |
| 2 | 所有 Agent 用同一个模型 | 按角色选择模型层级 | 简单任务用旗舰模型是浪费 |
| 3 | 无限循环讨论 | 设置最大轮次 + 裁判机制 | LLM 对话不保证收敛 |
| 4 | 忽略通信成本 | Agent 间消息做摘要压缩 | 每条消息都是 Token 消耗 |
| 5 | 无故障处理 | 每个 Agent 有降级方案 | LLM 调用本质上不可靠 |
| 6 | Agent 共享一个巨大的上下文 | 每个 Agent 只看自己需要的信息 | 上下文越长，推理质量越差 |
| 7 | 不监控 Agent 运行状态 | 为每个 Agent 记录延迟/成功率/Token | 无法观测 = 无法改进 |
| 8 | 先设计 Agent 再想通信协议 | 先定义消息格式和通信协议 | 协议是 Agent 协作的"合同" |
| 9 | 同步阻塞等待所有 Agent | 独立任务并行执行 | 串行调用延迟线性叠加 |
| 10 | 测试时只测单个 Agent | 端到端测试整个 Agent 流水线 | 集成问题只在组合时出现 |

---

## 导航

- ← [技术资料总目录](../)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md)
