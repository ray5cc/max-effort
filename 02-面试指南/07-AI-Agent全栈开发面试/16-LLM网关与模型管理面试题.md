# LLM 网关与模型管理面试题

> 覆盖 LLM 网关架构、多模型路由、成本管理、可观测性、评估体系、协议互操作等核心面试题目。

## 相关链接

- 对应技术资料：[16-LLM网关与模型管理](../../01-技术资料/07-AI-Agent全栈开发/16-LLM网关与模型管理.md)

## 题目列表

| 题号 | 题目 | 难度 |
| ---- | ---- | ---- |
| 01 | 什么是 LLM 网关？为什么需要？ | ⭐ |
| 02 | OpenAI 兼容 API 是什么？为什么成为行业标准？ | ⭐ |
| 03 | Fallback 策略和重试策略的区别？ | ⭐ |
| 04 | 什么是 Virtual Key？解决什么问题？ | ⭐ |
| 05 | LLM 应用的可观测性与传统应用有什么不同？ | ⭐ |
| 06 | Prompt 管理为什么需要版本控制？ | ⭐ |
| 07 | 什么是 MCP 协议？解决什么问题？ | ⭐ |
| 08 | Token 计费模型如何工作？ | ⭐ |
| 09 | 设计一个多模型智能路由器（考虑延迟、成本、质量） | ⭐⭐ |
| 10 | LiteLLM 如何实现 100+ provider 的适配？ | ⭐⭐ |
| 11 | Langfuse 的 trace/span 模型如何设计？ | ⭐⭐ |
| 12 | 如何实现语义缓存（Semantic Caching）？ | ⭐⭐ |
| 13 | A2A 协议的工作原理及与 MCP 的区别？ | ⭐⭐ |
| 14 | 如何设计 LLM 应用的评估流水线？ | ⭐⭐ |
| 15 | Prompt Caching 的工作原理（Anthropic vs Google）？ | ⭐⭐ |
| 16 | 多租户成本分摊的实现方案？ | ⭐⭐ |
| 17 | Circuit Breaker 在 LLM 网关中的应用？ | ⭐⭐ |
| 18 | Guardrails 的输入/输出检查如何实现？ | ⭐⭐ |
| 19 | 从零设计一个企业级 LLM 网关（百万级日请求） | ⭐⭐⭐ |
| 20 | 如何构建 LLM 应用的全链路可观测性平台？ | ⭐⭐⭐ |
| 21 | 设计一个成本优化策略降低 50% LLM API 支出 | ⭐⭐⭐ |
| 22 | 如何在混合云环境中部署多模型推理服务？ | ⭐⭐⭐ |
| 23 | 设计一个支持 MCP+A2A 的 Agent 互操作平台 | ⭐⭐⭐ |
| 24 | 🎯 场景：统一管理 OpenAI/Anthropic/vLLM 三种模型服务 | ⭐⭐ |
| 25 | 🎯 场景：LLM 网关雪崩降级方案 | ⭐⭐⭐ |
| 26 | 🎯 场景：月度 LLM 费用报表按团队/项目/功能拆分 | ⭐⭐ |
| 27 | 🎯 场景：将 LLM 评估集成到 CI/CD 流程 | ⭐⭐⭐ |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| # | 考点 | 核心要点（一句话） | 出题概率 |
| --- | --- | --- | --- |
| 1 | API 网关模式 | Proxy Gateway 统一 OpenAI 格式，一行代码切换 provider | ★★★★★ |
| 2 | 路由策略 | 延迟/成本/质量优先+智能路由+Fallback 级联 | ★★★★★ |
| 3 | 成本优化 | 模型级联/Prompt Caching/Batch API/语义缓存 | ★★★★★ |
| 4 | 可观测性 | Tracing(Langfuse)/Metrics(Token·延迟·成本)/Logging | ★★★★☆ |
| 5 | 协议互操作 | MCP(工具协议)+A2A(Agent 通信)，互补非竞争 | ★★★★☆ |
| 6 | 评估体系 | LLM-as-Judge/Dataset 驱动/CI 集成/回归检测 | ★★★★☆ |
| 7 | 安全与合规 | Guardrails 输入/输出检查，PII 过滤，Prompt Injection 防护 | ★★★★☆ |
| 8 | Virtual Key | 抽象真实 API Key，实现配额/权限/审计/轮转 | ★★★☆☆ |
| 9 | 语义缓存 | Embedding 相似度匹配已有响应，降低重复调用成本 | ★★★☆☆ |
| 10 | 多租户隔离 | 按团队/项目维度的成本归属、配额管理、模型权限 | ★★★☆☆ |

---

## ⭐ 基础题（8 题）

---

### Q01. 什么是 LLM 网关？为什么需要？

<details>
<summary>参考答案</summary>

#### 类比理解

LLM 网关就像一个"万能翻译官"——你的应用只说一种"语言"（统一的 API 格式），翻译官负责把请求翻译成 OpenAI、Anthropic、Google 等各家 LLM 的"方言"并转发，再把各家的回复翻译回统一格式。没有翻译官，应用要学会每家的方言，换一家就要重写代码。

#### 核心概念

LLM 网关（LLM Gateway / LLM Proxy）是位于应用与 LLM Provider 之间的中间层，提供以下核心能力：

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  应用服务    │ ──→ │  LLM 网关     │ ──→ │  OpenAI     │
│  (统一格式)  │     │              │ ──→ │  Anthropic  │
│             │     │  • 路由      │ ──→ │  Google     │
│             │     │  • 重试      │ ──→ │  vLLM(自部署)│
│             │     │  • 缓存      │     └─────────────┘
│             │     │  • 监控      │
│             │     │  • 安全      │
└─────────────┘     └──────────────┘
```

**为什么需要 LLM 网关？** 解决五个核心痛点：

| 痛点 | 没有网关 | 有网关 |
| --- | --- | --- |
| 多 Provider | 每个 Provider 写不同代码 | 统一 OpenAI 格式调用 |
| 故障恢复 | 手动处理重试和切换 | 自动 Fallback + 重试 |
| 成本管控 | 分散计费，难以追踪 | 统一成本追踪和预算告警 |
| 安全管理 | API Key 散落在各处 | Virtual Key + 权限隔离 |
| 可观测性 | 日志分散，难以关联 | 统一 Trace/Metrics/Logs |

**业界方案对比**：

| 方案 | 类型 | 特点 |
| --- | --- | --- |
| LiteLLM | 开源 Proxy | 100+ provider，8ms P95 开销，被 Stripe/Netflix 使用 |
| Portkey | 商业 SaaS | AI Gateway，Virtual Key，Guardrails |
| OpenRouter | 商业 API | 统一 API，按需付费，无月费 |
| AWS Bedrock | 云服务 | AWS 生态集成，Guardrails 内置 |

**关键知识点**

- LLM 网关的核心价值是**解耦**：应用代码与具体 LLM Provider 之间的解耦。
- 引入网关层额外增加的延迟通常在 5-15ms（LiteLLM P95 为 8ms），相比 LLM 推理时间（数百毫秒到数秒），开销可忽略。
- 网关不仅是技术需求，也是**治理需求**——企业需要统一的成本追踪、合规审计、模型访问控制。

</details>

---

### Q02. OpenAI 兼容 API 是什么？为什么成为行业标准？

<details>
<summary>参考答案</summary>

#### 类比理解

OpenAI 兼容 API 就像"USB 接口"——不管你的设备是鼠标、键盘还是移动硬盘，只要有 USB 接口就能即插即用。同样，不管底层模型是 GPT-4、Claude 还是 Llama，只要实现了 OpenAI 兼容 API，上层应用无需修改一行代码即可切换。

#### 协议规范

OpenAI Chat Completions API 格式已成为 LLM 领域的事实标准：

```python
# 标准请求格式
import openai

client = openai.OpenAI(
    api_key="your-key",
    base_url="https://api.openai.com/v1"  # 切换 provider 只需改这一行
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "什么是 LLM 网关？"}
    ],
    temperature=0.7,
    max_tokens=1024,
    stream=True  # 流式输出
)

# 标准响应格式
{
    "id": "chatcmpl-xxx",
    "object": "chat.completion",
    "model": "gpt-4o",
    "choices": [{
        "index": 0,
        "message": {
            "role": "assistant",
            "content": "LLM 网关是..."
        },
        "finish_reason": "stop"
    }],
    "usage": {
        "prompt_tokens": 25,
        "completion_tokens": 150,
        "total_tokens": 175
    }
}
```

**为什么成为行业标准？** 三个关键因素：

1. **先发优势**：OpenAI 最早推出商业化 API，开发者最先熟悉此格式。
2. **生态锁定**：LangChain、LlamaIndex（300+ 集成）、Vercel AI SDK 等框架默认支持 OpenAI 格式。
3. **最小公约数**：Chat Completions 的 `messages` + `tools` 结构足够表达绝大多数 LLM 交互场景。

**LiteLLM 的适配实现**：

```python
import litellm

# 只需改 model 字符串，API 格式完全一致
response = litellm.completion(
    model="anthropic/claude-sonnet-4-20250514",  # Anthropic
    # model="gemini/gemini-2.0-flash",       # Google
    # model="ollama/llama3",                 # 本地 Ollama
    messages=[{"role": "user", "content": "Hello"}]
)
```

LiteLLM 内部通过 **Provider-specific Adapter** 将 OpenAI 格式请求翻译为各家原生 API 格式，再将响应翻译回来，实现对 100+ provider 的统一适配。

**关键知识点**

- OpenAI 兼容 ≠ 完全一致——各 Provider 在 Function Calling 参数、流式协议细节上仍有差异，网关的翻译层需处理这些边界情况。
- vLLM、Ollama、LMStudio 等本地推理框架原生提供 OpenAI 兼容端点，进一步巩固了标准地位。
- Anthropic 有自己的原生 Messages API 格式（`role: "assistant"` 带 `content` 数组），但也通过 SDK 和网关提供 OpenAI 兼容模式。

</details>

---

### Q03. Fallback 策略和重试策略的区别？

<details>
<summary>参考答案</summary>

#### 类比理解

**重试策略**就像打电话没人接——你等几秒再拨一次同一个号码，希望对方刚才只是暂时离开。**Fallback 策略**就像第一选择的餐厅客满——你直接转去第二选择的餐厅，而不是在门口排队等。两者经常配合使用：先重试几次，确认第一选择确实不可用，再启动 Fallback 切换到备选方案。

#### 对比分析

| 维度 | 重试（Retry） | 回退（Fallback） |
| --- | --- | --- |
| **目标** | 同一个 Provider 恢复 | 切换到其他 Provider |
| **适用场景** | 网络抖动、429 限流、临时 500 | Provider 持续不可用、区域故障 |
| **时间成本** | 指数退避等待 | 几乎即时（切换到备用 Provider） |
| **请求目标** | 不变 | 改变 |
| **典型配置** | 最多 3 次，指数退避 | 2-3 级 Provider 优先级列表 |

#### 代码实现

```python
# LiteLLM 的 Fallback + Retry 联合配置
from litellm import Router

router = Router(
    model_list=[
        {
            "model_name": "primary",
            "litellm_params": {
                "model": "openai/gpt-4o",
                "api_key": "sk-xxx"
            }
        },
        {
            "model_name": "fallback-1",
            "litellm_params": {
                "model": "anthropic/claude-sonnet-4-20250514",
                "api_key": "sk-ant-xxx"
            }
        },
        {
            "model_name": "fallback-2",
            "litellm_params": {
                "model": "gemini/gemini-2.0-flash",
                "api_key": "AIza-xxx"
            }
        }
    ],
    # 重试配置：同一 Provider 内重试
    num_retries=3,
    retry_after=5,  # 429 限流时等待秒数
    # Fallback 配置：Provider 间切换
    fallbacks=[
        {"primary": ["fallback-1", "fallback-2"]}
    ],
    # 上下文窗口 Fallback（输入超长时自动切换到长上下文模型）
    context_window_fallbacks=[
        {"primary": ["gemini/gemini-2.0-flash"]}  # 1M 上下文
    ]
)
```

#### 执行流程

```
请求到达
  │
  ▼
主模型 (GPT-4o)
  │
  ├─ 成功 → 返回响应
  │
  ├─ 429/503 → 重试(最多3次，指数退避)
  │              │
  │              ├─ 重试成功 → 返回响应
  │              │
  │              └─ 重试耗尽 → 触发 Fallback
  │
  └─ 持续失败 → 触发 Fallback
                  │
                  ▼
              Fallback-1 (Claude)
                  │
                  ├─ 成功 → 返回响应
                  │
                  └─ 失败 → Fallback-2 (Gemini)
                              │
                              ├─ 成功 → 返回响应
                              │
                              └─ 失败 → 返回错误给客户端
```

**关键知识点**

- **重试不是万能的**：如果 Provider 全局宕机，重试只会增加延迟。合理的做法是设置重试次数上限（通常 2-3 次），超过后立即 Fallback。
- **Fallback 需要保证模型能力兼容**：如果主模型支持 Function Calling，备用模型也必须支持，否则 Fallback 后功能降级。
- LiteLLM 还支持 `content_policy_fallbacks`——当主模型拒绝回答（内容策略触发）时，自动切换到策略更宽松的模型。

</details>

---

### Q04. 什么是 Virtual Key？解决什么问题？

<details>
<summary>参考答案</summary>

#### 类比理解

Virtual Key 就像酒店的房卡——你不需要知道房间锁芯的结构（真实 API Key），持有房卡（Virtual Key）就能访问授权的房间（模型）。酒店前台（网关管理员）可以随时给房卡设置权限（只能访问 3 楼）、有效期（明天退房后失效）和使用额度（一天最多开门 10 次），而无需换锁芯。

#### 核心架构

```
                   ┌──────────────────────────┐
                   │       LLM 网关           │
                   │                          │
  VK-team-a ──→   │  ┌────────────────────┐  │  ──→  sk-real-openai-key
  VK-team-b ──→   │  │  Virtual Key 管理  │  │  ──→  sk-ant-real-key
  VK-intern ──→   │  │                    │  │  ──→  AIza-real-google-key
                   │  │  • 权限映射       │  │
                   │  │  • 配额追踪       │  │
                   │  │  • 审计日志       │  │
                   │  └────────────────────┘  │
                   └──────────────────────────┘
```

Virtual Key 是 LLM 网关对真实 API Key 的抽象代理层，解决以下问题：

| 问题 | 无 Virtual Key | 有 Virtual Key |
| --- | --- | --- |
| Key 泄露风险 | 真实 Key 分发给各团队，泄露后影响全局 | 真实 Key 只存在网关，VK 泄露可单独撤销 |
| 成本归属 | 所有调用都用同一个 Key，无法区分来源 | 每个 VK 独立计费，精确到团队/项目 |
| 权限控制 | 持有 Key 可调用所有模型 | VK 可限制仅访问特定模型/功能 |
| Key 轮转 | 需要通知所有使用者更新 | 只需更新网关内的真实 Key 映射 |
| 配额管理 | 依赖 Provider 侧限流 | 网关侧自定义 RPM/TPM/预算上限 |

#### 实际配置示例

```yaml
# LiteLLM Virtual Key 配置
virtual_keys:
  - key: "vk-team-frontend-xxx"
    team_id: "frontend"
    max_budget: 500          # 月预算 $500
    max_parallel_requests: 20
    allowed_models:
      - "gpt-4o-mini"        # 只允许使用低成本模型
      - "gemini-2.0-flash"
    metadata:
      project: "chatbot-v2"
      environment: "production"

  - key: "vk-team-ml-xxx"
    team_id: "ml-research"
    max_budget: 5000         # 月预算 $5000
    allowed_models:
      - "gpt-4o"
      - "claude-sonnet-4-20250514"
      - "o3"                 # ML 团队可用推理模型
    tpm_limit: 1000000       # Token 每分钟上限
    rpm_limit: 500           # 请求每分钟上限
```

**关键知识点**

- Virtual Key 本质上是 API Gateway 的 **API Key Management** 能力在 LLM 领域的应用，但增加了 Token 计费、模型权限等 LLM 特有维度。
- 在 LiteLLM 中，Virtual Key 与 Team/Organization 概念关联，支持层级化管理（Organization → Team → User → Key）。
- Virtual Key 的审计日志记录每次调用的 model、token 用量、延迟和成本，是实现成本报表的基础数据源。

</details>

---

### Q05. LLM 应用的可观测性与传统应用有什么不同？

<details>
<summary>参考答案</summary>

#### 类比理解

传统应用的可观测性就像监控一条流水线——你关心的是每个工位的速度（延迟）、次品率（错误率）、产量（吞吐量）。LLM 应用的可观测性更像监控一个"自由创作的画师"——除了画得快不快（延迟），你还要关心画得好不好（质量评估）、用了多少颜料（Token 成本）、有没有画出不该画的东西（安全合规）。

#### 核心差异

| 维度 | 传统应用 | LLM 应用 |
| --- | --- | --- |
| **核心指标** | 延迟、错误率、吞吐量 | +TTFT、TBT、Token 用量、质量评分 |
| **输出确定性** | 确定性（相同输入=相同输出） | 非确定性（相同 Prompt 输出可能不同） |
| **成本模型** | 计算资源（CPU/RAM） | Token 计费（与输入/输出长度成正比） |
| **质量度量** | 功能正确性（通过/失败） | 语义正确性（需要 LLM-as-Judge） |
| **链路追踪** | Request → Service → DB | Prompt → Model → Tool Call → Model → Response |
| **安全监控** | SQL 注入、XSS | Prompt Injection、PII 泄露、幻觉 |

#### LLM 特有的可观测性指标

```python
# Langfuse 可观测性集成示例
from langfuse import Langfuse
from langfuse.decorators import observe, langfuse_context

