# 11-Transformers与模型架构面试题 — 面试指南

> 覆盖 LLaMA 架构细节、HuggingFace Transformers 工程实践、推理优化技术的高频面试题，从基础概念到生产级系统设计。

## 相关链接

- 对应技术资料：[11-Transformers与模型架构](../../01-技术资料/07-AI-Agent全栈开发/11-Transformers与模型架构.md)

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                 | 核心要点（一句话）                                              | 出题概率 |
| --- | -------------------- | --------------------------------------------------------------- | -------- |
| 1   | Self-Attention       | Q×K^T/√d_k→Softmax→V，捕获全局依赖                              | ★★★★★    |
| 2   | Multi-Head Attention | 多个注意力头并行，不同子空间捕获不同模式                        | ★★★★★    |
| 3   | 位置编码             | 正弦(原始)/RoPE(旋转，主流)/ALiBi(线性偏置)                     | ★★★★☆    |
| 4   | Layer Normalization  | Pre-LN(训练稳定，GPT-2+)/Post-LN(原始Transformer)               | ★★★★☆    |
| 5   | KV Cache             | 推理时缓存历史K/V避免重复计算，内存换速度                       | ★★★★★    |
| 6   | GPT vs BERT          | GPT=Decoder-Only(生成)/BERT=Encoder-Only(理解)，现在GPT架构主导 | ★★★★★    |
| 7   | Flash Attention      | 分块计算+在线Softmax，IO感知减少HBM访问                         | ★★★★☆    |
| 8   | GQA/MQA              | Grouped Query(LLaMA2)/Multi-Query，减少KV Cache大小             | ★★★★☆    |
| 9   | FFN/SwiGLU           | 两层线性+激活，SwiGLU(LLaMA)替代ReLU效果更好                    | ★★★☆☆    |
| 10  | Scaling Laws         | C≈6ND(计算≈6×参数×数据)，指导模型规模决策                       | ★★★☆☆    |

---

## 基础题（⭐）

### 1. RMSNorm 和 LayerNorm 有什么区别？LLaMA 为什么选择 RMSNorm？

**参考答案：**

LayerNorm 公式为：`γ · (x - μ) / √(σ² + ε) + β`，需要计算均值 μ 和方差 σ²，包含两次遍历和减均值（中心化）操作。

RMSNorm 公式为：`γ · x / RMS(x)`，其中 `RMS(x) = √(1/n · Σ xᵢ²)`，只计算 Root Mean Square（均方根），去掉了均值中心化步骤。

**主要差异：**

| 维度     | LayerNorm                | RMSNorm        |
| -------- | ------------------------ | -------------- |
| 计算量   | 需要计算均值 + 方差      | 只需计算均方根 |
| 参数量   | γ 和 β（两套可学习参数） | 只有 γ         |
| 计算节省 | 基准                     | 约 7-15%       |
| 实验效果 | 稳定                     | 同等效果       |

LLaMA 选择 RMSNorm 的原因：在大规模实验中，去掉均值中心化对模型效果几乎无影响，但每层可节省约 15% 的归一化计算量，对于 32-80 层的深层模型累积效果可观。

**追问：** Pre-norm（前归一化）相比 Post-norm（后归一化）有什么优势？

Pre-norm 将归一化放在 Self-Attention 和 FFN 之前，梯度能直接流过残差连接，不会被归一化截断；训练更稳定，允许更大的学习率。LLaMA 采用 Pre-norm。

---

### 2. 什么是 RoPE？它如何实现"相对位置编码"？

**参考答案：**

RoPE（Rotary Position Embedding，旋转位置编码）的核心思想：**通过对 Q 和 K 向量施加与位置相关的旋转变换，使得两个 token 的内积只依赖于它们的相对位置差**，而非绝对位置。

具体操作：将 d 维向量拆成 d/2 个二维子向量对，对位置 m 的向量施加旋转矩阵：

```
[x₂ᵢ']   = [cos(mθᵢ)  -sin(mθᵢ)] · [x₂ᵢ  ]
[x₂ᵢ₊₁']   [sin(mθᵢ)   cos(mθᵢ)]   [x₂ᵢ₊₁]

其中 θᵢ = 1 / 10000^(2i/d)（不同维度对用不同频率）
```

**"相对性"的数学证明：**

```
⟨f(q,m), f(k,n)⟩ = Re[qk* · e^(i(m-n)θ)]
```

