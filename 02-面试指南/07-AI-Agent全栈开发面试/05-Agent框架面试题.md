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
| Q26  | ReAct vs Plan-and-Execute vs LLMCompiler 的架构对比与适用场景？ | ⭐⭐   |
| Q27  | LangGraph 状态图深入：State 设计、条件边与 Human-in-the-Loop 最佳实践？ | ⭐⭐   |
| Q28  | CrewAI 角色编排：Role/Goal/Backstory 设计与 Process 类型选择？ | ⭐⭐   |
| Q29  | OpenAI Agents SDK 的 Runner、Handoffs 与 Guardrails 机制？ | ⭐⭐⭐ |
| Q30  | A2A（Agent-to-Agent）协议：Agent Card、Task 生命周期与互操作性？ | ⭐⭐⭐ |
| Q31  | Agent 可靠性工程：重试策略、Fallback 机制与输出结构化验证？ | ⭐⭐   |
| Q32  | Agent 评估方法论：轨迹评估、工具调用准确率与端到端指标？ | ⭐⭐⭐ |
| Q33  | 场景题：设计多 Agent 智能客服系统（意图识别 + 工单处理 + 人工升级）？ | ⭐⭐⭐ |
| Q34  | 场景题：Agent 评测平台架构设计（基准测试 + 回归检测 + 可视化）？ | ⭐⭐⭐ |
| Q35  | LangGraph Cloud 与 Agent 部署的工程化最佳实践？ | ⭐⭐⭐ |

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

---

### Q26：ReAct vs Plan-and-Execute vs LLMCompiler 的架构对比与适用场景？

<details><summary>参考答案</summary>

三种架构代表了 Agent 推理与执行的三种不同范式，各有最佳适用场景。

**1. ReAct（Reason + Act）**

ReAct 的核心思想是"交替思考与行动"：LLM 生成一步推理（Thought），据此选择一个工具执行（Action），观察结果（Observation），再进入下一轮循环。这种逐步反馈的方式就像一个人在陌生城市导航——走一步看一步，每到路口根据路牌决定下一步方向。

- **优势**：实时纠错，每步都有反馈，适合工具调用结果不可预测的场景
- **劣势**：串行执行，延迟高；多步骤任务中容易"迷路"，忘记整体目标
- **适用**：简单查询、少于 5 步的任务、工具结果影响后续决策的场景

**2. Plan-and-Execute**

Plan-and-Execute 将推理与执行解耦为两个阶段：Planner 先生成完整的任务计划（步骤列表），Executor 按计划逐步执行，执行完成后 Re-planner 根据已完成步骤和新信息调整剩余计划。类比做菜——先写好完整菜谱，再按步骤操作，中间发现缺少某种调料再调整后续步骤。

- **优势**：全局视角，步骤清晰，可在执行前审查计划
- **劣势**：初始计划可能不准确，Re-plan 需要额外 LLM 调用
- **适用**：复杂多步骤任务（>5 步）、需要人工审批计划的场景、步骤之间相对独立

**3. LLMCompiler（Berkeley, 2023）**

LLMCompiler 借鉴编译器中的指令级并行思想：Planner 生成带依赖关系的任务 DAG（有向无环图），Task Fetcher 识别无依赖的任务并行执行，最后 Joiner 汇总结果决定是否需要 Re-plan。如同工厂流水线——能并行的工序同时进行，只有真正有依赖的步骤才串行等待。

- **优势**：最大化并行，显著降低端到端延迟（论文实验加速 3.7×）
- **劣势**：依赖关系识别不准确时会出错，实现复杂度高
- **适用**：工具调用间部分独立的场景、对延迟敏感的生产环境

**架构对比表**

| 维度         | ReAct              | Plan-and-Execute     | LLMCompiler          |
| ------------ | ------------------ | -------------------- | -------------------- |
| 规划粒度     | 无全局规划，逐步   | 先全局规划，后逐步   | DAG 级规划           |
| 并行能力     | 无                 | 无（串行执行）       | 有（DAG 并行）       |
| 错误恢复     | 每步即时纠错       | Re-plan 阶段修正     | Joiner 决定是否重来  |
| 延迟         | 高（串行+多轮LLM） | 中（额外Plan/Replan）| 低（并行执行）       |
| 实现复杂度   | 低                 | 中                   | 高                   |
| 适合任务复杂度| 简单（<5步）       | 复杂（5-20步）       | 中等且可并行         |

```python
# LangGraph Plan-and-Execute 模式核心结构
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated, List
import operator

class PlanExecuteState(TypedDict):
    input: str
    plan: List[str]
    past_steps: Annotated[List[tuple], operator.add]
    response: str

def planner(state: PlanExecuteState):
    """调用 LLM 生成任务计划"""
    plan = llm.invoke(f"为以下任务生成步骤计划：{state['input']}")
    return {"plan": plan.steps}

def executor(state: PlanExecuteState):
    """执行计划中的当前步骤"""
    current_step = state["plan"][0]
    result = agent_executor.invoke({"input": current_step})
    return {"past_steps": [(current_step, result["output"])]}

def replanner(state: PlanExecuteState):
    """根据已完成步骤调整剩余计划"""
    output = replan_llm.invoke({
        "input": state["input"],
        "plan": state["plan"],
        "past_steps": state["past_steps"]
    })
    return {"plan": output.steps} if output.steps else {"response": output.response}

graph = StateGraph(PlanExecuteState)
graph.add_node("planner", planner)
graph.add_node("executor", executor)
graph.add_node("replanner", replanner)
graph.set_entry_point("planner")
graph.add_edge("planner", "executor")
graph.add_edge("executor", "replanner")
graph.add_conditional_edges("replanner", lambda s: END if s.get("response") else "executor")
```

**关键知识点**

- ReAct 适合简单任务，逐步反馈；Plan-and-Execute 适合复杂任务，全局规划
- LLMCompiler 通过 DAG 并行显著降低延迟，但实现复杂度高
- 生产中常混合使用：外层 Plan-and-Execute，单步内部用 ReAct