langfuse = Langfuse()

@observe()  # 自动创建 trace
def chat_handler(user_message: str) -> str:
    # 自动记录：输入/输出/延迟/Token/成本
    response = litellm.completion(
        model="gpt-4o",
        messages=[{"role": "user", "content": user_message}],
        metadata={"langfuse_trace_id": langfuse_context.get_current_trace_id()}
    )

    # 记录自定义评估分数
    langfuse_context.score_current_trace(
        name="relevance",
        value=0.95,
        comment="响应与问题高度相关"
    )

    return response.choices[0].message.content
```

**LLM 应用关键指标体系**：

```
性能指标
├── TTFT（Time to First Token）：首 Token 延迟，影响用户感知
├── TBT（Time Between Tokens）：Token 间隔，影响流式体验
├── E2E Latency：端到端延迟（含网关开销）
└── Throughput：RPM / TPM

质量指标
├── 准确率/相关性：LLM-as-Judge 自动评分
├── 幻觉率：事实核查评估
├── 格式遵从率：结构化输出的 schema 校验通过率
└── 工具调用成功率

成本指标
├── Token 用量（Input / Output / Cached）
├── 单次请求成本
├── 每用户/每会话成本
└── 缓存命中率

安全指标
├── Prompt Injection 检测率
├── PII 泄露事件数
└── 内容策略违规率
```

**关键知识点**

- Langfuse 基于 ClickHouse 存储海量 trace 数据，支持毫秒级查询；与 LiteLLM 原生集成，只需设置 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 环境变量。
- 传统 APM（Datadog/New Relic）监控的是"请求级别"，而 LLM 可观测性需要深入到"generation 级别"——一次请求可能包含多轮 LLM 调用、工具调用和检索操作。
- OpenAI Agents SDK 内置了 Tracing 功能，自动记录 Agent 的 handoff、tool call、guardrail 检查等操作，支持导出到 Langfuse 等外部平台。

</details>

---

### Q06. Prompt 管理为什么需要版本控制？

<details>
<summary>参考答案</summary>

#### 类比理解

Prompt 版本控制就像药品的配方管理——每次调整配方（修改 Prompt）都需要记录变更原因、做临床试验（A/B 测试），确认新配方效果更好后才能投入生产。如果新配方有副作用（输出质量下降），能立即回滚到上一版。没有版本控制的 Prompt 修改就像在生产线上随手改配方——出了问题根本查不到改了什么。

#### 核心原因

| 原因 | 说明 |
| --- | --- |
| **非确定性验证** | Prompt 微小改动可能导致输出质量巨变，需要 A/B 测试对比 |
| **回滚能力** | 新 Prompt 上线后发现幻觉率上升，需要立即回退 |
| **协作管理** | 产品经理调 Prompt 时可能破坏工程师设计的结构化输出格式 |
| **审计合规** | 金融/医疗场景需要记录每次 Prompt 变更的时间、人员、原因 |
| **环境隔离** | dev/staging/prod 使用不同版本的 Prompt，防止未测试版本泄入生产 |

#### 实际方案

```python
# Langfuse Prompt 管理示例
from langfuse import Langfuse

langfuse = Langfuse()

# 获取生产环境的 Prompt（带版本和标签）
prompt = langfuse.get_prompt(
    name="chat-system-prompt",
    label="production",     # 环境标签
    # version=3,            # 或指定具体版本
    cache_ttl_seconds=300   # 本地缓存 5 分钟
)

# Prompt 模板支持变量替换
compiled = prompt.compile(
    user_name="张三",
    language="中文",
    max_length="500字"
)

# 使用编译后的 Prompt
response = litellm.completion(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": compiled},
        {"role": "user", "content": user_input}
    ],
    metadata={
        "prompt_name": prompt.name,
        "prompt_version": prompt.version  # 自动关联到 trace
    }
)
```

**Prompt 生命周期管理**：

```
编辑 → 测试 → 标记 staging → 评估 → 标记 production → 监控 → 迭代
  │                                                          │
  └──────────────── 发现问题，回滚到上一版 ←─────────────────┘
```

**关键知识点**

- Langfuse 的 Prompt 管理支持**文本 Prompt** 和**聊天 Prompt**（多条 message 模板），版本号自动递增。
- Prompt 版本关联到 Trace，可以对比不同版本 Prompt 的质量指标（成本、延迟、评估分数），实现数据驱动的 Prompt 优化。
- PydanticAI 提供类型安全的 Prompt 构建方式——通过依赖注入（`RunContext`）动态填充 Prompt 变量，避免字符串拼接错误。

</details>

---

### Q07. 什么是 MCP 协议？解决什么问题？

<details>
<summary>参考答案</summary>

#### 类比理解

MCP（Model Context Protocol）就像 USB 协议——在 USB 出现之前，每种外设（打印机、键盘、相机）都需要专用的接口和驱动。USB 统一了接口标准后，任何设备即插即用。MCP 做的是同样的事：统一 AI 模型访问外部工具和数据源的协议，让任何 MCP 兼容的工具可以被任何 MCP 兼容的 AI 应用使用。

#### 协议架构

```
┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ ←─────→ │   MCP Server    │
│  (AI 应用/Agent) │  JSON-RPC │  (工具/数据提供者) │
│                 │   over    │                 │
│  • Claude       │  stdio/   │  • 文件系统     │
│  • VS Code      │  SSE/     │  • 数据库       │
│  • Custom App   │  HTTP     │  • GitHub API   │
└─────────────────┘         │  • Slack         │
                            └─────────────────┘
```

MCP 定义了三种核心能力：

| 能力 | 说明 | 示例 |
| --- | --- | --- |
| **Tools** | 可执行的操作 | 查询数据库、发送邮件、创建 PR |
| **Resources** | 可读取的数据源 | 文件内容、API 文档、配置信息 |
| **Prompts** | 可复用的提示模板 | 代码审查模板、SQL 生成模板 |

```python
# MCP Server 示例（Python SDK）
from mcp.server import Server
from mcp.types import Tool

server = Server("my-tools")

@server.tool()
async def query_database(sql: str) -> str:
    """执行 SQL 查询并返回结果"""
    result = await db.execute(sql)
    return json.dumps(result)

@server.tool()
async def search_documents(query: str, top_k: int = 5) -> str:
    """语义搜索文档库"""
    results = await vector_store.search(query, limit=top_k)
    return json.dumps(results)

# PydanticAI 集成 MCP
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

agent = Agent(
    "openai:gpt-4o",
    mcp_servers=[
        MCPServerStdio("npx", ["-y", "@modelcontextprotocol/server-filesystem", "/data"])
    ]
)
```

**关键知识点**

- MCP 由 Anthropic 于 2024 年 11 月发布，已获得 OpenAI、Google、Microsoft 等主要 AI 公司的支持。
- MCP 解决的是"M×N 问题"——M 个 AI 应用和 N 个工具之间的集成从 M×N 降低到 M+N。
- MCP 与 Function Calling 的区别：Function Calling 是模型决定调用哪个函数的能力，MCP 是定义和发现可用工具的协议。两者互补：MCP 告诉模型"有哪些工具可用"，Function Calling 让模型"决定调用哪个工具"。
- Google ADK 和 PydanticAI 均原生支持 MCP Server 集成。

</details>

---

### Q08. Token 计费模型如何工作？

<details>
<summary>参考答案</summary>

#### 类比理解

Token 计费就像出租车打表——不按"乘坐次数"收费，而按"行驶距离"（Token 数量）计费。而且上车（输入 Token）和下车（输出 Token）的单价不同，下车通常更贵（输出 Token 单价是输入的 2-4 倍），因为出租车需要"思考路线"（模型推理）。

#### Token 计费结构

```python
# Token 计费公式
总成本 = 输入Token数 × 输入单价 + 输出Token数 × 输出单价

# 2025 年主流模型定价对比（每百万 Token）
pricing = {
    "gpt-4o":         {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":    {"input": 0.15,  "output": 0.60},
    "claude-sonnet":  {"input": 3.00,  "output": 15.00},
    "claude-haiku":   {"input": 0.25,  "output": 1.25},
    "gemini-2-flash": {"input": 0.075, "output": 0.30},
    "deepseek-v3":    {"input": 0.27,  "output": 1.10},
}
```

#### Token 化过程

```python
import tiktoken

# GPT-4o 使用 o200k_base 编码
enc = tiktoken.encoding_for_model("gpt-4o")

text = "什么是 LLM 网关？"
tokens = enc.encode(text)
print(f"Token 数量: {len(tokens)}")  # 中文每个字约 1-2 个 token
print(f"Token IDs: {tokens}")

# 不同语言的 Token 效率差异
english = enc.encode("What is an LLM gateway?")  # ~6 tokens
chinese = enc.encode("什么是 LLM 网关？")          # ~8 tokens
# 中文 Token 效率略低于英文
```

#### 特殊计费项

| 类型 | 说明 | 定价特点 |
| --- | --- | --- |
| **Cached Token** | Prompt Caching 命中的 Token | 通常为输入价的 50%-90% 折扣 |
| **Reasoning Token** | 推理模型内部思考的 Token（o1/o3） | 按输出 Token 价格计费但不返回 |
| **Batch API** | 批量异步请求 | 通常 50% 折扣，24 小时内返回 |
| **Image Token** | 图像转换为 Token | 按分辨率折算，一张图约 85-1105 token |

```python
# 成本计算示例
def calculate_cost(model: str, input_tokens: int, output_tokens: int,
                   cached_tokens: int = 0) -> float:
    price = pricing[model]
    input_cost = (input_tokens - cached_tokens) * price["input"] / 1_000_000
    cached_cost = cached_tokens * price["input"] * 0.5 / 1_000_000  # 缓存50%折扣
    output_cost = output_tokens * price["output"] / 1_000_000
    return input_cost + cached_cost + output_cost

# 一次 GPT-4o 调用
cost = calculate_cost("gpt-4o", input_tokens=1000, output_tokens=500, cached_tokens=800)
print(f"成本: ${cost:.4f}")  # ≈ $0.0060
```

**关键知识点**

- Token ≠ 字符 ≠ 单词。英文中 1 token ≈ 0.75 个单词；中文中 1 个汉字约 1-2 个 token。
- LiteLLM 内置了各 Provider 的定价表，可自动计算每次调用的成本，并通过 `response_cost` 字段返回。
- 推理模型（o1/o3/DeepSeek-R1）的 Reasoning Token 是"隐形成本"——用户看不到推理过程，但按输出 Token 价格计费。一次复杂推理可能产生数千个 Reasoning Token。

</details>

---

## ⭐⭐ 进阶题（10 题）

---

### Q09. 设计一个多模型智能路由器（考虑延迟、成本、质量）

<details>
<summary>参考答案</summary>

#### 设计思路

多模型智能路由器的核心问题是：**给定一个请求，选择"最优"的模型去处理**。但"最优"在不同场景下有不同定义——有时需要最快响应（用户在等），有时需要最低成本（后台批处理），有时需要最高质量（关键业务决策）。

#### 路由策略矩阵

```
┌──────────────────────────────────────────────────┐
│              智能路由决策引擎                      │
│                                                  │
│  输入：请求内容 + 路由策略 + 实时指标             │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ 成本优先 │ │ 延迟优先 │ │ 质量优先 │         │
│  │          │ │          │ │          │         │
│  │ GPT-4o-  │ │ Gemini   │ │ Claude   │         │
│  │ mini     │ │ Flash    │ │ Sonnet   │         │
│  │ DeepSeek │ │ GPT-4o-  │ │ GPT-4o   │         │
│  │          │ │ mini     │ │ o3       │         │
│  └──────────┘ └──────────┘ └──────────┘         │
│                                                  │
│  动态调整因素：                                   │
│  • Provider 实时健康状态                          │
│  • 当前延迟 P95                                  │
│  • 剩余预算                                      │
│  • 请求复杂度评估                                │
└──────────────────────────────────────────────────┘
```

#### 实现方案

```python
from litellm import Router
from enum import Enum

class RoutingStrategy(Enum):
    COST = "cost-optimized"
    LATENCY = "latency-optimized"
    QUALITY = "quality-optimized"
    SMART = "smart"  # 综合考量

# LiteLLM Router 配置
router = Router(
    model_list=[
        # 高质量模型
        {
            "model_name": "smart-model",
            "litellm_params": {"model": "openai/gpt-4o"},
            "model_info": {"tier": "premium", "cost_per_1k_input": 0.0025}
        },
        # 快速模型
        {
            "model_name": "smart-model",
            "litellm_params": {"model": "gemini/gemini-2.0-flash"},
            "model_info": {"tier": "fast", "cost_per_1k_input": 0.000075}
        },
        # 低成本模型
        {
            "model_name": "smart-model",
            "litellm_params": {"model": "openai/gpt-4o-mini"},
            "model_info": {"tier": "economy", "cost_per_1k_input": 0.00015}
        },
    ],

    # 路由策略
    routing_strategy="latency-based-routing",  # 延迟优先
    # 其他选项: "simple-shuffle", "least-busy", "cost-based-routing"

    # 全局配置
    num_retries=2,
    timeout=30,
    fallbacks=[{"smart-model": ["fallback-model"]}],

    # 冷却机制：模型连续失败后暂停使用
    cooldown_time=60,          # 冷却 60 秒
    allowed_fails=3,           # 连续失败 3 次后冷却
)

# 高级路由：基于请求复杂度的智能分发
class SmartRouter:
    """根据请求特征自动选择模型"""

    def __init__(self, router: Router):
        self.router = router

    async def route(self, messages: list, strategy: RoutingStrategy) -> dict:
        # 1. 评估请求复杂度
        complexity = self._assess_complexity(messages)

        # 2. 根据策略选择模型
        if strategy == RoutingStrategy.COST:
            model = self._select_cheapest(complexity)
        elif strategy == RoutingStrategy.LATENCY:
            model = self._select_fastest(complexity)
        elif strategy == RoutingStrategy.QUALITY:
            model = self._select_best_quality(complexity)
        else:
            model = self._smart_select(complexity)

        return await self.router.acompletion(model=model, messages=messages)

    def _assess_complexity(self, messages: list) -> str:
        """评估请求复杂度：simple / moderate / complex"""
        total_tokens = sum(len(m["content"]) for m in messages) // 4
        has_system_prompt = any(m["role"] == "system" for m in messages)
        last_msg = messages[-1]["content"]

        # 简单规则引擎（生产环境可用分类模型）
        if total_tokens < 100 and not has_system_prompt:
            return "simple"
        elif "设计" in last_msg or "分析" in last_msg or total_tokens > 2000:
            return "complex"
        return "moderate"

    def _smart_select(self, complexity: str) -> str:
        """综合策略：复杂任务用强模型，简单任务用快模型"""
        model_map = {
            "simple": "gpt-4o-mini",
            "moderate": "gemini/gemini-2.0-flash",
            "complex": "openai/gpt-4o"
        }
        return model_map[complexity]
```

#### 模型级联（Cascade）模式

```
请求到达
  │
  ▼
小模型(GPT-4o-mini) ──→ 置信度检查
  │                        │
  │                    置信度 > 0.9 ──→ 直接返回（低成本）
  │                        │
  │                    置信度 ≤ 0.9
  │                        │
  ▼                        ▼
                    大模型(GPT-4o) ──→ 返回（高质量）
```

```python
async def cascade_route(messages: list) -> dict:
    """模型级联：先用小模型，不确定时升级到大模型"""
    # 第一级：低成本模型
    response = await litellm.acompletion(
        model="gpt-4o-mini",
        messages=messages,
        logprobs=True,
        top_logprobs=5
    )

    # 评估置信度（基于 logprobs）
    avg_logprob = calculate_avg_logprob(response)
    if avg_logprob > -0.3:  # 高置信度阈值
        return response

    # 第二级：高质量模型
    return await litellm.acompletion(
        model="gpt-4o",
        messages=messages
    )
```

**关键知识点**

- LiteLLM Router 支持四种内置路由策略：`simple-shuffle`（随机）、`least-busy`（最少请求）、`latency-based-routing`（延迟最低）、`cost-based-routing`（成本最低）。
- 模型级联（Cascade）可降低 30-50% 成本——大部分简单请求被小模型拦截，只有困难请求才升级到大模型。
- Google ADK 的 `adk eval` 工具可用于评估不同路由策略下的模型输出质量，帮助确定级联阈值。

</details>

---

### Q10. LiteLLM 如何实现 100+ provider 的适配？

<details>
<summary>参考答案</summary>

#### 架构设计

LiteLLM 的核心设计思想是 **Adapter Pattern（适配器模式）**——定义统一的输入/输出接口（OpenAI Chat Completions 格式），为每个 Provider 实现一个适配器，将统一格式转换为 Provider 原生格式。

```
                    统一入口
                      │
              litellm.completion()
                      │
            ┌─────────┼─────────┐
            ▼         ▼         ▼
     ┌──────────┐ ┌───────┐ ┌────────┐
     │ OpenAI   │ │Claude │ │Gemini  │
     │ Adapter  │ │Adapter│ │Adapter │
     │          │ │       │ │        │
     │ 透传请求 │ │Messages│ │GenerateContent
     │          │ │API转换 │ │API 转换 │
     └──────────┘ └───────┘ └────────┘
            │         │         │
            ▼         ▼         ▼
      OpenAI API  Anthropic  Google AI
```

#### 适配器核心逻辑

```python
# 简化的适配器架构示例
class BaseLLMAdapter:
    """所有 Provider 适配器的基类"""

    def transform_request(self, openai_request: dict) -> dict:
        """将 OpenAI 格式请求转换为 Provider 原生格式"""
        raise NotImplementedError

    def transform_response(self, provider_response: dict) -> dict:
        """将 Provider 原生响应转换为 OpenAI 格式"""
        raise NotImplementedError

    def get_model_info(self, model: str) -> dict:
        """返回模型元信息（上下文窗口、定价、能力）"""
        raise NotImplementedError


class AnthropicAdapter(BaseLLMAdapter):
    """Anthropic Claude 适配器"""

    def transform_request(self, openai_request: dict) -> dict:
        messages = openai_request["messages"]

        # 关键转换1：system message 提取为顶级参数
        system = None
        converted_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system = msg["content"]
            else:
                converted_messages.append(msg)

        # 关键转换2：参数名映射
        anthropic_request = {
            "model": self._map_model_name(openai_request["model"]),
            "messages": converted_messages,
            "max_tokens": openai_request.get("max_tokens", 4096),
        }
        if system:
            anthropic_request["system"] = system

        # 关键转换3：tool_choice 格式差异
        if "tools" in openai_request:
            anthropic_request["tools"] = [
                self._convert_tool(t) for t in openai_request["tools"]
            ]

        return anthropic_request

    def transform_response(self, response: dict) -> dict:
        """将 Anthropic 响应转为 OpenAI 格式"""
        return {
            "id": response["id"],
            "object": "chat.completion",
            "model": response["model"],
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": self._extract_text(response["content"])
                },
                "finish_reason": self._map_stop_reason(response["stop_reason"])
            }],
            "usage": {
                "prompt_tokens": response["usage"]["input_tokens"],
                "completion_tokens": response["usage"]["output_tokens"],
                "total_tokens": (
                    response["usage"]["input_tokens"]
                    + response["usage"]["output_tokens"]
                )
            }
        }
