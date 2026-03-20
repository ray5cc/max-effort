# 01-LLM原理面试题

> 涵盖 Transformer 架构、Self-Attention、位置编码、预训练范式、BPE 分词、Scaling Laws 与解码策略的分层面试题。

## 相关链接

- 对应技术资料：[01-LLM原理](../../01-技术资料/07-AI-Agent全栈开发/01-LLM原理.md)

## 题目列表

| 题号 | 题目                                                            | 难度   |
| ---- | --------------------------------------------------------------- | ------ |
| Q1   | Transformer 编码器与解码器的主要区别是什么？                    | ⭐     |
| Q2   | Self-Attention 的计算公式及为什么要除以 √dₖ？                   | ⭐     |
| Q3   | 多头注意力（Multi-Head Attention）的作用是什么？                | ⭐     |
| Q4   | GPT 与 BERT 的预训练目标有何不同？                              | ⭐     |
| Q5   | BPE（Byte Pair Encoding）分词的基本原理？                       | ⭐     |
| Q6   | 贪婪解码（Greedy Decoding）与束搜索（Beam Search）的区别？      | ⭐     |
| Q7   | 温度参数（Temperature）如何影响生成结果？                       | ⭐     |
| Q8   | 因果注意力掩码（Causal Mask）的作用？                           | ⭐     |
| Q9   | KV Cache 的原理及节省的计算量？                                 | ⭐⭐   |
| Q10  | RoPE（旋转位置编码）的数学原理与优势？                          | ⭐⭐   |
| Q11  | Top-p（nucleus）采样与 Top-k 采样的对比？                       | ⭐⭐   |
| Q12  | Chinchilla Scaling Law 与 Kaplan Scaling Law 的核心区别？       | ⭐⭐   |
| Q13  | WordPiece vs SentencePiece vs BPE 的差异？                      | ⭐⭐   |
| Q14  | LLM 涌现能力（Emergent Abilities）的原因假说？                  | ⭐⭐   |
| Q15  | ALiBi 相对位置编码的原理及其对长度外推的优势？                  | ⭐⭐   |
| Q16  | 预训练数据配比策略如何影响模型能力？                            | ⭐⭐   |
| Q17  | Beam Search 的主要缺陷是什么？                                  | ⭐⭐   |
| Q18  | Grouped Query Attention（GQA）如何减少 KV Cache 内存？          | ⭐⭐   |
| Q19  | Flash Attention 的计算图优化原理（tiling + recomputation）？    | ⭐⭐⭐ |
| Q20  | 投机解码（Speculative Decoding）的原理与加速比分析？            | ⭐⭐⭐ |
| Q21  | 连续批处理（Continuous Batching）如何提升推理吞吐？             | ⭐⭐⭐ |
| Q22  | PagedAttention 内存管理机制与传统 KV Cache 的对比？             | ⭐⭐⭐ |
| Q23  | 设计一个服务 70B LLM 的推理系统，考虑哪些因素？                 | ⭐⭐⭐ |
| Q24  | 对比解码（Contrastive Decoding）的原理与适用场景？              | ⭐⭐⭐ |
| Q25  | LLM 训练稳定性技巧：梯度裁剪、Warmup、Z-loss 各自解决什么问题？ | ⭐⭐⭐ |
| Q26  | MoE（Mixture-of-Experts）架构的核心原理与 DeepSeek-V3 的 Expert Parallelism？ | ⭐⭐   |
| Q27  | MoE 路由机制中 Top-K 选择与 Load Balancing Loss 的作用？ | ⭐⭐   |
| Q28  | 推理模型（o1/R1）的 Chain-of-Thought 训练与 test-time compute scaling？ | ⭐⭐⭐ |
| Q29  | RoPE 长度外推技术（NTK-aware、YaRN、Dynamic NTK）的原理对比？ | ⭐⭐⭐ |
| Q30  | 长上下文技术：Sliding Window Attention 与 ALiBi 的工程取舍？ | ⭐⭐   |
| Q31  | 多模态 LLM 的视觉编码器融合策略（Cross-Attention vs Linear Projection）？ | ⭐⭐⭐ |
| Q32  | KV Cache 优化：MLA 低秩压缩与 GQA/MQA 的对比？ | ⭐⭐⭐ |
| Q33  | Scaling Laws 的实践意义：Chinchilla-optimal 训练与 compute-optimal 预算分配？ | ⭐⭐   |
| Q34  | 场景题：设计一个多模态理解系统（图文+视频），需考虑哪些架构决策？ | ⭐⭐⭐ |
| Q35  | 场景题：100B 参数模型的低成本部署方案设计？ | ⭐⭐⭐ |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点             | 核心要点（一句话）                                               | 出题概率 |
| --- | ---------------- | ---------------------------------------------------------------- | -------- |
| 1   | Transformer 架构 | Self-Attention(Q×K^T/√d)→Softmax→V，Multi-Head并行               | ★★★★★    |
| 2   | 自注意力机制     | 全局依赖O(n²)，KQV矩阵生成，位置编码补充顺序信息                 | ★★★★★    |
| 3   | 预训练与微调     | 预训练=无监督学习语言，SFT=指令跟随，RLHF=对齐人类偏好           | ★★★★★    |
| 4   | Tokenizer        | BPE(GPT)/WordPiece(BERT)/SentencePiece(多语言)，词表大小影响效率 | ★★★★☆    |
| 5   | 位置编码         | 绝对(正弦)/相对(ALiBi)/旋转(RoPE)，RoPE支持长度外推              | ★★★★☆    |
| 6   | 推理采样策略     | Temperature(多样性)/Top-K(截断)/Top-P(动态截断)/Beam Search      | ★★★★☆    |
| 7   | 上下文窗口       | 注意力O(n²)限制，Flash Attention/稀疏注意力/滑动窗口             | ★★★★☆    |
| 8   | 幻觉问题         | 训练数据偏差/解码随机性/知识缺失，RAG/RLHF缓解                   | ★★★★★    |
| 9   | 涌现能力         | 规模达到阈值后突然出现(CoT/ICL)，Scaling Laws预测                | ★★★☆☆    |
| 10  | MoE 架构         | 专家混合+路由器，训练总参数大但推理激活参数少                    | ★★★★☆    |

---

## ⭐ 基础题（Q1–Q8）

---

### Q1：Transformer 编码器与解码器的主要区别是什么？

**参考答案**

Transformer 编码器（Encoder）和解码器（Decoder）的核心区别在于注意力机制的使用方式和信息流向。编码器由多层「双向自注意力 + FFN」堆叠，每个 token 可以看到序列中所有其他 token，适合生成全局上下文表示（如 BERT）。解码器在自注意力层使用因果掩码（Causal Mask），限制每个位置只能关注其左侧（历史）token，保证自回归生成的合法性；此外标准 Encoder-Decoder 架构的解码器还含有一个**交叉注意力**（Cross-Attention）层，用 Decoder 的 Query 对 Encoder 输出的 Key/Value 做注意力，实现源序列信息的融合（如 T5、原始 Seq2Seq Transformer）。GPT 系列采用纯 Decoder-Only 架构，省去交叉注意力，依靠预训练语言模型目标（CLM）进行因果生成。

**关键知识点**

- 编码器：双向注意力，适合理解任务；解码器：单向因果注意力，适合生成任务
- Decoder-Only（GPT）vs Encoder-Decoder（T5）vs Encoder-Only（BERT）三种主流范式
- 交叉注意力的 Q 来自解码器，K/V 来自编码器输出

**延伸阅读**

- Vaswani et al., "Attention Is All You Need" (2017) — https://arxiv.org/abs/1706.03762
- 原始 Transformer 源码（tensor2tensor）：https://github.com/tensorflow/tensor2tensor

---

### Q2：Self-Attention 的计算公式及为什么要除以 √dₖ？

**参考答案**

Self-Attention 的计算公式为：

```
Attention(Q, K, V) = softmax(QKᵀ / √dₖ) · V
```

其中 Q、K、V 均由输入向量通过线性投影得到，dₖ 是 Key 向量的维度。除以 √dₖ 是为了**缩放点积**（Scaled Dot-Product）：当 dₖ 较大时，QKᵀ 的结果值会随维度增大而变大（方差约为 dₖ），导致 softmax 输入进入饱和区（梯度趋近于零），训练不稳定。除以 √dₖ 将方差归一化为 1，使 softmax 输出分布更均匀，梯度流动更健康。直觉上，若 Q 和 K 各元素独立同分布且均值为 0、方差为 1，则 QK 内积的方差为 dₖ，标准差为 √dₖ，故除以 √dₖ 将值域稳定在合理范围。

**关键知识点**

- 点积缩放防止 softmax 饱和，是训练稳定性的关键
- Q/K/V 均通过独立的权重矩阵 Wq、Wk、Wv 线性变换得到
- 计算复杂度：O(n² · d)，n 为序列长度，d 为模型维度

**延伸阅读**

- Vaswani et al., "Attention Is All You Need" (2017) — https://arxiv.org/abs/1706.03762
- Illustrated Transformer: https://jalammar.github.io/illustrated-transformer/

---

### Q3：多头注意力（Multi-Head Attention）的作用是什么？

**参考答案**

多头注意力（Multi-Head Attention, MHA）将 Q、K、V 分别投影到 h 个低维子空间，在每个子空间独立执行 Self-Attention，最后将 h 个输出拼接后再做线性变换：

```
MHA(Q,K,V) = Concat(head_1, ..., head_h) · W_O
head_i = Attention(Q·W_i^Q, K·W_i^K, V·W_i^V)
```

多头的核心优势在于允许模型**同时关注不同位置、不同表征子空间的信息**。单头注意力在平均化多种依赖关系时能力受限；多头可以让一些头关注近距离语法依赖，另一些头关注远距离语义依赖。实验表明，不同注意力头确实学到了不同的语言学模式（句法依赖、共指、位置偏置等）。总参数量与单头相当（投影维度 dₖ = d_model / h），计算效率不损失。

**关键知识点**

- 多头 = 多个独立子空间的注意力并行计算，再拼接投影
- 每个头的维度 dₖ = d_model / h，总计算量与单头基本相同
- 不同头可以捕获不同语言学结构（句法、语义、位置等）

**延伸阅读**

- Clark et al., "What Does BERT Look at?" (2019) — https://arxiv.org/abs/1906.04341
- Michel et al., "Are Sixteen Heads Really Better than One?" (2019) — https://arxiv.org/abs/1905.10650

---

### Q4：GPT 与 BERT 的预训练目标有何不同？

**参考答案**

GPT 采用**因果语言模型（Causal Language Modeling, CLM）**目标：给定前缀 token 序列，预测下一个 token，即最大化 P(xₜ | x₁,...,xₜ₋₁)。这种单向自回归方式天然支持文本生成，是 GPT 系列的核心范式。BERT 采用两种预训练目标：**掩码语言模型（Masked Language Modeling, MLM）**和**下一句预测（Next Sentence Prediction, NSP）**。MLM 随机遮盖 15% 的 token（80% 替换为 [MASK]、10% 替换为随机词、10% 不变），让模型利用双向上下文预测被遮盖的词，即最大化 P(xₜ | x₁,...,xₜ₋₁, xₜ₊₁,...,xₙ)。双向上下文使 BERT 更适合理解类任务（分类、NER、问答），但不适合直接生成。后续研究（RoBERTa）发现 NSP 任务效果存疑，已被移除。

**关键知识点**

- GPT：单向 CLM，自回归生成；BERT：双向 MLM，上下文理解
- BERT 的 [MASK] token 在微调阶段不出现，存在预训练-微调分布偏差（pretrain-finetune discrepancy）
- T5 统一 Seq2Seq 范式，兼顾理解与生成

**延伸阅读**