内积结果只含 `(m-n)`（相对位置），不含 m 或 n 的绝对值。

**优势：**

- 天然支持长度外推（Position Interpolation/NTK 等技术在此基础上进一步扩展）
- 无需额外参数（与可学习位置编码不同）
- 相对位置感知比绝对编码更泛化

---

### 3. MHA、MQA、GQA 分别是什么？各有什么优缺点？

**参考答案：**

- **MHA（Multi-Head Attention）**：每个注意力头都有独立的 Q、K、V 投影矩阵。质量最高，但 KV Cache 大（H 倍）。
- **MQA（Multi-Query Attention）**：所有 Q 头共享同一套 K 和 V。KV Cache 最小（1 倍），但质量略有下降，对话生成任务中表现尚可。
- **GQA（Grouped Query Attention）**：将 Q 头分成 G 组，每组共享一套 K 和 V（G 通常为 H 的 1/4 到 1/8）。KV Cache 为 G 倍，是 MHA 和 MQA 的平衡方案。

**对比表：**

| 方案 | KV Cache | 推理内存 | 模型质量 | 代表模型         |
| ---- | -------- | -------- | -------- | ---------------- |
| MHA  | H 份 K,V | 最大     | 最高     | GPT-3, BERT      |
| MQA  | 1 份 K,V | 最小     | 略降     | PaLM, Falcon     |
| GQA  | G 份 K,V | 中等     | 接近 MHA | LLaMA 3, Mistral |

LLaMA 3 70B 采用 GQA（H=64 Q-heads，G=8 KV-heads），KV Cache 体积缩小至 MHA 的 1/8。

---

### 4. KV Cache 的工作原理是什么？为什么它能加速推理？

**参考答案：**

**问题背景：** LLM 自回归生成时，生成第 n 个 token 需要对前 n-1 个 token 计算 Attention，每个 token 都要重新计算 K 和 V 向量——这是 O(n²) 的冗余计算。

**KV Cache 原理：** 将历史 token 的 K 矩阵和 V 矩阵缓存下来。分为两个阶段：

1. **Prefill 阶段**：一次性并行处理所有输入 token，计算并缓存 K_cache 和 V_cache
2. **Decode 阶段**：每步只计算新生成 token 的 Q、K、V，将新的 K、V 追加到缓存，再用新的 Q 和完整的 K_cache、V_cache 做 Attention

**加速原因：** Decode 阶段每步只需做一次矩阵-向量乘法（而非矩阵-矩阵），计算量从 O(n) 降到 O(1)（每步），整体生成 n 个 token 的复杂度从 O(n³) 降为 O(n²)。

**内存代价：**

```
KV Cache 大小 = 2 × num_layers × num_kv_heads × seq_len × head_dim × bytes_per_element
```

LLaMA 3 8B（BF16，8K 序列）的 KV Cache 约 1GB，70B 约 8GB。

---

### 5. 什么是量化？INT8 量化的误差来源是什么？

**参考答案：**

**量化定义：** 将模型权重（或激活值）从高精度浮点数（FP32/BF16）映射到低位整数（INT8/INT4）的过程，通过牺牲少量精度换取内存节省和计算加速。

**线性量化公式：**

```
x_quant = round(x / scale) + zero_point
x_dequant = (x_quant - zero_point) × scale
```

**INT8 量化误差的来源：**

1. **舍入误差（Rounding Error）**：FP32 连续值被量化为 256 个离散级别，每次量化引入最多 0.5 个量化步长的误差
2. **范围截断（Clipping）**：超出 [-128, 127] 范围的值被截断为边界值，造成不可恢复的误差
3. **离群值问题（Outlier Problem）**：LLM 激活值中存在少量数值极大的"离群值"，导致量化范围被拉大，普通值精度损失惨重。这是 LLM 量化的核心难题，LLM.int8() 通过混合精度专门处理此问题
4. **累积误差**：深层网络中每层的量化误差逐层累积，可能导致较大的端到端误差

**对比各量化方案的误差控制：**

| 方案       | 误差控制策略                            |
| ---------- | --------------------------------------- |
| LLM.int8() | 混合精度，离群值维度用 FP16             |
| GPTQ       | 二阶优化（Hessian），最小化逐层量化误差 |
| AWQ        | 保护高激活值对应的权重通道，等效缩放    |

---

### 6. HuggingFace Pipeline 和直接调用 model.generate() 有什么区别？

**参考答案：**