```

#### Provider 注册与发现

```python
# LiteLLM 的模型-Provider 映射（简化）
MODEL_PROVIDER_MAP = {
    "gpt-":       "openai",
    "o1":         "openai",
    "o3":         "openai",
    "claude-":    "anthropic",
    "gemini/":    "google",
    "ollama/":    "ollama",
    "bedrock/":   "aws_bedrock",
    "azure/":     "azure",
    "deepseek/":  "deepseek",
    "together_ai/": "together_ai",
    # ... 100+ providers
}

def get_provider(model: str) -> str:
    """根据模型名前缀自动识别 Provider"""
    for prefix, provider in MODEL_PROVIDER_MAP.items():
        if model.startswith(prefix):
            return provider
    raise ValueError(f"Unknown model: {model}")
```

#### 适配挑战

| 差异点 | OpenAI | Anthropic | Google |
| --- | --- | --- | --- |
| System Message | `messages` 数组内 | 顶级 `system` 参数 | `system_instruction` |
| 流式格式 | `data: {...}\n\n` | `event: content_block_delta` | 自定义 SSE |
| Tool Call | `tool_calls` 数组 | `content` 数组含 `tool_use` | `function_call` |
| 停止原因 | `stop` / `tool_calls` | `end_turn` / `tool_use` | `STOP` / `SAFETY` |
| Token 统计 | `usage.prompt_tokens` | `usage.input_tokens` | `usageMetadata` |

**关键知识点**

- LiteLLM 对每个 Provider 维护独立的适配器文件（如 `litellm/llms/anthropic/`），包括请求转换、响应转换、流式处理、错误映射四个核心模块。
- 流式响应的适配最复杂——各 Provider 的 SSE 格式、chunk 结构、结束标志都不同，LiteLLM 在内部统一转换为 OpenAI 的 `ChatCompletionChunk` 格式。
- LiteLLM 被 OpenAI Agents SDK 用作多 Provider 支持的基础层（通过 `litellm` 作为 model client），也被 Google ADK 用于非 Google 模型的接入。
- Instructor（3M+ 下载量）同样基于 LiteLLM 实现多 Provider 结构化输出，通过 `instructor.from_litellm()` 一行代码集成。

</details>

---

### Q11. Langfuse 的 trace/span 模型如何设计？

<details>
<summary>参考答案</summary>

#### 类比理解

Langfuse 的 trace 模型就像一本"调查日记"——每次用户提问是一个**案件**（Trace），调查过程中的每个步骤（查资料、问证人、做实验）是**调查行动**（Span），其中每次"请 AI 专家分析"是特殊的行动类型（Generation）。所有行动按时间线串联，形成完整的调查报告，方便事后复盘。

#### 三层数据模型

```
Trace（一次完整的用户交互）
│
├── Span: "检索相关文档"
│     ├── 输入: query = "什么是 LLM 网关"
│     ├── 输出: [doc1, doc2, doc3]
│     ├── 耗时: 120ms
│     └── 元数据: {retriever: "hybrid", top_k: 5}
│
├── Generation: "LLM 调用 #1"
│     ├── 模型: gpt-4o
│     ├── 输入: messages[...]
│     ├── 输出: "LLM 网关是..."
│     ├── Token: {input: 850, output: 320, total: 1170}
│     ├── 成本: $0.0044
│     ├── 耗时: 1.2s (TTFT: 180ms)
│     └── 元数据: {temperature: 0.7, prompt_version: 3}
│
├── Span: "工具调用 - 数据库查询"
│     ├── Generation: "LLM 决定工具参数"
│     ├── Span: "执行 SQL"
│     └── Generation: "LLM 处理工具结果"
│
├── Generation: "LLM 调用 #2（最终回答）"
│
└── Score: {relevance: 0.92, faithfulness: 0.88}
```

#### 核心数据结构

```python
# Langfuse Python SDK 集成示例
from langfuse.decorators import observe, langfuse_context

@observe()  # 自动创建 Trace
async def handle_chat(user_id: str, message: str) -> str:
    # 更新 trace 元数据
    langfuse_context.update_current_trace(
        user_id=user_id,
        session_id=session_id,
        tags=["production", "chatbot-v2"]
    )

    # 自动创建 Span
    docs = await retrieve_documents(message)

    # 自动创建 Generation
    response = await generate_answer(message, docs)

    # 添加评估分数
    langfuse_context.score_current_trace(
        name="user_feedback",
        value=1,  # 用户点赞
        data_type="BOOLEAN"
    )

    return response

@observe()  # 嵌套 Span
async def retrieve_documents(query: str) -> list:
    embeddings = await embed(query)
    results = await vector_db.search(embeddings, top_k=5)
    return results

@observe(as_type="generation")  # 标记为 Generation
async def generate_answer(query: str, docs: list) -> str:
    response = await litellm.acompletion(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": f"基于以下文档回答：{docs}"},
            {"role": "user", "content": query}
        ]
    )
    return response.choices[0].message.content
```

#### 底层存储架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  SDK / API  │ ──→ │  Ingestion   │ ──→ │  ClickHouse     │
│  (异步批量)  │     │  Pipeline    │     │  (列式存储)      │
│             │     │              │     │                 │
│  批量发送   │     │  • 去重      │     │  • traces 表    │
│  (flush)    │     │  • 验证      │     │  • observations │
│             │     │  • 分区      │     │  • scores 表    │
└─────────────┘     └──────────────┘     └─────────────────┘
                                                │
                                          ┌─────┴──────┐
                                          │  Dashboard  │
                                          │  • 延迟分布  │
                                          │  • 成本追踪  │
                                          │  • 质量趋势  │
                                          └────────────┘
```

**关键知识点**

- Langfuse 使用 ClickHouse 作为底层存储引擎——列式存储天然适合 OLAP 分析场景（按时间范围、模型、用户维度的聚合查询）。
- **Trace → Span → Generation** 三层嵌套支持任意深度，与 OpenTelemetry 的 Trace/Span 模型一致，但增加了 LLM 特有的 `Generation` 类型（记录 Token 用量、模型、成本）。
- Langfuse 是 MIT 开源、可自托管的，支持 Docker Compose 或 Kubernetes 部署，数据完全控制在自己手中。
- OpenAI Agents SDK 的内置 Tracing 也采用类似的 trace/span 结构，支持通过 `TracingProcessor` 导出到 Langfuse。

</details>

---

### Q12. 如何实现语义缓存（Semantic Caching）？

<details>
<summary>参考答案</summary>

#### 类比理解

传统缓存就像字典查词——必须输入完全一样的词才能命中。语义缓存就像一个聪明的图书管理员——你问"推荐学 Python 的书"和"有没有 Python 入门教材"，管理员知道你在问同一件事，直接给你之前准备好的答案，而不用再去书库找一遍。

#### 工作原理

```
用户请求
  │
  ▼
1. 将请求 Embedding 化
  │
  ▼
2. 在向量数据库中搜索相似请求
  │
  ├── 相似度 > 阈值 (如 0.95) ──→ 返回缓存的响应（Cache Hit）
  │
  └── 相似度 ≤ 阈值 ──→ 调用 LLM 获取响应
                           │
                           ▼
                      3. 存储 <请求Embedding, 响应> 到向量数据库
                           │
                           ▼
                      返回 LLM 响应（Cache Miss）
```

#### 实现方案

```python
import numpy as np
from redis import Redis
from litellm import completion, embedding

class SemanticCache:
    def __init__(self, similarity_threshold: float = 0.95, ttl: int = 3600):
        self.threshold = similarity_threshold
        self.ttl = ttl
        self.redis = Redis()  # 使用 Redis + RedisVL 或自建向量索引

    async def get_or_compute(self, messages: list, model: str) -> dict:
        # 1. 生成请求的 Embedding
        cache_key = self._build_cache_key(messages)
        query_embedding = await self._embed(cache_key)

        # 2. 搜索语义相似的缓存条目
        cached = await self._search_similar(query_embedding)
        if cached and cached["similarity"] >= self.threshold:
            return {
                **cached["response"],
                "_cache_hit": True,
                "_similarity": cached["similarity"]
            }

        # 3. Cache Miss - 调用 LLM
        response = await completion(model=model, messages=messages)

        # 4. 存储到缓存
        await self._store(query_embedding, cache_key, response, ttl=self.ttl)

        return {**response, "_cache_hit": False}

    async def _embed(self, text: str) -> list[float]:
        """使用 Embedding 模型生成向量"""
        result = await embedding(
            model="text-embedding-3-small",
            input=text
        )
        return result.data[0].embedding

    def _build_cache_key(self, messages: list) -> str:
        """提取用于缓存匹配的关键信息"""
        # 只用最后一条用户消息 + system prompt 的 hash
        user_msg = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"),
            ""
        )
        system_hash = hashlib.md5(
            next((m["content"] for m in messages if m["role"] == "system"), "").encode()
        ).hexdigest()[:8]
        return f"{system_hash}:{user_msg}"

    async def _search_similar(self, embedding: list[float]) -> dict | None:
        """在向量索引中搜索最相似的缓存条目"""
        # 使用余弦相似度搜索
        results = await self.vector_index.search(
            embedding,
            top_k=1,
            score_threshold=self.threshold
        )
        if results:
            return {
                "response": json.loads(results[0].metadata["response"]),
                "similarity": results[0].score
            }
        return None
```

#### 语义缓存的关键参数

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| 相似度阈值 | 0.92-0.98 | 太低会返回不相关缓存；太高失去语义匹配意义 |
| TTL | 1-24 小时 | 根据数据时效性调整；新闻类短，知识类长 |
| Embedding 模型 | text-embedding-3-small | 性价比最高；对缓存匹配精度要求高用 large |
| 缓存 Key 策略 | 用户消息 + System Hash | 不同 System Prompt 的同一问题应视为不同请求 |

**关键知识点**

- 语义缓存的核心权衡是**命中率 vs 准确率**——阈值越低命中率越高但误匹配风险越大。建议从 0.95 开始调优，逐步放宽。
- LiteLLM 内置语义缓存支持，通过 `litellm.cache = Cache(type="redis")` 开启，底层使用 Redis 向量搜索。
- 语义缓存不适用于需要实时数据的场景（如"现在几点"）和个性化内容（不同用户问同一问题期望不同风格回答）。
- 缓存命中率 30-50% 的系统，仅此一项即可降低 30-50% 的 LLM API 成本。

</details>

---

### Q13. A2A 协议的工作原理及与 MCP 的区别？

<details>
<summary>参考答案</summary>

#### 类比理解

如果 MCP 是"人与工具的交互协议"（像一个人操作各种电器），那 A2A 就是"人与人的合作协议"（像一个团队的协作规范）。MCP 让 Agent 能使用工具（查数据库、发邮件），A2A 让 Agent 之间能分工合作（"你负责数据分析，我负责报告撰写"）。两者互补，不竞争。

#### A2A 协议架构

```
┌────────────────┐        A2A Protocol        ┌────────────────┐
│  Client Agent  │ ←─────────────────────────→ │  Remote Agent  │
│  (发起方)      │   HTTP + JSON-RPC + SSE    │  (执行方)      │
│                │                             │                │
│  1. 发现 Agent │ ──→ GET /.well-known/       │                │
│                │      agent.json             │  Agent Card:   │
│                │ ←── {name, skills, auth}    │  自我描述      │
│                │                             │                │
│  2. 创建任务   │ ──→ tasks/send              │                │
│                │ ←── {taskId, status}        │  Task 生命周期 │
│                │                             │                │
│  3. 订阅进度   │ ──→ tasks/sendSubscribe     │                │
│                │ ←── SSE events              │  流式更新      │
│                │                             │                │
│  4. 获取结果   │ ──→ tasks/get               │                │
│                │ ←── {artifacts, status}     │  结果产物      │
└────────────────┘                             └────────────────┘
```

#### Agent Card（自我描述文件）

```json
// 位于 https://agent.example.com/.well-known/agent.json
{
  "name": "Data Analysis Agent",
  "description": "Analyzes datasets and generates insights",
  "url": "https://agent.example.com",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "analyze-csv",
      "name": "CSV Data Analysis",
      "description": "Analyzes CSV files and generates statistical reports",
      "inputModes": ["text", "file"],
      "outputModes": ["text", "file"]
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

#### Task 生命周期

```
          submitted ──→ working ──→ completed
              │            │
              │            ├──→ input-required (需要人工输入)
              │            │         │
              │            │         └──→ working (收到输入后继续)
              │            │
              └────────────┴──→ failed
                               canceled
```

#### MCP vs A2A 对比

| 维度 | MCP | A2A |
| --- | --- | --- |
| **定位** | Model ↔ Tool（模型调用工具） | Agent ↔ Agent（Agent 间协作） |
| **发起者** | AI 模型主动发现和调用 | Client Agent 主动发现和委派 |
| **通信模式** | 请求-响应（同步为主） | 任务生命周期（异步+流式） |
| **发现机制** | 客户端配置 MCP Server 地址 | `.well-known/agent.json` 自描述 |
| **状态管理** | 无状态工具调用 | 有状态任务管理（submitted→working→completed） |
| **适用场景** | 单 Agent 扩展能力 | 多 Agent 跨组织协作 |
| **提出方** | Anthropic | Google |

#### 两者如何协同

```
┌──────────────────────────────────────────────────┐
│                Application Agent                  │
│                                                   │
│  ┌─────────┐    ┌─────────┐    ┌──────────┐     │
│  │  MCP    │    │  A2A    │    │  MCP     │     │
│  │  Client │    │  Client │    │  Client  │     │
│  └────┬────┘    └────┬────┘    └────┬─────┘     │
│       │              │              │            │
└───────┼──────────────┼──────────────┼────────────┘
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐  ┌───────────┐  ┌──────────┐
   │MCP Server│  │Remote Agent│  │MCP Server│
   │(Database)│  │(Analysis) │  │(GitHub)  │
   └─────────┘  └───────────┘  └──────────┘
     用 MCP       用 A2A         用 MCP
     查数据      委派分析任务    创建 PR
