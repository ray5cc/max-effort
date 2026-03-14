# 05-Agent框架与编排 — 技术资料

> 深入剖析主流 Agent 框架的内部架构：ReAct 范式、LangChain/LangGraph 源码、LangGraph 状态机、Dify Workflow 引擎、AutoGen 多智能体协作，以及 Agent 设计模式的工程实践。

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

```
┌─────────────────────────────────────────────────────────────┐
│                        ReAct Loop                           │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │  Input   │───▶│ Thought  │───▶│       Action         │  │
│  │  + Ctx   │    │(Reasoning)│   │  (Tool Call / Done)  │  │
│  └──────────┘    └──────────┘    └──────────┬───────────┘  │
│        ▲                                     │              │
│        │         ┌──────────┐               │              │
│        └─────────│Observation│◀──────────────┘              │
│                  │(Tool Resp)│    env(action)               │
│                  └──────────┘                               │
│                                                             │
│  终止条件：action = "Final Answer" 或 达到最大步数限制         │
└─────────────────────────────────────────────────────────────┘
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

```
┌─────────────────────────────────────────────────────────────┐
│                   Tool Selection Flow                        │
│                                                             │
│  LLM Output: "Action: search\nAction Input: python async"   │
│                         │                                   │
│                         ▼                                   │
│              ReActOutputParser.parse()                      │
│                         │                                   │
│              ┌──────────┴──────────┐                        │
│              │  AgentAction        │                        │
│              │  tool = "search"    │                        │
│              │  tool_input = "..." │                        │
│              └──────────┬──────────┘                        │
│                         │                                   │
│                         ▼                                   │
│           name_to_tool_map["search"]                        │
│                  = Tool(func=search_fn)                     │
│                         │                                   │
│                         ▼                                   │
│              tool.run(tool_input)                           │
│              → observation (str)                            │
└─────────────────────────────────────────────────────────────┘
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

```
┌─────────────────────────────────────────────────────────────────┐
│                   LangGraph State Propagation                   │
│                                                                 │
│  Initial State: {messages: [HumanMessage("...")]}               │
│                      │                                          │
│                      ▼                                          │
│  ┌──────────────────────────────────────────────────┐           │
│  │  agent node                                       │           │
│  │  input:  {messages: [...]}                        │           │
│  │  output: {messages: [AIMessage(tool_calls=[...])]}│           │
│  └──────────────────┬─────────────────────────────┘           │
│                      │  add_messages reducer 追加消息            │
│                      ▼                                          │
│  State: {messages: [Human, AI(tool_calls)]}                     │
│                      │                                          │
│          should_continue → "tools"                              │
│                      │                                          │
│                      ▼                                          │
│  ┌──────────────────────────────────────────────────┐           │
│  │  tools node (ToolNode)                            │           │
│  │  input:  {messages: [..., AI(tool_calls)]}        │           │
│  │  执行每个 tool_call，生成 ToolMessage               │           │
│  │  output: {messages: [ToolMessage(...), ...]}      │           │
│  └──────────────────┬─────────────────────────────┘           │
│                      │                                          │
│  State: {messages: [Human, AI(tool_calls), ToolMessage(s)]}     │
│                      │                                          │
│                      └──────────────▶ agent node (下一轮)        │
└─────────────────────────────────────────────────────────────────┘
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

## 参考资料

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) - Yao et al., 2022
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain Source Code](https://github.com/langchain-ai/langchain)
- [AutoGen Documentation](https://microsoft.github.io/autogen/)
- [Dify Source Code](https://github.com/langgenius/dify)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091)