- Radford et al., "Improving Language Understanding by Generative Pre-Training" (GPT-1, 2018)
- Devlin et al., "BERT: Pre-training of Deep Bidirectional Transformers" (2019) — https://arxiv.org/abs/1810.04805

---

### Q5：BPE（Byte Pair Encoding）分词的基本原理？

**参考答案**

BPE 是一种基于频率的**子词分词**算法，原用于数据压缩，被 Sennrich et al.（2016）引入 NLP。算法流程：① 将训练语料中所有词拆分为字符序列（初始词表为所有字符）；② 统计所有相邻字符对（byte pair）的频率；③ 将频率最高的字符对合并为新符号，加入词表；④ 重复步骤②③直到词表大小达到预设上限（如 32K、50K）。推理时，对输入文本贪婪地按学到的合并规则进行分词。BPE 的优势在于：能表示任意未登录词（OOV），通过字符级回退避免 `<UNK>`；词表大小可控；在常见词和罕见词之间取得平衡。GPT-2/GPT-3/LLaMA 均使用 BPE 的字节级变体（BBPE）。

**关键知识点**

- BPE 本质是贪婪地合并高频字符对，从字符级词表逐步构建子词词表
- 字节级 BPE（BBPE）以 UTF-8 字节为基础单元，彻底消除 OOV 问题
- 词表大小超参数影响分词粒度：词表越大，常见词越完整，但训练成本越高

**延伸阅读**

- Sennrich et al., "Neural Machine Translation of Rare Words with Subword Units" (2016) — https://arxiv.org/abs/1508.07909
- HuggingFace Tokenizers 库源码：https://github.com/huggingface/tokenizers

---

### Q6：贪婪解码（Greedy Decoding）与束搜索（Beam Search）的区别？

**参考答案**

贪婪解码每步选择概率最高的单个 token，时间复杂度为 O(n · V)（n 为序列长度，V 为词表大小），实现简单但容易陷入局部最优，生成质量较差。束搜索（Beam Search）维护 k 条（beam width = k）概率最高的候选序列，每步对每条候选序列扩展所有可能 token，保留累积对数概率最高的 k 条，最终选取概率最高的序列输出。束搜索在机器翻译等任务上显著优于贪婪解码，但在开放域文本生成中容易产生**重复、平淡**的文本（Holtzman et al., 2019 指出这是由于高概率路径往往是通用词的重复）。实践中，大语言模型推理通常使用带温度的随机采样（Top-p/Top-k）而非束搜索，以提升多样性和创造性。

**关键知识点**

- 贪婪解码是 beam_size=1 的束搜索，速度最快但质量有限
- 束搜索计算量为贪婪解码的 k 倍，但内存需求也增加 k 倍
- 开放域生成中束搜索存在"退化"问题，随机采样更受欢迎

**延伸阅读**

- Holtzman et al., "The Curious Case of Neural Text Degeneration" (2020) — https://arxiv.org/abs/1904.09751
- Koehn & Knowles, "Six Challenges for Neural Machine Translation" (2017)

---

### Q7：温度参数（Temperature）如何影响生成结果？

**参考答案**

温度参数 T 通过对 logits 进行缩放来调节输出分布的"尖锐程度"：

```
P(xₜ = w) = softmax(logits / T)_w
```

当 T → 0 时，分布趋向于 one-hot（退化为贪婪解码），模型只选择概率最高的 token，生成结果确定性强但缺乏多样性；当 T = 1 时，保留模型原始概率分布；当 T > 1 时，分布趋于均匀，模型更倾向于采样低概率 token，生成更具随机性和创造性，但也可能产生不连贯输出；当 T → ∞ 时，退化为均匀分布（随机选词）。实践中常用 T ∈ [0.7, 1.0] 进行平衡，代码生成等精确任务用低温（如 0.2），创意写作用较高温（如 0.9）。温度通常与 Top-p 或 Top-k 配合使用。

**关键知识点**

- T < 1：分布更尖锐，输出更保守确定；T > 1：分布更平坦，输出更随机多样
- 温度等价于对 logits 做除法后再过 softmax，不改变 token 的相对排序
- 生产环境中温度是关键超参数，需根据任务类型调优

**延伸阅读**

- Holtzman et al., "The Curious Case of Neural Text Degeneration" (2020) — https://arxiv.org/abs/1904.09751
- OpenAI API 文档（temperature 参数说明）：https://platform.openai.com/docs/api-reference

---

### Q8：因果注意力掩码（Causal Mask）的作用？

**参考答案**

因果注意力掩码（也称自回归掩码或下三角掩码）用于 Decoder-Only 语言模型，确保位置 i 的 token 在计算注意力时**只能看到位置 ≤ i 的 token**，不能访问未来信息。实现上，在 QKᵀ 得到注意力得分矩阵后，将上三角部分（j > i 的位置）设为 −∞，经 softmax 后这些位置的权重为 0。这一机制有两个关键作用：① **训练时并行化**：因果掩码允许在一次前向传播中同时计算所有位置的预测，而不必像真正的自回归推理那样逐步展开，大幅提高训练效率；② **保证自回归生成的合法性**：推理时逐 token 生成，每步的概率分布只依赖历史 token，与预训练条件一致。

**关键知识点**

- 因果掩码是形如下三角矩阵的布尔掩码，上三角填充 −∞
- 训练时并行、推理时串行——两种模式通过因果掩码统一
- 与 BERT 的双向注意力相比，因果掩码牺牲了对未来上下文的感知

**延伸阅读**

- GPT-2 源码中 `create_causal_mask`：https://github.com/openai/gpt-2
- HuggingFace `modeling_gpt2.py` — `_attn` 方法

---

## ⭐⭐ 进阶题（Q9–Q18）

---

### Q9：KV Cache 的原理及节省的计算量？

**参考答案**

在自回归推理中，每生成一个新 token 都需要对整个历史序列计算 Self-Attention。若不缓存，第 t 步需要重新计算位置 1…t 的所有 K、V 矩阵，计算量累计为 O(t²·d)。KV Cache 的做法：在每步前向传播后，将当前层的 Key 和 Value 张量追加存入缓存；下一步生成时，只需计算新 token 的 Q，然后与缓存中的全部 K、V 做注意力，不需要重复计算历史 K、V。这将每步的注意力计算量从 O(t·d) 降为 O(d)（只需计算新 token 的 Q·K 内积和加权求和），整个序列的注意力计算总量从 O(t²·d) 降为 O(t·d)。代价是 KV Cache 占用显存：每层每个 token 需存储 2 × num_heads × head_dim × dtype_bytes 字节，对 70B 模型生成长序列时显存开销显著。

**关键知识点**

- KV Cache 以显存换算力：缓存历史 K/V 避免重复计算，推理速度提升数倍
- 显存占用：batch_size × seq_len × num_layers × 2 × num_heads × head_dim × bytes_per_element
- KV Cache 是 GQA、MQA、PagedAttention 等优化技术的优化对象

**延伸阅读**

- Pope et al., "Efficiently Scaling Transformer Inference" (2022) — https://arxiv.org/abs/2211.05100
- vLLM 源码 KV Cache 管理：https://github.com/vllm-project/vllm

---

### Q10：RoPE（旋转位置编码）的数学原理与优势？

**参考答案**

RoPE（Rotary Position Embedding）由 Su et al.（2021）提出，核心思想是通过旋转变换将**相对位置信息编码进 Query 和 Key** 的内积中，而非显式添加到输入向量。具体地，对位置 m 的 Q 向量（2维切片视角），乘以旋转矩阵 R(mθ)（旋转角 mθ，θ 为频率基底）；对位置 n 的 K 向量乘以 R(nθ)。则 Q(m)ᵀK(n) = qᵀ R((m-n)θ) k，内积天然只依赖相对位置差 m-n。多维情形将向量按2维分组，每组应用不同频率的旋转。RoPE 的核心优势：① **外推能力**：通过 YaRN、LongRoPE 等方式可将训练长度外推到更长序列；② **与 Flash Attention 完全兼容**；③ 无需额外参数；④ LLaMA、Mistral、Qwen 等主流模型均采用。

**关键知识点**

- RoPE 将绝对位置编码转化为相对位置信息，通过旋转矩阵作用于 Q/K
- 公式核心：qᵀ R(Δm·θ) k，只与相对位置差 Δm 相关
- 长度外推变体：YaRN（调整 θ 基底）、LongRoPE（非均匀缩放）

**延伸阅读**

- Su et al., "RoFormer: Enhanced Transformer with Rotary Position Embedding" (2021) — https://arxiv.org/abs/2104.09864
- Peng et al., "YaRN: Efficient Context Window Extension of Large Language Models" (2023) — https://arxiv.org/abs/2309.00071

---

### Q11：Top-p（nucleus）采样与 Top-k 采样的对比？

**参考答案**

Top-k 采样：每步只从概率最高的 k 个 token 中采样，其余 token 的概率设为 0 后重新归一化。k 是固定超参数，问题在于不同位置的概率分布"宽窄"差异大——当分布均匀时 k 个候选可能覆盖极小概率质量，当分布尖锐时 k 个候选中大量 token 概率接近 0，两种极端情况下采样质量均不理想。Top-p（nucleus sampling，Holtzman et al., 2020）采用动态截断：按概率降序累加，选取累积概率刚好超过 p（如 0.9）的最小 token 集合作为候选集，再从中采样。这样分布尖锐时候选集小（接近贪婪），分布平坦时候选集大，能自适应概率分布的形状。实践中两者常组合使用（先 Top-p 过滤，再按温度采样），OpenAI 默认 top_p=1.0（不截断）配合 temperature 使用。

**关键知识点**

- Top-k：固定候选集大小，忽视分布形状；Top-p：动态候选集，自适应分布
- Top-p 的 p 值越大，候选集越大，输出越多样（p=1 等同无截断）
- 两者均为截断采样（truncated sampling），目的是过滤低概率"长尾"噪声

**延伸阅读**

- Holtzman et al., "The Curious Case of Neural Text Degeneration" (2020) — https://arxiv.org/abs/1904.09751
- Fan et al., "Hierarchical Neural Story Generation" (Top-k 原文, 2018) — https://arxiv.org/abs/1805.04833

---

### Q12：Chinchilla Scaling Law 与 Kaplan Scaling Law 的核心区别？

**参考答案**

Kaplan et al.（OpenAI，2020）的 Scaling Law 研究发现，模型性能（交叉熵损失）随参数量 N、数据量 D、计算量 C 呈幂律增长，并得出结论：在固定计算预算下，**应优先增大模型参数量**（数据量增长的最优比例低于参数量）。这一结论直接指导了 GPT-3（175B，训练仅约 300B tokens）等大参数少数据的训练策略。Hoffmann et al.（DeepMind，2022）的 Chinchilla 研究通过更严格的实验设计（固定 FLOP 预算，同时调整 N 与 D）发现：**最优数据量与参数量应等比例增长**（约 20 tokens per parameter），即 Chinchilla Optimal。Chinchilla（70B，1.4T tokens）在多数基准上超越了 Gopher（280B），颠覆了"更大模型必然更好"的认知，推动了 LLaMA（在更多数据上训练较小模型）等高效训练路线。

**关键知识点**

- Kaplan：优先扩大参数量；Chinchilla：参数量与数据量应等比扩展（约 20 tokens/param）
- Chinchilla Optimal：C ≈ 6ND，最优 N* 和 D* 均随计算量 C 按 C^0.5 增长
- LLaMA 系列体现了"过训练小模型"策略：更小参数 + 更多数据，推理成本低

**延伸阅读**

- Hoffmann et al., "Training Compute-Optimal Large Language Models" (Chinchilla, 2022) — https://arxiv.org/abs/2203.15556
- Kaplan et al., "Scaling Laws for Neural Language Models" (2020) — https://arxiv.org/abs/2001.08361

---

### Q13：WordPiece vs SentencePiece vs BPE 的差异？

**参考答案**

