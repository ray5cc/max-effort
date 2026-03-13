# 08-LLM微调技术 — 技术资料

> 系统讲解大语言模型（LLM）微调全链路：从参数高效微调（LoRA/QLoRA/Adapter）到基于强化学习的对齐方法（RLHF/DPO/GRPO），再到分布式训练框架（DeepSpeed ZeRO/FSDP/verl），帮助开发者掌握将通用 LLM 定制化为领域专家的核心技术。

## 相关链接

- 对应面试题：[08-LLM微调技术面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md)

---

## 目录

1. [概述](#1-概述)
   - 1.1 [为什么需要微调](#11-为什么需要微调)
   - 1.2 [微调 vs. Prompt Engineering vs. RAG](#12-微调-vs-prompt-engineering-vs-rag)
2. [参数高效微调（PEFT）](#2-参数高效微调peft)
   - 2.1 [LoRA 原理图解](#21-lora原理图解)
   - 2.2 [QLoRA：4-bit 量化 + LoRA](#22-qlora4-bit-量化--lora)
   - 2.3 [Adapter Tuning](#23-adapter-tuning)
   - 2.4 [Prefix Tuning / P-Tuning v2](#24-prefix-tuning--p-tuning-v2)
   - 2.5 [各方法对比表](#25-各方法对比表)
3. [基于强化学习的微调](#3-基于强化学习的微调)
   - 3.1 [RLHF](#31-rlhfreinforcement-learning-from-human-feedback)
   - 3.2 [PPO 在 LLM 中的应用](#32-ppoproximal-policy-optimization-在-llm-中的应用)
   - 3.3 [DPO：无需 Reward Model](#33-dpodirect-preference-optimization--无需-reward-model)
   - 3.4 [GRPO](#34-grpogroup-relative-policy-optimization)
   - 3.5 [SFT vs RLHF vs DPO 对比](#35-sft-vs-rlhf-vs-dpo-对比)
4. [分布式微调](#4-分布式微调)
   - 4.1 [DeepSpeed ZeRO](#41-deepspeed-zero)
   - 4.2 [FSDP](#42-fspdfully-sharded-data-parallel)
   - 4.3 [verl 框架：混合引擎](#43-verl-框架混合引擎)
5. [实战示例](#5-实战示例)
   - 5.1 [用 LoRA 微调 LLaMA](#51-用-lora-微调-llama)
   - 5.2 [用 DPO 做偏好对齐](#52-用-dpo-做偏好对齐)
   - 5.3 [超参数选择指南](#53-超参数选择指南)
6. [最佳实践](#6-最佳实践)
7. [常见问题](#7-常见问题)
8. [导航](#导航)

---

## 1. 概述

### 1.1 为什么需要微调

预训练的大语言模型（如 LLaMA、Mistral、Qwen、DeepSeek）已在海量通用数据上习得了丰富的语言知识，但在垂直业务场景中往往表现欠佳。原因在于：

- **领域知识缺口**：医疗、法律、金融等专业领域的专有术语和推理范式，预训练语料覆盖不足。
- **格式与风格偏差**：业务系统通常需要模型输出结构化 JSON、遵循固定模板，通用模型默认倾向自然语言叙述。
- **行为对齐问题**：通用模型可能产生有害内容、幻觉，或无法遵循企业内部合规要求。
- **上下文窗口成本**：通过大量 System Prompt 注入背景知识会消耗大量 Token，推理成本高昂。

**类比**：把预训练模型想象成一位博览群书的通才学者，微调就是让他去专科医院实习三个月——他原有的通识知识没有丢失，但在特定场景下反应更快、更准、更符合职业规范。

微调的核心价值可以归纳为：

| 问题 | 微调如何解决 |
|------|-------------|
| 领域知识匮乏 | 在领域数据上继续训练，更新参数 |
| 输出格式不符 | 通过监督微调（SFT）学习格式模板 |
| 有害/偏见输出 | RLHF/DPO 进行价值对齐 |
| 推理延迟高 | 微调后减少冗长 Prompt |

### 1.2 微调 vs. Prompt Engineering vs. RAG

三种技术并非互斥，而是适用于不同场景的工具箱。理解它们的本质差异是选型的关键。

```
┌─────────────────────────────────────────────────────────────┐
│                    技术选型决策树                             │
│                                                              │
│   问题类型                 推荐方案                           │
│   ─────────              ──────────                         │
│   动态知识（频繁更新）  →  RAG（检索增强）                    │
│   风格/格式适配        →  Prompt Engineering（零成本）        │
│   领域知识固化          →  SFT 微调                          │
│   行为对齐/安全        →  RLHF / DPO 对齐                   │
│   资源极度受限          →  Prompt Engineering / RAG          │
│   数据保密（不上云）    →  私有化微调 + 本地部署              │
└─────────────────────────────────────────────────────────────┘
```

**三种方案横向对比：**

| 维度 | Prompt Engineering | RAG | 微调（Fine-tuning） |
|------|--------------------|-----|---------------------|
| 训练成本 | 无 | 低（向量索引） | 中～高 |
| 推理延迟 | 高（长 Prompt） | 中（检索+生成） | 低（Prompt 极简） |
| 知识时效性 | 受限于基模型 | 高（可实时更新） | 低（需重新训练） |
| 知识精准度 | 中 | 中～高（依赖检索质量） | 高（写入参数） |
| 行为对齐能力 | 弱 | 弱 | 强 |
| 实现复杂度 | 低 | 中 | 高 |

**实践结论**：三种方案常常组合使用——先用 SFT 固化格式与风格，用 RAG 补充动态知识，用 DPO 做安全对齐，再用 Prompt Engineering 做最后的精细控制。

---

## 2. 参数高效微调（PEFT）

全参数微调（Full Fine-tuning）需要更新模型所有参数，对于 70B 参数的模型，仅存储梯度就需要数百 GB 显存，工程成本极高。**参数高效微调（Parameter-Efficient Fine-Tuning，PEFT）** 通过只训练极少数参数来达到接近全参微调的效果。

### 2.1 LoRA（Low-Rank Adaptation）原理图解

**核心思想**：假设微调过程中权重的变化矩阵 ΔW 是低秩的（low-rank），可以用两个小矩阵之积来近似。

**数学表达式：**

```
W = W₀ + ΔW = W₀ + B·A

其中：
  W₀ ∈ ℝ^(d×k)   原始预训练权重（冻结，不参与训练）
  A  ∈ ℝ^(r×k)   下投影矩阵（随机高斯初始化）
  B  ∈ ℝ^(d×r)   上投影矩阵（初始化为全零）
  r  ≪ min(d, k)  秩（rank），通常取 4~64
```

**为什么 B 初始化为零？** 训练开始时 BA = 0，保证 LoRA 初始化阶段的输出与原模型完全相同，避免训练初期因随机扰动导致性能骤降。

**参数量对比：**

```
原始全参微调参数量：d × k
LoRA 训练参数量：r × k + d × r = r(d + k)

以 d=4096, k=4096, r=8 为例：
  全参微调：4096 × 4096 = 16,777,216 个参数
  LoRA：8 × (4096 + 4096)  =    65,536 个参数
  节省比例：约 99.6%
```

**架构图解：**

```
┌──────────────────────────────────────────────────────────┐
│                   Transformer 层                          │
│                                                          │
│   输入 x ──────────────────────────────────────────────► │
│              │                          │                │
│              ▼                          ▼                │
│   ┌──────────────────┐    ┌────────────────────────┐    │
│   │  W₀（冻结）       │    │     LoRA 分支           │    │
│   │  原始权重 d×k     │    │  x ─► A(r×k) ─► B(d×r) │   │
│   │  不参与梯度更新   │    │     (可训练参数)         │    │
│   └────────┬─────────┘    └──────────┬─────────────┘   │
│            │                          │                  │
│            └──────────┬───────────────┘                  │
│                       ▼                                  │
│              W₀x  +  BAx  =  输出                        │
└──────────────────────────────────────────────────────────┘
```

LoRA 通常应用于 Transformer 的 Query（Q）和 Value（V）投影矩阵，也可以扩展至 Key（K）、Output（O）及 FFN 层。实际工程中，Hugging Face PEFT 库（`peft` 包）封装了完整的 LoRA 实现，调用方式极为简洁。

**缩放因子 α：** 实际推理时，LoRA 输出需乘以 `α/r` 进行缩放（α 通常设为 r 的两倍），目的是在不同 rank 设置下保持学习率的一致性，避免每次调整 rank 都需要重新搜索最优学习率。

### 2.2 QLoRA：4-bit 量化 + LoRA

QLoRA（Quantized LoRA）由 Tim Dettmers 等人提出，使单张 48GB 消费级 GPU 即可微调 65B 参数模型。其核心创新包含三个技术点：

**1. 4-bit NormalFloat（NF4）量化**

NF4 是专为正态分布参数设计的数据类型。由于神经网络权重通常服从标准正态分布，NF4 的量化区间是信息理论最优的：

```
标准 FP32: 32 bit/参数 → 内存占用 1x
BF16:      16 bit/参数 → 内存占用 0.5x
INT8:       8 bit/参数 → 内存占用 0.25x
NF4:        4 bit/参数 → 内存占用 0.125x
```

**2. Double Quantization（双重量化）**

对量化常数（quantization constants）本身再进行一次量化，进一步压缩内存占用（约减少 0.37 bits/参数）。

**3. Paged Optimizers（分页优化器）**

使用 NVIDIA 统一内存特性，在 GPU 显存不足时自动将优化器状态（Optimizer States）分页到 CPU 内存，避免 OOM（Out of Memory）崩溃。

**QLoRA 与 LoRA 对比：**

| 维度 | LoRA | QLoRA |
|------|------|-------|
| 基础模型精度 | BF16/FP16 | NF4（4-bit） |
| 显存占用 | 约 FP16 基模型的 1/2 | 约 FP16 基模型的 1/8 |
| 训练速度 | 较快 | 较慢（量化解量化开销） |
| 最终性能 | 略高 | 接近 LoRA（损失极小） |
| 典型使用场景 | A100/H100 集群 | RTX 4090 / 消费级 GPU |

### 2.3 Adapter Tuning

Adapter Tuning 在每个 Transformer 子层（Self-Attention 和 FFN）之后插入小型"适配器模块"（Adapter Module）。原始模型参数完全冻结，只训练适配器中的参数。

**Adapter 模块结构：**

```
输入 h（维度 d）
     │
     ▼
 线性降维层（d → m，m ≪ d）
     │
     ▼
 非线性激活（ReLU / GELU）
     │
     ▼
 线性升维层（m → d）
     │
     ▼（残差连接）
输出 h + Adapter(h)
```

Adapter 的参数量约为 `2 × d × m`，当 `m = d/100` 时，每层仅增加约 2% 的参数。典型的 Adapter Tuning 框架有 AdapterHub，支持共享不同任务的 Adapter 模块，实现模块化的多任务学习。

**优势**：适合多任务场景，不同任务对应不同 Adapter，切换任务只需替换 Adapter 权重，基础模型保持共享。
**劣势**：在推理时引入额外串行计算，延迟略高于 LoRA（LoRA 可以将 BA 合并进 W₀，推理零额外开销）。

### 2.4 Prefix Tuning / P-Tuning v2

**Prefix Tuning**：不修改模型权重，而是在每一层 Transformer 的 Key-Value 矩阵前面拼接可训练的"前缀向量"（Prefix Tokens）。这些前缀向量是连续的浮点向量，不对应真实词汇，相当于为模型注入"软性指令"。

```
原始注意力输入：
  [x₁, x₂, ..., xₙ]

Prefix Tuning 注意力输入：
  [p₁, p₂, ..., pₖ, x₁, x₂, ..., xₙ]
  ←── 前缀（可训练）───► ←── 原始输入（冻结）──►
```

**P-Tuning v2**：Prefix Tuning 的改进版，将可训练前缀应用于所有 Transformer 层（而非仅输入层），大幅提升了对复杂 NLU 任务的适应能力。实验表明，P-Tuning v2 在分类、信息抽取等任务上可媲美全参微调。

**优势**：参数量极少（仅前缀向量），存储开销接近于零。
**劣势**：训练不稳定，对初始化敏感；对长文本生成任务效果较弱。

### 2.5 各方法对比表

| 方法 | 可训练参数 | 推理额外开销 | 稳定性 | 任务适用性 | 典型显存节省 |
|------|-----------|-------------|--------|-----------|------------|
| Full Fine-tuning | 100% | 无 | 高 | 所有任务 | 无 |
| LoRA | 0.1%～1% | 无（可合并） | 高 | 生成/理解 | 60～80% |
| QLoRA | 0.1%～1% | 量化解码开销 | 高 | 消费级GPU | 80～90% |
| Adapter | 0.5%～5% | 轻微（串行） | 高 | 多任务 | 60～70% |
| Prefix Tuning | < 0.1% | 轻微（前缀扩展） | 中 | 生成任务 | 90%+ |
| P-Tuning v2 | < 0.5% | 轻微 | 中 | NLU 任务 | 90%+ |

---

## 3. 基于强化学习的微调

SFT（监督微调）教会模型"如何回答"，但无法精确控制回答的"偏好"——模型可能给出正确但有害、或者正确但冗长的回答。基于强化学习的微调方法通过人类偏好信号来对齐模型行为。

### 3.1 RLHF（Reinforcement Learning from Human Feedback）

RLHF 是 InstructGPT、ChatGPT 等产品背后的核心对齐技术，包含四个阶段：

```
┌─────────────────────────────────────────────────────────────────┐
│                    RLHF 四阶段流程                               │
│                                                                 │
│  阶段1: 预训练基础模型                                            │
│  ┌─────────────┐                                                │
│  │  Base LLM   │  ← 在海量无监督文本上预训练                      │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  阶段2: 监督微调（SFT）                                           │
│  ┌─────────────┐   高质量 Prompt-Response 数据对                 │
│  │  SFT Model  │  ← 人工标注的示例对话                            │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  阶段3: 训练 Reward Model（RM）                                   │
│  ┌─────────────┐   对同一 Prompt 的多个回答进行人工排序            │
│  │  Reward     │  ← 学习"什么是好的回答"                          │
│  │   Model     │                                                │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  阶段4: PPO 强化学习优化                                          │
│  ┌─────────────┐   使用 RM 打分作为奖励信号                        │
│  │  RL Model   │  ← PPO 算法最大化期望奖励                        │
│  └─────────────┘   同时保持 KL 散度约束防止退化                   │
└─────────────────────────────────────────────────────────────────┘
```

RLHF 的目标函数可以表达为：

```
max_π  E[r(x, y)]  -  β · KL[π(y|x) || π_ref(y|x)]

其中：
  π         当前策略模型（RL Model）
  π_ref     参考模型（SFT Model，冻结）
  r(x, y)   Reward Model 对输出的评分
  β         KL 惩罚系数，防止 RL 模型偏离太远
```

### 3.2 PPO（Proximal Policy Optimization）在 LLM 中的应用

PPO 是强化学习中的经典在线策略算法，在 LLM 对齐中需要同时维护四个模型：

| 模型 | 角色 | 是否更新参数 | 显存占用 |
|------|------|------------|--------|
| Actor（策略模型） | 生成文本，接受优化 | ✅ 是 | 全量 |
| Critic（价值模型） | 估算状态价值 V(s) | ✅ 是 | 全量 |
| Reward Model | 评估输出质量 | ❌ 否（冻结） | 全量 |
| Reference Model | 提供 KL 基线 | ❌ 否（冻结） | 全量 |

同时维护四个大模型使 PPO 的工程成本极高。以 7B 模型为例，BF16 精度下四个模型合计需要约 **280GB 显存**，必须借助多机多卡 + ZeRO 分片才能完成训练。这也是 DPO 被广泛采用的重要原因之一。

### 3.3 DPO（Direct Preference Optimization）—— 无需 Reward Model

DPO 是 2023 年斯坦福提出的对齐新方法，其核心洞见是：**最优 Reward Model 的闭合解可以直接用策略模型表示**，从而绕过显式 Reward Model 的训练，将 RLHF 的四步流程压缩为两步。

**DPO 目标函数：**

```
L_DPO = -E[(x, yw, yl)] [
  log σ(
    β · log π_θ(yw|x) / π_ref(yw|x)
    -
    β · log π_θ(yl|x) / π_ref(yl|x)
  )
]

其中：
  yw  人类偏好的"好"回答（winner）
  yl  人类不偏好的"差"回答（loser）
  π_θ  待优化策略模型
  π_ref 参考模型（SFT 结果，冻结）
  β   温度系数（通常 0.1～0.5）
```

**直觉解释**：DPO 通过调整 `π_θ` 的参数，使模型对"好"回答的对数概率之比（相对于参考模型）高于"差"回答，等价于隐式地学习了 Reward Model 并做了策略优化。

**DPO 流程：**

```
┌──────────────────────────────────────────────────────┐
│                 DPO 两阶段流程                        │
│                                                      │
│  阶段1: SFT（监督微调）                               │
│  ┌──────────┐                                        │
│  │ SFT 模型 │  ← Prompt-Response 数据对训练           │
│  └──────────┘  ← 此模型同时作为 π_ref（冻结）          │
│                                                      │
│  阶段2: DPO 偏好优化                                  │
│  ┌──────────────────────────────────────┐            │
│  │ 偏好数据集：{prompt, chosen, rejected} │           │
│  │                  │                   │            │
│  │          ┌───────┴──────┐            │            │
│  │          │              │            │            │
│  │    π_θ（训练）    π_ref（冻结）       │            │
│  │          │              │            │            │
│  │          └───────┬──────┘            │            │
│  │                  │                   │            │
│  │           DPO Loss 计算               │            │
│  │         （最大化偏好差距）              │            │
│  └──────────────────────────────────────┘            │
└──────────────────────────────────────────────────────┘
```

**DPO 优势**：无需训练 Reward Model，无需 PPO 的在线采样，训练稳定性远高于 PPO，工程实现简单。DPO 数据集格式标准化为 `{prompt, chosen, rejected}` 三元组，Hugging Face TRL 库提供了 `DPOTrainer` 开箱即用的实现。

### 3.4 GRPO（Group Relative Policy Optimization）

GRPO 是 DeepSeek 在 DeepSeek-R1 中采用的对齐算法，在 DPO 的基础上进一步去掉了 Critic 模型，通过**组内相对比较**来估算优势函数（Advantage）。

**核心思想**：对同一个 Prompt，采样 G 个输出 {y₁, y₂, ..., yG}，使用规则化奖励函数（如数学题正确性）对每个输出打分，然后用组内平均分作为基线，计算相对优势：

```
A_i = (r_i - mean(r_1,...,r_G)) / std(r_1,...,r_G)
```

相比 PPO，GRPO 只需维护两个模型（Actor + Reference），显存占用减半，且奖励函数可以是简单的规则（如 Python 代码执行是否通过测试），不依赖神经网络 Reward Model。

DeepSeek-R1 通过 GRPO + 长链条思维（Long Chain-of-Thought）数据，实现了超越同规模 OpenAI 模型的数学推理能力，验证了 GRPO 在推理强化场景下的有效性。

### 3.5 SFT vs RLHF vs DPO 对比

| 维度 | SFT | RLHF（PPO） | DPO | GRPO |
|------|-----|-------------|-----|------|
| 数据格式 | (prompt, response) | (prompt, response) + 人工排序 | (prompt, chosen, rejected) | (prompt, G个回答) + 规则奖励 |
| 所需模型数 | 1 | 4 | 2 | 2 |
| 训练稳定性 | 高 | 低（在线探索） | 高 | 中 |
| 工程复杂度 | 低 | 极高 | 低 | 中 |
| 对齐效果 | 格式对齐 | 最强 | 接近 PPO | 推理任务强 |
| 典型应用 | 指令跟随 | ChatGPT 对齐 | 开源对齐 | 数学/代码推理 |

---

## 4. 分布式微调

大规模 LLM 微调必须借助分布式训练框架。以 LLaMA-3 70B 为例，BF16 精度下仅模型权重就占 140GB，加上梯度（140GB）和优化器状态（AdamW 需 280GB），合计约 560GB——单机 8 × A100 80GB（640GB 总显存）才刚好够用。

### 4.1 DeepSpeed ZeRO

ZeRO（Zero Redundancy Optimizer）是 Microsoft DeepSpeed 框架的核心技术，通过将训练状态分片（Sharding）到多张 GPU 上来消除冗余。

```
┌────────────────────────────────────────────────────────────┐
│               ZeRO 三个阶段的分片策略                        │
│                                                            │
│  ZeRO-1（优化器状态分片）                                    │
│  ┌──────┬──────┬──────┬──────┐                            │
│  │ GPU0 │ GPU1 │ GPU2 │ GPU3 │  每卡存储 1/4 优化器状态     │
│  │ W₀   │ W₀   │ W₀   │ W₀   │  权重全量，梯度全量          │
│  └──────┴──────┴──────┴──────┘                            │
│                                                            │
│  ZeRO-2（+ 梯度分片）                                       │
│  ┌──────┬──────┬──────┬──────┐                            │
│  │ GPU0 │ GPU1 │ GPU2 │ GPU3 │  优化器状态 + 梯度分片       │
│  │ W₀   │ W₀   │ W₀   │ W₀   │  权重仍全量                 │
│  └──────┴──────┴──────┴──────┘                            │
│                                                            │
│  ZeRO-3（+ 参数分片）                                       │
│  ┌──────┬──────┬──────┬──────┐                            │
│  │ GPU0 │ GPU1 │ GPU2 │ GPU3 │  三者全部分片                │
│  │ W₀/4 │ W₁/4 │ W₂/4 │ W₃/4 │  通信开销最大，显存最少     │
│  └──────┴──────┴──────┴──────┘                            │
└────────────────────────────────────────────────────────────┘
```

**ZeRO-Offload**：进一步将优化器状态和梯度卸载（Offload）到 CPU 内存，使 7B 模型的微调可以在单张 24GB GPU 上完成（代价是训练速度降低约 30%）。

### 4.2 FSDP（Fully Sharded Data Parallel）

FSDP 是 PyTorch 原生的分布式训练方案（PyTorch 1.12+），功能上类似 ZeRO-3，但深度集成在 PyTorch 生态中，无需额外依赖。其核心机制是：

- **参数分片**：每张 GPU 只持久存储 1/N 的模型参数
- **前向 All-Gather**：前向传播时临时聚合完整参数
- **反向 Reduce-Scatter**：反向传播后立即释放聚合的参数，只保留梯度分片
- **混合精度**：支持 BF16 前向 + FP32 优化器，平衡精度与效率

FSDP 与 Hugging Face Transformers `Trainer` 无缝集成，通过 `fsdp_config` 即可启用，是目前微调大模型最常用的 PyTorch 原生方案。

### 4.3 verl 框架：混合引擎

verl（Volcano Engine Reinforcement Learning）是字节跳动开源的 RLHF 训练框架，其核心创新在于**混合引擎（Hybrid Engine）**设计：将 Actor 模型的训练引擎（DeepSpeed/FSDP）和推理引擎（vLLM）合并在同一 GPU 进程组内，通过动态权重共享实现零拷贝切换。

```
传统 RLHF 训练架构（分离式）：
  Training GPU 集群 ←── 网络传输权重 ──► Inference GPU 集群
  （DeepSpeed 训练）                    （vLLM 采样）

verl 混合引擎：
  ┌─────────────────────────────────┐
  │  同一 GPU 进程组                  │
  │  ┌─────────────┐  权重共享  ┌────────────────┐  │
  │  │  DeepSpeed  │ ─────────► │  vLLM Engine   │  │
  │  │ （梯度更新）  │           │ （高吞吐采样）    │  │
  │  └─────────────┘           └────────────────┘  │
  └─────────────────────────────────┘
```

verl 相比传统 RLHF 框架（如 OpenRLHF）可减少约 40% 的训练时间，主要来自于消除了跨节点权重传输的网络瓶颈。

---

## 5. 实战示例

### 5.1 用 LoRA 微调 LLaMA

以下代码展示了使用 Hugging Face PEFT 库对 LLaMA 类模型进行 LoRA 微调的标准流程：

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer
from datasets import load_dataset

# 1. 加载基础模型（使用 4-bit 量化实现 QLoRA）
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B",
    load_in_4bit=True,          # 启用 QLoRA 4-bit 量化
    bnb_4bit_quant_type="nf4",  # 使用 NF4 量化类型
    bnb_4bit_compute_dtype="bfloat16",  # 计算时使用 BF16
    device_map="auto",
)

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B")
tokenizer.pad_token = tokenizer.eos_token

# 2. 配置 LoRA 参数
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,                    # LoRA rank，越大表达能力越强，显存消耗越多
    lora_alpha=32,           # 缩放系数 α，通常设为 r 的 2 倍
    target_modules=[         # 应用 LoRA 的目标模块
        "q_proj", "k_proj",
        "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_dropout=0.05,       # Dropout 防过拟合
    bias="none",             # 不训练 bias 参数
)

# 3. 将 LoRA 层注入模型
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 输出示例：trainable params: 41,943,040 || all params: 8,072,855,552 || trainable%: 0.5195

# 4. 准备数据集（Alpaca 格式）
dataset = load_dataset("tatsu-lab/alpaca", split="train")

def format_prompt(example):
    """将 Alpaca 格式转换为模型输入格式"""
    if example["input"]:
        return f"### Instruction:\n{example['instruction']}\n\n### Input:\n{example['input']}\n\n### Response:\n{example['output']}"
    return f"### Instruction:\n{example['instruction']}\n\n### Response:\n{example['output']}"

# 5. 配置训练参数
training_args = TrainingArguments(
    output_dir="./lora-llama-output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,   # 等效 batch_size = 16
    learning_rate=2e-4,              # LoRA 通常使用较高学习率
    fp16=False,
    bf16=True,
    logging_steps=10,
    save_steps=100,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    report_to="wandb",
)

# 6. 启动训练
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset,
    formatting_func=format_prompt,
    max_seq_length=2048,
)
trainer.train()

# 7. 保存 LoRA 权重（只保存增量参数，几十 MB）
model.save_pretrained("./lora-adapter")
tokenizer.save_pretrained("./lora-adapter")
```

**合并 LoRA 权重（部署时可选）：**

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM

# 加载原始模型（BF16 全精度）
base_model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B",
    torch_dtype="bfloat16",
)

# 加载 LoRA 适配器并合并
peft_model = PeftModel.from_pretrained(base_model, "./lora-adapter")
merged_model = peft_model.merge_and_unload()  # 将 BA 合并进 W₀，推理零开销

merged_model.save_pretrained("./merged-model")
```

### 5.2 用 DPO 做偏好对齐

```python
from trl import DPOTrainer, DPOConfig
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer

# 1. 加载 SFT 后的模型（同时作为 π_ref）
model = AutoModelForCausalLM.from_pretrained(
    "./sft-model",
    torch_dtype="bfloat16",
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained("./sft-model")

# 2. 准备偏好数据集（三元组格式）
preference_data = [
    {
        "prompt": "解释量子纠缠的概念",
        "chosen": "量子纠缠是指两个粒子在量子态上存在相关性，无论相距多远，对一个粒子的测量会瞬时影响另一个粒子的状态。这一现象由 EPR 悖论引发，被爱因斯坦称为'幽灵般的超距作用'。",
        "rejected": "量子纠缠就是两个粒子连在一起，可以超光速传递信息。"
    },
    # ... 更多数据
]
dataset = Dataset.from_list(preference_data)

# 3. 配置 DPO 训练
dpo_config = DPOConfig(
    beta=0.1,                        # KL 惩罚系数（越小越激进）
    learning_rate=5e-7,              # DPO 学习率通常比 SFT 低一个数量级
    num_train_epochs=1,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    bf16=True,
    output_dir="./dpo-output",
    loss_type="sigmoid",             # 标准 DPO，可选 "hinge"/"ipo"/"kto_pair"
)

# 4. 训练（ref_model=None 时自动用 model 的 frozen copy 作为参考）
trainer = DPOTrainer(
    model=model,
    ref_model=None,                  # 自动使用 model 的冻结副本
    args=dpo_config,
    train_dataset=dataset,
    tokenizer=tokenizer,
)
trainer.train()
```

### 5.3 超参数选择指南

| 超参数 | SFT 推荐值 | LoRA 推荐值 | DPO 推荐值 | 说明 |
|--------|-----------|------------|-----------|------|
| learning_rate | 1e-5 ～ 5e-5 | 1e-4 ～ 3e-4 | 1e-7 ～ 5e-6 | LoRA 可用更高 LR，DPO 需极低 LR |
| batch_size（等效） | 64～128 | 16～64 | 16～32 | 通过梯度累积实现 |
| num_epochs | 3～5 | 1～3 | 1 | 过多 epoch 易过拟合 |
| max_seq_length | 2048～4096 | 2048 | 1024～2048 | 影响显存，按需设置 |
| LoRA rank (r) | — | 8～64 | — | 越大能力越强，显存越多 |
| lora_alpha | — | 2r（常用） | — | 保持 alpha/r 恒定 |
| warmup_ratio | 0.03 | 0.03 | 0.1 | DPO 需更长 warmup |
| weight_decay | 0.01 | 0.01 | 0.0 | DPO 通常不用正则 |
| beta（DPO） | — | — | 0.1～0.5 | 越小对齐越激进，越大越保守 |

---

## 6. 最佳实践

**数据质量优先于数据数量**
微调 7B 模型时，1000 条高质量标注数据往往优于 100,000 条噪声数据。数据清洗策略：去重（MinHash 相似度去重）、过滤短文本、检测标注不一致样本。推荐使用 `datatrove`（HuggingFace）或 `LLM Deduplication` 工具进行数据预处理。

**梯度累积代替大 Batch**
在显存受限时，使用梯度累积（`gradient_accumulation_steps`）模拟大 batch 效果。等效 batch_size = per_device_batch × num_gpus × accumulation_steps，保持等效 batch_size 在 64～128 之间通常效果最佳。

**学习率调度使用 Cosine Warmup**
对微调任务，余弦退火（cosine）配合 3% 的 warmup steps 是最常见的稳定组合。避免使用过大的学习率，这是导致微调后模型"遗忘"原有能力的首要原因（灾难性遗忘）。

**监控 Eval Loss 防止过拟合**
每 100～500 steps 在验证集上评估一次 loss。当训练 loss 持续下降但 eval loss 开始反弹时，立即停止训练（Early Stopping）。TRL 的 `SFTTrainer` 支持通过 `eval_dataset` 参数直接配置。

**对齐税（Alignment Tax）的权衡**
RLHF/DPO 对齐后模型在安全性上提升，但可能在部分能力基准（如数学、代码）上有轻微退化，称为"对齐税"。使用 ORPO（Odds Ratio Preference Optimization）或 SimPO 等新方法可以在对齐的同时更好地保留原始能力。

**LoRA 的目标模块选择**
在 LLaMA 架构中，将 LoRA 应用于所有线性层（`q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj`）通常比只应用于 Q/V 效果更好，但参数量增加约 3 倍。建议先用小 rank 覆盖所有层，再根据消融实验决定是否精简。

---

## 7. 常见问题

**Q: 微调后模型在原有任务上性能下降（灾难性遗忘）**
A: 核心原因是学习率过大或训练轮次过多。解决方案：①降低学习率至 1e-5 以下；②使用 LoRA（天然抑制遗忘，原始权重冻结）；③混合通用数据进行"回放训练"（Replay）；④使用 EWC（Elastic Weight Consolidation）正则化。

**Q: DPO 训练后模型输出变短/重复**
A: 这是 DPO 的已知问题，称为"退化（degeneration）"。解决方案：①降低 beta 值；②使用 IPO（Identity Preference Optimization）损失替代标准 DPO；③在偏好数据集中保持 chosen/rejected 长度平衡。

**Q: 如何判断 LoRA rank 的合适取值**
A: 通用经验：简单格式适配任务 r=4～8 足够；复杂推理/代码生成任务 r=32～64。可以通过"内在维度"（intrinsic dimensionality）分析工具（如 LLaMA-Factory 内置）自动推荐 rank。还可以训练多个 rank 的 LoRA 并在 eval loss 曲线收敛前进行比较。

**Q: 微调数据集需要多大规模**
A: 经验值：①格式对齐（如 JSON 输出）：500～2000 条；②领域知识注入：5000～50,000 条；③代码生成专项：20,000～100,000 条；④全面能力提升：100,000+ 条（此时需考虑持续预训练而非 SFT）。

**Q: 多 GPU 训练时 loss 不稳定**
A: 可能原因：①不同 GPU 上的 batch 内容差异导致梯度方差高，解决方案是增大等效 batch_size；②梯度裁剪（`max_grad_norm`）设置过松，推荐 1.0；③FP16 精度下梯度溢出，改用 BF16。

---

## 导航

- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md)
