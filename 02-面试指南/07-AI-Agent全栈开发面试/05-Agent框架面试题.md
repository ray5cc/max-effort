# 05-Agent框架与编排面试题

> 涵盖 ReAct 框架、LangGraph、AutoGen、Dify、多 Agent 编排模式与生产工程化的分层面试题。

## 相关链接

- 对应技术资料：[05-Agent框架与编排](../../01-技术资料/07-AI-Agent全栈开发/05-Agent框架与编排.md)

## 题目列表

| 题号 | 题目                                                                     | 难度   |
| ---- | ------------------------------------------------------------------------ | ------ |
| Q01  | ReAct 框架的核心循环是什么？                                             | ⭐     |
| Q02  | LangChain `AgentExecutor` 的基本工作原理？                               | ⭐     |
| Q03  | LangGraph 中 `StateGraph` 与 `MessageGraph` 的区别？                     | ⭐     |
| Q04  | AutoGen 的 `ConversableAgent` 如何实现多 Agent 对话？                    | ⭐     |
| Q05  | Agent 的终止条件有哪些类型？                                             | ⭐     |
| Q06  | Dify 工作流与代码 Agent 框架的主要区别？                                 | ⭐     |
| Q07  | 什么是 Plan-and-Solve 模式？与 ReAct 的区别？                            | ⭐     |
| Q08  | Agent 的 max_iterations 参数的作用与设置原则？                           | ⭐     |
| Q09  | LangGraph `StateGraph` 的节点、边和条件边如何协作？                      | ⭐⭐   |
| Q10  | LangGraph 中如何实现持久化（Checkpointer）与断点恢复？                   | ⭐⭐   |
| Q11  | AutoGen GroupChat 的 Speaker Selection 策略（round-robin/auto/custom）？ | ⭐⭐   |
| Q12  | Supervisor 模式与 Swarm 模式的架构差异？                                 | ⭐⭐   |
| Q13  | Human-in-the-Loop 在 LangGraph 中的实现方式？                            | ⭐⭐   |
| Q14  | `create_react_agent()` 与自定义 LangGraph Agent 的适用场景区分？         | ⭐⭐   |
| Q15  | 多 Agent 系统中消息路由的三种策略？                                      | ⭐⭐   |
| Q16  | LangGraph 的流式输出（`astream_events`）如何区分不同节点事件？           | ⭐⭐   |
| Q17  | Dify 的 Agent 节点与工作流节点的执行模型差异？                           | ⭐⭐   |
| Q18  | `ToolNode` 在 LangGraph 中如何处理并行工具调用和错误？                   | ⭐⭐   |
| Q19  | 如何设计支持动态 Agent 注册的可扩展多 Agent 系统？                       | ⭐⭐⭐ |
| Q20  | LangGraph 的 Map-Reduce 并行子图模式的实现原理？                         | ⭐⭐⭐ |
| Q21  | Agent 系统的"幻觉传播"问题如何在架构层面缓解？                           | ⭐⭐⭐ |
| Q22  | 大规模 Agent 生产部署：K8s + LangServe + 熔断器设计？                    | ⭐⭐⭐ |
| Q23  | Multi-Agent 系统的评估框架设计？                                         | ⭐⭐⭐ |
| Q24  | LangGraph 与 CrewAI、AutoGen 的架构对比？                                | ⭐⭐⭐ |
| Q25  | 如何用 LangGraph 实现带时间感知的长期任务规划 Agent？                    | ⭐⭐⭐ |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                    | 核心要点（一句话）                                  | 出题概率 |
| --- | ----------------------- | --------------------------------------------------- | -------- |
| 1   | ReAct 循环              | Think→Act→Observe反复迭代至任务完成                 | ★★★★★    |
| 2   | LangChain vs LlamaIndex | LC=通用编排(链/Agent)/LI=RAG优化(索引)              | ★★★★★    |
| 3   | Agent 架构模式          | 单Agent(简单)/主从(委派)/协作(多Agent对话)          | ★★★★☆    |
| 4   | Memory 集成             | ConversationBufferMemory/Summary/VectorStore/Entity | ★★★★☆    |
| 5   | 工具注册与发现          | 描述+Schema→运行时注册→LLM选择→执行→结果格式化      | ★★★★☆    |
| 6   | Structured Output       | Pydantic/Zod Schema约束LLM输出，保证可解析          | ★★★★☆    |
| 7   | Plan-and-Execute        | 先生成计划步骤→逐步执行→动态调整                    | ★★★☆☆    |
| 8   | 状态管理 (LangGraph)    | 图结构工作流+条件边+检查点+human-in-the-loop        | ★★★★☆    |
| 9   | 错误恢复策略            | 重试/回滚/降级/人工介入                             | ★★★☆☆    |
| 10  | 评估与测试              | Trajectory评估/端到端测试/LLM-as-Judge              | ★★★☆☆    |