**延伸阅读** — [LLMCompiler 论文](https://arxiv.org/abs/2312.04511) · [LangGraph Plan-and-Execute](https://langchain-ai.github.io/langgraph/tutorials/plan-and-execute/plan-and-execute/)

</details>

---

### Q27：LangGraph 状态图深入：State 设计、条件边与 Human-in-the-Loop 最佳实践？

<details><summary>参考答案</summary>

LangGraph 的核心抽象是**状态图（StateGraph）**，理解其 State 设计、条件边路由和 Human-in-the-Loop 机制是构建生产级 Agent 的关键。

**1. State 设计：TypedDict + Reducer**

LangGraph 的 State 是一个 `TypedDict`，每个字段可通过 `Annotated` 指定 Reducer 函数。Reducer 决定了节点返回值如何与现有 State 合并：

- **默认行为（无 Reducer）**：直接覆盖，后写入的值替换先前值
- **`operator.add`**：追加合并，适用于消息列表、步骤记录等需要累积的字段
- **自定义 Reducer**：如去重合并、取最新 N 条等

设计原则：State 应该是**最小必要集**——只存放跨节点需要共享的数据，节点内部的临时变量不要放进 State。

**2. 条件边（Conditional Edges）**

条件边是 LangGraph 实现复杂路由的核心机制。通过 `add_conditional_edges(source, router_fn, path_map)` 定义，`router_fn` 根据当前 State 返回下一个节点的名称。

常见路由模式：
- **工具调用路由**：检查 LLM 输出是否包含 tool_calls，有则路由到 ToolNode，无则结束
- **分类路由**：根据意图分类结果路由到不同的专家节点
- **质量门控**：检查输出质量评分，低于阈值则路由回重试节点

**3. Human-in-the-Loop（HITL）**

LangGraph 通过 `interrupt_before` 和 `interrupt_after` 实现人工干预：

- `interrupt_before=["node_name"]`：执行到该节点**之前**暂停，人工审批后再继续
- `interrupt_after=["node_name"]`：节点执行**之后**暂停，人工检查输出后决定是否继续

暂停后，人工可以通过 `graph.update_state(config, new_values)` 修改 State，再调用 `graph.invoke(None, config)` 恢复执行。这要求配置 Checkpointer 以持久化暂停时的状态。

**4. Checkpointer 选型**

| Checkpointer      | 适用场景       | 特点                     |
| ------------------ | -------------- | ------------------------ |
| `MemorySaver`      | 本地开发/测试  | 内存存储，进程结束即丢失 |
| `SqliteSaver`      | 单机生产       | 文件级持久化，无需外部服务 |
| `PostgresSaver`    | 分布式生产     | 支持多实例共享状态       |
| `RedisSaver`       | 高频读写       | 低延迟，适合实时系统     |

```python
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from typing import TypedDict, Annotated, Literal
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    intent: str
    retry_count: int

llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

def agent_node(state: AgentState):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def intent_classifier(state: AgentState):
    last_msg = state["messages"][-1].content
    intent = classify(last_msg)  # 自定义分类逻辑
    return {"intent": intent}

def route_by_intent(state: AgentState) -> Literal["faq", "order", "escalate"]:
    intent_map = {"faq": "faq", "order": "order"}
    return intent_map.get(state["intent"], "escalate")

def should_continue(state: AgentState) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    return "tools" if last.tool_calls else "end"

# 构建状态图
graph = StateGraph(AgentState)
graph.add_node("classifier", intent_classifier)
graph.add_node("agent", agent_node)
graph.add_node("tools", ToolNode(tools))

graph.set_entry_point("classifier")
graph.add_conditional_edges("classifier", route_by_intent,
    {"faq": "agent", "order": "agent", "escalate": END})
graph.add_conditional_edges("agent", should_continue,
    {"tools": "tools", "end": END})
graph.add_edge("tools", "agent")

# 启用 HITL：在 agent 节点执行后暂停，等待人工审核
checkpointer = MemorySaver()
app = graph.compile(
    checkpointer=checkpointer,
    interrupt_after=["agent"]  # agent 输出后暂停
)

# 使用：人工修改 state 后恢复
config = {"configurable": {"thread_id": "user-123"}}
result = app.invoke({"messages": [user_msg]}, config)
# 人工审核 result，决定修改或继续
app.update_state(config, {"messages": [human_feedback]})
final = app.invoke(None, config)  # 恢复执行
```

**关键知识点**

- State Reducer 决定字段合并策略，`operator.add` 最常用于消息累积
- 条件边是实现分支路由、质量门控、循环的核心机制
- HITL 依赖 Checkpointer 持久化暂停状态，生产环境必须用 PostgresSaver

**延伸阅读** — [LangGraph State 管理](https://langchain-ai.github.io/langgraph/concepts/low_level/#state) · [Human-in-the-Loop 指南](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/)

</details>

---

### Q28：CrewAI 角色编排：Role/Goal/Backstory 设计与 Process 类型选择？

<details><summary>参考答案</summary>

CrewAI 是一个以**角色扮演**为核心的多 Agent 框架，其设计哲学是"把 Agent 当团队成员来管理"。理解 Agent 定义、Task 编排和 Process 类型是高效使用 CrewAI 的关键。

**1. Agent 定义三要素**

CrewAI 的 Agent 由三个核心属性定义，这就像为一个新员工写岗位说明书：

- **Role（角色）**：Agent 的职位头衔，影响 LLM 的行为基调。例如"高级数据分析师"比"分析师"更能引导 LLM 产出深度分析
- **Goal（目标）**：Agent 的工作目标，是驱动 Agent 行为的核心。应具体且可衡量，如"生成包含可视化图表的市场分析报告"
- **Backstory（背景故事）**：Agent 的经验背景，为 LLM 提供上下文。例如"你在麦肯锡工作了 10 年，擅长用数据讲故事"

设计原则：Role 决定身份，Goal 决定方向，Backstory 决定能力边界。三者缺一不可，且需要相互一致。

**2. Task 定义**

Task 是分配给 Agent 的具体任务单元：

- **description**：详细的任务描述，越具体越好
- **expected_output**：期望输出的格式和内容描述
- **agent**：负责执行该 Task 的 Agent
- **context**：依赖的前置 Task 列表（前置 Task 的输出会注入到当前 Task 的上下文）

**3. Process 类型**

| Process 类型  | 执行方式            | 适用场景                   |
| ------------- | ------------------- | -------------------------- |
| `sequential`  | 按 Task 列表顺序执行 | 步骤间有严格依赖的流水线   |
| `hierarchical`| Manager Agent 分配任务 | 需要动态决策分配的复杂任务 |

- **Sequential（顺序执行）**：如同流水线，前一个 Task 的输出自动作为下一个的输入。简单可控，适合固定流程
- **Hierarchical（层级管理）**：自动创建 Manager Agent，由其决定任务分配顺序和执行者。适合任务间关系不确定、需要动态调度的场景

**4. 优势与局限**

优势：
- 声明式 API，5 分钟搭建多 Agent 系统
- 支持 YAML 配置文件，非开发者也能调整 Agent 行为
- 内置工具集成（搜索、文件读写、代码执行等）

局限：
- 相比 LangGraph，缺少细粒度的状态管理和条件路由
- 无原生状态持久化（无 Checkpointer 机制）
- 复杂控制流（循环、动态分支）实现困难

```python
from crewai import Agent, Task, Crew, Process

# 定义 Agents
researcher = Agent(
    role="高级市场研究员",
    goal="发现并分析最新的 AI Agent 市场趋势和竞品动态",
    backstory="你是一位在 Gartner 工作了 8 年的技术分析师，"
              "擅长从海量信息中提炼关键洞察。",
    tools=[search_tool, web_scraper],
    llm="gpt-4o",
    verbose=True
)

writer = Agent(
    role="技术内容总监",
    goal="将研究数据转化为结构清晰、观点鲜明的市场分析报告",
    backstory="你是前 TechCrunch 资深编辑，擅长用故事化手法呈现技术趋势。",
    llm="gpt-4o"
)

reviewer = Agent(
    role="质量审核专家",
    goal="确保报告数据准确、逻辑严密、格式规范",
    backstory="你是一位学术期刊审稿人，对事实准确性要求极高。",
    llm="gpt-4o"
)

# 定义 Tasks
research_task = Task(
    description="调研 2024-2025 年 AI Agent 框架市场，包括 LangGraph、CrewAI、AutoGen、Dify 的最新动态",
    expected_output="一份包含市场规模、竞品对比、技术趋势的结构化调研数据",
    agent=researcher
)

writing_task = Task(
    description="基于调研数据撰写 3000 字的 AI Agent 市场分析报告",
    expected_output="一份包含摘要、正文、图表建议的完整 Markdown 报告",
    agent=writer,
    context=[research_task]  # 依赖调研结果
)

review_task = Task(
    description="审核报告的事实准确性和逻辑连贯性，给出修改建议",
    expected_output="审核意见列表和修改后的终稿",
    agent=reviewer,
    context=[writing_task]
)

# 组建 Crew 并执行
crew = Crew(
    agents=[researcher, writer, reviewer],
    tasks=[research_task, writing_task, review_task],
    process=Process.sequential,  # 顺序执行
    verbose=True
)

result = crew.kickoff()
```

**关键知识点**

- Role/Goal/Backstory 三要素缺一不可，Backstory 对输出质量影响显著
- Sequential 适合固定流程，Hierarchical 适合动态任务分配
- CrewAI 适合快速原型，复杂状态管理场景应选 LangGraph

**延伸阅读** — [CrewAI 官方文档](https://docs.crewai.com/) · [CrewAI vs LangGraph 选型指南](https://blog.langchain.dev/)

</details>

---

### Q29：OpenAI Agents SDK 的 Runner、Handoffs 与 Guardrails 机制？

<details><summary>参考答案</summary>

OpenAI Agents SDK（2025 年 3 月发布）是 OpenAI 官方的 Agent 构建框架，提供了简洁但强大的 Agent 编排原语。其核心三大机制是 Runner（执行引擎）、Handoffs（Agent 间交接）和 Guardrails（安全护栏）。

**1. Agent 定义**

Agent 是 SDK 的基本单元，包含 `name`（名称）、`instructions`（系统提示词）、`model`（模型）、`tools`（工具列表）等属性。与 LangGraph 的图节点不同，Agent 本身就是一个完整的推理执行单元。

**2. Runner：执行引擎**

Runner 是 Agent 的执行编排器，负责运行 Agent Loop：

- 调用 LLM 获取响应
- 如果响应包含工具调用，执行工具并将结果反馈给 LLM
- 如果响应包含 Handoff，切换到目标 Agent
- 如果响应是纯文本（final output），结束执行

```python
from agents import Agent, Runner

agent = Agent(
    name="研究助手",
    instructions="你是一个研究助手，帮助用户查找和分析信息。",
    tools=[search_tool, calculator_tool]
)

# 同步执行
result = Runner.run_sync(agent, "分析 2025 年 AI Agent 市场规模")
print(result.final_output)
```

Runner 支持三种执行模式：`run_sync`（同步阻塞）、`run`（异步）、`run_streamed`（流式输出）。

**3. Handoffs：Agent 间交接**

Handoffs 是 Agents SDK 最独特的机制——一个 Agent 可以将控制权"交接"给另一个 Agent，类比公司里的工作转交。当前 Agent 的对话历史会完整传递给接手的 Agent。

```python
from agents import Agent, handoff

billing_agent = Agent(
    name="账单专员",
    instructions="你负责处理账单相关问题。",
    tools=[billing_api_tool]
)

tech_agent = Agent(
    name="技术支持",
    instructions="你负责处理技术问题。",
    tools=[diagnostic_tool]
)

triage_agent = Agent(
    name="分诊客服",
    instructions="你负责识别用户问题类型，并转交给对应的专员。",
    handoffs=[
        handoff(billing_agent, description="账单、付款、退款相关问题"),
        handoff(tech_agent, description="技术故障、配置、使用问题")
    ]
)

# triage_agent 会根据用户问题自动 handoff 到合适的 agent
result = Runner.run_sync(triage_agent, "我的账单金额好像不对")
```

Handoffs 的本质是一种特殊的工具调用——当 LLM 决定 handoff 时，Runner 会切换当前 Agent 上下文。

**4. Guardrails：安全护栏**

Guardrails 在 Agent 执行的输入和输出端设置安全检查：

- **input_guardrails**：在 Agent 开始处理前检查用户输入，拦截注入攻击、越界请求等
- **output_guardrails**：在 Agent 输出返回用户前检查，过滤敏感信息、验证合规性

```python
from agents import Agent, GuardrailFunctionOutput, InputGuardrail

async def check_injection(ctx, agent, input_text):
    """检测 Prompt 注入攻击"""
    result = await Runner.run(injection_detector, input_text)
    return GuardrailFunctionOutput(
        output_info={"is_injection": result.final_output == "INJECTION"},
        tripwire_triggered=result.final_output == "INJECTION"
    )

safe_agent = Agent(
    name="安全助手",
    instructions="你是一个安全的 AI 助手。",
    input_guardrails=[
        InputGuardrail(guardrail_function=check_injection)
    ]
)
```

**5. 内置 Tracing**

SDK 内置了完整的 Tracing 系统，所有 Agent 调用、工具执行、Handoff 事件都会自动记录，可在 OpenAI Dashboard 中可视化查看调用链路。

**6. 与 LangGraph 对比**

| 维度         | OpenAI Agents SDK      | LangGraph             |
| ------------ | ---------------------- | --------------------- |
| 抽象级别     | 高（声明式）           | 低（图构建）          |
| 状态管理     | 隐式（对话历史）       | 显式（TypedDict）     |
| 多 Agent     | Handoffs（线性交接）   | 图节点（任意拓扑）    |
| 持久化       | 无内置                 | Checkpointer          |
| 控制粒度     | 粗（Agent 级别）       | 细（节点/边级别）     |
| 适用场景     | 快速构建、OpenAI 生态  | 复杂流程、生产部署    |

**追问链**

1. **Handoffs 和 LangGraph 的 Supervisor 模式有什么本质区别？** → Handoffs 是线性交接（A→B），控制权完全转移；Supervisor 是中心化调度，Supervisor 始终保持控制权
2. **如何在 Agents SDK 中实现类似 LangGraph 的循环？** → 通过在 Handoff 中形成环路（A handoff to B, B handoff to A），但缺乏显式终止条件控制
3. **Guardrails 与 LangChain 的 OutputParser 有何不同？** → Guardrails 是安全层面的拦截（阻止执行），OutputParser 是格式层面的解析（结构化输出）

**关键知识点**

- Runner 编排 Agent Loop：LLM → 工具/Handoff → 循环直到 final output
- Handoffs 实现 Agent 间线性交接，本质是特殊工具调用
- Guardrails 在输入/输出端设置安全拦截，tripwire 触发时中止执行

**延伸阅读** — [OpenAI Agents SDK 文档](https://openai.github.io/openai-agents-python/) · [Agents SDK GitHub](https://github.com/openai/openai-agents-python)

</details>

---

### Q30：A2A（Agent-to-Agent）协议：Agent Card、Task 生命周期与互操作性？

<details><summary>参考答案</summary>

A2A（Agent-to-Agent）是 Google 于 2025 年 4 月发布的开放协议，旨在解决不同平台、不同框架构建的 Agent 之间的互操作性问题。如果说 MCP 解决的是"Agent 如何使用工具"，A2A 解决的则是"Agent 如何与其他 Agent 协作"。

**1. 为什么需要 A2A？**

当前 Agent 生态面临"孤岛问题"：用 LangGraph 构建的 Agent 无法直接与 CrewAI 构建的 Agent 通信。A2A 提供了一个标准化的通信协议，让不同平台的 Agent 能够发现彼此、交换任务、协同工作，就像 HTTP 让不同的 Web 服务能够相互调用一样。

**2. Agent Card：Agent 的"名片"**

每个 A2A Agent 通过 Agent Card（JSON 格式）声明自己的能力、接口和认证方式。Agent Card 通常托管在 `/.well-known/agent.json` 路径下，供其他 Agent 发现和调用。

```json
{
  "name": "智能文档分析 Agent",
  "description": "自动分析 PDF/Word 文档，提取关键信息并生成摘要",
  "url": "https://doc-agent.example.com",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["Bearer"],
    "credentials": "OAuth2"
  },
  "defaultInputModes": ["text/plain", "application/pdf"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "document-summary",
      "name": "文档摘要",
      "description": "为上传的文档生成结构化摘要",
      "tags": ["summarization", "document", "NLP"],
      "examples": ["请帮我分析这份年报的关键数据"]
    }
  ]
}
```

**3. Task 生命周期**

A2A 中的核心交互单元是 Task，其状态流转如下：

```
submitted → working → input-required → completed
                  ↘                  ↗
                   → failed / canceled
```

- **submitted**：Client Agent 提交任务
- **working**：Server Agent 正在处理
- **input-required**：Server Agent 需要更多信息（类似 HITL）
- **completed**：任务成功完成
- **failed**：任务执行失败
- **canceled**：任务被取消

每个 Task 包含一个或多个 Message，每个 Message 包含多个 Part（TextPart、FilePart、DataPart）。

**4. 核心 API 端点**

| 端点                    | 方法   | 说明                       |
| ----------------------- | ------ | -------------------------- |
| `/tasks/send`           | POST   | 发送任务（请求-响应模式）  |
| `/tasks/sendSubscribe`  | POST   | 发送任务（SSE 流式模式）   |
| `/tasks/{id}`           | GET    | 查询任务状态               |
| `/tasks/{id}/cancel`    | POST   | 取消任务                   |

**5. 与 MCP 的关系**

| 维度       | A2A                        | MCP                         |
| ---------- | -------------------------- | --------------------------- |
| 解决的问题 | Agent 与 Agent 的通信      | Agent 与工具/数据源的通信   |
| 交互单位   | Task（异步、有状态）       | Tool Call（同步、无状态）   |
| 发现机制   | Agent Card                 | Server Capabilities         |
| 协议层     | HTTP + JSON-RPC + SSE      | JSON-RPC over stdio/HTTP    |
| 典型场景   | 跨组织 Agent 协作          | Agent 调用数据库/API        |

两者是互补而非竞争关系：一个 Agent 可以通过 MCP 使用工具，同时通过 A2A 与其他 Agent 协作。

**6. 生态支持**

A2A 已获得 50+ 合作伙伴支持，包括 Salesforce、SAP、MongoDB、LangChain 等。LangGraph 已提供 A2A 适配器，可以将 LangGraph Agent 暴露为 A2A 兼容服务。

**追问链**

1. **A2A 如何处理跨组织的认证与授权？** → Agent Card 声明 auth scheme，实际通信使用 OAuth2/API Key，支持服务端推送通知的 JWT 认证
2. **A2A 的 input-required 状态和 LangGraph 的 interrupt 有什么异同？** → 都是暂停等待输入，但 A2A 是协议级别的标准化状态，LangGraph 是框架级别的内部机制
3. **如何测试 A2A Agent 的互操作性？** → Google 提供了 A2A 合规性测试套件，验证 Agent Card 格式、Task 生命周期状态转换、消息格式等

**关键知识点**

- A2A 解决 Agent 间互操作性，MCP 解决 Agent-工具通信，两者互补
- Agent Card 是 Agent 的自描述元数据，类似 OpenAPI Spec
- Task 生命周期支持异步长时运行和 input-required 人工干预

**延伸阅读** — [A2A 协议规范](https://google.github.io/A2A/) · [A2A GitHub](https://github.com/google/A2A)

</details>

---

### Q31：Agent 可靠性工程：重试策略、Fallback 机制与输出结构化验证？

<details><summary>参考答案</summary>

生产环境中的 Agent 系统面临 LLM API 不稳定、工具调用失败、输出格式不可控等问题。可靠性工程是 Agent 从"Demo 能跑"到"生产可用"的关键跨越。

**1. 重试策略**

Agent 系统中的失败大多是瞬时性的（网络超时、API 限流、模型过载），合理的重试策略能显著提升稳定性：

- **指数退避（Exponential Backoff）**：每次重试等待时间翻倍（1s → 2s → 4s → 8s），避免雪崩
- **抖动（Jitter）**：在退避时间基础上加随机偏移，防止多个请求同时重试造成"惊群效应"
- **区分可重试与不可重试错误**：超时、429（限流）可重试；400（参数错误）、安全拒绝不应重试
- **分层重试**：工具调用级别重试 3 次，Agent 整体级别重试 1 次

**2. Fallback 机制**

当主策略失败时，系统应有优雅降级方案：

- **模型 Fallback**：GPT-4o 失败 → 降级到 GPT-4o-mini → 再降级到本地模型
- **工具 Fallback**：实时 API 不可用 → 使用缓存数据 → 返回"暂时无法获取"
- **策略 Fallback**：复杂 Agent 推理超时 → 降级为简单 Prompt + 单次调用
- **提供者 Fallback**：OpenAI 不可用 → 切换到 Anthropic → 再切换到 Azure OpenAI

**3. 输出结构化验证**

LLM 输出不可控是 Agent 最大的不稳定来源之一。结构化验证是最后一道防线：

- **Pydantic 模型验证**：定义输出 Schema，解析失败时触发重试
- **LLM 内置结构化输出**：OpenAI 的 `response_format={"type": "json_schema"}`
- **验证重试**：解析失败后，将错误信息和原始输出一并反馈给 LLM，要求修正

**4. 超时管理**

- **单步超时**：每个工具调用设置独立超时（如 30s），超时后记录错误并跳过
- **全局超时**：Agent 整体执行设置最大时间（如 5 分钟），超时后返回部分结果
- **流式超时**：对流式响应设置心跳检测，长时间无新 token 则中断

**5. 幂等性设计**

重试意味着工具调用可能重复执行，必须确保幂等性：
- 数据库写入使用 `INSERT ... ON CONFLICT DO NOTHING`
- API 调用使用 `Idempotency-Key` 头
- 文件操作先检查是否已完成

```python
import tenacity
from pydantic import BaseModel, ValidationError
from langgraph.graph import StateGraph

class AnalysisResult(BaseModel):
    summary: str
    key_points: list[str]
    confidence: float

# 带重试的工具调用
@tenacity.retry(
    wait=tenacity.wait_exponential(multiplier=1, min=1, max=30),
    stop=tenacity.stop_after_attempt(3),
    retry=tenacity.retry_if_exception_type((TimeoutError, ConnectionError)),
    before_sleep=lambda retry_state: logger.warning(
        f"重试第 {retry_state.attempt_number} 次: {retry_state.outcome.exception()}"
    )
)
async def call_api_with_retry(url: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()

# 带 Fallback 的 LLM 调用
from langchain_openai import ChatOpenAI

primary_llm = ChatOpenAI(model="gpt-4o", timeout=60)
fallback_llm = ChatOpenAI(model="gpt-4o-mini", timeout=30)
llm_with_fallback = primary_llm.with_fallbacks([fallback_llm])

# 输出结构化验证 + 重试
def validated_output_node(state):
    for attempt in range(3):
        response = llm.invoke(state["messages"])
        try:
            parsed = AnalysisResult.model_validate_json(response.content)
            return {"result": parsed, "messages": [response]}
        except ValidationError as e:
            error_msg = f"输出格式错误：{e}。请严格按 JSON Schema 输出。"
            state["messages"].append(HumanMessage(content=error_msg))
    return {"result": None, "error": "输出验证失败，已重试 3 次"}

# 断路器模式
class CircuitBreaker:
    def __init__(self, failure_threshold=5, reset_timeout=60):
        self.failures = 0
        self.threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.last_failure_time = None
        self.state = "closed"  # closed → open → half-open

    def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time.time() - self.last_failure_time > self.reset_timeout:
                self.state = "half-open"
            else:
                raise CircuitBreakerOpen("断路器已打开，拒绝请求")
        try:
            result = func(*args, **kwargs)
            if self.state == "half-open":
                self.state = "closed"
                self.failures = 0
            return result
        except Exception as e:
            self.failures += 1
            self.last_failure_time = time.time()
            if self.failures >= self.threshold:
                self.state = "open"
            raise
```

**关键知识点**

- 指数退避 + 抖动是重试的标准策略，需区分可重试和不可重试错误
- 多层 Fallback（模型/工具/策略/提供者）确保优雅降级
- Pydantic 验证 + 重试是 LLM 输出结构化的最后防线

**延伸阅读** — [LangChain Fallbacks](https://python.langchain.com/docs/how_to/fallbacks/) · [Tenacity 重试库](https://tenacity.readthedocs.io/)

</details>

---

### Q32：Agent 评估方法论：轨迹评估、工具调用准确率与端到端指标？

<details><summary>参考答案</summary>

Agent 评估比传统 LLM 评估复杂得多——不仅要评估最终答案是否正确，还要评估推理过程是否合理、工具使用是否高效。这就像评价一个员工不仅看 KPI 结果，还要看工作方法和效率。

**1. 三个评估层次**

| 层次         | 评估对象           | 核心指标                       |
| ------------ | ------------------ | ------------------------------ |
| 轨迹评估     | Agent 的行动序列   | 步骤正确率、路径最优性         |
| 工具调用评估 | 单次工具选择与参数 | 工具选择准确率、参数正确率     |
| 端到端评估   | 最终任务完成情况   | 任务完成率、答案正确性、效率   |

**2. 轨迹评估（Trajectory Evaluation）**

将 Agent 的实际行动序列与预定义的"黄金轨迹"（Golden Trajectory）进行对比：

- **精确匹配**：每一步工具调用和参数完全一致（太严格，实际很少用）
- **关键步骤匹配**：只验证关键步骤是否出现，忽略顺序差异
- **LLM-as-Judge**：用另一个 LLM 评估轨迹的合理性（灵活但有偏差）

轨迹评估的挑战在于：完成同一任务可能有多条合理路径，硬编码"正确轨迹"会过度约束。

**3. 工具调用准确率**

- **工具选择准确率**：Agent 是否选择了正确的工具？例如用户问天气却调用了搜索引擎
- **参数准确率**：工具参数是否正确？例如查询"北京天气"却传入 city="Shanghai"
- **调用顺序合理性**：工具调用的顺序是否高效？是否有冗余调用？
- **错误恢复率**：工具调用失败后，Agent 是否能正确处理并恢复？

**4. 端到端指标**

| 指标           | 计算方式                            | 说明                       |
| -------------- | ----------------------------------- | -------------------------- |
| 任务完成率     | 成功任务数 / 总任务数               | 最核心的业务指标           |
| 答案正确性     | 正确答案数 / 总答案数               | 对有标准答案的任务         |
| 步骤效率       | 实际步骤数 / 最优步骤数             | 衡量 Agent 是否"绕弯路"   |
| Token 效率     | 消耗 Token 数 / 任务完成数          | 成本控制指标               |
| 端到端延迟     | 从输入到最终输出的时间              | 用户体验指标               |
| 安全合规率     | 无安全违规的任务比例                | 对安全敏感场景必须跟踪     |

**5. 标准化基准测试**

| Benchmark   | 评估内容                        | 特点                       |
| ----------- | ------------------------------- | -------------------------- |
| AgentBench  | 8 个环境下的 Agent 能力        | 覆盖 Web、DB、游戏等       |
| GAIA        | 通用 AI 助手能力               | 多步推理 + 工具使用        |
| SWE-bench   | 软件工程任务（GitHub Issue 修复）| 真实代码库，端到端评估     |
| WebArena    | Web 浏览与操作                  | 模拟真实网站交互           |
| ToolBench   | 工具使用能力                    | 16000+ 真实 API            |

**6. LangSmith 评估实践**

LangSmith 提供了完整的 Agent 评估工具链：

```python
from langsmith import Client
from langsmith.evaluation import evaluate

client = Client()

# 1. 创建评估数据集
dataset = client.create_dataset("agent-eval-v1")
client.create_examples(
    inputs=[
        {"question": "北京今天的天气怎么样？"},
        {"question": "计算 2024 年 Q1 销售额同比增长率"},
    ],
    outputs=[
        {"answer": "包含温度、湿度等天气信息", "expected_tools": ["weather_api"]},
        {"answer": "包含具体增长率数字", "expected_tools": ["database_query", "calculator"]},
    ],
    dataset_id=dataset.id
)

# 2. 定义评估器
def tool_accuracy_evaluator(run, example):
    """评估工具调用准确率"""
    expected_tools = set(example.outputs["expected_tools"])
    actual_tools = set()
    for step in run.child_runs or []:
        if step.run_type == "tool":
            actual_tools.add(step.name)
    accuracy = len(expected_tools & actual_tools) / len(expected_tools)
    return {"key": "tool_accuracy", "score": accuracy}

def step_efficiency_evaluator(run, example):
    """评估步骤效率"""
    total_steps = len([r for r in (run.child_runs or []) if r.run_type == "llm"])
    optimal_steps = len(example.outputs["expected_tools"]) + 1  # 工具数 + 最终回答
    efficiency = min(optimal_steps / max(total_steps, 1), 1.0)
    return {"key": "step_efficiency", "score": efficiency}

# 3. 运行评估
results = evaluate(
    agent_executor.invoke,
    data=dataset.name,
    evaluators=[tool_accuracy_evaluator, step_efficiency_evaluator],
    experiment_prefix="agent-v2.1"
)
```

**7. 回归测试策略**

- **基线建立**：首次评估建立各指标基线
- **PR 级评估**：每次 Prompt/模型变更在 CI 中运行评估套件
- **阈值告警**：任务完成率下降 > 5% 或 Token 消耗上升 > 20% 时阻止合并
- **A/B 测试**：新旧版本并行运行，统计显著性检验

**追问链**

1. **LLM-as-Judge 评估 Agent 轨迹的偏差如何缓解？** → 多个 Judge 模型投票、提供详细评分 rubric、定期用人工标注校准 Judge 模型
2. **如何评估多 Agent 系统中单个 Agent 的贡献？** → Shapley 值分析、消融实验（逐个移除 Agent 观察效果）、Agent 级别的任务完成率拆分
3. **评估数据集如何防止"过拟合"？** → 定期更新数据集、使用 LLM 生成变体、从生产日志中提取新案例

**关键知识点**

- Agent 评估需覆盖轨迹、工具调用、端到端三个层次
- LangSmith 提供数据集管理 + 自定义评估器 + 实验对比的完整工具链
- 回归测试集成到 CI/CD，防止 Prompt 修改导致质量下降

**延伸阅读** — [LangSmith 评估文档](https://docs.smith.langchain.com/evaluation) · [AgentBench 论文](https://arxiv.org/abs/2308.03688)

</details>

---

### Q33：场景题：设计多 Agent 智能客服系统（意图识别 + 工单处理 + 人工升级）？

<details><summary>参考答案</summary>

这是一道综合性场景设计题，考察 Agent 架构设计、多 Agent 协作、状态管理和生产工程化能力。

**1. 需求分析**

一个智能客服系统需要处理：
- **FAQ 查询**：产品使用、价格方案等常见问题（占 60%+）
- **工单操作**：查询订单状态、修改地址、退款申请等（占 25%）
- **投诉升级**：复杂投诉、情绪激动用户需转人工（占 15%）

核心挑战：准确识别意图并路由到正确的处理链路，同时维护对话上下文和工单状态。

**2. 系统架构**

```diagram
用户消息
    ↓
┌─────────────┐
│  Router Agent│ ← 意图分类 + 情绪检测
└──────┬──────┘
       ├──────────────┬──────────────┐
       ↓              ↓              ↓
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ FAQ Agent │  │Order Agent│  │Complaint Agent│
│ (RAG)    │  │ (API调用) │  │ (工单+升级)  │
└──────────┘  └──────────┘  └──────────────┘
                                     ↓
                              ┌──────────┐
                              │ 人工坐席  │
                              └──────────┘
```

**3. 各 Agent 设计**

**Router Agent（路由 Agent）**
- 职责：意图分类 + 情绪检测 + 路由决策
- 实现：使用轻量 LLM（GPT-4o-mini）做分类，低延迟
- 路由规则：意图 + 情绪综合判断（情绪值 > 0.8 直接升级）

**FAQ Agent**
- 职责：回答常见问题
- 实现：RAG 架构，从产品知识库检索 + LLM 生成答案
- 置信度门控：检索相似度 < 0.7 时返回"无法确定"，触发升级

**Order Agent**
- 职责：处理订单相关操作
- 实现：绑定订单 API 工具（查询、修改、退款）
- 权限控制：退款金额 > 500 元需人工审批

**Complaint Agent**
- 职责：处理投诉，创建工单，必要时升级人工
- 实现：创建工单 + 记录投诉详情 + 评估升级必要性
- 升级触发：3 轮对话未解决 / 用户主动要求 / 情绪持续恶化

**4. LangGraph 实现**

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.postgres import PostgresSaver
from typing import TypedDict, Annotated, Literal
import operator

class CustomerServiceState(TypedDict):
    messages: Annotated[list, operator.add]
    customer_id: str
    intent: str
    sentiment_score: float
    ticket_id: str | None
    escalated: bool
    turn_count: int

def router_node(state: CustomerServiceState):
    """意图识别 + 情绪检测"""
    last_msg = state["messages"][-1].content
    classification = router_llm.invoke(
        f"分类用户意图（faq/order/complaint）并评估情绪（0-1）：\n{last_msg}"
    )
    return {
        "intent": classification.intent,
        "sentiment_score": classification.sentiment,
        "turn_count": state.get("turn_count", 0) + 1
    }

def should_escalate(state: CustomerServiceState) -> bool:
    """判断是否需要升级到人工"""
    return (
        state["sentiment_score"] > 0.8
        or state["turn_count"] > 3
        or state.get("escalated", False)
    )

def route_by_intent(state: CustomerServiceState) -> Literal["faq", "order", "complaint", "escalate"]:
    if should_escalate(state):
        return "escalate"
    return state["intent"]

def faq_node(state: CustomerServiceState):
    """RAG 检索 + 回答"""
    query = state["messages"][-1].content
    docs = vector_store.similarity_search(query, k=3)
    if docs[0].metadata["score"] < 0.7:
        return {"messages": [AIMessage("抱歉，这个问题我需要转接专员为您处理。")], "escalated": True}
    answer = faq_llm.invoke(f"基于以下资料回答问题：\n{docs}\n\n问题：{query}")
    return {"messages": [answer]}

def order_node(state: CustomerServiceState):
    """订单操作"""
    result = order_agent.invoke(state["messages"])
    return {"messages": [result]}

def complaint_node(state: CustomerServiceState):
    """投诉处理 + 工单创建"""
    ticket = create_ticket(
        customer_id=state["customer_id"],
        messages=state["messages"],
        sentiment=state["sentiment_score"]
    )
    response = complaint_llm.invoke(state["messages"])
    return {"messages": [response], "ticket_id": ticket.id}

def escalate_node(state: CustomerServiceState):
    """人工升级"""
    handoff_summary = summarize_llm.invoke(
        f"总结以下对话要点，供人工坐席参考：\n{state['messages']}"
    )
    notify_human_agent(
        customer_id=state["customer_id"],
        ticket_id=state.get("ticket_id"),
        summary=handoff_summary,
        sentiment=state["sentiment_score"]
    )
    return {"messages": [AIMessage("正在为您转接人工客服，请稍候...")], "escalated": True}

# 构建图
graph = StateGraph(CustomerServiceState)
graph.add_node("router", router_node)
graph.add_node("faq", faq_node)
graph.add_node("order", order_node)
graph.add_node("complaint", complaint_node)
graph.add_node("escalate", escalate_node)

graph.set_entry_point("router")
graph.add_conditional_edges("router", route_by_intent, {
    "faq": "faq", "order": "order",
    "complaint": "complaint", "escalate": "escalate"
})
graph.add_edge("faq", END)
graph.add_edge("order", END)
graph.add_edge("complaint", END)
graph.add_edge("escalate", END)

checkpointer = PostgresSaver.from_conn_string(DATABASE_URL)
app = graph.compile(checkpointer=checkpointer)
```

**5. 监控指标**

| 指标         | 目标值   | 说明                   |
| ------------ | -------- | ---------------------- |
| 意图准确率   | > 95%    | 路由到正确处理链路     |
| 自助解决率   | > 70%    | 无需人工介入即解决     |
| 人工升级率   | < 15%    | 升级应精准不过度       |
| 首次响应时间 | < 3s     | 用户体验关键指标       |
| 客户满意度   | > 4.2/5  | 会话结束后评分         |

**追问链**

1. **如何处理多轮对话中的意图切换？** → Router 在每轮重新分类，但保持对话历史；意图切换时更新 State 但不丢失上下文
2. **FAQ Agent 的知识库如何保持更新？** → 对接内部 Wiki/CMS 系统，增量向量化更新，设置知识过期时间
3. **如何防止 Agent 在投诉场景中"火上浇油"？** → 情绪检测 + 专门的安抚话术模板 + 高情绪时限制 LLM 自由发挥，使用预设回复

**关键知识点**

- Supervisor 模式（Router Agent）是客服系统最常用的架构
- 情绪检测 + 置信度门控双重机制控制升级策略
- PostgresSaver 持久化对话状态，支持跨会话上下文

**延伸阅读** — [LangGraph 客服示例](https://langchain-ai.github.io/langgraph/tutorials/customer-support/customer-support/) · [对话系统设计模式](https://arxiv.org/abs/2304.04995)

</details>

---

### Q34：场景题：Agent 评测平台架构设计（基准测试 + 回归检测 + 可视化）？

<details><summary>参考答案</summary>

Agent 评测平台是确保 Agent 系统质量的基础设施，类比软件工程中的 CI/CD 测试平台。本题考察系统架构设计、评估方法论和工程化能力。

**1. 需求分析**

评测平台需要支持四个核心场景：
- **基准测试**：在标准数据集上评估 Agent 的基线能力
- **回归检测**：Prompt/模型/工具变更后自动检测质量退化
- **A/B 对比**：并行运行两个版本，统计显著性比较
- **可视化报告**：直观展示评估结果、趋势和异常

**2. 系统架构**

```diagram
┌────────────────────────────────────────────────────────┐
│                     评测平台架构                         │
├──────────────┬──────────────┬──────────────┬───────────┤
│  Test Suite  │  Execution   │  Evaluation  │ Dashboard │
│  Registry    │  Engine      │  Pipeline    │           │
├──────────────┼──────────────┼──────────────┼───────────┤
│ • 数据集管理  │ • 并行执行    │ • 自动评估    │ • 趋势图   │
│ • 版本控制    │ • 超时控制    │ • 多维评分    │ • 对比视图  │
│ • 标签分类    │ • 成本追踪    │ • 回归告警    │ • 轨迹回放  │
│ • 黄金标注    │ • 重试策略    │ • 统计检验    │ • 成本分析  │
└──────────────┴──────────────┴──────────────┴───────────┘
         ↓              ↓              ↓
    PostgreSQL    Agent Runtime    LangSmith/自建
```

**3. 核心模块设计**

**Test Suite Registry（测试套件注册中心）**

```python
# 测试用例数据模型
class TestCase(BaseModel):
    id: str
    category: str  # unit / integration / e2e
    input: dict  # 输入（用户消息、上下文等）
    expected: dict  # 期望输出
    metadata: dict  # 难度、标签、创建时间等

class TestSuite(BaseModel):
    id: str
    name: str
    version: str
    test_cases: list[TestCase]
    agent_config: dict  # 目标 Agent 配置

# 三层测试体系
# Unit：单次工具调用正确性
unit_case = TestCase(
    id="unit-weather-001",
    category="unit",
    input={"tool": "weather_api", "params": {"city": "北京"}},
    expected={"contains": ["温度", "湿度"]},
    metadata={"tags": ["tool-call"], "difficulty": "easy"}
)

# Integration：多步骤工具链
integration_case = TestCase(
    id="int-travel-001",
    category="integration",
    input={"question": "帮我规划北京三日游，预算 5000 元"},
    expected={
        "required_tools": ["search", "calculator", "map_api"],
        "min_steps": 3,
        "contains": ["行程", "预算"]
    },
    metadata={"tags": ["multi-step"], "difficulty": "medium"}
)

# E2E：完整任务评估
e2e_case = TestCase(
    id="e2e-analysis-001",
    category="e2e",
    input={"question": "分析 Apple 2024 Q4 财报的关键指标"},
    expected={
        "correctness_rubric": "必须包含营收、利润率、iPhone 销量数据",
        "max_steps": 10,
        "max_tokens": 5000
    },
    metadata={"tags": ["analysis", "finance"], "difficulty": "hard"}
)
```

**Execution Engine（执行引擎）**

```python
import asyncio
from dataclasses import dataclass
from datetime import datetime

@dataclass
class ExecutionResult:
    test_case_id: str
    agent_version: str
    output: dict
    trajectory: list[dict]  # 每步的 action/observation
    total_tokens: int
    total_cost: float
    latency_ms: int
    error: str | None

class ExecutionEngine:
    def __init__(self, max_concurrent: int = 10, timeout: int = 300):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.timeout = timeout

    async def run_test_case(self, agent, test_case: TestCase) -> ExecutionResult:
        async with self.semaphore:
            start = datetime.now()
            try:
                result = await asyncio.wait_for(
                    agent.ainvoke(test_case.input),
                    timeout=self.timeout
                )
                return ExecutionResult(
                    test_case_id=test_case.id,
                    agent_version=agent.version,
                    output=result["output"],
                    trajectory=result["intermediate_steps"],
                    total_tokens=result["token_usage"],
                    total_cost=result["cost"],
                    latency_ms=(datetime.now() - start).microseconds // 1000,
                    error=None
                )
            except asyncio.TimeoutError:
                return ExecutionResult(
                    test_case_id=test_case.id, agent_version=agent.version,
                    output={}, trajectory=[], total_tokens=0, total_cost=0,
                    latency_ms=self.timeout * 1000, error="TIMEOUT"
                )

    async def run_suite(self, agent, suite: TestSuite) -> list[ExecutionResult]:
        tasks = [self.run_test_case(agent, tc) for tc in suite.test_cases]
        return await asyncio.gather(*tasks)
```

**Evaluation Pipeline（评估流水线）**

多维评估矩阵：

| 评估维度   | 评估方法              | 指标                   |
| ---------- | --------------------- | ---------------------- |
| 正确性     | LLM-as-Judge + 规则   | correctness_score      |
| 效率       | 步骤数/Token 数对比   | step_efficiency        |
| 安全性     | 关键词扫描 + 分类器   | safety_score           |
| 延迟       | 端到端耗时统计        | p50/p95/p99 latency    |
| 成本       | Token 消耗 × 单价     | cost_per_task          |

**回归检测**

```python
from scipy import stats

def detect_regression(baseline_scores: list[float],
                      current_scores: list[float],
                      threshold: float = 0.05) -> dict:
    """使用 Mann-Whitney U 检验检测质量回归"""
    stat, p_value = stats.mannwhitneyu(
        baseline_scores, current_scores, alternative='greater'
    )
    baseline_mean = sum(baseline_scores) / len(baseline_scores)
    current_mean = sum(current_scores) / len(current_scores)
    delta = (current_mean - baseline_mean) / baseline_mean

    return {
        "regression_detected": p_value < threshold,
        "p_value": p_value,
        "baseline_mean": baseline_mean,
        "current_mean": current_mean,
        "delta_pct": delta * 100,
        "recommendation": "BLOCK_MERGE" if p_value < threshold and delta < -0.05 else "PASS"
    }
```

**4. CI/CD 集成**

```yaml
# .github/workflows/agent-eval.yml
name: Agent Evaluation
on:
  pull_request:
    paths: ['prompts/**', 'agents/**', 'tools/**']

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Agent Evaluation Suite
        run: python eval/run_suite.py --suite core-v1 --compare main
      - name: Check Regression
        run: python eval/check_regression.py --threshold 0.05
        # 质量下降超过 5% 时 CI 失败
```

**5. Dashboard 可视化**

核心视图：
- **趋势图**：各指标随版本/时间的变化趋势
- **雷达图**：多维度能力对比（正确性、效率、安全性、成本）
- **轨迹回放**：逐步回放 Agent 的推理过程，标记异常步骤
- **成本热力图**：按测试类别和时间段展示 Token 消耗分布

**追问链**

1. **评估数据集的质量如何保证？** → 多人标注 + 标注一致性检查（Kappa 系数 > 0.8）+ 定期清洗过时用例
2. **如何评估不确定性？** → 同一用例多次运行（n=5），计算置信区间，只在统计显著时判定回归
3. **评估平台本身的评估器如何验证？** → Meta-evaluation：用已知好/坏的 Agent 输出验证评估器的区分能力

**关键知识点**

- 三层测试体系（Unit/Integration/E2E）对应不同粒度的评估
- Mann-Whitney U 检验比简单均值对比更可靠地检测回归
- CI/CD 集成确保每次变更都经过质量门控

**延伸阅读** — [LangSmith 评测指南](https://docs.smith.langchain.com/evaluation) · [Braintrust AI 评估平台](https://www.braintrust.dev/)

</details>

---

### Q35：LangGraph Cloud 与 Agent 部署的工程化最佳实践？

<details><summary>参考答案</summary>

将 Agent 从本地开发部署到生产环境是"最后一公里"的挑战。LangGraph Cloud 提供了托管部署方案，但自建部署同样常见。本题覆盖两种路径的工程化最佳实践。

**1. LangGraph Cloud 托管部署**

LangGraph Cloud 是 LangChain 提供的托管 Agent 部署平台，核心能力包括：

- **一键部署**：从 GitHub 仓库自动构建和部署 LangGraph 应用
- **持久化状态**：内置 Checkpointer，支持长时运行和断点恢复
- **水平扩展**：自动根据负载扩缩容
- **Cron 任务**：支持定时触发 Agent 执行
- **内置认证**：API Key 管理和访问控制

部署流程：

```python
# langgraph.json — 部署配置文件
{
    "dependencies": ["./requirements.txt"],
    "graphs": {
        "customer_service": "./agents/customer_service.py:graph"
    },
    "env": ".env",
    "python_version": "3.11"
}
```

```diagram
# 目录结构
my-agent/
├── langgraph.json         # 部署配置
├── requirements.txt       # Python 依赖
├── .env                   # 环境变量
└── agents/
    ├── customer_service.py  # Agent 图定义
    └── tools.py             # 工具定义
```

**2. LangGraph Studio：可视化调试**

LangGraph Studio 是桌面端调试工具，提供：
- **图可视化**：实时显示 StateGraph 的节点和边
- **状态检查**：每个节点执行后查看完整 State
- **断点调试**：在任意节点设置断点，手动注入 State
- **历史回放**：查看和回放历史执行轨迹

**3. 自建部署架构**

对于需要完全控制的场景，自建部署是更灵活的选择：

```diagram
                    ┌──────────────┐
                    │   Nginx/ALB  │
                    └──────┬───────┘
                           ↓
              ┌────────────────────────┐
              │    FastAPI / LangServe │
              │    (Agent API 层)      │
              ├────────────────────────┤
              │  LangGraph Runtime     │
              │  (Agent 执行引擎)      │
              └──────┬────────┬────────┘
                     ↓        ↓
            ┌────────┐  ┌──────────┐
            │PostgreSQL│  │  Redis   │
            │(State)  │  │(Cache)   │
            └────────┘  └──────────┘
                     ↓
            ┌────────────────┐
            │   LangSmith    │
            │  (Observability)│
            └────────────────┘
```

```python
# FastAPI + LangServe 部署示例
from fastapi import FastAPI, HTTPException
from langserve import add_routes
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres import PostgresSaver

app = FastAPI(title="Agent API")

# 初始化 Agent
checkpointer = PostgresSaver.from_conn_string(DATABASE_URL)
agent_graph = create_agent_graph()
agent_app = agent_graph.compile(checkpointer=checkpointer)

# 添加 LangServe 路由
add_routes(app, agent_app, path="/agent")

# 自定义端点：带认证和限流
from slowapi import Limiter
limiter = Limiter(key_func=get_api_key)

@app.post("/v1/chat")
@limiter.limit("60/minute")
async def chat(request: ChatRequest, api_key: str = Depends(verify_api_key)):
    config = RunnableConfig(
        configurable={
            "thread_id": request.thread_id,
            "user_id": request.user_id
        }
    )
    try:
        result = await agent_app.ainvoke(
            {"messages": [HumanMessage(content=request.message)]},
            config=config
        )
        return {"response": result["messages"][-1].content}
    except Exception as e:
        logger.error(f"Agent 执行失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="处理请求时出错")
```

**4. 生产环境 Checklist**

| 类别       | 检查项                                | 状态 |
| ---------- | ------------------------------------- | ---- |
| 状态管理   | PostgresSaver 配置完成                | ☐    |
| 状态管理   | 状态清理策略（TTL/定期归档）          | ☐    |
| 安全       | API 认证（API Key / OAuth2）          | ☐    |
| 安全       | 输入验证与 Prompt 注入防护            | ☐    |
| 安全       | LLM API Key 密钥管理（Vault/KMS）    | ☐    |
| 限流       | 每用户/每 API Key 速率限制            | ☐    |
| 限流       | LLM API 调用预算上限                  | ☐    |
| 监控       | LangSmith Tracing 集成               | ☐    |
| 监控       | Prometheus 指标暴露                   | ☐    |
| 监控       | 结构化日志（JSON 格式）               | ☐    |
| 告警       | 错误率 > 5% 告警                      | ☐    |
| 告警       | P95 延迟 > 30s 告警                   | ☐    |
| 告警       | Token 消耗异常告警                    | ☐    |
| 容灾       | LLM 提供者 Fallback 配置             | ☐    |
| 容灾       | 数据库主从复制                        | ☐    |
| 测试       | 评测套件 CI 集成                      | ☐    |
| 测试       | 回归检测阈值配置                      | ☐    |

**5. 水平扩展策略**

- **无状态 API 层**：FastAPI 实例无状态，可随意扩缩
- **共享状态存储**：所有实例连接同一个 PostgreSQL 集群
- **消息队列**：高峰期使用 Redis/Kafka 队列削峰
- **GPU 推理独立部署**：本地模型推理部署在独立 GPU 节点，API 调用

**6. 可观测性**

三大支柱在 Agent 系统中的应用：

- **Traces（链路追踪）**：LangSmith 记录完整的 Agent 执行链路，每个节点的输入/输出/延迟
- **Metrics（指标）**：Prometheus 暴露 `agent_invocations_total`、`agent_latency_seconds`、`tool_calls_total`
- **Logs（日志）**：结构化 JSON 日志，包含 `thread_id`、`user_id`、`agent_step`、`tool_name`

```python
# Prometheus 指标示例
from prometheus_client import Counter, Histogram

agent_requests = Counter(
    'agent_requests_total', 'Total agent invocations',
    ['agent_name', 'status']
)
agent_latency = Histogram(
    'agent_latency_seconds', 'Agent execution latency',
    ['agent_name'],
    buckets=[1, 3, 5, 10, 30, 60, 120, 300]
)
tool_calls = Counter(
    'tool_calls_total', 'Total tool invocations',
    ['tool_name', 'status']
)
```

**追问链**

1. **LangGraph Cloud 和自建部署如何选择？** → 团队 < 5 人且无合规要求用 Cloud；大团队、数据敏感场景、需要深度定制用自建
2. **Agent 的冷启动延迟如何优化？** → 预热 LLM 连接池、缓存常用 Prompt 模板、使用更快的小模型做路由
3. **如何实现 Agent 的灰度发布？** → 按用户 ID 哈希分流到新旧版本，监控新版本各指标，逐步扩大流量比例

**关键知识点**

- LangGraph Cloud 适合快速部署，自建方案适合深度定制和数据合规
- 生产 Checklist 覆盖状态管理、安全、限流、监控、容灾、测试六大维度
- 可观测性三支柱（Traces/Metrics/Logs）对 Agent 调试至关重要

**延伸阅读** — [LangGraph Cloud 文档](https://langchain-ai.github.io/langgraph/cloud/) · [LangServe 部署指南](https://python.langchain.com/docs/langserve/)

</details>