**BPE**（Byte Pair Encoding）：基于频率的贪婪合并，选取出现最频繁的相邻符号对合并，词表由合并规则决定。GPT-2/GPT-3/LLaMA 使用字节级 BPE（BBPE），以字节而非字符为基础单元，彻底避免 OOV。**WordPiece**：由 Google 提出，与 BPE 流程相似，但合并标准不同——选择合并后能最大化训练语料**似然增益**（即合并两个符号后语言模型分数提升最大）的符号对，而非单纯频率。BERT 使用 WordPiece，子词前缀为 `##`（如 `playing → play + ##ing`）。**SentencePiece**（Kudo & Richardson, 2018）是与语言无关的通用框架，不依赖预先的空格分词，以原始 Unicode 字符串（含空格，空格表示为 `▁`）为输入，支持 BPE 和 Unigram Language Model 两种算法。LLaMA/Mistral 使用 SentencePiece + BPE，T5 使用 SentencePiece + Unigram。

**关键知识点**

- BPE：频率贪婪合并；WordPiece：最大化语言模型似然的合并；SentencePiece：语言无关框架（含BPE/Unigram）
- SentencePiece 无需预分词，对中文、日文等无空格语言尤其重要
- BERT 用 WordPiece（`##` 前缀），GPT 用 BBPE，LLaMA 用 SentencePiece-BPE

**延伸阅读**

- Kudo & Richardson, "SentencePiece: A simple and language independent subword tokenizer" (2018) — https://arxiv.org/abs/1808.06226
- Schuster & Nakamura, "Japanese and Korean Voice Search" (WordPiece 原文, 2012)

---

### Q14：LLM 涌现能力（Emergent Abilities）的原因假说？

**参考答案**

Wei et al.（2022）定义"涌现能力"（Emergent Abilities）为：在小模型上不存在（接近随机水平），在超过某个规模阈值后突然出现的能力（如算术推理、BIG-Bench 特定任务）。主要假说有三类：① **相变假说（Phase Transition）**：类比物理相变，模型在达到某参数规模时内部表示发生质变，解锁新能力，有内在不连续性；② **度量假说（Metric Discontinuity）**：Schaeffer et al.（2023）指出，部分"涌现"是由于评估指标（如精确匹配）的非线性导致——若改用连续指标（如 BLEU），性能实际上是平滑增长的，涌现是评估的假象；③ **多步推理假说**：某些任务（如多步算术）需要模型正确执行多个子步骤，每步有一定错误率，整体成功率为多步成功率的乘积，小模型各步均低精度，乘积接近零；大模型各步精度提升，乘积出现非线性跃升。目前学术界共识是涌现现象真实存在，但其边界和可解释性仍是开放问题。

**关键知识点**

- 涌现定义：小规模不存在、大规模突然出现，且不可通过外推预测
- Schaeffer et al. 的"涌现是评估假象"反驳值得关注，推动更鲁棒的评估方法
- 实际应用：涌现能力是 LLM 能力边界研究的核心议题，影响 scaling 投资决策

**延伸阅读**

- Wei et al., "Emergent Abilities of Large Language Models" (2022) — https://arxiv.org/abs/2206.07682
- Schaeffer et al., "Are Emergent Abilities of Large Language Models a Mirage?" (2023) — https://arxiv.org/abs/2304.15004

---

### Q15：ALiBi 相对位置编码的原理及其对长度外推的优势？

**参考答案**

ALiBi（Attention with Linear Biases，Press et al., 2022）不在输入 embedding 中添加位置信息，而是直接在注意力得分矩阵上施加一个**基于相对距离的线性偏置**：

```
Attention_score(i, j) = qᵢkⱼᵀ/√dₖ − m · |i − j|
```

其中 m 是每个注意力头独有的标量斜率（按几何级数分配：1/2, 1/4, 1/8, …），|i-j| 为相对距离。距离越远，惩罚越大，模型天然偏向关注近邻 token。长度外推优势：ALiBi 模型在 1024 token 上训练，可以**零样本外推到更长序列**（如 2048 token），性能衰减远小于绝对位置编码（Sinusoidal/Learned）和 RoPE。直觉上，线性偏置是一种软正则化，告知模型"近的更相关"，而这一归纳偏置在更长序列上同样成立。其缺点是对长序列的建模能力仍有上限，不如 RoPE + YaRN 系列灵活。

**关键知识点**

- ALiBi = 注意力得分减去与相对距离成正比的惩罚，无可学习位置参数
- 不同头的斜率 m 按 2^(-8/n) 的几何级数分配（n 为头数）
- 擅长外推，但在极长上下文（100K+）上不如 RoPE+扩展方案

**延伸阅读**

- Press et al., "Train Short, Test Long: Attention with Linear Biases Enables Input Length Extrapolation" (2022) — https://arxiv.org/abs/2108.12409
- MPT 模型（使用 ALiBi）：https://github.com/mosaicml/llm-foundry

---

### Q16：预训练数据配比策略如何影响模型能力？

**参考答案**

预训练数据的领域配比（Data Mixture）对模型下游能力有显著影响，主要体现在以下几个维度：① **代码数据比例**：增加代码数据（GitHub 爬取）可显著提升模型的逻辑推理、数学推理能力，即便在纯文本任务上也有涌现效益（Chen et al., Codex；Liang et al., Code Llama）；② **多语言配比**：多语言数据有助于跨语言迁移，但比例过高会稀释英文能力（"curse of multilinguality"）；③ **高质量过滤 vs 多样性**：过度过滤（只保留类 Wikipedia 高质量文本）会损失多样性和泛化性；④ **数据混合算法**：DoReMi（Xie et al., 2023）通过领域重要性权重自动优化配比，相比均匀混合降低困惑度；⑤ **重复数据**：数据重复超过一定次数（约 4 次）会导致记忆化（memorization）和泛化性下降。Llama3 在 15T tokens 上训练，其数据配比（网页/代码/书籍/学术）是模型能力的关键因素。

**关键知识点**

- 代码数据是提升推理能力的杠杆性数据，超出其字面比例的正效应
- 数据重复与质量过滤存在 tradeoff，需根据任务需求调整
- DoReMi、DOREMI++ 等算法提供自动化数据配比优化方案

**延伸阅读**

- Xie et al., "DoReMi: Optimizing Data Mixtures Speeds Up Language Model Pretraining" (2023) — https://arxiv.org/abs/2305.10429
- Llama 3 技术报告：https://ai.meta.com/blog/meta-llama-3/

---

### Q17：Beam Search 的主要缺陷是什么？

**参考答案**

Beam Search 在开放域文本生成中存在几类系统性缺陷：① **重复退化（Repetition Degeneration）**：Beam Search 倾向于重复短语和句子，因为重复的 n-gram 在语言模型中常有较高概率，高概率路径容易陷入循环，需要额外的 n-gram 重复惩罚（`no_repeat_ngram_size`）；② **均值效应（Generic/Safe Text）**：束搜索选取高概率路径等同于选择"平均"文本，输出通俗、无聊，缺乏创意；③ **长度偏差**：不加长度归一化时，短序列往往获得更高联合概率（概率连乘累积折损），需要 length penalty；④ **计算代价**：beam_size 个并行候选需要 k 倍内存和计算；⑤ **与人类写作分布不符**：Holtzman et al. 证明人类文本并不位于语言模型的高概率路径上，束搜索的高概率输出与真实人类分布的困惑度反而更高。这些缺陷使得 Top-p/Top-k 采样在大多数生成场景中替代了束搜索。

**关键知识点**

- 重复退化和均值效应是 Beam Search 最核心的两个问题
- 长度归一化（length penalty α）和 n-gram 重复惩罚是常见补丁但非根本解决
- 翻译/摘要等约束生成任务中 Beam Search 仍是主流（配合约束解码）

**延伸阅读**

- Holtzman et al., "The Curious Case of Neural Text Degeneration" (2020) — https://arxiv.org/abs/1904.09751
- Welleck et al., "Neural Text Generation with Unlikelihood Training" (2020) — https://arxiv.org/abs/1908.04319

---

### Q18：Grouped Query Attention（GQA）如何减少 KV Cache 内存？

**参考答案**

标准多头注意力（MHA）中，Q、K、V 各有 H 个头，KV Cache 需存储 H 组 K/V。Multi-Query Attention（MQA，Shazeer 2019）将所有 Q 头共享同一组 K/V，将 KV Cache 减少为 1/H，但多个 Q 头共享一组 K/V 会降低模型表达能力，训练不稳定。Grouped Query Attention（GQA，Ainslie et al., 2023）是两者的折中：将 H 个 Query 头分为 G 组，每组共享一套 K/V（G ≪ H），KV Cache 减少为 MHA 的 G/H。例如 LLaMA-2-70B 用 64 个 Query 头、8 个 KV 头（G=8），KV Cache 减少为原来的 1/8，同时保留接近 MHA 的模型质量。GQA 在长序列推理中显著降低显存占用（KV Cache 是推理显存的主要瓶颈之一），吞吐量提升明显，已成为主流 LLM（LLaMA-2/3、Mistral、Gemma）的标配。

**关键知识点**

- MHA（H组KV）→ GQA（G组KV，G<H）→ MQA（1组KV）：KV Cache 依次减小
- GQA 在模型质量与推理效率之间取得最优 Pareto 点
- 实现上 K/V 头在 group 内广播（expand），兼容 Flash Attention

**延伸阅读**

- Ainslie et al., "GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints" (2023) — https://arxiv.org/abs/2305.13245
- Shazeer, "Fast Transformer Decoding: One Write-Head is All You Need" (MQA, 2019) — https://arxiv.org/abs/1911.02150

---

## ⭐⭐⭐ 高阶题（Q19–Q25）

---

### Q19：Flash Attention 的计算图优化原理（tiling + recomputation）？

**参考答案**

标准 Self-Attention 的瓶颈在于 IO 访问：计算 S = QKᵀ（shape: N×N）需要将 N×N 的中间矩阵写入 HBM（显存），再读回用于 softmax 和加权求和，当 N 很大时 HBM 读写成为主要瓶颈（IO-bound）。Flash Attention（Dao et al., 2022）提出两大技术：① **Tiling（分块计算）**：将 Q、K、V 分块加载到 SRAM（片上缓存），在 SRAM 内完成一个 tile 的注意力计算（利用 online softmax 技巧累积分块归一化），无需将完整 N×N 的 S 矩阵写入 HBM，将 IO 复杂度从 O(N²) 降至 O(N)；② **Recomputation（反向重计算）**：前向传播不保存 N×N 的注意力矩阵（节省 O(N²) 显存），反向传播时利用已保存的 Q、K、V 和 softmax 归一化系数（O(N) 存储）重新计算注意力权重，以额外的计算换显存。Flash Attention 2 进一步优化并行策略（沿序列维度并行），Flash Attention 3 针对 H100 Tensor Core 优化异步流水线。

**关键知识点**

- 核心思想：算法感知硬件（IO-aware），SRAM 分块计算避免 HBM 大矩阵读写
- 内存复杂度从 O(N²) 降至 O(N)，同时保持数值等价（非近似算法）
- Online softmax 是 tiling 的关键：无需全局最大值即可增量计算稳定的 softmax

**延伸阅读**

- Dao et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness" (2022) — https://arxiv.org/abs/2205.14135
- Dao et al., "FlashAttention-2" (2023) — https://arxiv.org/abs/2307.08691
- Flash Attention 源码：https://github.com/Dao-AILab/flash-attention

---

### Q20：投机解码（Speculative Decoding）的原理与加速比分析？

**参考答案**

