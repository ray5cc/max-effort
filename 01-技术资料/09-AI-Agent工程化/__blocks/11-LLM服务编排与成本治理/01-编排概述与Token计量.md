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
