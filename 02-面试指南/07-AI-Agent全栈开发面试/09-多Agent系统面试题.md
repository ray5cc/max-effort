# 09-多Agent系统面试题 — 面试指南

> 覆盖多 Agent 系统核心知识的高频面试题，包括 AutoGen 对话模式、Dify 工作流编排、Agent 设计模式、通信协议与冲突解决，分基础/进阶/高级/场景四个层次。

## 相关链接

- 对应技术资料：[09-多Agent系统](../../01-技术资料/07-AI-Agent全栈开发/09-多Agent系统.md)

---

## 基础题（适合初级，0~1年经验）

### Q1：什么是多 Agent 系统？相比单 Agent 有哪些优势？

**参考答案：**
多 Agent 系统由多个自主 AI Agent 组成，每个 Agent 拥有不同的角色、能力和专业知识，通过相互协作完成复杂任务。

**优势：**

| 优势 | 说明 |
|------|------|
| **克服上下文限制** | 单 Agent 受 Token 窗口限制，多 Agent 可分段处理大型任务 |
| **专业分工** | 每个 Agent 专注于特定领域，避免"样样通、样样松" |
| **并行执行** | 多个 Agent 可同时处理不同子任务，提高效率 |
| **交叉验证** | 不同 Agent 相互检查，减少错误 |
| **容错性** | 单个 Agent 失败不影响整体系统 |

**适用场景：**
- 软件开发（需求分析 + 编码 + 测试 + 文档）
- 研究报告生成（搜索 + 分析 + 写作）
- 复杂数据分析流水线

**扩展知识：** 多 Agent 系统也有明显缺点：通信开销大（多次 LLM 调用增加成本）、调试复杂、延迟高。对于简单任务，单 Agent + 好的工具集通常更高效。

---

### Q2：AutoGen 中 AssistantAgent 和 UserProxyAgent 有什么区别？

**参考答案：**

| 特性 | AssistantAgent | UserProxyAgent |
|------|---------------|----------------|
| 驱动方式 | LLM（调用 GPT/Claude 等）| 代码执行 + 可选 LLM |
| 主要职责 | 生成文字回答、制定计划 | 代理人类意图、执行代码 |
| 代码执行 | 不直接执行代码 | 可在本地/Docker 执行代码 |
| 人机交互 | 不与人直接交互 | 可配置为请求人工输入 |
| system_message | 定义 Agent 角色和行为 | 较少使用 |

**典型组合：**
```python
assistant = AssistantAgent(name="Coder", llm_config=...)  # 生成代码
user_proxy = UserProxyAgent(name="Executor", 
                            code_execution_config={"work_dir": "./code"})  # 执行代码
```

**扩展知识：** `human_input_mode` 是 UserProxyAgent 的关键参数：
- `NEVER`：全自动，无需人工干预
- `ALWAYS`：每次消息都等待人工输入
- `TERMINATE`：仅在触发终止条件时请求人工确认

---

### Q3：GroupChat 中有哪些发言顺序策略？各适用什么场景？

**参考答案：**

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `"auto"` | GroupChatManager（LLM）根据上下文决定下一个发言者 | 通用场景，最智能，费用最高 |
| `"round_robin"` | 按 agents 列表顺序轮流发言 | 每个 Agent 必须参与的固定流程 |
| `"random"` | 随机选择发言者 | 需要多样性，不关心顺序 |
| 自定义函数 | 程序化控制发言顺序 | 复杂业务逻辑，需要状态感知 |

**自定义函数示例：**
```python
def custom_speaker_selection(last_speaker, groupchat):
    # 研究员发言后，交给写作者
    if last_speaker.name == "Researcher":
        return [a for a in groupchat.agents if a.name == "Writer"][0]
    return "auto"

group_chat = GroupChat(speaker_selection_method=custom_speaker_selection)
```

---

### Q4：Dify 的工作流（Workflow）与 Agent 有什么区别？

