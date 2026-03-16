# 01-LLM原理面试题

> 涵盖 Transformer 架构、Self-Attention、位置编码、预训练范式、BPE 分词、Scaling Laws 与解码策略的分层面试题。

## 相关链接

- 对应技术资料：[01-LLM原理](../../01-技术资料/07-AI-Agent全栈开发/01-LLM原理.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | Transformer 编码器与解码器的主要区别是什么？ | ⭐ |
| Q2 | Self-Attention 的计算公式及为什么要除以 √dₖ？ | ⭐ |
| Q3 | 多头注意力（Multi-Head Attention）的作用是什么？ | ⭐ |
| Q4 | GPT 与 BERT 的预训练目标有何不同？ | ⭐ |
| Q5 | BPE（Byte Pair Encoding）分词的基本原理？ | ⭐ |
| Q6 | 贪婪解码（Greedy Decoding）与束搜索（Beam Search）的区别？ | ⭐ |
| Q7 | 温度参数（Temperature）如何影响生成结果？ | ⭐ |
| Q8 | 因果注意力掩码（Causal Mask）的作用？ | ⭐ |
| Q9 | KV Cache 的原理及节省的计算量？ | ⭐⭐ |
| Q10 | RoPE（旋转位置编码）的数学原理与优势？ | ⭐⭐ |
| Q11 | Top-p（nucleus）采样与 Top-k 采样的对比？ | ⭐⭐ |
| Q12 | Chinchilla Scaling Law 与 Kaplan Scaling Law 的核心区别？ | ⭐⭐ |
| Q13 | WordPiece vs SentencePiece vs BPE 的差异？ | ⭐⭐ |
| Q14 | LLM 涌现能力（Emergent Abilities）的原因假说？ | ⭐⭐ |
| Q15 | ALiBi 相对位置编码的原理及其对长度外推的优势？ | ⭐⭐ |
| Q16 | 预训练数据配比策略如何影响模型能力？ | ⭐⭐ |
| Q17 | Beam Search 的主要缺陷是什么？ | ⭐⭐ |
| Q18 | Grouped Query Attention（GQA）如何减少 KV Cache 内存？ | ⭐⭐ |
| Q19 | Flash Attention 的计算图优化原理（tiling + recomputation）？ | ⭐⭐⭐ |
| Q20 | 投机解码（Speculative Decoding）的原理与加速比分析？ | ⭐⭐⭐ |
| Q21 | 连续批处理（Continuous Batching）如何提升推理吞吐？ | ⭐⭐⭐ |
| Q22 | PagedAttention 内存管理机制与传统 KV Cache 的对比？ | ⭐⭐⭐ |
| Q23 | 设计一个服务 70B LLM 的推理系统，考虑哪些因素？ | ⭐⭐⭐ |
| Q24 | 对比解码（Contrastive Decoding）的原理与适用场景？ | ⭐⭐⭐ |
| Q25 | LLM 训练稳定性技巧：梯度裁剪、Warmup、Z-loss 各自解决什么问题？ | ⭐⭐⭐ |

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