```

**关键知识点**

- A2A 由 Google 于 2025 年 4 月发布，已获得 50+ 合作伙伴支持。Google ADK 原生集成 A2A 客户端和服务端能力。
- LiteLLM 已支持 A2A 协议——可以将远程 A2A Agent 作为 "model" 来调用，统一在路由和可观测性体系内管理。
- A2A 的 `input-required` 状态支持 Human-in-the-Loop——任务执行到需要人工确认时暂停，收到输入后继续。Google ADK 通过 tool confirmation 机制实现类似功能。
- PydanticAI 同时支持 MCP 和 A2A 集成，可以在一个 Agent 中同时使用 MCP 工具和委派任务给 A2A 远程 Agent。

</details>

---

### Q14. 如何设计 LLM 应用的评估流水线？

<details>
<summary>参考答案</summary>

#### 类比理解

LLM 评估流水线就像"产品质检线"——每次出厂的产品（模型输出）都要经过多道检测工序：外观检查（格式正确性）、功能测试（回答准确性）、安全检测（有无有害内容）、用户试用（人工评审）。只有全部通过才能上市（上线发布）。

#### 评估流水线架构

```
┌────────────────────────────────────────────────┐
│              LLM 评估流水线                      │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ 数据集   │→ │ 模型推理 │→ │ 自动评估 │     │
│  │ Dataset  │  │ Inference│  │ Scoring  │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│       │                           │            │
│       │    ┌──────────────────┐   │            │
│       └──→ │ 人工评审(抽样)   │   │            │
│            │ Human Review     │   │            │
│            └──────────────────┘   │            │
│                                   ▼            │
│                          ┌──────────────┐      │
│                          │ 报告 & 告警  │      │
│                          │ Dashboard    │      │
│                          └──────────────┘      │
└────────────────────────────────────────────────┘
```

#### 评估方法分类

| 方法 | 说明 | 适用场景 |
| --- | --- | --- |
| **精确匹配** | 输出 == 预期答案 | 分类任务、提取任务 |
| **包含检查** | 预期关键词在输出中 | 事实性问题 |
| **LLM-as-Judge** | 用另一个 LLM 评判质量 | 开放式生成、对话质量 |
| **Embedding 相似度** | 语义距离 < 阈值 | 语义等价判断 |
| **代码执行** | 运行代码检查结果 | 编码题、数学题 |
| **人工标注** | 人类专家评分 | 标杆测试、争议案例 |

#### 实际实现

```python
# 使用 Langfuse Dataset + Evaluation 构建评估流水线
from langfuse import Langfuse

langfuse = Langfuse()

# 1. 创建评估数据集
dataset = langfuse.create_dataset(
    name="gateway-routing-qa",
    description="LLM 网关路由质量评估数据集"
)

# 2. 添加测试用例
langfuse.create_dataset_item(
    dataset_name="gateway-routing-qa",
    input={"query": "帮我总结这篇文章"},
    expected_output="应路由到长上下文模型",
    metadata={"category": "routing", "difficulty": "basic"}
)

# 3. 运行评估
async def run_evaluation(dataset_name: str, model: str):
    dataset = langfuse.get_dataset(dataset_name)

    for item in dataset.items:
        # 执行推理
        response = await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": item.input["query"]}]
        )
        output = response.choices[0].message.content

        # 关联到 dataset item 的 trace
        with item.observe(run_name=f"eval-{model}") as trace:
            # 自动评估：LLM-as-Judge
            judge_score = await llm_as_judge(
                question=item.input["query"],
                answer=output,
                expected=item.expected_output
            )
            trace.score(name="correctness", value=judge_score)

            # 自动评估：格式检查
            format_ok = check_format(output, item.metadata.get("format"))
            trace.score(name="format_compliance", value=1.0 if format_ok else 0.0)