投机解码（Speculative Decoding，Leviathan et al., 2023；Chen et al., 2023）利用"小草稿模型（Draft Model）快速生成候选，大目标模型（Target Model）并行验证"的思路加速推理。流程：① 小 Draft 模型（如 68M）串行自回归生成 γ 个候选 token；② 大 Target 模型（如 70B）**一次前向传播**并行处理这 γ 个 token（利用批处理和 KV Cache），得到每个位置的目标概率分布；③ 对每个候选 token 按接受概率 min(1, p_target/p_draft) 做接受-拒绝采样（保证输出分布与纯用 Target 采样完全等价）；④ 若某 token 被拒绝，从修正分布中采样一个新 token 后截断。理论加速比为 γ × α_avg（α_avg 为平均接受率），实践中草稿接受率高（同族模型约 0.7-0.9）时可获得 2-3× 加速。加速来源：Target 模型单次并行前向比串行生成 γ 次快，而 Draft 模型生成 γ 个 token 代价可忽略。

**关键知识点**

- 输出分布与单纯 Target 模型采样严格等价（通过接受-拒绝保证），非近似
- 加速前提：Target 模型是内存带宽受限（memory bandwidth bound），batch 内并行有加速
- 变体：自投机解码（Draft 用 Target 的早期层 early exit），无需额外模型

**延伸阅读**

- Leviathan et al., "Fast Inference from Transformers via Speculative Decoding" (2023) — https://arxiv.org/abs/2211.17192
- Chen et al., "Accelerating Large Language Model Decoding with Speculative Sampling" (2023) — https://arxiv.org/abs/2302.01318
- Medusa（多头投机）：https://github.com/FasterDecoding/Medusa

---

### Q21：连续批处理（Continuous Batching）如何提升推理吞吐？

**参考答案**

传统静态批处理（Static Batching）中，一个 batch 内的所有请求必须等最长序列生成完毕才能释放，短请求生成完成后 GPU 资源被浪费在等待上，导致吞吐量低下。连续批处理（Continuous Batching，也称迭代级批处理 Iteration-level Batching，Yu et al., 2022）的核心思想是：**在每个生成步（iteration）结束后检查是否有请求完成，立即将其从 batch 中移除，并插入新的等待请求**，使 batch 始终保持满载状态。具体地，在注意力计算上使用 PagedAttention（vLLM）或类似机制管理不同长度请求的 KV Cache，不要求序列等长对齐。效果：GPU 利用率从约 20-30%（静态批处理）提升至 70-80%+，吞吐量提升数倍。TensorRT-LLM、vLLM、SGLang 均实现了连续批处理。

**关键知识点**

- 静态批处理的低效根源：批内最长序列决定完成时间，短序列完成后 GPU 空转
- 连续批处理：每个 iteration 后动态增删请求，维持 batch 饱和度
- 配合 PagedAttention 实现变长序列的 KV Cache 高效管理

**延伸阅读**

- Yu et al., "Orca: A Distributed Serving System for Transformer-Based Generative Models" (2022) — https://www.usenix.org/conference/osdi22/presentation/yu
- vLLM 论文：Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (2023) — https://arxiv.org/abs/2309.06180

---

### Q22：PagedAttention 内存管理机制与传统 KV Cache 的对比？

**参考答案**

传统 KV Cache 在请求到来时预分配最大序列长度的连续内存块（如 max_seq_len=4096 × 每 token KV 大小），这导致两类浪费：① **内部碎片**：若实际生成长度远小于 max_seq_len，预分配的多余空间被浪费；② **外部碎片**：多个请求占用不连续的内存块，无法有效复用。PagedAttention（vLLM，Kwon et al., 2023）借鉴操作系统虚拟内存分页思想，将每个请求的 KV Cache 分割为固定大小的**物理块（block，如 16 个 token/块）**，通过**块表（block table）**记录逻辑块到物理块的映射，物理块无需连续。优势：① 几乎消除内部碎片（仅最后一块有碎片）；② 支持**跨请求共享物理块**（如 System Prompt 的 KV Cache 可在多个请求间 Copy-on-Write 共享）；③ 支持灵活的抢占和换出（swap to CPU）。内存利用率从传统约 20-40% 提升至 90%+。

**关键知识点**

- PagedAttention = OS 分页内存管理思想应用于 KV Cache，消除碎片化
- 块表（block table）是逻辑-物理块的映射表，是 vLLM 内存管理的核心数据结构
- 物理块共享（Prefix Caching）可大幅减少重复系统提示词的 KV 计算量

**延伸阅读**

- Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (2023) — https://arxiv.org/abs/2309.06180
- vLLM 源码：https://github.com/vllm-project/vllm

---

### Q23：设计一个服务 70B LLM 的推理系统，考虑哪些因素？

**参考答案**

服务 70B LLM 的推理系统设计需要从以下维度综合考量：① **模型并行**：70B 模型（BF16 约 140GB）无法放入单张 A100（80GB），需张量并行（Tensor Parallelism，按层内切分 Q/K/V/FFN 权重）或流水线并行（Pipeline Parallelism，按层分组），通常 TP=2（双卡）或 TP=4；② **KV Cache 管理**：采用 PagedAttention + 连续批处理，控制 GPU 内存分配；③ **量化**：AWQ/GPTQ INT4 量化可将 70B 模型压缩到约 35GB，单张 A100 可容纳，性能损失 < 1%；④ **调度策略**：请求队列优先级（FCFS vs 抢占式）、并发量控制（max_num_seqs）；⑤ **预填充-解码分离（Prefill-Decode Disaggregation）**：Prefill 阶段 compute-bound，Decode 阶段 memory-bound，可用不同硬件异构部署（DistServe）；⑥ **SLO 目标**：TTFT（首 token 延迟）和 TPOT（每 token 延迟）是关键 SLO 指标；⑦ **监控**：GPU 利用率、KV Cache 命中率、队列等待时间实时监控。

**关键知识点**

- 显存估算：70B × 2 bytes（BF16）= 140GB，TP=2 即可；加 KV Cache 则需更多
- TTFT 主要受 Prefill 影响，TPOT 受 Decode 的内存带宽和批大小影响
- 生产系统推荐：vLLM / TGI / TensorRT-LLM + 负载均衡器 + 模型路由

**延伸阅读**

- Zhong et al., "DistServe: Disaggregating Prefill and Decoding for Goodput-Optimized LLM Serving" (2024) — https://arxiv.org/abs/2401.09670
- vLLM 生产部署指南：https://docs.vllm.ai/en/latest/serving/deploying_with_docker.html

---

### Q24：对比解码（Contrastive Decoding）的原理与适用场景？

**参考答案**

对比解码（Contrastive Decoding，Li et al., 2022）的动机是：语言模型容易输出通用、重复或不够忠实的文本，因为这些 token 在小模型和大模型中都有高概率。核心思想：**用专家模型（Expert，大模型）的概率减去业余模型（Amateur，小模型）的概率的对数比**，选择两者差异最大的 token：

```
CD score(x) = log p_expert(x) − log p_amateur(x)
```

再加上截断条件（仅在 p_expert(x) > α · max_x p_expert(x) 时考虑该 token）。直觉：大模型高概率而小模型低概率的 token，往往是"更有信息量、更具体"的表达，过滤掉大小模型都高概率的平庸词汇。适用场景：① **忠实性提升**（如 RAG 场景减少幻觉）；② **开放域文本多样性提升**；③ **VCD（Visual Contrastive Decoding）**用于多模态幻觉减少（用带视觉/不带视觉的输出做对比）。局限：需要维护两个模型的前向计算，推理成本加倍。

**关键知识点**

- CD 分数 = log(p_expert/p_amateur)，本质是选择区分大小模型的信息性 token
- 截断条件防止选择绝对概率极低的噪声 token（控制在 expert 的可信集合内）
- VCD 等变体证明对比解码思想在多模态和忠实性任务上的广泛适用性

**延伸阅读**

- Li et al., "Contrastive Decoding: Open-ended Text Generation as Optimization" (2022) — https://arxiv.org/abs/2210.15097
- Leng et al., "Mitigating Object Hallucinations in Large Vision-Language Models through Visual Contrastive Decoding" (VCD, 2024) — https://arxiv.org/abs/2311.16922

---

### Q25：LLM 训练稳定性技巧：梯度裁剪、Warmup、Z-loss 各自解决什么问题？

**参考答案**

**梯度裁剪（Gradient Clipping）**：解决梯度爆炸问题。深度 Transformer 训练中，某些 batch 的梯度范数可能异常大（通常在训练初期或遇到异常数据时），直接更新会导致参数发生剧变甚至 NaN/Inf。梯度裁剪将全局梯度范数超过阈值 τ（通常 1.0）的梯度按比例缩小：g ← g × (τ / ‖g‖)，保持方向不变，仅限制幅度。**Warmup（学习率预热）**：解决训练初期模型参数随机初始化导致的高方差梯度问题。从极小学习率（甚至 0）线性/余弦增大到目标学习率（warm-up steps 通常为总步数的 1-2%），让模型先在低 LR 下稳定参数方向，再加速收敛。Adam 在训练初期二阶矩估计不准确（bias correction 未充分修正），低 LR 可缓解。**Z-loss**（Zoph et al., 2022，PaLM 训练技巧）：解决 softmax 输出的 logits 数值溢出（overflow）问题。Z-loss = ε × (log Σ exp(logitᵢ))²，惩罚 logits 的绝对值过大，将归一化常数 Z 约束在合理范围，防止训练后期出现 loss spike 和数值不稳定，是大规模训练（500B+ 参数）的重要稳定性技巧。

**关键知识点**

- 梯度裁剪：限制梯度范数上限，防止爆炸；Warmup：渐进增大 LR，稳定初始训练
- Z-loss 针对 MoE 和超大模型中 softmax logits 数值溢出的专用稳定性损失
- 三者通常组合使用，共同保障百亿级别模型训练不发散

**延伸阅读**

- Zoph et al., "ST-MoE: Designing Stable and Transferable Sparse Expert Models" (Z-loss 来源, 2022) — https://arxiv.org/abs/2202.08906
- Chowdhery et al., "PaLM: Scaling Language Modeling with Pathways" (训练稳定性详述, 2022) — https://arxiv.org/abs/2204.02311

---

## ⭐⭐ 进阶题·续（Q26–Q27, Q30, Q33）

### Q26：MoE（Mixture-of-Experts）架构的核心原理与 DeepSeek-V3 的 Expert Parallelism？

<details>
<summary>参考答案</summary>

MoE（Mixture-of-Experts）的核心思想是**稀疏激活**：模型包含大量专家子网络（Expert），但每个 token 只激活其中 K 个，从而在保持庞大参数量（知识容量）的同时，控制每次前向传播的实际计算量。

**基本架构**：在标准 Transformer 的 FFN 层替换为 MoE 层，包含 N 个结构相同但参数独立的专家网络（每个专家通常是一个标准 FFN）和一个路由器（Router/Gate）。路由器对每个 token 的隐藏状态计算一个得分向量，选择得分最高的 K 个专家进行计算，最终输出是被选中专家输出的加权和。

**稀疏激活的价值**：以 DeepSeek-V3 为例，模型总参数量为 671B，但每个 token 仅激活约 37B 参数（256 个 routed experts 中选 top-8），训练和推理的 FLOPs 仅相当于一个 37B 的稠密模型，但拥有 671B 参数的知识容量。这就像一家大型医院有 256 位专科医生，但每位患者只需看 8 位相关科室的医生即可。