`pipeline` 是对底层 `tokenizer + model.generate()` 的便捷封装，适合快速原型验证。`model.generate()` 是底层 API，适合生产部署和精细控制。

| 维度     | Pipeline                   | model.generate() |
| -------- | -------------------------- | ---------------- |
| 易用性   | 高（一行代码）             | 低（需手动处理） |
| 灵活性   | 低                         | 高               |
| 隐式截断 | `truncation=True` 默认开启 | 显式控制         |
| 批处理   | 自动但不透明               | 完全可控         |
| 流式输出 | 支持（TextStreamer）       | 支持（Streamer） |
| 适用场景 | 原型/实验                  | 生产推理         |

**坑：** Pipeline 默认 `truncation=True`，超长输入会被**静默截断**，生产环境必须显式设置 `max_length` 并检查。

---

### 7. Transformer 中 Pre-norm 和 Post-norm 分别是什么？各有什么特点？

**参考答案：**

- **Post-norm（后归一化）**：归一化在残差连接之后 `output = Norm(x + Sublayer(x))`。原版 Transformer（Vaswani 2017）采用此方式。梯度在经过归一化后被压缩，深层网络训练不稳定，需要精心设计学习率 warmup。

- **Pre-norm（前归一化）**：归一化在子层输入之前 `output = x + Sublayer(Norm(x))`。LLaMA、GPT 系列均采用此方式。梯度通过残差连接直接流向前层，训练更稳定；但理论上最终效果上限略低于 Post-norm（后者在收敛后质量略高，但训练更难）。

---

## 进阶题（⭐⭐）

### 8. 详细解释 FlashAttention 解决了什么问题？其 IO 复杂度如何改进？

**参考答案：**

**标准 Attention 的瓶颈：** 不是计算量（FLOPs），而是 **内存带宽（Memory Bandwidth）**。

标准 Softmax(QKᵀ/√d)V 需要：

1. 将 Q(N×d)、K(N×d) 读入 → 写出 S(N×N)（注意力分数矩阵，N² 元素）
2. 对 S 做 Softmax → 写回 P(N×N)
3. 读 P 和 V → 写出 O(N×d)

总 HBM 访问次数：O(N²)，对 N=4096，S 矩阵约 64M 个 float16 元素 = 128 MB，频繁读写 HBM 成为吞吐瓶颈。

**FlashAttention 的解法 — 分块（Tiling）：**

将 Q、K、V 分成大小为 B 的块，循环加载到片上 SRAM（更快但更小）：

- 外层循环 K, V 块（J 循环）
- 内层循环 Q 块（I 循环）
- 利用 **Online Softmax** 技巧，在不知道全局 max 的情况下增量计算 Softmax
- 所有计算在 SRAM 内完成，无需将中间 N×N 矩阵写回 HBM

**IO 复杂度改进：**

| 版本              | HBM IO 复杂度             | 加速比（典型） |
| ----------------- | ------------------------- | -------------- |
| 标准 Attention    | O(N²d)                    | 1x             |
| FlashAttention v1 | O(N²d²/M)，M 为 SRAM 大小 | ~3x            |
| FlashAttention v2 | 相同复杂度，更好的并行化  | ~6x            |

**反向传播：** 不存储 N×N 的注意力矩阵，反向时重新计算（Recompute），以计算换内存，整体内存从 O(N²) 降为 O(N)。

---

### 9. 投机解码（Speculative Decoding）的原理是什么？其正确性如何保证？

**参考答案：**

**核心思想：** 用小模型（Draft Model）快速生成 γ 个草稿 token，再用大模型（Target Model）一次**并行**验证全部草稿，接受正确的 token，拒绝错误的。

**算法步骤（以 γ=4 为例）：**

1. Draft Model 自回归生成 4 个 token：T₁, T₂, T₃, T₄（以各自的概率 q(·) 采样）
2. Target Model 一次前向传播（并行处理所有 4 个 token），获得每步的目标分布 p(·)
3. **接受/拒绝（Rejection Sampling）：** 对每个草稿 token x：
   - 以 `min(1, p(x)/q(x))` 的概率接受
   - 被拒绝时，从修正分布 `max(0, p(x) - q(x))` 重新采样
4. 在第一个被拒绝的位置停止

**正确性保证：** 上述接受概率公式（Rejection Sampling）确保最终输出分布与 Target Model 的输出分布**完全等价**——这不是近似，是精确的分布保持。

**加速条件：** 草稿接受率 α 越高，γ 越大，加速越明显。

