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
8. [2026 主流微调工具链](#8-2026-主流微调工具链)
   - 8.1 [Unsloth：极速低显存微调](#81-unsloth极速低显存微调)
   - 8.2 [Axolotl：YAML 驱动的生产级管线](#82-axolotlyaml-驱动的生产级管线)
   - 8.3 [LLaMA-Factory：一站式微调平台](#83-llama-factory一站式微调平台)
   - 8.4 [工具链选型决策树](#84-工具链选型决策树)
9. [数据准备工程](#9-数据准备工程)
   - 9.1 [数据质量 > 数据数量](#91-数据质量--数据数量)
   - 9.2 [数据格式标准](#92-数据格式标准)
   - 9.3 [数据策展管线](#93-数据策展管线)
   - 9.4 [合成数据生成](#94-合成数据生成)
10. [强化学习微调深度解析](#10-强化学习微调深度解析)
    - 10.1 [RLHF 全管线拆解](#101-rlhf-全管线拆解)
    - 10.2 [DPO 及其变体](#102-dpo-及其变体)
    - 10.3 [GRPO：DeepSeek 的高效 RL](#103-grpodeepseek-的高效-rl)
    - 10.4 [方法选型指南](#104-方法选型指南)
11. [微调实战：端到端案例](#11-微调实战端到端案例)
    - 11.1 [任务定义与数据准备](#111-任务定义与数据准备)
    - 11.2 [Unsloth QLoRA 训练](#112-unsloth-qlora-训练)
    - 11.3 [评估与合并](#113-评估与合并)
    - 11.4 [量化与部署](#114-量化与部署)
12. [评估与验证](#12-评估与验证)
    - 12.1 [训练过程监控](#121-训练过程监控)
    - 12.2 [基准评估](#122-基准评估)
    - 12.3 [领域专项评估](#123-领域专项评估)
    - 12.4 [生产环境验证](#124-生产环境验证)
13. [常见陷阱与最佳实践（速查表）](#13-常见陷阱与最佳实践速查表)
14. [导航](#导航)

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

```diagram
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

```diagram
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

```diagram
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

```diagram
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

```diagram
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

```diagram
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

```diagram
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

```diagram
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

## 8. 2026 主流微调工具链

微调工具链之于 LLM 微调，就像 IDE 之于软件开发——你当然可以用记事本写代码，但一个好的 IDE 能让你的效率提升 10 倍。2024-2026 年，开源社区涌现出多个成熟的微调工具链，它们将底层的 HuggingFace Transformers、PEFT、TRL 等库封装为开箱即用的训练管线，大幅降低了微调门槛。

选择工具链的核心考量：

```diagram
                      你的微调需求是什么？
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        单 GPU 极速     多 GPU 生产级    100+ 模型
        低显存优先      复杂管线编排     WebUI 快速实验
              │             │             │
              ▼             ▼             ▼
          Unsloth        Axolotl     LLaMA-Factory
```

### 8.1 Unsloth：极速低显存微调

**为什么 Unsloth 能做到 2 倍速度、70% 显存节省？**

想象你在高速公路上开车。HuggingFace Transformers 的默认实现就像一辆普通轿车——功能齐全但没有针对赛道优化。Unsloth 所做的，是**手动重写引擎的关键零件**（模型前向传播的核心计算），用 Triton 语言编写高度优化的 GPU kernel，让同一辆车在同一条赛道上跑得更快、更省油。

**核心技术原理：**

1. **手动优化的 Triton Kernel**：Unsloth 不依赖 NVIDIA 的闭源 CUDA 库，而是用 OpenAI 的 Triton 编译器手动重写了 Transformer 模型的关键计算路径（Self-Attention、RoPE、Cross Entropy Loss、RMSNorm 等）。这些优化后的 kernel 直接替换（patch）HuggingFace 模型的 forward 方法。

2. **智能显存管理**：通过梯度检查点（Gradient Checkpointing）的精细控制和中间激活值的即时释放，将 VRAM 占用压缩到极致。

3. **数值精度保证**：尽管做了大量底层优化，Unsloth 保证输出与原始 HuggingFace 实现**比特级一致**（bit-for-bit identical），不会因为加速而牺牲训练精度。

**支持的训练模式：**

| 模式 | 说明 | 典型显存（7B 模型） |
|------|------|-------------------|
| QLoRA 4-bit | 4-bit 量化 + LoRA，最省显存 | ~6 GB |
| LoRA 16-bit | 16-bit 精度 + LoRA，精度更高 | ~16 GB |
| Full Fine-tuning | 全参数微调 | ~40 GB |

**Unsloth Studio**：2025 年推出的 GUI 界面，支持无代码微调。开发者可以通过拖拽界面完成数据上传、超参数配置、训练监控和模型导出，适合快速原型验证。

**GRPO 支持**：Unsloth 是最早集成 DeepSeek GRPO 算法的工具之一，支持高效的强化学习微调，无需单独训练 Critic 模型。

```python
# Unsloth QLoRA 微调示例
from unsloth import FastLanguageModel
import torch

# 1. 加载模型（自动应用 Triton 优化）
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B",       # 支持 LLaMA/Mistral/Qwen/Gemma 等
    max_seq_length=4096,
    dtype=None,                              # 自动检测 bf16/fp16
    load_in_4bit=True,                       # QLoRA 4-bit 量化
)

# 2. 添加 LoRA 适配器
model = FastLanguageModel.get_peft_model(
    model,
    r=16,                                    # LoRA rank
    target_modules=[                         # 覆盖所有线性层
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=16,
    lora_dropout=0,                          # Unsloth 优化：dropout=0 更快
    bias="none",
    use_gradient_checkpointing="unsloth",    # Unsloth 专属优化
)

# 3. 训练（使用 HuggingFace SFTTrainer，但底层已被 Unsloth patch）
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=5,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        output_dir="outputs",
    ),
)

trainer.train()

# 4. 保存与导出
model.save_pretrained_merged("merged_model", tokenizer)  # 合并 LoRA
model.save_pretrained_gguf("model_gguf", tokenizer)      # 导出 GGUF
```

**关键洞察**：Unsloth 的核心创新不在算法层面，而在工程层面——它证明了"手动优化 kernel"这一看似笨拙的方法，在实际效果上可以碾压自动编译器优化。这与游戏引擎领域手写汇编优化关键渲染路径的思路一脉相承。

### 8.2 Axolotl：YAML 驱动的生产级管线

如果 Unsloth 是一辆极速赛车，Axolotl 就是一条**全自动化的汽车生产线**——它的核心价值不在单点速度，而在将微调的完整流程（数据预处理 → 训练 → 合并 → 量化 → 部署）编排为可复现的 YAML 配置管线。

**为什么需要 Axolotl？**

在真实生产环境中，微调不是"跑一次脚本"那么简单。团队需要：
- 版本化管理训练配置（数据比例、超参数、模型架构）
- 混合多个数据集并控制采样比例
- 支持各种训练技术的排列组合（LoRA + DeepSpeed + Flash Attention + Sample Packing）
- 让不熟悉 Python 代码的研究员也能快速启动训练

Axolotl 用一个 YAML 文件解决了所有这些问题。

**核心特性：**

- **YAML 驱动配置**：所有训练参数、数据集配置、模型选择都在一个 YAML 文件中声明，无需编写 Python 代码
- **多数据集混合**：支持在同一次训练中混合多个数据集，并通过权重控制每个数据集的采样比例
- **Sample Packing**：将多个短样本打包到同一个序列中，避免 padding 浪费，显著提升训练效率
- **全栈技术支持**：LoRA、QLoRA、FSDP、DeepSpeed ZeRO（Stage 1/2/3）、Flash Attention 2、Gradient Checkpointing、xFormers

```yaml
# axolotl_config.yaml — 生产级微调配置示例
base_model: Qwen/Qwen2.5-7B-Instruct
model_type: AutoModelForCausalLM

# 数据集配置（多数据集混合）
datasets:
  - path: customer_service_v2.jsonl
    type: sharegpt                     # ShareGPT 对话格式
    conversation: chatml               # Qwen 使用 ChatML 模板
    weight: 0.7                        # 70% 采样权重
  - path: general_qa.jsonl
    type: alpaca                       # Alpaca 指令格式
    weight: 0.3                        # 30% 采样权重（防遗忘）

# LoRA 配置
adapter: lora
lora_r: 32
lora_alpha: 32
lora_dropout: 0.05
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj
  - gate_proj
  - up_proj
  - down_proj

# 训练超参数
sequence_len: 4096
sample_packing: true                   # 打包短样本，提升 GPU 利用率
pad_to_sequence_len: true
micro_batch_size: 2
gradient_accumulation_steps: 4
num_epochs: 3
learning_rate: 2e-4
lr_scheduler: cosine
warmup_steps: 100
optimizer: adamw_torch_fused
bf16: true
tf32: true
gradient_checkpointing: true
flash_attention: true                  # Flash Attention 2

# DeepSpeed（多 GPU 时启用）
deepspeed: deepspeed_configs/zero2.json

# 评估
val_set_size: 0.05
eval_steps: 100
save_steps: 500
```

**生产级工作流：**

```bash
# 1. 数据预处理与验证
axolotl preprocess axolotl_config.yaml

# 2. 训练
accelerate launch -m axolotl.cli.train axolotl_config.yaml

# 3. 合并 LoRA 权重
axolotl merge_lora axolotl_config.yaml --lora_model_dir=outputs/checkpoint-final

# 4. 量化为 GGUF（配合 llama.cpp）
python llama.cpp/convert_hf_to_gguf.py merged_model --outtype q4_k_m

# 5. 部署
ollama create my-model -f Modelfile
```

### 8.3 LLaMA-Factory：一站式微调平台

LLaMA-Factory（50k+ GitHub Stars）的定位类似于微调领域的"瑞士军刀"——它不追求某一方面的极致，而是提供了一个**统一界面**，让开发者用同一套工具完成 SFT、RLHF、DPO、KTO、ORPO 等几乎所有主流微调方法，支持 100+ 种 LLM 架构。

**类比**：如果说 Unsloth 是专业摄影师手中的定焦镜头（极致性能），Axolotl 是摄影工作室的全套设备（生产级管线），那么 LLaMA-Factory 就是一台高端手机的相机——操作简单、功能全面，适合快速验证和探索。

**核心特性：**

| 特性 | 说明 |
|------|------|
| 模型支持 | 100+ LLM（LLaMA/Mistral/Qwen/DeepSeek/Gemma/ChatGLM 等） |
| 微调方法 | SFT、RLHF（PPO）、DPO、KTO、ORPO、SimPO |
| PEFT 方法 | LoRA、QLoRA、DoRA、LongLoRA、Adapter、Prefix Tuning |
| 界面 | WebUI + CLI + API，三种交互方式 |
| 分布式 | DeepSpeed ZeRO、FSDP、多节点训练 |
| 内存优化 | GaLore、BAdam、Unsloth 后端加速 |
| 数据格式 | Alpaca、ShareGPT、OpenAI Chat、自定义格式 |
| 评估集成 | MMLU、C-Eval、CMMLU 等内置 benchmark |

**WebUI 操作流程：**

```bash
# 启动 WebUI
llamafactory-cli webui

# 在浏览器中完成：
# 1. 选择基础模型（下拉菜单）
# 2. 选择微调方法（SFT/DPO/RLHF...）
# 3. 上传或选择数据集
# 4. 配置超参数（滑块调节）
# 5. 点击"开始训练"
# 6. 实时查看 loss 曲线
# 7. 训练完成后直接对话测试
```

**内存高效优化器：**

- **GaLore**（Gradient Low-Rank Projection）：将梯度投影到低秩空间，在不使用 LoRA 的情况下也能大幅降低显存，适合全参数微调场景
- **BAdam**（Block-wise Adam）：将优化器状态按块存储和更新，减少 Adam 优化器的显存开销

```bash
# CLI 模式快速微调
llamafactory-cli train \
    --model_name_or_path Qwen/Qwen2.5-7B-Instruct \
    --stage sft \
    --finetuning_type lora \
    --lora_rank 16 \
    --dataset customer_service \
    --template chatml \
    --output_dir outputs/qwen-cs \
    --per_device_train_batch_size 2 \
    --gradient_accumulation_steps 4 \
    --learning_rate 2e-4 \
    --num_train_epochs 3 \
    --bf16 true \
    --flash_attn fa2
```

### 8.4 工具链选型决策树

| 场景 | 推荐工具 | 理由 |
|------|---------|------|
| 单卡 ≤24GB，追求速度 | **Unsloth** | 2x 加速，70% 显存节省 |
| 多 GPU 生产级管线 | **Axolotl** | YAML 配置可版本化，支持复杂编排 |
| 快速探索多种方法 | **LLaMA-Factory** | WebUI + 100+ 模型 + 全方法支持 |
| RL 微调（GRPO） | **Unsloth** 或 **LLaMA-Factory** | 原生 GRPO 支持 |
| 团队协作与复现 | **Axolotl** | YAML 配置 + Git 版本控制 |
| 无代码入门 | **LLaMA-Factory** WebUI 或 **Unsloth Studio** | GUI 操作 |

**三者可以组合使用**：例如，用 LLaMA-Factory WebUI 做初步实验确定最佳方法和超参数范围，然后用 Axolotl YAML 配置编写生产级训练管线，底层使用 Unsloth 后端加速训练。

---

## 9. 数据准备工程

### 9.1 数据质量 > 数据数量

微调数据准备就像厨师备料——食材质量决定菜品上限，再精湛的烹饪技法也无法把劣质食材变成米其林料理。同样，再强大的训练框架也无法从低质量数据中训练出优秀模型。

**一个经典案例**：斯坦福 Alpaca 项目用 GPT-3.5 生成了 52,000 条指令-回答对来微调 LLaMA-7B，效果尚可。但后续研究发现，如果精心策展 **1,000-5,000 条高质量数据**，效果反而更好。LIMA 论文（"Less Is More for Alignment"）用仅 1,000 条精选数据微调 LLaMA-65B，在多个 benchmark 上超越了用 52k 数据训练的版本。

**为什么少而精的数据更有效？**

```diagram
数据量 vs 模型性能关系（示意）：

性能 ▲
     │          ╭──────────── 高质量数据
     │         ╱
     │        ╱
     │       ╱    ╭────────── 低质量数据
     │      ╱    ╱
     │     ╱    ╱
     │    ╱    ╱
     │   ╱    ╱
     │  ╱    ╱
     │ ╱   ╱
     │╱  ╱
     ├──┴─────────────────────►  数据量
    0   1k   5k   10k   50k  100k

高质量 1k 条 ≈ 低质量 50k 条的效果
```

核心原因：微调的本质不是"教模型新知识"，而是**激活模型已有能力并调整输出格式**。预训练阶段模型已经习得了世界知识，微调只需要少量高质量示例来"示范"期望的输入-输出模式。噪声数据反而会干扰这个对齐过程。

### 9.2 数据格式标准

微调数据有三种主流格式，选择取决于你使用的工具和模型：

**Alpaca 格式**（指令-输入-输出三元组）：

```json
{
  "instruction": "将以下英文翻译成中文",
  "input": "The weather is beautiful today.",
  "output": "今天天气很好。"
}
```

**ShareGPT 格式**（多轮对话）：

```json
{
  "conversations": [
    {"from": "human", "value": "请解释什么是 LoRA 微调？"},
    {"from": "gpt", "value": "LoRA（Low-Rank Adaptation）是一种参数高效微调方法..."},
    {"from": "human", "value": "它和全参数微调相比有什么优势？"},
    {"from": "gpt", "value": "主要优势有三个方面：1. 显存节省..."}
  ]
}
```

**OpenAI Chat 格式**（直接兼容 OpenAI API）：

```json
{
  "messages": [
    {"role": "system", "content": "你是一个专业的客服助手。"},
    {"role": "user", "content": "我的订单什么时候到？"},
    {"role": "assistant", "content": "请提供您的订单号，我帮您查询物流状态。"}
  ]
}
```

**关键注意事项：`chat_template` 匹配**

每个模型有自己的对话模板（chat_template），它定义了 system、user、assistant 消息如何拼接为最终的 token 序列。**训练时的模板必须与推理时一致**，否则模型行为会严重异常。

```python
# Qwen2.5 的 ChatML 模板
"""
<|im_start|>system
你是一个专业的客服助手。<|im_end|>
<|im_start|>user
我的订单什么时候到？<|im_end|>
<|im_start|>assistant
请提供您的订单号...<|im_end|>
"""

# LLaMA-3 的模板
"""
<|begin_of_text|><|start_header_id|>system<|end_header_id|>
你是一个专业的客服助手。<|eot_id|>
<|start_header_id|>user<|end_header_id|>
我的订单什么时候到？<|eot_id|>
<|start_header_id|>assistant<|end_header_id|>
请提供您的订单号...<|eot_id|>
"""
```

### 9.3 数据策展管线

专业的微调数据准备是一条完整的工程管线，而非简单的"收集数据 → 开始训练"。

```diagram
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  1. 收集  │───▶│  2. 去重  │───▶│ 3. 质量  │───▶│ 4. 格式化 │───▶│ 5. 分词  │
│          │    │          │    │   过滤    │    │ & 模板化  │    │   分析    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
   API/爬虫        MinHash         PPL过滤       chat_template    长度分布
   合成生成        SimHash        LLM-as-Judge    标签验证       截断策略
   人工标注       精确去重        规则过滤         格式转换       Token统计
```

**第 1 步：数据收集**

| 来源 | 方法 | 适用场景 |
|------|------|---------|
| 业务系统 | API 提取历史对话记录 | 客服、销售等对话场景 |
| 网络爬取 | 爬虫 + 清洗 | 领域知识语料 |
| 人工标注 | 标注团队 + 标注平台 | 高质量种子数据 |
| 合成生成 | 教师模型（GPT-4/Claude）生成 | 快速扩充数据量 |

**第 2 步：数据去重**

重复数据会导致模型在特定模式上过拟合。常用去重方法：

- **精确去重**：基于文本 hash 值去除完全相同的样本
- **MinHash + LSH**：近似去重，找出内容高度相似但不完全相同的样本（如只改了几个字的变体）
- **SimHash**：适合长文本的指纹去重

```python
# MinHash 去重示例（使用 datasketch 库）
from datasketch import MinHash, MinHashLSH

lsh = MinHashLSH(threshold=0.8, num_perm=128)  # 相似度阈值 0.8

for idx, text in enumerate(dataset):
    m = MinHash(num_perm=128)
    for word in text.split():
        m.update(word.encode('utf-8'))
    
    # 检查是否与已有样本重复
    result = lsh.query(m)
    if not result:
        lsh.insert(str(idx), m)
        deduplicated_data.append(text)
```

**第 3 步：质量过滤**

三层过滤策略：

1. **规则过滤**：去除过短（< 50 token）、过长（> 4096 token）、特殊字符比例过高的样本
2. **困惑度过滤（Perplexity-based）**：用一个参考语言模型计算每个样本的困惑度，去除困惑度异常高（乱码/低质量）或异常低（重复/模板化）的样本
3. **LLM-as-Judge**：用 GPT-4 或 Claude 对样本质量打分（1-5 分），保留 4 分以上的样本

```python
# LLM-as-Judge 质量打分
judge_prompt = """
请评估以下问答对的质量，从 1-5 分评分：
- 5分：专业准确、逻辑清晰、信息完整
- 4分：基本正确、有少量可改进之处
- 3分：部分正确但有明显缺陷
- 2分：大量错误或不相关
- 1分：完全错误或无意义

问题：{question}
回答：{answer}

请只返回分数（数字）：
"""
```

**第 4 步：格式化与模板化**

将清洗后的数据转换为目标格式，并应用正确的 chat_template。此步骤需要严格验证：

- 每条数据的必填字段是否完整
- 特殊 token 是否正确（如 `<|im_start|>`, `<|eot_id|>`）
- 多轮对话的轮次交替是否正确（human/gpt 交替出现）

**第 5 步：分词分析**

训练前必须分析 tokenized 后的长度分布，以设置合理的 `max_seq_length` 和截断策略：

```python
import matplotlib.pyplot as plt
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct")
lengths = [len(tokenizer.encode(text)) for text in dataset]

print(f"长度统计：")
print(f"  平均：{sum(lengths)/len(lengths):.0f} tokens")
print(f"  中位数：{sorted(lengths)[len(lengths)//2]} tokens")
print(f"  P95：{sorted(lengths)[int(len(lengths)*0.95)]} tokens")
print(f"  P99：{sorted(lengths)[int(len(lengths)*0.99)]} tokens")
print(f"  最大：{max(lengths)} tokens")

# 建议 max_seq_length = P95 长度（覆盖 95% 的样本）
```

### 9.4 合成数据生成

当真实数据不足时，**用强模型（教师模型）生成训练数据给弱模型（学生模型）**是一种被广泛验证的有效方法，本质上是一种知识蒸馏（Knowledge Distillation）。

**Magpie 数据集案例**：

Magpie 是一个创新的合成数据生成项目，其核心思路巧妙：不是让 LLM 回答预设问题，而是让 LLM **自己生成问题**。具体做法是只给模型一个空的 system prompt 和 user 标记，让模型自行补全 user 的问题，然后再生成对应的回答。这种方法生成的数据多样性更高，因为问题本身也是模型创造的。

```python
# Magpie 风格的合成数据生成
def generate_magpie_data(model, tokenizer, system_prompt, n_samples=1000):
    """
    核心思路：给模型一个不完整的对话模板，
    让模型"幻想"用户会问什么问题，然后自己回答。
    """
    results = []
    
    for _ in range(n_samples):
        # 只给 system + user 开头标记，让模型补全 user 问题
        partial_prompt = f"<|im_start|>system\n{system_prompt}<|im_end|>\n<|im_start|>user\n"
        
        # 模型会自行生成一个"用户问题"
        user_question = model.generate(partial_prompt, stop="<|im_end|>")
        
        # 然后生成对应回答
        full_prompt = partial_prompt + user_question + "<|im_end|>\n<|im_start|>assistant\n"
        assistant_answer = model.generate(full_prompt, stop="<|im_end|>")
        
        results.append({
            "conversations": [
                {"from": "human", "value": user_question},
                {"from": "gpt", "value": assistant_answer}
            ]
        })
    
    return results
```

**合成数据的质量控制**：

- 生成后必须经过质量过滤（同 9.3 节的过滤管线）
- 多样性检查：确保生成的问题不会集中在少数几个主题
- 难度分布：混合简单/中等/困难的样本
- 避免"模型塌缩"：生成数据的风格不应过于单一

---

## 10. 强化学习微调深度解析

第 3 节已介绍了 RLHF/DPO/GRPO 的基本原理，本节从**工程实践角度**深入分析各方法的适用场景、实现细节和选型依据。

### 10.1 RLHF 全管线拆解

RLHF（Reinforcement Learning from Human Feedback）是 ChatGPT 成功背后的关键技术。它的核心思想可以用一个类比来理解：

**类比：RLHF 就像培训一个新员工**
1. **SFT 阶段**（入职培训）：给新员工看大量标准操作手册和优秀案例，让他学会基本工作流程
2. **Reward Model 阶段**（建立评价标准）：让多位资深员工对新员工的工作成果打分，训练出一个"自动评分系统"
3. **PPO 阶段**（实战迭代）：新员工不断工作 → 自动评分系统打分 → 根据反馈改进 → 循环迭代

```diagram
RLHF 三阶段管线：

阶段 1：SFT                阶段 2：Reward Model        阶段 3：PPO
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│ 预训练模型    │           │ 人类偏好数据  │           │ SFT 模型     │
│     +        │           │ (A > B 对比)  │           │     +        │
│ 指令数据集    │           │     ↓         │           │ Reward Model │
│     ↓         │           │ 训练评分模型  │           │     ↓         │
│ 有监督微调    │           │     ↓         │           │ PPO 优化策略  │
│     ↓         │           │ 输出: R(x,y)  │           │     ↓         │
│ SFT 模型     │           │ 奖励分数      │           │ 对齐模型     │
└──────────────┘           └──────────────┘           └──────────────┘
```

**PPO 在 LLM 中的四个模型**：

RLHF-PPO 阶段需要同时维护四个模型，这是它的主要工程挑战：

| 模型 | 作用 | 是否需要梯度 |
|------|------|------------|
| Actor（策略模型） | 生成回答，是要优化的目标 | ✅ 需要 |
| Critic（价值模型） | 预测每步的期望奖励 | ✅ 需要 |
| Reward Model | 对完整回答打分 | ❌ 冻结 |
| Reference Model | 防止策略偏离太远（KL 约束） | ❌ 冻结 |

> 4 个 7B 模型 = 28B 参数需要驻留显存，这就是 RLHF 对硬件要求极高的原因。

### 10.2 DPO 及其变体

DPO（Direct Preference Optimization）的革命性在于**将 RL 问题转化为分类问题**，从而绕过了 RLHF 中最复杂的 Reward Model 和 PPO 训练。

**类比**：如果 RLHF 是让学生做题 → 老师打分 → 学生根据分数调整学习策略的完整闭环，那 DPO 就是直接给学生看"好答案 vs 差答案"的对比，让学生自己悟出什么是好的——跳过了"训练老师"这一步。

**DPO 的数学直觉**：

DPO 的核心洞察：**最优的奖励函数可以用策略模型本身的对数概率来表示**。具体来说，对于一对偏好数据（chosen y_w, rejected y_l），DPO 损失函数为：

```
L_DPO = -log σ(β · [log π(y_w|x)/π_ref(y_w|x) - log π(y_l|x)/π_ref(y_l|x)])

其中：
- π 是当前策略模型
- π_ref 是参考模型（SFT 模型的冻结副本）
- β 控制偏离参考模型的程度（类似 KL 惩罚强度）
- σ 是 sigmoid 函数
```

**DPO 变体家族**：

| 方法 | 核心改进 | 适用场景 |
|------|---------|---------|
| **DPO** | 基础版本，需要 chosen/rejected 对 | 有成对偏好数据 |
| **IPO** | 改进损失函数，缓解过拟合 | DPO 训练不稳定时 |
| **KTO** | 只需 good/bad 标签，不需要配对 | 只有点赞/点踩数据 |
| **ORPO** | 将偏好优化融入 SFT 阶段 | 减少训练阶段数 |
| **SimPO** | 无需参考模型，更简单 | 减少显存占用 |

**KTO 的独特价值**：

在真实业务场景中，收集**成对偏好数据**（"回答 A 比回答 B 好"）成本很高。而**点赞/点踩数据**（"这个回答好/不好"）则随处可得——用户在 ChatBot 中的 thumbs up/down、客服系统中的用户满意度评分。KTO（Kahneman-Tversky Optimization）正是为这种场景设计的。

```python
# KTO 数据格式 — 只需要 good/bad 标签
kto_dataset = [
    {"prompt": "如何重置密码？", "completion": "请点击登录页...", "label": True},   # 好回答
    {"prompt": "如何重置密码？", "completion": "我不知道。", "label": False},        # 差回答
    # 注意：好/差回答不需要一一配对！
]
```

### 10.3 GRPO：DeepSeek 的高效 RL

GRPO（Group Relative Policy Optimization）是 DeepSeek 团队在 DeepSeek-R1 中提出的强化学习方法，其核心创新在于**去掉了 Critic 模型**，用组内相对优势来替代绝对价值估计。

**类比**：传统 PPO 就像每个学生有一个私人教练（Critic）实时评估表现；GRPO 则是让一组学生做同一道题，谁做得比平均水平好谁就被奖励——不需要教练，学生之间的排名就是反馈信号。

**GRPO 工作原理：**

```
对于每个 prompt x：
1. 用当前策略模型生成 G 个不同回答 {y_1, y_2, ..., y_G}
2. 用奖励函数对每个回答打分 {r_1, r_2, ..., r_G}
3. 计算组内优势：A_i = (r_i - mean(r)) / std(r)   ← 关键：相对排名
4. 用优势加权的策略梯度更新模型

无需 Critic 模型！显存需求减半！
```

**为什么 GRPO 特别适合推理任务？**

在数学、代码等有明确正确答案的任务中，奖励函数可以是确定性的（答对 = 1，答错 = 0）。GRPO 的组内采样能高效地利用这种稀疏奖励：

```python
# GRPO 用于数学推理的奖励函数示例
def math_reward(response, ground_truth):
    """确定性奖励：答案正确 +1，错误 -1"""
    extracted_answer = extract_final_answer(response)
    if extracted_answer == ground_truth:
        return 1.0
    return -1.0

# 对同一道题生成 8 个回答
# 假设 3 个答对，5 个答错
# 答对的优势 > 0（被奖励），答错的优势 < 0（被惩罚）
# 模型学会"哪种推理路径更容易得到正确答案"
```

### 10.4 方法选型指南

```diagram
你有什么类型的反馈数据？
        │
   ┌────┼────┬──────────┐
   ▼    ▼    ▼          ▼
 成对偏好  点赞/踩  确定性奖励  复杂多维奖励
 (A>B)   (好/坏)  (对/错)     (安全+有用+...)
   │      │        │           │
   ▼      ▼        ▼           ▼
  DPO    KTO     GRPO        RLHF(PPO)
```

| 选型维度 | RLHF (PPO) | DPO | KTO | GRPO |
|---------|-----------|-----|-----|------|
| 数据需求 | 成对偏好 + RM | 成对偏好 | 仅 good/bad | 可验证奖励 |
| 模型数量 | 4 个 | 2 个 | 2 个 | 2 个（无 Critic） |
| 显存需求 | 极高 | 中等 | 中等 | 较低 |
| 超参数数量 | 多（PPO 参数） | 少（主要是 β） | 少 | 中等 |
| 训练稳定性 | 需要仔细调参 | 较稳定 | 较稳定 | 较稳定 |
| 最佳场景 | 复杂对齐任务 | 有偏好对数据 | 只有评分数据 | 数学/代码推理 |
| 代表案例 | ChatGPT/Claude | Zephyr/Tulu | Starling | DeepSeek-R1 |

---

## 11. 微调实战：端到端案例

本节以一个完整的生产级微调项目为例，从任务定义到最终部署，演示每个步骤的具体操作。

### 11.1 任务定义与数据准备

**任务**：将 Qwen2.5-7B 微调为**电商客服 Agent**，要求：
- 准确理解用户的退换货、物流查询、商品咨询等意图
- 输出结构化 JSON（供后端系统解析）
- 语气友好专业，避免幻觉

**数据准备**（500 条高质量对话，ShareGPT 格式）：

```json
{
  "conversations": [
    {
      "from": "system",
      "value": "你是电商平台的智能客服助手。请根据用户问题，以 JSON 格式输出意图分类和回复。"
    },
    {
      "from": "human",
      "value": "我3天前买的手机壳还没到，订单号 2024031500123"
    },
    {
      "from": "gpt",
      "value": "```json\n{\n  \"intent\": \"物流查询\",\n  \"order_id\": \"2024031500123\",\n  \"action\": \"query_logistics\",\n  \"reply\": \"正在为您查询订单 2024031500123 的物流状态，请稍等。根据系统记录，您的包裹目前已从仓库发出，预计明天送达。如果明天仍未收到，请联系我们，我们会为您安排补发或退款。\"\n}\n```"
    }
  ]
}
```

**数据分布设计**：

| 意图类别 | 样本数 | 占比 |
|---------|--------|------|
| 物流查询 | 120 | 24% |
| 退换货申请 | 100 | 20% |
| 商品咨询 | 100 | 20% |
| 售后投诉 | 80 | 16% |
| 优惠活动 | 60 | 12% |
| 通用闲聊 | 40 | 8% |

> 注意保留 8% 的通用闲聊数据，防止模型"忘记"如何进行日常对话（灾难性遗忘防护）。

### 11.2 Unsloth QLoRA 训练

```python
# === 完整的 Unsloth QLoRA 微调脚本 ===

from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset
import torch

# ── 1. 模型加载 ──
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B-Instruct-bnb-4bit",  # 预量化 4-bit 模型
    max_seq_length=2048,
    dtype=None,
    load_in_4bit=True,
)

# ── 2. LoRA 配置 ──
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

# ── 3. 数据加载 ──
dataset = load_dataset("json", data_files="customer_service_500.jsonl", split="train")

# 应用 chat_template（关键步骤！）
def format_chat(example):
    """将 ShareGPT 格式转为 Qwen ChatML 模板"""
    messages = []
    for turn in example["conversations"]:
        role_map = {"system": "system", "human": "user", "gpt": "assistant"}
        messages.append({
            "role": role_map[turn["from"]],
            "content": turn["value"]
        })
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}

dataset = dataset.map(format_chat)

# ── 4. 训练 ──
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=2048,
    packing=True,                  # Sample Packing 提升效率
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,   # 等效 batch_size = 8
        warmup_steps=10,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=100,
        output_dir="outputs/qwen-cs-lora",
        report_to="tensorboard",
    ),
)

# 查看可训练参数
model.print_trainable_parameters()
# 输出：trainable params: 27,262,976 || all params: 3,782,587,392 || trainable%: 0.72%

trainer_stats = trainer.train()
print(f"训练时间：{trainer_stats.metrics['train_runtime']:.0f} 秒")
```

### 11.3 评估与合并

```python
# ── 5. 评估 ──

# 5.1 查看训练 loss 曲线（TensorBoard）
# tensorboard --logdir outputs/qwen-cs-lora/runs

# 5.2 手动测试
FastLanguageModel.for_inference(model)

test_cases = [
    "我买的鞋子尺码不对，想换大一号的",
    "你们这个蓝牙耳机防水吗？",
    "我要投诉快递员态度很差",
]

for query in test_cases:
    messages = [
        {"role": "system", "content": "你是电商平台的智能客服助手。请根据用户问题，以 JSON 格式输出意图分类和回复。"},
        {"role": "user", "content": query}
    ]
    inputs = tokenizer.apply_chat_template(messages, return_tensors="pt", add_generation_prompt=True).to("cuda")
    outputs = model.generate(inputs, max_new_tokens=512, temperature=0.1)
    response = tokenizer.decode(outputs[0][inputs.shape[-1]:], skip_special_tokens=True)
    print(f"Q: {query}")
    print(f"A: {response}\n")

# 5.3 批量评估（意图分类准确率）
import json

correct = 0
total = len(eval_dataset)
for sample in eval_dataset:
    prediction = model_predict(sample["input"])
    try:
        pred_intent = json.loads(prediction)["intent"]
        if pred_intent == sample["expected_intent"]:
            correct += 1
    except (json.JSONDecodeError, KeyError):
        pass  # JSON 格式错误也算失败

print(f"意图分类准确率：{correct/total*100:.1f}%")
# 目标：> 90%

# ── 6. 合并 LoRA 权重 ──
model.save_pretrained_merged(
    "outputs/qwen-cs-merged",
    tokenizer,
    save_method="merged_16bit",  # 合并为 16-bit 完整模型
)
print("LoRA 权重已合并到基础模型")
```

### 11.4 量化与部署

```bash
# ── 7. 量化为 GGUF ──

# 方法 A：使用 Unsloth 内置导出
python -c "
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained('outputs/qwen-cs-merged')
model.save_pretrained_gguf('outputs/qwen-cs-gguf', tokenizer, quantization_method='q4_k_m')
"

# 方法 B：使用 llama.cpp 转换
git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp
python convert_hf_to_gguf.py ../outputs/qwen-cs-merged --outtype q4_k_m --outfile qwen-cs-q4km.gguf

# ── 8. 部署 ──

# 方法 A：Ollama（适合单机部署）
cat > Modelfile << 'EOF'
FROM ./qwen-cs-q4km.gguf
SYSTEM "你是电商平台的智能客服助手。请根据用户问题，以 JSON 格式输出意图分类和回复。"
PARAMETER temperature 0.1
PARAMETER num_ctx 2048
EOF

ollama create qwen-cs -f Modelfile
ollama run qwen-cs "我的快递到哪里了？订单号 12345"

# 方法 B：vLLM（适合高并发生产环境）
pip install vllm
python -m vllm.entrypoints.openai.api_server \
    --model outputs/qwen-cs-merged \
    --quantization awq \
    --max-model-len 2048 \
    --gpu-memory-utilization 0.9 \
    --port 8000

# 测试 API
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-cs",
    "messages": [
      {"role": "system", "content": "你是电商平台的智能客服助手。"},
      {"role": "user", "content": "我想退货"}
    ],
    "temperature": 0.1
  }'
```

**端到端流程总结**：

```diagram
数据准备      训练        评估        合并        量化         部署
(500条)   (QLoRA 4bit)  (准确率>90%) (16bit合并)  (GGUF Q4_K_M) (Ollama/vLLM)
  │           │           │           │           │            │
  ▼           ▼           ▼           ▼           ▼            ▼
ShareGPT → Unsloth   → TensorBoard → save_    → llama.cpp → API Server
  格式      ~30min       + 手动测试    merged     convert     生产就绪
```

---

## 12. 评估与验证

微调模型的评估就像体检——你不能只测血压就说自己健康，需要**多维度、多指标**的全面检查。

### 12.1 训练过程监控

训练过程中需要持续监控以下指标：

| 指标 | 正常范围 | 异常信号 |
|------|---------|---------|
| **Training Loss** | 持续下降，收敛到 0.5-1.5 | 剧烈震荡 / 不下降 / 降到 0 |
| **Eval Loss** | 与 Training Loss 趋势一致 | 反弹上升（过拟合） |
| **Gradient Norm** | 稳定在 0.1-10 | 突然飙升 > 100（梯度爆炸） |
| **Learning Rate** | 按 schedule 变化 | N/A |
| **GPU 利用率** | > 90% | < 50%（数据加载瓶颈） |

```python
# TensorBoard 监控
tensorboard --logdir outputs/runs --port 6006

# Wandb 集成（推荐用于团队协作）
# 在 TrainingArguments 中设置：
# report_to="wandb"
# run_name="qwen-cs-v1"
```

**过拟合的早期信号**：

```diagram
Loss ▲
     │  ╲          ╱── Eval Loss（反弹 = 过拟合！）
     │   ╲        ╱
     │    ╲      ╱
     │     ╲    ╱
     │      ╲──╱
     │       ╲
     │        ╲──────── Training Loss（持续下降）
     │
     └──────────────────► Steps
              ↑
         在此处停止（Early Stopping）
```

### 12.2 基准评估

通用 benchmark 用于评估微调是否导致模型在通用能力上退化：

| Benchmark | 评估维度 | 工具 |
|-----------|---------|------|
| **MMLU** | 多领域知识（57 个学科） | lm-evaluation-harness |
| **HumanEval** | 代码生成能力 | bigcode-evaluation-harness |
| **MT-Bench** | 多轮对话质量（GPT-4 评分） | FastChat |
| **AlpacaEval 2.0** | 指令遵循（与 GPT-4 对比胜率） | alpaca_eval |
| **C-Eval / CMMLU** | 中文知识评估 | lm-evaluation-harness |
| **IFEval** | 指令遵循精确度 | lm-evaluation-harness |

```bash
# 使用 lm-evaluation-harness 运行 MMLU
pip install lm-eval
lm_eval --model hf \
    --model_args pretrained=outputs/qwen-cs-merged \
    --tasks mmlu \
    --batch_size 8 \
    --output_path eval_results/

# 对比微调前后的分数
# 微调前 MMLU：65.2
# 微调后 MMLU：64.8  ← 下降 < 1% 是可接受的（对齐税）
# 微调后 MMLU：58.3  ← 下降 > 5% 说明过拟合或数据有问题
```

### 12.3 领域专项评估

通用 benchmark 无法衡量领域任务的效果，需要构建**领域专属测试集**：

```python
# 领域评估框架
class DomainEvaluator:
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
    
    def evaluate(self, test_set):
        metrics = {
            "intent_accuracy": 0,     # 意图分类准确率
            "json_valid_rate": 0,     # JSON 格式正确率
            "response_relevance": 0,  # 回复相关性（LLM-as-Judge）
            "hallucination_rate": 0,  # 幻觉率
        }
        
        for sample in test_set:
            prediction = self.predict(sample["input"])
            
            # 1. JSON 格式检查
            try:
                parsed = json.loads(prediction)
                metrics["json_valid_rate"] += 1
            except json.JSONDecodeError:
                continue
            
            # 2. 意图分类准确率
            if parsed.get("intent") == sample["expected_intent"]:
                metrics["intent_accuracy"] += 1
            
            # 3. LLM-as-Judge 评估回复质量
            judge_score = self.llm_judge(sample["input"], prediction)
            metrics["response_relevance"] += judge_score
            
            # 4. 幻觉检测
            if self.detect_hallucination(prediction, sample["context"]):
                metrics["hallucination_rate"] += 1
        
        # 归一化
        n = len(test_set)
        return {k: v/n for k, v in metrics.items()}
```

**LLM-as-Judge 评估**：

使用 GPT-4 或 Claude 作为评估者，对模型输出进行结构化评分：

```python
judge_prompt = """
你是一个专业的 AI 评估专家。请评估以下客服回复的质量。

用户问题：{user_query}
模型回复：{model_response}

请从以下维度评分（1-5 分）：
1. 准确性：信息是否正确，有无捏造
2. 完整性：是否完整回答了用户问题
3. 专业性：语气是否友好专业
4. 格式规范：JSON 格式是否正确

请以 JSON 格式返回评分：
{{"accuracy": N, "completeness": N, "professionalism": N, "format": N, "overall": N}}
"""
```

### 12.4 生产环境验证

模型上线前的最后一道关卡：

**1. 污染检测（Contamination Checking）**

确保测试集没有泄漏到训练集中：

```python
# 简单的 n-gram 重叠检测
from collections import Counter

def check_contamination(train_texts, test_texts, n=10):
    """检查训练集和测试集的 n-gram 重叠"""
    train_ngrams = set()
    for text in train_texts:
        words = text.split()
        for i in range(len(words) - n):
            train_ngrams.add(tuple(words[i:i+n]))
    
    contaminated = 0
    for text in test_texts:
        words = text.split()
        for i in range(len(words) - n):
            if tuple(words[i:i+n]) in train_ngrams:
                contaminated += 1
                break
    
    print(f"污染率：{contaminated/len(test_texts)*100:.1f}%")
    # 目标：< 1%
```

**2. A/B 测试**

在生产环境中进行灰度发布：

```diagram
           ┌────────────────┐
用户请求 ──▶│   流量路由器    │
           │  (90% / 10%)   │
           └───┬────────┬───┘
               ▼        ▼
         ┌──────┐  ┌──────┐
         │ 旧模型 │  │ 新模型 │
         │ (90%) │  │ (10%) │
         └──────┘  └──────┘
               │        │
               ▼        ▼
         ┌────────────────┐
         │   指标对比       │
         │ 响应质量/延迟   │
         │ 用户满意度/成本  │
         └────────────────┘
```

关键 A/B 测试指标：
- 用户满意度（thumbs up/down ratio）
- 平均对话轮次（越少越好 = 问题解决更快）
- 人工升级率（转人工比例）
- 响应延迟 P50/P95/P99
- 每次对话 Token 成本

---

## 13. 常见陷阱与最佳实践（速查表）

以下是微调实战中最常见的 10 个陷阱，以 ❌ vs ✅ 格式呈现：

---

**1. 数据量迷信**

❌ 盲目堆砌大量低质量数据（"数据越多越好"）

✅ 小而精的高质量数据（1k-10k 条），经过去重、质量过滤、人工抽检

> LIMA 论文证明：1,000 条精选数据 > 52,000 条噪声数据。微调不是让模型学新知识，而是激活已有能力。

---

**2. 上来就全参数微调**

❌ 直接对 7B+ 模型做全参数微调（Full Fine-tuning）

✅ 先用 QLoRA 4-bit 快速验证可行性（6GB 显存即可），确认有效后再考虑提升精度

> QLoRA 4-bit 在大多数任务上达到全参数微调 95%+ 的效果，但显存和时间节省 5-10 倍。先验证方向正确，再追求极致。

---

**3. 忽略 chat_template**

❌ 训练时用 Alpaca 格式，推理时用模型原生 ChatML 格式

✅ 严格匹配模型的对话模板（`tokenizer.apply_chat_template`），训练和推理保持一致

> chat_template 不匹配是微调后模型"胡言乱语"的**最常见原因**。不同模型的特殊 token 完全不同。

---

**4. 只看 loss 下降**

❌ 看到 training loss 持续下降就认为训练成功

✅ 结合 benchmark 评估 + human eval + A/B test 多维度验证

> loss 下降只说明模型在"记忆"训练数据，不代表泛化能力提升。过拟合的模型 loss 也很低。

---

**5. 训练完直接上线**

❌ LoRA 训练完成后直接用于推理服务

✅ 合并 LoRA 权重 → 量化（GGUF/AWQ）→ 基准测试 → 灰度发布（10% 流量）→ 全量上线

> 未合并的 LoRA 权重在推理时会有额外的矩阵运算开销。量化可进一步降低 50-75% 的显存和成本。

---

**6. 忽略数据去重**

❌ 训练数据中存在大量近似重复样本

✅ MinHash 近似去重 + 精确 hash 去重 + 质量过滤管线

> 重复数据导致模型在特定模式上过拟合，表现为对某些问题过度自信、对其他问题无响应。

---

**7. 一次性训练不迭代**

❌ 一次微调就期望模型完美

✅ 建立数据飞轮：上线 → 收集用户反馈 → 补充/修正数据 → 重新微调 → 迭代

> 微调是一个持续迭代的过程，每轮迭代都应该分析"模型在哪些场景表现差"，针对性补充数据。

```diagram
      ┌────────────────────────────────┐
      │                                │
      ▼                                │
   微调模型 → 上线部署 → 收集反馈 → 补充数据
                           │
                   哪些 case 回答差？
                   缺少哪类训练样本？
```

---

**8. 盲目选择 RLHF**

❌ "ChatGPT 用 RLHF，所以我也要用 RLHF"

✅ 根据数据类型选择最合适的方法：
- 有成对偏好数据 → DPO
- 只有 thumbs up/down → KTO
- 数学/代码等可验证任务 → GRPO
- 复杂多维奖励信号 → RLHF (PPO)

> RLHF 的工程复杂度和资源需求远超 DPO/KTO/GRPO。95% 的生产场景用 DPO/KTO 就够了。

---

**9. 忽略基础模型选择**

❌ 在性能不足的小模型上反复微调试图弥补能力差距

✅ 先选择能力足够的基础模型，再通过微调调整格式和行为

> 微调能改变模型的输出风格和领域适应性，但无法显著提升模型的基础推理能力。在 1.5B 模型上微调不可能达到 7B 模型的推理水平。

---

**10. 忽略推理成本**

❌ 只关注训练效果，不考虑部署时的推理成本

✅ 在选型阶段就评估推理需求：延迟要求、并发量、硬件预算，选择合适的模型规模

> 7B 模型 + QLoRA 微调 + GGUF Q4 量化后，可以在单张消费级 GPU（RTX 4090）上以 50+ tokens/s 的速度运行。如果业务只需要简单意图分类，3B 模型可能就够了。

---

## 导航

- ← [技术资料总目录](../)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/08-LLM微调技术面试题.md)