**参考答案：**

| 维度 | 工作流（Workflow） | Agent |
|------|-----------------|-------|
| 执行路径 | **确定性**：按 DAG 定义的固定路径执行 | **动态**：LLM 自主决定下一步行动 |
| 可预测性 | 高（流程固定）| 低（LLM 决策有随机性）|
| 适用场景 | 有固定业务流程的任务 | 需要灵活探索的开放性任务 |
| 调试难度 | 易（步骤清晰）| 难（Agent 决策不透明）|
| 成本 | 可精确控制 | 难以预估（动态步骤数）|

**选择原则：**
- 流程固定、可以画出完整流程图 → **工作流**
- 需要 LLM 自主决策、任务结构不固定 → **Agent**
- 两者可以组合：工作流中嵌入 Agent 节点，实现"结构化框架 + 灵活推理"

---

### Q5：什么是 ReAct 模式？与 Function Calling 模式有何区别？

**参考答案：**
两者都是 Agent 使用工具的范式，区别在于实现方式。

**ReAct（Reason + Act）模式：**
- 通过 Prompt 引导 LLM 输出 `Thought: → Action: → Observation:` 格式
- 不依赖模型原生 Function Calling 能力
- 适合所有 LLM（包括不支持 Function Calling 的开源模型）
- 工具调用格式需要在 Prompt 中定义，可能格式不稳定

**Function Calling 模式：**
- 利用模型原生支持（OpenAI GPT-4、Claude 等）
- 工具定义以 JSON Schema 格式传递，模型输出结构化 JSON
- 更稳定、更精准（减少解析错误）
- 只支持特定模型

**选择建议：**
- 使用 GPT-4/Claude/Gemini → 优先 Function Calling
- 使用开源模型（Llama、Qwen） → ReAct 或专门的 Function Calling 微调版本

---

## 进阶题（适合中级，1~3年经验）

### Q6：AutoGen GroupChat 中，如何防止 Agent 进入无限循环？

**参考答案：**

**常见无限循环原因：**
1. 没有设置终止条件（`is_termination_msg`）
2. `max_round` 未设置或设置过大
3. Agent 之间互相推诿（"你来做" → "你来做"）

**防御机制：**

```python
# 方法一：关键词终止
user_proxy = UserProxyAgent(
    is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", "").upper(),
)

# 方法二：强制限制对话轮次
group_chat = GroupChat(max_round=20)

# 方法三：在系统 Prompt 中明确指示
assistant = AssistantAgent(
    system_message="""当任务完成时，在消息最后一行输出 'TERMINATE'。
    如果发现问题无法解决，输出 'ABORT: [原因]'。""",
)

# 方法四：设置 Token 预算
llm_config = {
    "config_list": [...],
    "max_tokens": 1000,  # 限制每次调用的 Token 数
}
```

**检测死循环模式：**
```python
# 检查是否连续 N 轮发言者相同（表示卡住了）
def detect_loop(groupchat, window=3):
    recent = [m["name"] for m in groupchat.messages[-window:]]
    return len(set(recent)) == 1  # 同一个 Agent 连续发言
```

---

### Q7：描述反思模式（Reflection Pattern）的工作流程，以及如何评估反思质量。

**参考答案：**

**工作流程：**
```
1. 任务输入
2. 生成者 Agent 产生初步输出
3. 反思者 Agent 审查输出，生成批评意见
   - 指出具体问题（不是笼统说"不好"）
   - 建议具体改进方向
4. 生成者 Agent 根据反馈修改输出
5. 重复 3~4，直到：
   - 反思者满意（输出"APPROVE"）
   - 或达到最大迭代次数
6. 输出最终结果
```

**反思质量评估：**
- **有效性**：反思者指出的问题是否真实存在？（可与人工评估对比）
- **具体性**：批评是否有操作性建议？（"第三段逻辑跳跃，需要补充..."）
- **迭代效果**：每轮修改后输出质量是否提升？
- **过度批评**：是否会对好的输出也挑剔，导致质量下降？