- 理想情况（α=1）：γ 倍加速
- 实际情况（α≈0.7）：2-3x 加速
- α 依赖于 Draft 和 Target 模型的相似程度

**局限性：** batch_size > 1 时调度复杂，Draft 模型需要与 Target 模型在同一设备。

---

### 10. 连续批处理（Continuous Batching）相比传统静态批处理有什么优势？

**参考答案：**

**传统静态批处理的问题：**

- 一个 batch 内所有请求必须同时完成才能释放资源
- 短请求完成后，其占用的 GPU slot 处于空闲状态，等待长请求结束
- GPU 利用率低（典型值 20-40%）

**连续批处理（Iteration-level Scheduling）：**

- 在每个 decode 步骤（iteration）级别动态调整 batch
- 某请求完成后，立即将等待队列中的新请求插入空出的 slot
- GPU 始终处于满负载状态

**效果：** GPU 利用率从 30% 提升到 80-95%，吞吐量提升 3-10x。vLLM、TGI（Text Generation Inference）均采用此技术。

**附加技术 — PagedAttention（vLLM）：**
KV Cache 的内存碎片化问题与连续批处理密切相关。PagedAttention 借鉴操作系统虚拟内存的 Page 概念，将 KV Cache 以固定大小的"页"管理，消除碎片化，进一步提高 batch 内的可调度请求数量。

---

### 11. 解释 SwiGLU 激活函数的设计思路。为什么它比 ReLU 效果更好？

**参考答案：**

**SwiGLU 公式：**

```
SwiGLU(x, W, V) = Swish(xW₁) ⊙ (xV)
Swish(x) = x · σ(x)    （sigmoid 门控的平滑版 ReLU）
```

**设计思路：**

1. **门控线性单元（GLU）** 引入了"门控"概念：`GLU(x) = σ(xW) ⊙ xV`，sigmoid 门决定哪些信息通过，类似 LSTM 的门控机制，但更轻量
2. **SwiGLU 用 Swish 替代 sigmoid**：Swish 是平滑且自门控的（x · σ(x)），导数处处存在，无 ReLU 的"死区"问题
3. **表达能力更强**：门控机制让模型可以学习动态的非线性变换

**与 ReLU 的对比：**

| 特性                 | ReLU                   | SwiGLU                     |
| -------------------- | ---------------------- | -------------------------- |
| 死区（Dead Neurons） | 有（x<0 梯度为0）      | 无                         |
| 光滑性               | 不光滑（x=0 处不可导） | 光滑                       |
| 参数量               | 2 个矩阵 W₁, W₂        | 3 个矩阵 W₁, W₂, W₃        |
| 表达能力             | 一般                   | 更强（门控带来非线性组合） |
| 计算量               | 低                     | 高约 50%（多一个矩阵乘法） |

在相同总参数量的限制下（通常将 hidden_dim 缩小 2/3 以补偿第三矩阵），SwiGLU 的效果显著优于 ReLU。

---

### 12. model.generate() 中的 temperature、top_k、top_p 各有什么作用？如何组合使用？

**参考答案：**

**Temperature（温度）：** 对 logits 进行缩放后再 Softmax：`p(x) ∝ exp(logit(x) / T)`

- T < 1：分布更尖锐，输出更确定/重复
- T > 1：分布更平均，输出更随机/多样
- T = 0：等价于贪婪解码（选最高概率）

**Top-k Sampling：** 只从概率最高的 k 个 token 中采样，排除低概率 token（可能是错误拼写等）。缺点：k 是固定值，不同上下文下高概率 token 数量不同。

**Top-p（Nucleus Sampling）：** 动态选择"概率累积和超过 p 的最小 token 集合"。高熵（不确定）时选更多 token，低熵（确定）时选更少 token，比 top-k 更自适应。

**推荐组合：**

```python
# 常用生产配置：先 top-k 缩小范围，再 top-p 进一步过滤，最后 temperature 控制随机性
model.generate(
    input_ids,
    temperature=0.7,
    top_k=50,
    top_p=0.9,
    do_sample=True,
    repetition_penalty=1.1,  # 惩罚重复 token
)
```

---

### 13. KV Cache 在批处理时有哪些挑战？vLLM 是如何解决的？

**参考答案：**

**挑战：**

