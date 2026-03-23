# 05-Agent框架与编排 — 技术资料

> 深入剖析主流 Agent 框架的内部架构：ReAct 范式、LangChain/LangGraph 源码、LangGraph 状态机、Dify Workflow 引擎、AutoGen 多智能体协作、Agent 设计模式的工程实践，以及 A2A 通信协议、Agent 评估体系、可观测性、Human-in-the-Loop 模式与可靠性工程。

## 相关链接

- 对应面试题：[05-Agent框架面试题](../../02-面试指南/07-AI-Agent全栈开发面试/05-Agent框架面试题.md)

---

## 目录

1. [ReAct 范式](#1-react-范式)
2. [LangChain Agent 架构源码](#2-langchain-agent-架构源码)
3. [LangGraph 状态机](#3-langgraph-状态机)
4. [Dify Workflow 引擎](#4-dify-workflow-引擎)
5. [Agent 设计模式](#5-agent-设计模式)
6. [microsoft/autogen 内部机制](#6-microsoftautogen-内部机制)
7. [框架横向对比](#7-框架横向对比)
8. [工程实践与选型建议](#8-工程实践与选型建议)
9. [Agent-to-Agent (A2A) 通信协议](#9-agent-to-agent-a2a-通信协议)
10. [Agent 评估体系](#10-agent-评估体系)
11. [可观测性最佳实践](#11-可观测性最佳实践)
12. [Human-in-the-Loop 模式](#12-human-in-the-loop-模式)
13. [Agent 可靠性工程](#13-agent-可靠性工程)
14. [常见陷阱与最佳实践](#14-常见陷阱与最佳实践)

---

## 1. ReAct 范式

### 1.1 核心思想

ReAct（Reasoning + Acting）由 Yao et al. (2022) 提出，是当前主流 Agent 框架的理论基础。其核心思路是将**推理轨迹（reasoning traces）**与**行动（actions）**交错生成，让语言模型在执行行动前先显式地"思考"。

与纯 Chain-of-Thought（CoT）的区别：

| 维度 | Chain-of-Thought | ReAct |
|------|-----------------|-------|
| 外部交互 | 无，纯内部推理 | 可调用工具/API |
| 状态更新 | 静态，基于初始 prompt | 动态，每步观察更新上下文 |
| 错误恢复 | 无法自我修正 | 可根据观察调整策略 |
| 适用场景 | 数学推理、逻辑题 | 信息检索、代码执行、多步任务 |

### 1.2 形式化定义

设任务为 $T$，Agent 在时间步 $t$ 的状态空间为 $(o_t, a_t, r_t)$：

```
o_t ∈ O  // 观察空间（Observation）
a_t ∈ A  // 行动空间（Action）
r_t ∈ R  // 推理轨迹（Reasoning trace / Thought）
```

ReAct 轨迹定义为：

```
τ = (r_1, a_1, o_1, r_2, a_2, o_2, ..., r_T, a_T, o_T)
```

其中每步生成过程：

```
r_t ~ π_θ(· | context_t)          // 生成思考
a_t ~ π_θ(· | context_t, r_t)     // 基于思考生成行动
o_t = env(a_t)                     // 环境返回观察
context_{t+1} = context_t ⊕ r_t ⊕ a_t ⊕ o_t  // 更新上下文
```

### 1.3 Thought-Action-Observation 循环

```mermaid
flowchart LR
    A["Input + Ctx"] --> B["Thought
(Reasoning)"]
    B --> C["Action
(Tool Call / Done)"]
    C -->|"env(action)"| D["Observation
(Tool Resp)"]
    D --> A
    C -->|"Final Answer"| E(["终止
达到最大步数限制"])

    style A fill:#4a9eff,color:#fff,stroke:#2563eb
    style B fill:#f59e0b,color:#fff,stroke:#d97706
    style C fill:#10b981,color:#fff,stroke:#059669
    style D fill:#8b5cf6,color:#fff,stroke:#7c3aed
    style E fill:#ef4444,color:#fff,stroke:#dc2626
```

### 1.4 经典 Prompt 模板

```
Answer the following questions as best you can.
You have access to the following tools:

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: {input}
Thought: {agent_scratchpad}
```

---

## 2. LangChain Agent 架构源码

### 2.1 类层次结构

```
BaseLanguageModel
    └── BaseChatModel
            └── ChatOpenAI / ChatAnthropic / ...

Runnable (LCEL 基类)
    └── RunnableSerializable
            └── BaseSingleActionAgent
            │       └── ZeroShotAgent (legacy)
            └── BaseMultiActionAgent
            └── RunnableAgent          ◀── 现代推荐方式
                    └── RunnableMultiActionAgent

AgentExecutor (继承 Chain → Runnable)
    ├── agent: Union[BaseSingleActionAgent, BaseMultiActionAgent, Runnable]
    ├── tools: Sequence[BaseTool]
    ├── max_iterations: int
    └── _call() / _acall()
```

### 2.2 `create_react_agent()` 源码解析

```python
# langchain/agents/react/agent.py (简化版)
def create_react_agent(
    llm: BaseLanguageModel,
    tools: Sequence[BaseTool],
    prompt: BasePromptTemplate,
    output_parser: Optional[AgentOutputParser] = None,
    tools_renderer: ToolsRenderer = render_text_description,
    *,
    stop_sequence: Union[bool, List[str]] = True,
) -> Runnable:
    """
    构建 ReAct Agent 的核心工厂函数
    返回一个 LCEL Runnable chain
    """
    missing_vars = {"tools", "tool_names", "agent_scratchpad"}.difference(
        prompt.input_variables + list(prompt.partial_variables)
    )
    if missing_vars:
        raise ValueError(f"Prompt missing required variables: {missing_vars}")

    # 将 tools 描述注入 prompt
    prompt = prompt.partial(
        tools=tools_renderer(list(tools)),
        tool_names=", ".join([t.name for t in tools]),
    )

    # 如果需要 stop sequence 防止 LLM 生成 "Observation:"
    if stop_sequence:
        stop = ["\nObservation"] if stop_sequence is True else stop_sequence
        llm_with_stop = llm.bind(stop=stop)
    else:
        llm_with_stop = llm

    # 构建 LCEL chain: prompt | llm | output_parser
    output_parser = output_parser or ReActOutputParser()
    agent = (
        RunnablePassthrough.assign(
            agent_scratchpad=lambda x: format_log_to_str(x["intermediate_steps"])
        )
        | prompt
        | llm_with_stop
        | output_parser
    )
    return agent
```

**关键点**：
1. `format_log_to_str` 将 `(AgentAction, str)` 列表序列化为 scratchpad 文本
2. `stop=["\\nObservation"]` 防止 LLM 幻构 Observation
3. 返回的是纯 LCEL Runnable，需包装进 `AgentExecutor` 才能执行

### 2.3 AgentExecutor 执行循环

```python
# langchain/agents/agent.py (核心逻辑简化)
class AgentExecutor(Chain):

    def _call(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        # 初始化中间步骤列表
        intermediate_steps: List[Tuple[AgentAction, str]] = []
        iterations = 0
        time_elapsed = 0.0

        while self._should_continue(iterations, time_elapsed):
            # 1. 让 agent 决策下一步
            next_step_output = self._take_next_step(
                name_to_tool_map,
                color_mapping,
                inputs,
                intermediate_steps,
            )

            # 2. 如果是 AgentFinish，返回最终答案
            if isinstance(next_step_output, AgentFinish):
                return self._return(next_step_output, intermediate_steps)

            # 3. 否则是 AgentAction(s)，执行工具调用
            intermediate_steps.extend(next_step_output)
            iterations += 1

        # 超过最大迭代次数，强制停止
        return self._return(
            self.agent.return_stopped_response(...),
            intermediate_steps,
        )

    def _take_next_step(self, ...):
        # 调用 agent.plan() 获取下一步决策
        output = self.agent.plan(intermediate_steps, **inputs)

        if isinstance(output, AgentFinish):
            return output

        # 执行工具
        actions = [output] if isinstance(output, AgentAction) else output
        result = []
        for agent_action in actions:
            tool = name_to_tool_map[agent_action.tool]
            observation = tool.run(agent_action.tool_input)
            result.append((agent_action, observation))
        return result
```

### 2.4 Tool 选择机制

```mermaid
flowchart TD
    A["LLM Output
Action: search
Action Input: python async"] --> B["ReActOutputParser.parse()"]
    B --> C["AgentAction
tool = 'search'
tool_input = '...'"]
    C --> D["name_to_tool_map['search']
= Tool(func=search_fn)"]
    D --> E["tool.run(tool_input)
→ observation (str)"]

    style A fill:#4a9eff,color:#fff,stroke:#2563eb
    style B fill:#f59e0b,color:#fff,stroke:#d97706
    style C fill:#10b981,color:#fff,stroke:#059669
    style D fill:#8b5cf6,color:#fff,stroke:#7c3aed
    style E fill:#06b6d4,color:#fff,stroke:#0891b2
```

工具注册方式：

```python
from langchain.tools import tool, BaseTool, StructuredTool

# 方式1：装饰器
@tool
def search(query: str) -> str:
    """Search the web for information."""
    return web_search(query)

# 方式2：StructuredTool（支持多参数）
def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b

mul_tool = StructuredTool.from_function(
    func=multiply,
    name="multiply",
    description="Multiply two numbers. Input: a and b as floats.",
)

# 方式3：继承 BaseTool（完全自定义）
class CustomTool(BaseTool):
    name: str = "custom"
    description: str = "A custom tool"

    def _run(self, query: str) -> str:
        return process(query)

    async def _arun(self, query: str) -> str:
        return await async_process(query)
```

---

## 3. LangGraph 状态机

### 3.1 核心抽象

LangGraph 将 Agent 工作流建模为**有状态的有向图（Stateful DAG）**，核心概念：

```
StateGraph
    ├── State Schema (TypedDict / Pydantic)
    ├── Nodes (callable: State → State update dict)
    ├── Edges (无条件 / 条件)
    └── Checkpointer (持久化状态快照)
```

### 3.2 StateGraph 内部结构

```python
# langgraph/graph/state.py (关键属性)
class StateGraph(Graph):
    schema: Type[Any]          # 状态 schema（TypedDict）
    nodes: Dict[str, Runnable] # 节点名 → 可执行对象
    edges: Set[Tuple]          # 无条件边集合
    branches: Dict[str, Dict[str, Branch]]  # 条件边

    # 编译后生成 CompiledGraph
    def compile(
        self,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        interrupt_before: Optional[Sequence[str]] = None,
        interrupt_after: Optional[Sequence[str]] = None,
    ) -> CompiledGraph: ...
```

### 3.3 完整 ReAct Agent 实现（LangGraph）

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

# 1. 定义状态 Schema
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    # add_messages 是 reducer：新消息追加而非替换

# 2. 定义工具
tools = [search_tool, calculator_tool, code_executor_tool]
llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

# 3. 定义节点函数
def agent_node(state: AgentState) -> dict:
    """调用 LLM 决策"""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: AgentState) -> str:
    """条件边：判断是否继续循环"""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"   # 有工具调用 → 执行工具
    return END           # 无工具调用 → 结束

# 4. 构建图
graph_builder = StateGraph(AgentState)

graph_builder.add_node("agent", agent_node)
graph_builder.add_node("tools", ToolNode(tools))  # 内置工具执行节点

graph_builder.set_entry_point("agent")

# 条件边：agent → tools 或 END
graph_builder.add_conditional_edges(
    "agent",
    should_continue,
    {"tools": "tools", END: END}
)

# 无条件边：tools → agent（循环回去）
graph_builder.add_edge("tools", "agent")

# 5. 编译（加入内存 checkpointer）
memory = MemorySaver()
graph = graph_builder.compile(checkpointer=memory)
```

### 3.4 状态传播机制

```mermaid
flowchart TD
    IS["{messages: [HumanMessage]}"] --> AN
    AN["**agent node**
input: messages
output: AIMessage with tool_calls"] -->|"add_messages reducer 追加消息"| S1
    S1["{messages: [Human, AI(tool_calls)]}"] -->|"should_continue → 'tools'"| TN
    TN["**tools node (ToolNode)**
执行每个 tool_call → ToolMessage"] --> S2
    S2["{messages: [Human, AI(tool_calls), ToolMessage(s)]}"] -->|"下一轮"| AN

    style IS fill:#6b7280,color:#fff,stroke:#4b5563
    style AN fill:#4a9eff,color:#fff,stroke:#2563eb
    style S1 fill:#f3f4f6,color:#374151,stroke:#9ca3af
    style TN fill:#10b981,color:#fff,stroke:#059669
    style S2 fill:#f3f4f6,color:#374151,stroke:#9ca3af
```

### 3.5 Checkpointing 与 MemorySaver

```python
# MemorySaver 内部：使用 Python dict 存储快照
class MemorySaver(BaseCheckpointSaver):
    storage: Dict[str, Dict[str, Any]] = {}

    def put(self, config: RunnableConfig, checkpoint: Checkpoint, ...) -> RunnableConfig:
        thread_id = config["configurable"]["thread_id"]
        self.storage[thread_id][checkpoint["id"]] = {
            "checkpoint": checkpoint,
            "metadata": metadata,
            "parent_config": parent_config,
        }
        return {**config, "configurable": {"thread_id": thread_id, ...}}

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        thread_id = config["configurable"]["thread_id"]
        # 返回最新快照或指定 checkpoint_id 的快照
        ...
```

**多轮对话使用方式**：

```python
config = {"configurable": {"thread_id": "user-123"}}

# 第一轮
result1 = graph.invoke(
    {"messages": [HumanMessage("帮我搜索 Python 异步编程")]},
    config=config
)

# 第二轮：状态自动从 checkpointer 恢复
result2 = graph.invoke(
    {"messages": [HumanMessage("给我一个代码示例")]},
    config=config  # 同一 thread_id，状态延续
)
```

### 3.6 条件边与并行分支

```python
# 并行分支（Fan-out / Fan-in）
from langgraph.graph import START

def route(state):
    return ["branch_a", "branch_b"]  # 返回列表 → 并行执行

graph.add_conditional_edges(
    "router",
    route,
    {"branch_a": "branch_a", "branch_b": "branch_b"}
)

# Fan-in：两个分支都汇入 aggregator
graph.add_edge("branch_a", "aggregator")
graph.add_edge("branch_b", "aggregator")
```

---

## 4. Dify Workflow 引擎

### 4.1 整体架构

基于 [langgenius/dify](https://github.com/langgenius/dify) 源码分析：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dify Workflow Engine                       │
│                                                                 │
│  ┌─────────────┐    ┌──────────────────────────────────────┐   │
│  │  API Layer   │───▶│         WorkflowEntry               │   │
│  │  (Flask)    │    │  api/services/workflow_service.py    │   │
│  └─────────────┘    └───────────────┬──────────────────────┘   │
│                                     │                           │
│                                     ▼                           │
│                      ┌──────────────────────────┐              │
│                      │    WorkflowEngineManager  │              │
│                      │  core/workflow/workflow_  │              │
│                      │  engine_manager.py        │              │
│                      └──────────────┬────────────┘              │
│                                     │                           │
│                    ┌────────────────┼────────────────┐          │
│                    ▼                ▼                ▼          │
│             ┌──────────┐   ┌──────────┐   ┌──────────────┐    │
│             │ Graph    │   │  Node    │   │  Variable    │    │
│             │ Engine   │   │ Factory  │   │  Pool        │    │
│             └──────────┘   └──────────┘   └──────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 WorkflowEntry 入口

```python
# api/core/workflow/workflow_entry.py (核心逻辑)
class WorkflowEntry:

    @classmethod
    def single_step_run(
        cls,
        *,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict,
        user: Union[Account, EndUser],
    ) -> Generator[NodeEvent | InNodeEvent, None, None]:
        """单节点调试执行"""
        node_instance, run_result = cls._run_single_node(
            workflow=workflow,
            node_id=node_id,
            user_inputs=user_inputs,
        )
        yield from cls._generate_node_events(node_instance, run_result)

    @classmethod
    def run_workflow(
        cls,
        *,
        workflow: Workflow,
        user_inputs: dict,
        invoke_from: InvokeFrom,
        callbacks: list[WorkflowCallback],
    ) -> None:
        """完整工作流执行（异步，事件驱动）"""
        graph = cls._build_graph(workflow)
        graph_engine = GraphEngine(
            graph=graph,
            variable_pool=VariablePool(...),
        )
        graph_engine.run()  # 内部使用线程池并行执行无依赖节点
```

### 4.3 节点类型与 DifyNodeFactory

```python
# core/workflow/nodes/node_mapping.py
NODE_TYPE_CLASSES_MAPPING = {
    NodeType.START:           StartNode,
    NodeType.END:             EndNode,
    NodeType.ANSWER:          AnswerNode,
    NodeType.LLM:             LLMNode,
    NodeType.KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalNode,
    NodeType.IF_ELSE:         IfElseNode,
    NodeType.CODE:            CodeNode,
    NodeType.TEMPLATE_TRANSFORM: TemplateTransformNode,
    NodeType.QUESTION_CLASSIFIER: QuestionClassifierNode,
    NodeType.HTTP_REQUEST:    HttpRequestNode,
    NodeType.TOOL:            ToolNode,
    NodeType.VARIABLE_AGGREGATOR: VariableAggregatorNode,
    NodeType.LOOP:            LoopNode,
    NodeType.ITERATION:       IterationNode,
    NodeType.PARAMETER_EXTRACTOR: ParameterExtractorNode,
    NodeType.CONVERSATION_VARIABLE_ASSIGNER: ConversationVariableAssignerNode,
    NodeType.DOCUMENT_EXTRACTOR: DocumentExtractorNode,
}

class DifyNodeFactory:
    @staticmethod
    def create_node(node_type: NodeType, config: dict) -> BaseNode:
        node_class = NODE_TYPE_CLASSES_MAPPING.get(node_type)
        if not node_class:
            raise ValueError(f"Unknown node type: {node_type}")
        return node_class(config=config)
```

### 4.4 节点执行模型

```python
# core/workflow/nodes/base/node.py
class BaseNode(ABC):
    node_id: str
    node_data: BaseNodeData
    graph_init_params: GraphInitParams
    graph_runtime_state: GraphRuntimeState

    @abstractmethod
    def _run(self) -> NodeRunResult:
        """子类实现具体执行逻辑"""
        ...

    def run(self) -> NodeRunResult:
        """模板方法：前置检查 → 执行 → 后置处理"""
        self._check_inputs()
        result = self._run()
        self._publish_to_variable_pool(result)
        return result

# LLM 节点示例
class LLMNode(BaseNode):
    def _run(self) -> NodeRunResult:
        # 1. 从变量池获取输入
        prompt_messages = self._build_prompt_messages()
        # 2. 调用 LLM
        model_instance = self._get_model_instance()
        invoke_result = model_instance.invoke(prompt_messages)
        # 3. 返回结构化结果
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"text": invoke_result.message.content},
            llm_usage=invoke_result.usage,
        )
```

### 4.5 变量池（Variable Pool）

```
变量池是 Dify Workflow 的核心状态容器：

  VariablePool
  ├── user_inputs: {key: value}          // 用户输入
  ├── node_outputs: {node_id: {key: val}} // 各节点输出
  └── system_vars: {conversation_id, ...} // 系统变量

  引用语法：{{node_id.output_key}}
  例：{{llm_1.text}} 引用 LLM 节点 llm_1 的 text 输出
```

---

## 5. Agent 设计模式

### 5.1 Planning 模式对比

#### ReAct（在线规划）

```
┌─────────────────────────────────────────────────────┐
│  ReAct：交错推理与行动（Online Planning）              │
│                                                     │
│  Thought1 → Action1 → Obs1                         │
│                 ↓ (基于 Obs1 重新规划)                │
│  Thought2 → Action2 → Obs2                         │
│                 ↓                                   │
│  Thought3 → Final Answer                           │
│                                                     │
│  优点：灵活自适应，错误可恢复                          │
│  缺点：短视，无长程规划                               │
└─────────────────────────────────────────────────────┘
```

#### Plan-and-Solve（离线规划）

```
┌─────────────────────────────────────────────────────┐
│  Plan-and-Solve：先规划后执行（Offline Planning）     │
│                                                     │
│  Step 1: Planner LLM                               │
│    → Plan: [Step1, Step2, Step3, ...]               │
│                                                     │
│  Step 2: Executor                                  │
│    → Execute Step1 → Execute Step2 → ...            │
│                                                     │
│  Step 3: Summarizer                                │
│    → Final Answer                                   │
│                                                     │
│  优点：全局视角，适合复杂长任务                         │
│  缺点：计划刚性，难以应对中途变化                       │
└─────────────────────────────────────────────────────┘
```

**LangGraph 实现 Plan-and-Solve**：

```python
class PlanAndSolveState(TypedDict):
    task: str
    plan: List[str]
    current_step: int
    results: List[str]
    final_answer: str

def planner(state: PlanAndSolveState) -> dict:
    """生成执行计划"""
    plan_prompt = f"为以下任务制定步骤计划：{state['task']}"
    plan_text = llm.invoke(plan_prompt).content
    steps = parse_plan(plan_text)  # 解析为 list
    return {"plan": steps, "current_step": 0}

def executor(state: PlanAndSolveState) -> dict:
    """执行当前步骤"""
    step = state["plan"][state["current_step"]]
    result = execute_step(step, context=state["results"])
    return {
        "results": state["results"] + [result],
        "current_step": state["current_step"] + 1,
    }

def should_continue_plan(state: PlanAndSolveState) -> str:
    if state["current_step"] >= len(state["plan"]):
        return "summarize"
    return "execute"

workflow = StateGraph(PlanAndSolveState)
workflow.add_node("plan", planner)
workflow.add_node("execute", executor)
workflow.add_node("summarize", summarizer)
workflow.set_entry_point("plan")
workflow.add_edge("plan", "execute")
workflow.add_conditional_edges("execute", should_continue_plan)
workflow.add_edge("summarize", END)
```

### 5.2 Reflection 模式（Reflexion）

Reflexion 通过**语言强化**让 Agent 从失败中学习，核心机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    Reflexion Architecture                   │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │  Actor   │───▶│ Evaluator│───▶│  Self-Reflection LLM │  │
│  │ (ReAct)  │    │(外部/LLM)│    │  "我哪里做错了？"      │  │
│  └──────────┘    └──────────┘    └──────────┬────────────┘  │
│       ▲                                      │               │
│       └──────────────────────────────────────┘               │
│                  Verbal Reinforcement                         │
│              (反思存入 episodic memory)                        │
└─────────────────────────────────────────────────────────────┘
```

```python
# Reflexion 核心循环（LangGraph 实现）
class ReflexionState(TypedDict):
    task: str
    attempts: List[str]          # 历史尝试
    reflections: List[str]       # 反思记录
    current_attempt: str
    score: float
    max_attempts: int

def reflect(state: ReflexionState) -> dict:
    """生成反思文本"""
    reflection_prompt = f"""
    任务：{state['task']}
    上次尝试：{state['current_attempt']}
    评分：{state['score']}
    
    请分析失败原因，并提出改进策略：
    """
    reflection = llm.invoke(reflection_prompt).content
    return {"reflections": state["reflections"] + [reflection]}

def actor_with_reflection(state: ReflexionState) -> dict:
    """结合反思历史重新尝试"""
    context = "\n".join([
        f"反思{i+1}: {r}"
        for i, r in enumerate(state["reflections"])
    ])
    attempt = react_agent.invoke({
        "task": state["task"],
        "reflection_context": context,
    })
    return {"current_attempt": attempt, "attempts": state["attempts"] + [attempt]}
```

### 5.3 Multi-Agent 协作模式

#### Supervisor 模式

```
┌──────────────────────────────────────────────────────────────┐
│                     Supervisor Pattern                        │
│                                                              │
│                    ┌─────────────┐                           │
│                    │  Supervisor │◀─── 用户输入               │
│                    │     LLM     │                           │
│                    └──────┬──────┘                           │
│           ┌───────────────┼───────────────┐                  │
│           ▼               ▼               ▼                  │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│    │  Researcher│  │   Coder    │  │  Reviewer  │           │
│    │   Agent    │  │   Agent    │  │   Agent    │           │
│    └────────────┘  └────────────┘  └────────────┘           │
│           │               │               │                  │
│           └───────────────┴───────────────┘                  │
│                           ▼                                  │
│                    ┌─────────────┐                           │
│                    │  Supervisor │ 汇总结果 → 最终输出         │
│                    └─────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

```python
# LangGraph Supervisor 实现
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

members = ["researcher", "coder", "reviewer"]
system_prompt = f"""
You are a supervisor managing these workers: {members}.
Given the user request, decide which worker to call next.
When task is complete, respond with FINISH.
"""

def supervisor_agent(state):
    supervisor_chain = (
        ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="messages"),
            ("human", "Next worker? (options: {options} | FINISH)")
        ])
        | llm.with_structured_output(RouteResponse)
    )
    return supervisor_chain.invoke(state)
```

---

## 6. microsoft/autogen 内部机制

### 6.1 ConversableAgent 架构

```
ConversableAgent
├── name: str
├── system_message: str
├── llm_config: Optional[dict]       # None → 不调用 LLM
├── human_input_mode: str            # ALWAYS / TERMINATE / NEVER
├── code_execution_config: dict      # 代码执行环境
├── function_map: Dict[str, Callable] # 工具函数注册表
│
├── initiate_chat(recipient, message) → 启动对话
├── receive(message, sender)         → 接收消息并决策
├── generate_reply(messages, sender) → 生成回复
└── _generate_oai_reply()           → 调用 OpenAI API
```

**消息路由机制**：

```python
# autogen/agentchat/conversable_agent.py (简化)
class ConversableAgent:

    def receive(self, message, sender, request_reply=None):
        """收到消息后的处理逻辑"""
        self._process_received_message(message, sender)

        # 判断是否需要回复
        if request_reply is False:
            return

        reply = self.generate_reply(
            messages=self.chat_messages[sender],
            sender=sender
        )
        if reply is not None:
            self.send(reply, sender)

    def generate_reply(self, messages, sender):
        """按优先级尝试各种回复生成策略"""
        for reply_func_tuple in self._reply_func_list:
            reply_func = reply_func_tuple["reply_func"]
            final, reply = reply_func(self, messages, sender)
            if final:
                return reply
        return self._default_auto_reply

    # 回复函数注册（按优先级排序）
    # 1. check_termination_and_human_reply  (检查终止条件 / 请求人工输入)
    # 2. generate_function_call_reply       (执行函数调用)
    # 3. generate_code_execution_reply      (执行代码块)
    # 4. generate_oai_reply                 (调用 LLM)
```

### 6.2 GroupChat 实现

```python
# autogen/agentchat/groupchat.py
class GroupChat:
    agents: List[Agent]
    messages: List[Dict]
    max_round: int
    speaker_selection_method: str  # "auto" | "round_robin" | "random" | callable

    def select_speaker(self, last_speaker: Agent, selector: ConversableAgent) -> Agent:
        """由 GroupChatManager（也是 LLM）决定下一个发言者"""
        if self.speaker_selection_method == "auto":
            # 构造 prompt，列出所有 agent 名称
            # 让 selector LLM 选择最适合的下一个发言者
            agents_str = ", ".join([a.name for a in self.agents])
            prompt = f"以下 agents: {agents_str}\n下一个应该发言的是？"
            response = selector.generate_oai_reply(
                messages=[{"role": "user", "content": prompt}]
            )
            # 解析 response 中的 agent 名称
            return self._find_agent_by_name(response)
        elif self.speaker_selection_method == "round_robin":
            idx = self.agents.index(last_speaker)
            return self.agents[(idx + 1) % len(self.agents)]


class GroupChatManager(ConversableAgent):
    """GroupChat 的协调器，本身也是一个 ConversableAgent"""
    groupchat: GroupChat

    def run_chat(self, messages, sender, config):
        """执行 GroupChat 主循环"""
        for _ in range(self.groupchat.max_round):
            # 选择下一个发言者
            speaker = self.groupchat.select_speaker(
                last_speaker=speaker,
                selector=self
            )
            # 让该 agent 生成回复
            reply = speaker.generate_reply(
                messages=self.groupchat.messages,
                sender=self
            )
            # 广播消息给所有 agent
            self.groupchat.messages.append({
                "role": "user",
                "name": speaker.name,
                "content": reply
            })
            # 检查终止条件
            if self._is_termination_msg(reply):
                break
```

### 6.3 AutoGen GroupChat 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                     AutoGen GroupChat                            │
│                                                                  │
│  User ──▶ UserProxyAgent ──▶ GroupChatManager                    │
│                                      │                           │
│                           ┌──────────┴──────────┐               │
│                           │    GroupChat         │               │
│                           │  messages: [...]     │               │
│                           │  agents: [A, B, C]  │               │
│                           └──────────┬──────────┘               │
│                                      │                           │
│                    select_speaker()  │  (LLM 决策)               │
│                                      │                           │
│          ┌───────────────────────────┼───────────────────┐       │
│          ▼                           ▼                   ▼       │
│   ┌────────────┐             ┌────────────┐       ┌────────────┐ │
│   │  Assistant │             │  Coder     │       │  Critic    │ │
│   │   Agent    │             │  Agent     │       │   Agent    │ │
│   │(llm_config)│             │(code exec) │       │(llm_config)│ │
│   └────────────┘             └────────────┘       └────────────┘ │
│                                                                  │
│  消息广播：每个 agent 发言后，消息同步到所有 agent 的上下文            │
└──────────────────────────────────────────────────────────────────┘
```

### 6.4 代码执行沙箱

```python
# AutoGen 代码执行（Docker 隔离）
code_execution_config = {
    "executor": DockerCommandLineCodeExecutor(
        image="python:3.11-slim",
        timeout=30,
        work_dir="./workspace",
    )
}

user_proxy = UserProxyAgent(
    name="user_proxy",
    code_execution_config=code_execution_config,
    human_input_mode="NEVER",  # 自动执行代码
)

# 代码提取正则：```python ... ``` 或 ```sh ... ```
CODE_BLOCK_PATTERN = r"```(\w+)\n(.*?)```"
```

---

## 7. 框架横向对比

### 7.1 综合对比表

| 维度 | LangChain (AgentExecutor) | LangGraph | AutoGen | Dify |
|------|--------------------------|-----------|---------|------|
| **编程模型** | 链式 (Chain) | 状态图 (StateGraph) | 多智能体消息传递 | 可视化节点图 |
| **状态管理** | 无内置持久化 | Checkpointer（可插拔） | 内存 (messages list) | 数据库持久化 |
| **并发支持** | 单线程（async 支持） | 并行分支 (fan-out) | 多 agent 并发 | 线程池 |
| **循环/迭代** | max_iterations 截断 | 图中显式循环边 | max_round | 循环节点 |
| **人工介入** | 工具中实现 | interrupt_before/after | human_input_mode | 人工审批节点 |
| **多智能体** | 需手工实现 | 多图组合 | 原生 GroupChat | 不直接支持 |
| **可视化** | 无 | Mermaid 导出 | 无 | 原生 GUI |
| **代码执行** | 工具实现 | 工具实现 | 原生沙箱 | Code 节点 |
| **适用场景** | 快速原型 | 复杂工作流 | 多智能体协作 | 低代码平台 |
| **学习曲线** | 低 | 中 | 中 | 低（GUI） |

### 7.2 性能特征对比

```
延迟（单次 ReAct 循环，3步）
LangChain AgentExecutor:  ~1.2s overhead（纯 Python 调度）
LangGraph:                ~0.8s overhead（编译优化 + 并行）
AutoGen:                  ~1.5s overhead（消息序列化）
Dify:                     ~2.0s overhead（HTTP API + DB）

可扩展性
LangChain: 单进程，适合 < 100 QPS
LangGraph: 支持分布式 checkpointer（Redis/PostgreSQL）
AutoGen:   单进程，大 GroupChat 会有瓶颈
Dify:      横向扩展，Worker 队列（Celery）
```

### 7.3 选型决策树

```
是否需要可视化编辑？
    ├── 是 → Dify
    └── 否
          ├── 是否需要多智能体对话协作？
          │       ├── 是 → AutoGen
          │       └── 否
          │             ├── 是否需要复杂状态管理/循环/并行？
          │             │       ├── 是 → LangGraph
          │             │       └── 否 → LangChain AgentExecutor
```

---

## 8. 工程实践与选型建议

### 8.1 生产环境 LangGraph 配置

```python
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg_pool import ConnectionPool

# 生产环境：使用 PostgreSQL checkpointer
pool = ConnectionPool(conninfo="postgresql://user:pass@host/db")
checkpointer = PostgresSaver(pool)
checkpointer.setup()  # 创建所需表结构

graph = workflow.compile(checkpointer=checkpointer)

# 配置超时与重试
config = {
    "configurable": {"thread_id": session_id},
    "recursion_limit": 50,      # 防止无限循环
    "timeout": 120,             # 秒
}
```

### 8.2 错误处理与容错

```python
# LangGraph 错误处理
def safe_tool_node(state: AgentState) -> dict:
    try:
        result = tool.invoke(state["tool_input"])
        return {"messages": [ToolMessage(content=result, ...)]}
    except Exception as e:
        # 将错误信息作为 ToolMessage 返回，让 Agent 自行决策
        return {"messages": [ToolMessage(
            content=f"工具执行失败: {str(e)}，请调整参数重试",
            tool_call_id=...,
        )]}

# AutoGen 超时处理
user_proxy = UserProxyAgent(
    name="user_proxy",
    max_consecutive_auto_reply=10,  # 防止无限循环
    is_termination_msg=lambda x: x.get("content", "").find("TERMINATE") >= 0,
)
```

### 8.3 Token 优化策略

```python
# 1. 消息历史裁剪（避免上下文过长）
from langchain_core.messages import trim_messages

trimmer = trim_messages(
    max_tokens=4096,
    strategy="last",           # 保留最新消息
    token_counter=llm,
    include_system=True,
    allow_partial=False,
)

# 2. 工具描述压缩
def compress_tool_description(tool: BaseTool) -> str:
    """使用 LLM 压缩工具描述，减少 prompt token"""
    ...

# 3. 中间步骤摘要
def summarize_intermediate_steps(steps: List) -> str:
    """当步骤过多时，摘要早期步骤"""
    if len(steps) > 5:
        summary = llm.invoke(f"摘要以下步骤：{steps[:3]}")
        return summary.content + str(steps[3:])
    return format_log_to_str(steps)
```

### 8.4 可观测性集成

```python
# LangSmith 集成（LangChain 官方可观测平台）
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-key"
os.environ["LANGCHAIN_PROJECT"] = "my-agent"

# 自定义回调
from langchain_core.callbacks import BaseCallbackHandler

class TokenCostTracker(BaseCallbackHandler):
    def on_llm_end(self, response, **kwargs):
        usage = response.llm_output.get("token_usage", {})
        total = usage.get("total_tokens", 0)
        cost = total * 0.00003  # gpt-4o pricing
        logger.info(f"Token cost: ${cost:.6f}")

# AutoGen 日志
import autogen
autogen.runtime_logging.start(logger_type="sqlite", config={"dbname": "agent.db"})
```

### 8.5 最佳实践总结

| 场景 | 推荐方案 | 关键配置 |
|------|---------|---------|
| 简单 QA + 工具调用 | LangChain + ReAct | max_iterations=10, handle_parsing_errors=True |
| 复杂工作流（并行/条件） | LangGraph | PostgresSaver, interrupt_before 人工审批 |
| 多 Agent 代码生成 | AutoGen GroupChat | DockerExecutor, max_round=20 |
| 企业低代码平台 | Dify | Workflow + Knowledge Base + API |
| 长任务 + 持久化记忆 | LangGraph + Redis | MemorySaver → RedisSaver，thread_id 管理 |

---

## 9. Agent-to-Agent (A2A) 通信协议

### 9.1 为什么需要 A2A

在前面的章节中，我们讨论了 LangGraph、AutoGen、Dify 等框架如何在**框架内部**编排多个 Agent。但现实世界中，一个企业往往有多个团队，各自用不同的框架构建了自己的 Agent 系统——市场部用 Dify 搭了客户分析 Agent，工程团队用 LangGraph 做了代码审查 Agent，运维团队用 AutoGen 做了故障排查 Agent。

**问题来了**：这些 Agent 如何跨框架协作？

> **类比：联合国外交协议** 🌍
>
> 想象联合国大会：每个国家有自己的语言、文化和决策流程（相当于不同的 Agent 框架）。要让各国代表有效协作，需要：
> 1. **通用外交协议**——所有国家都遵循的沟通格式（A2A 协议）
> 2. **国家名片**——每个国家的代表公开自己的能力和职责（Agent Card）
> 3. **议题流程**——从提出议题到达成决议的标准流程（Task 生命周期）
> 4. **翻译服务**——不同语言之间的转换（消息格式标准化）
>
> 而联合国的翻译设备、会议室的麦克风和投影仪？那是 MCP（Model Context Protocol）管的——**工具层**的事。

#### 与 MCP 的本质区别

这是一个高频混淆点，值得在一开始就厘清：

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Agent 通信生态                                │
│                                                                      │
│  ┌─────────────────┐     A2A 协议      ┌─────────────────┐          │
│  │   Agent A        │◄════════════════►│   Agent B        │          │
│  │ (LangGraph)      │   Agent 间通信   │ (AutoGen)        │          │
│  │                  │  能力发现/任务协商 │                  │          │
│  └──────┬───────────┘                  └──────┬───────────┘          │
│         │ MCP                                 │ MCP                  │
│         ▼                                     ▼                      │
│  ┌─────────────┐                       ┌─────────────┐              │
│  │  Tools       │                       │  Tools       │              │
│  │  数据库/API   │                       │  搜索/文件   │              │
│  └─────────────┘                       └─────────────┘              │
│                                                                      │
│  MCP = Agent 如何使用工具（人 ↔ 工具）                                │
│  A2A = Agent 如何找到并与其他 Agent 对话（人 ↔ 人）                    │
└──────────────────────────────────────────────────────────────────────┘
```

一句话总结：**MCP 管的是 Agent 与工具之间的"手脚"，A2A 管的是 Agent 与 Agent 之间的"对话"。**

### 9.2 A2A 协议核心设计

A2A（Agent-to-Agent）协议由 Google 于 2025 年提出，定义了异构 Agent 系统之间的通信标准。其核心由三个组件构成：

#### Agent Card（能力声明）

每个 Agent 通过一个 JSON 格式的 Agent Card 声明自己的身份和能力，类似于 Web 服务的 OpenAPI 文档：

```json
{
  "name": "code-review-agent",
  "description": "审查代码变更，检查安全漏洞和代码质量",
  "url": "https://agents.company.com/code-reviewer",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "security-audit",
      "name": "安全审计",
      "description": "检查代码中的安全漏洞（SQL注入、XSS、SSRF等）",
      "inputModes": ["text", "file"],
      "outputModes": ["text"]
    },
    {
      "id": "style-check",
      "name": "代码风格检查",
      "description": "检查代码是否符合团队编码规范",
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

Agent Card 通常托管在 `/.well-known/agent.json` 路径下，便于其他 Agent 通过标准 HTTP 请求发现。

#### Task 生命周期

A2A 中的核心交互单位是 **Task**（任务）。一个 Task 的完整生命周期如下：

```
┌──────────────────────────────────────────────────────────┐
│                   Task 生命周期                           │
│                                                          │
│  submitted ──► working ──► completed                     │
│                  │  ▲           │                         │
│                  │  │           ▼                         │
│                  │  └─── input-required                   │
│                  │       (需要更多输入)                    │
│                  │                                        │
│                  ├──► failed (执行失败)                    │
│                  └──► canceled (被取消)                    │
│                                                          │
│  关键特性：                                               │
│  • 每个 Task 有唯一 ID，支持异步轮询                       │
│  • 支持长时间运行的任务（分钟到小时级别）                   │
│  • 支持 SSE 流式推送中间结果                               │
└──────────────────────────────────────────────────────────┘
```

#### 消息与 Artifact

Task 中的通信通过 **Message**（消息）和 **Artifact**（产物）两种结构进行：

```python
# 消息：Agent 之间的对话交互
message = {
    "role": "user",  # 或 "agent"
    "parts": [
        {"type": "text", "text": "请审查这个 PR 的安全性"},
        {"type": "file", "file": {"name": "diff.patch", "mimeType": "text/plain", "bytes": "..."}}
    ]
}

# Artifact：任务的最终产出物（区别于中间对话）
artifact = {
    "name": "security-report",
    "description": "安全审计报告",
    "parts": [
        {"type": "text", "text": "## 审计结果\n未发现高危漏洞，2个中危问题..."}
    ]
}
```

**Message 与 Artifact 的区别**：Message 是过程中的对话（"你看看这个文件"），Artifact 是最终产出（"这是审计报告"）。就像会议中的发言（Message）和会议纪要（Artifact）。

### 9.3 服务发现与能力匹配

在大规模系统中，Agent 需要动态发现其他 Agent 并匹配能力。常见模式有两种：

```
方式一：静态注册（适合小规模）
┌──────────────────────────────────┐
│         Agent Registry           │
│  ┌────────────────────────────┐  │
│  │ code-reviewer → url_1      │  │
│  │ data-analyst  → url_2      │  │
│  │ qa-tester     → url_3      │  │
│  └────────────────────────────┘  │
│  • 手动维护 Agent 列表            │
│  • 适合 < 20 个 Agent 的场景      │
└──────────────────────────────────┘

方式二：动态发现（适合大规模）
┌──────────────────────────────────┐
│         Discovery Service         │
│  1. Agent 启动时自动注册           │
│  2. 定期健康检查，剔除失效 Agent   │
│  3. 按 skill 语义搜索匹配能力      │
│  4. 负载均衡：多个同能力 Agent 分流 │
└──────────────────────────────────┘
```

```python
# 伪代码：基于 A2A 的服务发现与任务委派
import httpx

async def discover_and_delegate(task_description: str):
    # 1. 从注册中心获取所有 Agent Card
    registry_url = "https://agent-registry.internal/agents"
    agents = httpx.get(registry_url).json()

    # 2. 匹配能力：找到技能描述与任务最相关的 Agent
    best_match = None
    best_score = 0
    for agent in agents:
        for skill in agent["skills"]:
            score = semantic_similarity(task_description, skill["description"])
            if score > best_score:
                best_score = score
                best_match = agent

    # 3. 向目标 Agent 发送任务
    task_response = httpx.post(
        f"{best_match['url']}/tasks",
        json={
            "message": {
                "role": "user",
                "parts": [{"type": "text", "text": task_description}]
            }
        }
    )
    task_id = task_response.json()["id"]

    # 4. 轮询任务状态（也可用 SSE 流式获取）
    while True:
        status = httpx.get(f"{best_match['url']}/tasks/{task_id}").json()
        if status["status"]["state"] in ("completed", "failed"):
            return status
        await asyncio.sleep(2)
```

### 9.4 异构 Agent 互操作

A2A 的最大价值在于让不同框架构建的 Agent 能无缝协作。以下是一个典型场景：

```
用户请求："分析上周的服务器故障，生成修复方案，并创建 Jira 工单"

┌──────────────────────────────────────────────────────────────┐
│                    A2A 跨框架协作                              │
│                                                              │
│  ┌─────────────┐   A2A    ┌─────────────┐   A2A    ┌────────┐│
│  │ 故障分析Agent│ ═══════► │ 方案生成Agent│ ═══════► │工单Agent││
│  │ (AutoGen)    │         │ (LangGraph) │         │ (Dify) ││
│  │              │         │             │         │        ││
│  │ • 日志分析   │         │ • 方案规划  │         │• Jira  ││
│  │ • 根因定位   │         │ • 代码修复  │         │  集成  ││
│  └─────────────┘         └─────────────┘         └────────┘│
│        ▲                       ▲                      ▲     │
│        │ MCP                   │ MCP                  │ MCP │
│   ┌─────────┐            ┌─────────┐           ┌─────────┐ │
│   │ELK/Prom │            │ GitHub  │           │Jira API │ │
│   └─────────┘            └─────────┘           └─────────┘ │
└──────────────────────────────────────────────────────────────┘

每个 Agent 由不同团队用不同框架构建，
但通过 A2A 协议实现标准化通信。
```

**关键要点**：A2A 不替代任何框架，而是在框架**之上**提供互操作层。就像 HTTP 不关心你的服务器用 Java 还是 Python 实现，A2A 不关心你的 Agent 用 LangGraph 还是 AutoGen 构建。

---

## 10. Agent 评估体系

### 10.1 为什么 Agent 评估很难

评估一个传统软件系统相对简单：输入 A，预期输出 B，实际输出是否等于 B？但 Agent 系统的评估面临根本性挑战：

> **类比：评价一个实习生** 👩‍💼
>
> 你让实习生"调研竞品并写一份分析报告"。你无法简单地和一个"标准答案"对比，因为：
> 1. **路径多样性**——他可能先看官网再看评测，也可能先看用户评价再看技术文档，不同路径都可能得出好结果
> 2. **输出非确定性**——同样的任务做两次，报告结构和措辞都会不同
> 3. **级联效应**——如果第一步的调研方向错了，后面所有分析都会跑偏
> 4. **成本考量**——花 3 天做出 90 分的报告，和花 1 天做出 80 分的报告，哪个更好？

Agent 评估的核心难题总结：

| 挑战 | 描述 | 传统软件类比 |
|------|------|------------|
| **非确定性输出** | 同样的输入，每次输出不同 | 函数对相同参数返回不同值 |
| **多步骤级联误差** | 早期错误在后续步骤中放大 | 流水线中间环节出错导致最终结果偏差 |
| **路径等价性** | 不同执行路径可能同样有效 | 单元测试只验证一种正确路径 |
| **主观评估** | "好的回答"缺乏客观标准 | 需求文档模糊时无法写精确断言 |
| **成本-质量权衡** | 更多步骤/更强模型 = 更好但更贵 | 性能优化 vs 资源消耗的平衡 |

### 10.2 评估维度

一个全面的 Agent 评估框架应覆盖以下维度：

```
┌──────────────────────────────────────────────────────────┐
│                   Agent 评估金字塔                        │
│                                                          │
│                    ┌──────────┐                          │
│                    │ 业务价值 │  ← 最终目标               │
│                    │ (ROI)    │                          │
│                 ┌──┴──────────┴──┐                       │
│                 │  任务完成质量    │  ← 结果正确吗？        │
│                 │ (Accuracy)     │                       │
│              ┌──┴────────────────┴──┐                    │
│              │   执行效率 (Efficiency)│ ← 花了多少步/Token？│
│           ┌──┴──────────────────────┴──┐                 │
│           │  工具使用准确性 (Tool Use)    │ ← 调对工具了吗？ │
│        ┌──┴──────────────────────────────┴──┐            │
│        │     安全与合规 (Safety & Compliance)  │ ← 有风险吗│
│        └───────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

```python
# 评估指标定义示例
class AgentEvalMetrics:
    """Agent 评估指标体系"""

    # 1. 任务完成率（最核心指标）
    task_success_rate: float        # 成功完成的任务占总任务的比例

    # 2. 步骤效率
    avg_steps_per_task: float       # 平均每个任务的步骤数
    optimal_step_ratio: float       # 实际步骤数 / 最优步骤数（越接近 1 越好）

    # 3. 工具使用准确性
    tool_selection_accuracy: float  # 选对工具的比例
    tool_param_accuracy: float      # 工具参数正确的比例
    unnecessary_tool_calls: int     # 不必要的工具调用次数

    # 4. 成本效率
    avg_tokens_per_task: int        # 每个任务平均消耗的 Token 数
    avg_cost_per_task: float        # 每个任务的平均 API 费用
    cost_per_success: float         # 每次成功任务的成本

    # 5. 延迟
    p50_latency: float              # 50% 的任务在此时间内完成
    p95_latency: float              # 95% 的任务在此时间内完成
    p99_latency: float              # 99% 的任务在此时间内完成
```

### 10.3 单 Agent 评估：基准测试

当前主流的 Agent 基准测试各有侧重：

| 基准测试 | 评估内容 | 典型任务示例 | 评估方式 |
|----------|---------|-------------|---------|
| **SWE-bench** | 软件工程能力 | 修复真实 GitHub Issue | 自动化：运行测试套件验证 |
| **GAIA** | 通用 AI 助手能力 | 多步推理 + 工具使用 | 精确匹配最终答案 |
| **AgentBench** | 多环境交互能力 | 操作数据库、网页、命令行 | 环境状态验证 |
| **WebArena** | 网页操作能力 | 在真实网站上完成任务 | 页面状态 + 功能验证 |
| **HumanEval** | 代码生成能力 | 函数级代码补全 | 自动化测试用例 |
| **MINT** | 多轮工具使用 | 需要多次工具调用的推理任务 | 最终答案验证 |

```python
# SWE-bench 风格的评估流程
def evaluate_agent_on_swe_bench(agent, test_cases: list) -> dict:
    results = {"pass": 0, "fail": 0, "error": 0}

    for case in test_cases:
        # 1. 检出代码到问题出现前的 commit
        repo = checkout_repo(case["repo"], case["base_commit"])

        # 2. 给 Agent 展示 Issue 描述，让它修复
        patch = agent.solve(
            issue_description=case["problem_statement"],
            repo_path=repo.path
        )

        # 3. 应用 Agent 生成的补丁
        apply_patch(repo, patch)

        # 4. 运行该项目的测试套件验证修复是否正确
        test_result = run_tests(repo, case["test_patch"])
        if test_result.all_passed:
            results["pass"] += 1
        else:
            results["fail"] += 1

    results["pass_rate"] = results["pass"] / len(test_cases)
    return results
```

### 10.4 多 Agent 评估

多 Agent 系统引入了额外的评估维度——不仅要看个体表现，还要看团队协作效率：

```
单 Agent 评估                    多 Agent 额外评估维度
┌──────────────┐               ┌──────────────────────────┐
│ • 任务完成率  │               │ • 协作效率               │
│ • 步骤数     │               │   几轮对话达成共识？      │
│ • Token 用量 │               │ • 通信开销               │
│ • 延迟       │               │   Agent 间传递了多少消息？ │
│              │               │ • 冗余计算               │
│              │               │   多个 Agent 重复做了同样  │
│              │               │   的工作吗？              │
│              │               │ • 角色分工合理性           │
│              │               │   每个 Agent 是否在做自己  │
│              │               │   擅长的事？              │
└──────────────┘               └──────────────────────────┘
```

```python
# 多 Agent 协作效率评估
class MultiAgentMetrics:
    # 通信效率
    total_messages: int              # Agent 间总消息数
    messages_per_task: float         # 每个任务的平均消息数
    avg_message_length: int          # 平均消息长度（Token）

    # 冗余度
    redundant_tool_calls: int        # 被多个 Agent 重复执行的工具调用
    duplicate_reasoning: float       # 推理内容重叠率（0-1）

    # 收敛性
    rounds_to_consensus: int         # 达成共识所需的对话轮数
    deadlock_count: int              # 出现死锁/循环争论的次数

    # 对比基线
    speedup_vs_single: float         # 相比单 Agent 的加速比
    cost_ratio_vs_single: float      # 相比单 Agent 的成本比
```

### 10.5 LLM-as-Judge：自动评估与局限

人工评估准确但昂贵，自动化指标又难以捕捉"回答质量"。**LLM-as-Judge** 是一种折中方案——用一个强 LLM 来评判 Agent 的输出质量：

```python
# LLM-as-Judge 评估模板
JUDGE_PROMPT = """你是一个专业的 AI Agent 输出质量评估员。

## 任务描述
{task_description}

## Agent 的执行轨迹
{agent_trajectory}

## Agent 的最终输出
{agent_output}

## 评估维度（每个维度 1-5 分）
1. **正确性**：输出是否正确回答了用户问题？
2. **完整性**：是否遗漏了关键信息？
3. **效率**：执行步骤是否合理，有无冗余？
4. **安全性**：是否有不当操作或信息泄露风险？

请按以下 JSON 格式输出评估结果：
{{"correctness": int, "completeness": int, "efficiency": int, "safety": int, "reasoning": str}}
"""

# LLM-as-Judge 的已知局限
# ❌ 位置偏差：倾向于给排在前面的选项更高分
# ❌ 自我偏好：GPT-4 倾向于给 GPT-4 的输出更高分
# ❌ 长度偏差：倾向于给更长的回答更高分
# ✅ 缓解方法：多次评估取平均、随机化顺序、使用多个 Judge 模型
```

### 10.6 生产环境持续监控

评估不只是上线前的一次性工作。Agent 在生产环境中需要持续监控：

```python
# 生产环境 Agent 性能监控看板的核心指标
PRODUCTION_METRICS = {
    "实时指标": {
        "success_rate_1h": "过去 1 小时任务成功率",
        "p95_latency_1h": "过去 1 小时 P95 延迟",
        "error_rate_1h": "过去 1 小时错误率",
        "active_tasks": "当前进行中的任务数",
    },
    "趋势指标": {
        "daily_success_rate": "每日成功率趋势（7 天/30 天）",
        "daily_avg_cost": "每日平均成本趋势",
        "daily_token_usage": "每日 Token 用量趋势",
    },
    "告警规则": {
        "success_rate < 0.85": "🔴 紧急：成功率低于 85%",
        "p95_latency > 30s": "🟡 警告：P95 延迟超过 30 秒",
        "hourly_cost > $50": "🟡 警告：小时成本超过预算",
        "error_rate > 0.1": "🔴 紧急：错误率超过 10%",
    }
}
```

---

## 11. 可观测性最佳实践

> 前面 8.4 节介绍了如何用 LangSmith 等工具做基础集成。本节从**架构原理**出发，系统讲解 Agent 可观测性的设计理念和实践方法。

### 11.1 Agent 可观测性的三大支柱

> **类比：医院的病人监护系统** 🏥
>
> ICU 里监护一个病人需要三类信息：
> 1. **生命体征曲线**（Metrics 指标）——心率、血压、血氧的实时数值
> 2. **病历记录**（Logs 日志）——护士每小时记录的观察笔记
> 3. **诊疗流程追踪**（Traces 链路）——从挂号到出院的完整诊疗过程
>
> Agent 的可观测性同理：你需要**看到数字**（Metrics）、**读到细节**（Logs）、**追踪因果**（Traces）。

```
┌──────────────────────────────────────────────────────────────┐
│                Agent 可观测性三大支柱                          │
│                                                              │
│  ┌─────────────────┐                                         │
│  │     Traces       │  "发生了什么，顺序是怎样的？"             │
│  │   (分布式链路)    │  • 完整的 Agent 执行过程                 │
│  │                  │  • 每个 LLM 调用、工具调用的耗时和结果     │
│  │                  │  • 因果关系：是哪一步导致了最终结果         │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │     Metrics      │  "系统表现如何？"                        │
│  │    (聚合指标)     │  • Token 用量、延迟分布、成功率           │
│  │                  │  • 实时告警：当指标异常时立即通知           │
│  │                  │  • 趋势分析：性能是在改善还是恶化           │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐                                         │
│  │      Logs        │  "具体发生了什么？"                      │
│  │   (结构化日志)    │  • Agent 的推理过程（Thought）           │
│  │                  │  • 错误详情和堆栈                        │
│  │                  │  • 用于事后分析和调试                     │
│  └─────────────────┘                                         │
└──────────────────────────────────────────────────────────────┘
```

### 11.2 分布式链路追踪：Span 设计

Agent 的执行过程天然适合用分布式追踪来表示。关键是设计合理的 **Span 层次**：

```
Trace: "用户请求 → Agent 完成任务"
│
├── Span: agent_run (总耗时: 8.2s, 总 Token: 3,450)
│   │
│   ├── Span: llm_call_1 (思考阶段)
│   │   ├── model: gpt-4o
│   │   ├── input_tokens: 520
│   │   ├── output_tokens: 180
│   │   ├── latency: 1.2s
│   │   └── decision: "需要查询数据库"
│   │
│   ├── Span: tool_call_1 (执行阶段)
│   │   ├── tool: sql_query
│   │   ├── input: "SELECT * FROM orders WHERE..."
│   │   ├── output_rows: 42
│   │   ├── latency: 0.3s
│   │   └── status: success
│   │
│   ├── Span: llm_call_2 (分析阶段)
│   │   ├── model: gpt-4o
│   │   ├── input_tokens: 1,200  ← 包含工具返回结果
│   │   ├── output_tokens: 850
│   │   ├── latency: 2.8s
│   │   └── decision: "生成最终报告"
│   │
│   └── Span: llm_call_3 (输出阶段)
│       ├── model: gpt-4o-mini  ← 简单任务用小模型
│       ├── input_tokens: 300
│       ├── output_tokens: 100
│       └── latency: 0.5s
```

```python
# 使用 OpenTelemetry 为 Agent 添加链路追踪
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# 初始化
provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("agent-service")

class ObservableAgent:
    def run(self, user_input: str):
        with tracer.start_as_current_span("agent_run") as root_span:
            root_span.set_attribute("user_input", user_input)
            messages = [{"role": "user", "content": user_input}]

            for step in range(self.max_steps):
                # 每次 LLM 调用都是一个子 Span
                with tracer.start_as_current_span(f"llm_call_{step}") as llm_span:
                    response = self.llm.invoke(messages)
                    llm_span.set_attribute("model", self.llm.model_name)
                    llm_span.set_attribute("input_tokens", response.usage.prompt_tokens)
                    llm_span.set_attribute("output_tokens", response.usage.completion_tokens)

                if response.tool_calls:
                    for tool_call in response.tool_calls:
                        # 每次工具调用也是一个子 Span
                        with tracer.start_as_current_span(f"tool_{tool_call.name}") as tool_span:
                            result = self.execute_tool(tool_call)
                            tool_span.set_attribute("tool_name", tool_call.name)
                            tool_span.set_attribute("status", "success" if result.ok else "error")
                else:
                    root_span.set_attribute("total_steps", step + 1)
                    return response.content
```

### 11.3 关键指标设计

以下是 Agent 系统应追踪的核心指标，按重要程度排列：

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 核心指标体系                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tier 1: 必须监控（影响用户体验和成本）                │    │
│  │  • task_success_rate    任务成功率                    │    │
│  │  • p95_latency          端到端 P95 延迟              │    │
│  │  • total_cost_per_hour  每小时总成本                  │    │
│  │  • error_rate           错误率                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tier 2: 应该监控（辅助优化和诊断）                    │    │
│  │  • avg_steps_per_task   平均步骤数                   │    │
│  │  • token_usage_by_model 各模型 Token 用量分布         │    │
│  │  • tool_call_success    工具调用成功率                │    │
│  │  • cache_hit_rate       缓存命中率（如有）            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tier 3: 可选监控（深度分析）                          │    │
│  │  • reasoning_token_ratio  推理 Token 占比            │    │
│  │  • retry_rate             重试率                     │    │
│  │  • fallback_rate          降级率                     │    │
│  │  • user_satisfaction      用户满意度评分              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 11.4 成本追踪与预算控制

在 LLM 驱动的 Agent 系统中，成本管理至关重要。一个失控的 Agent 循环可能在几分钟内消耗数十美元：

```python
# Agent 运行成本分解追踪器
class CostTracker:
    # 各模型每百万 Token 的价格（美元，2025 年中价格）
    PRICING = {
        "gpt-4o":       {"input": 2.50,  "output": 10.00},
        "gpt-4o-mini":  {"input": 0.15,  "output": 0.60},
        "claude-sonnet": {"input": 3.00, "output": 15.00},
        "claude-haiku":  {"input": 0.25, "output": 1.25},
    }

    def __init__(self, budget_limit: float = 1.0):
        self.total_cost = 0.0
        self.budget_limit = budget_limit  # 单次运行预算上限（美元）
        self.cost_breakdown = []

    def track_llm_call(self, model: str, input_tokens: int, output_tokens: int):
        pricing = self.PRICING[model]
        cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
        self.total_cost += cost
        self.cost_breakdown.append({
            "model": model, "input_tokens": input_tokens,
            "output_tokens": output_tokens, "cost": cost
        })

        # 预算保护：超出预算时强制停止
        if self.total_cost > self.budget_limit:
            raise BudgetExceededError(
                f"Agent 运行成本 ${self.total_cost:.4f} 已超出预算 ${self.budget_limit:.2f}"
            )

    def get_report(self) -> str:
        lines = ["=== 成本分解报告 ==="]
        for i, item in enumerate(self.cost_breakdown):
            lines.append(
                f"  Step {i+1}: {item['model']} | "
                f"输入 {item['input_tokens']} + 输出 {item['output_tokens']} tokens | "
                f"${item['cost']:.6f}"
            )
        lines.append(f"  总成本: ${self.total_cost:.4f}")
        return "\n".join(lines)
```

### 11.5 调试与回放

当 Agent 在生产环境中出现异常行为时，最有效的调试方式是**回放**——完整重现 Agent 的执行过程：

```python
# Agent 运行轨迹记录与回放
import json
from datetime import datetime

class TrajectoryRecorder:
    """记录 Agent 的完整执行轨迹，支持事后回放与分析"""

    def __init__(self, run_id: str):
        self.run_id = run_id
        self.trajectory = {
            "run_id": run_id,
            "start_time": datetime.utcnow().isoformat(),
            "steps": [],
            "metadata": {}
        }

    def record_step(self, step_type: str, input_data: dict, output_data: dict,
                    duration_ms: float, tokens: dict = None):
        self.trajectory["steps"].append({
            "step_number": len(self.trajectory["steps"]) + 1,
            "type": step_type,       # "llm_call" | "tool_call" | "decision"
            "input": input_data,
            "output": output_data,
            "duration_ms": duration_ms,
            "tokens": tokens,
            "timestamp": datetime.utcnow().isoformat()
        })

    def save(self, storage_path: str):
        """保存轨迹到持久化存储（文件/S3/数据库）"""
        with open(f"{storage_path}/{self.run_id}.json", "w") as f:
            json.dump(self.trajectory, f, ensure_ascii=False, indent=2)

# 回放分析：找出失败任务中最耗时的步骤
def analyze_failure(trajectory_path: str) -> dict:
    with open(trajectory_path) as f:
        traj = json.load(f)

    analysis = {
        "total_steps": len(traj["steps"]),
        "total_duration_ms": sum(s["duration_ms"] for s in traj["steps"]),
        "slowest_step": max(traj["steps"], key=lambda s: s["duration_ms"]),
        "failed_tools": [s for s in traj["steps"]
                         if s["type"] == "tool_call" and s["output"].get("error")],
        "total_tokens": sum(
            (s.get("tokens", {}).get("total", 0)) for s in traj["steps"]
        ),
    }
    return analysis
```

### 11.6 可观测性工具选型

市面上有多种 Agent 可观测性工具，各有优劣。选型时应关注**概念契合度**而非功能堆砌：

| 维度 | Langfuse | LangSmith | Phoenix (Arize) | 自建方案 |
|------|----------|-----------|-----------------|---------|
| **核心定位** | 开源 LLM 可观测 | LangChain 生态深度集成 | ML 可观测性（含 LLM） | 完全定制化 |
| **部署方式** | 自托管 / Cloud | Cloud 为主 | 自托管 / Cloud | 自托管 |
| **Trace 查看** | ✅ 层级清晰 | ✅ 最完善 | ✅ 支持 | 按需实现 |
| **成本分析** | ✅ 内置 | ✅ 内置 | ⚠️ 需配置 | 按需实现 |
| **评估集成** | ✅ 在线评估 | ✅ 数据集+评估 | ✅ LLM 评估 | 按需实现 |
| **框架无关** | ✅ OpenTelemetry | ⚠️ LangChain 优先 | ✅ OpenTelemetry | ✅ 完全自由 |
| **数据隐私** | ✅ 可自托管 | ⚠️ 数据上传云端 | ✅ 可自托管 | ✅ 完全可控 |
| **学习成本** | 低 | 低（LangChain 用户） | 中 | 高 |

**选型建议**：

- 已用 LangChain/LangGraph → **LangSmith** 开箱即用
- 多框架混用 / 数据隐私敏感 → **Langfuse**（自托管 + OpenTelemetry）
- 已有 ML 平台基础设施 → **Phoenix** 统一 ML + LLM 监控
- 对延迟极致敏感 / 高度定制需求 → **自建**（基于 OpenTelemetry + Prometheus + Grafana）

---

## 12. Human-in-the-Loop 模式

### 12.1 为什么需要 Human-in-the-Loop

> **类比：自动驾驶的分级** 🚗
>
> 自动驾驶分为 L1-L5 五个级别，当前量产车大多在 L2-L3——系统负责日常驾驶，但在复杂路况（施工区、恶劣天气）需要人类接管。Agent 系统同理：
> - **L1 Agent**：人类做决策，Agent 辅助执行（如代码补全）
> - **L2 Agent**：Agent 做常规决策，人类监督确认（如 PR Review Agent）
> - **L3 Agent**：Agent 自主运行，异常时呼叫人类（如客服 Agent 遇到投诉升级）
> - **L4 Agent**：Agent 完全自主，只在极端情况需要人类（如自动化运维）
> - **L5 Agent**：完全自主，无需人类干预（目前尚未实现）
>
> 大多数生产系统处于 **L2-L3**，Human-in-the-Loop 是这些级别的核心机制。

Human-in-the-Loop 不是"Agent 不够聪明"的补丁，而是**系统设计中的关键安全层**。以下场景**必须**有人类参与：

- 🔴 **不可逆操作**：删除数据、发送邮件、转账支付
- 🔴 **高风险决策**：修改生产环境配置、批准大额订单
- 🟡 **模糊意图**：用户指令有歧义时，Agent 应求助而非猜测
- 🟡 **合规要求**：法律、医疗、金融领域的某些操作需人类签字

### 12.2 审批模式（Approval Gate）

最简单的 Human-in-the-Loop 模式：Agent 在关键决策点**暂停**，等待人类批准后再继续。

```
用户请求 → Agent 规划 → [审批点] → 人类确认 → Agent 执行 → 结果
                           │
                           └── 人类拒绝 → Agent 重新规划
```

```python
# LangGraph 中的审批模式实现
from langgraph.graph import StateGraph, END

def plan_node(state):
    """Agent 生成执行计划"""
    plan = llm.invoke("为以下任务生成执行计划: " + state["task"])
    return {"plan": plan.content, "status": "pending_approval"}

def execute_node(state):
    """执行已批准的计划"""
    result = execute_plan(state["plan"])
    return {"result": result, "status": "completed"}

def should_execute(state):
    """条件边：检查审批状态"""
    if state.get("approved"):
        return "execute"
    return "end"

# 构建带审批点的图
workflow = StateGraph(AgentState)
workflow.add_node("plan", plan_node)
workflow.add_node("execute", execute_node)

# 关键：interrupt_before 在执行前暂停，等待人类输入
workflow.add_conditional_edges("plan", should_execute, {
    "execute": "execute",
    "end": END
})

graph = workflow.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["execute"]  # 在 execute 节点前暂停
)

# 使用方式
config = {"configurable": {"thread_id": "task-123"}}

# 第一步：运行到审批点自动暂停
result = graph.invoke({"task": "删除过期用户数据"}, config)
print(f"待审批计划: {result['plan']}")

# 第二步：人类审批后，继续执行（可以在几秒或几天后）
graph.update_state(config, {"approved": True})
final = graph.invoke(None, config)  # 从断点继续
```

### 12.3 干预模式（Override）

比审批模式更灵活：人类可以在 Agent 运行的**任意步骤**观察并修正其方向。

```
┌────────────────────────────────────────────────────────┐
│                   干预模式流程                           │
│                                                        │
│  Agent Step 1 ──► Agent Step 2 ──► Agent Step 3       │
│       │                │                │              │
│       ▼                ▼                ▼              │
│  [人类可观察]      [人类可观察]      [人类可观察]         │
│       │                │                │              │
│       │           人类发现偏差           │              │
│       │                │                │              │
│       │                ▼                │              │
│       │         [人类修正指令]           │              │
│       │          "不要用方案A,           │              │
│       │           改用方案B"             │              │
│       │                │                │              │
│       │                ▼                │              │
│       │         Agent Step 2'           │              │
│       │         (根据修正调整)            │              │
│       │                │                │              │
│       │                ▼                │              │
│       │         Agent Step 3'           │              │
│       │         (后续步骤自适应)          │              │
└────────────────────────────────────────────────────────┘
```

```python
# 干预模式的状态机设计
class InterventionAgent:
    def run_with_intervention(self, task: str, max_steps: int = 10):
        state = {"task": task, "steps": [], "messages": []}

        for step in range(max_steps):
            # 1. Agent 执行一步
            action = self.think_and_act(state)
            state["steps"].append(action)

            # 2. 通过 WebSocket/API 推送当前状态给人类
            self.notify_human(step, action)

            # 3. 短暂等待人类干预（非阻塞，超时后自动继续）
            intervention = self.wait_for_intervention(timeout=30)

            if intervention:
                if intervention["type"] == "override":
                    # 人类修正：用人类指令替换 Agent 的下一步
                    state["messages"].append({
                        "role": "human_override",
                        "content": intervention["instruction"]
                    })
                elif intervention["type"] == "stop":
                    return {"status": "stopped_by_human", "steps": state["steps"]}

            # 4. 检查是否完成
            if action.get("finished"):
                return {"status": "completed", "steps": state["steps"]}

        return {"status": "max_steps_reached", "steps": state["steps"]}
```

### 12.4 协作模式（Co-Pilot）

人类和 Agent **交替**执行任务，各自负责自己擅长的部分。这是当前最常见的 Human-in-the-Loop 形态：

```
协作模式（以代码开发为例）：

人类：描述需求 "实现一个用户认证模块，支持 OAuth2"
  ↓
Agent：生成代码骨架和单元测试
  ↓
人类：审查代码，指出 "Token 刷新逻辑不对，应该用滑动窗口"
  ↓
Agent：修正 Token 刷新逻辑，更新相关测试
  ↓
人类：确认代码 OK，手动部署到测试环境
  ↓
Agent：运行集成测试，报告结果
  ↓
人类：确认测试通过，合并到主分支
```

**协作模式的关键设计原则**：

| 原则 | 说明 | 示例 |
|------|------|------|
| **明确分工** | 定义人类和 Agent 各自的职责边界 | Agent 写代码，人类做架构决策 |
| **上下文保持** | Agent 需要记住人类的所有反馈 | 使用 Checkpointer 持久化对话状态 |
| **主动求助** | Agent 遇到不确定时应主动问人 | "我不确定这里应该用哪种加密算法，请指导" |
| **可回退** | 人类应能撤销 Agent 的任何操作 | 基于 Checkpoint 回退到任意历史状态 |

### 12.5 实现架构：中断与恢复

所有 Human-in-the-Loop 模式的底层都依赖**状态持久化**和**中断/恢复**机制：

```
┌──────────────────────────────────────────────────────────────┐
│            Human-in-the-Loop 架构                            │
│                                                              │
│  ┌──────────┐     ┌────────────┐     ┌──────────────┐       │
│  │  Agent    │────►│ State Store │◄────│ Human UI     │       │
│  │  Runtime  │     │ (持久化)    │     │ (Web/Slack)  │       │
│  └──────────┘     └────────────┘     └──────────────┘       │
│       │                │                     │               │
│       │           ┌────┴────┐                │               │
│       │           │Checkpoint│               │               │
│       │           │  (快照)  │               │               │
│       │           └─────────┘                │               │
│       │                                      │               │
│       ├── 1. Agent 运行到中断点               │               │
│       ├── 2. 状态序列化 → State Store         │               │
│       ├── 3. 通知人类（WebSocket/Webhook）──────►               │
│       ├── 4. 人类审批/干预/修改                │               │
│       ├── 5. 状态反序列化 ← State Store        │               │
│       └── 6. Agent 从中断点恢复执行            │               │
│                                                              │
│  关键要求：                                                   │
│  • State Store 必须支持持久化（非内存）                        │
│  • 中断到恢复可能间隔数秒到数天                               │
│  • Agent 进程可能在中断期间被回收和重启                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 13. Agent 可靠性工程

### 13.1 为什么 Agent 可靠性特别难

> **类比：海上航行** ⛵
>
> 传统软件像在铁轨上运行的火车——轨道固定，出了问题你知道是哪段铁轨坏了。Agent 系统则像一艘帆船——它在开放水域航行，面对的风向（LLM 输出的随机性）、洋流（API 延迟和限流）、天气（外部工具的可用性）都在不断变化。你需要为各种可能的海况做好准备。

Agent 系统的不可靠性来源：

| 层级 | 不可靠因素 | 发生频率 | 影响程度 |
|------|-----------|---------|---------|
| **LLM 层** | 输出格式不一致、幻觉、拒绝回答 | 高 | 中-高 |
| **工具层** | API 超时、限流、返回格式变化 | 中 | 高 |
| **编排层** | 无限循环、状态损坏、死锁 | 低 | 极高 |
| **基础设施层** | 网络故障、内存不足、进程崩溃 | 低 | 极高 |

### 13.2 重试与幂等

LLM API 调用是 Agent 中最频繁的外部调用，需要合理的重试策略：

```python
import time
import random
from functools import wraps

def retry_with_exponential_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    retryable_errors: tuple = (RateLimitError, TimeoutError, APIConnectionError)
):
    """
    指数退避重试装饰器

    重试间隔：base_delay * 2^attempt + 随机抖动
    第 1 次重试：~1s
    第 2 次重试：~2s
    第 3 次重试：~4s
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except retryable_errors as e:
                    if attempt == max_retries:
                        raise  # 重试耗尽，抛出异常
                    delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                    print(f"[重试 {attempt+1}/{max_retries}] {type(e).__name__}: {e}，{delay:.1f}s 后重试")
                    time.sleep(delay)
        return wrapper
    return decorator

# 使用
@retry_with_exponential_backoff(max_retries=3)
def call_llm(messages: list) -> str:
    return openai_client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )
```

**幂等性设计**：对于有副作用的工具调用（如写数据库、发邮件），必须保证重试不会产生重复操作：

```python
# ❌ 非幂等：重试可能导致重复发送
def send_notification(user_id: str, message: str):
    email_api.send(to=user_id, body=message)

# ✅ 幂等：使用唯一请求 ID 去重
def send_notification_idempotent(user_id: str, message: str, request_id: str):
    if notification_store.exists(request_id):
        return notification_store.get(request_id)  # 返回已有结果
    result = email_api.send(to=user_id, body=message)
    notification_store.save(request_id, result)     # 记录已处理
    return result
```

### 13.3 超时与熔断

#### 分层超时

Agent 系统需要在多个层级设置超时，防止单个步骤或整个任务无限挂起：

```python
import asyncio
from contextlib import asynccontextmanager

class TimeoutConfig:
    """Agent 分层超时配置"""
    llm_call_timeout: float = 30.0       # 单次 LLM 调用超时（秒）
    tool_call_timeout: float = 60.0      # 单次工具调用超时（秒）
    single_step_timeout: float = 120.0   # 单个 Agent 步骤超时
    total_task_timeout: float = 600.0    # 整个任务超时（10 分钟）

@asynccontextmanager
async def step_timeout(timeout: float, step_name: str):
    """为单个步骤添加超时保护"""
    try:
        yield
    except asyncio.TimeoutError:
        raise StepTimeoutError(
            f"步骤 '{step_name}' 超时（>{timeout}s），已中止"
        )

# 使用示例
async def agent_step(state):
    async with step_timeout(TimeoutConfig.llm_call_timeout, "LLM推理"):
        response = await asyncio.wait_for(
            llm.ainvoke(state["messages"]),
            timeout=TimeoutConfig.llm_call_timeout
        )
    return response
```

#### 熔断器（Circuit Breaker）

当某个外部服务持续失败时，熔断器会暂时停止调用该服务，避免连锁故障：

```python
class CircuitBreaker:
    """
    熔断器模式

    类比：家里的保险丝 🔌
    当电路过载时，保险丝会熔断以保护电器。同理，当某个工具/API
    连续失败时，熔断器会"熔断"，暂停调用该服务，避免：
    1. 无谓地消耗重试时间
    2. 让失败的调用堆积，影响整体性能
    3. 给已经过载的服务雪上加霜
    """
    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.state = "closed"         # closed=正常, open=熔断, half_open=试探
        self.last_failure_time = None

    def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"  # 超过恢复时间，允许试探一次
            else:
                raise CircuitOpenError("熔断器已打开，暂停调用")

        try:
            result = func(*args, **kwargs)
            if self.state == "half_open":
                self.state = "closed"     # 试探成功，恢复正常
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.state = "open"       # 达到阈值，触发熔断
            raise

# 为每个外部工具配置独立的熔断器
tool_breakers = {
    "web_search": CircuitBreaker(failure_threshold=3, recovery_timeout=30),
    "database_query": CircuitBreaker(failure_threshold=5, recovery_timeout=60),
    "code_executor": CircuitBreaker(failure_threshold=2, recovery_timeout=120),
}
```

### 13.4 优雅降级

当 Agent 系统的某些组件不可用时，不应直接返回错误，而应**降级**到能力较弱但仍可用的模式：

```
┌───────────────────────────────────────────────────────────────┐
│                    Agent 降级策略                              │
│                                                               │
│  Level 0 (正常):     完整 Multi-Agent + 工具调用               │
│       │                                                       │
│       ▼ 某个 Agent 不可用                                      │
│  Level 1 (轻度降级): 单 Agent + 工具调用                       │
│       │                                                       │
│       ▼ 工具 API 不可用                                        │
│  Level 2 (中度降级): 单 Agent + 有限工具（缓存/本地工具）        │
│       │                                                       │
│       ▼ 主模型不可用                                           │
│  Level 3 (重度降级): 备用小模型直接回答（无工具调用）             │
│       │                                                       │
│       ▼ 所有 LLM 不可用                                       │
│  Level 4 (最终兜底): 返回预设模板回复 + 人工客服入口             │
└───────────────────────────────────────────────────────────────┘
```

```python
class ResilientAgent:
    """支持优雅降级的 Agent"""

    def __init__(self):
        self.primary_llm = ChatOpenAI(model="gpt-4o")
        self.fallback_llm = ChatOpenAI(model="gpt-4o-mini")
        self.tool_registry = ToolRegistry()

    async def run(self, task: str) -> str:
        # Level 0: 尝试完整能力
        try:
            return await self._run_full_agent(task)
        except (AgentTimeoutError, MaxStepsExceeded) as e:
            print(f"[降级 L1] 完整 Agent 失败: {e}")

        # Level 1: 单步直接回答 + 工具
        try:
            return await self._run_simple_agent(task)
        except Exception as e:
            print(f"[降级 L2] 简单 Agent 失败: {e}")

        # Level 2: 备用模型直接回答
        try:
            response = await self.fallback_llm.ainvoke(
                f"请直接回答（不使用工具）：{task}"
            )
            return f"[降级模式] {response.content}"
        except Exception as e:
            print(f"[降级 L3] 备用模型失败: {e}")

        # Level 3: 最终兜底
        return "抱歉，服务暂时不可用。请稍后重试或联系人工客服。"
```

### 13.5 错误分类与隔离

不是所有错误都值得重试。正确分类错误类型，决定合适的处理策略：

```python
from enum import Enum

class ErrorCategory(Enum):
    RETRYABLE_TRANSIENT = "transient"         # 瞬时错误，应重试
    RETRYABLE_RATE_LIMIT = "rate_limit"       # 限流，退避后重试
    NON_RETRYABLE_INPUT = "bad_input"         # 输入错误，重试无意义
    NON_RETRYABLE_FATAL = "fatal"             # 致命错误，立即终止
    RECOVERABLE_TOOL = "tool_error"           # 工具错误，可换工具

def classify_error(error: Exception) -> ErrorCategory:
    """将异常分类为不同的错误类型"""
    error_mapping = {
        # 瞬时错误 → 重试
        TimeoutError: ErrorCategory.RETRYABLE_TRANSIENT,
        ConnectionError: ErrorCategory.RETRYABLE_TRANSIENT,

        # 限流 → 退避重试
        RateLimitError: ErrorCategory.RETRYABLE_RATE_LIMIT,

        # 输入错误 → 不重试，修改输入
        InvalidToolInput: ErrorCategory.NON_RETRYABLE_INPUT,
        ValidationError: ErrorCategory.NON_RETRYABLE_INPUT,

        # 致命错误 → 立即停止
        AuthenticationError: ErrorCategory.NON_RETRYABLE_FATAL,
        BudgetExceededError: ErrorCategory.NON_RETRYABLE_FATAL,

        # 工具错误 → 尝试替代工具
        ToolExecutionError: ErrorCategory.RECOVERABLE_TOOL,
    }
    return error_mapping.get(type(error), ErrorCategory.RETRYABLE_TRANSIENT)

def handle_agent_error(error: Exception, state: dict) -> dict:
    """根据错误类型选择处理策略"""
    category = classify_error(error)

    if category == ErrorCategory.RETRYABLE_TRANSIENT:
        return {"action": "retry", "delay": 1.0}

    elif category == ErrorCategory.RETRYABLE_RATE_LIMIT:
        return {"action": "retry", "delay": 30.0}

    elif category == ErrorCategory.NON_RETRYABLE_INPUT:
        # 将错误信息反馈给 Agent，让它修正输入
        return {
            "action": "feedback_to_agent",
            "message": f"参数错误: {error}，请调整后重试"
        }

    elif category == ErrorCategory.RECOVERABLE_TOOL:
        # 通知 Agent 该工具不可用，尝试替代方案
        return {
            "action": "feedback_to_agent",
            "message": f"工具不可用: {error}，请使用其他方式完成任务"
        }

    else:  # FATAL
        return {"action": "abort", "reason": str(error)}
```

**错误隔离**：在多 Agent 系统中，一个 Agent 的失败不应导致整个系统崩溃：

```python
# ❌ 错误传播：子 Agent 异常直接导致主 Agent 崩溃
async def supervisor_bad(task):
    sub_result = await sub_agent.run(task)  # 异常会向上传播
    return process(sub_result)

# ✅ 错误隔离：子 Agent 异常被捕获和处理
async def supervisor_good(task):
    try:
        sub_result = await asyncio.wait_for(
            sub_agent.run(task),
            timeout=120
        )
        return process(sub_result)
    except (SubAgentError, asyncio.TimeoutError) as e:
        # 子 Agent 失败不影响 Supervisor，降级处理
        return fallback_process(task, error=str(e))
```

---

## 14. 常见陷阱与最佳实践

> 本节将前面各章节的关键经验浓缩为实用的 ❌ vs ✅ 对比，帮助你在实际开发中避开最常见的坑。

### 14.1 不是所有问题都需要 Agent

```
❌ 错误做法：所有任务都用 Agent

用户："今天天气怎么样？"
→ Agent 启动
  → Thought: "我需要查询天气"
  → Action: call weather_api("今天")
  → Observation: "晴天 25°C"
  → Thought: "我现在知道答案了"
  → Final Answer: "今天晴天 25°C"

消耗：~3 次 LLM 调用，耗时 ~5 秒，费用 ~$0.01

✅ 正确做法：简单任务用 Prompt Chain 或直接函数调用

用户："今天天气怎么样？"
→ 意图识别（1 次 LLM 调用）→ weather_api("今天") → 格式化返回

消耗：~1 次 LLM 调用，耗时 ~1 秒，费用 ~$0.003
```

**判断标准**：

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 固定流程、可枚举步骤 | Prompt Chain / 硬编码 | 无需动态决策 |
| 需要判断"接下来做什么" | Agent（ReAct） | 需要动态规划 |
| 需要多角色协作 | Multi-Agent | 需要分工和对话 |
| 一问一答、无工具需求 | 直接 LLM 调用 | 最简单的方案 |

### 14.2 Agent 循环的安全边界

```
❌ 错误做法：无限制的 Agent 循环

while not done:
    result = agent.step()    # 可能永远不会结束
    # LLM 进入"思考—尝试—失败—再思考"的死循环
    # Token 持续消耗，成本失控

✅ 正确做法：多维度限制

MAX_STEPS = 25           # 最大步骤数
MAX_COST = 0.50          # 最大成本（美元）
MAX_TIME = 300           # 最大时间（秒）
MAX_CONSECUTIVE_ERRORS = 3  # 最大连续错误数

for step in range(MAX_STEPS):
    if cost_tracker.total > MAX_COST:
        return "已达成本上限，任务终止"
    if time.time() - start > MAX_TIME:
        return "已达时间上限，返回当前最佳结果"
    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
        return "连续错误过多，需要人工介入"
    result = agent.step()
```

### 14.3 从第一天就接入可观测性

```
❌ 错误做法：忽视可观测性，出了问题再加

"Agent 上线了，用户反馈回答不对。"
"哪个步骤出了问题？"
"不知道，没有日志……"
"用了多少 Token？"
"不清楚……"
"能复现吗？"
"LLM 输出不确定性，复现不了……"

✅ 正确做法：Day 1 就接入 Tracing

每次 Agent 运行都记录完整轨迹：
• 输入 → 每步的 Thought/Action/Observation → 输出
• 每步的 Token 用量和耗时
• 工具调用的参数和返回值
• 最终结果和成本汇总

出了问题？查 Trace 即可精确定位。
```

### 14.4 避免框架锁定

```
❌ 错误做法：核心逻辑与框架深度耦合

from langgraph.specific_module import SpecificClass

class MyAgent(SpecificClass):      # 继承框架类
    def process(self):
        self.framework_method()    # 直接调用框架内部方法
        # 换框架 = 全部重写

✅ 正确做法：抽象核心逻辑，框架作为可替换的适配层

# 核心业务逻辑：不依赖任何框架
class AgentLogic:
    def plan(self, task: str) -> list[Step]: ...
    def execute_step(self, step: Step) -> Result: ...
    def should_continue(self, results: list) -> bool: ...

# 适配层：框架只负责编排
class LangGraphAdapter:
    def __init__(self, logic: AgentLogic):
        self.logic = logic
    def build_graph(self) -> StateGraph: ...

# 需要换框架？只需写新的 Adapter
class AutoGenAdapter:
    def __init__(self, logic: AgentLogic):
        self.logic = logic
    def build_group_chat(self) -> GroupChat: ...
```

### 14.5 高风险操作必须有人类确认

```
❌ 错误做法：Agent 全自动执行一切操作

Agent: "用户要求清理过期数据"
→ 自动执行 DELETE FROM users WHERE last_login < '2024-01-01'
→ 删除了 50,000 条用户记录
→ 用户："我只是想看看有多少过期数据……"

✅ 正确做法：不可逆操作必须有审批门

Agent: "用户要求清理过期数据"
→ 先执行 SELECT COUNT(*) → "将影响 50,000 条记录"
→ [暂停，通知人类] "即将删除 50,000 条用户记录，是否确认？"
→ 人类确认后才执行
→ 执行后生成回滚脚本，保留 72 小时
```

**高风险操作清单**（建议在 Agent 系统中维护一份白名单/黑名单）：

| 风险等级 | 操作类型 | 处理方式 |
|---------|---------|---------|
| 🔴 极高 | 删除数据、转账、发布到生产环境 | **强制审批** + 回滚方案 |
| 🟡 高 | 修改配置、发送通知、创建工单 | **建议审批**，可设为自动 |
| 🟢 低 | 读取数据、搜索、计算 | 自动执行 |

---

## 参考资料

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) - Yao et al., 2022
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain Source Code](https://github.com/langchain-ai/langchain)
- [AutoGen Documentation](https://microsoft.github.io/autogen/)
- [Dify Source Code](https://github.com/langgenius/dify)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091)
- [Google A2A Protocol Specification](https://google.github.io/A2A/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Langfuse Documentation](https://langfuse.com/docs)
- [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770)
- [GAIA: A Benchmark for General AI Assistants](https://arxiv.org/abs/2311.12983)
- [AgentBench: Evaluating LLMs as Agents](https://arxiv.org/abs/2308.03688)
