# LLM 服务编排与成本治理

> 深入解析 LLM 服务编排的核心工程实践：从 Token 计量、成本核算到智能路由，构建生产级 AI 服务治理体系

## TL;DR

- BPE（Byte Pair Encoding）是主流 LLM 的分词基础，不同模型家族使用不同词表，直接影响计费精度
- Token 计量必须在客户端和服务端双重校验，流式场景需处理 partial token 边界问题
- 统一计费引擎需要抽象出"模型价格表 + 用量计数器 + 账单聚合器"三层架构
- 语义缓存（Semantic Cache）可节省 30-70% 推理成本，但需要精细的相似度阈值调优
- 多模型路由不是简单的负载均衡，需要综合考虑成本、延迟、质量和可用性四个维度
- Fallback 链设计需区分可重试错误（429/503）和不可重试错误（400/401），配合指数退避+抖动
- 多租户预算管控通过 Virtual Key 实现资源隔离，支持 hard cap / soft cap / alert-only 三种策略
- 从 10 万到 1000 万 DAU 的扩展核心在于：缓存命中率提升 + 推理成本分级 + 多区域部署

## 相关链接

- 对应面试题：[LLM服务编排与成本治理面试题](../../02-面试指南/09-AI-Agent工程化面试/11-LLM服务编排与成本治理面试题.md)

## 目录