1. **内存碎片化**：不同请求的序列长度不同，KV Cache 大小各异。预分配"最大序列长度"会造成大量内存浪费；动态分配又产生碎片
2. **提前分配难以预测**：生成过程中序列长度动态增长，无法预先精确分配
3. **内存浪费**：传统实现中 batch 内所有请求的 KV Cache 按最长序列对齐，短请求浪费大量内存

**vLLM 的解法 — PagedAttention：**

借鉴操作系统虚拟内存管理思想：

1. 将 KV Cache 划分为固定大小的**物理块（Physical Block）**，每块存储若干 token 的 K,V
2. 每个序列有一个**逻辑块表**，映射到物理块（类似虚拟地址→物理地址）
3. **写时复制（Copy-on-Write）**：支持 Beam Search 时多条路径共享前缀 KV Cache，分叉时才复制
4. 内存碎片接近零，GPU 内存利用率提升至 90%+

**效果：** vLLM 相比 HuggingFace naive 实现，吞吐量提升 24x。

---

## 高级题（⭐⭐⭐）

### 14. RoPE 如何支持超过训练长度的上下文（长度外推）？常见方案有哪些？

**参考答案：**

RoPE 的频率 `θᵢ = 1 / 10000^(2i/d)` 决定了不同维度对的旋转速度。训练时见过的最大位置 m=L，推理时遇到 m>L 的位置时，模型从未见过对应的旋转角度，性能下降。

**主流长度外推方案：**

1. **位置插值（PI, Position Interpolation）**：将推理位置压缩到训练范围内。若训练长度 L，推理时位置 m 变为 `m' = m × L/L'`（L' 为目标长度）。简单但会损失短距离分辨率，需要少量微调恢复。

2. **NTK-aware 插值**：对不同频率维度采用不同的缩放策略——低频维度（长程关系）插值，高频维度（短程关系）外推。数学上基于神经正切核（NTK）理论，无需微调即可扩展 2-4x。

3. **YaRN（Yet another RoPE extensioN）**：分段插值策略，对高频部分不做修改，对低频部分做动态 NTK 插值，并引入注意力温度缩放因子（attention temperature scaling）。LLaMA 3 长上下文版本采用此技术，支持 128K 上下文。

4. **LongRoPE**：通过遍历搜索为每个维度找到最优的非均匀插值因子，进一步减少长度外推的精度损失。

---

### 15. GPTQ 量化的核心思想是什么？与 AWQ 有何不同？

**参考答案：**

**GPTQ 核心思想：**

基于 OBQ（Optimal Brain Quantization）框架，使用二阶信息（Hessian 矩阵）逐列量化权重矩阵，每量化一列后，通过 Hessian 逆调整剩余列以补偿误差。

关键公式（量化列 q 后更新列 j 的误差补偿）：

```
δW_j = -w_q/[H⁻¹]_qq × [H⁻¹]_qj    （使用 Cholesky 分解求逆）
```

- 需要约 128 条校准样本（通常用 C4 数据集的随机子集）
- **离线量化**：量化后存储 INT4/INT3 权重，推理时反量化（或直接用 INT4 矩阵乘法内核）
- 精度损失极小（相比 round-to-nearest）

**AWQ（Activation-aware Weight Quantization）：**

关键洞见：**只有约 1% 的权重通道（对应高激活值的通道）对模型性能至关重要**。

AWQ 的策略：

1. 分析激活值统计，找出"显著通道"
2. 对显著通道进行**等效缩放**（激活除以 scale，权重乘以 scale），让重要权重值更大、更不容易被量化误差破坏
3. 在缩放后的空间内进行普通 round-to-nearest 量化

**对比：**

| 维度       | GPTQ                   | AWQ                    |
| ---------- | ---------------------- | ---------------------- |
| 核心原理   | 二阶优化（Hessian）    | 激活感知缩放           |
| 量化方向   | 逐列量化权重           | 保护高激活通道         |
| 校准数据   | 需要（约128条）        | 需要（用于激活统计）   |
| 精度       | 高                     | 极高（通常优于 GPTQ）  |
| 推理速度   | 快（专用 CUDA kernel） | 快（专用 CUDA kernel） |
| 实现复杂度 | 高                     | 中                     |

---

### 16. 解释 online softmax 的原理，以及 FlashAttention 如何利用它实现分块计算？

**参考答案：**

**Standard Softmax 的问题：**

计算 `softmax(x) = exp(xᵢ - max(x)) / Σⱼ exp(xⱼ - max(x))` 需要两次遍历整个向量：第一次找 max，第二次计算 exp 和 sum。在分块处理时，我们不知道全局 max。