---

## ⭐ 基础题

### Q01 ReAct 框架的核心循环是什么？

**参考答案**

ReAct（Reasoning + Acting）框架将推理和行动交替进行，形成 Thought → Action → Observation 循环。每一步中，模型首先生成 Thought（推理当前状态、确定下一步），再输出 Action（工具名称和参数），执行后得到 Observation（工具返回结果），将其拼入上下文后继续下一轮。循环在模型输出 Final Answer 或达到 max_iterations 时终止。与纯 CoT 相比，ReAct 能即时利用外部信息修正推理方向，与纯 Act 相比，显式的思维链使行为可解释。

**关键知识点**

- Thought/Action/Observation 三元组
- 循环终止条件：Final Answer 或 max_iterations
- 推理与行动交替提升可解释性

**延伸阅读** — [ReAct 论文](https://arxiv.org/abs/2210.03629)

---

### Q02 LangChain `AgentExecutor` 的基本工作原理？

**参考答案**

`AgentExecutor` 封装了 Agent（决策）和工具列表（执行），在 `_call()` 方法中实现主循环：调用 `agent.plan()` 获取 AgentAction 或 AgentFinish；若为 AgentAction，则在工具列表中查找对应工具并执行，将结果包装成 ToolMessage 追加进历史；若为 AgentFinish 则返回最终结果。循环受 `max_iterations` 和 `max_execution_time` 两个维度限制，超限时触发 `early_stopping_method`（force/generate）。LangChain 新版建议用 LangGraph 替代 AgentExecutor 以获得更细粒度的状态控制。

**关键知识点**

- `plan()` → 工具执行 → 历史追加的主循环
- 双维度终止保护（迭代次数 + 执行时间）
- 逐步迁移至 LangGraph

**延伸阅读** — [AgentExecutor 源码](https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain/agents/agent.py)

---

### Q03 LangGraph 中 `StateGraph` 与 `MessageGraph` 的区别？

**参考答案**

`StateGraph` 是通用状态机，用户自定义 `TypedDict` 作为状态类型，节点函数接收完整状态并返回要合并的字段 dict，适合任意复杂状态结构（计划列表、工具结果、中间变量等）。`MessageGraph` 是 `StateGraph` 的特例，状态固定为 `list[BaseMessage]`，节点返回消息列表自动追加，专为对话场景简化开发。选择原则：纯聊天机器人用 `MessageGraph`；需要维护非消息状态（如任务队列、计数器、子图结果）时用 `StateGraph`。

**关键知识点**

- `StateGraph`：自定义 TypedDict 状态，灵活
- `MessageGraph`：固定消息列表状态，简便
- 大多数 Agent 场景推荐 `StateGraph`

**延伸阅读** — [LangGraph 文档](https://langchain-ai.github.io/langgraph/concepts/low_level/)

---

### Q04 AutoGen 的 `ConversableAgent` 如何实现多 Agent 对话？

**参考答案**

`ConversableAgent` 是 AutoGen 中所有 Agent 的基类，每个实例维护自己的消息历史和系统提示。多 Agent 对话通过 `initiate_chat(recipient, message)` 触发，发送方将消息发给接收方，接收方调用 `generate_reply()` 生成响应，循环直至满足终止条件（`is_termination_msg` 返回 True 或达到 `max_turns`）。`GroupChat` 在多个 Agent 之间引入 `GroupChatManager` 作为调度器，负责 Speaker Selection 并将发言内容广播给所有成员。Agent 可配置 `human_input_mode`（NEVER/TERMINATE/ALWAYS）控制人工介入时机。

**关键知识点**

- `initiate_chat()` 触发两两对话
- `GroupChatManager` 实现多方调度
- `human_input_mode` 控制人工介入

**延伸阅读** — [AutoGen 文档](https://microsoft.github.io/autogen/docs/tutorial/introduction)

---

### Q05 Agent 的终止条件有哪些类型？

**参考答案**

常见终止条件分四类：① **输出信号**：模型生成特定文本（"Final Answer:"、`TERMINATE`）或结构化标志（`finish_reason: "stop"`）；② **迭代限制**：达到 `max_iterations` 上限，防止无限循环；③ **时间限制**：超过 `max_execution_time`，保证响应 SLA；④ **工具返回信号**：某个工具返回特殊值触发终止（如搜索工具返回"无更多结果"）。LangGraph 中还支持通过 `END` 节点显式终止和通过 `interrupt_before/after` 挂起等待人工确认。生产环境通常组合使用多种终止条件。

**关键知识点**

- 四类终止：输出信号/迭代/时间/工具信号
- LangGraph `END` 节点显式终止
- 生产建议组合使用

**延伸阅读** — [LangGraph 终止文档](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/breakpoints/)

---

### Q06 Dify 工作流与代码 Agent 框架的主要区别？

**参考答案**

Dify 工作流是低代码可视化平台，通过拖拽节点（LLM/代码/工具/条件分支）构建流程，适合产品/运营人员快速搭建，但灵活性受节点类型限制。代码 Agent 框架（LangGraph/AutoGen）以编程方式定义状态机，可以任意组合逻辑、自定义节点行为、集成私有工具，适合工程师构建复杂定制化场景。主要差异：Dify 有可视化调试和内置评估，代码框架有更强的类型安全和测试能力。两者并不互斥，Dify 也支持通过 API 调用外部代码服务。

**关键知识点**

- Dify：低代码可视化，快速上线
- 代码框架：灵活定制，工程化强
- 可以混合使用（Dify 调外部 API）

**延伸阅读** — [Dify 文档](https://docs.dify.ai/guides/workflow)

---

### Q07 什么是 Plan-and-Solve 模式？与 ReAct 的区别？

**参考答案**

Plan-and-Solve 是"先规划再执行"的两阶段模式：第一阶段由 Planner LLM 将任务分解为有序子任务列表；第二阶段 Executor 依次执行每个子任务（可以调用工具）。与 ReAct 的核心区别在于规划与执行的耦合度：ReAct 每步动态决定下一步行动（在线规划），Plan-and-Solve 先完整规划再执行（离线规划），更适合任务结构清晰、步骤可预知的场景（如代码生成、报告写作），但当中间步骤遇到意外结果时缺乏动态调整能力，需配合 Replanning 机制补充。

**关键知识点**

- 两阶段：Planner → Executor
- ReAct 在线规划 vs Plan-and-Solve 离线规划
- 需 Replanning 机制处理意外情况

**延伸阅读** — [Plan-and-Solve 论文](https://arxiv.org/abs/2305.04091)

---

### Q08 Agent 的 max_iterations 参数的作用与设置原则？

**参考答案**

`max_iterations` 限制 Agent 的最大 Thought-Action-Observation 循环次数，防止因推理错误或工具失败导致的无限循环消耗 Token 和金钱。设置原则：① 根据任务复杂度估算合理步数（简单问答 3-5 步，复杂分析 10-15 步）；② 结合 P95 实际步数分布设置上限，留 20-30% 余量；③ 超限时使用 `generate`（让模型生成当前最佳答案）而非 `force`（强制截断）以提升用户体验；④ 在可观测系统中监控"因超限终止"的比例，若超过 5% 应调整参数或优化提示词。

**关键知识点**

- 防止无限循环、控制成本
- 超限策略：generate（推荐）vs force
- 监控超限比例动态调整

**延伸阅读** — [AgentExecutor 文档](https://python.langchain.com/docs/how_to/agent_executor/)

---

## ⭐⭐ 进阶题

### Q09 LangGraph `StateGraph` 的节点、边和条件边如何协作？

**参考答案**

节点（Node）是普通 Python 函数，接收当前 `State` 返回状态更新 dict；边（Edge）是从一个节点到另一个节点的确定性路由；条件边（Conditional Edge）通过 `add_conditional_edges(node, router_fn, mapping)` 实现，`router_fn` 根据当前状态返回字符串 key，`mapping` 将 key 映射到目标节点名。典型 ReAct 图结构：`agent` 节点判断是否调用工具 → 条件边路由到 `tools` 节点或 `END` → `tools` 节点执行后无条件边回到 `agent`。所有节点的状态更新通过 `TypedDict` 中定义的 `Annotated[list, operator.add]` 实现自动合并。

```python
graph.add_conditional_edges("agent", should_continue, {"continue": "tools", "end": END})
graph.add_edge("tools", "agent")
```

**关键知识点**

- 节点返回部分状态更新 dict
- 条件边：`router_fn` 返回 key → mapping 到目标节点
- `operator.add` 实现列表追加合并

**延伸阅读** — [LangGraph 低级 API](https://langchain-ai.github.io/langgraph/concepts/low_level/)

---

### Q10 LangGraph 中如何实现持久化（Checkpointer）与断点恢复？

**参考答案**

LangGraph 的持久化通过 `Checkpointer` 实现，内置 `MemorySaver`（内存）、`SqliteSaver`（本地文件）和 `AsyncPostgresSaver`（生产）。每次节点执行后 Checkpointer 自动将状态序列化存储，以 `thread_id` 为键。恢复时传入相同 `thread_id` 的 config 即可：

```python
config = {"configurable": {"thread_id": "user-123"}}
result = graph.invoke(new_input, config=config)  # 自动从上次断点续跑
```

结合 `interrupt_before=["human_review"]` 可实现人工审核暂停，审核完成后调用 `graph.update_state()` 修改状态再继续。这一机制支持长时间运行任务、跨请求会话记忆和 Human-in-the-Loop 工作流。

**关键知识点**

- `thread_id` 标识会话，Checkpointer 自动存取
- 生产环境用 `AsyncPostgresSaver`
- `update_state()` 支持人工修正后继续

**延伸阅读** — [LangGraph 持久化文档](https://langchain-ai.github.io/langgraph/concepts/persistence/)

---

### Q11 AutoGen GroupChat 的 Speaker Selection 策略？

**参考答案**

AutoGen `GroupChat` 支持三种 `speaker_selection_method`：① **round_robin**：按固定顺序轮流发言，适合流水线任务（依次调用 Researcher → Writer → Reviewer）；② **auto**（默认）：`GroupChatManager` 将当前对话历史发给 LLM，让其决定下一个发言者，自适应但有额外 Token 消耗；③ **random**：随机选择，主要用于测试。还支持 `speaker_transitions_type` 配置允许/禁止的转换图（有向图约束），防止非预期的发言顺序。高级用法：传入自定义 `speaker_selection_func(last_speaker, groupchat)` 实现业务逻辑路由。

**关键知识点**

- round_robin/auto/random 三种策略
- `speaker_transitions_type` 约束合法转换
- 自定义函数实现复杂路由

**延伸阅读** — [AutoGen GroupChat 文档](https://microsoft.github.io/autogen/docs/tutorial/conversation-patterns)

---

### Q12 Supervisor 模式与 Swarm 模式的架构差异？

**参考答案**

**Supervisor 模式**：存在一个中央 Supervisor Agent，负责任务分解、子 Agent 调度和结果汇总。所有通信经过 Supervisor，形成 Hub-Spoke 拓扑。优点：集中控制、易于监控；缺点：Supervisor 是单点瓶颈，复杂场景下 Supervisor 的上下文窗口压力大。**Swarm 模式**：Agent 之间去中心化协作，每个 Agent 根据当前消息自主决定是否处理或转发给其他 Agent（handoff 机制），形成 P2P 拓扑。OpenAI Swarm 实现中通过 `transfer_to_X()` 工具实现 Agent 切换。优点：弹性扩展；缺点：全局状态难以追踪，调试复杂。

**关键知识点**

- Supervisor：Hub-Spoke，中央调度
- Swarm：P2P，handoff 自主转交
- 选型：可控性 vs 弹性

**延伸阅读** — [OpenAI Swarm](https://github.com/openai/swarm)

---

### Q13 Human-in-the-Loop 在 LangGraph 中的实现方式？

**参考答案**

LangGraph 通过两个机制实现 Human-in-the-Loop：① **`interrupt_before` / `interrupt_after`**：在编译图时指定需要暂停的节点名列表，执行到该节点前/后自动暂停，返回 `GraphInterrupt` 异常给调用方；调用方通过 UI 展示当前状态，人工决策后调用 `graph.update_state(config, new_state)` 修改状态，再调用 `graph.invoke(None, config)` 从断点继续。② **`Command(resume=value)` 输入**：在 `interrupt()` 函数处暂停，通过 `graph.invoke(Command(resume="approved"), config)` 传递人工输入。两种方式都依赖 Checkpointer 持久化状态。

**关键知识点**

- `interrupt_before/after` 节点级暂停
- `update_state()` 修改状态再继续
- 必须配合 Checkpointer 使用

**延伸阅读** — [LangGraph HITL 文档](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/breakpoints/)

---

### Q14 `create_react_agent()` 与自定义 LangGraph Agent 的适用场景？

**参考答案**

`create_react_agent(llm, tools)` 提供开箱即用的 ReAct 实现，内部构建固定的 `agent → tools → agent` 循环图，适合快速原型和标准工具调用场景，配置项有限（memory/checkpointer/state_modifier）。自定义 LangGraph Agent 适合以下场景：① 需要多步骤规划节点（Planner + Executor 分离）；② 需要并行子图（Map-Reduce）；③ 需要在特定节点插入人工审核；④ 状态不仅包含消息（还有结构化中间结果）；⑤ 需要子图组合（SubGraph）。原则：能用 `create_react_agent` 解决的先用，复杂需求再升级为自定义图。

**关键知识点**

- `create_react_agent`：快速原型，固定拓扑
- 自定义图：复杂状态/并行/人工介入
- 渐进式复杂度原则

**延伸阅读** — [create_react_agent 源码](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py)

---

### Q15 多 Agent 系统中消息路由的三种策略？

**参考答案**

① **基于角色的静态路由**：预定义每个 Agent 的职责，通过 if/else 或 mapping 表将任务分发，延迟最低，适合职责明确的流水线（Researcher → Writer → Reviewer）；② **LLM 动态路由**：由 Router LLM 分析任务语义，决定分发给哪个专家 Agent，适合任务类型不固定的通用 Assistant；③ **向量检索路由（Semantic Router）**：将 Agent 描述嵌入向量空间，将输入查询与 Agent 描述做相似度匹配，兼顾语义理解和低延迟（避免 LLM 调用）。生产建议：先用静态路由处理已知类型，兜底用 LLM 路由处理未知类型。

**关键知识点**

- 静态路由：低延迟，职责固定
- LLM 路由：灵活，有额外 Token 开销
- 向量路由：语义匹配，无需 LLM 调用

**延伸阅读** — [Semantic Router 库](https://github.com/aurelio-labs/semantic-router)

---

### Q16 LangGraph 的流式输出如何区分不同节点事件？

**参考答案**

`graph.astream_events(input, config, version="v2")` 返回异步事件流，每个事件包含 `event`（类型）和 `metadata`（含 `langgraph_node` 节点名）字段。常见事件类型：`on_chat_model_stream`（LLM token 流）、`on_tool_start/end`（工具调用）、`on_chain_start/end`（节点开始/结束）。按节点过滤示例：

```python
async for event in graph.astream_events(input, config, version="v2"):
    if event["event"] == "on_chat_model_stream" and \
       event["metadata"].get("langgraph_node") == "agent":
        print(event["data"]["chunk"].content, end="")
```

`astream(mode="updates")` 则在每个节点完成后返回状态更新 dict，适合非流式场景的进度跟踪。

**关键知识点**

- `astream_events` v2：事件级细粒度
- `metadata["langgraph_node"]` 标识来源节点
- `astream(mode="updates")` 用于节点完成通知

**延伸阅读** — [LangGraph 流式文档](https://langchain-ai.github.io/langgraph/how-tos/streaming/)

---

### Q17 Dify 的 Agent 节点与工作流节点的执行模型差异？

**参考答案**

**工作流节点**：确定性执行，每个节点有固定输入/输出变量，按有向无环图（DAG）拓扑排序依次或并行执行，不存在动态决策。适合流程清晰的场景（翻译 → 摘要 → 格式化）。**Agent 节点**：在工作流中嵌入 ReAct 循环，Agent 节点内部维护自己的 Thought/Action/Observation 循环，可自主决定调用哪些工具和循环次数，直到得出答案后将结果作为单一输出传递给后续工作流节点。两者的组合使用（工作流驱动 + Agent 嵌入）是 Dify 的核心设计，既保证主流程可控，又允许局部自治。

**关键知识点**

- 工作流：DAG，确定性
- Agent 节点：ReAct 嵌套，自主决策
- 组合使用：主流程可控 + 局部自治

**延伸阅读** — [Dify Agent 节点文档](https://docs.dify.ai/guides/workflow/node/agent)

---

### Q18 `ToolNode` 在 LangGraph 中如何处理并行工具调用和错误？

**参考答案**

`ToolNode` 是 LangGraph 预置节点，自动处理 `AIMessage` 中的 `tool_calls` 列表。当检测到多个 tool_calls 时，通过 `asyncio.gather()` 并行执行所有工具，将各自结果包装为 `ToolMessage` 追加进状态。错误处理方面：`ToolNode(tools, handle_tool_errors=True)` 捕获工具抛出的 `ToolException`，将错误信息作为 `ToolMessage` 的 content 返回给 LLM（而非崩溃整个图），让模型有机会调整策略重试。自定义错误处理：`handle_tool_errors` 可传入字符串（固定错误提示）或函数（动态错误处理逻辑）。

```python
tool_node = ToolNode(tools, handle_tool_errors=True)
```

**关键知识点**

- `asyncio.gather()` 并行执行多个工具调用
- `handle_tool_errors=True` 软化错误为 ToolMessage
- 错误返回 LLM 让其自适应重试

**延伸阅读** — [ToolNode 源码](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/tool_node.py)

---

## ⭐⭐⭐ 高阶题

### Q19 如何设计支持动态 Agent 注册的可扩展多 Agent 系统？

**参考答案**

动态 Agent 注册系统的核心是 Agent Registry + Router 两层设计。Registry 维护 Agent 元数据（名称、描述、能力标签、endpoint），支持运行时注册/注销。Router 在接收任务时查询 Registry，通过向量相似度或 LLM 路由选择合适 Agent。实现要点：① Registry 用 Redis Hash 存储，支持 TTL 实现心跳机制；② Agent 描述嵌入向量预计算，存入向量索引（Faiss/Qdrant）；③ Router 先向量检索 Top-K，再 LLM 二次排序；④ 新 Agent 注册时异步更新向量索引。挑战：注册竞态（分布式锁）、向量索引热更新（双 buffer 切换）。

**关键知识点**

- Registry（Redis） + Router（向量+LLM）两层
- 心跳 TTL 实现动态下线
- 双 buffer 向量索引热更新

**延伸阅读** — [LangGraph Multi-Agent 文档](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)

---

### Q20 LangGraph 的 Map-Reduce 并行子图模式的实现原理？

**参考答案**

LangGraph Map-Reduce 通过 `Send` API 动态生成并行节点实例。Map 阶段：在边函数中返回 `[Send("worker_node", item) for item in items]`，LangGraph 调度器为每个 item 创建独立的节点执行实例并行运行（每个实例有独立的子状态）；Reduce 阶段：所有实例完成后，其输出通过 `operator.add`（列表追加）或自定义 reducer 合并到主状态。适用场景：并行文档处理、多路 LLM 调用投票、批量工具执行。注意：并行实例共享 Checkpointer 的线程 ID，需用 `write` 模式避免写冲突。

```python
def continue_to_workers(state):
    return [Send("worker", item) for item in state["items"]]
graph.add_conditional_edges("splitter", continue_to_workers)
```

**关键知识点**

- `Send` API 动态并行分发
- `operator.add` reducer 收集结果
- 无共享子状态，避免竞态

**延伸阅读** — [LangGraph Map-Reduce 示例](https://langchain-ai.github.io/langgraph/how-tos/map-reduce/)

---

### Q21 Agent 系统的"幻觉传播"问题如何在架构层面缓解？

**参考答案**

幻觉传播指上游 Agent 的错误输出被下游 Agent 信任并放大。架构层面的缓解策略：① **验证节点**：在关键节点后插入专用验证 Agent，检查输出的事实一致性和格式合法性，不通过则触发 Replanning；② **多路投票**（Self-Consistency）：相同任务并行发给 3 个 Agent，多数决定最终输出；③ **工具锚定**：强制 Agent 通过工具（搜索/数据库查询）获取关键事实而非依赖记忆；④ **置信度传递**：Agent 输出附带置信度标签，低置信度时路由到 Human Review；⑤ **溯源链路**：每条输出携带来源引用，便于下游 Agent 和人工核查。

**关键知识点**

- 验证节点 + Replanning 早期拦截
- 工具锚定减少记忆幻觉
- 置信度标签触发人工审核

**延伸阅读** — [STORM 多 Agent 架构](https://arxiv.org/abs/2402.14207)

---

### Q22 大规模 Agent 生产部署：K8s + LangServe + 熔断器设计？

**参考答案**

生产 Agent 服务架构：① **LangServe** 将 LangGraph 图暴露为 FastAPI 端点（`/invoke`、`/stream`、`/batch`），自带 Pydantic 验证和 playground UI；② **K8s Deployment** 水平扩展无状态 Agent Pod，Checkpointer 使用外部 PostgreSQL/Redis 保证状态不丢失；③ **HPA**：基于请求队列长度（KEDA + RabbitMQ）而非 CPU 扩容，更贴近 LLM 服务特性；④ **熔断器**（tenacity + 自定义 CircuitBreaker）：LLM API 调用失败率超阈值时切换备用模型（litellm fallback）；⑤ **Istio Sidecar** 做流量染色和金丝雀分流。关键指标：TTFT P95 < 2s、Agent 完成率 > 95%。

**关键知识点**

- LangServe：图转 REST 端点
- KEDA 队列长度驱动 HPA
- LiteLLM Fallback 做模型级熔断

**延伸阅读** — [LangServe 文档](https://python.langchain.com/docs/langserve)

---

### Q23 Multi-Agent 系统的评估框架设计？

**参考答案**

多 Agent 系统评估分三层：① **单 Agent 能力评估**：工具调用准确率、任务完成率、平均步数效率（步数越少越好）；② **协作质量评估**：消息传递准确性（信息是否无损传递）、幻觉传播率（上游错误被下游采纳的比例）、冗余通信比（无效消息占比）；③ **端到端业务指标**：最终答案的 Faithfulness/Correctness、总延迟、总 Token 成本。工具：LangSmith Trace 提供调用链可视化；RAGAS 评估 RAG 子系统；自定义 Judge LLM 对最终输出打分。建议建立黄金测试集（golden dataset），每次模型/提示词变更后回归测试。

**关键知识点**

- 三层评估：单 Agent / 协作 / 端到端
- LangSmith + Judge LLM 实现自动评估
- 黄金测试集驱动回归

**延伸阅读** — [AgentBench](https://arxiv.org/abs/2308.03688)

---

### Q24 LangGraph 与 CrewAI、AutoGen 的架构对比？

**参考答案**

| 维度     | LangGraph              | CrewAI                  | AutoGen               |
| -------- | ---------------------- | ----------------------- | --------------------- |
| 核心抽象 | 有向状态机图           | Role-based Agent + Task | ConversableAgent 对话 |
| 状态管理 | TypedDict，强类型      | 共享 Crew context dict  | 消息历史列表          |
| 持久化   | 内置 Checkpointer      | 无原生支持              | 无原生支持            |
| 并行     | Map-Reduce Send API    | Process=hierarchical    | GroupChat             |
| 人工介入 | interrupt_before/after | 无                      | human_input_mode      |
| 学习曲线 | 较陡（需理解图论）     | 平缓（声明式 YAML）     | 中等                  |
| 适用场景 | 复杂有状态工作流       | 快速角色扮演团队        | 对话协作研究          |

总结：LangGraph 最灵活可控，适合生产工程化；CrewAI 最易上手，适合快速验证；AutoGen 学术研究和多 Agent 对话研究首选。

**关键知识点**

- LangGraph：强类型状态 + Checkpointer，工程最强
- CrewAI：声明式，快速原型
- AutoGen：对话驱动，研究首选

**延伸阅读** — [框架对比博客](https://blog.langchain.dev/langgraph-vs-autogen-vs-crewai/)

---

### Q25 如何用 LangGraph 实现带时间感知的长期任务规划 Agent？

**参考答案**

长期任务规划 Agent 需解决三个问题：① **任务持久化**：使用 `AsyncPostgresSaver` 持久化状态，包含任务列表、当前进度、截止时间；② **时间感知调度**：在 Agent 节点中注入当前时间戳，让 Planner 根据 deadline 动态调整优先级（时间压力大时简化步骤，时间充裕时深入分析）；③ **定时触发恢复**：通过 Celery Beat 或 K8s CronJob 定期调用 `graph.invoke(None, config)` 检查挂起任务，处理异步子任务完成的回调。状态设计中加入 `scheduled_at`、`deadline`、`subtask_status` 字段。配合 `interrupt_before` 实现人工里程碑确认，确保长期任务不偏离目标。

```python
class TaskState(TypedDict):
    tasks: Annotated[list, operator.add]
    deadline: datetime
    current_step: int
    last_reviewed_at: datetime
```

**关键知识点**

- PostgresSaver 持久化跨会话状态
- 注入时间戳让 Planner 感知 deadline
- CronJob 定期恢复挂起任务

**延伸阅读** — [LangGraph 长时运行任务](https://langchain-ai.github.io/langgraph/how-tos/async/)