**常见问题：**
- 反思者和生成者使用同一个 LLM，反思可能流于表面（模型不擅长批评自己的风格）
- 解决方案：使用不同角色设定的 Prompt，或使用不同的模型

---

### Q8：Dify 中如何实现条件分支和循环逻辑？

**参考答案：**

**条件分支（If-Else 节点）：**
```yaml
# Dify DSL 示例：根据情感分析结果分支
- type: if_else
  conditions:
    - variable: "{{sentiment_score}}"
      operator: "greater_than"
      value: 0.7
  true_branch: positive_response_node
  false_branch:
    - type: if_else
      conditions:
        - variable: "{{sentiment_score}}"
          operator: "less_than"
          value: 0.3
      true_branch: escalate_to_human_node
      false_branch: neutral_response_node
```

**循环（迭代节点）：**
```yaml
# 对列表中的每个元素执行子流程
- type: iteration
  input_list: "{{document_chunks}}"   # 输入列表变量
  iteration_variable: "chunk"          # 每次迭代的元素名
  iteration_flow:                      # 子流程
    - type: llm
      prompt: "总结以下段落：{{chunk}}"
  output: "summaries"                  # 收集所有迭代输出
```

**变量传递：**
- 节点输出通过 `{{node_id.output_key}}` 引用
- 全局变量在整个工作流中可访问
- 迭代节点内部可访问迭代变量和父级变量

---

### Q9：多 Agent 系统中如何设计有效的消息格式和状态管理？

**参考答案：**

**消息格式最佳实践：**
```python
# 结构化消息格式（优于纯文本）
from dataclasses import dataclass
from typing import Optional, Dict, Any

@dataclass
class AgentMessage:
    sender: str           # 发送者 Agent 名称
    recipient: str        # 接收者（可以是 "all" 或特定 Agent）
    content: str          # 消息内容
    message_type: str     # "task", "result", "error", "status"
    task_id: str          # 任务 ID（用于追踪）
    metadata: Dict[str, Any]  # 额外信息（如置信度、工具调用记录）
```

**状态管理（使用 LangGraph）：**
```python
from langgraph.graph import StateGraph
from typing import TypedDict, Annotated
import operator

class TeamState(TypedDict):
    messages: Annotated[list, operator.add]   # 消息追加（不覆盖）
    task_breakdown: list                       # 任务分解结果
    completed_tasks: set                       # 已完成的子任务
    final_report: str                          # 最终报告
    error_count: int                           # 错误计数

# 避免的反模式：直接修改共享字典
# 正确：使用不可变更新
def update_state(state: TeamState, new_message: str) -> TeamState:
    return {**state, "messages": state["messages"] + [new_message]}
```

**关键原则：**
1. **消息不可变**：追加而非修改历史消息（支持回滚和审计）
2. **状态显式化**：所有中间状态都应持久化，不依赖内存中的变量
3. **幂等操作**：同一消息重复处理应产生相同结果

---

### Q10：如何量化多 Agent 系统的成本并进行优化？

**参考答案：**

**成本构成：**
```
总成本 = Σ(每个 Agent 调用次数 × 每次输入 Token × 输入价格
         + 每个 Agent 调用次数 × 每次输出 Token × 输出价格)
```

**成本监控示例（使用 LangFuse）：**
```python
from langfuse import Langfuse
langfuse = Langfuse()

# 追踪每个 Agent 的 Token 用量
trace = langfuse.trace(name="multi_agent_task")
for agent_name, response in agent_responses.items():
    trace.span(
        name=agent_name,
        usage={"input": response.usage.prompt_tokens, 
               "output": response.usage.completion_tokens}
    )
```