**Online Softmax（Streaming Softmax）：**

维护两个中间量：当前最大值 m 和归一化分母 d，每读入一个新元素就更新：

```
# 读入第 i 个元素 xᵢ
m_new = max(m_old, xᵢ)
d_new = d_old × exp(m_old - m_new) + exp(xᵢ - m_new)

# 修正因子: 当 m 更新时，之前计算的 exp 值需要乘以 exp(m_old - m_new)
```

一次遍历即可完成，且可以在不知道后续元素的情况下增量更新。

**FlashAttention 的分块应用：**

```
对于 Q 的第 i 块和所有 K, V 块：
- 初始化: O_i = 0, ℓ_i = 0, m_i = -∞
- 循环 j = 1 to T_c:
  - 计算 S_ij = Q_i K_j^T / √d
  - 更新 m_i_new = max(m_i, rowmax(S_ij))
  - P_ij = exp(S_ij - m_i_new)
  - ℓ_i = exp(m_i - m_i_new) × ℓ_i + rowsum(P_ij)  ← 修正+累积
  - O_i = exp(m_i - m_i_new) × O_i + P_ij V_j       ← 修正+累积输出
  - m_i = m_i_new
- 最终: O_i = O_i / ℓ_i   ← 归一化
```

全程在 SRAM 内完成，无需将 N×N 矩阵写回 HBM。

---

### 17. 解释 Prefill 和 Decode 两个阶段的区别，以及如何分别优化？

**参考答案：**

**Prefill（预填充）阶段：**

- 处理输入 prompt 的所有 token（并行）
- 计算量大，IO 相对较小：**计算密集型（Compute-bound）**
- 瓶颈：GPU 算力（FLOPS）
- 优化方向：FlashAttention、Tensor Parallelism、更大的 batch（多个 prompt 并行）

**Decode（解码）阶段：**

- 每步只处理一个新生成的 token
- 矩阵-向量乘法（不是矩阵-矩阵）：大量参数被激活，计算量极小但需要读取所有权重
- 瓶颈：HBM 带宽（**IO 密集型，Memory-bound**）
- 优化方向：
  - 增大 batch size（让同样的权重读取摊薄到更多请求）
  - 量化（减少权重大小，提高带宽利用效率）
  - 投机解码（变串行 decode 为并行 verify）
  - Continuous Batching（最大化有效 batch size）

**批处理策略：** Prefill 和 Decode 在计算特征上差异极大，最优调度策略也不同。先进的推理框架（如 Sarathi、Splitwise）甚至将两个阶段分配到不同机器执行（Prefill 机器和 Decode 机器），进一步优化整体吞吐量。

---

### 18. 从头实现一个简单的 Multi-Head Self-Attention，并说明 causal mask 如何实现？

**参考答案：**

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
import math

class MultiHeadSelfAttention(nn.Module):
    def __init__(self, d_model: int, num_heads: int, dropout: float = 0.0):
        super().__init__()
        assert d_model % num_heads == 0
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads
        self.scale = self.head_dim ** -0.5

        # 合并 Q, K, V 投影（效率更高）
        self.qkv_proj = nn.Linear(d_model, 3 * d_model, bias=False)
        self.out_proj = nn.Linear(d_model, d_model, bias=False)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x, causal: bool = True):
        B, T, C = x.shape  # batch, seq_len, d_model

        # Q, K, V 投影与 reshape
        qkv = self.qkv_proj(x)            # (B, T, 3*C)
        q, k, v = qkv.chunk(3, dim=-1)    # 各 (B, T, C)

        # 变形为多头格式: (B, num_heads, T, head_dim)
        def reshape(t):
            return t.view(B, T, self.num_heads, self.head_dim).transpose(1, 2)

        q, k, v = reshape(q), reshape(k), reshape(v)

        # Scaled Dot-Product Attention
        attn = torch.matmul(q, k.transpose(-2, -1)) * self.scale  # (B, H, T, T)

        # Causal Mask：下三角矩阵，未来位置填 -inf
        if causal:
            mask = torch.tril(torch.ones(T, T, device=x.device)).bool()
            attn = attn.masked_fill(~mask, float('-inf'))

        attn = F.softmax(attn, dim=-1)
        attn = self.dropout(attn)

        # 聚合 V
        out = torch.matmul(attn, v)                      # (B, H, T, head_dim)
        out = out.transpose(1, 2).contiguous().view(B, T, C)  # (B, T, C)
        return self.out_proj(out)
