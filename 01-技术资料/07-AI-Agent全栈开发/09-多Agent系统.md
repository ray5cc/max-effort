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

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/09-多Agent系统面试题.md)