1. [为什么需要 LLM 服务编排？](#1-为什么需要-llm-服务编排)
2. [Token 计量与成本核算引擎](#2-token-计量与成本核算引擎)
3. [语义缓存与精确缓存](#3-语义缓存与精确缓存)
4. [多模型路由与负载均衡](#4-多模型路由与负载均衡)
5. [多租户预算管控](#5-多租户预算管控)
6. [Fallback 与重试工程](#6-fallback-与重试工程)
7. [常见陷阱与最佳实践](#7-常见陷阱与最佳实践)
8. [10 万 → 1000 万 DAU 的扩展策略](#8-10-万--1000-万-dau-的扩展策略)

---

## 1. 为什么需要 LLM 服务编排？

### 1.1 一个真实的痛点场景

想象你正在运营一家 AI 驱动的客服平台。周一早高峰，3000 个用户同时发来问题。你的系统直接把所有请求怼到 GPT-4o 上——结果一分钟内就触发了 OpenAI 的速率限制（429 Too Many Requests），500 个请求被拒绝，客户投诉电话打爆了你的手机。与此同时，月底财务结算时你才发现：80% 的请求其实是"查询订单状态"这种简单问题，完全可以用更便宜的模型处理，白白多花了 15 万元。

这就是没有服务编排层的典型后果：**成本失控、可用性差、资源浪费**。

### 1.2 餐厅厨房类比

> 🍳 **生活类比：餐厅厨房管理**
>
> 想象一家繁忙的餐厅厨房——
>
> - **一个厨师（一个模型）处理不了所有订单**：法餐大厨不应该去炸薯条，川菜师傅也不该做寿司。每个模型有自己擅长的领域，GPT-4o 擅长复杂推理，Claude 擅长长文本处理，Gemini Flash 擅长快速简单的任务。
>
> - **需要一个厨房经理（编排层）来调度**：他知道哪个厨师现在有空、哪道菜该派给谁、VIP 客人的菜要优先做。这就是服务编排层——它不做饭（推理），但它决定谁来做、怎么做。
>
> - **必须追踪食材成本（Token 计费）**：松露很贵，不能每道菜都放。同理，GPT-4o 的 Token 价格是 GPT-4o-mini 的 30 倍，不能每个请求都用最贵的模型。
>
> - **客户有预算上限（多租户管控）**：自助餐客人（免费用户）和包厢客人（企业客户）的用量配额不同，超量了要限流或预警。
>
> - **厨师也会"生病"（Fallback 机制）**：当主厨（主模型）请假（宕机）时，副厨（备选模型）要能顶上，不能让客人等着。

### 1.3 服务编排的四大职责

一个生产级 LLM 服务编排层需要承担四项核心职责：

| 职责 | 说明 | 厨房类比 |
|------|------|----------|
| **成本治理** | Token 计量、按模型计费、预算管控 | 食材成本核算、每桌消费上限 |
| **智能路由** | 根据请求特征选择最优模型 | 根据菜品类型派给对应厨师 |
| **高可用** | Fallback、重试、降级策略 | 厨师缺勤时的替补方案 |
| **可观测性** | 延迟监控、质量评分、成本分析 | 上菜速度、客户满意度、日报 |

### 1.4 架构全景图

下面这张图展示了一个完整的 LLM 服务编排层的请求生命周期——从用户发出请求到收到响应，每个环节都有对应的治理能力：

```
                            LLM 服务编排架构全景图
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  用户请求                                                           │
  │     │                                                               │
  │     ▼                                                               │
  │  ┌──────────┐    ┌──────────────────────────────────────────────┐   │
  │  │API Gateway│───▶│            服 务 编 排 层                    │   │
  │  │ (限流/TLS)│    │                                              │   │
  │  └──────────┘    │  ┌────────┐  ┌────────┐  ┌──────────────┐   │   │
  │                  │  │ 认证/   │  │ 语义   │  │  智能路由     │   │   │
  │                  │  │ 鉴权    │─▶│ 缓存   │─▶│  (模型选择)   │   │   │
  │                  │  │ VKey    │  │ 检查   │  │  成本/延迟/   │   │   │
  │                  │  └────────┘  └───┬────┘  │  质量权衡     │   │   │
  │                  │                  │命中    └──────┬───────┘   │   │
  │                  │                  │               │未命中      │   │
  │                  │                  ▼               ▼            │   │
  │                  │           直接返回      ┌──────────────┐     │   │
  │                  │           缓存结果      │  推理引擎池   │     │   │
  │                  │                        │              │     │   │
  │                  │                        │ ┌──────────┐ │     │   │
  │                  │                        │ │ OpenAI   │ │     │   │
  │                  │                        │ ├──────────┤ │     │   │
  │                  │                        │ │ Claude   │ │     │   │
  │                  │                        │ ├──────────┤ │     │   │
  │                  │                        │ │ Gemini   │ │     │   │
  │                  │                        │ ├──────────┤ │     │   │
  │                  │                        │ │ 自部署   │ │     │   │
  │                  │                        │ └──────────┘ │     │   │
  │                  │                        └──────┬───────┘     │   │
  │                  │                               │              │   │
  │                  │                               ▼              │   │
  │                  │  ┌────────┐  ┌────────┐  ┌──────────┐       │   │
  │                  │  │ 流式   │  │ Token  │  │ 安全     │       │   │
  │                  │  │ 传输   │◀─│ 计量 + │◀─│ 过滤     │◀──────│   │
  │                  │  │        │  │ 计费   │  │ (PII/   │       │   │
  │                  │  └───┬────┘  └────────┘  │  毒性)   │       │   │
  │                  │      │                    └──────────┘       │   │
  │                  └──────┼──────────────────────────────────────┘   │
  │                         │                                           │
  │                         ▼                                           │
  │                    用户响应                                         │
  │                  (SSE 流式)                                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

        ┌─────────────────────────────────────────────┐
        │              异 步 数 据 管 道               │
        │                                             │
        │  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
        │  │用量聚合  │  │成本分析  │  │ 质量评分  │  │
        │  │(分钟级)  │  │(实时仪表)│  │(采样评估) │  │
        │  └─────────┘  └──────────┘  └───────────┘  │
        └─────────────────────────────────────────────┘
```

### 1.5 请求生命周期详解

让我们跟着一个请求走完整个流程，理解每个环节的价值：

```
                    请求生命周期（时序图）

  客户端           编排层             缓存层          推理引擎
    │                │                  │                │
    │──POST /chat──▶│                  │                │
    │               │                  │                │
    │               │─── 认证 VKey ──▶│                │
    │               │◀── 租户信息 ────│                │
    │               │                  │                │
    │               │── 预算检查 ────▶│                │
    │               │◀── 余额充足 ────│                │
    │               │                  │                │
    │               │── 语义hash ───▶│                │
    │               │◀── 缓存未命中 ──│                │
    │               │                  │                │
    │               │── 路由决策 ────▶│                │
    │               │  (选择 GPT-4o-mini)              │
    │               │                  │                │
    │               │──────── 推理请求 ──────────────▶│
    │               │                  │                │
    │◀── SSE chunk1 │◀──────── 流式返回 ────────────│
    │◀── SSE chunk2 │                  │                │
    │◀── SSE chunkN │                  │                │
    │◀── [DONE]     │                  │                │
    │               │                  │                │
    │               │─── 计量 Token ──▶│                │
    │               │─── 扣减预算 ───▶│                │
    │               │─── 写入缓存 ───▶│                │
    │               │                  │                │
```

**关键设计决策**：

1. **认证前置**：在任何计算发生之前验证身份，避免资源浪费
2. **缓存在路由前**：命中缓存直接返回，省去后续所有开销
3. **计量在响应后**：基于实际返回内容计量，而非预估，保证计费准确
4. **异步写入**：缓存写入和用量记录不阻塞响应返回

### 1.6 没有编排层 vs 有编排层的对比

| 维度 | 没有编排层 | 有编排层 |
|------|-----------|---------|
| 成本可控性 | ❌ 月底才知道花了多少 | ✅ 实时成本面板，预算预警 |
| 模型灵活性 | ❌ 代码硬编码模型名 | ✅ 配置化切换，A/B 测试 |
| 故障恢复 | ❌ 模型挂了就全挂 | ✅ 自动 Fallback 到备选模型 |
| 多租户隔离 | ❌ 一个大户耗光配额 | ✅ 按租户独立限流和预算 |
| 可观测性 | ❌ 全靠日志搜索 | ✅ 延迟/成本/质量 Dashboard |
| 缓存复用 | ❌ 相同问题重复推理 | ✅ 语义缓存命中率 40%+ |

> 💡 **关键洞察**：LLM 服务编排层之于 AI 应用，就像 Kubernetes 之于微服务——它不解决业务问题，但它让业务系统跑得更稳、更省、更灵活。

---

## 2. Token 计量与成本核算引擎

### 2.1 BPE Tokenizer 原理与实现

#### 2.1.1 为什么需要 Tokenizer？

> 🧩 **生活类比：乐高积木**
>
> 假设你要用乐高搭建一座城堡。你手边有几千种不同大小和形状的积木块——从最小的 1×1 到大型的预制城墙组件。
>
> - **字符级处理**就像只用 1×1 的小方块搭城堡：能搭出任何形状，但需要太多积木（序列太长），效率极低
> - **单词级处理**就像用预制城墙：效率高，但遇到一个新奇形状就无能为力（OOV 问题）
> - **BPE 分词**就像一套混合积木：常用组合有大型预制件，罕见形状拆解为小积木，兼顾效率和灵活性

LLM 不直接处理文本字符串，它处理的是数字序列（Token ID）。Tokenizer 的职责就是在"人类可读的文本"和"模型可处理的数字"之间做转换。

#### 2.1.2 BPE 算法分步图解

BPE（Byte Pair Encoding）的核心思想极其简单：**反复合并最高频的相邻符号对**。

让我们用一个中文例子来演示。假设我们的训练语料只有一个句子：`"人工智能改变世界"`

**第 0 步：初始化为 UTF-8 字节序列**

```
原文：人工智能改变世界

UTF-8 编码后（每个汉字 3 字节）：
人 → [228, 186, 186]
工 → [229, 183, 165]
智 → [230, 153, 186]
能 → [232, 131, 189]
改 → [230, 148, 185]
变 → [229, 143, 152]
世 → [228, 184, 150]
界 → [231, 149, 140]

初始 Token 序列（24 个字节）：
[228] [186] [186] [229] [183] [165] [230] [153] [186]
[232] [131] [189] [230] [148] [185] [229] [143] [152]
[228] [184] [150] [231] [149] [140]
```

**第 1 步：统计所有相邻字节对的出现频率**

```
字节对          出现次数
(228, 186)  →    1      （"人"的前两个字节）
(186, 186)  →    1      （"人"的后两字节和...实际上是不同位置）
(186, 229)  →    1
(229, 183)  →    1
...

频率最高的对假设是 (228, 186) → 合并为新 Token [256]
```

**第 2 步：用新 Token 替换所有该对出现的位置**

```
替换后的序列（23 个 Token）：
[256] [186] [229] [183] [165] [230] [153] [186]
[232] [131] [189] [230] [148] [185] [229] [143] [152]
[256] [150] [231] [149] [140]

注意 "人"(228,186,186) 和 "世"(228,184,150) 都以 228 开头
但只有和 186 组合的被合并了
```

**第 3 步：重复合并，直到达到目标词表大小**

```
继续合并的过程：

第 2 轮：合并 (256, 186) → [257]    这就是 "人" 这个字的完整 Token
第 3 轮：合并 (229, 183) → [258]
第 4 轮：合并 (258, 165) → [259]    这就是 "工" 这个字的完整 Token
...

经过足够多轮合并后：
"人工" → [2345]         （如果 "人工" 频繁共现，会被合并为一个 Token）
"智能" → [3456]         （同理）
"人工智能" → [7890]     （超高频词可能被合并为单个 Token）
```

**BPE 合并过程的可视化：**

```
        BPE 合并树（自底向上构建）

                    [人工智能]  ← 最终可能合为一个 Token
                    /        \
               [人工]        [智能]
               /    \        /    \
            [人]   [工]   [智]   [能]
            /|\    /|\    /|\    /|\
           字节   字节   字节   字节
           序列   序列   序列   序列
```

#### 2.1.3 不同 Tokenizer 家族对比

| 特性 | tiktoken (OpenAI) | SentencePiece (Google/Meta) | HuggingFace tokenizers |
|------|-------------------|---------------------------|----------------------|
| 算法基础 | BPE (字节级) | Unigram / BPE | BPE / WordPiece / Unigram |
| 词表大小 | ~100K (GPT-4) | ~32K (LLaMA) ~ 256K (Gemini) | 可配置 |
| 中文处理 | 单字多为 1-2 Token | 常见字 1 Token | 取决于训练数据 |
| 速度 | 极快（Rust 实现） | 快（C++ 实现） | 极快（Rust 实现） |
| 特殊 Token | `<|im_start|>` 等 | `<s>`, `</s>`, `<unk>` | 可配置 |
| 使用模型 | GPT-4o, o1, o3 | Gemini, LLaMA, Mistral | BERT, 各类开源模型 |

**同一段文本在不同 Tokenizer 下的 Token 数对比：**

```
文本："请解释一下什么是机器学习？"

tiktoken (cl100k_base, GPT-4):
  ["请", "解释", "一下", "什么", "是", "机器", "学习", "？"]
  → 8 tokens

SentencePiece (LLaMA 3):
  ["▁请", "解释", "一下", "什么是", "机器", "学习", "？"]
  → 7 tokens

tiktoken (o200k_base, GPT-4o):
  ["请解释", "一下", "什么是", "机器学习", "？"]
  → 5 tokens
```

> ⚠️ **关键洞察**：同一段文本在不同模型下的 Token 数可能相差 30-60%。这意味着如果你用 tiktoken 预估 Claude 的费用，结果会严重失准。**计费必须使用目标模型自己的 Tokenizer**。

#### 2.1.4 实现一个简化版 BPE Tokenizer

下面我们从零实现一个教学版 BPE Tokenizer，帮助你理解核心算法：

```python
"""
简化版 BPE Tokenizer 实现
用于理解 BPE 核心算法，不适用于生产环境
"""
from collections import Counter
from typing import List, Tuple, Dict


class SimpleBPETokenizer:
    """
    一个最小化的 BPE Tokenizer 实现。
    训练阶段：从字节序列出发，反复合并最高频相邻对。
    编码阶段：按学到的合并规则将文本转为 Token 序列。
    """

    def __init__(self, vocab_size: int = 512):
        # 基础词表包含 256 个单字节 Token（0x00 - 0xFF）
        self.vocab_size = vocab_size
        self.merges: List[Tuple[int, int]] = []  # 合并规则（有序）
        self.vocab: Dict[int, bytes] = {i: bytes([i]) for i in range(256)}

    def _get_pair_counts(self, token_ids: List[int]) -> Counter:
        """统计所有相邻 Token 对的出现频率"""
        pairs = Counter()
        for i in range(len(token_ids) - 1):
            pairs[(token_ids[i], token_ids[i + 1])] += 1
        return pairs

    def _merge_pair(
        self, token_ids: List[int], pair: Tuple[int, int], new_id: int
    ) -> List[int]:
        """将序列中所有匹配的相邻对替换为新的 Token ID"""
        merged = []
        i = 0
        while i < len(token_ids):
            # 检查当前位置是否匹配目标对
            if (
                i < len(token_ids) - 1
                and token_ids[i] == pair[0]
                and token_ids[i + 1] == pair[1]
            ):
                merged.append(new_id)
                i += 2  # 跳过已合并的两个 Token
            else:
                merged.append(token_ids[i])
                i += 1
        return merged

    def train(self, text: str) -> None:
        """
        训练 BPE 模型：从 UTF-8 字节出发，逐步合并高频对。

        Args:
            text: 训练语料文本
        """
        # 将文本转为字节序列（UTF-8 编码）
        token_ids = list(text.encode("utf-8"))
        num_merges = self.vocab_size - 256  # 需要学习的合并规则数

        for step in range(num_merges):
            pair_counts = self._get_pair_counts(token_ids)
            if not pair_counts:
                break  # 无法继续合并

            # 选择出现频率最高的相邻对
            best_pair = pair_counts.most_common(1)[0][0]
            new_id = 256 + step  # 新 Token ID 从 256 开始

            # 记录合并规则和新词表项
            self.merges.append(best_pair)
            self.vocab[new_id] = self.vocab[best_pair[0]] + self.vocab[best_pair[1]]

            # 在训练数据上执行合并
            token_ids = self._merge_pair(token_ids, best_pair, new_id)

    def encode(self, text: str) -> List[int]:
        """
        编码：将文本按已学到的合并规则转为 Token ID 序列。
        合并规则按训练时的优先级顺序依次应用。
        """
        token_ids = list(text.encode("utf-8"))
        for i, (p0, p1) in enumerate(self.merges):
            new_id = 256 + i
            token_ids = self._merge_pair(token_ids, (p0, p1), new_id)
        return token_ids

    def decode(self, token_ids: List[int]) -> str:
        """解码：将 Token ID 序列还原为文本"""
        byte_sequence = b"".join(self.vocab[tid] for tid in token_ids)
        return byte_sequence.decode("utf-8", errors="replace")


# --- 使用示例 ---
if __name__ == "__main__":
    tokenizer = SimpleBPETokenizer(vocab_size=300)

    # 训练
    corpus = "人工智能正在改变世界。人工智能让机器学习成为可能。"
    tokenizer.train(corpus)

    # 编码
    test_text = "人工智能改变世界"
    tokens = tokenizer.encode(test_text)
    print(f"原文：{test_text}")
    print(f"Token 数：{len(tokens)}")
    print(f"Token IDs：{tokens}")

    # 解码还原
    decoded = tokenizer.decode(tokens)
    print(f"解码：{decoded}")
    assert decoded == test_text, "编解码不一致！"
```

### 2.2 统一计费抽象层

#### 2.2.1 为什么需要统一计费？

> 💰 **生活类比：多币种钱包**
>
> 你同时使用美元信用卡、欧元信用卡和人民币支付宝。如果你想知道这个月总共花了多少钱，就需要一个统一的"记账本"——把所有交易按当日汇率折算成同一种基准货币。
>
> LLM 计费也是同样的挑战：
> - OpenAI 按 1M Token 计价（美元）
> - Anthropic 按 1M Token 计价（美元，但价格不同）
> - 自部署模型按 GPU·小时计价
> - 图片输入按 Tile 数计价，音频按秒计价
>
> 统一计费层就是你的"多币种记账本"，把所有这些异构的计量单位转换成统一的成本数字。

#### 2.2.2 价格表数据结构

一个好的价格表设计需要处理以下复杂性：

1. **同一模型的输入/输出价格不同**（输出通常贵 2-4 倍）
2. **价格会随时间变化**（OpenAI 每年降价 2-3 次）
3. **缓存命中的 Token 有折扣**（OpenAI Prompt Caching 折扣 50%）
4. **多模态输入有独立定价**（图片按分辨率分级）

```python
"""
LLM 统一计费引擎
核心架构：价格表 + 用量计数器 + 账单聚合器
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional
import threading


class ModelProvider(Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    SELF_HOSTED = "self_hosted"


@dataclass
class ModelPricing:
    """单个模型的价格配置（单位：美元 / 1M tokens）"""
    model_id: str
    provider: ModelProvider
    input_price_per_1m: float       # 输入 Token 价格
    output_price_per_1m: float      # 输出 Token 价格
    cached_input_price_per_1m: float = 0.0  # 缓存命中的输入价格
    image_price_per_tile: float = 0.0       # 图片 Tile 价格（多模态）
    effective_from: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def cost_for_tokens(
        self,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
        image_tiles: int = 0,
    ) -> float:
        """计算单次请求成本（美元）"""
        billable_input = input_tokens - cached_tokens
        cost = (
            (billable_input / 1_000_000) * self.input_price_per_1m
            + (cached_tokens / 1_000_000) * self.cached_input_price_per_1m
            + (output_tokens / 1_000_000) * self.output_price_per_1m
            + image_tiles * self.image_price_per_tile
        )
        return round(cost, 8)  # 保留 8 位小数避免浮点误差


@dataclass
class UsageRecord:
    """单次 API 调用的用量记录"""
    request_id: str
    tenant_id: str
    model_id: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int = 0
    image_tiles: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class PriceRegistry:
    """
    模型价格注册表。
    支持动态更新价格，按生效时间查找当前有效价格。
    """

    def __init__(self):
        self._prices: Dict[str, List[ModelPricing]] = {}
        self._lock = threading.Lock()

    def register(self, pricing: ModelPricing) -> None:
        """注册或更新模型价格"""
        with self._lock:
            if pricing.model_id not in self._prices:
                self._prices[pricing.model_id] = []
            self._prices[pricing.model_id].append(pricing)
            # 按生效时间排序，最新的在最后
            self._prices[pricing.model_id].sort(
                key=lambda p: p.effective_from
            )

    def get_current_price(self, model_id: str) -> Optional[ModelPricing]:
        """获取当前生效的价格（最近一个生效时间 <= 当前时间的记录）"""
        with self._lock:
            entries = self._prices.get(model_id, [])
            now = datetime.now(timezone.utc)
            current = None
            for entry in entries:
                if entry.effective_from <= now:
                    current = entry
            return current


class TokenMeter:
    """
    Token 计量与成本核算引擎。
    三层架构：
    - 价格表层：PriceRegistry 管理所有模型的价格配置
    - 计数器层：count_tokens() 统计单次调用的 Token 数
    - 聚合器层：aggregate_usage() 聚合租户/时间维度的成本
    """

    def __init__(self, price_registry: PriceRegistry):
        self.price_registry = price_registry
        self._records: List[UsageRecord] = []
        self._lock = threading.Lock()

    def count_tokens(self, model_id: str, text: str) -> int:
        """
        统计文本的 Token 数。
        生产环境应调用对应模型的 Tokenizer，这里为演示使用近似计算。
        """
        # 实际生产中应使用 tiktoken / sentencepiece
        # 这里用简化的中英文混合估算：
        # - 中文字符约 1-2 token/字
        # - 英文单词约 1-1.3 token/词
        chinese_chars = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
        ascii_words = len(
            [w for w in text.split() if w.isascii() and w.strip()]
        )
        other_chars = len(text) - chinese_chars
        return int(chinese_chars * 1.5 + ascii_words * 1.3 + other_chars * 0.5)

    def calculate_cost(
        self,
        request_id: str,
        tenant_id: str,
        model_id: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
        image_tiles: int = 0,
        latency_ms: int = 0,
    ) -> UsageRecord:
        """
        计算单次请求的成本并生成用量记录。

        Args:
            request_id: 请求唯一标识
            tenant_id: 租户 ID（用于多租户预算隔离）
            model_id: 使用的模型 ID
            input_tokens: 输入 Token 数
            output_tokens: 输出 Token 数（实际生成）
            cached_tokens: 命中缓存的 Token 数（享受折扣价）
            image_tiles: 图片 Tile 数（多模态请求）
            latency_ms: 请求延迟（毫秒）

        Returns:
            UsageRecord: 包含成本计算结果的用量记录
        """
        pricing = self.price_registry.get_current_price(model_id)
        if pricing is None:
            raise ValueError(f"未找到模型 {model_id} 的价格配置")

        cost = pricing.cost_for_tokens(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            image_tiles=image_tiles,
        )

        record = UsageRecord(
            request_id=request_id,
            tenant_id=tenant_id,
            model_id=model_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            image_tiles=image_tiles,
            cost_usd=cost,
            latency_ms=latency_ms,
        )

        with self._lock:
            self._records.append(record)

        return record

    def aggregate_usage(
        self,
        tenant_id: Optional[str] = None,
        model_id: Optional[str] = None,
        since: Optional[datetime] = None,
    ) -> Dict:
        """
        聚合用量和成本统计。

        支持按租户、模型、时间维度过滤聚合。

        Returns:
            包含 total_cost, total_input_tokens, total_output_tokens,
            request_count, avg_latency_ms 的字典
        """
        with self._lock:
            filtered = self._records

        if tenant_id:
            filtered = [r for r in filtered if r.tenant_id == tenant_id]
        if model_id:
            filtered = [r for r in filtered if r.model_id == model_id]
        if since:
            filtered = [r for r in filtered if r.timestamp >= since]

        if not filtered:
            return {
                "total_cost_usd": 0.0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cached_tokens": 0,
                "request_count": 0,
                "avg_latency_ms": 0,
                "cost_by_model": {},
            }

        cost_by_model: Dict[str, float] = {}
        for r in filtered:
            cost_by_model[r.model_id] = (
                cost_by_model.get(r.model_id, 0.0) + r.cost_usd
            )

        return {
            "total_cost_usd": round(sum(r.cost_usd for r in filtered), 6),
            "total_input_tokens": sum(r.input_tokens for r in filtered),
            "total_output_tokens": sum(r.output_tokens for r in filtered),
            "total_cached_tokens": sum(r.cached_tokens for r in filtered),
            "request_count": len(filtered),
            "avg_latency_ms": int(
                sum(r.latency_ms for r in filtered) / len(filtered)
            ),
            "cost_by_model": cost_by_model,
        }


# --- 使用示例 ---
if __name__ == "__main__":
    # 1. 初始化价格注册表
    registry = PriceRegistry()

    # 注册模型价格（基于 2025 年中的实际价格）
    registry.register(ModelPricing(
        model_id="gpt-4o",
        provider=ModelProvider.OPENAI,
        input_price_per_1m=2.50,
        output_price_per_1m=10.00,
        cached_input_price_per_1m=1.25,
    ))
    registry.register(ModelPricing(
        model_id="gpt-4o-mini",
        provider=ModelProvider.OPENAI,
        input_price_per_1m=0.15,
        output_price_per_1m=0.60,
        cached_input_price_per_1m=0.075,
    ))
    registry.register(ModelPricing(
        model_id="claude-sonnet-4-20250514",
        provider=ModelProvider.ANTHROPIC,
        input_price_per_1m=3.00,
        output_price_per_1m=15.00,
        cached_input_price_per_1m=0.30,
    ))

    # 2. 初始化计量引擎
    meter = TokenMeter(registry)

    # 3. 模拟一批请求
    records = [
        meter.calculate_cost(
            request_id="req-001",
            tenant_id="tenant-acme",
            model_id="gpt-4o",
            input_tokens=1500,
            output_tokens=800,
            latency_ms=2340,
        ),
        meter.calculate_cost(
            request_id="req-002",
            tenant_id="tenant-acme",
            model_id="gpt-4o-mini",
            input_tokens=500,
            output_tokens=200,
            cached_tokens=300,
            latency_ms=450,
        ),
        meter.calculate_cost(
            request_id="req-003",
            tenant_id="tenant-beta",
            model_id="claude-sonnet-4-20250514",
            input_tokens=2000,
            output_tokens=1200,
            latency_ms=3100,
        ),
    ]

    # 4. 查看账单
    for r in records:
        print(f"[{r.request_id}] {r.model_id}: ${r.cost_usd:.6f}")

    # 5. 聚合分析
    acme_usage = meter.aggregate_usage(tenant_id="tenant-acme")
    print(f"\nACME 租户总成本: ${acme_usage['total_cost_usd']:.4f}")
    print(f"请求数: {acme_usage['request_count']}")
    print(f"模型分布: {acme_usage['cost_by_model']}")
```

#### 2.2.3 多模态计费特殊处理

文本 Token 计费相对直接，但多模态输入引入了额外的复杂性：

```
                  多模态计费模型

  ┌──────────────────────────────────────────────────┐
  │                  请求类型判断                      │
  │                                                    │
  │  纯文本？──▶ 标准 Token 计费                       │
  │                                                    │
  │  含图片？──▶ 图片分辨率 → Tile 数 → Tile 单价      │
  │             ┌─────────────────────────────────┐    │
  │             │  低分辨率模式：固定 85 tokens     │    │
  │             │  高分辨率模式：                   │    │
  │             │    Tiles = ceil(W/512)*ceil(H/512)│   │
  │             │    Tokens = 85 + 170 * Tiles     │    │
  │             └─────────────────────────────────┘    │
  │                                                    │
  │  含音频？──▶ 音频时长(秒) → Token 换算 → 计费     │
  │             ┌─────────────────────────────────┐    │
  │             │  1 秒音频 ≈ 62.5 tokens (Whisper)│    │
  │             └─────────────────────────────────┘    │
  │                                                    │
  │  含视频？──▶ 帧采样数 × 每帧 Token + 音频轨      │
  │             (Gemini: 每秒 1 帧，每帧 258 tokens)  │
  └──────────────────────────────────────────────────┘
```

**图片 Token 计算的 Python 实现：**

```python
import math

def calculate_image_tokens(
    width: int, height: int, detail: str = "high"
) -> int:
    """
    计算图片消耗的 Token 数（OpenAI 计算方式）。

    低分辨率：固定 85 tokens
    高分辨率：先缩放到 2048x2048 以内，再按 512x512 切片
    """
    if detail == "low":
        return 85

    # 高分辨率模式
    # 第一步：缩放到最长边不超过 2048
    max_dim = max(width, height)
    if max_dim > 2048:
        scale = 2048 / max_dim
        width = int(width * scale)
        height = int(height * scale)

    # 第二步：缩放到最短边不超过 768
    min_dim = min(width, height)
    if min_dim > 768:
        scale = 768 / min_dim
        width = int(width * scale)
        height = int(height * scale)

    # 第三步：计算 512x512 Tile 数
    tiles_x = math.ceil(width / 512)
    tiles_y = math.ceil(height / 512)
    total_tiles = tiles_x * tiles_y

    # 基础 85 + 每个 Tile 170 tokens
    return 85 + 170 * total_tiles
```

### 2.3 流式 Token 计量

#### 2.3.1 流式场景的挑战

> 🌊 **生活类比：水表读数**
>
> 你家装了智能水表，水龙头正在放水。你想知道目前用了多少水——但水表的显示有 0.5 秒延迟，而且水流忽大忽小。
>
> 流式 Token 计量面临类似挑战：
> - 每个 SSE chunk 可能包含 1 个 Token 或多个 Token
> - 某些 chunk 可能包含"半个" UTF-8 字符（字节不完整）
> - 需要在流式传输过程中实时更新成本预估
> - 最终计量必须与非流式调用的结果完全一致

在 SSE（Server-Sent Events）流式传输中，LLM 逐个 Token 返回结果。一个典型的 SSE 流如下：

```
data: {"choices": [{"delta": {"content": "你"}}]}

data: {"choices": [{"delta": {"content": "好"}}]}

data: {"choices": [{"delta": {"content": "，"}}]}

data: {"choices": [{"delta": {"content": "我是"}}]}

data: {"choices": [{"delta": {"content": " AI"}}]}

data: {"choices": [{"delta": {"content": " 助手"}}]}

data: [DONE]
```

注意几个关键问题：

1. **每个 chunk 的粒度不固定**：有时 1 个 Token，有时多个
2. **输入 Token 数在第一个 chunk 前就已确定**（由 prompt 决定），但输出 Token 数要等流结束才知道
3. **如果用户中途断开**（取消请求），需要按实际已发送的 Token 计费

#### 2.3.2 流式计量器实现

```python
"""
流式 Token 计量器
在 SSE 流式传输过程中实时追踪 Token 消耗和成本
"""
import json
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional


@dataclass
class StreamingCostSnapshot:
    """流式传输过程中的成本快照"""
    output_tokens_so_far: int = 0
    estimated_cost_usd: float = 0.0
    elapsed_ms: int = 0
    chunks_received: int = 0
    is_complete: bool = False


class StreamingTokenCounter:
    """
    流式 Token 计量器。

    设计要点：
    1. 使用累加缓冲区拼接完整文本，再统一计量
    2. 定期发布成本快照，供 UI 实时展示
    3. 流结束时生成最终精确计量（使用 Tokenizer 而非近似值）
    4. 支持用户取消时的"部分计费"
    """

    def __init__(
        self,
        model_id: str,
        input_tokens: int,
        price_per_1m_input: float,
        price_per_1m_output: float,
        on_cost_update: Optional[Callable[[StreamingCostSnapshot], None]] = None,
        snapshot_interval_chunks: int = 10,
    ):
        self.model_id = model_id
        self.input_tokens = input_tokens
        self.price_per_1m_input = price_per_1m_input
        self.price_per_1m_output = price_per_1m_output
        self.on_cost_update = on_cost_update
        self.snapshot_interval = snapshot_interval_chunks

        # 内部状态
        self._text_buffer: list[str] = []     # 累加已接收的文本片段
        self._chunk_count: int = 0
        self._start_time: float = 0.0
        self._output_tokens_approx: int = 0   # 近似输出 Token 数
        self._is_done: bool = False

    def start(self) -> None:
        """标记流开始"""
        self._start_time = time.monotonic()

    def feed_chunk(self, chunk_data: str) -> Optional[StreamingCostSnapshot]:
        """
        喂入一个 SSE chunk 的文本内容。

        对每个 chunk：
        1. 追加到文本缓冲区
        2. 用近似方法更新输出 Token 估算
        3. 按配置的间隔发布成本快照

        Args:
            chunk_data: SSE data 字段的文本内容（已解析出 delta.content）

        Returns:
            如果本次触发了快照更新，返回 StreamingCostSnapshot；否则返回 None
        """
        if not chunk_data:
            return None

        self._text_buffer.append(chunk_data)
        self._chunk_count += 1

        # 近似 Token 计数（流式过程中不做精确 tokenize，太慢）
        # 中文约 1.5 token/字，英文约 0.75 token/字符
        for char in chunk_data:
            if "\u4e00" <= char <= "\u9fff":
                self._output_tokens_approx += 1.5
            elif char.isascii():
                self._output_tokens_approx += 0.4
            else:
                self._output_tokens_approx += 1.0

        # 按间隔发布成本快照
        if self._chunk_count % self.snapshot_interval == 0:
            snapshot = self._build_snapshot()
            if self.on_cost_update:
                self.on_cost_update(snapshot)
            return snapshot

        return None

    def finish(self, final_output_tokens: Optional[int] = None) -> StreamingCostSnapshot:
        """
        流结束，生成最终成本报告。

        Args:
            final_output_tokens: 精确的输出 Token 数（由 API usage 字段提供）。
                                 如果 API 未返回，则使用累加的近似值。
        """
        self._is_done = True

        if final_output_tokens is not None:
            self._output_tokens_approx = final_output_tokens

        snapshot = self._build_snapshot()
        snapshot.is_complete = True

        if self.on_cost_update:
            self.on_cost_update(snapshot)

        return snapshot

    def cancel(self) -> StreamingCostSnapshot:
        """
        用户取消流，生成部分计费快照。
        即使被取消，已经发送的 Token 仍需计费。
        """
        self._is_done = True
        snapshot = self._build_snapshot()
        snapshot.is_complete = True  # 标记为完成（虽然是取消）
        return snapshot

    def _build_snapshot(self) -> StreamingCostSnapshot:
        """构建当前时刻的成本快照"""
        output_tokens = int(self._output_tokens_approx)
        input_cost = (self.input_tokens / 1_000_000) * self.price_per_1m_input
        output_cost = (output_tokens / 1_000_000) * self.price_per_1m_output
        elapsed = int((time.monotonic() - self._start_time) * 1000)

        return StreamingCostSnapshot(
            output_tokens_so_far=output_tokens,
            estimated_cost_usd=round(input_cost + output_cost, 8),
            elapsed_ms=elapsed,
            chunks_received=self._chunk_count,
            is_complete=self._is_done,
        )

    def get_buffered_text(self) -> str:
        """获取已累加的完整输出文本"""
        return "".join(self._text_buffer)


# --- 使用示例 ---
if __name__ == "__main__":
    # 模拟一个流式请求的成本追踪
    def on_update(snapshot: StreamingCostSnapshot):
        status = "✅ 完成" if snapshot.is_complete else "⏳ 流式中"
        print(
            f"  {status} | "
            f"输出 Tokens: {snapshot.output_tokens_so_far} | "
            f"预估成本: ${snapshot.estimated_cost_usd:.6f} | "
            f"耗时: {snapshot.elapsed_ms}ms"
        )

    counter = StreamingTokenCounter(
        model_id="gpt-4o",
        input_tokens=1200,
        price_per_1m_input=2.50,
        price_per_1m_output=10.00,
        on_cost_update=on_update,
        snapshot_interval_chunks=5,
    )

    # 模拟 SSE 流
    mock_chunks = [
        "你", "好", "！", "我是", " AI", " 助手", "，",
        "很高兴", "为", "你", "服务", "。",
        "请问", "有什么", "可以", "帮助", "你的", "？",
    ]

    print("开始流式传输...\n")
    counter.start()

    for chunk in mock_chunks:
        counter.feed_chunk(chunk)
        time.sleep(0.05)  # 模拟网络延迟

    # 流结束，使用 API 返回的精确 Token 数
    final = counter.finish(final_output_tokens=22)
    print(f"\n最终文本: {counter.get_buffered_text()}")
    print(f"最终成本: ${final.estimated_cost_usd:.6f}")
```

#### 2.3.3 客户端-服务端双重校验

生产环境中，仅依赖一端的 Token 计量是不够的。下面是双重校验的架构：

```
           Token 计量双重校验架构

  ┌──────────────┐                    ┌──────────────┐
  │   客户端      │                    │   服务端      │
  │              │                    │              │
  │  ┌────────┐  │    HTTP 请求       │  ┌────────┐  │
  │  │预估计量│──│──────────────────▶│  │精确计量│  │
  │  │(前置)  │  │                    │  │(后置)  │  │
  │  └───┬────┘  │                    │  └───┬────┘  │
  │      │       │                    │      │       │
  │  ┌───▼────┐  │    HTTP 响应       │  ┌───▼────┐  │
  │  │校验偏差│◀─│───────────────────│  │返回用量│  │
  │  │& 修正  │  │  usage.prompt_    │  │  数据  │  │
  │  └────────┘  │  tokens / usage.  │  └────────┘  │
  │              │  completion_tokens │              │
  └──────────────┘                    └──────────────┘

  客户端职责：                         服务端职责：
  • 请求前预估 Token 数                • API 返回精确 Token 数
  • 判断是否超出预算                   • 基于实际消耗计费
  • 提前拦截过大请求                   • 作为计费的权威来源
  • 比对预估 vs 实际的偏差             • 记录审计日志
```

**为什么需要双重校验？**

| 场景 | 仅客户端计量 | 仅服务端计量 | 双重校验 |
|------|------------|------------|---------|
| 超预算拦截 | ✅ 可提前拦截 | ❌ 钱已经花了 | ✅ 提前拦截 |
| 计费精度 | ❌ Tokenizer 版本可能不一致 | ✅ 以 API 返回为准 | ✅ 精确 |
| 恶意绕过 | ❌ 可被篡改 | ✅ 服务端不可篡改 | ✅ 安全 |
| 延迟影响 | ✅ 无额外延迟 | ✅ 无额外延迟 | ✅ 无额外延迟 |

**关键实现细节：偏差容忍度**

```python
# 客户端预估 vs 服务端实际的偏差检查
client_estimated_tokens = 1500
server_actual_tokens = 1623

deviation = abs(client_estimated_tokens - server_actual_tokens) / server_actual_tokens
# deviation = 0.076 → 7.6%

# 正常偏差范围：< 10%（不同 Tokenizer 版本导致的差异）
# 需要告警的偏差：10% - 30%（可能是 Tokenizer 版本不同步）
# 需要阻断的偏差：> 30%（可能是数据被篡改或计量逻辑有 Bug）

DEVIATION_THRESHOLDS = {
    "normal": 0.10,    # < 10% 视为正常
    "warning": 0.30,   # 10-30% 触发告警
    "critical": 0.30,  # > 30% 阻断并人工审查
}
```
## 3. 语义缓存与精确缓存

### 3.1 为什么需要缓存？

在第 2 章中我们建立了 Token 计量引擎，能够精确追踪每一次调用的成本。但追踪成本只是第一步——**真正省钱的方法是减少不必要的调用**。

> **生活类比：图书馆的"常见问题公告栏"**
>
> 想象一个图书馆，每天都有读者来问同样的问题："洗手间在哪里？""WiFi 密码是什么？""怎么办借书证？"
> 如果每次都要派一位馆员去查档案、翻手册，成本非常高。
> 聪明的做法是在门口放一块**常见问题公告栏**——读者一进门就能看到答案，馆员只需处理真正需要查档的新问题。
>
> LLM 缓存就是这块公告栏：对于重复或高度相似的请求，直接返回之前的答案。

**缓存带来的成本收益有多大？**

```
┌──────────────────────────────────────────────────────────┐
│              缓存命中率 vs 成本节省（实测数据）              │
├──────────────┬──────────────┬────────────────────────────┤
│   缓存命中率  │  成本节省率   │  典型场景                   │
├──────────────┼──────────────┼────────────────────────────┤
│    10-20%    │    8-15%     │  开放式对话，问题高度分散      │
│    30-40%    │   25-35%     │  客服系统，FAQ 类问题集中      │
│    50-60%    │   40-55%     │  代码补全，模板化生成          │
│    70-80%    │   60-75%     │  数据提取，结构化查询          │
└──────────────┴──────────────┴────────────────────────────┘
```

在生产环境中，**客服场景**和**数据提取场景**的缓存命中率通常最高，因为用户的问题模式高度重复。接下来我们分两种缓存策略展开：精确缓存和语义缓存。

---

### 3.2 精确缓存（Exact Cache）

#### 核心思路

精确缓存是最简单直接的方案：**将 Prompt 做哈希，用哈希值作为缓存键**。

```
用户 Prompt ──→ 规范化处理 ──→ SHA-256 哈希 ──→ 查 Redis
                                                  │
                                          ┌───────┴───────┐
                                          │               │
                                       命中 ✓          未命中 ✗
                                          │               │
                                     返回缓存结果      调用 LLM
                                                          │
                                                     结果写入缓存
                                                          │
                                                     返回给用户
```

#### 哈希策略：不是简单的 hash(prompt)

直接对原始 Prompt 做哈希会导致大量本可命中的请求被判为"不同"。我们需要**规范化**：

| 问题 | 解决方案 | 示例 |
|------|---------|------|
| 多余空白字符 | 压缩连续空白为单个空格 | `"你好  世界"` → `"你好 世界"` |
| 前后空白 | strip() 去除 | `"  你好  "` → `"你好"` |
| 时间戳注入 | 正则移除动态时间 | `"今天是2025年7月..."` → `"今天是..."` |
| 大小写差异 | 统一小写（英文部分） | `"Hello World"` → `"hello world"` |
| 模板变量 | 提取模板骨架做哈希 | 见下文"模板提取"章节 |

#### 代码实现

```python
import hashlib
import json
import re
import time
from typing import Optional

import redis


class ExactCache:
    """基于精确哈希匹配的 LLM 响应缓存。

    工作原理：
    1. 对 Prompt 做规范化处理（去空白、去时间戳等）
    2. 计算 SHA-256 哈希作为缓存键
    3. 在 Redis 中查找/存储缓存结果
    """

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379/0",
        default_ttl: int = 3600,
        key_prefix: str = "llm:exact:",
    ):
        self.client = redis.from_url(redis_url)
        self.default_ttl = default_ttl
        self.key_prefix = key_prefix

        # 匹配常见时间格式的正则
        self._time_pattern = re.compile(
            r"\d{4}[-/]\d{1,2}[-/]\d{1,2}"  # 日期
            r"|\d{1,2}:\d{2}(:\d{2})?"      # 时间
            r"|今天|昨天|明天|现在"             # 中文时间词
        )

    def _normalize(self, prompt: str) -> str:
        """规范化 Prompt，提高缓存命中率。"""
        text = prompt.strip()
        text = re.sub(r"\s+", " ", text)          # 压缩空白
        text = self._time_pattern.sub("", text)    # 移除时间信息
        text = text.lower()                        # 统一小写
        return text

    def _make_key(self, prompt: str, model: str) -> str:
        """生成缓存键：模型 + Prompt 哈希。"""
        normalized = self._normalize(prompt)
        content = json.dumps({"model": model, "prompt": normalized}, sort_keys=True)
        digest = hashlib.sha256(content.encode()).hexdigest()
        return f"{self.key_prefix}{digest}"

    def get(self, prompt: str, model: str) -> Optional[str]:
        """查询缓存，命中则返回响应文本，未命中返回 None。"""
        key = self._make_key(prompt, model)
        data = self.client.get(key)
        if data is not None:
            record = json.loads(data)
            record["hit_count"] = record.get("hit_count", 0) + 1
            self.client.set(key, json.dumps(record), keepttl=True)
            return record["response"]
        return None

    def put(self, prompt: str, model: str, response: str, ttl: Optional[int] = None):
        """将 LLM 响应写入缓存。"""
        key = self._make_key(prompt, model)
        record = {
            "response": response,
            "model": model,
            "cached_at": time.time(),
            "hit_count": 0,
        }
        self.client.set(key, json.dumps(record), ex=ttl or self.default_ttl)
```

#### 精确缓存的局限

精确缓存的致命弱点是**对 Prompt 变化零容忍**：

```
❌ "请解释什么是 Transformer 架构"
❌ "帮我解释一下 Transformer 架构"
❌ "Transformer 架构是什么？"
```

这三个问题在语义上完全相同，但哈希值完全不同——三次都会 miss。这就引出了语义缓存。

---

### 3.3 语义缓存（Semantic Cache）

#### 核心思想

语义缓存的核心是：**不比较文本是否相同，而比较含义是否相近**。

> **生活类比：老师判作业**
>
> 精确缓存像一个只会逐字对比的机器——"苹果"和"apple"就是不同答案。
> 语义缓存像一个懂语义的老师——知道"苹果"和"apple"说的是同一个东西。

#### 架构流程

```
用户 Prompt
    │
    ▼
┌─────────────────┐
│  Prompt 规范化    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Embedding 模型  │  ← text-embedding-3-small / BGE / etc.
│  生成向量表示     │
└────────┬────────┘
         │  [0.12, -0.34, 0.56, ...]  (1536维)
         ▼
┌─────────────────┐      ┌──────────────────────┐
│  向量数据库检索   │─────→│  找到相似度 > 阈值？    │
│  (余弦相似度)    │      └──────────┬───────────┘
└─────────────────┘               │
                          ┌───────┴───────┐
                          │               │
                       是 (命中)       否 (未命中)
                          │               │
                     返回缓存响应      调用 LLM
                                          │
                                   ┌──────┴──────┐
                                   │ 存入向量 DB   │
                                   │ + 响应缓存    │
                                   └─────────────┘
```

#### 向量存储方案对比

| 方案 | 适合场景 | 优势 | 劣势 |
|------|---------|------|------|
| Redis Vector Search | 中小规模，已有 Redis 基础设施 | 运维简单，延迟低 | 向量检索功能相对基础 |
| Milvus | 大规模，百万级以上向量 | 高性能，分布式扩展 | 部署运维成本较高 |
| Qdrant | 中等规模，注重易用性 | API 友好，过滤能力强 | 社区相对较小 |
| Faiss (本地) | 开发/测试，单机场景 | 零依赖，极快 | 不适合分布式生产环境 |

#### 相似度阈值的权衡

阈值选择是语义缓存最关键的调参工作：

```
相似度阈值
    │
    │  ← 0.80  太低：容易误匹配，返回错误答案
    │           "JavaScript 闭包" 匹配到 "Java 类加载"
    │
    │  ← 0.90  适中：平衡命中率和准确性
    │           "什么是 Transformer" ≈ "解释 Transformer 架构"  ✓
    │           "Transformer 训练" ≠ "Transformer 推理"         ✓
    │
    │  ← 0.98  太高：几乎等同精确匹配，缓存形同虚设
    │           只有几乎一模一样的问题才能命中
    │
    ▼
   建议起步值：0.92，根据业务误匹配率逐步调整
```

#### Prompt 规范化增强命中率

在做 Embedding 之前，对 Prompt 进行规范化可以显著提高语义缓存的命中率：

1. **去除系统指令**：system prompt 通常不影响问题语义，可以单独哈希
2. **提取核心问句**：从长 Prompt 中抽取真正的问题部分
3. **去除 Few-shot 示例**：模板中的示例不影响核心查询
4. **同义词归一化**：将领域缩写展开（如 "K8s" → "Kubernetes"）

#### 代码实现

```python
import json
import time
import hashlib
import numpy as np
from typing import Optional, List
from dataclasses import dataclass, field


@dataclass
class CacheEntry:
    """缓存条目，存储 Prompt 向量、原始文本和 LLM 响应。"""
    prompt: str
    embedding: List[float]
    response: str
    model: str
    created_at: float = field(default_factory=time.time)
    hit_count: int = 0


class SemanticCache:
    """基于向量相似度的语义缓存。

    工作流程：
    1. 将用户 Prompt 通过 Embedding 模型转为向量
    2. 在向量库中搜索余弦相似度最高的已缓存 Prompt
    3. 若相似度超过阈值，返回缓存的 LLM 响应
    4. 否则调用 LLM 并将结果存入缓存
    """

    def __init__(
        self,
        embedding_client,
        embedding_model: str = "text-embedding-3-small",
        similarity_threshold: float = 0.92,
        max_entries: int = 100_000,
    ):
        self.embedding_client = embedding_client
        self.embedding_model = embedding_model
        self.threshold = similarity_threshold
        self.max_entries = max_entries

        # 生产环境应替换为 Redis Vector Search / Milvus / Qdrant
        # 这里用 numpy 数组模拟向量检索，便于理解核心逻辑
        self._vectors: List[np.ndarray] = []
        self._entries: List[CacheEntry] = []

    def embed(self, text: str) -> np.ndarray:
        """调用 Embedding 模型将文本转为向量。"""
        response = self.embedding_client.embeddings.create(
            model=self.embedding_model,
            input=self._normalize(text),
        )
        vec = np.array(response.data[0].embedding, dtype=np.float32)
        # L2 归一化，使后续点积等价于余弦相似度
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    def _normalize(self, text: str) -> str:
        """规范化 Prompt 以提高语义匹配率。"""
        import re
        text = text.strip()
        # 移除 few-shot 示例块（以 "示例：" 或 "Example:" 开头的段落）
        text = re.sub(
            r"(示例|example|e\.g\.)[：:].+?(?=\n\n|\Z)",
            "",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        text = re.sub(r"\s+", " ", text)
        return text

    def search(self, query_vec: np.ndarray) -> Optional[CacheEntry]:
        """在缓存中搜索与 query_vec 最相似的条目。"""
        if not self._vectors:
            return None

        # 批量计算余弦相似度（向量已归一化，点积即余弦值）
        matrix = np.stack(self._vectors)           # (N, dim)
        similarities = matrix @ query_vec           # (N,)

        best_idx = int(np.argmax(similarities))
        best_score = float(similarities[best_idx])

        if best_score >= self.threshold:
            entry = self._entries[best_idx]
            entry.hit_count += 1
            return entry
        return None

    def store(self, prompt: str, embedding: np.ndarray, response: str, model: str):
        """将新的 Prompt-Response 对存入缓存。"""
        # 容量控制：淘汰最久未命中的条目
        if len(self._entries) >= self.max_entries:
            oldest_idx = min(
                range(len(self._entries)),
                key=lambda i: self._entries[i].created_at,
            )
            self._vectors.pop(oldest_idx)
            self._entries.pop(oldest_idx)

        entry = CacheEntry(
            prompt=prompt,
            embedding=embedding.tolist(),
            response=response,
            model=model,
        )
        self._vectors.append(embedding)
        self._entries.append(entry)

    def get_or_call(self, prompt: str, model: str, llm_call_fn) -> dict:
        """查缓存，命中则返回；未命中则调用 LLM 并缓存结果。

        返回:
            {"response": str, "cache_hit": bool, "similarity": float | None}
        """
        query_vec = self.embed(prompt)
        cached = self.search(query_vec)

        if cached is not None:
            return {
                "response": cached.response,
                "cache_hit": True,
                "similarity": float(np.dot(
                    query_vec, np.array(cached.embedding, dtype=np.float32)
                )),
            }

        # 缓存未命中，调用 LLM
        response = llm_call_fn(prompt, model)
        self.store(prompt, query_vec, response, model)
        return {"response": response, "cache_hit": False, "similarity": None}
```

> **⚠️ 生产提示**：上面的内存向量检索仅用于演示。生产环境请替换为 Redis Vector Search（`FT.SEARCH`）或 Milvus 等专用向量数据库，以支持持久化、分布式检索和高并发。

---

### 3.4 缓存失效策略

缓存最经典的难题是：**什么时候让缓存过期？**

> **类比：超市货架上的牛奶**
>
> - **TTL（保质期）**：牛奶过了保质期就扔掉，不管有没有人买
> - **LRU（最少购买）**：货架满了，先淘汰最久没人买的商品
> - **版本标记（换品牌）**：供应商换了配方，所有旧库存全部下架

#### 三种基础策略

```
┌─────────────────────────────────────────────────────────────┐
│                     缓存失效策略矩阵                          │
├───────────┬─────────────────┬───────────────────────────────┤
│   策略     │ 触发条件         │ 适用场景                      │
├───────────┼─────────────────┼───────────────────────────────┤
│  TTL      │ 固定时间到期      │ 通用场景，最简单可靠            │
│           │ 如 1h / 24h      │ 适合答案时效性不强的知识查询      │
├───────────┼─────────────────┼───────────────────────────────┤
│  LRU      │ 容量满时淘汰      │ 内存有限的场景                 │
│           │ 最久未访问的先淘汰 │ 适合长尾分布的请求模式          │
├───────────┼─────────────────┼───────────────────────────────┤
│  版本标记  │ 模型更新时全量/   │ 模型升级后需要刷新缓存          │
│           │ 选择性失效        │ 确保用户获得新模型的响应质量      │
└───────────┴─────────────────┴───────────────────────────────┘
```

#### 模型更新时的缓存失效

当 LLM 提供商升级模型（如 GPT-4o 小版本更新），缓存的旧响应可能已不是最优答案。处理方案：

```python
# 在缓存键中嵌入模型版本
cache_key = f"llm:v{model_version}:{prompt_hash}"

# 模型升级时，新版本自动使用新的键空间
# 旧版本缓存通过 TTL 自然过期，无需手动清理
```

#### 按模式选择性失效

有时只需要失效特定类型的缓存，而非全量清除：

```python
def invalidate_by_pattern(redis_client, pattern: str):
    """按 Prompt 模式选择性清除缓存。

    例：模型的价格数据更新了，只清除价格相关的缓存
    pattern = "llm:exact:*price*"
    """
    cursor = 0
    deleted = 0
    while True:
        cursor, keys = redis_client.scan(cursor, match=pattern, count=100)
        if keys:
            redis_client.delete(*keys)
            deleted += len(keys)
        if cursor == 0:
            break
    return deleted
```

---

### 3.5 生产环境缓存优化

#### 优化一：Few-shot 模板提取

在 Few-shot Prompting 场景中，大量 Prompt 只有**示例不同**，核心指令完全相同。直接缓存完整 Prompt 会导致命中率极低。

解决方案：**将模板和示例分离，只对模板部分做缓存键**。

```python
import re

def extract_template(prompt: str) -> tuple[str, str]:
    """将 Few-shot Prompt 分离为模板骨架和示例内容。

    返回 (template, examples_hash)
    """
    # 识别 few-shot 示例块（"输入：...输出：..." 的重复模式）
    example_pattern = re.compile(
        r"(输入[：:].+?输出[：:].+?)(?=输入[：:]|\Z)",
        re.DOTALL,
    )
    examples = example_pattern.findall(prompt)
    template = example_pattern.sub("{{EXAMPLES}}", prompt)

    # 示例部分单独哈希，用于区分不同示例集
    import hashlib
    examples_text = "||".join(examples)
    examples_hash = hashlib.md5(examples_text.encode()).hexdigest()[:8]

    return template.strip(), examples_hash
```

#### 优化二：Prompt 指纹

对于结构化的 Prompt（如 JSON 格式的 API 调用），提取"指纹"字段而非哈希全文：

```python
def prompt_fingerprint(prompt_data: dict) -> str:
    """提取 Prompt 的语义指纹，忽略动态字段。"""
    # 只取影响语义的关键字段
    fingerprint_fields = {
        "task_type": prompt_data.get("task_type"),
        "instruction": prompt_data.get("instruction"),
        "output_format": prompt_data.get("output_format"),
        # 忽略: user_id, timestamp, request_id 等动态字段
    }
    import hashlib, json
    content = json.dumps(fingerprint_fields, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()
```

#### 优化三：多级缓存架构

单层缓存无法同时满足速度和容量的需求。生产环境推荐**三级缓存**：

```
┌────────────────────────────────────────────────────────────────┐
│                       多级缓存架构                               │
│                                                                │
│   请求 ──→ L1 进程内存  ──miss──→ L2 Redis  ──miss──→ L3 持久化  │
│            (LRU, 1000条)         (TTL, 10万条)      (PostgreSQL) │
│            延迟: <1ms            延迟: 1-5ms        延迟: 5-20ms │
│            命中率: 15-25%         命中率: 20-40%     命中率: 10-20%│
│                                                                │
│   写入 ──→ 同时写入 L1 + L2                                     │
│            L3 异步批量写入（每 60 秒刷盘）                         │
└────────────────────────────────────────────────────────────────┘
```

```python
from typing import Optional, Callable


class MultiTierCache:
    """三级缓存：L1 内存 → L2 Redis → L3 持久化存储。"""

    def __init__(self, l1_cache, l2_cache, l3_cache):
        self.l1 = l1_cache   # 进程内存 LRU（如 functools.lru_cache 或 dict）
        self.l2 = l2_cache   # Redis ExactCache 实例
        self.l3 = l3_cache   # PostgreSQL / S3 持久化

    def get(self, prompt: str, model: str) -> Optional[str]:
        # L1: 进程内存，最快
        result = self.l1.get(prompt, model)
        if result is not None:
            return result

        # L2: Redis，次快
        result = self.l2.get(prompt, model)
        if result is not None:
            self.l1.put(prompt, model, result)  # 回填 L1
            return result

        # L3: 持久化存储，最慢
        result = self.l3.get(prompt, model)
        if result is not None:
            self.l1.put(prompt, model, result)  # 回填 L1
            self.l2.put(prompt, model, result)  # 回填 L2
            return result

        return None

    def put(self, prompt: str, model: str, response: str):
        self.l1.put(prompt, model, response)
        self.l2.put(prompt, model, response)
        # L3 异步写入，避免阻塞主流程
        self.l3.put_async(prompt, model, response)
```

#### 生产实测数据

以下是某电商客服场景的缓存优化前后对比（日均 50 万次 LLM 调用）：

```
┌────────────────────┬───────────┬───────────┬──────────┐
│       指标          │  优化前    │  优化后    │  改善幅度 │
├────────────────────┼───────────┼───────────┼──────────┤
│ 日 LLM 调用次数     │  500,000  │  175,000  │  -65%    │
│ 日 API 费用 (USD)   │  $850     │  $310     │  -63.5%  │
│ 平均响应延迟        │  1,200ms  │  380ms    │  -68%    │
│ 缓存命中率 (精确)   │  —        │  42%      │  —       │
│ 缓存命中率 (语义)   │  —        │  23%      │  —       │
│ 总缓存命中率        │  0%       │  65%      │  —       │
└────────────────────┴───────────┴───────────┴──────────┘
```

---

## 4. 多模型路由与负载均衡

### 4.1 路由不是简单的轮询

在第 1-3 章中，我们有了统一的 LLM 网关、成本追踪和缓存机制。但目前所有请求都发往同一个模型——这既不经济，也不可靠。

> **生活类比：医院分诊台**
>
> 一个繁忙的医院不会让所有病人都去找同一个医生：
> - **感冒发烧**（简单任务）→ 全科门诊（便宜、快速的模型）
> - **骨折手术**（复杂任务）→ 专科医生（强大但昂贵的模型）
> - **紧急抢救**（关键任务）→ 最好的专家，不计成本
> - **某科室排满了**（限流/故障）→ 转诊到其他科室
>
> 多模型路由就是这个"分诊台"——根据任务特征，把请求分配到最合适的模型。

#### 路由的四个维度

```
                    ┌──────────┐
                    │   路由器   │
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
     │ GPT-4o  │   │ Claude  │   │ Gemini  │   ← 多个候选模型
     │ $15/1M  │   │ Sonnet  │   │ Flash   │
     │ 延迟高   │   │ $3/1M   │   │ $0.075  │
     │ 质量最高 │   │ 均衡     │   │ 极便宜   │
     └─────────┘   └─────────┘   └─────────┘

路由决策的四个维度：
  1. 💰 成本：优先选便宜的模型（在质量满足要求的前提下）
  2. ⚡ 延迟：选响应最快的模型（实时场景）
  3. 📊 质量：选输出质量最高的模型（关键任务）
  4. 🟢 可用性：选当前可用且健康的模型（容灾）
```

---

### 4.2 路由策略详解

#### 策略一：加权轮询（Weighted Round Robin）

最基础的路由策略。按预设权重将请求分配到不同模型：

```
权重配置：GPT-4o=2, Claude-Sonnet=5, Gemini-Flash=3

请求序列：
  [1] → Claude-Sonnet
  [2] → Claude-Sonnet
  [3] → Gemini-Flash
  [4] → Claude-Sonnet
  [5] → GPT-4o
  [6] → Claude-Sonnet
  [7] → Gemini-Flash
  [8] → Claude-Sonnet
  [9] → Gemini-Flash
  [10]→ GPT-4o
```

适合场景：多个模型能力相近，主要目的是分散请求压力。

#### 策略二：延迟感知路由（Latency-based）

追踪每个模型的实时延迟分位数，优先路由到最快的模型：

- **P50**（中位数）：代表"典型体验"
- **P95**：代表"大多数人的体验"
- **P99**：代表"最差情况"

#### 策略三：成本优化路由（Cost-optimized）

根据任务复杂度自动选择模型——简单任务用便宜模型，复杂任务用昂贵模型：

```
任务分类 ──→ 复杂度评估 ──→ 选择模型

  "你好"                   → 简单寒暄    → Gemini Flash ($0.075/1M)
  "总结这篇文章"            → 中等任务    → Claude Sonnet ($3/1M)
  "分析这份合同的法律风险"   → 复杂推理    → GPT-4o ($15/1M)
```

#### 策略四：质量感知路由（Quality-aware）

结合模型基准评分和用户反馈分数，确保关键任务路由到质量最高的模型。

#### 代码实现：综合路由器

```python
import time
import random
import threading
from enum import Enum
from typing import Optional
from dataclasses import dataclass, field
from collections import defaultdict


class RoutingStrategy(Enum):
    WEIGHTED = "weighted"
    LATENCY = "latency"
    COST = "cost"
    QUALITY = "quality"


@dataclass
class ModelMetrics:
    """单个模型的实时运行指标。"""
    name: str
    cost_per_1m_tokens: float        # 每百万 Token 价格 (USD)
    quality_score: float = 0.8       # 质量评分 (0-1)
    weight: int = 1                  # 轮询权重
    is_healthy: bool = True          # 当前是否健康
    latencies_ms: list = field(default_factory=list)  # 最近 N 次延迟
    error_count: int = 0
    total_requests: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def p50_latency(self) -> float:
        if not self.latencies_ms:
            return float("inf")
        s = sorted(self.latencies_ms)
        return s[len(s) // 2]

    @property
    def p95_latency(self) -> float:
        if not self.latencies_ms:
            return float("inf")
        s = sorted(self.latencies_ms)
        idx = int(len(s) * 0.95)
        return s[min(idx, len(s) - 1)]

    @property
    def error_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.error_count / self.total_requests


class ModelRouter:
    """多模型智能路由器。

    支持四种路由策略，可根据请求上下文动态选择。
    """

    MAX_LATENCY_WINDOW = 200  # 保留最近 200 次延迟记录

    def __init__(self, models: list[ModelMetrics]):
        self.models = {m.name: m for m in models}
        self._rr_index = 0  # 轮询游标

    def route(
        self,
        strategy: RoutingStrategy = RoutingStrategy.COST,
        task_complexity: Optional[str] = None,
        exclude: Optional[set[str]] = None,
    ) -> Optional[str]:
        """根据策略选择最优模型，返回模型名称。"""
        exclude = exclude or set()
        candidates = [
            m for m in self.models.values()
            if m.is_healthy and m.name not in exclude
        ]
        if not candidates:
            return None

        if strategy == RoutingStrategy.WEIGHTED:
            return self._weighted_round_robin(candidates)
        elif strategy == RoutingStrategy.LATENCY:
            return self._latency_based(candidates)
        elif strategy == RoutingStrategy.COST:
            return self._cost_optimized(candidates, task_complexity)
        elif strategy == RoutingStrategy.QUALITY:
            return self._quality_aware(candidates)
        return candidates[0].name

    def _weighted_round_robin(self, candidates: list[ModelMetrics]) -> str:
        """按权重轮询选择模型。"""
        pool = []
        for m in candidates:
            pool.extend([m.name] * m.weight)
        choice = pool[self._rr_index % len(pool)]
        self._rr_index += 1
        return choice

    def _latency_based(self, candidates: list[ModelMetrics]) -> str:
        """选择 P50 延迟最低的模型。"""
        return min(candidates, key=lambda m: m.p50_latency).name

    def _cost_optimized(
        self, candidates: list[ModelMetrics], complexity: Optional[str]
    ) -> str:
        """根据任务复杂度选择性价比最高的模型。"""
        # 按价格升序排列
        sorted_models = sorted(candidates, key=lambda m: m.cost_per_1m_tokens)

        if complexity == "simple":
            return sorted_models[0].name          # 最便宜
        elif complexity == "complex":
            return sorted_models[-1].name         # 最强
        else:
            # 中等任务：选价格居中、质量达标的模型
            mid = len(sorted_models) // 2
            return sorted_models[mid].name

    def _quality_aware(self, candidates: list[ModelMetrics]) -> str:
        """选择质量评分最高的模型。"""
        return max(candidates, key=lambda m: m.quality_score).name

    def update_metrics(self, model_name: str, latency_ms: float, success: bool):
        """每次调用完成后更新模型指标。"""
        m = self.models.get(model_name)
        if not m:
            return
        with m._lock:
            m.total_requests += 1
            if not success:
                m.error_count += 1
            m.latencies_ms.append(latency_ms)
            # 滑动窗口：只保留最近 N 次
            if len(m.latencies_ms) > self.MAX_LATENCY_WINDOW:
                m.latencies_ms = m.latencies_ms[-self.MAX_LATENCY_WINDOW:]

    def health_check(self, model_name: str) -> bool:
        """检查模型是否健康（错误率低于 30%）。"""
        m = self.models.get(model_name)
        if not m:
            return False
        healthy = m.error_rate < 0.3
        m.is_healthy = healthy
        return healthy
```

**使用示例：**

```python
# 初始化路由器
router = ModelRouter([
    ModelMetrics(name="gpt-4o", cost_per_1m_tokens=15.0, quality_score=0.95, weight=2),
    ModelMetrics(name="claude-sonnet", cost_per_1m_tokens=3.0, quality_score=0.90, weight=5),
    ModelMetrics(name="gemini-flash", cost_per_1m_tokens=0.075, quality_score=0.75, weight=3),
])

# 简单任务 → 路由到最便宜的模型
model = router.route(strategy=RoutingStrategy.COST, task_complexity="simple")
# → "gemini-flash"

# 复杂任务 → 路由到最强模型
model = router.route(strategy=RoutingStrategy.COST, task_complexity="complex")
# → "gpt-4o"

# 实时场景 → 路由到延迟最低的模型
model = router.route(strategy=RoutingStrategy.LATENCY)
```

---

### 4.3 健康检查机制

路由器只有在知道模型"是否正常工作"的前提下才能做出正确决策。健康检查分为**主动探测**和**被动监控**两种方式。

#### 主动探测

定期向模型发送轻量级请求，验证其可用性：

```
每 30 秒：
  ┌──────────┐     "ping"      ┌──────────┐
  │  路由器   │ ──────────────→ │  模型 API  │
  │          │ ←────────────── │          │
  └──────────┘    200 OK / 超时  └──────────┘
```

#### 被动监控

根据真实请求的成功/失败率判断健康状态——不额外消耗探测请求。

#### 熔断器模式（Circuit Breaker）

当错误率持续升高时，**自动停止**向该模型发送请求，避免雪崩式故障：

```
  ┌─────────┐   错误率<阈值   ┌──────────┐
  │  CLOSED  │ ─────────────→ │  正常转发  │
  │ (正常)   │                │ 所有请求   │
  └────┬────┘                └──────────┘
       │
       │ 错误率>阈值（如连续 5 次失败）
       ▼
  ┌─────────┐                ┌──────────┐
  │  OPEN    │ ─────────────→ │ 快速失败   │
  │ (熔断)   │                │ 不发请求   │
  └────┬────┘                └──────────┘
       │
       │ 冷却期结束（如 60 秒后）
       ▼
  ┌─────────────┐            ┌──────────┐
  │  HALF-OPEN   │ ─────────→ │ 放行少量   │
  │ (半开/试探)  │            │ 探测请求   │
  └──────┬──────┘            └──────────┘
         │
    ┌────┴─────┐
    │          │
  成功        失败
    │          │
    ▼          ▼
  CLOSED     OPEN
  (恢复)     (继续熔断)
```

#### 代码实现

```python
import time
import threading
from enum import Enum


class BreakerState(Enum):
    CLOSED = "closed"        # 正常：请求正常通过
    OPEN = "open"            # 熔断：拒绝所有请求
    HALF_OPEN = "half_open"  # 试探：放行少量请求


class CircuitBreaker:
    """熔断器：当模型连续出错时自动切断请求，防止故障扩散。

    状态转换：
      CLOSED → OPEN：连续失败次数超过阈值
      OPEN → HALF_OPEN：冷却期结束
      HALF_OPEN → CLOSED：试探请求成功
      HALF_OPEN → OPEN：试探请求失败
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        cooldown_seconds: float = 60.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.half_open_max_calls = half_open_max_calls

        self._state = BreakerState.CLOSED
        self._failure_count = 0
        self._last_failure_time = 0.0
        self._half_open_calls = 0
        self._lock = threading.Lock()

    @property
    def state(self) -> BreakerState:
        with self._lock:
            if self._state == BreakerState.OPEN:
                # 检查冷却期是否结束
                elapsed = time.time() - self._last_failure_time
                if elapsed >= self.cooldown_seconds:
                    self._state = BreakerState.HALF_OPEN
                    self._half_open_calls = 0
            return self._state

    def allow_request(self) -> bool:
        """判断当前是否允许发送请求。"""
        current = self.state
        if current == BreakerState.CLOSED:
            return True
        elif current == BreakerState.OPEN:
            return False
        else:  # HALF_OPEN
            with self._lock:
                if self._half_open_calls < self.half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                return False

    def record_success(self):
        """记录一次成功调用。"""
        with self._lock:
            if self._state == BreakerState.HALF_OPEN:
                # 试探成功 → 恢复正常
                self._state = BreakerState.CLOSED
            self._failure_count = 0

    def record_failure(self):
        """记录一次失败调用。"""
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()

            if self._state == BreakerState.HALF_OPEN:
                # 试探失败 → 继续熔断
                self._state = BreakerState.OPEN
            elif self._failure_count >= self.failure_threshold:
                # 连续失败超过阈值 → 触发熔断
                self._state = BreakerState.OPEN

    def reset(self):
        """手动重置熔断器。"""
        with self._lock:
            self._state = BreakerState.CLOSED
            self._failure_count = 0
            self._half_open_calls = 0
```

**与路由器集成：**

```python
# 为每个模型创建独立的熔断器
breakers = {
    "gpt-4o": CircuitBreaker(failure_threshold=5, cooldown_seconds=60),
    "claude-sonnet": CircuitBreaker(failure_threshold=5, cooldown_seconds=60),
    "gemini-flash": CircuitBreaker(failure_threshold=3, cooldown_seconds=30),
}

def route_with_breaker(router, strategy, breakers):
    """结合熔断器的路由选择。"""
    # 过滤掉已熔断的模型
    blocked = {name for name, cb in breakers.items() if not cb.allow_request()}
    model = router.route(strategy=strategy, exclude=blocked)
    if model is None:
        raise RuntimeError("所有模型均不可用，请检查服务状态")
    return model
```

---

### 4.4 会话亲和性 vs 无状态路由

在实际业务中，并非所有请求都是独立的。多轮对话场景中，**上下文连续性**要求同一会话的请求发往同一个模型。

#### 什么时候需要会话亲和性？

```
┌───────────────────────────────────────────────────┐
│              会话亲和性 vs 无状态路由 决策树          │
│                                                   │
│  请求是否属于多轮对话？                              │
│      │                                            │
│   ┌──┴──┐                                         │
│   否    是                                         │
│   │     │                                         │
│   │     对话是否依赖模型特定的上下文格式？             │
│   │         │                                     │
│   │      ┌──┴──┐                                  │
│   │      否    是                                  │
│   │      │     │                                  │
│   │      │     ✅ 强亲和性                          │
│   │      │     会话期间锁定模型                      │
│   │      │                                        │
│   │      ✅ 弱亲和性                                │
│   │      优先同模型，但允许切换                       │
│   │                                               │
│   ✅ 无状态路由                                     │
│   每次请求独立选择最优模型                            │
└───────────────────────────────────────────────────┘
```

#### 混合方案

```python
from typing import Optional


class SessionAwareRouter:
    """会话感知路由器：多轮对话粘性路由 + 单次请求无状态路由。"""

    def __init__(self, base_router: ModelRouter):
        self.base_router = base_router
        # session_id → model_name 的映射
        self._session_bindings: dict[str, str] = {}

    def route(
        self,
        strategy: RoutingStrategy,
        session_id: Optional[str] = None,
        task_complexity: Optional[str] = None,
    ) -> str:
        # 有 session_id → 检查是否有绑定
        if session_id and session_id in self._session_bindings:
            bound_model = self._session_bindings[session_id]
            # 确认绑定的模型仍然健康
            if self.base_router.health_check(bound_model):
                return bound_model
            # 模型不健康 → 解绑，重新路由
            del self._session_bindings[session_id]

        # 无绑定或首次请求 → 正常路由
        model = self.base_router.route(
            strategy=strategy, task_complexity=task_complexity
        )

        # 如果有 session_id，建立绑定
        if session_id and model:
            self._session_bindings[session_id] = model

        return model

    def end_session(self, session_id: str):
        """会话结束时释放绑定。"""
        self._session_bindings.pop(session_id, None)
```

---

### 4.5 Rate-Limit-Aware 路由

每个 LLM 提供商都有速率限制——RPM（每分钟请求数）和 TPM（每分钟 Token 数）。路由器必须感知这些限制，避免撞上 429 错误。

#### 限流感知的核心逻辑

```
                   ┌────────────────┐
    请求 ────────→ │ Rate Limit 检查 │
                   └───────┬────────┘
                           │
                    当前用量 < 限额 80%？
                           │
                    ┌──────┴──────┐
                    是            否
                    │             │
               正常路由       ┌───┴────┐
                             │        │
                         有备选？   所有模型
                             │     都满了？
                          ┌──┴──┐     │
                          是    否    排队等待
                          │          + 指数退避
                     路由到备选
                     模型
```

#### 代码实现

```python
import time
import threading


class RateLimitTracker:
    """追踪各模型提供商的速率限制使用情况。

    功能：
    - 记录每分钟的请求数和 Token 数
    - 判断某模型是否接近限流
    - 预分配配额，避免突发流量撞限
    """

    def __init__(self, limits: dict[str, dict]):
        """
        limits 格式：
        {
            "gpt-4o": {"rpm": 500, "tpm": 150_000},
            "claude-sonnet": {"rpm": 1000, "tpm": 400_000},
            "gemini-flash": {"rpm": 2000, "tpm": 1_000_000},
        }
        """
        self.limits = limits
        # 滑动窗口计数器
        self._request_log: dict[str, list[float]] = {m: [] for m in limits}
        self._token_log: dict[str, list[tuple[float, int]]] = {m: [] for m in limits}
        self._lock = threading.Lock()

    def _clean_window(self, model: str):
        """清理超过 60 秒的旧记录。"""
        now = time.time()
        cutoff = now - 60.0
        self._request_log[model] = [
            t for t in self._request_log[model] if t > cutoff
        ]
        self._token_log[model] = [
            (t, n) for t, n in self._token_log[model] if t > cutoff
        ]

    def record(self, model: str, token_count: int):
        """记录一次请求。"""
        with self._lock:
            now = time.time()
            self._request_log[model].append(now)
            self._token_log[model].append((now, token_count))

    def usage(self, model: str) -> dict:
        """获取某模型当前分钟的用量。"""
        with self._lock:
            self._clean_window(model)
            current_rpm = len(self._request_log[model])
            current_tpm = sum(n for _, n in self._token_log[model])
            limit = self.limits[model]
            return {
                "current_rpm": current_rpm,
                "max_rpm": limit["rpm"],
                "rpm_usage_pct": current_rpm / limit["rpm"] * 100,
                "current_tpm": current_tpm,
                "max_tpm": limit["tpm"],
                "tpm_usage_pct": current_tpm / limit["tpm"] * 100,
            }

    def has_capacity(self, model: str, threshold_pct: float = 80.0) -> bool:
        """判断模型是否还有足够的速率余量。

        threshold_pct: 使用率低于此百分比时认为有余量，默认 80%
        """
        u = self.usage(model)
        return (
            u["rpm_usage_pct"] < threshold_pct
            and u["tpm_usage_pct"] < threshold_pct
        )

    def best_available(self) -> Optional[str]:
        """返回当前速率余量最充足的模型。"""
        best_model = None
        lowest_usage = float("inf")
        for model in self.limits:
            u = self.usage(model)
            max_pct = max(u["rpm_usage_pct"], u["tpm_usage_pct"])
            if max_pct < lowest_usage:
                lowest_usage = max_pct
                best_model = model
        return best_model
```

**将限流感知集成到路由器：**

```python
def route_with_rate_limit(
    router: ModelRouter,
    rate_tracker: RateLimitTracker,
    strategy: RoutingStrategy,
    task_complexity: str = "medium",
) -> str:
    """综合考虑路由策略和速率限制的路由决策。"""
    # 第一选择：按策略选择
    model = router.route(strategy=strategy, task_complexity=task_complexity)

    if model and rate_tracker.has_capacity(model):
        return model

    # 第一选择接近限流 → 找替代模型
    fallback = rate_tracker.best_available()
    if fallback and rate_tracker.has_capacity(fallback):
        return fallback

    # 所有模型都接近限流 → 仍然选用量最低的，配合调用端的退避重试
    return fallback or model
```

#### 常见陷阱与最佳实践

| ❌ 错误做法 | ✅ 正确做法 |
|------------|-----------|
| 硬编码速率限制值 | 从 API 响应头 `x-ratelimit-*` 动态读取 |
| 撞到 429 才处理 | 在 80% 用量时主动切换，预留缓冲 |
| 全局共享一个限流计数器 | 按 API Key 分别追踪（不同 Key 限额独立） |
| 重试时立即发送 | 指数退避（1s → 2s → 4s）+ 随机抖动 |
| 忽略 TPM 只看 RPM | 长 Prompt 可能 RPM 没满但 TPM 已超限 |

```python
# ❌ 错误：撞到限流才处理
try:
    response = client.chat(model="gpt-4o", messages=messages)
except RateLimitError:
    time.sleep(60)  # 傻等一分钟
    response = client.chat(model="gpt-4o", messages=messages)

# ✅ 正确：预判限流，主动切换 + 退避重试
model = route_with_rate_limit(router, rate_tracker, strategy)
for attempt in range(3):
    try:
        response = client.chat(model=model, messages=messages)
        rate_tracker.record(model, token_count=response.usage.total_tokens)
        break
    except RateLimitError:
        wait = (2 ** attempt) + random.uniform(0, 1)  # 指数退避 + 抖动
        time.sleep(wait)
        model = rate_tracker.best_available() or model
```
## 5. 多租户预算管控

> 当 LLM 平台从"一个人自用"变成"整个公司都在用"，预算管控就是生死线。
> 没有预算管控的平台，就像没有水表的自来水管——月底账单会让你怀疑人生。

### 5.1 Virtual Key 系统

**生活类比：预付费电话卡**

还记得上学时用的电话卡吗？50 元的卡，每次打电话扣余额，余额不足就打不了。Virtual Key 就是 LLM 版预付费卡：每个团队拿一张"卡"（Virtual Key），有额度上限，每次调用 LLM 扣费，额度用完就无法继续。

```
┌───────────────────────────────────────────────┐
│             Virtual Key 架构                   │
│                                                │
│  Team A         Team B         Team C          │
│  vk_abc123      vk_def456      vk_ghi789      │
│  $500/月        $1000/月       $200/月         │
│       └──────────┼──────────────┘              │
│                  ▼                             │
│       ┌────────────────────┐                   │
│       │  Virtual Key Mgr   │  额度检查         │
│       │  用量追踪 · 密钥映射│                   │
│       └─────────┬──────────┘                   │
│                 ▼                              │
│       ┌────────────────────┐                   │
│       │  Real API Key Pool │                   │
│       │  sk-openai / anthr │                   │
│       └────────────────────┘                   │
└───────────────────────────────────────────────┘
```

核心思路：**团队永远不直接接触真实 API Key**。拿到的虚拟钥匙映射到哪把真实钥匙、有多少额度、能用哪些模型，全由平台控制。

```python
import hashlib, secrets, time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class KeyStatus(Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"
    EXPIRED = "expired"

@dataclass
class VirtualKey:
    key_id: str
    team_id: str
    hashed_secret: str           # 只存哈希值，永不存明文
    budget_limit_cents: int      # 美分为单位，避免浮点精度问题
    used_cents: int = 0
    status: KeyStatus = KeyStatus.ACTIVE
    allowed_models: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None

class VirtualKeyManager:
    """管理虚拟密钥的完整生命周期：创建、验证、追踪、轮换、吊销。"""

    def __init__(self):
        self._keys: dict[str, VirtualKey] = {}
        self._secret_to_id: dict[str, str] = {}

    def create_key(self, team_id: str, budget_usd: float,
                   allowed_models: list[str] | None = None, ttl_days: int = 90
    ) -> tuple[str, str]:
        """创建虚拟密钥，返回 (key_id, raw_secret)。raw_secret 只返回一次。"""
        key_id = f"vk_{team_id}_{secrets.token_hex(4)}"
        raw_secret = f"vk_live_{secrets.token_urlsafe(32)}"
        hashed = hashlib.sha256(raw_secret.encode()).hexdigest()
        vk = VirtualKey(
            key_id=key_id, team_id=team_id, hashed_secret=hashed,
            budget_limit_cents=int(budget_usd * 100),
            allowed_models=allowed_models or ["*"],
            expires_at=time.time() + ttl_days * 86400,
        )
        self._keys[key_id] = vk
        self._secret_to_id[hashed] = key_id
        return key_id, raw_secret

    def validate(self, raw_secret: str, model: str = "") -> tuple[bool, str]:
        """验证密钥是否有效，返回 (is_valid, reason)。"""
        hashed = hashlib.sha256(raw_secret.encode()).hexdigest()
        key_id = self._secret_to_id.get(hashed)
        if not key_id:
            return False, "invalid_key"
        vk = self._keys[key_id]
        if vk.status != KeyStatus.ACTIVE:
            return False, f"key_{vk.status.value}"
        if vk.expires_at and time.time() > vk.expires_at:
            vk.status = KeyStatus.EXPIRED
            return False, "key_expired"
        if vk.used_cents >= vk.budget_limit_cents:
            return False, "budget_exhausted"
        if model and "*" not in vk.allowed_models and model not in vk.allowed_models:
            return False, f"model_not_allowed: {model}"
        return True, "ok"

    def track_usage(self, key_id: str, cost_usd: float) -> dict:
        vk = self._keys[key_id]
        vk.used_cents += int(cost_usd * 100)
        util = vk.used_cents / vk.budget_limit_cents
        alerts = [f"budget_{int(t*100)}%" for t in [0.5, 0.8, 0.95] if util >= t]
        return {"remaining_cents": vk.budget_limit_cents - vk.used_cents, "alerts": alerts}

    def rotate_key(self, key_id: str) -> tuple[str, str]:
        """轮换密钥：生成新 secret，旧密钥立即失效。"""
        vk = self._keys[key_id]
        new_secret = f"vk_live_{secrets.token_urlsafe(32)}"
        new_hashed = hashlib.sha256(new_secret.encode()).hexdigest()
        self._secret_to_id.pop(vk.hashed_secret, None)
        vk.hashed_secret = new_hashed
        self._secret_to_id[new_hashed] = key_id
        return key_id, new_secret

    def revoke_key(self, key_id: str):
        vk = self._keys.get(key_id)
        if vk:
            vk.status = KeyStatus.REVOKED
            self._secret_to_id.pop(vk.hashed_secret, None)
```

### 5.2 预算策略

| 策略 | 行为 | 类比 |
|------|------|------|
| **Hard Cap** | 预算用尽 → 拒绝请求 | 地铁卡——余额不足刷不了闸机 |
| **Soft Cap** | 预算用尽 → 放行但告警 | 信用卡——超额还能刷，银行会打电话 |
| **Alert-Only** | 永不拒绝，只通知 | 公司报销——先花，月底看报表 |

```python
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional

class CapType(Enum):
    HARD = "hard"
    SOFT = "soft"
    ALERT_ONLY = "alert_only"

class BudgetPeriod(Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"

class BudgetPolicy:
    """预算策略引擎：根据配置决定是否放行请求并发送告警。"""

    def __init__(self, budget_cents: int, cap_type: CapType = CapType.HARD,
                 period: BudgetPeriod = BudgetPeriod.MONTHLY,
                 overage_limit_pct: float = 0.2,
                 alert_thresholds: list[float] | None = None,
                 on_alert: Optional[Callable] = None):
        self.budget_cents = budget_cents
        self.cap_type = cap_type
        self.overage_limit_pct = overage_limit_pct
        self.on_alert = on_alert or (lambda m: print(f"[ALERT] {m}"))
        self._thresholds = {p: False for p in (alert_thresholds or [0.5, 0.8, 0.95])}

    def check_budget(self, used_cents: int, request_cost_cents: int) -> dict:
        projected = used_cents + request_cost_cents
        alerts = self._fire_alerts(used_cents)

        if self.cap_type == CapType.ALERT_ONLY:
            return {"allowed": True, "reason": "alert_only", "alerts": alerts}
        if projected <= self.budget_cents:
            return {"allowed": True, "reason": "within_budget", "alerts": alerts}
        if self.cap_type == CapType.HARD:
            return {"allowed": False, "reason": "budget_exhausted", "alerts": alerts}
        # Soft cap：允许一定超额
        if projected <= self.budget_cents * (1 + self.overage_limit_pct):
            alerts.append("overage_warning")
            return {"allowed": True, "reason": "soft_overage", "alerts": alerts}
        return {"allowed": False, "reason": "overage_exceeded", "alerts": alerts}

    def _fire_alerts(self, used_cents: int) -> list[str]:
        alerts = []
        util = used_cents / self.budget_cents if self.budget_cents else 0
        for pct, fired in self._thresholds.items():
            if util >= pct and not fired:
                self._thresholds[pct] = True
                msg = f"budget_{int(pct*100)}%: ${used_cents/100:.2f}/${self.budget_cents/100:.2f}"
                alerts.append(msg)
                self.on_alert(msg)
        return alerts
```

### 5.3 用量追踪与计费

**滑动窗口 vs 固定周期**

```
固定周期：  |------ 3月 ------|------ 4月 ------|
            ↑ 重置             ↑ 重置
            问题：月底暴涨无法追溯，月初"免费开放日"

滑动窗口：  |←── 过去30天 ──→|
                 |←── 过去30天 ──→|   ← 实时滑动
            优点：更平滑，无周期边界效应
```

```python
import time
from collections import defaultdict
from dataclasses import dataclass

@dataclass
class UsageRecord:
    timestamp: float
    team_id: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cost_cents: int
    cached: bool = False

class UsageTracker:
    """基于滑动窗口的用量追踪器。金额以美分为单位避免浮点漂移。"""

    def __init__(self, window_seconds: int = 30 * 86400):
        self.window_seconds = window_seconds
        self._records: list[UsageRecord] = []
        self._team_idx: dict[str, list[int]] = defaultdict(list)

    def record(self, rec: UsageRecord):
        idx = len(self._records)
        self._records.append(rec)
        self._team_idx[rec.team_id].append(idx)

    def get_usage(self, team_id: str, window: int | None = None) -> dict:
        cutoff = time.time() - (window or self.window_seconds)
        total_cost = total_in = total_out = cache_hits = count = 0
        model_cost: dict[str, int] = defaultdict(int)

        for idx in self._team_idx.get(team_id, []):
            r = self._records[idx]
            if r.timestamp < cutoff:
                continue
            total_cost += r.cost_cents
            total_in += r.input_tokens
            total_out += r.output_tokens
            model_cost[r.model] += r.cost_cents
            cache_hits += int(r.cached)
            count += 1

        return {
            "total_usd": total_cost / 100, "requests": count,
            "input_tokens": total_in, "output_tokens": total_out,
            "cache_hit_rate": cache_hits / max(count, 1),
            "by_model": {m: c / 100 for m, c in model_cost.items()},
        }

    def billing_report(self, start: float, end: float) -> dict:
        """生成跨模型、跨 Provider 计费报告，适合月度结算。"""
        by_team: dict = defaultdict(lambda: {"cents": 0, "model": defaultdict(int), "provider": defaultdict(int)})
        for r in self._records:
            if r.timestamp < start or r.timestamp > end:
                continue
            t = by_team[r.team_id]
            t["cents"] += r.cost_cents
            t["model"][r.model] += r.cost_cents
            t["provider"][r.provider] += r.cost_cents
        return {team: {"usd": d["cents"]/100, "by_model": dict(d["model"]),
                       "by_provider": dict(d["provider"])} for team, d in by_team.items()}
```

### 5.4 RBAC 权限模型

**生活类比**：公司门禁卡——实习生只能进自己楼层，经理能进整层，CEO 能进任何地方。

| 权限 | admin | team_lead | developer | viewer |
|------|:-----:|:---------:|:---------:|:------:|
| `manage_keys` | ✅ | ✅（本团队） | ❌ | ❌ |
| `set_budgets` | ✅ | ✅（本团队） | ❌ | ❌ |
| `view_usage` | ✅（全局） | ✅（本团队） | ✅（本团队） | ✅（本团队） |
| `make_requests` | ✅ | ✅ | ✅ | ❌ |
| `manage_models` | ✅ | ❌ | ❌ | ❌ |
| `view_audit_log` | ✅ | ✅（本团队） | ❌ | ❌ |

**层级结构**：`Organization → Team（预算分配单位） → Project → Virtual Key`。子级配置不能超出父级——Team A 预算 $1000/月，其下所有 Project 预算总和不能超过 $1000。

---

## 6. Fallback 与重试工程

> 调用 LLM API 不是"一发就中"的事。网络抖动、限流、服务过载都是家常便饭。
> Fallback 与重试机制决定了系统在"不完美世界"中的可用性。

### 6.1 错误分类

**类比**：打电话没通——对方占线（429）→ 稍等再打；号码不存在（404）→ 打多少次也没用。

```
收到错误
  ├── 429 Rate Limit    ──→ ✅ 可重试（退避等待）
  ├── 502 Bad Gateway   ──→ ✅ 可重试
  ├── 503 Unavailable   ──→ ✅ 可重试
  ├── Timeout           ──→ ✅ 可重试
  ├── 500 Server Error  ──→ ⚠️ 谨慎重试（最多2次）
  ├── 400 Bad Request   ──→ ❌ 不可重试（修请求）
  ├── 401 Unauthorized  ──→ ❌ 不可重试（修凭证）
  ├── 403 Forbidden     ──→ ❌ 不可重试（无权限）
  └── 404 Not Found     ──→ ❌ 不可重试
```

### 6.2 指数退避算法

**为什么不用固定间隔？** 想象 1000 个客户端同时收到 429，全部 1 秒后重试 → 1000 个请求再次同时打过去 → 服务更过载。这就是**惊群效应（Thundering Herd）**。

```
固定间隔：  t=0 ████  t=1 ████  t=2 ████  ← 每次都是洪峰
退避+抖动：t=0 ████  t=1 ██  t=3 ███  t=7 ████ ← 压力分散
```

**四种退避公式**

| 策略 | 公式 | 特点 |
|------|------|------|
| 基础指数 | `min(base × 2^n, max)` | 简单但不防惊群 |
| Full Jitter | `random(0, base × 2^n)` | 最大程度打散 |
| Equal Jitter | `half + random(0, half)` | 保证最低等待时间 |
| Decorrelated | `min(max, random(base, prev × 3))` | 基于上次延迟，去相关 |

```python
import random, asyncio
from dataclasses import dataclass
from enum import Enum

class JitterStrategy(Enum):
    NONE = "none"
    FULL = "full"
    EQUAL = "equal"
    DECORRELATED = "decorrelated"

RETRYABLE = {429, 502, 503}
CAUTIOUS = {500}

@dataclass
class RetryPolicy:
    """可配置的重试策略，支持多种抖动算法。"""
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    jitter: JitterStrategy = JitterStrategy.FULL
    cautious_max: int = 2

    def __post_init__(self):
        self._prev = self.base_delay

    def should_retry(self, status: int, attempt: int) -> bool:
        if status in RETRYABLE: return attempt < self.max_retries
        if status in CAUTIOUS:  return attempt < self.cautious_max
        return False

    def get_delay(self, attempt: int) -> float:
        base_exp = min(self.base_delay * (2 ** attempt), self.max_delay)
        if self.jitter == JitterStrategy.NONE:
            return base_exp
        if self.jitter == JitterStrategy.FULL:
            return random.uniform(0, base_exp)
        if self.jitter == JitterStrategy.EQUAL:
            half = base_exp / 2
            return half + random.uniform(0, half)
        # DECORRELATED
        delay = min(self.max_delay, random.uniform(self.base_delay, self._prev * 3))
        self._prev = delay
        return delay

    async def execute_with_retry(self, func, *args, **kwargs):
        last_err = None
        for attempt in range(self.max_retries + 1):
            try:
                return await func(*args, **kwargs)
            except LLMAPIError as e:
                last_err = e
                if not self.should_retry(e.status_code, attempt):
                    raise
                await asyncio.sleep(self.get_delay(attempt))
        raise last_err

class LLMAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"HTTP {status_code}: {message}")
```

### 6.3 级联 Fallback

重试解决"同一服务暂时不可用"。如果**持续**不可用呢？需要逐步降级到备选方案。

```
Level 0: GPT-4o (us-east-1)  ── 重试3次 ──┐ 失败
Level 1: GPT-4o (eu-west-1)  ── 重试2次 ──┤ 失败（同模型不同区域）
Level 2: Claude 3.5 Sonnet    ── 重试2次 ──┤ 失败（同能力不同模型）
Level 3: GPT-4o-mini          ── 重试2次 ──┘ 降级（通知用户）
```

```python
import asyncio, time
from dataclasses import dataclass, field
from typing import Any, Optional

@dataclass
class FallbackNode:
    provider: str
    model: str
    region: str
    level: int               # 0=首选, 1=同模型备选, 2=跨模型, 3=降级
    max_retries: int = 3
    timeout_s: float = 30.0
    is_degraded: bool = False

@dataclass
class FallbackResult:
    success: bool
    response: Any = None
    node_used: Optional[FallbackNode] = None
    attempts_log: list[dict] = field(default_factory=list)
    degraded: bool = False
    total_ms: float = 0

class FallbackChain:
    """
    级联 Fallback 引擎。
    每级先重试，全部失败后进入下一级。降级方案标记 degraded=True。
    """

    def __init__(self, nodes: list[FallbackNode]):
        self.nodes = sorted(nodes, key=lambda n: n.level)
        self._fail_counts: dict[str, int] = {}
        self._fail_time: dict[str, float] = {}

    async def execute(self, request: dict, call_fn=None) -> FallbackResult:
        result = FallbackResult(success=False)
        t0 = time.monotonic()

        for node in self.nodes:
            nk = f"{node.provider}/{node.model}/{node.region}"

            # 跳过最近持续失败的节点（60秒冷却期）
            if self._fail_counts.get(nk, 0) >= 5:
                if time.monotonic() - self._fail_time.get(nk, 0) < 60:
                    result.attempts_log.append({"node": nk, "skipped": True})
                    continue
                self._fail_counts[nk] = 0

            for attempt in range(node.max_retries):
                try:
                    resp = await asyncio.wait_for(call_fn(node, request), timeout=node.timeout_s)
                    self._fail_counts[nk] = 0
                    result.success = True
                    result.response = resp
                    result.node_used = node
                    result.degraded = node.is_degraded
                    result.total_ms = (time.monotonic() - t0) * 1000
                    if node.is_degraded and isinstance(resp, dict):
                        resp["_degraded"] = True
                    return result
                except Exception as e:
                    self._fail_counts[nk] = self._fail_counts.get(nk, 0) + 1
                    self._fail_time[nk] = time.monotonic()
                    result.attempts_log.append({"node": nk, "attempt": attempt+1, "error": str(e)})

        result.total_ms = (time.monotonic() - t0) * 1000
        return result

# 典型生产配置
def build_chain() -> FallbackChain:
    return FallbackChain([
        FallbackNode("openai", "gpt-4o", "us-east-1", 0, max_retries=3),
        FallbackNode("openai", "gpt-4o", "eu-west-1", 1, max_retries=2),
        FallbackNode("anthropic", "claude-3.5-sonnet", "us-east-1", 2, max_retries=2),
        FallbackNode("openai", "gpt-4o-mini", "us-east-1", 3, max_retries=2, is_degraded=True),
    ])
```

### 6.4 幂等性与请求去重

重试有一个隐蔽问题：**请求可能已成功，只是响应在网络中丢了**。不做幂等处理，同一请求可能被执行两次，产生重复计费。

**类比**：网购点了"付款"按钮页面卡住，又点了一次——被扣两次钱。幂等性确保"不管点几次，只扣一次"。

```
客户端                           服务端
  │ POST + Idempotency-Key: abc  │
  │ ─────────────────────────→   │─ abc 不存在 → 执行，缓存结果
  │ ←─────────────────────────   │
  │ (网络超时，客户端重试)         │
  │ POST + Idempotency-Key: abc  │─ abc 已存在 → 直接返回缓存
  │ ←─────────────────────────   │
```

```python
import hashlib, time

class IdempotencyManager:
    """请求去重。生产环境用 Redis SET NX + TTL 实现分布式去重。"""

    def __init__(self, window_s: int = 86400):
        self.window = window_s
        self._store: dict[str, dict] = {}

    def check_or_store(self, key: str, response: dict) -> dict | None:
        self._cleanup()
        if key in self._store:
            return self._store[key]["response"]
        self._store[key] = {"response": response, "at": time.time()}
        return None

    def _cleanup(self):
        cutoff = time.time() - self.window
        for k in [k for k, v in self._store.items() if v["at"] < cutoff]:
            del self._store[k]
```

---

## 7. 常见陷阱与最佳实践

> 每一条都来自真实生产事故或团队踩坑经验。

### ❌ 陷阱 1：用 `len(text.split())` 估算 token

```python
# ❌ 单词数 ≠ token 数，中文误差可达 50%
estimated = len(prompt.split())
```

```python
# ✅ 使用对应模型的 tokenizer 精确计算
import tiktoken
encoding = tiktoken.encoding_for_model("gpt-4o")
actual = len(encoding.encode(prompt))
```

### ❌ 陷阱 2：所有请求走最贵的模型

```python
# ❌ 简单翻译也用 GPT-4o，像用法拉利送外卖
response = call_llm(model="gpt-4o", prompt=user_input)
```

```python
# ✅ 按任务复杂度路由到不同成本等级
def route(task: str) -> str:
    if task in ("translate", "classify"):  return "gpt-4o-mini"    # $0.15/M
    if task in ("code_gen", "analysis"):   return "gpt-4o"         # $2.50/M
    if task in ("research", "reasoning"):  return "claude-3.5"     # $3.00/M
    return "gpt-4o-mini"
```

### ❌ 陷阱 3：缓存命中不记录用量

```python
# ❌ 导致用量统计失真，无法评估缓存效果
if cache_hit: return cached_response
```

```python
# ✅ 缓存命中也要记录，用于分析和审计
if cache_hit:
    tracker.record(team_id=tid, model=m, cost_cents=0, cached=True)
    return cached_response
```

### ❌ 陷阱 4：固定重试间隔

```python
# ❌ 每次等 1 秒 → 惊群效应
for _ in range(3):
    try: return call_api()
    except: time.sleep(1)
```

```python
# ✅ 指数退避 + 随机抖动
for i in range(3):
    try: return call_api()
    except RateLimitError:
        time.sleep(random.uniform(0, min(1.0 * 2**i, 60)))
```

### ❌ 陷阱 5：预算超限才告警

```python
# ❌ 油表亮红灯才加油——可能已在高速路上抛锚
if used >= budget: alert("预算用完了！")
```

```python
# ✅ 多级预警阈值
for pct, level, msg in [(0.50,"info","过半"), (0.80,"warn","80%"), (0.95,"crit","即将耗尽")]:
    if used / budget >= pct: send_alert(level, msg)
```

### ❌ 陷阱 6：单一 Provider 承担所有流量

```
# ❌ OpenAI 宕机 → 全站不可用（2024年已多次发生）
所有请求 → OpenAI
```

```
# ✅ 多 Provider 分散风险
主路径 70% → OpenAI    备选 20% → Anthropic    兜底 10% → DeepSeek
```

### ❌ 陷阱 7：语义缓存阈值一设不改

```python
# ❌ 0.8 在代码场景太宽松，FAQ 场景又太严格
THRESHOLD = 0.8
```

```python
# ✅ 按场景差异化 + 持续调优
THRESHOLDS = {"code": 0.95, "translation": 0.85, "faq": 0.80}
# 监控误匹配率 > 5% → 提高阈值；< 1% → 适当放宽
```

### ❌ 陷阱 8：客户端硬编码模型价格

```python
# ❌ Provider 调价后这里就错了，要改代码重部署
PRICES = {"gpt-4o": 2.50, "claude-3.5": 3.00}
```

```python
# ✅ 服务端价格表 + 热更新（每 5 分钟从配置中心刷新）
class PriceRegistry:
    def __init__(self, source):
        self._cache = {}; self._last = 0
    def get_price(self, model):
        if time.time() - self._last > 300:
            self._cache = self._source.fetch(); self._last = time.time()
        return self._cache.get(model, {"input": 0, "output": 0})
```

### ❌ 陷阱 9：忽略流式 token 边界

```python
# ❌ 中文/emoji 的 UTF-8 多字节可能在 chunk 边界被截断
async for chunk in stream:
    full += chunk.content  # 可能乱码
```

```python
# ✅ 使用 accumulator buffer 处理 partial token
class StreamBuffer:
    def __init__(self): self._buf = b""
    def feed(self, data: bytes) -> str:
        self._buf += data
        try:
            text = self._buf.decode("utf-8"); self._buf = b""; return text
        except UnicodeDecodeError:
            safe = self._buf[:-1].decode("utf-8", errors="ignore")
            self._buf = self._buf[-1:]; return safe
```

### ❌ 陷阱 10：所有错误都重试

```python
# ❌ 重试 401 不仅没用，还可能被 Provider 封 Key
except Exception: retry()
```

```python
# ✅ 区分可重试与不可重试
RETRYABLE = {429, 502, 503}
NON_RETRYABLE = {400, 401, 403, 404}

except APIError as e:
    if e.status in RETRYABLE:       backoff_retry(attempt)
    elif e.status in NON_RETRYABLE: raise PermanentError(e)
    elif e.status == 500 and attempt < 2: backoff_retry(attempt)
    else: raise
```

---

## 8. 10 万 → 1000 万 DAU 的扩展策略

> 从 10 万到 1000 万 DAU，不是"多加几台机器"。
> 就像从经营一家奶茶店到管理全国连锁——供应链、管理模式、成本结构全部要重新设计。

### 8.1 容量规划

**QPS 估算公式**

```
平均 QPS = DAU × 每用户日均请求 × 峰值系数 / 86400
```

| DAU | 请求/人/天 | 峰值系数 | 平均 QPS | 峰值 QPS | 日请求量 |
|-----|:---------:|:-------:|:--------:|:--------:|:-------:|
| 10 万 | 8 | 4x | ~9 | ~37 | 80 万 |
| 100 万 | 10 | 4x | ~115 | ~460 | 1000 万 |
| 1000 万 | 12 | 4x | ~1389 | ~5556 | 1.2 亿 |

**GPU 资源估算（自部署 LLaMA-70B + A100 80GB，~50 tok/s/GPU）**

```
峰值 5000 QPS × 500 tok/req = 2,500,000 tok/s
所需 GPU = 2,500,000 / 50 = 50,000 块 A100（纯自推理不现实！）
→ 所以大规模场景必须：模型分层 + 缓存 + API 混用 + 量化加速
```

### 8.2 分层扩展策略

**Phase 1：10 万 DAU（创业期）**

```
Web/App → API Gateway → LLM Gateway(单实例) → OpenAI/Anthropic API
                                              → Redis 单节点(缓存)
                                              → PG 单节点(日志)
配置：单区域 | 0 GPU | 纯 API 调用
月成本：$2,000 - $5,000
重点：跑通业务，积累用量数据
```

**Phase 2：100 万 DAU（增长期）**

```
CDN → 负载均衡 → LLM Gateway ×3 (Auto-scaling)
                    ├── OpenAI / Anthropic API
                    ├── GPU 集群 ×3（处理简单任务）
                    ├── Redis Cluster (3主3从)
                    └── PG 主从 + 读副本
配置：单区域多 AZ | 2-5 GPU 节点 | 语义缓存
月成本：$20,000 - $80,000
重点：模型分层，单位成本下降 30-50%
```

**Phase 3：1000 万 DAU（规模化）**

```
Global DNS → Region US / EU / AP（多区域 Active-Active）
每个 Region：
  GW ×5 | GPU 集群(分层) | Redis ×6 | PG shard
             │
  ┌──────────┼──────────┐
  Tier1: H100 (复杂推理)
  Tier2: A100 (标准对话)
  Tier3: L4/T4 (分类/Embedding)
  Tier4: Spot 实例 (批处理)

Cross-Region：缓存预热同步 + 用量聚合 + 配置分发
月成本：$300,000 - $1,000,000+
```

### 8.3 成本优化实践

**策略 1：模型分层（节省 40-60%）**

| 策略 | 计算 | 月成本 | 节省 |
|------|------|:------:|:----:|
| 全用 GPT-4o | 100万 × 1K tok × $2.5/M | $2,500 | - |
| 分层路由 | 60万×$0.15 + 30万×$2.5 + 10万×$15 | **$840** | **66%** |

**策略 2：激进缓存（目标 50%+）**

| 命中率 | 实际 API 调用 | 月成本 |
|:------:|:----------:|:------:|
| 0% | 100 万 | $2,500 |
| 30% | 70 万 | $1,750 |
| **50%** | **50 万** | **$1,250** |
| 70% | 30 万 | $750 |

手段：精确缓存 → 语义缓存 → 前缀 KV-Cache → 高频预热。

**策略 3：批处理（非实时任务，省 50%）**

OpenAI Batch API 价格 = 标准价 50%。适用于日报生成、内容审核、数据标注。1000 万 DAU 约 40% 请求可批处理 → 节省 20%。

**策略 4：Spot GPU 实例（省 55-70%）**

| 实例 | 按需 | Spot | 节省 |
|------|:----:|:----:|:----:|
| AWS p4d.24xlarge | $32.77/h | ~$12/h | 63% |
| GCP a2-highgpu-1g | $3.67/h | ~$1.10/h | 70% |

适用：批处理 ✅、模型评估 ✅、实时推理 ❌。

**综合成本估算表**

| DAU | GPU/推理 | API | 缓存/存储 | 网络 | 月总成本 | 单 DAU |
|-----|:-------:|:---:|:--------:|:----:|:-------:|:------:|
| 10万 | $0 | $3,000 | $200 | $100 | **$3,300** | $0.033 |
| 100万 | $8,000 | $30,000 | $2,000 | $1,500 | **$41,500** | $0.042 |
| 1000万 | $150,000 | $250,000 | $20,000 | $15,000 | **$435,000** | $0.044 |

> 以上已含模型分层 + 50% 缓存命中率优化。未优化成本可能高 2-3 倍。

**核心心法**：不要过早优化，也不要过晚行动。10 万 DAU 做多区域部署是浪费；100 万 DAU 没有预算管控是灾难。每个阶段做好关键优化，保持架构可演进性，就是最好的策略。