```

**Causal Mask 的作用：** 在训练和 Prefill 时防止模型"看到"未来 token，确保每个位置的输出只依赖当前及之前的 token。Decode 阶段每步只有一个 token，天然满足因果性，不需要 mask。

---

## 场景题

### 19. 你需要为一个 70B 参数的 LLM 设计推理服务，预算是 4 块 A100 80GB 显卡，目标 QPS 为 10，P99 延迟 < 5 秒（输出 200 tokens）。请描述你的完整设计方案。

**参考答案：**

#### 1. 资源评估

```
70B 模型内存需求：
  - BF16 权重：70B × 2 bytes ≈ 140 GB
  - 4 × A100 80GB = 320 GB 显存
  - 可用于 KV Cache 的显存：320 - 140 = 180 GB

KV Cache 计算（GQA，8 KV heads，128 KV dim，80 layers）：
  每 token KV Cache = 2 × 80层 × 8头 × 128维 × 2字节 = 327 KB
  180 GB / 327 KB ≈ 55,000 个 token 可同时在 Cache 中
  以平均 2048 token/请求计算，可并发约 27 个请求
```

#### 2. 并行策略

**Tensor Parallelism（张量并行）**：将每个注意力头/FFN 维度分到 4 卡，每卡处理 1/4 的权重。对于 Attention，每卡持有 1/4 的 Q,K,V 头；对于 FFN，每卡持有 1/4 的 hidden_dim。All-reduce 通信开销是主要延迟来源（单机 NVLink 可忽略）。

```
单机 4 × A100（NVLink 连接）→ 使用 4-way Tensor Parallelism
不建议 Pipeline Parallelism（单机场景气泡过大）
```

#### 3. 推理框架选型

**vLLM** 是首选：

- PagedAttention：消除 KV Cache 碎片化，最大化可调度请求数
- Continuous Batching：GPU 利用率 > 90%
- 内置 Tensor Parallelism（`tensor_parallel_size=4`）
- OpenAI 兼容 API，易于集成

```python
from vllm import LLM, SamplingParams

llm = LLM(
    model="meta-llama/Llama-3-70b-instruct",
    tensor_parallel_size=4,          # 4 卡张量并行
    gpu_memory_utilization=0.90,     # 预留 10% 给其他开销
    max_model_len=4096,              # 限制上下文长度
    quantization="awq",              # AWQ INT4 量化（可选）
)
```

#### 4. 量化决策

若 P99 < 5s 难以达到，可考虑 **AWQ INT4 量化**：

- 权重降为 35 GB，4 卡显存绰绰有余
- 释放更多 KV Cache 空间，支持更大并发
- 精度损失 < 1%（AWQ 表现优异）
- Decode 阶段速度提升约 2x（带宽密集，INT4 减少读取量）

#### 5. 延迟分析与优化

```
目标：200 tokens，P99 < 5s
→ 需要 decode 速度 > 40 tokens/s