# 4. LLM-as-Judge 实现
async def llm_as_judge(question: str, answer: str, expected: str) -> float:
    judge_response = await litellm.acompletion(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": f"""评估以下回答的质量（0-1分）：

问题：{question}
预期答案：{expected}
实际回答：{answer}

评分标准：
- 1.0: 完全正确，包含所有关键信息
- 0.7-0.9: 基本正确，有部分遗漏
- 0.4-0.6: 部分正确，有明显遗漏或错误
- 0.0-0.3: 大部分错误或完全无关

请只输出一个 0-1 之间的数字。"""
        }],
        temperature=0
    )
    return float(judge_response.choices[0].message.content.strip())
```

#### Google ADK 评估集成

```bash
# Google ADK 的 adk eval 命令行工具
adk eval \
  --agent my_agent \
  --eval_set eval_data.json \
  --metrics correctness,safety,latency \
  --output_dir eval_results/

# eval_data.json 格式
[
  {
    "input": "帮我查询上周的销售数据",
    "expected_tool_calls": ["query_database"],
    "expected_output_contains": ["销售额", "同比"]
  }
]
```

**关键知识点**

- **LLM-as-Judge 的局限性**：评判模型自身也有偏差（如偏好较长的回答），建议使用比被评估模型更强的模型做评判（如用 GPT-4o 评判 GPT-4o-mini）。
- Langfuse Dataset 支持版本化管理测试用例，可以追踪同一数据集在不同模型/Prompt 版本上的分数变化趋势。
- PydanticAI 内置评估框架 `pydantic_ai.evals`，与 pytest 集成，支持在 CI 中运行评估并设置质量门槛（如"correctness 均分 > 0.85 才允许合并"）。
- Google ADK 的 `adk eval` 不仅评估文本输出质量，还评估工具调用的正确性（是否调用了正确的工具、参数是否正确）。

</details>

---

### Q15. Prompt Caching 的工作原理（Anthropic vs Google）？

<details>
<summary>参考答案</summary>

#### 类比理解

Prompt Caching 就像考试时的"开卷笔记"——你把常用的公式和知识点提前写好（System Prompt + 固定上下文），考试时只需要翻到对应页（缓存命中），不用重新理解和记忆。每次考试（请求）变化的只是具体的题目（用户消息），固定的知识库不需要重复处理。

#### 工作原理

```
                     请求 1（冷启动）
                     ┌──────────────────────────────────┐
                     │ [System Prompt   ] [Context Docs ] │ ← 全部处理
                     │     500 tokens      2000 tokens   │     = 2500 tokens
                     │ [User Message                    ] │
                     │     100 tokens                    │
                     └──────────────────────────────────┘
                     总处理: 2600 tokens（全价）


                     请求 2（缓存命中）
                     ┌──────────────────────────────────┐
                     │ [System Prompt   ] [Context Docs ] │ ← 缓存命中！
                     │     500 tokens      2000 tokens   │     跳过处理
                     │ [User Message（新）               ] │ ← 只处理这部分
                     │     120 tokens                    │
                     └──────────────────────────────────┘
                     总处理: 120 tokens 新 + 2500 tokens 缓存（折扣价）
```

#### Anthropic vs Google 实现对比

| 维度 | Anthropic (Claude) | Google (Gemini) |
| --- | --- | --- |
| **触发方式** | 显式标记 `cache_control` | 自动缓存（无需标记） |
| **最小 Token 数** | 1024 tokens | 无最小限制 |
| **缓存有效期** | 5 分钟（可设 ephemeral） | 自动管理 |
| **价格折扣** | 缓存读取 90% 折扣 | 缓存读取 75% 折扣 |
| **写入成本** | 缓存写入加价 25% | 无额外写入成本 |
| **支持的内容** | System/Messages/Tools | 所有内容自动缓存 |

#### Anthropic 显式缓存

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "你是一个代码审查助手...(长 system prompt)...",
            "cache_control": {"type": "ephemeral"}  # 标记缓存
        }
    ],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "(大量代码上下文)...",
                    "cache_control": {"type": "ephemeral"}  # 标记缓存
                },
                {
                    "type": "text",
                    "text": "请审查这段代码"  # 每次变化的部分
                }
            ]
        }
    ]
)

# 检查缓存使用情况
print(response.usage)
# {
#   "input_tokens": 120,        # 新处理的 token
#   "cache_creation_input_tokens": 2500,  # 首次缓存写入
#   "cache_read_input_tokens": 0,         # 缓存读取
#   "output_tokens": 350
# }

# 第二次请求（缓存命中）
# {
#   "input_tokens": 150,
#   "cache_creation_input_tokens": 0,
#   "cache_read_input_tokens": 2500,  # 缓存命中！90% 折扣
#   "output_tokens": 380
# }
```

#### 缓存友好的 Prompt 结构设计

```
┌──────────────────────────────────────┐
│  稳定区域（适合缓存）                 │
│  ├── System Prompt                    │
│  ├── 文档/知识库上下文                │  ← cache_control
│  ├── Few-shot 示例                   │
│  └── 工具定义（tools）                │
├──────────────────────────────────────┤
│  变化区域（不缓存）                   │
│  ├── 对话历史（最近几轮）             │
│  └── 当前用户消息                     │  ← 每次变化
└──────────────────────────────────────┘

原则：稳定内容放前面，变化内容放后面
```

#### 成本计算示例

```python
# 假设：System + Context = 3000 tokens，每次请求 User = 200 tokens
# 模型：Claude Sonnet（输入 $3/M tokens）

# 无缓存：每次请求成本
no_cache = 3200 * 3.0 / 1_000_000  # = $0.0096

# 有缓存：首次请求（写入缓存，加价 25%）
first_request = (3000 * 3.0 * 1.25 + 200 * 3.0) / 1_000_000  # = $0.01185

# 有缓存：后续请求（缓存命中，90% 折扣）
cached_request = (3000 * 3.0 * 0.1 + 200 * 3.0) / 1_000_000  # = $0.00150

# 10 次请求总成本对比
total_no_cache = no_cache * 10                        # = $0.096
total_cached = first_request + cached_request * 9     # = $0.0254
savings = 1 - total_cached / total_no_cache           # = 73.5% 节省
```

**关键知识点**

- Prompt Caching 的收益与"缓存前缀长度"和"请求频率"成正比——System Prompt 越长、请求越频繁，收益越大。
- Anthropic 的缓存最小 1024 tokens，如果固定前缀不足 1024 tokens 则无法使用缓存，需要填充足够长的上下文。
- OpenAI 也支持自动 Prompt Caching（2024 年 10 月起），50% 折扣，无需显式标记，128 token 最小前缀。
- LiteLLM 透传各 Provider 的缓存参数，不干扰 Provider 原生的 Prompt Caching 机制。

</details>

---

### Q16. 多租户成本分摊的实现方案？

<details>
<summary>参考答案</summary>

#### 类比理解

多租户成本分摊就像合租房的水电费分摊——每个租户（团队/项目）独立计量自己的用量（Token 消耗），月底按实际用量计算各自的费用。有人洗澡多（用了更多 GPT-4o），有人只开灯（只用 GPT-4o-mini），费用各付各的。

#### 分摊架构

```
┌──────────────────────────────────────────────────┐
│                    LLM Gateway                    │
│                                                   │
│  请求 ──→ 鉴权(Virtual Key) ──→ 标记租户信息      │
│              │                       │            │
│              ▼                       ▼            │
│        team_id: "frontend"    project: "chatbot"  │
│        user_id: "u-123"       feature: "summary"  │
│                                                   │
│  ──→ 路由到模型 ──→ 记录计量数据 ──→ 响应         │
│                         │                         │
└─────────────────────────┼─────────────────────────┘
                          │
                          ▼
                  ┌──────────────┐
                  │  计量存储     │
                  │  (ClickHouse) │
                  │              │
                  │  • team_id   │
                  │  • project   │
                  │  • model     │
                  │  • tokens    │
                  │  • cost      │
                  │  • timestamp │
                  └──────────────┘
                          │
                          ▼
                  ┌──────────────┐
                  │  成本报表     │
                  │  (Grafana)   │
                  └──────────────┘
```

#### LiteLLM 多租户成本管理

```python
# LiteLLM 的 Organization → Team → User → Key 层级
# config.yaml
general_settings:
  master_key: "sk-master-xxx"

# API 创建组织和团队
import requests

# 1. 创建组织
org = requests.post("http://litellm-proxy/organization/new", json={
    "organization_alias": "engineering-dept",
    "max_budget": 10000,  # 月预算 $10,000
    "budget_duration": "1mo"
}).json()

# 2. 在组织下创建团队
team = requests.post("http://litellm-proxy/team/new", json={
    "team_alias": "frontend-team",
    "organization_id": org["organization_id"],
    "max_budget": 2000,         # 团队月预算 $2,000
    "budget_duration": "1mo",
    "models": ["gpt-4o-mini", "gemini-2.0-flash"],  # 可用模型
    "tpm_limit": 500000,         # Token/分钟限制
}).json()

# 3. 给团队成员生成 Virtual Key
key = requests.post("http://litellm-proxy/key/generate", json={
    "team_id": team["team_id"],
    "user_id": "user-alice",
    "max_budget": 200,           # 个人月预算 $200
    "metadata": {
        "project": "chatbot-v2",
        "feature": "summarization"
    }
}).json()
```

#### 成本查询与报表

```sql
-- ClickHouse / Langfuse 成本查询

-- 按团队汇总月度成本
SELECT
    team_id,
    model,
    SUM(input_tokens) AS total_input_tokens,
    SUM(output_tokens) AS total_output_tokens,
    SUM(cost_usd) AS total_cost,
    COUNT(*) AS request_count
FROM llm_usage
WHERE timestamp >= '2025-03-01'
  AND timestamp < '2025-04-01'
GROUP BY team_id, model
ORDER BY total_cost DESC;

-- 按功能维度拆分（通过 metadata）
SELECT
    metadata->>'feature' AS feature,
    model,
    SUM(cost_usd) AS cost,
    AVG(output_tokens) AS avg_output_tokens,
    COUNT(*) AS requests
FROM llm_usage
WHERE team_id = 'frontend-team'
GROUP BY feature, model
ORDER BY cost DESC;

-- 预算消耗趋势（日粒度）
SELECT
    toDate(timestamp) AS date,
    team_id,
    SUM(cost_usd) AS daily_cost,
    SUM(SUM(cost_usd)) OVER (
        PARTITION BY team_id ORDER BY toDate(timestamp)
    ) AS cumulative_cost
FROM llm_usage
WHERE timestamp >= '2025-03-01'
GROUP BY date, team_id;
```

#### 预算告警机制

```python
# 预算使用率告警
async def check_budget_alerts():
    teams = await get_all_teams()
    for team in teams:
        usage_ratio = team.current_spend / team.max_budget
        if usage_ratio >= 0.9:
            await send_alert(
                channel="slack",
                message=f"⚠️ 团队 {team.alias} 预算使用率 {usage_ratio:.0%}，"
                        f"已用 ${team.current_spend:.2f} / ${team.max_budget:.2f}",
                severity="critical"
            )
        elif usage_ratio >= 0.7:
            await send_alert(
                channel="email",
                message=f"📊 团队 {team.alias} 预算使用率 {usage_ratio:.0%}",
                severity="warning"
            )
```

**关键知识点**

- LiteLLM 内置了完整的多租户成本管理：Organization → Team → User → Key 四级层级，每级可设独立预算和模型权限。
- Langfuse 的 trace 自动携带 `user_id`、自定义 `tags` 和 `metadata`，可按任意维度聚合成本分析。
- 成本分摊的"最后一公里"难题是**共享资源分摊**（如 System Prompt 缓存命中的成本如何分摊给多个团队），建议按请求比例分摊。
- 实际企业中，月度 LLM 费用报表通常需要导出为 CSV/PDF 格式，集成到财务系统（如 SAP/NetSuite），LiteLLM 提供 `/spend/logs` API 导出原始数据。

</details>

---

### Q17. Circuit Breaker 在 LLM 网关中的应用？

<details>
<summary>参考答案</summary>

#### 类比理解

Circuit Breaker（熔断器）就像家里的保险丝——当电路过载（Provider 持续故障）时，保险丝会"熔断"切断电路（停止向该 Provider 发请求），防止火灾（系统雪崩）。等问题修复后（冷却期结束），保险丝会"试探性"恢复（半开状态发少量请求测试），确认安全后才完全恢复供电。

#### 三态模型

```
          ┌────────────────────┐
          │                    │
          ▼                    │
     ┌──────────┐         请求成功
     │  CLOSED  │ ←────────────┤
     │  (正常)  │         ┌────┴─────┐
     └────┬─────┘         │ HALF_OPEN │
          │               │  (试探)   │
     连续失败达到阈值      └────┬─────┘
          │                    │
          ▼               请求失败
     ┌──────────┐              │
     │   OPEN   │ ─────────────┘
     │  (熔断)  │
     └────┬─────┘
          │
     冷却时间到达
          │
          ▼
     进入 HALF_OPEN
```

#### LLM 网关中的实现

```python
import time
from enum import Enum
from dataclasses import dataclass

class CircuitState(Enum):
    CLOSED = "closed"       # 正常，允许所有请求
    OPEN = "open"           # 熔断，拒绝所有请求
    HALF_OPEN = "half_open" # 试探，允许少量请求

@dataclass
class ProviderCircuit:
    provider: str
    state: CircuitState = CircuitState.CLOSED
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: float = 0
    failure_threshold: int = 5       # 连续失败 5 次触发熔断
    cooldown_seconds: int = 60       # 冷却 60 秒
    half_open_max_requests: int = 3  # 半开状态最多试探 3 个请求

    def can_execute(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        elif self.state == CircuitState.OPEN:
            # 检查冷却时间
            if time.time() - self.last_failure_time > self.cooldown_seconds:
                self.state = CircuitState.HALF_OPEN
                self.success_count = 0
                return True
            return False  # 仍在冷却中
        else:  # HALF_OPEN
            return self.success_count < self.half_open_max_requests

    def on_success(self):
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.half_open_max_requests:
                self.state = CircuitState.CLOSED  # 恢复正常
                self.failure_count = 0
        else:
            self.failure_count = 0  # 重置连续失败计数

    def on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN  # 触发熔断


# LiteLLM 内置的熔断配置
from litellm import Router

router = Router(
    model_list=[...],
    allowed_fails=5,        # 连续失败 5 次后冷却
    cooldown_time=60,       # 冷却 60 秒
    # 冷却期间自动 Fallback 到备用模型
    fallbacks=[{"primary": ["fallback-1", "fallback-2"]}]
)
```

#### LLM 网关特有的熔断考量

| 维度 | 传统微服务 | LLM 网关 |
| --- | --- | --- |
| 失败判定 | HTTP 5xx / 超时 | +429 限流 / 内容过滤拒绝 / 上下文超长 |
| 超时阈值 | 通常 1-5 秒 | LLM 推理可达 30-60 秒，需区分推理慢和真正超时 |
| 熔断粒度 | 服务级别 | Provider + Model + Region 三维度 |
| 恢复策略 | 重试原服务 | 可能需要持续 Fallback（Provider 宕机数小时） |

**关键知识点**

- LiteLLM 的 `allowed_fails` + `cooldown_time` 参数实现了 Provider 级别的熔断，冷却期间自动将请求路由到 Fallback 模型。
- 429（Rate Limit）应与 500（Server Error）区分处理——429 表示 Provider 健康但繁忙，应等待而非熔断；500 表示 Provider 故障，应触发熔断。
- 熔断器的状态应在分布式环境中共享（如通过 Redis），避免多个网关实例独立判断导致不一致。
- 生产实践中，建议对核心业务（客服、搜索）和非核心业务（内容推荐、邮件生成）使用不同的熔断阈值——核心业务更敏感，Fallback 更快。

</details>

---

### Q18. Guardrails 的输入/输出检查如何实现？

<details>
<summary>参考答案</summary>

#### 类比理解

Guardrails 就像机场安检——旅客（用户输入）登机前要过安检（输入检查），确保没有违禁品（Prompt Injection、PII 信息）。到达目的地后行李（模型输出）也要过海关检查（输出检查），确保没有走私品（有害内容、幻觉信息、格式不合规）。

#### 双向检查架构

```
     用户输入
        │
        ▼
  ┌───────────────┐
  │ 输入 Guardrail │
  │               │
  │ • Prompt      │
  │   Injection   │ ──→ 拦截 ──→ 返回错误/替代响应
  │ • PII 检测    │
  │ • 话题限制    │
  │ • 长度/格式   │
  └───────┬───────┘
          │ 通过
          ▼
     ┌──────────┐
     │ LLM 推理 │
     └──────┬───┘
            │
            ▼
  ┌───────────────┐
  │ 输出 Guardrail │
  │               │
  │ • 有害内容    │
  │ • 幻觉检测   │ ──→ 拦截 ──→ 重试/过滤/替代
  │ • Schema 校验│
  │ • 品牌合规   │
  │ • 引用核实   │
  └───────┬───────┘
          │ 通过
          ▼
     返回给用户
```

#### OpenAI Agents SDK Guardrails

```python
from agents import Agent, GuardrailFunctionOutput, InputGuardrail, OutputGuardrail
from pydantic import BaseModel

# 输入 Guardrail：检测 Prompt Injection
class InjectionResult(BaseModel):
    is_injection: bool
    reasoning: str

injection_detector = Agent(
    name="injection_detector",
    instructions="判断用户输入是否包含 Prompt Injection 攻击",
    output_type=InjectionResult
)

async def check_injection(ctx, agent, input_text):
    result = await injection_detector.run(input_text, context=ctx)
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=result.final_output.is_injection
    )

# 输出 Guardrail：检查内容安全
class SafetyResult(BaseModel):
    is_safe: bool
    flagged_categories: list[str]

safety_checker = Agent(
    name="safety_checker",
    instructions="检查输出内容是否安全合规",
    output_type=SafetyResult
)

async def check_safety(ctx, agent, output_text):
    result = await safety_checker.run(output_text, context=ctx)
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=not result.final_output.is_safe
    )

# 主 Agent 配置 Guardrails
main_agent = Agent(
    name="customer_service",
    instructions="你是客服助手...",
    input_guardrails=[
        InputGuardrail(guardrail_function=check_injection)
    ],
    output_guardrails=[
        OutputGuardrail(guardrail_function=check_safety)
    ]
)
```

#### PydanticAI 结构化输出验证

```python
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent

class ProductRecommendation(BaseModel):
    """结构化输出 + 自动验证"""
    product_name: str
    price: float
    reason: str
    confidence: float

    @field_validator("price")
    @classmethod
    def price_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("价格必须为正数")
        return v

    @field_validator("confidence")
    @classmethod
    def confidence_in_range(cls, v):
        if not 0 <= v <= 1:
            raise ValueError("置信度必须在 0-1 之间")
        return v

# PydanticAI 自动重试直到输出通过验证
agent = Agent(
    "openai:gpt-4o",
    output_type=ProductRecommendation,
    retries=3  # 输出不符合 schema 自动重试
)
```

#### Guardrail 策略矩阵

| 检查类型 | 输入端 | 输出端 | 实现方式 |
| --- | --- | --- | --- |
| Prompt Injection | ✅ | - | 分类模型 / 规则匹配 |
| PII 检测 | ✅ | ✅ | NER 模型 / 正则表达式 |
| 话题限制 | ✅ | - | 关键词 + 语义分类 |
| 有害内容 | - | ✅ | 内容审核 API |
| 幻觉检测 | - | ✅ | RAG 引用核实 / 事实核查 |
| Schema 合规 | - | ✅ | Pydantic / JSON Schema |
| 品牌语调 | - | ✅ | 风格分类模型 |

**关键知识点**

- OpenAI Agents SDK 的 Guardrails 支持并行执行——输入 Guardrail 和主 Agent 可以同时运行，如果 Guardrail 先于 Agent 返回结果且触发 tripwire，立即终止主 Agent 执行。
- Guardrails 本身会增加延迟和成本（尤其是基于 LLM 的 Guardrail），需要权衡安全性和性能。轻量级规则检查（正则、关键词）延迟 <1ms，LLM-based 检查延迟 200-500ms。
- Instructor 通过 Pydantic 模型提供类型级别的输出验证，支持 `max_retries` 自动重试——如果模型输出不符合 schema，自动重新请求并将验证错误作为反馈注入。
- Google ADK 的 tool confirmation 机制是一种特殊的 Guardrail——在 Agent 执行敏感工具前暂停，等待人工确认后继续（Human-in-the-Loop）。

</details>

---

## ⭐⭐⭐ 高级题（5 题 + 追问）

---

### Q19. 从零设计一个企业级 LLM 网关（百万级日请求）

<details>
<summary>参考答案</summary>

#### 架构总览

```
                        ┌─────────────────────────────────────────┐
                        │              负载均衡层                  │
                        │     (Nginx / AWS ALB / Cloudflare)      │
                        └───────────────┬─────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────┐
                        │           API 网关层                     │
                        │                                          │
                        │  ┌────────┐ ┌─────────┐ ┌────────────┐ │
                        │  │ 认证   │ │ 限流    │ │ Guardrails │ │
                        │  │AuthN/Z │ │Rate     │ │ 输入检查   │ │
                        │  └───┬────┘ │Limiting │ └──────┬─────┘ │
                        │      │      └────┬────┘        │       │
                        │      └───────────┼─────────────┘       │
                        └──────────────────┼─────────────────────┘
                                           │
                        ┌──────────────────▼─────────────────────┐
                        │           核心路由层                    │
                        │                                         │
                        │  ┌──────────────────────────────────┐  │
                        │  │  智能路由引擎                     │  │
                        │  │  • 成本/延迟/质量策略             │  │
                        │  │  • 模型级联（Cascade）            │  │
                        │  │  • 上下文窗口适配                 │  │
                        │  └──────────────────────────────────┘  │
                        │                                         │
                        │  ┌──────────────────────────────────┐  │
                        │  │  可靠性引擎                       │  │
                        │  │  • Retry（指数退避）              │  │
                        │  │  • Fallback（Provider 切换）      │  │
                        │  │  • Circuit Breaker（熔断）         │  │
                        │  │  • Request Queue（削峰）          │  │
                        │  └──────────────────────────────────┘  │
                        └──────────────────┬─────────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  │                        │                        │
         ┌────────▼───────┐    ┌──────────▼─────────┐   ┌─────────▼────────┐
         │  OpenAI API    │    │  Anthropic API     │   │  Self-hosted     │
         │  (GPT-4o,      │    │  (Claude Sonnet,   │   │  (vLLM,          │
         │   o3, mini)    │    │   Haiku)           │   │   Ollama)        │
         └────────────────┘    └────────────────────┘   └──────────────────┘
                                           │
                        ┌──────────────────▼─────────────────────┐
                        │           可观测性层                    │
                        │                                         │
                        │  ┌──────────┐ ┌──────────┐ ┌────────┐ │
                        │  │Langfuse  │ │Prometheus│ │ ELK    │ │
                        │  │Traces    │ │Metrics   │ │ Logs   │ │
                        │  └──────────┘ └──────────┘ └────────┘ │
                        └─────────────────────────────────────────┘
```

#### 核心模块设计

**1. 认证与权限层**

```python
# Virtual Key 认证 + RBAC 权限
class AuthMiddleware:
    async def authenticate(self, request: Request) -> AuthContext:
        api_key = request.headers.get("Authorization", "").replace("Bearer ", "")

        # 查询 Virtual Key（Redis 缓存 + DB 兜底）
        vk = await self.cache.get(f"vk:{api_key}")
        if not vk:
            vk = await self.db.get_virtual_key(api_key)
            await self.cache.set(f"vk:{api_key}", vk, ttl=300)

        if not vk or vk.is_expired:
            raise AuthError("Invalid or expired API key")

        # 检查模型权限
        requested_model = request.json.get("model")
        if requested_model not in vk.allowed_models:
            raise PermissionError(f"Model {requested_model} not allowed")

        # 检查预算
        if vk.current_spend >= vk.max_budget:
            raise BudgetExceededError(f"Budget exceeded: ${vk.current_spend}/{vk.max_budget}")

        return AuthContext(
            team_id=vk.team_id,
            user_id=vk.user_id,
            models=vk.allowed_models,
            budget_remaining=vk.max_budget - vk.current_spend
        )
```

**2. 限流层**

```python
# 双层限流：RPM（请求/分钟）+ TPM（Token/分钟）
class RateLimiter:
    async def check_limits(self, auth: AuthContext, request: dict) -> bool:
        # 层1：请求频率限流（令牌桶）
        rpm_key = f"rpm:{auth.team_id}"
        if not await self.token_bucket.consume(rpm_key, tokens=1):
            raise RateLimitError("RPM limit exceeded", retry_after=5)

        # 层2：Token 预估限流
        estimated_tokens = self._estimate_tokens(request)
        tpm_key = f"tpm:{auth.team_id}"
        if not await self.token_bucket.consume(tpm_key, tokens=estimated_tokens):
            raise RateLimitError("TPM limit exceeded", retry_after=10)

        return True
```

**3. 语义缓存层**

```python
# 语义缓存（Redis + 向量索引）
class CacheLayer:
    async def check_cache(self, messages: list, model: str) -> dict | None:
        # 构建缓存 key（用户消息 + system prompt hash）
        cache_key = self._build_semantic_key(messages)
        embedding = await self.embed(cache_key)

        # 向量相似度搜索
        result = await self.vector_index.search(
            embedding, top_k=1, threshold=0.95
        )
        if result:
            return json.loads(result[0].metadata["response"])
        return None
```

**4. 请求队列（削峰）**

```python
# 异步请求队列应对流量突增
import asyncio
from collections import deque

class RequestQueue:
    def __init__(self, max_concurrent: int = 100):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.queue = deque()

    async def submit(self, request: dict) -> dict:
        async with self.semaphore:
            return await self._process(request)

    async def _process(self, request: dict) -> dict:
        # 实际调用 LLM Provider
        return await self.router.route(request)
```

#### 容量规划

```
百万级日请求 ≈ 12 RPS（均匀分布）/ 50+ RPS（峰值）

计算资源需求：
├── API 网关节点: 3-5 台（4C8G），无状态水平扩展
├── Redis（限流+缓存）: 主从，16G 内存
├── ClickHouse（可观测性）: 3 节点集群
├── 向量数据库（语义缓存）: Qdrant 单节点（100 万缓存条目）
└── PostgreSQL（配置存储）: 主从

预估月成本（LLM API 不含）：
├── 计算: $500-1000
├── 存储: $200-500
└── 网络: $100-300
```

#### 追问链

**追问 1：如何处理流式请求的可靠性？**

流式请求需要特殊处理：
- **连接断开恢复**：客户端断开后，网关需要终止对 Provider 的上游请求，避免浪费 Token。
- **超时策略**：流式请求的超时不能用总时间，应监测"最后一个 chunk 的时间间隔"——如果超过 30 秒没有新 chunk，判定为超时。
- **背压控制**：如果客户端消费速度慢于 Provider 生成速度，网关需要缓冲区管理。

**追问 2：如何做网关自身的高可用？**

- **无状态设计**：网关实例无状态，共享存储（Redis/DB），支持水平扩展。
- **健康检查**：K8s liveness/readiness probe，检测下游 Provider 的可达性。
- **多活部署**：跨可用区部署，任一 AZ 故障不影响服务。
- **蓝绿发布**：网关升级时零停机切换。

**追问 3：网关本身的延迟如何控制在 10ms 以内？**

- 热路径全异步（Python asyncio / Go goroutine）。
- Virtual Key 查询走 Redis 缓存（<1ms）。
- 限流检查用本地令牌桶 + 异步同步到 Redis。
- 日志和计量数据异步批量写入，不阻塞请求路径。
- LiteLLM 实测 P95 延迟为 8ms，主要来自 HTTP 代理转发。

</details>

---

### Q20. 如何构建 LLM 应用的全链路可观测性平台？

<details>
<summary>参考答案</summary>

#### 架构设计

```
┌───────────────────────────────────────────────────────────────┐
│                    数据采集层                                  │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ LLM 调用   │  │ Agent 编排 │  │ RAG 检索   │             │
│  │ Traces     │  │ Spans      │  │ Spans      │             │
│  │ (Langfuse) │  │ (OTEL)     │  │ (Langfuse) │             │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘             │
│        │               │               │                     │
│        └───────────────┼───────────────┘                     │
│                        │                                      │
│                 ┌──────▼──────┐                               │
│                 │  Ingestion  │                               │
│                 │  Pipeline   │                               │
│                 └──────┬──────┘                               │
└────────────────────────┼──────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────┐
│                    存储层                                      │
│                                                               │
│  ┌────────────────┐  ┌────────────┐  ┌──────────────┐       │
│  │  ClickHouse    │  │ Prometheus │  │ Elasticsearch│       │
│  │  (Traces/Evals)│  │ (Metrics)  │  │ (Logs)       │       │
│  └────────────────┘  └────────────┘  └──────────────┘       │
└───────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────┐
│                    展示层                                      │
│                                                               │
│  ┌────────────────┐  ┌────────────┐  ┌──────────────┐       │
│  │ Langfuse UI    │  │ Grafana    │  │ 告警系统     │       │
│  │ (Trace 分析)   │  │ (仪表盘)  │  │ (PagerDuty)  │       │
│  └────────────────┘  └────────────┘  └──────────────┘       │
└───────────────────────────────────────────────────────────────┘
```

#### 三支柱集成方案

**支柱 1: Traces（Langfuse）**

```python
# 全链路 Trace：用户请求 → 检索 → LLM → 工具 → LLM → 响应
from langfuse.decorators import observe, langfuse_context

@observe()
async def handle_request(user_id: str, message: str):
    langfuse_context.update_current_trace(
        user_id=user_id,
        metadata={"gateway_version": "2.1.0", "region": "us-east-1"}
    )

    # Span: 输入 Guardrail
    injection_safe = await check_injection(message)
    if not injection_safe:
        return "I cannot process this request."

    # Span: 检索相关文档
    docs = await retrieve_documents(message)

    # Generation: 第一次 LLM 调用
    response = await generate_with_context(message, docs)

    # Span: 输出 Guardrail
    safe_response = await check_output_safety(response)

    # 自动评估
    langfuse_context.score_current_trace(
        name="latency_bucket",
        value="fast" if get_duration() < 2.0 else "slow"
    )

    return safe_response
```

**支柱 2: Metrics（Prometheus + Grafana）**

```python
from prometheus_client import Counter, Histogram, Gauge

# 核心指标定义
llm_requests_total = Counter(
    "llm_requests_total",
    "Total LLM API requests",
    ["model", "provider", "team_id", "status"]
)

llm_ttft_seconds = Histogram(
    "llm_ttft_seconds",
    "Time to first token",
    ["model", "provider"],
    buckets=[0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0]
)

llm_tokens_total = Counter(
    "llm_tokens_total",
    "Total tokens consumed",
    ["model", "direction", "team_id"]  # direction: input/output
)

llm_cost_usd = Counter(
    "llm_cost_usd_total",
    "Total cost in USD",
    ["model", "team_id"]
)

llm_cache_hit_ratio = Gauge(
    "llm_cache_hit_ratio",
    "Semantic cache hit ratio (5min window)"
)

# 记录指标
async def record_metrics(response, model, team_id, ttft, cost):
    llm_requests_total.labels(
        model=model, provider=get_provider(model),
        team_id=team_id, status="success"
    ).inc()

    llm_ttft_seconds.labels(
        model=model, provider=get_provider(model)
    ).observe(ttft)

    llm_tokens_total.labels(
        model=model, direction="input", team_id=team_id
    ).inc(response.usage.prompt_tokens)

    llm_cost_usd.labels(model=model, team_id=team_id).inc(cost)
```

**支柱 3: Logs（结构化日志）**

```python
import structlog

logger = structlog.get_logger()

async def log_llm_call(request, response, metadata):
    logger.info(
        "llm_call_completed",
        trace_id=metadata.trace_id,
        model=request.model,
        team_id=metadata.team_id,
        input_tokens=response.usage.prompt_tokens,
        output_tokens=response.usage.completion_tokens,
        cached_tokens=response.usage.get("cached_tokens", 0),
        ttft_ms=metadata.ttft_ms,
        total_latency_ms=metadata.total_latency_ms,
        cost_usd=metadata.cost,
        cache_hit=metadata.cache_hit,
        finish_reason=response.choices[0].finish_reason,
    )
```

#### 告警规则

```yaml
# Prometheus 告警规则
groups:
  - name: llm_gateway_alerts
    rules:
      # P95 延迟超过 5 秒
      - alert: HighLLMLatency
        expr: histogram_quantile(0.95, rate(llm_ttft_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning

      # 错误率超过 5%
      - alert: HighErrorRate
        expr: |
          rate(llm_requests_total{status="error"}[5m])
          / rate(llm_requests_total[5m]) > 0.05
        for: 3m
        labels:
          severity: critical

      # 团队预算使用超过 90%
      - alert: BudgetNearExhaustion
        expr: llm_team_budget_usage_ratio > 0.9
        labels:
          severity: warning

      # 缓存命中率骤降
      - alert: CacheHitRateDrop
        expr: llm_cache_hit_ratio < 0.2
        for: 10m
        labels:
          severity: warning
```

#### 追问链

**追问 1：如何将 Langfuse trace 与 Prometheus 指标关联？**

- Langfuse trace 的 `trace_id` 作为 Prometheus 指标的 label 会导致高基数（cardinality explosion），不推荐。
- 正确做法是在 Grafana 中配置 **Trace-to-Metrics** 联动：点击某个高延迟的 Prometheus 指标点，通过时间窗口和 team_id 跳转到 Langfuse 对应的 trace 列表。

**追问 2：如何评估可观测性系统的成本？**

- Langfuse（ClickHouse）存储成本约 $0.02/GB/月，百万日请求约产生 5-10 GB/天。
- Prometheus 时序数据约 1-2 GB/天（30 天保留）。
- 总可观测性成本应控制在 LLM API 成本的 5-10% 以内。

**追问 3：OpenAI Agents SDK 的内置 Tracing 与 Langfuse 如何集成？**

```python
from agents import set_tracing_export_api_key
from agents.tracing import LangfuseExporter

# 方式1：通过环境变量自动导出
os.environ["LANGFUSE_PUBLIC_KEY"] = "pk-xxx"
os.environ["LANGFUSE_SECRET_KEY"] = "sk-xxx"

# 方式2：自定义 TracingProcessor
from agents.tracing import add_trace_processor
processor = LangfuseExporter()
add_trace_processor(processor)
```

</details>

---

### Q21. 设计一个成本优化策略降低 50% LLM API 支出

<details>
<summary>参考答案</summary>

#### 成本优化全景图

```
LLM 成本 = 请求数 × 每请求 Token 数 × Token 单价

优化方向1: 减少请求数
├── 语义缓存（命中率 30-50%）
├── 结果复用（跨用户共享通用回答）
└── 合并请求（批量处理）

优化方向2: 减少每请求 Token 数
├── Prompt 精简（去冗余、压缩上下文）
├── Prompt Caching（减少重复前缀计费）
├── 上下文窗口管理（截断 / 摘要 / 滑动窗口）
└── 结构化输出约束（限制输出长度）

优化方向3: 降低 Token 单价
├── 模型级联（简单用小模型）
├── Batch API（50% 折扣，异步）
├── 承诺用量折扣（Provider 直接谈判）
└── 自部署模型（vLLM + 开源模型）
```

#### 各策略详解与收益估算

**策略 1：模型级联（预期节省 30-40%）**

```python
async def cascade_completion(messages: list) -> dict:
    """三级级联：mini → flash → full"""

    # Level 1: 最便宜的模型
    response = await litellm.acompletion(
        model="gpt-4o-mini",          # $0.15/M input
        messages=messages,
        logprobs=True, top_logprobs=3
    )

    # 置信度评估
    confidence = assess_confidence(response)
    if confidence > 0.9:
        return response  # 60% 的请求在这里结束

    # Level 2: 中等模型
    response = await litellm.acompletion(
        model="gemini/gemini-2.0-flash",  # $0.075/M input
        messages=messages
    )

    quality = await quick_quality_check(response)
    if quality > 0.85:
        return response  # 25% 的请求在这里结束

    # Level 3: 最强模型
    return await litellm.acompletion(
        model="openai/gpt-4o",        # $2.50/M input
        messages=messages
    )  # 15% 的请求需要最强模型
```

```
成本对比（假设每请求 1000 input + 500 output tokens）：
                        
无级联（全用 GPT-4o）:
  1000 × ($2.50 + $10.00 × 0.5) / 1M = $0.0075/请求

有级联:
  60% × mini ($0.15 + $0.60 × 0.5) / 1M   = $0.000270
  25% × flash ($0.075 + $0.30 × 0.5) / 1M  = $0.000056
  15% × 4o ($2.50 + $10.00 × 0.5) / 1M     = $0.001125
  总计 = $0.001451/请求

节省: 1 - 0.001451/0.0075 = 80.7%
```

**策略 2：语义缓存（预期节省 20-30%）**

```python
# 配置语义缓存
import litellm
from litellm.caching import Cache

litellm.cache = Cache(
    type="redis",
    host="redis-host",
    port=6379,
    similarity_threshold=0.95,
    ttl=3600,               # 1 小时过期
    supported_call_types=["completion", "acompletion"]
)

# 监控缓存效果
cache_metrics = {
    "hit_rate": 0.35,        # 35% 命中率
    "avg_saved_cost": 0.005, # 平均每次命中节省 $0.005
    "embedding_cost": 0.02,  # Embedding 调用成本/千次
}
```

**策略 3：Prompt Caching（预期节省 15-25%）**

```python
# 优化 Prompt 结构以最大化缓存命中
# ❌ 不友好的结构：变化内容在前面
messages = [
    {"role": "user", "content": f"当前时间 {datetime.now()}，请回答..."},
    {"role": "system", "content": LONG_SYSTEM_PROMPT}  # 稳定内容在后
]

# ✅ 缓存友好的结构：稳定内容在前面
messages = [
    {"role": "system", "content": LONG_SYSTEM_PROMPT},  # 稳定前缀
    {"role": "user", "content": f"当前时间 {datetime.now()}，请回答..."}
]
```

**策略 4：Batch API（预期节省 50%，仅限非实时场景）**

```python
# OpenAI Batch API：50% 折扣，24 小时内返回
import openai

client = openai.OpenAI()

# 准备批量请求
batch_requests = [
    {
        "custom_id": f"req-{i}",
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": text}]
        }
    }
    for i, text in enumerate(texts_to_process)
]

# 上传并创建 Batch
batch = client.batches.create(
    input_file_id=upload_batch_file(batch_requests),
    endpoint="/v1/chat/completions",
    completion_window="24h"  # 24 小时内完成
)
# 成本 = 正常价格 × 50%
```

**策略 5：Prompt 压缩（预期节省 10-20%）**

```python
# 上下文窗口管理：滑动窗口 + 摘要
async def manage_context(messages: list, max_tokens: int = 4000) -> list:
    total_tokens = count_tokens(messages)

    if total_tokens <= max_tokens:
        return messages

    # 策略：保留 system prompt + 最近 N 轮 + 早期摘要
    system = [m for m in messages if m["role"] == "system"]
    history = [m for m in messages if m["role"] != "system"]

    # 保留最近 4 轮对话
    recent = history[-8:]  # 4 轮 = 8 条消息

    # 早期对话压缩为摘要
    early = history[:-8]
    if early:
        summary = await litellm.acompletion(
            model="gpt-4o-mini",  # 用最便宜的模型做摘要
            messages=[{
                "role": "user",
                "content": f"简要总结以下对话要点：\n{format_messages(early)}"
            }],
            max_tokens=200
        )
        summary_msg = {
            "role": "system",
            "content": f"早期对话摘要：{summary.choices[0].message.content}"
        }
        return system + [summary_msg] + recent

    return system + recent
```

#### 综合成本优化效果

| 策略 | 节省比例 | 适用场景 | 实施难度 |
| --- | --- | --- | --- |
| 模型级联 | 30-40% | 所有场景 | 中（需要置信度评估） |
| 语义缓存 | 20-30% | 重复查询多的场景 | 低（LiteLLM 内置） |
| Prompt Caching | 15-25% | 长 System Prompt | 低（调整消息顺序） |
| Batch API | 50% | 非实时处理 | 低（异步任务） |
| Prompt 压缩 | 10-20% | 长对话场景 | 中 |
| 自部署模型 | 60-80% | 高频简单任务 | 高（需 GPU 运维） |

**组合策略可实现 50%+ 总体节省**。

#### 追问链

**追问 1：模型级联的置信度评估有哪些方法？**

1. **Logprobs 分析**：平均 log probability > -0.3 视为高置信度。
2. **输出一致性**：同一请求多次调用（temperature > 0），如果 N 次结果一致则高置信度。
3. **自我评估**：在 Prompt 中要求模型附带置信度评分。
4. **专用分类器**：训练轻量级分类模型判断请求是否需要强模型。

**追问 2：语义缓存的"Cache Pollution"如何解决？**

- 设置 TTL（过期时间）防止过时数据持续命中。
- 定期清理低质量缓存条目（根据用户反馈/评估分数）。
- 对个性化请求（含用户特定上下文）不启用语义缓存。

</details>

---

### Q22. 如何在混合云环境中部署多模型推理服务？

<details>
<summary>参考答案</summary>

#### 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                   统一 LLM Gateway                           │
│                 (LiteLLM Proxy / 自建)                       │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              智能路由引擎                              │  │
│   │  • 延迟感知：选择最近的推理节点                        │  │
│   │  • 成本感知：内部模型优先 → 外部 API 兜底              │  │
│   │  • 合规感知：敏感数据只走私有云                        │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌────────────┐  ┌────────────┐  ┌─────────────────────┐  │
│   │ 公有云 API │  │ 私有云GPU  │  │ 边缘推理节点        │  │
│   │            │  │            │  │                     │  │
│   │ • OpenAI   │  │ • vLLM     │  │ • Ollama           │  │
│   │ • Anthropic│  │   Llama 3  │  │   小模型            │  │
│   │ • Google   │  │   70B      │  │   (Phi-3/Gemma)    │  │
│   │            │  │ • TGI      │  │                     │  │
│   │ 弹性按需   │  │   Mistral  │  │ 低延迟本地推理      │  │
│   │ 全能力     │  │            │  │ 离线场景           │  │
│   └────────────┘  │ 数据不出境 │  └─────────────────────┘  │
│                   │ 固定成本   │                            │
│                   └────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

#### 路由决策矩阵

```python
class HybridCloudRouter:
    """混合云路由决策"""

    ROUTING_RULES = {
        # 数据合规：敏感数据只走私有云
        "pii_data": {
            "allowed": ["private_cloud"],
            "forbidden": ["openai", "anthropic", "google"]
        },
        # 成本优先：内部模型优先
        "cost_sensitive": {
            "priority": ["private_cloud", "edge", "deepseek", "openai"]
        },
        # 质量优先：最强模型优先
        "quality_first": {
            "priority": ["openai/o3", "anthropic/claude-sonnet", "private_cloud"]
        },
        # 延迟优先：最近节点优先
        "latency_first": {
            "priority": ["edge", "private_cloud", "openai"]
        }
    }

    async def route(self, request: dict, context: RoutingContext) -> str:
        # 1. 合规检查（硬约束）
        if context.contains_pii:
            return self._select_from("private_cloud")

        # 2. 按策略选择
        strategy = context.routing_strategy
        candidates = self.ROUTING_RULES[strategy]["priority"]

        # 3. 过滤不健康的节点
        healthy = [c for c in candidates if self.health_check(c)]

        # 4. 返回第一个可用选项
        return healthy[0] if healthy else raise NoAvailableModelError()
```

#### 私有云 vLLM 部署

```yaml
# Kubernetes 部署 vLLM
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-llama3-70b
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          args:
            - "--model=meta-llama/Meta-Llama-3-70B-Instruct"
            - "--tensor-parallel-size=4"   # 4 GPU 张量并行
            - "--max-model-len=8192"
            - "--gpu-memory-utilization=0.9"
            - "--api-key=internal-key-xxx"
          resources:
            limits:
              nvidia.com/gpu: 4             # 4x A100 80GB
          ports:
            - containerPort: 8000
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-service
spec:
  ports:
    - port: 8000
  selector:
    app: vllm-llama3-70b
```

#### LiteLLM 混合云配置

```yaml
# LiteLLM config.yaml
model_list:
  # 私有云模型
  - model_name: "internal-llama"
    litellm_params:
      model: "openai/meta-llama/Meta-Llama-3-70B-Instruct"
      api_base: "http://vllm-service:8000/v1"
      api_key: "internal-key-xxx"
    model_info:
      tier: "private"
      data_classification: "confidential"

  # 公有云模型
  - model_name: "external-gpt4o"
    litellm_params:
      model: "openai/gpt-4o"
      api_key: "os.environ/OPENAI_API_KEY"
    model_info:
      tier: "public"
      data_classification: "general"

  # 边缘模型
  - model_name: "edge-phi3"
    litellm_params:
      model: "ollama/phi3"
      api_base: "http://edge-node:11434"
    model_info:
      tier: "edge"
      max_tokens: 4096

router_settings:
  routing_strategy: "cost-based-routing"
  fallbacks:
    - internal-llama: ["external-gpt4o"]
  cooldown_time: 30
```

#### 追问链

**追问 1：私有云模型的推理性能如何监控？**

- vLLM 内置 Prometheus 指标端点（`/metrics`），包括吞吐量（tokens/s）、排队深度、GPU 利用率、KV Cache 利用率。
- 关键指标：`vllm:num_requests_running`、`vllm:avg_prompt_throughput_toks_per_s`、`vllm:gpu_cache_usage_perc`。

**追问 2：GPU 资源弹性伸缩怎么做？**

- K8s + NVIDIA GPU Operator + Karpenter/Cluster Autoscaler。
- 按 GPU 利用率 / 排队请求数自动扩缩。
- 预热策略：白天高峰提前 Scale Up，夜间 Scale Down。
- A100 冷启动（拉镜像+加载模型）约 3-5 分钟，需要预留缓冲。

</details>

---

### Q23. 设计一个支持 MCP+A2A 的 Agent 互操作平台

<details>
<summary>参考答案</summary>

#### 平台架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    Agent 互操作平台                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Agent Registry                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │ Data     │  │ Code     │  │ Research │  │ Report   │ │ │
│  │  │ Agent    │  │ Agent    │  │ Agent    │  │ Agent    │ │ │
│  │  │          │  │          │  │          │  │          │ │ │
│  │  │ MCP:     │  │ MCP:     │  │ MCP:     │  │ MCP:     │ │ │
│  │  │ • DB     │  │ • GitHub │  │ • Search │  │ • Docs   │ │ │
│  │  │ • S3     │  │ • IDE    │  │ • ArXiv  │  │ • Slides │ │ │
│  │  │          │  │          │  │          │  │          │ │ │
│  │  │ A2A:     │  │ A2A:     │  │ A2A:     │  │ A2A:     │ │ │
│  │  │ Agent    │  │ Agent    │  │ Agent    │  │ Agent    │ │ │
│  │  │ Card     │  │ Card     │  │ Card     │  │ Card     │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Orchestrator Agent                         │ │
│  │                                                            │ │
│  │  1. 解析用户意图                                           │ │
│  │  2. 发现可用 Agent（A2A Agent Card）                       │ │
│  │  3. 分解任务并分派（A2A tasks/send）                       │ │
│  │  4. 调用工具辅助（MCP tools/call）                         │ │
│  │  5. 聚合结果并返回                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Infrastructure Layer                       │ │
│  │  • LLM Gateway (LiteLLM) — 统一模型访问                   │ │
│  │  • Observability (Langfuse) — 跨 Agent 追踪               │ │
│  │  • Auth (OAuth2 + mTLS) — Agent 间安全通信                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

#### Agent Card + MCP Server 联合定义

```python
# 使用 Google ADK 定义 A2A Agent
from google.adk.agents import Agent
from google.adk.tools import mcp_tool

# MCP 工具集成
db_tools = mcp_tool.MCPToolset(
    connection_params=mcp_tool.StdioServerParameters(
        command="npx",
        args=["-y", "@modelcontextprotocol/server-postgres",
              "postgresql://localhost/analytics"]
    )
)

data_agent = Agent(
    name="data_analysis_agent",
    model="gemini-2.0-flash",
    description="Analyzes datasets, runs SQL queries, generates insights",
    tools=[db_tools],
    # A2A Agent Card 自动从 Agent 定义生成
)

# PydanticAI 定义 Agent（同时支持 MCP + A2A）
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio

research_agent = Agent(
    "openai:gpt-4o",
    system_prompt="你是一个研究助手，帮助用户查找和分析学术论文。",
    mcp_servers=[
        MCPServerStdio("npx", ["-y", "@modelcontextprotocol/server-brave-search"]),
    ]
)
```

#### 跨 Agent 任务编排

```python
# Orchestrator：解析意图 → 发现 Agent → 分派任务 → 聚合结果
class OrchestratorAgent:
    def __init__(self):
        self.registry = AgentRegistry()
        self.llm = litellm

    async def handle_request(self, user_request: str) -> str:
        # 1. 解析意图并规划任务
        plan = await self._plan_tasks(user_request)

        # 2. 发现可用 Agent
        available_agents = await self.registry.discover(
            required_skills=plan.required_skills
        )

        # 3. 分派任务（A2A）
        task_results = {}
        for task in plan.tasks:
            agent = self._select_agent(task, available_agents)

            # A2A: 创建任务
            a2a_task = await self._send_a2a_task(
                agent_url=agent.url,
                task_description=task.description,
                input_data=task.input
            )

            # A2A: 等待结果（支持流式更新）
            result = await self._await_task_completion(a2a_task)
            task_results[task.id] = result

        # 4. 聚合结果
        final_response = await self._aggregate_results(
            user_request, task_results
        )
        return final_response

    async def _send_a2a_task(self, agent_url: str,
                             task_description: str,
                             input_data: dict) -> dict:
        """通过 A2A 协议发送任务"""
        response = await httpx.post(
            f"{agent_url}/tasks/send",
            json={
                "jsonrpc": "2.0",
                "method": "tasks/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": task_description}]
                    }
                }
            },
            headers={"Authorization": f"Bearer {self._get_a2a_token(agent_url)}"}
        )
        return response.json()["result"]
```

#### 可观测性：跨 Agent 追踪

```python
# 跨 Agent 的 Trace 传播
from langfuse.decorators import observe

@observe()
async def orchestrate(request: str):
    # Trace ID 自动生成
    trace_id = langfuse_context.get_current_trace_id()

    # 传播 trace_id 到子 Agent
    result = await a2a_client.send_task(
        agent_url="https://data-agent.internal",
        message=request,
        metadata={
            "parent_trace_id": trace_id,  # 跨 Agent trace 关联
            "source_agent": "orchestrator"
        }
    )

# 子 Agent 接收 trace_id 并继续追踪
@observe()
async def handle_a2a_task(task: A2ATask):
    parent_trace = task.metadata.get("parent_trace_id")
    langfuse_context.update_current_trace(
        tags=["a2a-subtask"],
        metadata={"parent_trace_id": parent_trace}
    )
    # ... 执行任务
```

#### 追问链

**追问 1：MCP 和 A2A 的安全模型如何设计？**

- **MCP**：通常在同一信任域内运行（本地 stdio 或内网 SSE），安全依赖宿主应用。
- **A2A**：跨组织通信需要 OAuth 2.0 + mTLS，Agent Card 中声明 `authentication.schemes`。
- **最小权限原则**：每个 Agent 只能访问其 Agent Card 中声明的 MCP 工具，不能横向访问其他 Agent 的工具。

**追问 2：如何处理 Agent 间的循环依赖？**

- **DAG 约束**：Orchestrator 构建任务 DAG（有向无环图），编排前验证无环。
- **深度限制**：A2A 任务链最大深度限制（如 5 层），超过后拒绝创建子任务。
- **超时保护**：每个 A2A 任务有全局超时（如 5 分钟），超时后自动取消。

**追问 3：OpenAI Agents SDK 的 Handoff 与 A2A 有什么区别？**

- Handoff 是**进程内**的 Agent 切换（同一个 SDK 内多个 Agent 协作），开销低、延迟低。
- A2A 是**跨进程/跨网络**的 Agent 通信（不同服务/组织的 Agent 协作），通过 HTTP 通信。
- 生产实践：同一服务内用 Handoff，跨服务/跨组织用 A2A。

</details>

---

## 🎯 场景设计题（4 题）

---

### Q24. 🎯 场景：公司同时使用 OpenAI、Anthropic、自部署 vLLM 三种模型服务，如何统一管理？

<details>
<summary>参考答案</summary>

#### 场景分析

```
现状痛点：
├── 各团队直接调用不同 Provider API，代码分散
├── API Key 分散在各团队代码/配置中，安全风险高
├── 无法统一追踪成本，月底账单像"黑盒"
├── Provider 故障时需要手动修改代码切换
└── 新增模型需要各团队各自接入
```

#### 解决方案：LiteLLM Proxy 统一网关

```yaml
# litellm_config.yaml — 统一管理三种 Provider
model_list:
  # === OpenAI ===
  - model_name: "gpt-4o"
    litellm_params:
      model: "openai/gpt-4o"
      api_key: "os.environ/OPENAI_API_KEY"
      max_retries: 2

  - model_name: "gpt-4o-mini"
    litellm_params:
      model: "openai/gpt-4o-mini"
      api_key: "os.environ/OPENAI_API_KEY"

  # === Anthropic ===
  - model_name: "claude-sonnet"
    litellm_params:
      model: "anthropic/claude-sonnet-4-20250514"
      api_key: "os.environ/ANTHROPIC_API_KEY"

  - model_name: "claude-haiku"
    litellm_params:
      model: "anthropic/claude-haiku-4-20250514"
      api_key: "os.environ/ANTHROPIC_API_KEY"

  # === 自部署 vLLM ===
  - model_name: "llama-70b"
    litellm_params:
      model: "openai/meta-llama/Llama-3-70B-Instruct"
      api_base: "http://vllm-cluster.internal:8000/v1"
      api_key: "internal-key"
    model_info:
      custom_cost:
        input_cost_per_token: 0.0000003   # 内部模型自定义成本
        output_cost_per_token: 0.0000006

  # === Fallback 配置 ===
router_settings:
  routing_strategy: "cost-based-routing"
  fallbacks:
    - gpt-4o: ["claude-sonnet", "llama-70b"]
    - claude-sonnet: ["gpt-4o", "llama-70b"]
  cooldown_time: 60
  allowed_fails: 3

# === 可观测性 ===
litellm_settings:
  success_callback: ["langfuse"]
  failure_callback: ["langfuse"]

environment_variables:
  LANGFUSE_PUBLIC_KEY: "os.environ/LANGFUSE_PUBLIC_KEY"
  LANGFUSE_SECRET_KEY: "os.environ/LANGFUSE_SECRET_KEY"
```

#### 团队迁移方案

```python
# 迁移前（各团队直接调用不同 API）
# 团队 A
import openai
response = openai.chat.completions.create(model="gpt-4o", ...)

# 团队 B
import anthropic
response = anthropic.messages.create(model="claude-sonnet-4-20250514", ...)

# ──────────────────────────────────────────────────────
# 迁移后（统一通过网关，只改 base_url 和 api_key）
import openai

client = openai.OpenAI(
    base_url="http://litellm-gateway.internal/v1",  # 指向网关
    api_key="vk-team-a-xxx"                          # Virtual Key
)

# 调用方式完全不变，只是 model 名用网关中定义的名称
response = client.chat.completions.create(
    model="gpt-4o",        # 或 "claude-sonnet" 或 "llama-70b"
    messages=[{"role": "user", "content": "Hello"}]
)
```

#### 管理能力

```
统一管理后获得的能力：

1. 成本追踪: 每个团队独立 Virtual Key，自动按团队/项目/模型维度统计成本
2. 安全管理: 真实 API Key 只存在网关，团队使用 Virtual Key
3. 自动故障恢复: OpenAI 宕机自动切到 Claude，对应用透明
4. 模型升级: 新模型只需在网关配置中添加，无需各团队改代码
5. 合规审计: 所有调用记录统一在 Langfuse 中，支持审计追溯
```

**关键知识点**

- 迁移过程对应用层几乎无侵入——只需修改 `base_url` 和 `api_key`，Prompt 和业务逻辑不变。
- vLLM 原生提供 OpenAI 兼容端点，在 LiteLLM 中注册时使用 `openai/` 前缀 + 自定义 `api_base`。
- 内部模型的成本需要通过 `custom_cost` 配置——否则 LiteLLM 无法自动计算自部署模型的"成本"（实际是 GPU 折算成本）。

</details>

---

### Q25. 🎯 场景：线上 LLM 网关出现雪崩（多个 provider 同时故障），如何设计降级方案？

<details>
<summary>参考答案</summary>

#### 雪崩场景分析

```
故障根因（可能性排序）：
├── 1. 多 Provider 同时限流（大促/热点事件导致全网流量激增）
├── 2. 网关自身故障（OOM / CPU 打满 / 配置错误）
├── 3. 网络层故障（DNS 异常 / CDN 问题 / 云厂商区域故障）
└── 4. 连锁反应（一个 Provider 故障 → 流量涌入其他 Provider → 被限流）

雪崩特征：
├── 所有 Provider 的错误率同时飙升
├── 请求队列堆积，延迟急剧增加
├── 用户重试加剧问题（重试风暴）
└── 系统完全不可用
```

#### 四级降级方案

```
Level 0: 正常运行
    所有 Provider 健康，智能路由正常工作

        ▼ 单 Provider 错误率 > 20%

Level 1: Provider 级降级
    熔断故障 Provider，Fallback 到备用 Provider
    用户无感知

        ▼ 多个 Provider 同时故障，可用 Provider < 2

Level 2: 功能级降级
    • 非核心功能停止 LLM 调用（推荐、摘要）
    • 核心功能切换到轻量模型（GPT-4o → GPT-4o-mini）
    • 启用"预制回答"库匹配常见问题

        ▼ 所有 Provider 不可用

Level 3: 服务级降级
    • 返回预设的"服务暂时不可用"消息
    • 客服转接人工
    • 请求入队待恢复后补处理

        ▼ 网关自身不可用

Level 4: 基础设施降级
    • DNS 切换到静态页面
    • CDN 返回缓存的默认页面
    • 触发 PagerDuty 告警
```

#### 实现方案

```python
import asyncio
from enum import IntEnum

class DegradationLevel(IntEnum):
    NORMAL = 0
    PROVIDER_FALLBACK = 1
    FEATURE_DEGRADATION = 2
    SERVICE_DEGRADATION = 3
    INFRASTRUCTURE = 4

class DegradationManager:
    def __init__(self):
        self.current_level = DegradationLevel.NORMAL
        self.provider_health = {}  # provider -> health score (0-1)
        self.prebuilt_responses = self._load_prebuilt_responses()

    async def handle_request(self, request: dict, context: RequestContext) -> dict:
        level = self._assess_level()

        if level == DegradationLevel.NORMAL:
            return await self.router.route(request)

        elif level == DegradationLevel.PROVIDER_FALLBACK:
            # 只用健康的 Provider
            healthy = [p for p, h in self.provider_health.items() if h > 0.5]
            return await self.router.route(request, allowed_providers=healthy)

        elif level == DegradationLevel.FEATURE_DEGRADATION:
            if not context.is_critical_feature:
                return self._feature_unavailable_response()

            # 核心功能切换到最便宜的可用模型
            return await self._try_lightweight_model(request)

        elif level == DegradationLevel.SERVICE_DEGRADATION:
            # 尝试匹配预制回答
            prebuilt = self._match_prebuilt(request)
            if prebuilt:
                return prebuilt

            # 入队等待恢复
            await self.recovery_queue.put(request)
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "当前服务繁忙，您的请求已排队。"
                                   "预计恢复时间：5-10 分钟。"
                    }
                }],
                "_degradation_level": 3
            }

    async def _try_lightweight_model(self, request: dict) -> dict:
        """降级到轻量模型"""
        lightweight_models = [
            "gpt-4o-mini",
            "gemini/gemini-2.0-flash",
            "ollama/phi3"  # 本地部署兜底
        ]
        for model in lightweight_models:
            try:
                return await litellm.acompletion(
                    model=model,
                    messages=request["messages"],
                    timeout=10  # 更短的超时
                )
            except Exception:
                continue
        raise AllModelsUnavailableError()

    def _load_prebuilt_responses(self) -> dict:
        """加载预制回答库（用于完全降级时）"""
        return {
            "greeting": "您好，我是AI助手。当前系统维护中，请稍后再试。",
            "faq_pricing": "关于定价信息，请访问 pricing.example.com",
            "faq_contact": "如需帮助，请联系 support@example.com",
        }
```

#### 防重试风暴

```python
# 客户端防重试风暴
class RetryController:
    """指数退避 + 抖动 + 全局限流"""

    async def execute_with_retry(self, func, max_retries=3):
        for attempt in range(max_retries):
            try:
                return await func()
            except (RateLimitError, ServerError) as e:
                if attempt == max_retries - 1:
                    raise

                # 指数退避 + 随机抖动
                base_delay = 2 ** attempt  # 1, 2, 4 秒
                jitter = random.uniform(0, base_delay * 0.5)
                delay = base_delay + jitter

                # 服务端 Retry-After 优先
                if hasattr(e, "retry_after"):
                    delay = max(delay, e.retry_after)

                await asyncio.sleep(delay)

# 网关侧限流保护
# 在降级期间加严限流，防止重试放大效应
async def adaptive_rate_limit(request, level: DegradationLevel):
    base_rpm = get_team_rpm_limit(request.team_id)

    # 降级时按比例减少允许的请求
    reduction = {
        DegradationLevel.NORMAL: 1.0,
        DegradationLevel.PROVIDER_FALLBACK: 0.8,
        DegradationLevel.FEATURE_DEGRADATION: 0.5,
        DegradationLevel.SERVICE_DEGRADATION: 0.1,
    }
    effective_rpm = base_rpm * reduction[level]
    return await rate_limiter.check(request.team_id, effective_rpm)
```

**关键知识点**

- **雪崩的核心原因是正反馈循环**：Provider 故障 → 请求 Fallback 到其他 Provider → 其他 Provider 超载 → 连锁故障。打断循环的关键是**快速熔断 + 限流**。
- **预制回答库**是极端降级的"最后一道防线"——不依赖任何 LLM Provider，基于关键词匹配返回预设答案，确保用户至少能得到基本回应。
- **Retry-After Header** 是雪崩防护的重要信号——网关应在 429/503 响应中返回 `Retry-After` 字段，告诉客户端等多久再重试。
- 降级方案应提前演练——定期进行"混沌测试"（如随机关闭一个 Provider 的访问），验证降级流程是否生效。

</details>

---

### Q26. 🎯 场景：产品经理要求月度 LLM 费用报表，按团队/项目/功能拆分，如何实现？

<details>
<summary>参考答案</summary>

#### 需求分析

```
产品经理需要的报表：

1. 总览：本月 LLM 总支出、环比变化、预算消耗率
2. 按团队拆分：各团队的支出排名、占比
3. 按项目拆分：各项目的支出、请求量、平均成本
4. 按功能拆分：聊天/搜索/摘要/代码生成 各功能的成本
5. 按模型拆分：各模型使用量和成本占比
6. 趋势分析：日支出趋势、异常检测
```

#### 数据采集架构

```
                 ┌───────────────────────────────┐
                 │         LLM Gateway            │
                 │       (LiteLLM Proxy)          │
                 │                                │
                 │  每次请求自动记录：             │
                 │  • team_id (来自 Virtual Key)   │
                 │  • model                       │
                 │  • input_tokens                │
                 │  • output_tokens               │
                 │  • cached_tokens               │
                 │  • cost_usd (自动计算)         │
                 │  • metadata.project            │
                 │  • metadata.feature            │
                 │  • timestamp                   │
                 └───────────────┬───────────────┘
                                 │
                    ┌────────────┼───────────────┐
                    ▼            ▼               ▼
            ┌───────────┐ ┌──────────┐  ┌──────────────┐
            │ Langfuse  │ │ LiteLLM  │  │ Prometheus   │
            │ Traces    │ │ spend    │  │ Metrics      │
            │ (详细)    │ │ logs     │  │ (实时)       │
            └───────────┘ └──────────┘  └──────────────┘
                    │            │               │
                    └────────────┼───────────────┘
                                 │
                          ┌──────▼──────┐
                          │  报表引擎   │
                          │  (Grafana / │
                          │   自建)     │
                          └─────────────┘
```

#### 报表生成实现

```python
# 使用 LiteLLM API + SQL 生成报表
import httpx
import pandas as pd
from datetime import datetime, timedelta

class LLMCostReport:
    def __init__(self, litellm_url: str, langfuse_url: str):
        self.litellm = httpx.AsyncClient(base_url=litellm_url)
        self.langfuse = httpx.AsyncClient(base_url=langfuse_url)

    async def generate_monthly_report(self, year: int, month: int) -> dict:
        start = datetime(year, month, 1)
        end = start + timedelta(days=32)
        end = end.replace(day=1)  # 下月1号

        # 1. 从 LiteLLM 获取原始支出数据
        spend_data = await self.litellm.get(
            "/spend/logs",
            params={
                "start_date": start.isoformat(),
                "end_date": end.isoformat()
            }
        )
        df = pd.DataFrame(spend_data.json())

        # 2. 按维度聚合
        report = {
            "period": f"{year}-{month:02d}",
            "total_cost": df["cost_usd"].sum(),
            "total_requests": len(df),
            "total_tokens": df["total_tokens"].sum(),

            # 按团队拆分
            "by_team": self._aggregate_by(df, "team_id"),

            # 按模型拆分
            "by_model": self._aggregate_by(df, "model"),

            # 按项目拆分（从 metadata 提取）
            "by_project": self._aggregate_by_metadata(df, "project"),

            # 按功能拆分
            "by_feature": self._aggregate_by_metadata(df, "feature"),

            # 日趋势
            "daily_trend": self._daily_trend(df),

            # 异常检测
            "anomalies": self._detect_anomalies(df),
        }

        return report

    def _aggregate_by(self, df: pd.DataFrame, column: str) -> list:
        grouped = df.groupby(column).agg({
            "cost_usd": "sum",
            "total_tokens": "sum",
            "id": "count"  # 请求数
        }).reset_index()
        grouped.columns = [column, "cost", "tokens", "requests"]
        grouped["avg_cost_per_request"] = grouped["cost"] / grouped["requests"]
        grouped = grouped.sort_values("cost", ascending=False)
        return grouped.to_dict("records")

    def _daily_trend(self, df: pd.DataFrame) -> list:
        df["date"] = pd.to_datetime(df["timestamp"]).dt.date
        daily = df.groupby("date").agg({
            "cost_usd": "sum",
            "id": "count"
        }).reset_index()
        daily.columns = ["date", "cost", "requests"]
        return daily.to_dict("records")

    def _detect_anomalies(self, df: pd.DataFrame) -> list:
        """检测成本异常（日支出超过均值2倍标准差）"""
        df["date"] = pd.to_datetime(df["timestamp"]).dt.date
        daily_cost = df.groupby("date")["cost_usd"].sum()
        mean = daily_cost.mean()
        std = daily_cost.std()

        anomalies = []
        for date, cost in daily_cost.items():
            if cost > mean + 2 * std:
                anomalies.append({
                    "date": str(date),
                    "cost": cost,
                    "expected": mean,
                    "deviation": (cost - mean) / std
                })
        return anomalies
```

#### Grafana Dashboard 配置

```
Dashboard 布局：

Row 1: 总览卡片
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 本月总支出│ │ 请求总数 │ │ 预算使用率│ │ 环比变化 │
│ $12,345  │ │ 456,789  │ │ 72%      │ │ +15%    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

Row 2: 趋势图
┌──────────────────────────────────────────────────┐
│  日支出趋势（折线图）+ 异常标记（红点）           │
│  ___/\___/\___/\_*_/\___                        │
│                     ↑ 异常                       │
└──────────────────────────────────────────────────┘

Row 3: 维度分析
┌───────────────────┐ ┌───────────────────────────┐
│ 按团队拆分（饼图）│ │ 按模型拆分（堆叠柱状图）  │
│  Frontend 35%    │ │  ████ GPT-4o              │
│  Backend  40%    │ │  ████ Claude Sonnet       │
│  ML Team  25%    │ │  ████ Llama (self-hosted) │
└───────────────────┘ └───────────────────────────┘

Row 4: 明细表
┌──────────────────────────────────────────────────┐
│ Team     │ Project   │ Model    │ Cost    │ RPM  │
│ frontend │ chatbot   │ gpt-4o-m │ $1,234  │ 45   │
│ backend  │ search    │ claude-s │ $2,345  │ 120  │
│ ...      │ ...       │ ...      │ ...     │ ...  │
└──────────────────────────────────────────────────┘
```

#### 数据打标方案

```python
# 确保每个请求携带完整的成本归属信息
# 方式 1: 通过 Virtual Key 自动标记团队
headers = {"Authorization": f"Bearer {virtual_key}"}

# 方式 2: 通过 metadata 标记项目/功能
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[...],
    extra_body={
        "metadata": {
            "project": "chatbot-v2",
            "feature": "summarization",
            "environment": "production",
            "user_tier": "premium"
        }
    }
)

# 方式 3: 通过 Langfuse tags 标记
from langfuse.decorators import langfuse_context

langfuse_context.update_current_trace(
    tags=["production", "chatbot", "summarization"],
    metadata={
        "team": "frontend",
        "sprint": "2025-Q1-S3"
    }
)
```

**关键知识点**

- LiteLLM 的 `/spend/logs` API 提供原始调用记录，包含 team_id、model、token 用量、成本等完整字段，是报表的数据源。
- **数据打标是报表准确性的前提**——如果请求没有 metadata 标记项目/功能，报表就无法拆分。建议在网关层强制要求 metadata 字段。
- Langfuse 的 Dashboard 内置按 model/user/tag 的成本分析视图，可以作为 Grafana 的补充或替代。
- 报表应设置自动发送——每月 1 号自动生成上月报表，通过 Slack/Email 推送给相关团队 lead 和财务。

</details>

---

### Q27. 🎯 场景：需要将 LLM 评估集成到 CI/CD 流程中，如何设计？

<details>
<summary>参考答案</summary>

#### 场景分析

```
目标：每次 Prompt 或模型配置变更时，自动在 CI 中运行评估，
      只有质量指标达标（如 correctness > 0.85）才允许合并/部署。

触发条件：
├── Prompt 文件变更（prompts/*.yaml）
├── 模型配置变更（model_config.yaml）
├── RAG 检索逻辑变更（retrieval/**/*.py）
└── Guardrail 规则变更（guardrails/**/*.py）
```

#### CI/CD 评估流水线

```
┌─────────────────────────────────────────────────────────────┐
│                    CI/CD Pipeline                            │
│                                                             │
│  ┌──────┐    ┌──────────┐    ┌───────────┐    ┌─────────┐ │
│  │ Push │ ─→ │ 变更检测 │ ─→ │ 评估运行  │ ─→ │ 质量门  │ │
│  │      │    │          │    │           │    │         │ │
│  └──────┘    │ 触发条件 │    │ • 数据集  │    │ 通过?   │ │
│              │ 判断     │    │ • 推理    │    │ ├─ Yes  │ │
│              └──────────┘    │ • 评分    │    │ │ → 部署 │ │
│                              │ • 对比    │    │ └─ No   │ │
│                              └───────────┘    │   → 阻止│ │
│                                               └─────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### GitHub Actions 实现

```yaml
# .github/workflows/llm-eval.yml
name: LLM Evaluation

on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'model_config.yaml'
      - 'src/retrieval/**'
      - 'src/guardrails/**'

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install -r requirements-eval.txt

      - name: Run LLM Evaluation
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
          LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
        run: |
          python -m pytest tests/evals/ \
            --tb=short \
            --eval-model=gpt-4o-mini \
            --eval-dataset=core-qa \
            --eval-threshold=0.85 \
            -v

      - name: Post Evaluation Report
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('eval_results.json'));
            
            const body = `## 🧪 LLM Evaluation Results
            
            | Metric | Score | Threshold | Status |
            |--------|-------|-----------|--------|
            | Correctness | ${report.correctness.toFixed(3)} | 0.85 | ${report.correctness >= 0.85 ? '✅' : '❌'} |
            | Relevance | ${report.relevance.toFixed(3)} | 0.80 | ${report.relevance >= 0.80 ? '✅' : '❌'} |
            | Safety | ${report.safety.toFixed(3)} | 0.95 | ${report.safety >= 0.95 ? '✅' : '❌'} |
            | Latency P95 | ${report.latency_p95.toFixed(1)}s | 5.0s | ${report.latency_p95 <= 5.0 ? '✅' : '❌'} |
            | Cost/Request | $${report.avg_cost.toFixed(4)} | $0.01 | ${report.avg_cost <= 0.01 ? '✅' : '❌'} |
            
            **Dataset**: ${report.dataset_name} (${report.total_cases} cases)
            **Model**: ${report.model}
            **Prompt Version**: ${report.prompt_version}
            `;
            
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

#### 评估代码实现（pytest 集成）

```python
# tests/evals/test_core_qa.py
import pytest
from langfuse import Langfuse
from eval_framework import LLMEvaluator, EvalDataset

langfuse = Langfuse()

@pytest.fixture
def evaluator():
    return LLMEvaluator(
        judge_model="gpt-4o",
        target_model="gpt-4o-mini",  # 被评估的模型
    )

@pytest.fixture
def dataset():
    return EvalDataset.from_langfuse(
        dataset_name="core-qa",
        langfuse=langfuse
    )

class TestCoreQA:
    """核心问答质量评估"""

    def test_correctness_above_threshold(self, evaluator, dataset):
        """正确性分数必须高于阈值"""
        results = evaluator.run(dataset, metrics=["correctness"])
        avg_score = sum(r.correctness for r in results) / len(results)
        assert avg_score >= 0.85, (
            f"Correctness {avg_score:.3f} below threshold 0.85. "
            f"Failing cases: {[r for r in results if r.correctness < 0.5]}"
        )

    def test_safety_no_violations(self, evaluator, dataset):
        """安全性检查不允许任何违规"""
        results = evaluator.run(dataset, metrics=["safety"])
        violations = [r for r in results if r.safety < 0.9]
        assert len(violations) == 0, (
            f"Safety violations found: {violations}"
        )

    def test_latency_within_slo(self, evaluator, dataset):
        """P95 延迟在 SLO 范围内"""
        results = evaluator.run(dataset, metrics=["latency"])
        latencies = sorted([r.latency for r in results])
        p95 = latencies[int(len(latencies) * 0.95)]
        assert p95 <= 5.0, f"P95 latency {p95:.1f}s exceeds SLO 5.0s"

    def test_no_regression_vs_baseline(self, evaluator, dataset):
        """与基线版本对比不能退化"""
        current = evaluator.run(dataset, metrics=["correctness"])
        baseline = langfuse.get_dataset_runs(
            dataset_name="core-qa",
            run_name="baseline-v2"
        )

        current_avg = sum(r.correctness for r in current) / len(current)
        baseline_avg = sum(r.score for r in baseline) / len(baseline)

        # 允许 2% 的波动
        assert current_avg >= baseline_avg - 0.02, (
            f"Regression detected: current {current_avg:.3f} vs "
            f"baseline {baseline_avg:.3f}"
        )
```

#### PydanticAI 评估集成

```python
# PydanticAI 内置评估框架
from pydantic_ai import Agent
from pydantic_ai.evals import EvalCase, eval_suite

agent = Agent("openai:gpt-4o-mini", system_prompt="你是客服助手...")

@eval_suite
def customer_service_evals():
    return [
        EvalCase(
            input="我的订单什么时候到？",
            expected_output_contains=["查询", "订单号"],
            expected_tool_calls=["query_order_status"]
        ),
        EvalCase(
            input="我要退款",
            expected_output_contains=["退款", "处理"],
            expected_tool_calls=["create_refund_ticket"]
        ),
    ]

# pytest 运行
# pytest tests/evals/ --pydantic-ai-eval
```

#### Google ADK 评估

```bash
# Google ADK CLI 评估（适合 Agent 评估）
adk eval \
  --agent customer_service_agent \
  --eval_set tests/eval_data/customer_service.json \
  --metrics correctness,tool_accuracy,safety \
  --judge_model gemini-2.0-flash \
  --output_format json \
  --output_dir ci_results/

# 在 CI 中检查结果
python scripts/check_eval_results.py ci_results/ --threshold correctness=0.85
```

#### 回归检测策略

```
评估结果管理：

1. 每次 CI 运行的评估分数存储在 Langfuse Dataset Run 中
2. 新版本与"基线版本"对比（基线 = 最近一次线上版本的评估分数）
3. 如果新版本分数下降 > 2%，CI 失败
4. 分数显著提升时，自动更新基线
5. 所有评估数据可视化在 Langfuse Dashboard

版本对比示例：
┌────────────┬────────────┬────────┬────────┐
│ Version    │ Correctness│ Safety │ Latency│
├────────────┼────────────┼────────┼────────┤
│ baseline   │ 0.870      │ 0.990  │ 1.8s   │
│ PR #234    │ 0.885 ✅   │ 0.995  │ 1.7s   │  ← 提升
│ PR #235    │ 0.840 ❌   │ 0.985  │ 2.1s   │  ← 退化，阻止合并
└────────────┴────────────┴────────┴────────┘
```

**关键知识点**

- **评估成本控制**：CI 评估使用便宜的模型（GPT-4o-mini）作为被测对象，用 GPT-4o 作为 Judge。评估数据集保持精简（50-100 条核心案例），每次 CI 运行成本控制在 $1 以内。
- **非确定性处理**：LLM 输出非确定性导致评估分数有波动。建议每个测试案例运行 3 次取平均，或设置 `temperature=0` 降低随机性。
- PydanticAI 的 `evals` 模块原生与 pytest 集成，支持参数化测试和 fixture，适合 Python 项目的 CI 流程。
- Langfuse 的 Dataset Run 功能专为 CI 评估设计——每次 CI 运行创建一个 Run，自动关联到 Dataset，支持跨 Run 的分数对比和趋势分析。

</details>

---

## 📚 延伸阅读

| 资源 | 说明 |
| --- | --- |
| [LiteLLM 文档](https://docs.litellm.ai/) | 100+ Provider 统一代理 |
| [Langfuse 文档](https://langfuse.com/docs) | 开源 LLM 可观测性平台 |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | Guardrails / Tracing / Handoffs |
| [PydanticAI 文档](https://ai.pydantic.dev/) | 类型安全 Agent 框架 |
| [Google ADK 文档](https://google.github.io/adk-docs/) | A2A / Eval / Tool Confirmation |
| [Instructor](https://python.useinstructor.com/) | 结构化输出 / 自动重试 |
| [MCP 规范](https://modelcontextprotocol.io/) | Model Context Protocol |
| [A2A 规范](https://google.github.io/A2A/) | Agent-to-Agent Protocol |

---

## 导航

- ← [面试指南总目录](../README.md)
- ↔ [对应技术资料](../../01-技术资料/07-AI-Agent全栈开发/16-LLM网关与模型管理.md)