**DeepSeek-V3 的 Expert Parallelism**：256 个专家分布在多张 GPU 上（如 8 张 GPU 各放 32 个专家），每个 token 经路由后需 All-to-All 通信将 token 发送到对应专家所在的 GPU。DeepSeek-V3 使用 device-level auxiliary loss 保证每张 GPU 接收到的 token 数量均衡，减少通信等待。此外引入了 1 个 shared expert（所有 token 都经过），捕获通用知识。

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class SimpleMoELayer(nn.Module):
    """简化的 MoE 层示例"""
    def __init__(self, d_model, d_ff, num_experts, top_k):
        super().__init__()
        self.num_experts = num_experts
        self.top_k = top_k
        # 路由器：线性层，输出每个专家的得分
        self.router = nn.Linear(d_model, num_experts, bias=False)
        # N 个独立的 FFN 专家
        self.experts = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, d_ff),
                nn.SiLU(),
                nn.Linear(d_ff, d_model)
            ) for _ in range(num_experts)
        ])

    def forward(self, x):
        # x: (batch, seq_len, d_model)
        scores = self.router(x)                    # (batch, seq_len, num_experts)
        top_k_scores, top_k_indices = scores.topk(self.top_k, dim=-1)
        weights = F.softmax(top_k_scores, dim=-1)  # 归一化选中专家的权重

        output = torch.zeros_like(x)
        for i in range(self.top_k):
            expert_idx = top_k_indices[..., i]      # (batch, seq_len)
            weight = weights[..., i].unsqueeze(-1)   # (batch, seq_len, 1)
            for e in range(self.num_experts):
                mask = (expert_idx == e)
                if mask.any():
                    expert_input = x[mask]
                    expert_output = self.experts[e](expert_input)
                    output[mask] += weight[mask] * expert_output
        return output
```

**与稠密模型的对比**：

| 维度 | 稠密模型（如 Llama-70B） | MoE 模型（如 DeepSeek-V3） |
|------|------------------------|--------------------------|
| 总参数量 | 70B | 671B |
| 每 token 激活参数 | 70B（全部） | ~37B（top-8 experts + shared） |
| 训练 FLOPs | 高 | 与同等激活参数的稠密模型相当 |
| 显存需求 | 总参数 × 2B（BF16） | 总参数 × 2B，但可按专家分片 |
| 知识容量 | 受限于参数量 | 远大于同 FLOPs 稠密模型 |

**关键知识点**

- MoE 的核心优势：参数量（容量）和计算量（FLOPs）解耦，用少量计算获得大模型的知识容量
- DeepSeek-V3 使用 256 routed experts + 1 shared expert，top-8 路由，Expert Parallelism 跨 GPU 分布
- 通信开销是 MoE 的主要工程挑战，All-to-All 通信量与 top-K 值和专家分布直接相关

**延伸阅读**

- Fedus et al., "Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity" (2022) — https://arxiv.org/abs/2101.03961
- DeepSeek-AI, "DeepSeek-V3 Technical Report" (2024) — https://arxiv.org/abs/2412.19437
- Lepikhin et al., "GShard: Scaling Giant Models with Conditional Computation" (2021) — https://arxiv.org/abs/2006.16668

</details>

---

### Q27：MoE 路由机制中 Top-K 选择与 Load Balancing Loss 的作用？

<details>
<summary>参考答案</summary>

**路由器（Router）的工作机制**：MoE 层中的路由器通常是一个简单的线性层 `W_gate`，它将每个 token 的隐藏状态 h 映射为 N 个专家的得分向量 `s = W_gate · h`，然后通过 Top-K 选择激活得分最高的 K 个专家。被选中专家的输出按 softmax 归一化后的权重加权求和：

```
output = Σ_{i ∈ TopK} softmax(s_i) · Expert_i(x)
```

**Top-K 选择的意义**：K 值决定了稀疏程度和质量之间的平衡。K=1（Switch Transformer）最稀疏，计算最少但路由不稳定；K=2（GShard、DeepSeek-V3）是主流选择，兼顾稀疏性和稳定性；K 更大则趋向稠密，削弱 MoE 的计算优势。

**专家坍塌问题（Expert Collapse）**：没有约束时，路由器倾向于将大部分 token 发送给少数"赢家"专家（马太效应），导致其他专家得不到训练、逐渐退化，最终整个 MoE 层退化为一两个活跃专家，浪费大量参数。

**Load Balancing Loss（负载均衡损失）**：为解决专家坍塌，引入辅助损失函数：

```
L_balance = α · N · Σᵢ (fᵢ · Pᵢ)
```

其中：
- N = 专家总数
- fᵢ = 被路由到专家 i 的 token 比例（实际负载）
- Pᵢ = 路由器分配给专家 i 的平均概率（路由概率）
- α = 平衡系数（通常 0.01）

直觉：当所有专家负载均匀时，fᵢ = Pᵢ = 1/N，此时 L_balance 最小。若某个专家同时拥有高 fᵢ 和高 Pᵢ，惩罚急剧增大，迫使路由器分散负载。

**容量因子（Capacity Factor）与 Token 丢弃**：每个专家设定容量上限 C = CF × (tokens / N)，其中 CF（容量因子）通常 1.0~1.5。超过容量的 token 被丢弃（直接跳过 MoE 层，使用残差连接），防止单个专家过载。CF 过小导致 token 丢弃率高，CF 过大浪费内存。

**DeepSeek-V3 的优化**：传统 Load Balancing Loss 在 token 级别均衡，但跨 GPU 的 All-to-All 通信更关心 device 级别均衡。DeepSeek-V3 引入 device-level load balancing：

```
L_device = α · D · Σⱼ (f'ⱼ · P'ⱼ)
```

其中 f'ⱼ 和 P'ⱼ 是第 j 张 GPU 上所有专家的聚合负载和概率。这确保每张 GPU 接收到的 token 数量大致相同，减少 All-to-All 通信中的等待时间。同时，DeepSeek-V3 取消了 token 丢弃策略，改用无辅助损失（auxiliary-loss-free）的 bias 调节方式微调路由偏好。

**关键知识点**

- 路由器 = 线性层 + Top-K + Softmax 归一化，结构简单但训练难度大
- Load Balancing Loss 通过惩罚 fᵢ · Pᵢ 的乘积防止专家坍塌，α 通常取 0.01
- DeepSeek-V3 的 device-level 均衡和无辅助损失路由是当前 MoE 训练的最新进展
- 容量因子控制专家接受 token 的上限，过小丢 token，过大浪费内存

**延伸阅读**

- Fedus et al., "Switch Transformers" (2022) — https://arxiv.org/abs/2101.03961
- Zoph et al., "ST-MoE: Designing Stable and Transferable Sparse Expert Models" (2022) — https://arxiv.org/abs/2202.08906
- DeepSeek-AI, "DeepSeek-V3 Technical Report" (2024) — https://arxiv.org/abs/2412.19437

</details>

---

### Q28：推理模型（o1/R1）的 Chain-of-Thought 训练与 test-time compute scaling？

<details>
<summary>参考答案</summary>

**推理模型的核心范式转变**：传统 LLM 通过扩大预训练规模（更多参数、更多数据）提升能力，这是 **train-time compute scaling**。而 o1/R1 代表的推理模型引入了一个新维度——**test-time compute scaling**：在推理阶段投入更多计算（让模型"思考更久"）来提升回答质量，尤其在数学、编程、逻辑推理等需要多步推理的任务上效果显著。

**Chain-of-Thought（CoT）训练方法**：

1. **监督微调阶段**：用人类标注的详细推理过程（step-by-step reasoning traces）微调基础模型，让模型学会"展示思考过程"的格式。

2. **强化学习阶段（GRPO/PPO）**：DeepSeek-R1 使用 Group Relative Policy Optimization（GRPO）进行强化学习训练。与传统 RLHF 不同，GRPO 不依赖 Critic 模型，而是从同一 prompt 采样一组回答，用组内相对排名作为奖励信号。奖励函数可以是结果正确性（数学答案是否正确）或过程奖励（Process Reward Model，PRM）。

3. **"Aha moment"**：训练过程中模型自发学会了重新审视（"Wait, let me reconsider..."）、自我纠错、多角度验证等推理策略——这些行为不是人为设计的，而是通过 RL 激励自然涌现的。

**Test-time Compute Scaling 的原理**：

```
传统 LLM：质量 ∝ f(训练计算量)          → 训练阶段投入
推理模型：质量 ∝ f(训练计算量, 推理计算量) → 推理阶段也可投入
```

具体机制：模型在特殊的 `<think>` 标签内生成长篇推理过程（可能数千 token），通过多步推演、验证、回溯，最终给出高质量答案。推理 token 数量越多（thinking budget 越大），在复杂问题上的准确率越高。

**DeepSeek-R1 的蒸馏策略**：大型 R1 模型（671B MoE）的推理能力可以通过蒸馏（Distillation）迁移到小模型。用 R1 生成的推理 traces 作为训练数据，微调 Qwen-1.5B/7B/32B 等小模型，在数学推理任务上甚至超越未经推理训练的同规模甚至更大规模模型。

**代价与局限**：

| 维度 | 传统 LLM | 推理模型（o1/R1） |
|------|---------|----------------|
| 推理延迟 | 低（直接输出） | 高（先思考再回答） |
| 推理成本 | Token 价格 × 输出长度 | Token 价格 × (思考 + 输出)长度 |
| 适用场景 | 通用对话、简单 QA | 数学、编程、复杂推理 |
| 简单任务 | 高效 | 可能过度思考，反而慢且贵 |

**关键知识点**

- 推理模型 = 基础 LLM + CoT 数据 SFT + 强化学习（GRPO/PPO），核心是 RL 阶段
- Test-time compute scaling：推理时更多计算 → 更好结果，与 train-time scaling 互补
- DeepSeek-R1 证明推理能力可蒸馏到小模型，且 GRPO 不需要 Critic 模型
- 简单任务不需要推理模型，test-time scaling 在简单问题上收益递减

**追问链**

1. **如何控制 thinking budget？** 可通过限制 `<think>` 段的 max_tokens、early stopping（检测到"因此答案是…"时截断）、或训练时引入 length penalty 来控制。
2. **Test-time scaling 何时不再有效？** 当问题所需知识不在模型参数中（纯知识查询而非推理），或问题本身无确定性答案时，更多思考不会带来质量提升。
3. **GRPO 相比 PPO 的优势？** GRPO 无需 Critic 模型，节省约 50% 显存；用组内相对排名代替绝对 value 估计，训练更稳定。

**延伸阅读**

- DeepSeek-AI, "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning" (2025) — https://arxiv.org/abs/2501.12948
- OpenAI, "Learning to Reason with LLMs" (o1 Blog, 2024) — https://openai.com/index/learning-to-reason-with-llms/
- Snell et al., "Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters" (2024) — https://arxiv.org/abs/2408.03314

</details>

---

### Q29：RoPE 长度外推技术（NTK-aware、YaRN、Dynamic NTK）的原理对比？

<details>
<summary>参考答案</summary>

**问题背景**：RoPE（Rotary Position Embedding）通过旋转矩阵编码位置信息，其频率基为 θᵢ = base^(-2i/d)（默认 base=10000）。模型在训练长度 L_train 内的位置编码是充分学习的，但超过 L_train 后旋转角度进入未见区域，注意力得分崩塌，表现为困惑度（PPL）急剧上升。

**基线方法：Position Interpolation（PI）**

Chen et al. (2023) 提出最朴素的外推方法：将位置索引线性缩放到训练范围内。即将位置 m 替换为 m × (L_train / L_target)，使所有旋转角度落在训练区间 [0, L_train] 内。

缺点：高频分量被过度压缩，丢失相邻 token 的细粒度位置区分能力。

**NTK-aware Scaling（Code Llama 使用）**

核心思想：不缩放位置索引，而是**修改旋转频率基数** base：

```python
# NTK-aware RoPE 缩放
scale = L_target / L_train
base_new = base * (scale ** (d / (d - 2)))