70B BF16 在 4×A100：约 30-50 tokens/s（batch=1）
70B AWQ INT4 在 4×A100：约 60-80 tokens/s（batch=1）
```

超过延迟目标的优化手段：

1. **投机解码**：用 7B 模型作为 Draft，70B 作为 Target，延迟降低 2-3x（但需要额外显存）
2. **CUDA Graph**：固定 batch size 后消除 Python 调度开销，降低约 10-20% 延迟
3. **Prefill-Decode 分离**：将 Prefill（compute-bound）和 Decode（memory-bound）调度到不同时间段，减少互相干扰

#### 6. 监控与可靠性

```python
# 关键监控指标
metrics = {
    "TTFT": "首 Token 延迟（Time To First Token）",
    "TPOT": "每 Token 延迟（Time Per Output Token）",
    "throughput_tps": "系统吞吐量（tokens/sec）",
    "gpu_utilization": "GPU 利用率 > 80% 为健康",
    "kv_cache_usage": "KV Cache 使用率，>95% 触发告警",
    "queue_depth": "等待队列深度，反映服务压力",
}
```

**弹性方案：** 峰值 QPS 超过 10 时，通过 Kubernetes HPA 扩容节点（每节点 4×A100），在负载均衡层做请求路由。

---

### 20. 线上模型出现"重复输出"（repetition）问题，你会如何排查和解决？

**参考答案：**

**排查步骤：**

1. **确认是解码参数问题还是模型问题：**
   - 测试 `temperature=1.0, do_sample=False`（贪婪解码）——若依然重复，是模型问题
   - 测试多种 seed——若特定 seed 触发，可能是边缘情况

2. **检查解码参数：**

   ```python
   # 最常见的原因：temperature=0 或极低，导致陷入重复循环
   model.generate(
       input_ids,
       temperature=0.7,           # 不要用 0（或极低值）
       repetition_penalty=1.1,    # 惩罚已出现的 token
       no_repeat_ngram_size=3,    # 禁止重复 3-gram
   )
   ```

3. **检查 EOS Token 配置：** 若 `eos_token_id` 未正确设置，模型可能无法停止生成，陷入循环

4. **检查是否是 KV Cache 状态污染：** 在多轮对话中，若前一轮的 `past_key_values` 被错误传入下一轮，可能导致奇怪重复

5. **量化模型特有问题：** 若是量化模型，某些层的量化误差可能在特定输入下放大，导致概率分布坍塌

**系统性解决方案：**

| 方案                          | 适用场景     | 代价                           |
| ----------------------------- | ------------ | ------------------------------ |
| `repetition_penalty=1.1-1.3`  | 通用         | 可能影响合法重复（代码、列表） |
| `no_repeat_ngram_size=3`      | 通用文本生成 | 禁止合法 3-gram 重复           |
| `temperature=0.7 + top_p=0.9` | 创意生成     | 引入随机性                     |
| 后处理检测 + 截断             | 生产安全网   | 增加延迟                       |

---

### 21. 如何为 LLM 推理服务设计一个高效的请求优先级调度系统？

**参考答案：**

推理服务需要平衡多种目标：低延迟、高吞吐、公平性、SLA 保障。

**调度维度：**

1. **基于 SLA 的优先级队列：**

   ```
   Priority Queue:
   ├── P0（付费 Premium 用户）：最大等待 100ms
   ├── P1（API 标准用户）：最大等待 1000ms
   └── P2（Batch Job）：尽力而为，无严格 SLA
   ```

2. **Prefill-First vs Decode-First 策略：**
   - **Decode-First**：优先完成已在生成的请求，降低 P99 延迟，但新请求 TTFT 更高
   - **Prefill-First**：优先处理新来的请求，TTFT 更低，但整体吞吐略低

3. **基于请求长度的分箱（Length Binning）：**
   将请求按预估输出长度分组，短请求组和长请求组分别调度，减少 padding 浪费

4. **抢占（Preemption）机制：**
   当 KV Cache 内存不足时，挂起低优先级请求（将其 KV Cache 换出到 CPU 或丢弃），为高优先级请求腾出空间

5. **预填充分块（Chunked Prefill）：**
   长 prompt 的 Prefill 会阻塞 Decode（高延迟峰值）。将 Prefill 分成若干 chunk，与 Decode 交错执行，平滑延迟曲线（Sarathi-Serve 的核心思想）

---

### 22. 比较在相同硬件预算下，选择一个 70B 模型（INT4 量化）和两个 7B 模型（BF16）用于推理的优缺点。

**参考答案：**

**假设：** 2 × A100 80GB（160 GB 总显存）

| 维度           | 70B INT4                 | 2 × 7B BF16                      |
| -------------- | ------------------------ | -------------------------------- |
| 显存占用       | ~35 GB（权重）+ KV Cache | ~14 GB × 2 = 28 GB（可独立运行） |
| 推理质量       | 更高（70B 能力）         | 较低（7B 能力）                  |
| 吞吐量         | 较低（单实例）           | 较高（2 实例并行，各自 batch）   |
| 延迟（单请求） | 较高（更多参数）         | 较低（参数少）                   |
| 维护复杂度     | 低（单实例）             | 高（负载均衡、一致性）           |
| 适用场景       | 高质量推理，QPS 不高     | 高并发，对质量要求稍低           |
| 故障恢复       | 单点故障，恢复慢         | 单实例故障，另一实例继续服务     |

**决策框架：**

- 任务对质量敏感（代码生成、复杂推理）→ 70B INT4
- 任务质量要求适中，高并发场景（客服问答）→ 2 × 7B BF16
- 混合策略：用 7B 做路由分类，简单任务 7B 回答，复杂任务路由到 70B

---

## 导航

- ← [面试指南总目录](../README.md)
- ↔ [对应技术资料](../../01-技术资料/07-AI-Agent全栈开发/11-Transformers与模型架构.md)