**优化策略：**
1. **使用小模型处理简单任务**：路由 → GPT-4o-mini；复杂推理 → GPT-4o
2. **减少 Agent 数量**：多于 5 个 Agent 的系统通常可以简化
3. **消息截断**：对话历史超过一定长度后进行摘要压缩
4. **缓存工具调用结果**：同样的 API 调用不重复执行
5. **异步并行**：可以同时执行的子任务并行化，减少等待时间

---

## 高级题（适合高级，3年以上经验）

### Q11：如何在多 Agent 系统中实现可靠的错误恢复机制？

**参考答案：**

**错误类型与处理策略：**

| 错误类型 | 示例 | 处理策略 |
|---------|------|---------|
| LLM API 超时/限流 | 429/503 错误 | 指数退避重试（最多 3 次）|
| 工具执行失败 | 代码运行报错 | 将错误信息返回给 LLM，让它修复 |
| 结果质量不达标 | 反思者评分 < 阈值 | 触发重新生成（最多 N 次）|
| Agent 死锁 | 互相等待 | 超时后强制中断，降级为单 Agent |
| 上下文溢出 | Token 超限 | 摘要历史对话，压缩上下文 |

**实现可靠性的模式：**
```python
import asyncio
from typing import Optional

class ResilientAgentCaller:
    async def call_with_retry(
        self, agent, message: str, max_retries: int = 3
    ) -> Optional[str]:
        for attempt in range(max_retries):
            try:
                response = await asyncio.wait_for(
                    agent.generate_reply([{"content": message}]),
                    timeout=60.0
                )
                return response
            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # 指数退避
                continue
            except Exception as e:
                self.log_error(agent.name, e)
                if attempt == max_retries - 1:
                    return f"Agent {agent.name} 不可用，降级处理"
        return None
```

---

### Q12：描述多 Agent 系统中的"奥卡姆剃刀"原则，以及何时不应该使用多 Agent。

**参考答案：**

**奥卡姆剃刀在多 Agent 中的应用：** 如无必要，勿增 Agent。

**不应使用多 Agent 的场景：**

1. **任务本质上是线性的**：只有单一主题，无需并行或分工
2. **延迟敏感应用**：每增加一个 Agent 中间层都会增加 1~3 秒延迟
3. **成本预算紧张**：多 Agent 通常比单 Agent 贵 3~10 倍
4. **工具足够强大**：单 Agent + 完善工具集可以处理的任务（如 Claude Computer Use）
5. **调试困难超过收益**：团队规模小，无法有效维护复杂的多 Agent 系统

**决策框架：**
```
任务是否需要多个专业领域的深度知识？
├── 否 → 单 Agent + 工具集
└── 是 → 是否可以串行处理（不需要同时进行）？
          ├── 是 → 单 Agent 多步骤（Pipeline）
          └── 否 → 多 Agent 并行
                    └── 是否小于 5 个并行任务？
                          └── 是 → 实现；否 → 重新设计任务边界
```

---

### Q13：如何实现 Agent 的记忆共享（Shared Memory）？设计时需要注意什么？

**参考答案：**

**共享记忆的实现方式：**

```python
# 方式一：黑板系统（Blackboard Pattern）
class SharedBlackboard:
    def __init__(self):
        self._data = {}
        self._lock = asyncio.Lock()  # 并发安全
    
    async def write(self, key: str, value: any, writer: str):
        async with self._lock:
            self._data[key] = {
                "value": value,
                "written_by": writer,
                "timestamp": time.time(),
                "version": self._data.get(key, {}).get("version", 0) + 1
            }
    
    async def read(self, key: str) -> any:
        return self._data.get(key, {}).get("value")

# 方式二：向量数据库（跨会话记忆）
from chromadb import Client

memory_db = Client()
collection = memory_db.get_or_create_collection("agent_memory")

# Agent A 写入
collection.upsert(
    ids=["task_001_research"],
    documents=["研究发现：..."],
    metadatas=[{"agent": "Researcher", "task_id": "001"}]
)

# Agent B 查询
results = collection.query(
    query_texts=["最新研究发现"],
    n_results=5,
    where={"task_id": "001"}
)
```