# 原始 RoPE 频率
# theta_i = base^(-2i/d)
# NTK-aware 频率
# theta_i_new = base_new^(-2i/d)
```

直觉：增大 base 使低频分量（远距离信息）的旋转变慢，保留更多位置分辨能力；而高频分量（近距离信息）受影响较小。相当于在频域上做非均匀拉伸——低频拉伸多，高频拉伸少——符合信息论直觉。

**YaRN（Yet another RoPE extensioN）**

YaRN（Peng et al., 2023）在 NTK-aware 基础上做了三项改进：

1. **NTK-by-parts**：将频率维度分为三个区间——高频维度不缩放（保留近距离精度），中频维度部分缩放，低频维度完全缩放（NTK-aware），实现更精细的频率控制。

2. **注意力缩放（Attention Scaling）**：对注意力 logits 乘以温度因子 t = 0.1 × ln(s) + 1（s 为缩放因子），补偿因长序列导致的注意力分布熵增大。

3. **温度校正**：针对不同频率维度应用不同的插值系数，避免一刀切。

YaRN 在 128K 长度外推上效果优于 PI 和 NTK-aware，是目前最广泛使用的 RoPE 扩展方法之一。

**Dynamic NTK**

动态 NTK 不使用固定的缩放因子，而是根据当前实际输入长度动态调整 base：

```python
def dynamic_ntk_rope(seq_len, base=10000, d=128, L_train=4096):
    if seq_len <= L_train:
        # 训练长度内，使用原始 base
        return base
    else:
        # 超出训练长度，动态缩放 base
        scale = seq_len / L_train
        base_new = base * (scale ** (d / (d - 2)))
        return base_new
```

优势：短序列不受影响（保持原始精度），长序列按需缩放。无需预设最大长度。

**方法对比**：

| 方法 | 修改对象 | 是否需微调 | 外推能力 | 短序列影响 | 代表模型 |
|------|---------|-----------|---------|-----------|---------|
| Position Interpolation | 位置索引 | 需少量微调 | 中等（~4x） | 高频分辨率下降 | — |
| NTK-aware | 频率 base | 可免微调 | 良好（~8x） | 轻微 | Code Llama |
| YaRN | 频率 base + 注意力 | 需少量微调 | 优秀（~32x） | 极小 | InternLM2、Qwen |
| Dynamic NTK | 频率 base（动态） | 可免微调 | 良好（按需） | 无 | 多种开源模型 |

**关键知识点**

- RoPE 外推的核心挑战：旋转角度超出训练分布 → 注意力得分失真
- NTK-aware 修改 base 而非位置索引，保留高频分辨率，是外推的基础方法
- YaRN 在 NTK 基础上加入分维度缩放和注意力温度校正，效果最佳但需微调
- Dynamic NTK 无需预设目标长度，实际部署最灵活

**追问链**

1. **为什么 PI 的高频压缩是问题？** 相邻 token（距离 1-2）的位置区分主要靠高频分量，压缩后 cos(θ × 1) 和 cos(θ × 2) 的差异缩小，模型无法有效区分近距离位置。
2. **YaRN 的 NTK-by-parts 如何划分频率区间？** 根据维度 i 对应的波长 λᵢ = 2π × base^(2i/d) 与 L_train 的比值，波长远小于 L_train 的维度归为高频（不缩放），远大于 L_train 的归为低频（完全缩放）。
3. **InternLM2 如何实现 1M 上下文？** 渐进式训练（4K → 32K → 256K → 1M），每阶段使用 YaRN 扩展 + 长文本数据继续训练。

**延伸阅读**

- Chen et al., "Extending Context Window of Large Language Models via Positional Interpolation" (2023) — https://arxiv.org/abs/2306.15595
- Peng et al., "YaRN: Efficient Context Window Extension of Large Language Models" (2023) — https://arxiv.org/abs/2309.00071
- Reddit/bloc97, "NTK-Aware Scaled RoPE" (2023) — https://www.reddit.com/r/LocalLLaMA/comments/14lz7j5/

</details>

---

### Q30：长上下文技术：Sliding Window Attention 与 ALiBi 的工程取舍？

<details>
<summary>参考答案</summary>

**Sliding Window Attention（SWA，滑动窗口注意力）**

以 Mistral 7B 为代表，SWA 限制每个 token 只关注最近的 W 个 token（如 W=4096），超出窗口的 token 不参与注意力计算：

```
Attention_mask(i, j) = 1 if |i - j| ≤ W else 0
```

**计算复杂度**从 O(n²) 降为 O(n × W)，对长序列（n >> W）节省巨大。

多层叠加后信息可间接传播：L 层 SWA 的理论感受野为 L × W（如 32 层 × 4096 = 128K），高层的间接注意力覆盖更远距离。配合少量全局注意力层（如 Longformer 的 global tokens）可弥补局部视野的局限。

SWA 的工程优势在于**恒定的每 token 内存开销**：KV Cache 只需保留最近 W 个 token 的 KV 对，支持流式生成（streaming inference），非常适合长对话和实时场景。

**ALiBi（Attention with Linear Biases）**

ALiBi 不修改注意力范围，而是在完整注意力得分上加一个与距离成正比的负偏置：

```
Score(i, j) = qᵢkⱼᵀ/√dₖ - m × |i - j|
```

其中 m 为每个 head 的固定斜率。ALiBi 的核心优势是**训短推长（Train Short, Test Long）**：在 1024 token 上训练的模型可以零样本外推到 2048+ token，因为线性偏置的归纳偏置在更长序列上仍然成立。ALiBi 无需位置编码参数，实现极其简单。

**工程取舍对比**：

| 维度 | Sliding Window Attention | ALiBi |
|------|------------------------|-------|
| 注意力范围 | 硬截断：只看最近 W 个 token | 软衰减：所有 token 可见，远处权重小 |
| 计算复杂度 | O(n × W)，与 n 线性 | O(n²)，全注意力 |
| 内存（KV Cache） | O(W)，恒定，支持流式 | O(n)，随序列增长 |
| 长度外推 | 受限于感受野 L × W | 天然支持，零样本外推 |
| 远距离依赖 | 需多层间接传播，可能丢失 | 理论可达但权重衰减快 |
| 实现复杂度 | 需定制 attention mask 和 KV Cache 管理 | 仅需加一个偏置矩阵，极简 |
| 代表模型 | Mistral、Mixtral | MPT、BLOOM |
| 适用场景 | 长对话、流式推理、延迟敏感 | 训练资源有限、需要灵活外推 |

**工程选型建议**：

- **延迟敏感 + 流式生成**：选 SWA，恒定内存、可预测延迟
- **训练短推理长**：选 ALiBi，无需长序列训练数据
- **实际趋势**：主流模型（Llama-3、Qwen-2、DeepSeek-V3）选择 RoPE + YaRN 扩展，兼顾全注意力的质量和外推能力，SWA 和 ALiBi 更多作为辅助技术

**关键知识点**

- SWA 用硬截断实现 O(n×W) 复杂度和恒定 KV Cache，适合流式场景
- ALiBi 用软偏置实现训短推长，但计算仍为 O(n²)
- 两者均非主流选择（RoPE+扩展方案更常见），但在特定场景有不可替代的优势
- 多层 SWA 的间接感受野 = 层数 × 窗口大小

**延伸阅读**

- Jiang et al., "Mistral 7B" (2023) — https://arxiv.org/abs/2310.06825
- Press et al., "Train Short, Test Long: Attention with Linear Biases Enables Input Length Extrapolation" (2022) — https://arxiv.org/abs/2108.12409
- Beltagy et al., "Longformer: The Long-Document Transformer" (2020) — https://arxiv.org/abs/2004.05150

</details>

---

## ⭐⭐⭐ 高级题·续（Q28–Q29, Q31–Q32, Q34–Q35）

### Q31：多模态 LLM 的视觉编码器融合策略（Cross-Attention vs Linear Projection）？

<details>
<summary>参考答案</summary>

**多模态 LLM 的核心架构问题**：如何将视觉信息（图像/视频）的特征融入语言模型的文本表示空间。这一"融合策略"直接决定了模型的视觉理解能力、参数效率和训练难度。

**视觉编码器**：几乎所有多模态 LLM 使用预训练的视觉编码器（CLIP ViT、SigLIP、InternViT 等）将图像切分为 patch 并编码为一组 visual tokens（如 224×224 图像 → 14×14 = 196 个 patch tokens）。

**融合策略一：Linear Projection（线性投影）**

以 LLaVA 为代表，使用一个简单的 MLP（通常 2 层线性层 + GELU 激活）将视觉 token 直接映射到 LLM 的 embedding 空间，然后与文本 token 拼接后送入 LLM：

```
架构示意（LLaVA 风格）：

Image → [ViT Encoder] → visual tokens (196×d_v)
                              ↓
                        [MLP Projector] → projected tokens (196×d_llm)
                              ↓
Text tokens ← 拼接 → [v1, v2, ..., v196, t1, t2, ..., tn]
                              ↓
                        [LLM Decoder] → output
```

优势：实现极简，训练高效（只需训练 projector + 微调 LLM），视觉 token 与文本 token 统一在同一序列中，LLM 的 self-attention 自然处理跨模态交互。

劣势：196+ 个视觉 token 直接占用 LLM 上下文窗口，高分辨率图像（如 768×768 → 2304 个 patch）或视频（多帧）会消耗大量上下文。

**融合策略二：Cross-Attention（交叉注意力）**

以 Flamingo 为代表，在 LLM 的 Transformer 层中插入**交叉注意力层**（gated cross-attention），文本 token 作为 Query，视觉 token 作为 Key/Value：

```
架构示意（Flamingo 风格）：

Image → [ViT Encoder] → visual tokens (作为 Cross-Attn 的 K, V)
                                            ↓
Text tokens → [Self-Attn] → [Cross-Attn] → [FFN] → output
                              Q: text        (交叉注意力层)
                              K,V: visual    每隔 N 层插入一次
```

优势：视觉 token 不占用 LLM 上下文窗口长度，LLM 通过交叉注意力"按需查询"视觉信息；更适合处理多图/视频输入。

劣势：需修改 LLM 架构（插入新层），参数量增加，预训练 LLM 的权重与新 cross-attention 层的协调需要仔细设计。

**融合策略三：Perceiver Resampler（感知器重采样）**

用固定数量的可学习 query tokens（如 64 或 128 个）通过交叉注意力从视觉 token 中提取信息，**将可变数量的视觉 token 压缩为固定数量**的视觉摘要：

```
Visual tokens (196个) → [Perceiver Resampler] → compressed tokens (64个)
                         Q: learnable queries
                         K,V: visual tokens
