# LLM 服务编排与成本治理面试题

> 覆盖 Token 计算、计费系统、缓存策略、负载均衡、容错降级、多租户管理的面试题

## 相关链接

- 对应技术资料：[LLM服务编排与成本治理](../../01-技术资料/08-AI-Agent全栈工程/11-LLM服务编排与成本治理.md)

## TL;DR 速览

- **Token 计费**是 LLM 成本治理的原子单位，BPE 分词直接影响成本预估精度
- **统一路由层**是多模型编排的核心，需屏蔽不同提供商的 API 差异
- **语义缓存**可节省 30-60% 的 API 调用成本，但需权衡一致性与命中率
- **Rate-limit-aware 路由**是 LLM 负载均衡的核心难点，与传统 Web LB 本质不同
- **Fallback 链**需要考虑模型能力降级而非简单的服务切换
- **预算管控**必须在请求发送前完成，事后统计无法阻止预算超支
- **流式场景**的 token 计量需要特殊设计，不能等到流结束才统计

## 题目列表

### ⭐ 基础题

- [Q1: BPE tokenizer 工作原理](#q1-bpe-tokenizer-工作原理)
- [Q2: 不同 LLM 提供商的定价模型差异与统一计费系统](#q2-不同-llm-提供商的定价模型差异与统一计费系统)
- [Q3: Virtual Key 与代理 API Key](#q3-virtual-key-与代理-api-key)

### ⭐⭐ 进阶题

- [Q4: 多模型统一路由层设计](#q4-多模型统一路由层设计)
- [Q5: 精确缓存 vs 语义缓存](#q5-精确缓存-vs-语义缓存)
- [Q6: LLM 负载均衡与 rate-limit-aware 路由](#q6-llm-负载均衡与-rate-limit-aware-路由)
- [Q7: LLM 提供商自动降级和 fallback 链](#q7-llm-提供商自动降级和-fallback-链)
- [Q8: 多租户 LLM 平台预算管理系统](#q8-多租户-llm-平台预算管理系统)

### ⭐⭐⭐ 高级题

- [Q9: 流式请求中的 token 用量和成本计算](#q9-流式请求中的-token-用量和成本计算)
- [Q10: 10 万 QPS LLM 网关缓存架构](#q10-10-万-qps-llm-网关缓存架构)
- [Q11: Token 预算管控系统设计](#q11-token-预算管控系统设计)

### 🎯 场景设计题

- [Q12: 多提供商统一服务编排层设计](#q12-多提供商统一服务编排层设计)
- [Q13: 大促活动 LLM 成本飙升快速降本](#q13-大促活动-llm-成本飙升快速降本)
- [Q14: LLM Playground 后端架构设计](#q14-llm-playground-后端架构设计)

---

## Q1: BPE tokenizer 工作原理

**难度**：⭐基础

**题目**：请解释 Byte-Pair Encoding（BPE）tokenizer 的工作原理。为什么 LLM 成本治理需要理解 tokenizer？

<details>
<summary>💡 查看答案</summary>

### 思路分析

BPE 是 GPT 系列模型使用的分词算法，理解它对于准确预估 token 数量、控制 API 成本至关重要。面试中需要从算法步骤、实际影响两个角度回答。

### 核心要点

**BPE 算法步骤：**

```
原始文本: "low lower lowest"

步骤 1: 初始化 — 将文本拆分为单个字符（字节级）
  ['l','o','w','</w>','l','o','w','e','r','</w>','l','o','w','e','s','t','</w>']

步骤 2: 统计相邻字符对的频率
  ('l','o') → 3次, ('o','w') → 3次, ('w','e') → 2次 ...

步骤 3: 合并最高频的字符对 → ('l','o') → 'lo'
  ['lo','w','</w>','lo','w','e','r','</w>','lo','w','e','s','t','</w>']

步骤 4: 重复步骤 2-3，直到达到预定词表大小
  ('lo','w') → 'low' → ['low','</w>','low','e','r','</w>','low','e','s','t','</w>']
```

**不同模型的 tokenizer 差异：**

| 模型 | Tokenizer | 词表大小 | 中文效率 |
|------|-----------|---------|---------|
| GPT-4/4o | cl100k_base / o200k_base | 100K/200K | ~1.5 字符/token |
| Claude 3 | 自研 BPE | ~100K | ~1.4 字符/token |
| Llama 3 | SentencePiece BPE | 128K | ~1.2 字符/token |

**为什么成本治理需要理解 tokenizer：**

1. **成本预估精度**：同一段中文文本，不同 tokenizer 产生的 token 数差异可达 30%
2. **prompt 优化**：了解分词规律后，可以通过改写 prompt 减少 token 消耗
3. **预算管控**：请求发送前需要用对应的 tokenizer 预计算 token 数量

```python
import tiktoken

def estimate_cost(text: str, model: str = "gpt-4o") -> dict:
    """预估 LLM 调用成本"""
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)
    
    # GPT-4o 定价: input $2.5/1M tokens, output $10/1M tokens
    pricing = {
        "gpt-4o": {"input": 2.5 / 1_000_000, "output": 10.0 / 1_000_000},
        "gpt-4o-mini": {"input": 0.15 / 1_000_000, "output": 0.6 / 1_000_000},
    }
    
    input_cost = len(tokens) * pricing[model]["input"]
    return {
        "token_count": len(tokens),
        "estimated_input_cost_usd": round(input_cost, 6),
        "model": model,
    }

# 示例：中文文本的 token 计算
result = estimate_cost("请解释什么是微服务架构，以及它的优缺点。")
# → {'token_count': 21, 'estimated_input_cost_usd': 0.000053, 'model': 'gpt-4o'}
```

### 面试追问

1. **cl100k_base 和 o200k_base 有什么区别？为什么 GPT-4o 要扩大词表？**
   - o200k_base 词表更大（200K vs 100K），对多语言（含中文）的编码效率更高，同等文本产生更少的 token，降低成本。
2. **如果你的系统需要同时支持 OpenAI 和 Claude，token 计数怎么处理？**
   - 需要维护各提供商的 tokenizer 库，在路由层根据目标模型选择对应的 tokenizer 进行预计算。
3. **BPE 和 SentencePiece 的区别是什么？**
   - BPE 基于字符/字节对合并；SentencePiece 从原始文本直接训练，不依赖预分词，对非空格分隔语言（如中文、日文）更友好。

</details>

---

## Q2: 不同 LLM 提供商的定价模型差异与统一计费系统

**难度**：⭐基础

**题目**：不同 LLM 提供商（OpenAI、Anthropic、Google）的定价模型有何差异？如何设计一个统一的计费系统？

<details>
<summary>💡 查看答案</summary>

### 思路分析

LLM 定价看似简单（按 token 计费），实际上各家的计费粒度、计费维度、附加费用差异巨大。统一计费系统需要一个抽象的定价模型层。

### 核心要点

**各提供商定价差异对比（2024-2025）：**

| 维度 | OpenAI | Anthropic | Google |
|------|--------|-----------|--------|
| 基本计费单位 | Token（BPE） | Token（自研 BPE） | Character / Token |
| Input/Output 分别定价 | ✅ | ✅ | ✅ |
| 缓存 token 折扣 | ✅ Prompt Caching（50% off） | ✅ Prompt Caching（90% off） | ✅ Context Caching |
| 图片/音视频计费 | 按 token 折算 | 按 token 折算 | 按秒/像素等 |
| 批量 API 折扣 | ✅ Batch API（50% off） | ✅ Message Batches | ✅ |
| 速率限制维度 | RPM + TPM | RPM + TPM | RPM + TPM |
| 微调模型加价 | 训练费 + 推理加价 | 不支持公开微调 | 训练费 + 推理加价 |

**统一计费系统架构：**

```
┌─────────────────────────────────────────────────┐
│                 统一计费系统                       │
├─────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ 定价配置  │  │ 用量采集  │  │ 账单生成  │      │
│  │ Registry │  │ Collector│  │ Billing  │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │              │              │            │
│  ┌────▼──────────────▼──────────────▼─────┐     │
│  │         统一度量模型 (Unified Metric)     │     │
│  │  input_tokens | output_tokens | extras  │     │
│  └────────────────────────────────────────┘     │
│       │              │              │            │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐     │
│  │ OpenAI   │  │Anthropic │  │ Google   │     │
│  │ Adapter  │  │ Adapter  │  │ Adapter  │     │
│  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────┘
```

```python
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

class Provider(Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"

@dataclass
class PricingRule:
    """每个模型的定价规则"""
    model_id: str
    provider: Provider
    input_price_per_mtok: Decimal   # 每百万 input token 价格 (USD)
    output_price_per_mtok: Decimal  # 每百万 output token 价格 (USD)
    cached_input_discount: Decimal  # 缓存命中折扣率 (0-1)
    batch_discount: Decimal         # 批量处理折扣率 (0-1)

@dataclass
class UsageRecord:
    """统一用量记录"""
    request_id: str
    model_id: str
    provider: Provider
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0
    is_batch: bool = False

class UnifiedBillingEngine:
    def __init__(self):
        self._pricing: dict[str, PricingRule] = {}
    
    def register_pricing(self, rule: PricingRule):
        self._pricing[rule.model_id] = rule
    
    def calculate_cost(self, usage: UsageRecord) -> Decimal:
        rule = self._pricing[usage.model_id]
        
        # 普通 input token 费用
        regular_input = usage.input_tokens - usage.cached_input_tokens
        input_cost = Decimal(regular_input) * rule.input_price_per_mtok / Decimal(1_000_000)
        
        # 缓存命中 input token 费用（打折）
        cached_cost = (Decimal(usage.cached_input_tokens) 
                      * rule.input_price_per_mtok 
                      * (1 - rule.cached_input_discount) 
                      / Decimal(1_000_000))
        
        # output token 费用
        output_cost = Decimal(usage.output_tokens) * rule.output_price_per_mtok / Decimal(1_000_000)
        
        total = input_cost + cached_cost + output_cost
        
        # 批量折扣
        if usage.is_batch:
            total *= (1 - rule.batch_discount)
        
        return total.quantize(Decimal("0.000001"))
```

### 面试追问

1. **如何处理定价变更？某个提供商突然调价怎么办？**
   - 定价配置应从外部配置中心加载，支持版本化和热更新。每条用量记录绑定生效时的定价快照，确保账单准确。
2. **除了 token 费用，还有哪些隐藏成本需要纳入计费？**
   - 网络传输费用、API 重试的额外 token 消耗、prompt caching 的存储费用、微调模型的训练费用、以及超限后的排队等待带来的间接成本。
3. **用 float 还是 Decimal 做价格计算？为什么？**
   - 必须使用 Decimal，浮点数的精度丢失在大量累积计算中会导致账单金额偏差。

</details>

---

## Q3: Virtual Key 与代理 API Key

**难度**：⭐基础

**题目**：什么是 Virtual Key？为什么需要代理 API Key？请说明其安全架构设计。

<details>
<summary>💡 查看答案</summary>

### 思路分析

Virtual Key 是 LLM 网关层的核心安全概念。直接暴露提供商的 API Key 给业务方会带来安全风险、无法精细控制权限和用量、难以轮换密钥。Virtual Key 是在这些问题上的抽象层。

### 核心要点

**为什么不能直接用原始 API Key：**

```
❌ 直接使用提供商 Key 的问题：
┌──────────┐     ┌──────────┐
│ 业务方 A  │──── │          │
├──────────┤     │ OpenAI   │  • Key 泄露影响所有业务方
│ 业务方 B  │──── │ API Key  │  • 无法按业务方限额
├──────────┤     │ (同一个)  │  • 无法审计谁用了多少
│ 业务方 C  │──── │          │  • 轮换 Key 需通知所有人
└──────────┘     └──────────┘

✅ Virtual Key 代理模式：
┌──────────┐     ┌────────────────┐     ┌──────────┐
│ 业务方 A  │──vk-│  LLM Gateway   │     │ OpenAI   │
├──────────┤  a  │  ┌──────────┐  │──── │ Key Pool │
│ 业务方 B  │──vk-│  │ Key 映射  │  │     ├──────────┤
├──────────┤  b  │  │ 权限控制  │  │──── │Anthropic │
│ 业务方 C  │──vk-│  │ 用量统计  │  │     │ Key Pool │
└──────────┘  c  │  └──────────┘  │     └──────────┘
                 └────────────────┘
```

**Virtual Key 系统设计：**

```python
import hashlib
import secrets
from datetime import datetime
from dataclasses import dataclass, field

@dataclass
class VirtualKey:
    """虚拟密钥：业务方使用的代理 Key"""
    vk_id: str                          # vk-xxxxxxxxxxxx
    tenant_id: str                      # 所属租户
    allowed_models: list[str]           # 可访问的模型列表
    rate_limit_rpm: int                 # 每分钟请求上限
    budget_limit_usd: float             # 月度预算上限
    expires_at: datetime | None = None  # 过期时间
    metadata: dict = field(default_factory=dict)

class VirtualKeyManager:
    def __init__(self, key_store, provider_key_pool):
        self._store = key_store              # 虚拟 Key 存储
        self._pool = provider_key_pool       # 真实 Key 池
    
    def create_virtual_key(self, tenant_id: str, **kwargs) -> str:
        """为租户生成虚拟密钥"""
        vk_id = f"vk-{secrets.token_hex(16)}"
        vk = VirtualKey(vk_id=vk_id, tenant_id=tenant_id, **kwargs)
        self._store.save(vk)
        return vk_id
    
    def resolve_and_validate(self, vk_id: str, model: str) -> str:
        """将 Virtual Key 解析为真实 Provider Key，并校验权限"""
        vk = self._store.get(vk_id)
        if not vk:
            raise AuthError("Invalid virtual key")
        if vk.expires_at and datetime.utcnow() > vk.expires_at:
            raise AuthError("Virtual key expired")
        if model not in vk.allowed_models:
            raise AuthError(f"Model {model} not allowed for this key")
        
        # 从 Key 池中获取可用的真实 Key（考虑 rate limit 均衡）
        real_key = self._pool.get_available_key(
            provider=self._get_provider(model),
            rpm_headroom=1
        )
        return real_key
```

**Virtual Key 的核心安全能力：**

| 能力 | 说明 |
|------|------|
| 权限隔离 | 每个 Virtual Key 绑定允许的模型列表 |
| 独立限额 | 每个 Key 有独立的 RPM / TPM / 预算上限 |
| 无感轮换 | 后端 Provider Key 轮换不影响业务方 |
| 审计追踪 | 每个请求关联到具体的 Virtual Key 和租户 |
| 即时吊销 | 可即时禁用某个 Virtual Key 而不影响其他方 |

### 面试追问

1. **Virtual Key 应该存储在哪里？Redis 还是数据库？**
   - 热数据（验证/限流）放 Redis，冷数据（配置/审计日志）放数据库。高频验证操作应使用本地缓存 + TTL 避免每次请求都查 Redis。
2. **如何防止 Virtual Key 泄露后被滥用？**
   - 绑定 IP 白名单、设置过期时间、启用异常检测（突发用量告警）、支持即时吊销、记录完整审计日志。
3. **Provider Key Pool 的 Key 轮换策略如何设计？**
   - 采用双 Key 滑动窗口：新旧 Key 并存一段时间，逐步将流量切换到新 Key，确认旧 Key 无活跃请求后再废弃。

</details>

---

## Q4: 多模型统一路由层设计

**难度**：⭐⭐进阶

**题目**：设计一个支持多模型的统一路由层，需要考虑哪些核心问题？

<details>
<summary>💡 查看答案</summary>

### 思路分析

统一路由层是 LLM 网关的核心组件，需要将异构的 LLM 提供商 API 统一成一致的接口，同时处理路由决策、协议转换、错误处理等复杂问题。

### 核心要点

**统一路由层架构：**

```
                    ┌─────────────────────────────────────────┐
                    │            统一路由层 (Router)            │
Client ──────────►  │                                         │
  POST /v1/chat     │  ┌─────────┐  ┌─────────┐  ┌────────┐ │
  {                 │  │ 协议适配 │→ │ 路由决策 │→ │ 重试/  │ │
    model: "smart", │  │ Adapter  │  │ Strategy│  │ 降级   │ │
    messages: [...] │  └─────────┘  └─────────┘  └────────┘ │
  }                 │       │              │            │      │
                    │  ┌────▼──────────────▼────────────▼───┐ │
                    │  │        Provider Connectors          │ │
                    │  ├──────────┬──────────┬──────────────┤ │
                    │  │ OpenAI   │ Claude   │ Gemini       │ │
                    │  └──────────┴──────────┴──────────────┘ │
                    └─────────────────────────────────────────┘
```

**需要考虑的核心问题：**

**1. 协议适配 — 统一请求/响应格式**

```python
from abc import ABC, abstractmethod

@dataclass
class UnifiedRequest:
    """统一请求格式（以 OpenAI 格式为基准）"""
    model: str                    # 逻辑模型名（如 "smart", "fast"）
    messages: list[dict]          # 统一消息格式
    temperature: float = 0.7
    max_tokens: int | None = None
    stream: bool = False
    tools: list[dict] | None = None

class ProviderAdapter(ABC):
    @abstractmethod
    def to_provider_request(self, req: UnifiedRequest) -> dict:
        """将统一请求转为提供商特定格式"""
    
    @abstractmethod
    def from_provider_response(self, resp: dict) -> UnifiedResponse:
        """将提供商响应转为统一格式"""

class AnthropicAdapter(ProviderAdapter):
    def to_provider_request(self, req: UnifiedRequest) -> dict:
        # OpenAI messages → Anthropic messages 转换
        system_msg = None
        messages = []
        for msg in req.messages:
            if msg["role"] == "system":
                system_msg = msg["content"]     # Anthropic 的 system 是顶层参数
            else:
                messages.append(msg)
        
        return {
            "model": self._map_model(req.model),
            "system": system_msg,
            "messages": messages,
            "max_tokens": req.max_tokens or 4096,  # Anthropic 必须指定
            "temperature": req.temperature,
        }
```

**2. 路由策略 — 逻辑模型到物理模型的映射**

```yaml
# 路由配置示例
routing_rules:
  - logical_model: "smart"          # 业务方使用的逻辑名
    strategy: "priority_fallback"   # 优先级降级策略
    targets:
      - provider: openai
        model: gpt-4o
        priority: 1
        weight: 70
      - provider: anthropic
        model: claude-sonnet-4-20250514
        priority: 1
        weight: 30
      - provider: google
        model: gemini-2.0-flash
        priority: 2                  # 降级备选

  - logical_model: "fast"
    strategy: "least_cost"          # 最低成本策略
    targets:
      - provider: openai
        model: gpt-4o-mini
      - provider: anthropic
        model: claude-haiku-4-20250414
```

**3. 关键设计决策对比**

| 维度 | 方案 A：OpenAI 兼容 | 方案 B：自定义协议 |
|------|--------------------|--------------------|
| 客户端迁移成本 | 低（改 base_url 即可） | 高（需适配新 SDK） |
| 功能覆盖度 | 受限于 OpenAI 格式 | 可支持各家特性 |
| 生态兼容性 | 高（LangChain 等直接用） | 低（需写适配器） |
| 业界选择 | LiteLLM, OneAPI | 少数自研网关 |

### 面试追问

1. **Function Calling / Tool Use 的格式在各家差异很大，如何统一？**
   - 以 OpenAI 的 tools 格式为标准，在 Adapter 层做双向转换。Claude 的 tool_use 需要特殊处理 tool_result 消息的嵌套。
2. **流式响应中各提供商的 SSE 格式不同，如何统一流式输出？**
   - 在 Adapter 层实现流式转换器（StreamTransformer），将各家的 SSE chunk 实时转为统一格式，注意处理 Claude 的 content_block_delta 事件。
3. **如何处理各提供商独有的功能（如 Claude 的 extended thinking）？**
   - 通过 `extra_params` 透传字段实现，路由层不解析这些字段，直接传递给对应的 Adapter。

</details>

---

## Q5: 精确缓存 vs 语义缓存

**难度**：⭐⭐进阶

**题目**：精确缓存（Exact Cache）和语义缓存（Semantic Cache）的实现原理和适用场景分别是什么？

<details>
<summary>💡 查看答案</summary>

### 思路分析

缓存是 LLM 成本优化的关键手段。精确缓存简单但命中率低，语义缓存命中率高但引入额外的复杂性和模糊匹配风险。面试中需要清楚二者的权衡。

### 核心要点

**两种缓存的对比：**

```
精确缓存 (Exact Cache):
  Query: "什么是微服务？"  ─hash─→ "a3f2c1..." → Cache Hit ✅
  Query: "微服务是什么？"  ─hash─→ "b7e4d2..." → Cache Miss ❌

语义缓存 (Semantic Cache):
  Query: "什么是微服务？"  ─embed─→ [0.82, 0.13, ...] ─┐
                                                        ├→ similarity=0.96 → Hit ✅
  Query: "微服务是什么？"  ─embed─→ [0.81, 0.14, ...] ─┘
```

| 维度 | 精确缓存 | 语义缓存 |
|------|---------|---------|
| 匹配方式 | 哈希完全一致 | 向量相似度 > 阈值 |
| 命中率 | 低（5-15%） | 高（30-60%） |
| 实现复杂度 | 低（Redis 即可） | 高（需向量数据库 + embedding 模型） |
| 延迟开销 | < 1ms | 10-50ms（embedding 计算） |
| 正确性 | 100% 准确 | 存在误匹配风险 |
| 适用场景 | FAQ、模板化查询 | 自然语言查询、客服场景 |

**实现示例：**

```python
import hashlib
import numpy as np
from dataclasses import dataclass

@dataclass
class CacheEntry:
    key: str
    response: str
    embedding: list[float] | None = None
    hit_count: int = 0
    created_at: float = 0

class ExactCache:
    """精确缓存：基于请求内容的哈希匹配"""
    
    def __init__(self, redis_client):
        self._redis = redis_client
    
    def _make_key(self, model: str, messages: list[dict], temperature: float) -> str:
        # 将请求参数序列化后取哈希
        content = f"{model}:{temperature}:{json.dumps(messages, sort_keys=True)}"
        return f"llm:exact:{hashlib.sha256(content.encode()).hexdigest()}"
    
    def get(self, model, messages, temperature) -> str | None:
        key = self._make_key(model, messages, temperature)
        return self._redis.get(key)
    
    def set(self, model, messages, temperature, response, ttl=3600):
        key = self._make_key(model, messages, temperature)
        self._redis.setex(key, ttl, response)


class SemanticCache:
    """语义缓存：基于向量相似度的模糊匹配"""
    
    def __init__(self, embedding_model, vector_store, threshold=0.95):
        self._embedder = embedding_model
        self._store = vector_store       # 如 Qdrant, Pinecone
        self._threshold = threshold      # 相似度阈值
    
    def get(self, query: str) -> str | None:
        query_embedding = self._embedder.encode(query)
        
        results = self._store.search(
            vector=query_embedding,
            limit=1,
            score_threshold=self._threshold
        )
        
        if results:
            return results[0].payload["response"]
        return None
    
    def set(self, query: str, response: str):
        embedding = self._embedder.encode(query)
        self._store.upsert(
            id=hashlib.md5(query.encode()).hexdigest(),
            vector=embedding,
            payload={"query": query, "response": response}
        )


class HybridCache:
    """混合缓存：先精确匹配，再语义匹配"""
    
    def __init__(self, exact_cache, semantic_cache):
        self._exact = exact_cache
        self._semantic = semantic_cache
    
    def get(self, model, messages, temperature) -> str | None:
        # 第一层：精确匹配（< 1ms）
        result = self._exact.get(model, messages, temperature)
        if result:
            return result
        
        # 第二层：语义匹配（~30ms）
        query = messages[-1]["content"]  # 取最后一条用户消息
        return self._semantic.get(query)
```

**语义缓存的阈值调优：**

```
阈值过高 (>0.98)：命中率低，接近精确匹配
阈值适中 (0.93-0.96)：平衡命中率和准确性 ← 推荐
阈值过低 (<0.90)：命中率高但误匹配多，返回不相关的缓存结果

实际建议：按业务场景分别设置阈值
  - 客服 FAQ：0.92（允许较宽泛的匹配）
  - 代码生成：0.98（要求高精度匹配）
  - 翻译任务：0.95（中等精度）
```

### 面试追问

1. **语义缓存的 embedding 计算本身也要花钱（调 API），这个成本怎么考虑？**
   - 使用轻量本地 embedding 模型（如 BGE-small），推理延迟 < 5ms 且无 API 费用。只有当本地模型能力不足时才考虑 API。
2. **temperature > 0 时缓存还有意义吗？**
   - temperature=0 时缓存完全有效。temperature > 0 时需要根据业务场景判断：FAQ 类场景可以缓存，创意写作类场景不适合缓存。
3. **缓存污染（Cache Poisoning）如何防范？**
   - 缓存写入时校验响应质量（如长度、格式），设置合理的 TTL，支持手动清除特定缓存条目，对高风险场景增加人工审核。

</details>

---

## Q6: LLM 负载均衡与 rate-limit-aware 路由

**难度**：⭐⭐进阶

**题目**：LLM 负载均衡与传统 Web 服务负载均衡有何不同？如何设计 rate-limit-aware 的路由策略？

<details>
<summary>💡 查看答案</summary>

### 思路分析

传统 Web 负载均衡关注的是后端服务器的健康状态和处理能力，而 LLM 负载均衡面对的是外部 API 的 rate limit 约束，需要在多个 API Key 和多个提供商之间智能分配请求。

### 核心要点

**核心差异对比：**

| 维度 | 传统 Web LB | LLM LB |
|------|------------|--------|
| 后端控制权 | 自有服务器，可扩缩容 | 第三方 API，无法扩容 |
| 瓶颈来源 | CPU/内存/连接数 | RPM/TPM Rate Limit |
| 请求代价 | 毫秒级、基本免费 | 秒级、按 token 收费 |
| 负载指标 | QPS、延迟、错误率 | 剩余 RPM/TPM 配额 |
| 故障模式 | 服务崩溃/超时 | 429 Too Many Requests |
| 均衡粒度 | 请求级 | 请求级 + Token 级 |

**Rate-Limit-Aware 路由架构：**

```
                    ┌─────────────────────────────┐
                    │    Rate-Limit-Aware Router   │
 Request ──────►   │                               │
                    │  ┌─────────────────────────┐ │
                    │  │   Key Pool Manager      │ │
                    │  │                         │ │
                    │  │  Key-A: RPM 45/60       │ │
                    │  │         TPM 80K/100K    │ │
                    │  │  Key-B: RPM 12/60  ◄── │ │ ← 选择此 Key
                    │  │         TPM 20K/100K    │ │
                    │  │  Key-C: RPM 58/60  ⚠️   │ │ ← 接近限额
                    │  └─────────────────────────┘ │
                    └─────────────────────────────┘
```

```python
import time
from dataclasses import dataclass
from threading import Lock

@dataclass
class KeyQuota:
    """API Key 的配额追踪"""
    key: str
    rpm_limit: int
    tpm_limit: int
    rpm_used: int = 0
    tpm_used: int = 0
    window_start: float = 0
    cooldown_until: float = 0  # 429 后冷却到何时

class RateLimitAwareRouter:
    def __init__(self):
        self._keys: dict[str, list[KeyQuota]] = {}  # provider → key quotas
        self._lock = Lock()
    
    def select_key(self, provider: str, estimated_tokens: int) -> KeyQuota | None:
        """选择最优 Key：优先选剩余配额最充足的"""
        with self._lock:
            now = time.time()
            candidates = []
            
            for kq in self._keys.get(provider, []):
                # 重置过期窗口
                if now - kq.window_start >= 60:
                    kq.rpm_used = 0
                    kq.tpm_used = 0
                    kq.window_start = now
                
                # 跳过冷却中的 Key
                if now < kq.cooldown_until:
                    continue
                
                # 检查是否有足够配额
                rpm_remaining = kq.rpm_limit - kq.rpm_used
                tpm_remaining = kq.tpm_limit - kq.tpm_used
                
                if rpm_remaining > 0 and tpm_remaining >= estimated_tokens:
                    candidates.append((kq, rpm_remaining, tpm_remaining))
            
            if not candidates:
                return None  # 所有 Key 都已耗尽或冷却中
            
            # 策略：选择 TPM 剩余最多的 Key
            candidates.sort(key=lambda x: x[2], reverse=True)
            best = candidates[0][0]
            
            # 预扣配额
            best.rpm_used += 1
            best.tpm_used += estimated_tokens
            return best
    
    def handle_rate_limit(self, key: str, retry_after: int = 60):
        """收到 429 后将 Key 加入冷却期"""
        with self._lock:
            for keys in self._keys.values():
                for kq in keys:
                    if kq.key == key:
                        kq.cooldown_until = time.time() + retry_after
                        return
```

**进阶策略 — 响应头感知：**

各提供商会在响应头中返回剩余配额信息：

```
# OpenAI 响应头示例
x-ratelimit-remaining-requests: 42
x-ratelimit-remaining-tokens: 85000
x-ratelimit-reset-requests: 18s

# 利用实际响应头校准本地计数，比自己估算更准确
```

### 面试追问

1. **TPM 限额是按 input+output 总和还是分别限制？**
   - 各提供商不同。OpenAI 的 TPM 是 input+output 总和；Anthropic 分别有 input TPM 和 output TPM 限制。路由策略需要根据提供商的具体规则分别处理。
2. **如果所有 Key 都被限流了怎么办？**
   - 三级应对：① 排队等待（短暂限流）→ ② 降级到备选提供商 → ③ 返回友好的限流提示给用户并提供预估恢复时间。
3. **配额预扣（Reservation）机制可能出现什么问题？**
   - 预扣 token 数只是估算值，实际 output token 可能远超预期，导致配额账本不准。需要在响应完成后用实际 token 数修正配额计数。

</details>

---

## Q7: LLM 提供商自动降级和 fallback 链

**难度**：⭐⭐进阶

**题目**：如何实现 LLM 提供商的自动降级和 Fallback 链？与传统微服务的降级有何本质区别？

<details>
<summary>💡 查看答案</summary>

### 思路分析

LLM 降级不仅仅是"服务不可用时切换到备用"，更涉及模型能力的降级——不同模型的推理能力、上下文长度、功能支持（如 tool use）各不相同，降级时必须考虑能力兼容性。

### 核心要点

**LLM 降级 vs 传统微服务降级：**

| 维度 | 传统微服务降级 | LLM 降级 |
|------|-------------|---------|
| 降级触发 | 服务不可用/超时 | 429 限流 / 服务不可用 / 超时 |
| 备选服务 | 同质（功能完全相同） | 异质（模型能力不同） |
| 输出一致性 | 备选返回相同格式 | 不同模型输出质量/格式有差异 |
| 成本影响 | 备选成本相近 | 降级可能更贵或更便宜 |
| 功能兼容 | 接口一致 | tool use / vision 等能力不一定都支持 |

**Fallback 链设计：**

```
Fallback Chain: GPT-4o → Claude Sonnet → GPT-4o-mini → 静态兜底
                 │          │               │              │
                 │          │               │              └─ 返回预设回复
                 │          │               └─ 能力降级：更快但不够智能
                 │          └─ 同级切换：相近能力
                 └─ 首选：最优质量
                 
降级决策树：
  错误类型 429 (Rate Limit) → 切换同级别模型
  错误类型 500 (Server Error) → 切换提供商
  错误类型 Timeout → 切换更快的模型
  连续失败 ≥ 3 次 → 跳过该提供商 30 秒（熔断）
```

```python
import asyncio
import time
from dataclasses import dataclass
from enum import Enum

class FallbackReason(Enum):
    RATE_LIMITED = "rate_limited"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    CAPABILITY_MISMATCH = "capability_mismatch"

@dataclass
class ModelTarget:
    provider: str
    model: str
    capabilities: set[str]       # {"tool_use", "vision", "long_context"}
    max_context: int
    priority: int                # 越小优先级越高
    circuit_open_until: float = 0  # 熔断到何时

class FallbackChain:
    def __init__(self, targets: list[ModelTarget], max_retries: int = 3):
        self._targets = sorted(targets, key=lambda t: t.priority)
        self._max_retries = max_retries
        self._failure_counts: dict[str, int] = {}
    
    async def execute(self, request, required_capabilities: set[str] = None):
        """沿 Fallback 链执行请求"""
        last_error = None
        
        for target in self._targets:
            # 检查熔断状态
            if time.time() < target.circuit_open_until:
                continue
            
            # 检查能力兼容性
            if required_capabilities and not required_capabilities.issubset(target.capabilities):
                continue  # 跳过不支持所需能力的模型
            
            # 检查上下文长度
            if request.estimated_tokens > target.max_context:
                continue
            
            try:
                response = await self._call_provider(target, request)
                self._failure_counts[target.model] = 0  # 重置失败计数
                
                # 在响应中标注实际使用的模型（降级透明化）
                response.metadata["actual_model"] = target.model
                response.metadata["is_fallback"] = (target != self._targets[0])
                return response
                
            except RateLimitError:
                last_error = FallbackReason.RATE_LIMITED
                continue  # 直接尝试下一个
                
            except TimeoutError:
                last_error = FallbackReason.TIMEOUT
                self._record_failure(target)
                continue
                
            except ServerError:
                last_error = FallbackReason.SERVER_ERROR
                self._record_failure(target)
                continue
        
        # 所有目标都失败 → 静态兜底
        return self._static_fallback(request, last_error)
    
    def _record_failure(self, target: ModelTarget):
        key = target.model
        self._failure_counts[key] = self._failure_counts.get(key, 0) + 1
        if self._failure_counts[key] >= self._max_retries:
            target.circuit_open_until = time.time() + 30  # 熔断 30 秒
    
    def _static_fallback(self, request, reason):
        """静态兜底响应"""
        return {
            "content": "抱歉，当前服务繁忙，请稍后重试。",
            "metadata": {"is_static_fallback": True, "reason": reason}
        }
```

**降级透明化 — 让调用方知道发生了降级：**

```json
{
  "response": "...",
  "metadata": {
    "requested_model": "gpt-4o",
    "actual_model": "claude-sonnet-4-20250514",
    "is_fallback": true,
    "fallback_reason": "rate_limited",
    "quality_tier": "equivalent"
  }
}
```

### 面试追问

1. **降级到更弱的模型后，输出格式可能不兼容（如 JSON 格式不正确），怎么处理？**
   - 在降级链中增加"输出校验层"，对弱模型的输出做格式校验和修复。对于结构化输出（JSON），可增加一次修复调用或使用 JSON Schema 验证 + 正则修复。
2. **如何决定 Fallback 链中模型的优先级顺序？**
   - 综合考虑：能力评分（质量）× 可用性 × 1/成本。定期用评测集对各模型做自动化打分，动态调整优先级。
3. **熔断恢复后怎么验证提供商确实恢复了？**
   - 半开状态（Half-Open）：熔断超时后，先放入少量探测请求，成功率达标后才完全恢复流量。

</details>

---

## Q8: 多租户 LLM 平台预算管理系统

**难度**：⭐⭐进阶

**题目**：设计一个多租户 LLM 平台的预算管理系统，需要支持哪些核心功能？

<details>
<summary>💡 查看答案</summary>

### 思路分析

多租户场景下，每个租户有独立的预算额度、使用统计和告警阈值。系统需要在保证实时性的同时处理高并发的预算扣减操作，避免超支。

### 核心要点

**预算管理系统架构：**

```
┌────────────────────────────────────────────────────────────┐
│                    预算管理系统                               │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 预算分配  │  │ 实时扣减  │  │ 用量统计  │  │ 告警引擎  │  │
│  │ Allocator│  │ Deductor │  │ Analytics│  │ Alerting │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │              │        │
│  ┌────▼──────────────▼──────────────▼──────────────▼────┐  │
│  │              预算账本 (Budget Ledger)                  │  │
│  │                                                      │  │
│  │  Tenant-A: $1000/月 | 已用 $623.45 | 剩余 $376.55   │  │
│  │  Tenant-B: $500/月  | 已用 $489.20 | 剩余 $10.80 ⚠️ │  │
│  │  Tenant-C: $2000/月 | 已用 $1200   | 剩余 $800      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              层级预算结构                               │  │
│  │  Organization → Department → Project → User           │  │
│  │  $10000/月     $3000/月      $500/月    $50/天        │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

```python
import time
from decimal import Decimal

class BudgetManager:
    """多租户预算管理器"""
    
    def __init__(self, redis_client, db_client):
        self._redis = redis_client
        self._db = db_client
    
    def check_and_reserve(self, tenant_id: str, estimated_cost: Decimal) -> bool:
        """预检+预留：请求发送前调用"""
        budget_key = f"budget:{tenant_id}:monthly"
        
        # Lua 脚本保证原子性：检查剩余额度 → 预扣
        lua_script = """
        local remaining = tonumber(redis.call('GET', KEYS[1]) or '0')
        local cost = tonumber(ARGV[1])
        if remaining >= cost then
            redis.call('DECRBY', KEYS[1], ARGV[1])
            return 1
        else
            return 0
        end
        """
        
        result = self._redis.eval(lua_script, 1, budget_key, str(estimated_cost))
        return result == 1
    
    def settle(self, tenant_id: str, estimated_cost: Decimal, actual_cost: Decimal):
        """结算：请求完成后，用实际成本修正预留金额"""
        diff = estimated_cost - actual_cost
        budget_key = f"budget:{tenant_id}:monthly"
        
        if diff > 0:
            # 实际成本低于预估 → 退还差额
            self._redis.incrbyfloat(budget_key, float(diff))
        elif diff < 0:
            # 实际成本高于预估 → 追加扣减
            self._redis.incrbyfloat(budget_key, float(diff))
        
        # 异步写入明细账单
        self._record_usage(tenant_id, actual_cost)
    
    def check_alerts(self, tenant_id: str):
        """检查预算告警阈值"""
        budget_key = f"budget:{tenant_id}:monthly"
        remaining = Decimal(self._redis.get(budget_key) or "0")
        total = self._get_total_budget(tenant_id)
        
        usage_ratio = 1 - (remaining / total) if total > 0 else 1
        
        thresholds = [
            (Decimal("0.80"), "WARNING", "预算已使用 80%"),
            (Decimal("0.95"), "CRITICAL", "预算已使用 95%"),
            (Decimal("1.00"), "BLOCK", "预算已耗尽，请求将被拒绝"),
        ]
        
        for threshold, level, message in thresholds:
            if usage_ratio >= threshold:
                self._send_alert(tenant_id, level, message)
                if level == "BLOCK":
                    self._block_tenant(tenant_id)
                break
```

**层级预算模型 — 自上而下的额度分配：**

```
Organization: Acme Corp ($10,000/月)
├── Engineering ($6,000)
│   ├── Backend Team ($3,000)
│   │   ├── User: Alice ($500)
│   │   └── User: Bob ($500)
│   └── AI Team ($3,000)
│       └── Project: Chatbot ($2,000)
└── Marketing ($4,000)
    └── Project: Content Gen ($3,000)

约束规则：
  • 子层级预算之和 ≤ 父层级预算
  • 请求时自下而上校验所有层级的剩余额度
  • 任一层级超支即拒绝请求
```

**软限制 vs 硬限制：**

| 限制类型 | 行为 | 场景 |
|---------|------|------|
| 软限制（Soft Limit） | 超支后告警但不阻断 | 开发/测试环境 |
| 硬限制（Hard Limit） | 超支后立即拒绝请求 | 生产环境 / 外部客户 |
| 弹性限制（Burst） | 允许短期超支 N%，月底结算 | 突发流量场景 |

### 面试追问

1. **高并发下 Redis 预扣操作的准确性如何保证？**
   - 使用 Lua 脚本保证"检查+扣减"的原子性。也可使用 Redis 的 `WATCH + MULTI` 事务，但 Lua 脚本性能更优。
2. **预算周期切换（月初重置）时如何处理正在进行的请求？**
   - 在周期切换时不要直接重置，而是新建新周期的 Key。旧周期的 Key 设置短 TTL 自动过期，正在进行的请求用旧周期结算。
3. **如何避免"预留但未使用"导致的预算虚耗？**
   - 设置预留超时机制（如 2 分钟），超时未结算的预留自动释放。定期对账修复 Redis 与数据库的差异。

</details>

---

## Q9: 流式请求中的 token 用量和成本计算

**难度**：⭐⭐⭐高级

**题目**：在流式（Streaming）请求中如何准确计算 token 用量和成本？有哪些技术挑战？

<details>
<summary>💡 查看答案</summary>

### 思路分析

流式请求的核心挑战在于：响应是分多个 chunk 逐步返回的，在流完成之前你不知道最终的 output token 总量。这对实时计费、预算管控、用量监控都构成挑战。

### 核心要点

**流式场景的特殊挑战：**

```
非流式请求：
  Request ─────────────────────► Response (含 usage 字段)
  │                               │
  └── 请求发送 ──── 等待 ────── 一次性获得完整 usage ──┘

流式请求：
  Request ─► chunk1 ─► chunk2 ─► chunk3 ─► ... ─► [DONE]
  │           │          │         │                  │
  └── 发送 ── 无usage ── 无usage ─ 无usage ── 最后一个chunk可能有usage
  
  问题：
  1. 何时计费？流中间用户断开怎么办？
  2. 多数提供商只在最后一个 chunk 返回 usage
  3. 流式传输过程中如何实时监控成本？
```

**解决方案：三阶段计量**

```python
import asyncio
import tiktoken
from dataclasses import dataclass, field

@dataclass
class StreamingUsageTracker:
    """流式请求的三阶段 token 计量器"""
    model: str
    input_tokens: int = 0           # Phase 1: 预计算
    estimated_output_tokens: int = 0 # Phase 2: 实时估算
    actual_output_tokens: int = 0    # Phase 3: 最终确认
    chunks_received: int = 0
    _buffer: str = ""
    _encoding: object = field(default=None, repr=False)
    
    def __post_init__(self):
        self._encoding = tiktoken.encoding_for_model(self.model)
    
    # ── Phase 1: 请求前预计算 input tokens ──
    def pre_calculate_input(self, messages: list[dict]) -> int:
        """在发送请求前精确计算 input token 数"""
        text = "".join(m.get("content", "") for m in messages)
        self.input_tokens = len(self._encoding.encode(text))
        # 加上消息格式开销（每条消息约 4 tokens 的格式开销）
        self.input_tokens += len(messages) * 4
        return self.input_tokens
    
    # ── Phase 2: 流式传输中实时估算 output tokens ──
    def on_chunk(self, chunk_text: str):
        """每收到一个 chunk 时调用，实时估算累计 output tokens"""
        self.chunks_received += 1
        self._buffer += chunk_text
        # 定期（每 10 个 chunk）重新计算，避免逐 chunk 编码的性能开销
        if self.chunks_received % 10 == 0:
            self.estimated_output_tokens = len(self._encoding.encode(self._buffer))
    
    # ── Phase 3: 流结束后用提供商返回的实际值修正 ──
    def finalize(self, provider_usage: dict | None):
        """流结束时调用：优先使用提供商返回的精确值"""
        if provider_usage:
            self.actual_output_tokens = provider_usage.get("completion_tokens", 0)
            self.input_tokens = provider_usage.get("prompt_tokens", self.input_tokens)
        else:
            # 提供商未返回 usage，用本地计算值
            self.actual_output_tokens = len(self._encoding.encode(self._buffer))
    
    def get_cost(self, pricing: dict) -> Decimal:
        tokens = self.actual_output_tokens or self.estimated_output_tokens
        input_cost = Decimal(self.input_tokens) * pricing["input_per_mtok"] / 1_000_000
        output_cost = Decimal(tokens) * pricing["output_per_mtok"] / 1_000_000
        return input_cost + output_cost


async def stream_with_tracking(client, request, tracker: StreamingUsageTracker):
    """带成本追踪的流式请求处理"""
    
    # Phase 1: 预计算
    tracker.pre_calculate_input(request.messages)
    
    try:
        async for chunk in client.stream(request):
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                
                # Phase 2: 实时估算
                tracker.on_chunk(text)
                yield text  # 转发给客户端
            
            # 检查是否包含 usage 信息（最后一个 chunk）
            if hasattr(chunk, "usage") and chunk.usage:
                tracker.finalize({
                    "prompt_tokens": chunk.usage.prompt_tokens,
                    "completion_tokens": chunk.usage.completion_tokens,
                })
    
    except (ConnectionError, asyncio.CancelledError):
        # 客户端中途断开 — 仍需计费已消耗的 tokens
        tracker.finalize(None)
    
    finally:
        # 无论流是否正常结束，都要记录用量
        cost = tracker.get_cost(PRICING[request.model])
        await record_usage(request.tenant_id, tracker, cost)
```

**各提供商流式 usage 返回方式：**

| 提供商 | 流式 usage 返回方式 | 注意事项 |
|--------|--------------------|---------| 
| OpenAI | 最后一个 chunk 的 `usage` 字段 | 需设置 `stream_options={"include_usage": True}` |
| Anthropic | `message_delta` 事件中的 `usage` | 自动包含，无需额外参数 |
| Google | 每个 chunk 都含 `usageMetadata` | 累计值，非增量值 |

**关键设计决策：客户端断开时的计费策略**

```
场景：用户在流传输到 50% 时关闭页面
  
  ❌ 不计费：提供商已产生 token，你仍需为此付费给提供商
  ✅ 按已产生 token 计费：公平计费，但 output token 无法精确知道
  
  方案：
  1. 向上游提供商发送取消信号（如果支持）
  2. 用本地估算的 token 数作为计费依据
  3. 在审计日志中标记为"中断流"，便于对账
```

### 面试追问

1. **OpenAI 的 `stream_options.include_usage` 是否会增加延迟？**
   - 不会增加可感知的延迟。它只是在最后一个 chunk 附加 usage 信息，但需要注意这个 chunk 中 `choices` 为空，需要特殊处理。
2. **实时估算的 token 数与提供商最终返回的精确值差多少？**
   - 通常差异在 2-5% 以内。差异来源：消息格式开销、function calling 的额外 token、提供商内部的特殊 token。可以维护一个校准系数。
3. **如果需要在流传输中实施"成本熔断"（output 超过预算时中断流），怎么做？**
   - 在 Phase 2 的实时估算中持续检查累计成本是否超过阈值。超过时向上游发送取消请求（关闭连接），同时向客户端发送终止信号和提示消息。

</details>

---

## Q10: 10 万 QPS LLM 网关缓存架构

**难度**：⭐⭐⭐高级

**题目**：设计一个支持 10 万 QPS 的 LLM 网关层的缓存架构。

<details>
<summary>💡 查看答案</summary>

### 思路分析

10 万 QPS 是极高的流量级别。虽然 LLM 推理本身不可能达到这个 QPS（受制于提供商限速），但缓存层需要这个吞吐能力——大部分请求应被缓存命中拦截，只有少量穿透到 LLM 提供商。

### 核心要点

**高吞吐缓存架构：多级缓存 + 缓存穿透保护**

```
100K QPS ──► ┌────────────────────────────────────────────────┐
             │              L1: 进程内缓存                      │
             │              (Local LRU, ~10K entries)          │
             │              延迟: < 0.1ms                      │
             │              命中率: ~15%                        │
             ├────────────────────────────────────────────────┤
   85K QPS ──► │           L2: 分布式精确缓存                    │
             │              (Redis Cluster, 6节点)             │
             │              延迟: < 2ms                        │
             │              命中率: ~30%                        │
             ├────────────────────────────────────────────────┤
   55K QPS ──► │           L3: 语义缓存                         │
             │              (向量数据库 + Embedding)            │
             │              延迟: ~30ms                        │
             │              命中率: ~25%                        │
             ├────────────────────────────────────────────────┤
   40K QPS ──► │           防穿透层                             │
             │              (Bloom Filter + Request Coalescing)│
             │              合并相同请求，只发一次               │
             ├────────────────────────────────────────────────┤
    ~5K QPS ──► │          LLM Provider                        │
             │              实际穿透到提供商的请求               │
             └────────────────────────────────────────────────┘
```

```python
import asyncio
import hashlib
from functools import lru_cache
from collections import OrderedDict
import time

class L1LocalCache:
    """L1 进程内 LRU 缓存：极低延迟"""
    
    def __init__(self, max_size: int = 10000, ttl: int = 300):
        self._cache: OrderedDict = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl
    
    def get(self, key: str) -> str | None:
        if key in self._cache:
            value, ts = self._cache[key]
            if time.time() - ts < self._ttl:
                self._cache.move_to_end(key)
                return value
            del self._cache[key]
        return None
    
    def set(self, key: str, value: str):
        self._cache[key] = (value, time.time())
        if len(self._cache) > self._max_size:
            self._cache.popitem(last=False)


class RequestCoalescer:
    """请求合并器：相同请求只发送一次，多个等待者共享结果"""
    
    def __init__(self):
        self._inflight: dict[str, asyncio.Future] = {}
    
    async def execute(self, key: str, fetch_fn):
        if key in self._inflight:
            # 已有相同请求在进行中，等待其结果
            return await self._inflight[key]
        
        future = asyncio.get_event_loop().create_future()
        self._inflight[key] = future
        
        try:
            result = await fetch_fn()
            future.set_result(result)
            return result
        except Exception as e:
            future.set_exception(e)
            raise
        finally:
            del self._inflight[key]


class MultiTierCacheGateway:
    """多级缓存网关"""
    
    def __init__(self, l1_cache, redis_cluster, semantic_cache, coalescer, llm_client):
        self.l1 = l1_cache
        self.redis = redis_cluster
        self.semantic = semantic_cache
        self.coalescer = coalescer
        self.llm = llm_client
    
    async def query(self, request) -> dict:
        cache_key = self._make_key(request)
        
        # L1: 进程内缓存（<0.1ms）
        result = self.l1.get(cache_key)
        if result:
            return {"data": result, "cache": "L1_HIT"}
        
        # L2: Redis 分布式缓存（<2ms）
        result = await self.redis.get(cache_key)
        if result:
            self.l1.set(cache_key, result)     # 回填 L1
            return {"data": result, "cache": "L2_HIT"}
        
        # L3: 语义缓存（~30ms）
        if request.allow_semantic_cache:
            result = await self.semantic.search(request.query)
            if result:
                self.l1.set(cache_key, result)
                await self.redis.setex(cache_key, 3600, result)
                return {"data": result, "cache": "L3_SEMANTIC_HIT"}
        
        # 缓存未命中 → 请求合并 → 调 LLM
        result = await self.coalescer.execute(
            cache_key,
            lambda: self.llm.complete(request)
        )
        
        # 回填所有缓存层
        self.l1.set(cache_key, result)
        await self.redis.setex(cache_key, 3600, result)
        if request.allow_semantic_cache:
            await self.semantic.index(request.query, result)
        
        return {"data": result, "cache": "MISS"}
```

**容量规划估算：**

```
假设：100K QPS, 平均每个缓存条目 2KB

L1 (进程内):
  10K entries × 2KB = 20MB/进程 → 可接受
  15% 命中率 → 拦截 15K QPS

L2 (Redis Cluster):
  6 节点，每节点 16GB
  可存储 ~50M 条目
  30% 命中率 → 拦截 25.5K QPS

L3 (语义缓存):
  向量维度 384, float32 → 1.5KB/向量
  100M 向量 → ~150GB（需 GPU 加速检索）
  25% 命中率 → 拦截 15K QPS

总缓存命中率: ~70% → ~30K QPS 穿透
请求合并后: 假设 6:1 合并比 → ~5K QPS 到 LLM
```

### 面试追问

1. **L1 和 L2 的缓存一致性怎么保证？**
   - L1 用短 TTL（如 5 分钟）自动失效，不做主动同步。L2 使用 Redis Pub/Sub 广播缓存失效事件。对于 LLM 场景，弱一致性通常可接受。
2. **如何防止缓存雪崩（大量缓存同时过期）？**
   - TTL 加随机抖动（如 3600 ± 600 秒）、热点 Key 永不过期 + 异步刷新、限流保护后端 LLM 调用。
3. **语义缓存的向量检索在 10 万 QPS 下能撑住吗？**
   - 单节点向量检索通常支持数千 QPS。需要分片部署 + 使用 HNSW 索引 + GPU 加速。或者只对特定场景（如 FAQ）启用语义缓存。

</details>

---

## Q11: Token 预算管控系统设计

**难度**：⭐⭐⭐高级

**题目**：如何设计 Token 预算管控系统，在请求发送前预估成本，防止预算超支？

<details>
<summary>💡 查看答案</summary>

### 思路分析

预算管控的核心理念是"事前控制优于事后统计"。需要在请求真正发送到 LLM 提供商之前，完成 token 预估、成本计算、预算检查、额度预留的完整流水线。

### 核心要点

**事前管控 vs 事后统计：**

```
❌ 事后统计模式（常见但不可靠）：
  请求 → 发送到 LLM → 收到响应 → 统计 token → 更新预算
  问题：发现超支时，钱已经花了

✅ 事前管控模式（推荐）：
  请求 → 预估 token → 计算成本 → 检查预算 → 预留额度 → 发送 → 结算修正
  优势：超支前就拒绝请求
```

**完整的预算管控流水线：**

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 1.Token  │──►│ 2.成本   │──►│ 3.预算   │──►│ 4.额度   │──►│ 5.发送   │
│   预估   │   │   计算   │   │   校验   │   │   预留   │   │ & 结算   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
│              │              │              │              │
│ input:精确   │ 查定价表    │ 检查各层级   │ 原子扣减     │ 用实际值
│ output:估算  │ 计算总费用  │ 剩余额度     │ Redis预留    │ 修正预留
```

```python
import tiktoken
from dataclasses import dataclass
from decimal import Decimal

@dataclass
class CostEstimate:
    input_tokens: int
    estimated_output_tokens: int
    estimated_cost_usd: Decimal
    confidence: float  # 估算置信度 (0-1)

class TokenBudgetController:
    """Token 预算管控器"""
    
    def __init__(self, tokenizer_registry, pricing_engine, budget_store):
        self._tokenizers = tokenizer_registry
        self._pricing = pricing_engine
        self._budget = budget_store
    
    async def pre_check(self, tenant_id: str, request) -> CostEstimate:
        """请求发送前的完整预检流程"""
        
        # ── Step 1: 精确计算 input tokens ──
        tokenizer = self._tokenizers.get(request.model)
        input_tokens = self._count_input_tokens(tokenizer, request)
        
        # ── Step 2: 估算 output tokens ──
        estimated_output = self._estimate_output_tokens(request)
        
        # ── Step 3: 计算预估成本 ──
        total_tokens = input_tokens + estimated_output
        cost = self._pricing.calculate(
            model=request.model,
            input_tokens=input_tokens,
            output_tokens=estimated_output
        )
        
        # ── Step 4: 多层级预算校验 ──
        budget_check = await self._budget.check_all_levels(
            tenant_id=tenant_id,
            estimated_cost=cost
        )
        
        if not budget_check.allowed:
            raise BudgetExceededError(
                f"预算不足: {budget_check.reason}",
                remaining=budget_check.remaining,
                required=cost
            )
        
        # ── Step 5: 预留额度（原子操作）──
        reservation_id = await self._budget.reserve(tenant_id, cost)
        
        return CostEstimate(
            input_tokens=input_tokens,
            estimated_output_tokens=estimated_output,
            estimated_cost_usd=cost,
            confidence=0.85,
        ), reservation_id
    
    def _estimate_output_tokens(self, request) -> int:
        """估算 output token 数"""
        if request.max_tokens:
            # 有明确 max_tokens 限制，使用保守估算
            return min(request.max_tokens, self._get_avg_output(request.model))
        
        # 基于历史统计的估算策略
        history = self._get_output_stats(request.model, request.use_case)
        
        return int(history["p75"])  # 使用 P75 作为估算值（偏保守）
    
    def _get_avg_output(self, model: str) -> int:
        """各模型的典型 output token 数（基于历史数据）"""
        defaults = {
            "gpt-4o": 800,
            "gpt-4o-mini": 600,
            "claude-sonnet-4-20250514": 900,
            "claude-haiku-4-20250414": 500,
        }
        return defaults.get(model, 500)
    
    def _count_input_tokens(self, tokenizer, request) -> int:
        """精确计算 input tokens（含消息格式开销）"""
        total = 0
        for msg in request.messages:
            total += len(tokenizer.encode(msg.get("content", "")))
            total += 4  # 每条消息的格式开销
        
        # Tool/Function 定义的 token 开销
        if request.tools:
            import json
            tools_text = json.dumps(request.tools)
            total += len(tokenizer.encode(tools_text))
        
        total += 2  # 对话开头/结尾的特殊 token
        return total


class OutputEstimator:
    """基于历史数据的 output token 估算器"""
    
    def __init__(self, stats_store):
        self._stats = stats_store
    
    def estimate(self, model: str, use_case: str, input_tokens: int) -> int:
        """多因素估算 output tokens"""
        
        # 获取该模型 + 场景的历史统计
        history = self._stats.get_percentiles(model, use_case)
        
        # 基础估算：使用 P75
        base_estimate = history.get("p75", 500)
        
        # 修正因子：input 越长，output 通常也越长
        length_factor = min(1.5, max(0.5, input_tokens / 1000))
        
        # 场景修正
        scene_multiplier = {
            "chat": 1.0,
            "summarization": 0.3,    # 摘要通常较短
            "code_generation": 1.5,  # 代码生成通常较长
            "translation": 1.1,      # 翻译长度接近原文
        }.get(use_case, 1.0)
        
        return int(base_estimate * length_factor * scene_multiplier)
```

**预算管控的边界情况处理：**

```
场景 1: 预留后请求失败（网络错误）
  → 立即释放预留额度

场景 2: 实际 output 远超预估（预估 500 tokens，实际 4000 tokens）
  → 结算时追加扣减；若追加后超预算，记录但不中断（已产生的费用）
  → 更新历史统计，修正后续估算

场景 3: 流式请求中途取消
  → 按已产生的 tokens 结算（见 Q9）

场景 4: 并发请求导致预算竞争
  → Redis Lua 脚本保证原子预留，避免超卖
```

### 面试追问

1. **output token 估算不准怎么办？估算偏高浪费额度，估算偏低导致超支。**
   - 使用自适应估算：维护每个 (model, use_case) 的历史分布。用 P75 作为初始估算，然后根据最近 N 次请求的实际值动态调整。也可以让用户设置 max_tokens 来提供上界。
2. **Tool Calling 场景下，模型可能多次调用工具产生多轮交互，如何预估总成本？**
   - 设置"一次对话"的总预算上限。每轮交互独立做预检，累计成本接近上限时拒绝继续执行。工具调用的历史数据可帮助估算平均轮次。
3. **预算管控引入的额外延迟（tokenizer 计算 + Redis 操作）对用户体验的影响？**
   - tokenizer 计算约 1-5ms，Redis 操作约 1-2ms，总共增加约 5-10ms 延迟。相比 LLM 推理的数秒延迟可以忽略不计。可进一步优化：本地 tokenizer + Redis Pipeline。

</details>

---

## Q12: 多提供商统一服务编排层设计

**难度**：🎯场景设计

**题目**：你的公司同时使用 OpenAI、Anthropic、Google 三家 LLM 提供商，请设计一个统一的服务编排层。

<details>
<summary>💡 查看答案</summary>

### 思路分析

这是一道综合性场景题，考察候选人对 LLM 网关全局架构的理解。需要从业务需求出发，覆盖协议统一、路由决策、成本管控、可观测性等多个方面。

### 核心要点

**整体架构设计：**

```
                        ┌──────────────────────────────────────────────┐
                        │           LLM 服务编排层 (Orchestrator)       │
  ┌──────────┐          │                                              │
  │ 业务方 A  │─vk-a──► │  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
  ├──────────┤          │  │ 认证鉴权 │→ │ 预算管控  │→ │ 多级缓存   │  │
  │ 业务方 B  │─vk-b──► │  │ Auth    │  │ Budget   │  │ Cache     │  │
  ├──────────┤          │  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
  │ 业务方 C  │─vk-c──► │       │            │              │        │
  └──────────┘          │  ┌────▼────────────▼──────────────▼─────┐  │
                        │  │         智能路由引擎 (Router)          │  │
                        │  │  ┌──────────────────────────────┐    │  │
                        │  │  │ 路由策略:                      │    │  │
                        │  │  │  • Priority Fallback          │    │  │
                        │  │  │  • Least Cost                 │    │  │
                        │  │  │  • Weighted Round Robin       │    │  │
                        │  │  │  • Latency Optimized          │    │  │
                        │  │  └──────────────────────────────┘    │  │
                        │  └──────┬──────────┬──────────┬────────┘  │
                        │         │          │          │            │
                        │  ┌──────▼───┐ ┌───▼─────┐ ┌─▼────────┐  │
                        │  │ OpenAI   │ │Anthropic│ │ Google   │  │
                        │  │ Adapter  │ │ Adapter │ │ Adapter  │  │
                        │  │          │ │         │ │          │  │
                        │  │ GPT-4o   │ │ Claude  │ │ Gemini   │  │
                        │  │ GPT-4o-  │ │ Sonnet  │ │ 2.0 Flash│  │
                        │  │ mini     │ │ Haiku   │ │ 2.0 Pro  │  │
                        │  └──────────┘ └─────────┘ └──────────┘  │
                        │                                          │
                        │  ┌──────────────────────────────────┐    │
                        │  │      可观测性 (Observability)       │    │
                        │  │  Metrics | Traces | Logs | Alerts │    │
                        │  └──────────────────────────────────┘    │
                        └──────────────────────────────────────────┘
```

**核心模块设计：**

**模块 1：统一协议层 — OpenAI 兼容接口**

```python
# 对外暴露 OpenAI 兼容的 API，降低业务方迁移成本
# POST /v1/chat/completions

from fastapi import FastAPI, Header, Request

app = FastAPI()

@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str = Header(...)
):
    body = await request.json()
    
    # 1. 认证：Virtual Key → 租户信息
    tenant = await auth_service.authenticate(authorization)
    
    # 2. 协议解析：OpenAI 格式 → 统一内部格式
    unified_req = UnifiedRequest.from_openai_format(body)
    
    # 3. 预算管控：预估成本 + 预算检查
    estimate, reservation = await budget_ctrl.pre_check(
        tenant.id, unified_req
    )
    
    # 4. 缓存查询
    cached = await cache.query(unified_req)
    if cached:
        await budget_ctrl.release(reservation)  # 缓存命中，释放预留
        return cached
    
    # 5. 智能路由：选择最佳提供商 + 模型
    target = await router.select(unified_req, tenant)
    
    # 6. 协议转换 + 调用
    adapter = adapters[target.provider]
    provider_req = adapter.to_provider_request(unified_req)
    
    try:
        if unified_req.stream:
            return StreamingResponse(
                stream_with_tracking(target, provider_req, reservation)
            )
        else:
            response = await adapter.call(provider_req)
            await budget_ctrl.settle(reservation, response.usage)
            return adapter.to_openai_response(response)
    except Exception as e:
        # Fallback 链
        return await fallback_chain.execute(unified_req, exclude=[target])
```

**模块 2：路由配置 — 声明式路由规则**

```yaml
# config/routing.yaml
providers:
  openai:
    base_url: "https://api.openai.com/v1"
    keys:
      - key_id: "openai-key-1"
        rpm_limit: 500
        tpm_limit: 300000
      - key_id: "openai-key-2"
        rpm_limit: 500
        tpm_limit: 300000
  
  anthropic:
    base_url: "https://api.anthropic.com/v1"
    keys:
      - key_id: "anthropic-key-1"
        rpm_limit: 1000
        tpm_limit: 400000

# 逻辑模型 → 物理模型映射
model_groups:
  - name: "premium"          # 最高质量
    strategy: "priority_fallback"
    targets:
      - {provider: openai, model: gpt-4o, priority: 1}
      - {provider: anthropic, model: claude-sonnet-4-20250514, priority: 2}
      - {provider: google, model: gemini-2.0-pro, priority: 3}
  
  - name: "balanced"         # 性价比
    strategy: "weighted_round_robin"
    targets:
      - {provider: openai, model: gpt-4o-mini, weight: 40}
      - {provider: anthropic, model: claude-haiku-4-20250414, weight: 30}
      - {provider: google, model: gemini-2.0-flash, weight: 30}
  
  - name: "budget"           # 最低成本
    strategy: "least_cost"
    targets:
      - {provider: openai, model: gpt-4o-mini}
      - {provider: google, model: gemini-2.0-flash}

# 租户级路由覆盖
tenant_overrides:
  tenant-vip-001:
    default_group: "premium"
    allowed_groups: ["premium", "balanced"]
  tenant-free-tier:
    default_group: "budget"
    allowed_groups: ["budget"]
```

**模块 3：可观测性指标**

```
关键监控指标:
┌─────────────────────────────────────────────────┐
│  实时仪表盘                                       │
│                                                   │
│  总 QPS: 12,345      缓存命中率: 67.3%           │
│  平均延迟: 1.2s      P99 延迟: 4.8s             │
│                                                   │
│  ┌─ 按提供商 ─────────────────────────────────┐  │
│  │ OpenAI:    4,200 QPS  │ 错误率: 0.3%      │  │
│  │ Anthropic: 2,800 QPS  │ 错误率: 0.1%      │  │
│  │ Google:    1,045 QPS  │ 错误率: 0.2%      │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌─ 按租户成本 (本月) ────────────────────────┐  │
│  │ tenant-A: $2,340 / $5,000  [███████░░░]   │  │
│  │ tenant-B: $890   / $1,000  [████████░░] ⚠️│  │
│  │ tenant-C: $4,200 / $10,000 [████░░░░░░]   │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 面试追问

1. **如何做到配置热更新而不中断服务？**
   - 路由配置从配置中心（如 Apollo / Nacos）加载，监听变更事件。使用"双缓冲"机制：新配置生效时创建新的路由表，原子切换引用，旧配置在无活跃请求后释放。
2. **不同提供商的 SLA 和延迟差异很大，路由策略如何动态适配？**
   - 实时采集每个提供商的 P50/P99 延迟和错误率，基于滑动窗口计算健康分。路由决策时综合考虑：质量需求 × 健康分 × 剩余配额 × 成本。
3. **这个架构的单点故障在哪里？如何做高可用？**
   - 网关层本身是单点。解决方案：无状态设计 + 多实例部署 + 前置 Nginx/ALB 负载均衡。状态（预算、配额）存储在 Redis Cluster 中，Redis 自身做主从 + 哨兵。

</details>

---

## Q13: 大促活动 LLM 成本飙升快速降本

**难度**：🎯场景设计

**题目**：某次大促活动，LLM API 成本飙升 10 倍，你如何快速降本？请给出短期紧急措施和中长期优化方案。

<details>
<summary>💡 查看答案</summary>

### 思路分析

这是一道考察"紧急应对能力 + 系统性优化思维"的场景题。需要分"灭火"和"防火"两个层次回答，既要有立即见效的手段，也要有长远的治理架构。

### 核心要点

**成本飙升根因分析：**

```
成本公式: Total Cost = Σ (input_tokens + output_tokens) × unit_price × request_count

飙升 10 倍的可能原因:
  ┌────────────────────────────────────────────┐
  │  1. 请求量暴增 (request_count ↑)            │ ← 大促流量激增
  │  2. 单次 token 量暴增 (tokens ↑)            │ ← prompt 膨胀/无限循环
  │  3. 缓存失效 (cache_hit_rate ↓)             │ ← 长尾查询增多
  │  4. 重试风暴 (retry_count ↑)                │ ← 429 触发大量重试
  │  5. 高价模型误用 (unit_price ↑)             │ ← 路由策略问题
  └────────────────────────────────────────────┘
```

**短期紧急措施（0-24 小时内见效）：**

```python
# ── 措施 1: 紧急降级模型 ──
# 将非核心场景从 GPT-4o 降级到 GPT-4o-mini（成本降 90%+）
EMERGENCY_MODEL_OVERRIDE = {
    "customer_faq": "gpt-4o-mini",        # FAQ 场景降级
    "content_suggestion": "gpt-4o-mini",  # 推荐语降级
    "search_enhancement": None,           # 搜索增强直接关闭
    "core_conversation": "gpt-4o",        # 核心对话保持不变
}

# ── 措施 2: 限流 + 排队 ──
RATE_LIMIT_EMERGENCY = {
    "global_rpm": 5000,           # 全局限流（从 50000 降到 5000）
    "per_tenant_rpm": 100,        # 每租户限流
    "queue_overflow": "reject",   # 超出队列直接拒绝
}

# ── 措施 3: 压缩 Prompt ──
class PromptCompressor:
    def compress(self, messages: list[dict]) -> list[dict]:
        """紧急压缩 prompt，减少 input token"""
        compressed = []
        for msg in messages:
            content = msg["content"]
            # 截断过长的上下文（保留最近 N 轮）
            if msg["role"] == "system":
                content = self._truncate_system(content, max_tokens=500)
            elif msg["role"] == "user":
                content = self._truncate_user(content, max_tokens=1000)
            compressed.append({**msg, "content": content})
        
        # 只保留最近 5 轮对话
        return compressed[-11:]  # system + 5轮(user+assistant)

# ── 措施 4: 提高缓存命中率 ──
# 降低语义缓存阈值（从 0.95 → 0.90），用准确性换命中率
CACHE_THRESHOLD_EMERGENCY = 0.90
# 延长缓存 TTL（从 1 小时 → 24 小时）
CACHE_TTL_EMERGENCY = 86400

# ── 措施 5: 设置 max_tokens 硬上限 ──
MAX_TOKENS_OVERRIDE = {
    "customer_faq": 256,         # FAQ 回答不需要太长
    "content_suggestion": 128,   # 推荐语更短
    "core_conversation": 1024,   # 核心对话适当缩短
}
```

**中长期优化方案（1-4 周）：**

```
优化方向                         预期降本效果      实施复杂度
──────────────────────────────────────────────────────────
1. 接入更多低成本提供商            30-50%           中
   (DeepSeek, Mistral等)

2. 部署自托管小模型               60-80%           高
   (Llama 3, Qwen)               (推理成本近零)

3. 建设 Prompt 工程平台           20-30%           中
   (A/B 测试 prompt 效率)

4. 精细化路由策略                 20-40%           中
   (按场景选最优性价比模型)

5. Batch API 异步处理             50%              低
   (非实时场景用批量接口)

6. 预计算 + 预生成               视场景而定        中
   (热门问题答案提前生成)
```

**成本优化效果估算：**

```
优化前 (日均成本):
  50000 requests × avg 2000 tokens × $10/1M = $1,000/天

优化后:
  ┌─────────────────────────────────────────────┐
  │ 缓存命中 (60%):  30000 req → $0             │
  │ 模型降级 (20%):  10000 req × $0.3/1M = $6   │
  │ Batch API (10%): 5000 req × $5/1M = $50     │
  │ 保持原模型 (10%): 5000 req × $10/1M = $100  │
  ├─────────────────────────────────────────────┤
  │ 优化后日均: ~$156/天  (降本 84%)              │
  └─────────────────────────────────────────────┘
```

**建立成本治理长效机制：**

| 机制 | 说明 |
|------|------|
| 成本看板 | 按租户/场景/模型维度的实时成本大盘 |
| 预算告警 | 日/周/月预算超 80% 自动告警 |
| 成本归因 | 每次请求标注业务线+场景，支持成本分摊 |
| 定期 Review | 每周成本回顾会，识别异常增长点 |
| 自动化策略 | 成本超阈值自动触发降级/限流/缓存增强 |

### 面试追问

1. **紧急降级模型后，用户体验下降怎么处理？**
   - 分级应对：核心路径保持高质量模型不降级，非核心路径降级但做好用户提示（如"当前为简略回复模式"）。降级后密切监控用户反馈和满意度指标。
2. **如何防止类似的成本失控再次发生？**
   - 建立成本"熔断器"：设置全局日预算上限，触发后自动启动紧急降本预案（降级+限流+缓存增强一键生效）。每季度做一次"成本压测"。
3. **自托管开源模型（如 Llama 3）和 API 调用的 TCO 对比怎么算？**
   - TCO = GPU 租赁/购买成本 + 运维人力 + 推理框架开发。经验值：日均 > 5000 次调用且可接受 7B/70B 级别模型时，自托管更划算。需考虑 GPU 利用率和弹性问题。

</details>

---

## Q14: LLM Playground 后端架构设计

**难度**：🎯场景设计

**题目**：设计一个 LLM Playground 产品的后端架构，支持用户对比不同模型的输出。要求支持多模型并行调用、流式输出、历史记录保存。

<details>
<summary>💡 查看答案</summary>

### 思路分析

LLM Playground 是面向开发者的工具，核心功能是让用户输入同一个 prompt，同时发给多个模型，实时对比输出。技术挑战包括：并行流式传输、统一的流式协议、会话管理和成本控制。

### 核心要点

**产品架构总览：**

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM Playground 架构                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  前端 (React/Vue)                      │  │
│  │  ┌──────┐  ┌──────┐  ┌──────┐                       │  │
│  │  │Model A│  │Model B│  │Model C│  ← 多列并排显示      │  │
│  │  │流式输出│  │流式输出│  │流式输出│                       │  │
│  │  └──┬───┘  └──┬───┘  └──┬───┘                       │  │
│  │     │  WebSocket│(多路复用) │                           │  │
│  │     └──────┴────┴─────────┘                           │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │              Backend (Gateway + BFF)                   │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ Session Mgr  │  │ Parallel     │  │ Usage      │  │  │
│  │  │ 会话管理     │  │ Dispatcher   │  │ Tracker    │  │  │
│  │  │              │  │ 并行调度器    │  │ 用量追踪    │  │  │
│  │  └──────────────┘  └──────┬───────┘  └────────────┘  │  │
│  │                           │                           │  │
│  │            ┌──────────────┼──────────────┐            │  │
│  │            ▼              ▼              ▼            │  │
│  │      ┌──────────┐  ┌──────────┐  ┌──────────┐       │  │
│  │      │ OpenAI   │  │Anthropic │  │ Google   │       │  │
│  │      │ Stream   │  │ Stream   │  │ Stream   │       │  │
│  │      └──────────┘  └──────────┘  └──────────┘       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  数据层                                 │  │
│  │  PostgreSQL (会话/历史)  │  Redis (限流/缓存)           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**核心模块 1：并行调度器 — 同时调用多个模型**

```python
import asyncio
from dataclasses import dataclass

@dataclass
class ModelStream:
    model_id: str
    provider: str

class ParallelDispatcher:
    """并行调度器：同时向多个模型发送请求，聚合流式输出"""
    
    def __init__(self, adapters: dict, usage_tracker):
        self._adapters = adapters
        self._usage = usage_tracker
    
    async def dispatch(self, prompt: str, models: list[ModelStream], params: dict):
        """并行发起多个模型请求，返回多路流"""
        tasks = []
        for model in models:
            task = asyncio.create_task(
                self._stream_one_model(model, prompt, params)
            )
            tasks.append((model.model_id, task))
        
        # 使用 asyncio.as_completed 风格的逐块聚合
        streams = {model_id: task for model_id, task in tasks}
        return streams
    
    async def _stream_one_model(self, model: ModelStream, prompt: str, params: dict):
        """单个模型的流式调用"""
        adapter = self._adapters[model.provider]
        
        tracker = StreamingUsageTracker(model.model_id)
        
        try:
            async for chunk in adapter.stream_chat(
                model=model.model_id,
                messages=[{"role": "user", "content": prompt}],
                **params
            ):
                yield {
                    "model": model.model_id,
                    "type": "chunk",
                    "content": chunk.text,
                    "timestamp": time.time(),
                }
                tracker.on_chunk(chunk.text)
        
        except Exception as e:
            yield {
                "model": model.model_id,
                "type": "error",
                "error": str(e),
            }
        
        finally:
            tracker.finalize(None)
            yield {
                "model": model.model_id,
                "type": "done",
                "usage": {
                    "input_tokens": tracker.input_tokens,
                    "output_tokens": tracker.actual_output_tokens,
                },
            }
```

**核心模块 2：WebSocket 多路复用协议**

```python
# 前后端通信协议：通过单个 WebSocket 传输多个模型的流式输出
# 每个消息都带有 model_id 标识，前端据此分流到不同的列

import json
from fastapi import WebSocket

async def playground_websocket(ws: WebSocket, session_id: str):
    await ws.accept()
    
    try:
        while True:
            # 接收用户的对比请求
            data = json.loads(await ws.receive_text())
            
            if data["action"] == "compare":
                models = [ModelStream(**m) for m in data["models"]]
                prompt = data["prompt"]
                params = data.get("params", {})
                
                # 并行调度多个模型
                async def multiplex_streams():
                    tasks = []
                    for model in models:
                        tasks.append(
                            stream_to_ws(ws, model, prompt, params)
                        )
                    await asyncio.gather(*tasks)
                
                await multiplex_streams()
                
                # 所有模型完成后发送汇总
                await ws.send_json({
                    "type": "all_complete",
                    "session_id": session_id,
                })
    
    except Exception:
        await ws.close()


async def stream_to_ws(ws: WebSocket, model, prompt, params):
    """将单个模型的流式输出推送到 WebSocket"""
    adapter = get_adapter(model.provider)
    
    async for chunk in adapter.stream_chat(model=model.model_id, 
                                            messages=[{"role":"user","content":prompt}],
                                            **params):
        # 每个 chunk 都附带 model_id，前端据此路由到对应面板
        await ws.send_json({
            "type": "stream_chunk",
            "model": model.model_id,
            "content": chunk.text,
        })
```

**前端 WebSocket 消息协议：**

```json
// 客户端 → 服务端：发起对比
{
  "action": "compare",
  "prompt": "解释什么是 CAP 定理",
  "models": [
    {"model_id": "gpt-4o", "provider": "openai"},
    {"model_id": "claude-sonnet-4-20250514", "provider": "anthropic"},
    {"model_id": "gemini-2.0-flash", "provider": "google"}
  ],
  "params": {"temperature": 0.7, "max_tokens": 1024}
}

// 服务端 → 客户端：流式 chunk（多模型交错发送）
{"type": "stream_chunk", "model": "gpt-4o", "content": "CAP 定理"}
{"type": "stream_chunk", "model": "claude-sonnet-4-20250514", "content": "CAP（也称"}
{"type": "stream_chunk", "model": "gpt-4o", "content": "（又称布鲁尔定理）"}
{"type": "stream_chunk", "model": "gemini-2.0-flash", "content": "CAP 定理是"}
...
// 单个模型完成
{"type": "model_done", "model": "gpt-4o", "usage": {"input_tokens": 15, "output_tokens": 320}}
// 全部完成
{"type": "all_complete", "session_id": "sess_abc123"}
```

**数据模型 — 会话与历史：**

```sql
-- 对比会话
CREATE TABLE playground_sessions (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    prompt TEXT NOT NULL,
    params JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 每个模型的响应
CREATE TABLE playground_responses (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES playground_sessions(id),
    model_id VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    full_response TEXT,
    input_tokens INT,
    output_tokens INT,
    latency_ms INT,           -- 首 token 延迟
    total_time_ms INT,        -- 总耗时
    cost_usd DECIMAL(10, 6),
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 用户评价（可选：哪个模型回答更好）
CREATE TABLE playground_ratings (
    session_id UUID REFERENCES playground_sessions(id),
    preferred_model VARCHAR(64),
    rating_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**成本控制设计（Playground 的特殊考量）：**

```
Playground 的成本放大效应：
  普通请求: 1 prompt → 1 模型 → 成本 = X
  Playground: 1 prompt → 3 模型 → 成本 = 3X ← 成本翻 3 倍！

控制措施：
  ✅ 每用户每日对比次数限制（如免费版 20 次/天）
  ✅ max_tokens 强制上限（如 1024 tokens）
  ✅ 限制可选模型数量（最多同时对比 4 个）
  ✅ 高价模型需要付费套餐才能使用
  ✅ 相同 prompt 的结果缓存（避免重复对比）
```

### 面试追问

1. **如果某个模型的响应特别慢（如 GPT-4 要 30 秒），其他模型已经输出完了，用户体验怎么优化？**
   - 每个模型独立显示加载状态和已出文字。快的模型先完成，用户可以先阅读。设置全局超时（如 60 秒），超时的模型标记为"超时"并显示已生成的部分内容。
2. **如何支持带上下文的多轮对话对比（不是单轮）？**
   - 维护每个模型独立的对话历史。用户发送新消息时，分别带上各模型自己的历史记录调用。需要处理历史记录的分叉问题（各模型的上文不同）。
3. **用户的评价数据（哪个模型更好）有什么商业价值？**
   - 可以构建模型评估基准（类似 Chatbot Arena）、优化路由策略（用户偏好的模型优先）、为模型微调提供偏好数据（RLHF / DPO 训练集）。

</details>

---

## 总结：LLM 服务编排与成本治理知识图谱

```
LLM 服务编排与成本治理
├── Token 基础
│   ├── BPE 分词原理
│   ├── 多模型 Tokenizer 差异
│   └── Token 计数与成本预估
├── 统一接入层
│   ├── 协议适配（OpenAI 兼容）
│   ├── Virtual Key 安全架构
│   └── 多提供商路由策略
├── 成本治理
│   ├── 统一计费系统
│   ├── 预算管控（事前预检）
│   ├── 多租户预算管理
│   └── 流式 Token 计量
├── 性能优化
│   ├── 多级缓存架构
│   ├── 精确缓存 vs 语义缓存
│   └── 请求合并与批处理
├── 高可用
│   ├── Rate-Limit-Aware 负载均衡
│   ├── Fallback 链与能力降级
│   └── 熔断与自动恢复
└── 运维治理
    ├── 成本监控与告警
    ├── 紧急降本预案
    └── 可观测性体系
```