**设计注意事项：**
1. **并发安全**：多个 Agent 同时写入同一 Key 需要加锁
2. **版本控制**：记录每次写入的版本和时间戳，支持冲突检测
3. **访问控制**：某些数据只应由特定 Agent 写入（如最终结论只由裁判 Agent 写入）
4. **过期清理**：临时共享数据需要设置 TTL，防止内存泄漏

---

## 场景题（开放性问题）

### Q14：设计一个多 Agent 系统来自动化代码审查流程。

**参考设计：**

**Agent 架构：**
```
用户提交 PR（包含 diff 文件）
        │
   ┌────▼───────────────────────────────────┐
   │          协调者 Orchestrator            │
   │  分解审查任务，分配给专业 Agent          │
   └────┬──────────────────────────────────┘
        │ 并行分发
   ┌────┼────────────────────────────┐
   │    │                           │
┌──▼──┐ ┌──▼──────────┐ ┌──────────▼──┐
│安全  │ │代码质量     │ │测试覆盖率   │
│Agent│ │Agent        │ │Agent       │
│CVE  │ │可读性/复杂度 │ │边界条件    │
│注入  │ │命名规范     │ │单元测试    │
└──┬──┘ └──┬──────────┘ └──────────┬──┘
   │       │                       │
   └───────┼───────────────────────┘
           │ 汇总
   ┌────────▼────────────────────────┐
   │       总结 Agent                │
   │  整合所有意见，生成结构化审查报告 │
   └─────────────────────────────────┘
```

**技术实现要点：**
1. 使用 diff 工具提取变更文件和行号，作为各 Agent 的输入
2. 安全 Agent 使用规则引擎（Semgrep）+ LLM 组合，提高准确性
3. 设置 `max_round=1`（每个子 Agent 只审查一次，不需要对话）
4. 总结 Agent 将意见按严重性排序（CRITICAL > WARNING > SUGGESTION）
5. 可选：训练专门的代码审查 LoRA 模型，降低成本

---

### Q15：一个多 Agent 系统在生产中出现了"幻觉传播"问题——一个 Agent 的错误信息被后续 Agent 信任并放大。如何设计防护措施？

**参考思路：**

**幻觉传播的典型场景：**
- 研究 Agent 虚构了一个统计数字
- 写作 Agent 将其作为事实引用
- 审查 Agent 由于信任上游，没有质疑
- 最终报告包含错误信息

**防护措施：**

1. **事实验证节点（Fact-Checking Agent）**
   - 在写作 Agent 之后，审查 Agent 之前插入专职验证 Agent
   - 对所有数字、引用、事实声明进行验证（调用搜索工具核查）

2. **置信度标注**
   - 要求 Agent 在关键事实后标注来源和置信度
   - 格式：`[某数据] [来源: 搜索结果 URL] [置信度: 高/中/低]`
   - 低置信度的内容自动触发人工确认

3. **工具验证优先**
   - 凡是可以通过工具验证的事实，必须工具验证
   - 禁止 Agent 直接断言无来源的统计数据

4. **隔离原则**
   - 每个 Agent 接收的上游信息标注来源
   - Agent 不应"默认相信"上游，而应对关键信息独立验证

5. **监控告警**
   - 对生产输出进行事后抽检（随机抽取 5% 进行人工验证）
   - 发现错误时追溯传播链，定位幻觉来源 Agent

---

## 导航

- ← [08-LLM微调技术面试题](./08-LLM微调技术面试题.md)
- ← [面试指南总目录](../README.md)
- ↔ [对应技术资料](../../01-技术资料/07-AI-Agent全栈开发/09-多Agent系统.md)
- → [10-AI-CLI与代码Agent面试题](./10-AI-CLI与代码Agent面试题.md)