```

Qwen-VL 和 InternVL 使用类似的 visual token 压缩策略。优势：控制 LLM 输入中视觉 token 的数量，平衡信息保留与计算效率。

**策略对比**：

| 维度 | Linear Projection | Cross-Attention | Perceiver Resampler |
|------|-------------------|----------------|-------------------|
| 代表模型 | LLaVA、LLaVA-NeXT | Flamingo、Qwen-VL v1 | Qwen-VL、InternVL |
| LLM 架构修改 | 无 | 需插入 cross-attn 层 | 无（压缩后拼接） |
| 视觉 token 数 | 与 patch 数相同 | 不占上下文 | 固定数量（可控） |
| 训练复杂度 | 低 | 高 | 中 |
| 视觉细节保留 | 高（全量 token） | 中（按需查询） | 中（压缩损失） |
| 多图/视频支持 | 上下文压力大 | 天然支持 | 较好 |

**关键知识点**

- Linear Projection 最简单高效，是当前开源多模态 LLM 的主流选择（LLaVA 系列）
- Cross-Attention 不占上下文窗口，适合多图/视频场景，但需修改 LLM 架构
- Perceiver Resampler 是折中方案，用固定 query 压缩视觉信息
- 高分辨率处理（如 LLaVA-NeXT 的动态分辨率）是当前多模态 LLM 的前沿方向

**追问链**

1. **为什么 LLaVA 的简单 MLP Projector 效果就很好？** 因为 CLIP ViT 已经在图文对比学习中对齐了视觉和语言表示空间，MLP 只需做一个"最后一公里"的空间映射。
2. **视频理解中视觉 token 爆炸怎么解决？** 关键帧采样（每秒 1-2 帧）、时间维度 pooling、或 Perceiver 风格的压缩。LLaVA-Video 对每帧采样后做 2×2 spatial pooling 将 token 数降至 1/4。
3. **InternVL2 的 Dynamic Resolution 如何工作？** 将高分辨率图像切分为多个 448×448 子图 + 一个缩略图，每个子图独立过 ViT，所有 patch token 拼接后送入 LLM。

**延伸阅读**

- Liu et al., "Visual Instruction Tuning" (LLaVA, 2023) — https://arxiv.org/abs/2304.08485
- Alayrac et al., "Flamingo: a Visual Language Model for Few-Shot Learning" (2022) — https://arxiv.org/abs/2204.14198
- Bai et al., "Qwen-VL: A Versatile Vision-Language Model" (2023) — https://arxiv.org/abs/2308.12966

</details>

---

### Q32：KV Cache 优化：MLA 低秩压缩与 GQA/MQA 的对比？

<details>
<summary>参考答案</summary>

**问题背景**：LLM 推理时的 KV Cache 是内存瓶颈。以 Llama-2-70B 为例，每个 token 的 KV Cache 占 80 层 × 8 KV heads × 128 dim × 2(K+V) × 2 bytes = 320KB，batch_size=32、序列长度 4096 时 KV Cache 总占用约 40GB，可能超过模型权重本身。

**MHA（Multi-Head Attention，原始方案）**

每个注意力头有独立的 K、V 投影，KV Cache 存储量 = n_heads × d_head × 2 × seq_len。这是基线方案，内存占用最大。

**MQA（Multi-Query Attention，Shazeer 2019）**

所有 Query heads 共享**同一组** K 和 V 投影。KV Cache 缩减为 1/n_heads，如 64 头的模型 KV Cache 减少到 1/64。

```
MHA: Q_heads=64, K_heads=64, V_heads=64  →  KV Cache = 64 × d × 2
MQA: Q_heads=64, K_heads=1,  V_heads=1   →  KV Cache = 1 × d × 2
```

代价：模型质量有一定损失（K/V 共享过于激进），尤其在需要细粒度区分的任务上。

**GQA（Grouped Query Attention，Ainslie et al. 2023）**

折中方案：将 Query heads 分组，每组共享一组 K/V。Llama-2-70B 使用 GQA，64 个 Query heads 分为 8 组，每组 8 个 Q heads 共享 1 组 KV。

```
GQA: Q_heads=64, KV_groups=8  →  KV Cache = 8 × d × 2
```

KV Cache 减少 8 倍，质量几乎不受影响。GQA 已成为当前大模型的标配（Llama-2/3、Qwen-2 等）。

**MLA（Multi-head Latent Attention，DeepSeek-V2/V3）**

MLA 采用完全不同的思路——**低秩联合压缩**：不是减少 KV 头数，而是将所有头的 KV 联合压缩到一个低维潜在向量中。

核心公式：

```
# 标准 MHA（每个头独立存储 KV）
K_i = W_K_i · h,  V_i = W_V_i · h    →  存储: n_heads × d_head × 2

# MLA 压缩
c = W_down · h                        →  存储: d_c（远小于 n_heads × d_head × 2）
K_i = W_UK_i · c,  V_i = W_UV_i · c   →  推理时从 c 恢复

# 关键优化：吸收 W_UK 到注意力计算中
# Q_i · K_i^T = Q_i · (W_UK_i · c)^T = (Q_i · W_UK_i^T) · c^T = Q'_i · c^T
# 无需显式恢复 K/V，直接用 c 计算注意力
```

MLA 的精妙之处：将上投影矩阵 W_UK 和 W_UV "吸收"到 Q 的投影和输出投影中，推理时**只需缓存低维的 c 向量**，不需要显式解压回完整的 KV。DeepSeek-V2 中 d_c=512 而 n_heads × d_head = 16384，压缩比高达 32 倍。

**KV Cache 内存对比**（假设 d_model=8192，n_heads=64，d_head=128）：

| 方案 | 每 token KV Cache 大小 | 相对 MHA |
|------|----------------------|---------|
| MHA | 64 × 128 × 2 = 16384 | 1.0× |
| GQA（8 组） | 8 × 128 × 2 = 2048 | 0.125× |
| MQA | 1 × 128 × 2 = 256 | 0.016× |
| MLA（d_c=512） | 512 | 0.031× |

MLA 在压缩比上接近 MQA，但质量远优于 MQA（因为低秩压缩保留了头间差异的主要信息），甚至在某些基准上超过 GQA。

**关键知识点**

- MQA/GQA 通过减少 KV 头数来降低 Cache：MQA 最激进（1头），GQA 折中（分组）
- MLA 通过低秩联合压缩所有头的 KV 到潜在向量 c，压缩比接近 MQA 但质量更好
- MLA 的核心技巧：将解压矩阵吸收到 QKV 投影中，推理时直接用 c 计算，无显式解压
- GQA 是当前工业界标配（Llama/Qwen），MLA 是 DeepSeek 的创新方案

**追问链**

1. **MLA 的吸收技巧为什么能工作？** 因为注意力计算 QKᵀ 是双线性的，W_UK 可被合并到 Q 的投影矩阵中：(Q·W_Q) · (c·W_UK)ᵀ = Q·(W_Q · W_UKᵀ)·cᵀ = Q'·cᵀ，只需预计算 W_Q · W_UKᵀ。
2. **MLA 增加了训练成本吗？** 训练时需要完整的 KV 用于反向传播，但前向传播中 c 的计算是额外开销。总体训练成本增加约 5-10%，但推理时 KV Cache 大幅缩减。
3. **GQA 的头数怎么选？** 经验值：Llama-2-70B 用 8 组（64/8），Llama-3-8B 用 8 组（32/4）。通常 KV 头数为 Q 头数的 1/4~1/8，在质量和内存之间取平衡。

**延伸阅读**

- DeepSeek-AI, "DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model" (2024) — https://arxiv.org/abs/2405.04434
- Ainslie et al., "GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints" (2023) — https://arxiv.org/abs/2305.13245
- Shazeer, "Fast Transformer Decoding: One Write-Head is All You Need" (MQA, 2019) — https://arxiv.org/abs/1911.02150

</details>

---

### Q33：Scaling Laws 的实践意义：Chinchilla-optimal 训练与 compute-optimal 预算分配？

<details>
<summary>参考答案</summary>

**Scaling Laws 的基本形式**：LLM 的测试损失 L 可以用模型参数量 N、训练数据量 D、计算量 C 的幂律函数预测：

```
L(N) ≈ A / N^α        （固定充足数据）
L(D) ≈ B / D^β        （固定模型大小）
L(C) ≈ C_0 / C^γ      （最优分配 N 和 D）
```

**Kaplan Scaling Law（OpenAI, 2020）**

Kaplan 等人首次系统研究了 N、D、C 与损失的幂律关系，得出一个关键结论：**在固定计算预算下，应优先增大模型参数量 N，数据量 D 的增长可以较慢**。具体建议：当计算量增加 10×，N 应增大 5.5×，D 只需增大 1.8×。

这一结论直接影响了 GPT-3（175B 参数，仅用 300B tokens 训练）的设计决策：巨大模型 + 相对少的数据。

**Chinchilla Scaling Law（Hoffmann et al., 2022）**

DeepMind 的 Chinchilla 论文挑战了 Kaplan 的结论，通过更大范围的实验发现：**最优的 N 和 D 应以大致相同的速率增长**。即 compute-optimal 训练应满足：

```
D_optimal ≈ 20 × N
```

70B 参数模型应使用约 1.4T tokens 训练。Chinchilla（70B, 1.4T tokens）在相同计算预算下击败了 Gopher（280B, 300B tokens），证明 Kaplan 时代的大模型训练严重数据不足（under-trained）。

**实践影响**：

| 决策 | Kaplan 时代 | Chinchilla 时代 | 当前实践 |
|------|-----------|---------------|---------|
| 模型大小 vs 数据量 | 优先加大模型 | N 和 D 同步增长 | 数据量远超 Chinchilla 建议 |
| GPT-3 | 175B, 300B tokens | — | — |
| Chinchilla | — | 70B, 1.4T tokens | — |
| Llama-3 | — | — | 8B, 15T tokens（≈1875×N） |

**超越 Chinchilla-optimal 的趋势**：实践中发现推理成本（inference cost）往往远超训练成本。一个更小但训练更充分的模型（over-trained）在部署时节省更多。Llama-3-8B 使用 15T tokens 训练（远超 Chinchilla 建议的 160B tokens），因为训练多花的计算可以被部署时的推理成本节省所抵消。这形成了新的 **inference-optimal scaling**。

**Compute-Optimal 预算分配示例**：

假设有 10²⁴ FLOPs 的训练预算：
- Kaplan 建议：~300B 参数，~500B tokens
- Chinchilla 建议：~67B 参数，~1.34T tokens
- Inference-optimal：~10B 参数，~10T tokens（如果推理量大）

**涌现能力（Emergent Abilities）的争议**：

Wei et al. (2022) 发现某些能力（如 Chain-of-Thought 推理、多步算术）在模型规模达到某个阈值后突然出现。但 Schaeffer et al. (2023) 反驳称"涌现"可能是评估指标的假象——使用连续指标（如 Brier Score）而非离散指标（如 Exact Match）时，能力增长是平滑的。这场争论的实践意义：不应盲目期待"只要模型够大就会涌现新能力"，而需要更细致的 scaling 实验。

**关键知识点**

- Kaplan 建议优先增大 N，Chinchilla 纠正为 N 和 D 应同步增长（D ≈ 20N）
- 当前实践已超越 Chinchilla-optimal，向 inference-optimal 演进（小模型 + 大数据）
- Scaling Laws 的核心价值：用小实验预测大模型性能，指导计算预算分配
- 涌现能力是否"真实"仍有争议，影响 scaling 投资决策

**延伸阅读**

- Kaplan et al., "Scaling Laws for Neural Language Models" (2020) — https://arxiv.org/abs/2001.08361
- Hoffmann et al., "Training Compute-Optimal Large Language Models" (Chinchilla, 2022) — https://arxiv.org/abs/2203.15556
- Schaeffer et al., "Are Emergent Abilities of Large Language Models a Mirage?" (2023) — https://arxiv.org/abs/2304.15004

</details>

---

### Q34：场景题：设计一个多模态理解系统（图文+视频），需考虑哪些架构决策？

<details>
<summary>参考答案</summary>

**需求分析**：构建一个能同时理解图像、文本和视频的多模态大模型系统，支持图文问答（VQA）、视频描述（Video Captioning）、跨模态检索等任务。

**架构决策一：视觉编码器选型**

| 选项 | 优势 | 劣势 | 代表 |
|------|------|------|------|
| CLIP ViT-L/14 | 图文对齐好，生态成熟 | 分辨率受限（224/336） | LLaVA |
| SigLIP SO400M | 比 CLIP 更好的分类性能 | 多语言支持弱 | PaliGemma |
| InternViT-6B | 高分辨率、强视觉理解 | 参数大，推理慢 | InternVL2 |

对于需要细粒度视觉理解（如 OCR、图表解读）的场景，应选择支持高分辨率的编码器（如 InternViT 的动态分辨率或 LLaVA-NeXT 的 AnyRes 策略）。

**架构决策二：视频处理策略**

视频的核心挑战是**时序信息的高效表示**——1 分钟 30fps 视频有 1800 帧，每帧 196 个 patch token，总计 352800 个 token，远超任何 LLM 的上下文窗口。

解决方案：

1. **均匀采样（Uniform Sampling）**：等间隔采样 N 帧（如每秒 1 帧），简单但可能错过关键变化
2. **关键帧提取（Keyframe Extraction）**：基于帧差/语义变化提取信息密度高的帧，减少冗余
3. **时间注意力（Temporal Attention）**：在 ViT 输出上加时间维度的 attention 层（如 TimeSformer），建模帧间关系
4. **时空压缩**：对每帧的 patch tokens 做 spatial pooling（如 2×2 → 1），再做 temporal pooling，将 token 数压缩到可控范围

```python
# 视频帧采样与 Token 压缩示例
def process_video(video_frames, max_frames=64, spatial_pool=2):
    """
    video_frames: (T, C, H, W) 原始视频帧
    返回: (N_tokens, d_model) 压缩后的视觉 tokens
    """
    # 1. 均匀采样到 max_frames 帧
    T = video_frames.shape[0]
    indices = torch.linspace(0, T - 1, max_frames).long()
    sampled = video_frames[indices]           # (64, C, H, W)

    # 2. 视觉编码
    patch_tokens = vit_encoder(sampled)       # (64, 196, d_v)

    # 3. 空间压缩: 2×2 pooling → 每帧 49 个 token
    B, N, D = patch_tokens.shape
    h = w = int(N ** 0.5)                     # 14
    tokens_2d = patch_tokens.view(B, h, w, D)
    pooled = F.avg_pool2d(
        tokens_2d.permute(0, 3, 1, 2),
        kernel_size=spatial_pool
    )                                          # (64, d_v, 7, 7)
    spatial_compressed = pooled.flatten(2).permute(0, 2, 1)  # (64, 49, d_v)

    # 4. 投影到 LLM 空间
    projected = mlp_projector(spatial_compressed)  # (64, 49, d_llm)

    # 5. 展平为序列: 64 × 49 = 3136 个 token
    return projected.reshape(-1, projected.shape[-1])
```

**架构决策三：模态融合方式**

结合 Q31 的分析，推荐方案：
- **图像**：Linear Projection（简单高效，LLaVA 风格）
- **视频**：Perceiver Resampler 或 Q-Former 压缩后拼接（控制 token 数量）
- 如果需要同时处理多图 + 视频，考虑 Cross-Attention 方案避免上下文爆炸

**架构决策四：LLM 骨干选型**

| 考量 | 建议 |
|------|------|
| 开源可控 | Qwen-2.5、Llama-3.1、InternLM2 |
| 长上下文 | 支持 128K+ 的模型（视频场景必需） |
| 推理能力 | 如需复杂视觉推理，考虑 R1 蒸馏模型 |

**架构决策五：训练策略**

三阶段训练：
1. **预训练阶段**：冻结 ViT 和 LLM，只训练 projector（图文对齐）
2. **指令微调阶段**：解冻 LLM，用多模态指令数据训练（图文+视频混合）
3. **偏好对齐阶段**：用 DPO/RLHF 减少幻觉（如减少描述不存在的物体）

**架构决策六：评估基准**

| 任务类型 | 基准 | 说明 |
|---------|------|------|
| 图文理解 | MMBench、MME、SEED-Bench | 综合多模态理解 |
| OCR/文档 | DocVQA、ChartQA | 细粒度视觉 |
| 视频理解 | Video-MME、MVBench | 视频时序理解 |
| 幻觉评估 | POPE、HallusionBench | 忠实性评估 |

**关键知识点**

- 视频处理的核心是 token 数量控制：采样 + 空间压缩 + 时间压缩
- 视觉编码器选型需匹配任务精度需求（通用理解 vs OCR/细粒度）
- 三阶段训练（对齐→指令→偏好）是多模态 LLM 的标准训练范式
- 融合策略无绝对最优，需根据模态数量和延迟要求权衡

**追问链**

1. **如何处理超长视频（1小时+）？** 分段处理 + 层级摘要：先对每个片段（如 1 分钟）生成摘要 token，再将摘要 token 送入 LLM 做全局理解。或使用 Memory Bank 机制缓存历史帧信息。
2. **多模态幻觉如何缓解？** 数据层面：高质量负样本训练；解码层面：Visual Contrastive Decoding（VCD）；评估层面：POPE 协议检测物体幻觉率。
3. **音频模态如何加入？** 使用 Whisper 编码器提取音频特征，与视觉 token 一起做 early fusion 或 late fusion。Qwen-Audio 证明了音频-文本-视觉三模态融合的可行性。

**延伸阅读**

- Liu et al., "LLaVA-NeXT: Improved Reasoning, OCR, and World Knowledge" (2024) — https://llava-vl.github.io/blog/2024-01-30-llava-next/
- Lin et al., "Video-LLaVA: Learning United Visual Representation by Alignment Before Projection" (2023) — https://arxiv.org/abs/2311.10122
- Chen et al., "InternVL: Scaling up Vision Foundation Models and Aligning for Generic Visual-Linguistic Tasks" (2024) — https://arxiv.org/abs/2312.14238

</details>

---

### Q35：场景题：100B 参数模型的低成本部署方案设计？

<details>
<summary>参考答案</summary>

**需求场景**：将一个 100B 参数的 LLM 部署上线，要求在控制成本的前提下满足生产级 SLO（如 TTFT < 2s，TPOT < 50ms，QPS ≥ 10）。

**Step 1：模型显存估算**

```
BF16 权重: 100B × 2 bytes = 200 GB
INT4 量化: 100B × 0.5 bytes = 50 GB
INT4 + 量化元数据: ≈ 55-60 GB

KV Cache（per request, 4K context, GQA-8）:
  80 layers × 8 KV heads × 128 dim × 2(K+V) × 2 bytes × 4096 tokens ≈ 2.6 GB
Batch=32 时 KV Cache: ≈ 83 GB
```

**Step 2：量化方案选择**

| 方案 | 权重大小 | 质量损失 | 速度 | 推荐场景 |
|------|---------|---------|------|---------|
| BF16（无量化） | 200 GB | 无 | 基准 | 质量最优先 |
| GPTQ INT4 | ~55 GB | 轻微（~0.5% MMLU） | 快 | 批量推理 |
| AWQ INT4 | ~55 GB | 轻微 | 快 | 通用推荐 |
| GGUF Q4_K_M | ~58 GB | 轻微 | 中 | CPU+GPU 混合 |
| FP8 | ~100 GB | 极小 | 快（H100） | H100/MI300X |

推荐 **AWQ INT4**：量化后约 55GB，质量损失可控，且被 vLLM/TensorRT-LLM 原生支持。

**Step 3：硬件配置方案**

| 方案 | 硬件 | 模型存储 | KV Cache 余量 | 月成本（云） | 推荐度 |
|------|------|---------|-------------|------------|-------|
| A | 2×A100-80GB (TP=2) | 55GB / 160GB | 105GB | ~$15K | ⭐⭐⭐ |
| B | 4×A100-40GB (TP=4) | 55GB / 160GB | 105GB | ~$14K | ⭐⭐ |
| C | 8×L40S-48GB (TP=8) | 55GB / 384GB | 329GB | ~$10K | ⭐⭐⭐ |
| D | 2×H100-80GB (TP=2, FP8) | 100GB / 160GB | 60GB | ~$22K | ⭐⭐ |

分析：
- **方案 A（2×A100-80GB）**：最简配置，TP=2 通信开销最小，KV Cache 余量充足（可支持 batch=32+），性价比高
- **方案 C（8×L40S）**：总显存最大但单卡仅 48GB，TP=8 通信开销大；适合 KV Cache 需求极大的长上下文场景
- **方案 B（4×A100-40GB）**：TP=4 需要 NVLink/NVSwitch，比 TP=2 通信开销增加 ~40%

**Step 4：推理引擎与优化**

```yaml
# vLLM 部署配置示例
engine_config:
  model: "path/to/100B-AWQ-INT4"
  tensor_parallel_size: 2
  gpu_memory_utilization: 0.92
  max_model_len: 8192
  quantization: "awq"

  # KV Cache 优化
  enable_prefix_caching: true    # 相同 system prompt 的 KV 复用
  block_size: 16

  # 调度优化
  max_num_seqs: 64               # 最大并发序列数
  max_num_batched_tokens: 8192   # 每步最大 token 数

  # 投机解码（可选）
  speculative_model: "path/to/7B-draft"
  num_speculative_tokens: 5
```

关键优化技术：
1. **PagedAttention + Prefix Caching**：共享 system prompt 的 KV Cache，减少重复计算（多用户共用相同 system prompt 时效果显著，KV Cache 命中率可达 60-80%）
2. **Continuous Batching**：动态增删请求，GPU 利用率从 ~30% 提升至 ~80%
3. **投机解码**：用 7B 草稿模型加速，理论 2-3× 提速
4. **Chunked Prefill**：将长 prompt 的 prefill 分块，避免阻塞 decode 请求

**Step 5：Prefill-Decode 分离部署**

Prefill（首 token 计算）是 compute-bound，Decode（后续 token 生成）是 memory-bandwidth-bound。两种工作负载特征完全不同：

```
Prefill 节点: 2×A100-80GB, 高算力利用率
Decode 节点:  2×A100-80GB, 高内存带宽利用率

Load Balancer → [Prefill Pool] → KV Cache Transfer → [Decode Pool]
```

DistServe/Splitwise 架构可让每种节点独立扩缩容，混合长短请求时吞吐提升 2-4×。

**Step 6：成本优化策略**

1. **Spot/Preemptible Instances**：AWS Spot p4d 实例比 On-Demand 便宜 60-70%，配合 checkpoint + 快速恢复机制
2. **时段弹性扩缩**：业务低谷期（凌晨）缩减实例数，用自动扩缩组
3. **多租户 LoRA**：不同客户/任务用 LoRA 适配器切换，共享基础模型权重，避免重复部署
4. **KV Cache 量化**：将 KV Cache 从 FP16 量化到 FP8/INT8，内存再减半
5. **On-prem vs Cloud**：月均 GPU 使用 >60% 时，自建机房 18 个月可收回硬件成本

**部署架构全景**：

```
用户请求
    ↓
[API Gateway + Rate Limiter]
    ↓
[Request Router]  ←── 根据请求长度/优先级路由
    ↓           ↓
[Prefill Pool] [Decode Pool]    ←── 可独立扩缩容
    ↓
[Response Streaming]  ←── SSE/WebSocket 流式返回
    ↓
[监控: GPU Util / KV Cache Hit / Queue Depth / TTFT / TPOT]
```

**关键知识点**

- 100B INT4 量化后约 55GB，2×A100-80GB（TP=2）是性价比最高的部署方案
- PagedAttention + Prefix Caching + Continuous Batching 是推理优化三件套
- Prefill-Decode 分离是混合负载下的进阶优化，可提升 2-4× 吞吐
- 成本控制：Spot 实例、弹性扩缩、KV Cache 量化、多租户 LoRA

**追问链**

1. **如果延迟要求极严（TPOT < 20ms）怎么办？** 减小 batch size（牺牲吞吐换延迟）、使用 FP8 + H100（更高内存带宽）、或用投机解码减少 Target 模型前向次数。
2. **如何监控和保障 SLO？** 核心指标：P50/P95/P99 的 TTFT 和 TPOT、队列深度、GPU 利用率、KV Cache 命中率。超过阈值时触发限流或扩容。
3. **自建机房 vs 云的 break-even 点？** 假设 2×A100-80GB 硬件成本 ~$30K，云月租 ~$15K，如果 GPU 利用率 >60%（即月均使用 >18 天），约 2-3 个月自建即可收回。但需考虑运维成本、网络带宽、电力冷却等隐性成本。

**延伸阅读**

- Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (vLLM, 2023) — https://arxiv.org/abs/2309.06180
- Zhong et al., "DistServe: Disaggregating Prefill and Decoding for Goodput-Optimized LLM Serving" (2024) — https://arxiv.org/abs/2401.09670
- Lin et al., "AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration" (2024) — https://arxiv.org/abs/2306.00978

</details>
