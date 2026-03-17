# PEFT 常见面试题库

> 涵盖 LoRA、QLoRA、PEFT 各方法的深度面试题，含详细解答。

## 相关链接

- 对应技术资料：[12-参数高效微调PEFT](../../01-技术资料/07-AI-Agent全栈开发/12-参数高效微调PEFT.md)

## 题目分类

| 类别 | 题号 | 难度 |
|------|------|------|
| LoRA 基础原理 | Q1~Q8 | ⭐⭐ |
| 全量微调 vs PEFT | Q9~Q11 | ⭐⭐ |
| QLoRA | Q12~Q15 | ⭐⭐⭐ |
| 工程实践 | Q16~Q20 | ⭐⭐⭐ |
| 进阶技术 | Q21~Q26 | ⭐⭐⭐⭐ |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| # | 考点 | 核心要点（一句话） | 出题概率 |
|---|------|-------------------|--------|
| 1 | LoRA | 冻结原权重+低秩矩阵(A×B)旁路，推理可合并零开销 | ★★★★★ |
| 2 | QLoRA | 4-bit量化+LoRA，24GB显存可训练70B模型 | ★★★★★ |
| 3 | 秩 r 选择 | r=8(通用)/16-32(复杂任务)/64(领域迁移)，r越大参数越多 | ★★★★☆ |
| 4 | target_modules | attention(q_proj,v_proj)必选，加gate/up/down更好 | ★★★★☆ |
| 5 | LoRA vs 全量微调 | LoRA: 0.1-1%参数，可叠加多任务，效果95%+ | ★★★★★ |
| 6 | Adapter Tuning | 瓶颈层插入(down→nonlinear→up)，LoRA之前的主流 | ★★★☆☆ |
| 7 | Prefix Tuning | 在注意力层前添加可训练prefix向量 | ★★★☆☆ |
| 8 | 多LoRA服务 | 基础模型+动态加载LoRA适配器，punica/S-LoRA | ★★★★☆ |
| 9 | LoRA 合并 | merge_and_unload()合并回原权重，部署无额外开销 | ★★★☆☆ |
| 10 | PEFT 库使用 | get_peft_model/PeftConfig/保存加载/推理模式 | ★★★★☆ |

---

## LoRA 基础原理

### Q1：LoRA 的核心思想是什么？请说明其数学原理。

**答：**

LoRA (Low-Rank Adaptation) 的核心思想是：**预训练模型的权重更新矩阵具有低内在秩**，因此可以用两个低秩矩阵的乘积来近似。

数学原理：
```
原始权重更新：W = W₀ + ΔW，其中 ΔW ∈ ℝ^(d×k)

LoRA 近似：ΔW ≈ B × A
  A ∈ ℝ^(r×k)  — 随机高斯初始化
  B ∈ ℝ^(d×r)  — 零初始化
  r ≪ min(d, k) — 秩，通常 4~64

前向传播：h = W₀x + (alpha/r) × BAx

参数节省：d×k → r×(d+k)，通常节省 > 99%
```

关键设计：B 初始化为零，确保训练开始时 ΔW = 0，等同于原始预训练模型，避免随机初始化干扰。

---

### Q2：LoRA 中的 rank r 和 alpha 参数如何影响训练？应该如何设置？

**答：**

**rank r** 控制适配器的表达能力：
- r 越大 → 参数越多 → 可以拟合更复杂的任务 → 但占用更多显存
- r 越小 → 参数少 → 训练快，不易过拟合 → 但表达能力有限

**alpha** 是 scaling 因子，实际作用为 `alpha/r`：
- alpha/r 大 → LoRA 更新对输出影响更强 → 效果类似提高学习率
- alpha/r 小 → LoRA 影响弱 → 更保守地适配

**实践设置**：
```
r = 4~8：   快速验证，数据 < 5K
r = 16~32： 常规任务，数据 5K~50K
r = 64+：   高质量需求，资源充足

alpha = r：    保守设置（scaling = 1）
alpha = 2r：   常用设置（scaling = 2，相当于适当增强 LoRA 效果）
```

---

### Q3：LoRA 为什么只应用于注意力层？可以应用于 FFN 层吗？

**答：**

**原论文的理由**：Hu et al. 认为注意力层的权重矩阵（Q/K/V/O）是适应下游任务最关键的部分，FFN 层主要存储知识（facts），修改 FFN 可能破坏预训练知识。

**实践发现**：
```
只用 Q/V：          最小配置，效果基本可行
Q/K/V/O：           标准配置，效果好
Q/K/V/O + FFN：     效果最好，但参数增加约 3x
```

**可以应用 FFN 层**，且通常能提升效果，特别是：
- 领域知识注入任务（需要修改 FFN 的知识存储）
- 数据充足的情况

`target_modules = "all-linear"` 可以自动覆盖所有线性层。

---

### Q4：LoRA 与 Full Fine-Tuning 相比，在哪些场景下 LoRA 会不如全量微调？

**答：**

LoRA 可能不如全量微调的场景：

1. **任务与预训练分布差异极大**：如从 NLP 模型迁移到完全不同的模态
2. **需要大幅修改模型行为**：比如从补全任务转为指令遵循（此时建议 r 要大）
3. **数据量极其充足（>100M tokens）**：此时低秩限制成为瓶颈
4. **任务需要修改词表**：LoRA 不涉及 embedding 层（需要 `modules_to_save`）
5. **严格的精度要求**：低秩近似带来轻微精度损失

但对于大多数 NLP 微调任务（SFT、分类、NER），LoRA 以 < 1% 参数量实现 > 95% 的全量微调效果。

---

### Q5：LoRA 为什么将 B 矩阵初始化为零，而不是随机初始化？

**答：**

B 零初始化确保训练起始时 `ΔW = BA = B×0_random = 0`，即：

```
训练开始时：h = W₀x + (alpha/r) × BAx = W₀x + 0 = W₀x
```

这意味着训练开始时，PEFT 模型与原始预训练模型行为完全一致。

好处：
1. **稳定初始化**：避免随机扰动导致训练初期不稳定
2. **保留预训练知识**：从预训练模型的基础上开始，而非随机起点
3. **梯度稳定**：初始损失接近预训练模型的损失，梯度信号清晰

如果 B 随机初始化，训练开始时输出会有随机扰动，loss 会先升后降，且可能需要更长时间才能收敛。

---

### Q6：如何理解 LoRA 的"低秩假设"？这个假设成立吗？

**答：**

**低秩假设**：预训练大模型在适应下游任务时，所需的权重变化（ΔW）具有较低的内在秩（intrinsic dimensionality）。

**实验证据**（来自 LoRA 论文）：
- 对 GPT-3 的适配任务，用 SVD 分析 ΔW 的奇异值分布
- 发现大部分信息集中在前几个奇异值上
- r=4~8 就能捕获 > 90% 的信息

**直觉理解**：
- 预训练模型已经学会了语言的通用表示
- 适应特定任务只需要在高维空间中做"小调整"
- 这种"小调整"自然具有低秩结构

**局限性**：
- 并非所有任务的 ΔW 都是低秩的
- 领域差异越大，所需的 rank 越高
- 这是 AdaLoRA 提出自适应 rank 的动机

---

### Q7：merge_and_unload 操作的数学本质是什么？合并后模型与原始 LoRA 推理是否完全等价？

**答：**

**数学本质**：
```
合并前（推理）：output = W₀x + (alpha/r) × BAx
合并操作：W_merged = W₀ + (alpha/r) × BA
合并后（推理）：output = W_merged × x
```

**是否等价**：
- **FP32/BF16 LoRA**：**完全等价**（矩阵乘法分配律，无精度损失）
- **QLoRA（量化 LoRA）**：**近似等价**（有轻微数值误差）
  - 原因：量化 W₀ 时引入量化误差，合并时先反量化再相加
  - 误差通常 < 0.1%，实践中可以忽略

**合并的意义**：
- ✅ 消除 LoRA 额外计算（两个矩阵乘法 + 加法）
- ✅ 模型结构回到标准 Transformer，兼容性好
- ✅ 可以进一步使用 GPTQ/AWQ 量化
- ❌ 无法切换不同适配器

---

### Q8：LoRA 训练时，哪些参数被冻结，哪些参与训练？梯度如何流动？

**答：**

```
参数类型              状态          梯度
──────────────────────────────────────────────────────
W₀（原始权重）        冻结          无梯度
A 矩阵（LoRA 下投影） 可训练        有梯度
B 矩阵（LoRA 上投影） 可训练        有梯度
LayerNorm 参数        冻结（默认）   无梯度（bias="none"）
bias                  冻结（默认）   无梯度
lm_head               冻结（默认）   无梯度
```

**梯度流动**：
```
Loss → ... → h = W₀x + BAx
         ∂Loss/∂B = (∂Loss/∂h) × (Ax)ᵀ   ← 有梯度
         ∂Loss/∂A = Bᵀ × (∂Loss/∂h) × xᵀ ← 有梯度
         ∂Loss/∂W₀ = 0                    ← W₀ 冻结，不累积梯度
```

注意：虽然 W₀ 不更新，但梯度仍然会"流过" W₀（用于 A 的梯度计算），所以需要 `enable_input_require_grads()`。

---

## 全量微调 vs PEFT

### Q9：为什么不对大型语言模型进行全量微调？全量微调有哪些具体问题？

**答：**

**计算成本**：
```
LLaMA-2-70B 全量微调所需显存：
  参数：70B × 4B = 280GB
  梯度：280GB
  优化器（Adam）：560GB（一阶+二阶矩）
  激活值：~100GB
  总计：~1.2TB ≈ 15 × A100 80GB
```

**灾难性遗忘**：
- 全量微调容易让模型"忘记"预训练阶段学到的通用知识
- 特别是在小数据集上微调时，过拟合风险高

**存储成本**：
- 每个任务需要保存一份完整权重副本（7B 模型 ≈ 14GB）
- 100 个任务 = 1.4TB 存储

**PEFT 的优势**：
- 参数节省 99%+，显存节省 60~80%
- 保留预训练知识（基础权重冻结）
- 多任务：共享基础模型 + 多个轻量适配器

---

### Q10：Prompt Tuning 与 LoRA 有什么本质区别？各自适用什么场景？

**答：**

| 维度 | Prompt Tuning | LoRA |
|------|--------------|------|
| 修改位置 | 输入 embedding 层（添加 soft tokens） | 权重矩阵（替换 Linear） |
| 参数位置 | 输入侧 | 网络内部 |
| 参数量 | 极少（m × d_model） | 较少（2 × r × (d+k)） |
| 推理开销 | 额外 m 个 token 的注意力计算 | 两个小矩阵乘法 |
| 效果 | 小模型差，大模型（10B+）好 | 各规模模型均有良好效果 |
| 适用场景 | 极度参数受限，超大模型 | 通用 PEFT 首选 |

**本质区别**：
- Prompt Tuning：通过"操控输入"来引导模型行为，模型本身不变
- LoRA：通过"修改权重"来改变模型内部的计算，更直接有效

---

### Q11：IA³ 方法的创新点是什么？为什么说它在推理效率上优于 LoRA？

**答：**

**IA³（Infused Adapter by Inhibiting and Amplifying Inner Activations）创新**：

用逐元素缩放向量（而非矩阵乘法）修改注意力和 FFN 的激活值：
```
h_attn = (lₖ ⊙ K) → (lᵥ ⊙ V)   # 缩放 K 和 V
h_ffn = (lff ⊙ FFN_activation)   # 缩放 FFN 中间激活

参数量：约 0.01% 原始参数（比 LoRA 还少）
```

**推理效率优势**：
- LoRA 推理：`h = W₀x + BAx`（需要两个额外矩阵乘法）
- IA³ 推理：`h = (l ⊙ Wx)`（只是逐元素乘法，几乎无开销）
- IA³ 的缩放向量可以直接融入权重：`W_merged = diag(l) × W`，推理时零额外开销

**局限性**：
- 参数量过少，复杂任务表达能力不足
- 不如 LoRA 灵活

---

## QLoRA

### Q12：QLoRA 如何解决 4-bit 量化导致的精度损失问题？

**答：**

QLoRA 用三项技术缓解 4-bit 量化的精度损失：

**1. NF4（NormalFloat 4-bit）量化**：
- 预训练权重近似服从 N(0, σ²) 正态分布
- NF4 使用 16 个等概率分位点量化，信息论最优
- 比 INT4 或 FP4 精度损失更小

**2. BF16 计算精度**：
- 量化只影响存储，计算时反量化为 BF16
- 避免了 INT4 算术运算的累积误差
- 流程：`W₀ (NF4 存储) → 反量化为 BF16 → BF16 矩阵乘法`

**3. 只对 LoRA 参数（BF16）反向传播**：
- 基础权重 W₀ 不参与梯度更新，量化误差不累积
- LoRA 的 A/B 矩阵始终是高精度（BF16）

**实验结果**：QLoRA 在 MMLU 等基准上，与 16-bit LoRA 性能差距 < 1%。

---

### Q13：什么是双重量化（Double Quantization）？它能节省多少显存？

**答：**

**问题**：量化需要存储量化常数（quantization constants），即每组权重的缩放因子。
- 每 64 个参数 → 1 个 FP32 量化常数
- 额外开销：32-bit / 64 = 0.5 bit/param

**双重量化**：将量化常数本身再次量化为 FP8
- 将所有 FP32 量化常数 → FP8 量化
- 每组量化常数（256 个 FP32）→ 用 FP8 量化存储
- 额外开销：8-bit / 256 + 32-bit / (256×256) ≈ 0.127 bit/param

**节省量**：
```
原始：4 bit + 0.5 bit = 4.5 bit/param
双量：4 bit + 0.127 bit = 4.127 bit/param
节省：0.37 bit/param

对 65B 模型：0.37 × 65×10⁹ / 8 ≈ 3 GB
```

---

### Q14：QLoRA 中的分页优化器（Paged Optimizer）是如何工作的？

**答：**

**背景**：大型模型训练时，Adam 优化器需要存储一阶矩和二阶矩，显存占用 = 2 × 模型参数大小。

**分页优化器机制**：
- 利用 NVIDIA GPU 的**统一内存（Unified Memory）**特性
- GPU 显存 → CPU RAM 的自动页面调度
- 当 GPU 显存不足时，将优化器状态自动"page out"到 CPU 内存
- 需要时再"page in"回 GPU

```python
# 使用分页优化器
from bitsandbytes.optim import PagedAdamW8bit

optimizer = PagedAdamW8bit(
    model.parameters(),
    lr=2e-4,
    # 当 GPU OOM 时，自动将优化器状态迁移到 CPU
)

# 或通过 TrainingArguments
training_args = TrainingArguments(optim="paged_adamw_8bit")
```

**效果**：
- 防止因批次大小波动导致的 OOM 崩溃
- 代价：page 操作增加少量延迟（通常 < 5%）
- 特别适合长序列或不规则 batch size

---

### Q15：如何判断一个任务应该使用 LoRA 还是 QLoRA？

**答：**

```
决策矩阵：

条件                              推荐
────────────────────────────────────────────────────────────
GPU VRAM < 16GB                   QLoRA（必须）
GPU VRAM 16~24GB + 模型 7B~13B    QLoRA（推荐）
GPU VRAM ≥ 40GB + 模型 ≤ 13B      LoRA（fp16/bf16）
GPU VRAM ≥ 80GB                    LoRA（高 rank）或全量微调
模型 ≥ 30B                         QLoRA（几乎必须）

追求最高质量（性能优先）           LoRA（不量化）
追求最低成本（成本优先）           QLoRA（4-bit NF4）
生产推理速度敏感                   LoRA + merge_and_unload

QLoRA 与 LoRA 的性能差距：
  - 大多数任务 < 1%（可忽略）
  - 非常复杂任务 1~3%
  - 极低 bit 量化（2-bit）差距更大
```

---

## 工程实践

### Q16：如何选择 target_modules？选错了会有什么影响？

**答：**

**选择策略**：

1. **查模型文档**：不同架构有不同的权重名称
```python
# 查看模型所有线性层
for name, module in model.named_modules():
    if isinstance(module, torch.nn.Linear):
        print(name)
```

2. **常见模型对应**：
```
LLaMA/Mistral：q_proj, k_proj, v_proj, o_proj
GPT-2：        c_attn (包含 Q/K/V), c_proj
BERT：         query, key, value, dense
T5：           q, k, v, o (attention), wi, wo (FFN)
```

3. **错误选择的影响**：
- **漏掉重要层**：效果不如预期，但不会报错
- **包含不支持的层**（如 Embedding）：可能报错或效果差
- **包含太多层**：参数量增加，需要更多显存，但通常效果更好

**推荐**：从小配置开始（q_proj + v_proj），逐步扩大，用验证集评估效果。

---

### Q17：LoRA 训练时，学习率应该如何设置？与全量微调有何不同？

**答：**

**核心差异**：LoRA 的可训练参数是新引入的（从零初始化），而全量微调的参数是预训练权重（已有意义）。

```python
# 全量微调学习率：1e-5 ~ 3e-5（小，防止破坏预训练知识）
# LoRA 学习率：   1e-4 ~ 5e-4（大，从零开始收敛更快）

# 推荐配置：
learning_rate = 2e-4
lr_scheduler_type = "cosine"
warmup_ratio = 0.03

# 注意事项：
# 1. QLoRA 可以使用相同学习率（LoRA 部分是 bf16）
# 2. 高 rank（r=64+）建议降低学习率（1e-4）
# 3. 小数据集（< 1K）建议更小学习率（5e-5）
# 4. 可以对 LoRA 参数和其他参数使用不同学习率（分层 LR）
```

---

### Q18：多个 LoRA 适配器如何合并？合并策略如何选择？

**答：**

**线性合并**（最简单）：
```python
model.add_weighted_adapter(
    adapters=["task1", "task2"],
    weights=[0.6, 0.4],
    combination_type="linear",  # ΔW = 0.6×ΔW₁ + 0.4×ΔW₂
)
# 适用：任务相似，简单场景
```

**TIES 合并**（推荐）：
```python
model.add_weighted_adapter(
    adapters=["task1", "task2"],
    weights=[0.5, 0.5],
    combination_type="ties",
    density=0.3,  # 保留最重要的 30% 参数
)
# 适用：任务有差异，防止参数冲突
# 原理：对每个参数的"符号"进行投票，解决冲突
```

**DARE 合并**：
```python
model.add_weighted_adapter(
    adapters=["task1", "task2"],
    weights=[0.5, 0.5],
    combination_type="dare_linear",
    density=0.5,  # 随机丢弃 50%，防过拟合
)
# 适用：任务差异大，或适配器过多
```

**选择原则**：任务越相似 → linear；任务差异越大 → TIES/DARE。

---

### Q19：如何在推理时加速 LoRA 模型？有哪些优化手段？

**答：**

**方法1：合并权重（最有效）**
```python
model = peft_model.merge_and_unload()
# 消除 LoRA 额外矩阵乘法，推理速度与原始模型相同
```

**方法2：Flash Attention 2**
```python
model = AutoModelForCausalLM.from_pretrained(
    model_id, attn_implementation="flash_attention_2"
)
# 注意力计算 O(n²) → O(n)，长序列提升明显
```

**方法3：BetterTransformer**
```python
from optimum.bettertransformer import BetterTransformer
model = BetterTransformer.transform(model)
# 使用 PyTorch 优化的 Transformer 实现
```

**方法4：量化部署（合并后）**
```python
# 合并 LoRA → GPTQ 量化 → 推理
# 使用 AutoGPTQ 或 llama.cpp 进行 4-bit 量化推理
```

**方法5：vLLM 部署**
```python
# 合并后的模型可以直接用 vLLM 部署
# vLLM 支持 PagedAttention，吞吐量提升 10~20x
```

---

### Q20：LoRA 保存的 adapter_config.json 中包含哪些信息？如何手动加载？

**答：**

```json
{
  "alpha_pattern": {},
  "auto_mapping": null,
  "base_model_name_or_path": "meta-llama/Llama-2-7b-hf",
  "bias": "none",
  "fan_in_fan_out": false,
  "inference_mode": true,
  "init_lora_weights": true,
  "layers_pattern": null,
  "layers_to_transform": null,
  "lora_alpha": 32,
  "lora_dropout": 0.05,
  "modules_to_save": null,
  "peft_type": "LORA",
  "r": 16,
  "revision": null,
  "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj"],
  "task_type": "CAUSAL_LM"
}
```

**手动加载流程**：
```python
import json
from peft import LoraConfig, PeftModel

# 1. 读取配置
with open("adapter_config.json") as f:
    config_dict = json.load(f)

# 2. 重建配置
config = LoraConfig(**{
    k: v for k, v in config_dict.items()
    if k in LoraConfig.__dataclass_fields__
})

# 3. 加载基础模型
base_model = AutoModelForCausalLM.from_pretrained(
    config_dict["base_model_name_or_path"]
)

# 4. 应用适配器
model = PeftModel.from_pretrained(base_model, "./adapter-dir")
```

---

## 进阶技术

### Q21：AdaLoRA 如何实现自适应 rank 分配？与固定 rank LoRA 相比优势是什么？

**答：**

**AdaLoRA 核心思想**：不同权重矩阵对任务的重要性不同，应该动态分配 rank。

**技术实现**：
```
1. 将 LoRA 分解改为 SVD 形式：
   ΔW = U × Λ × Vᵀ
   Λ = diag(λ₁, ..., λᵣ)  ← 对角矩阵，λᵢ 是奇异值

2. 训练时计算每个奇异值的重要性分数：
   Importance(λᵢ) = |λᵢ| × (∑|∂Loss/∂λᵢ|)  ← 值 × 梯度幅度

3. 正则化低重要性的奇异值（惩罚使其趋向零）

4. 剪枝：将 importance 低的奇异值置零（相当于降低 rank）

5. 全局预算约束：总 rank 预算固定，自动在重要矩阵分配更高 rank
```

**优势**：
- 相同参数预算下，比固定 rank LoRA 效果提升 1~3%
- 自动发现哪些矩阵更重要（通常 V/O 矩阵比 Q/K 更重要）
- 更好地利用有限的参数预算

---

### Q22：RSLoRA（Rank-Stabilized LoRA）解决了什么问题？

**答：**

**问题**：标准 LoRA 使用 `alpha/r` 作为 scaling 因子。当 rank r 增大时：
- 若保持 alpha = r（scaling=1），高 rank 梯度不稳定
- 每次改变 r，都需要重新调整 learning rate

**数学分析**：
```
标准 LoRA：output = W₀x + (alpha/r) × BAx

对 A 的梯度：∝ B × ∂Loss/∂h × 1/r

当 r 增大时，单个方向的学习信号 ∝ 1/r 减弱
但参数量 ∝ r 增加，总体学习信号不均衡
```

**RSLoRA 解决方案**：使用 `1/√r` 代替 `1/r`：
```
RSLoRA：output = W₀x + (alpha/√r) × BAx

好处：
- 梯度信号随 r 变化更稳定
- 高 rank（r=64+）时特别有效
- 更换不同 r 值时不需要重新调 learning rate
```

使用：`LoraConfig(r=64, use_rslora=True)`

---

### Q23：DoRA（Weight-Decomposed LoRA）的原理是什么？

**答：**

**DoRA 的洞察**：将权重分解为**方向（direction）**和**幅度（magnitude）**两个分量：
```
W = m × (W / ‖W‖)
   = magnitude × direction

其中 m = ‖W‖（逐列的幅度向量）
```

**DoRA 微调**：
```
W_DoRA = (m / ‖W₀ + BA‖) × (W₀ + BA)

- m：可训练的幅度向量（参数量小）
- W₀ + BA：LoRA 更新后的方向（固定 W₀，训练 BA）
```

**为什么更好**：
- 传统 LoRA 同时更新方向和幅度，两者可能相互干扰
- DoRA 解耦：LoRA 更新方向，m 更新幅度，学习更高效
- 实验上比标准 LoRA 提升 1~2%

使用：`LoraConfig(use_dora=True)`（PEFT 0.9.0+ 支持）

---

### Q24：LoftQ 与 QLoRA 有什么区别？为什么 LoftQ 精度更高？

**答：**

**问题根源**：QLoRA 先量化 W₀，再用随机初始化的 BA 训练：
```
QLoRA 初始状态：h = Q(W₀)x + BAx  ≈ W₀x + 0（因为 B=0）
量化误差：      ε = W₀x - Q(W₀)x  （这个误差在训练初期无法补偿）
```

**LoftQ 解决方案**：通过 SVD 分解量化误差来初始化 BA：
```
迭代优化：
  1. W₀ ≈ Q(W₀) + B₀A₀
  2. 计算残差：R = W₀ - Q(W₀)
  3. SVD 分解残差：R = U × Σ × Vᵀ
  4. B₀ = U[:, :r] × √Σ[:r]
     A₀ = √Σ[:r] × Vᵀ[:r, :]
  5. 用 Q(W₀) + B₀A₀ 逼近 W₀（优化量化方案）
  6. 重复迭代直到收敛
```

**优势**：
- 训练开始时，LoRA 初始值已经补偿了部分量化误差
- 特别对低 bit 量化（2-bit, 3-bit）提升明显
- 比标准 QLoRA 在下游任务上提升 1~3%

---

### Q25：在多 GPU 环境下，LoRA 训练如何处理参数并行？

**答：**

**数据并行（DDP）**：
```python
# 使用 accelerate 启动多卡训练
# accelerate launch --num_processes=4 train.py

from accelerate import Accelerator
accelerator = Accelerator()

model = get_peft_model(base_model, lora_config)
model, optimizer, dataloader = accelerator.prepare(model, optimizer, dataloader)

# LoRA 参数在所有 GPU 上同步梯度（DDP 默认行为）
# 基础模型 W₀ 冻结，不需要梯度同步（节省带宽）
```

**模型并行（大模型）**：
```python
# device_map="auto" 将不同层分配到不同 GPU
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    device_map="auto",  # 自动张量并行
    torch_dtype=torch.bfloat16,
)
# LoRA 参数会跟随对应层分配到相应 GPU
```

**FSDP（全分片数据并行）**：
```python
# 适合超大模型的训练（70B+）
# FSDP 将模型参数、梯度、优化器状态分片到各 GPU
# 注意：PEFT + FSDP 需要特殊配置
training_args = TrainingArguments(
    fsdp="full_shard auto_wrap",
    fsdp_config={"fsdp_state_dict_type": "FULL_STATE_DICT"},
)
```

---

### Q26：如何评估 LoRA 微调的效果？有哪些常用的评估指标和方法？

**答：**

**自动评估**：
```python
# 1. Perplexity（困惑度）：语言模型基础指标
from transformers import pipeline

def evaluate_perplexity(model, tokenizer, test_texts):
    import math
    total_loss = 0
    for text in test_texts:
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            loss = model(**inputs, labels=inputs["input_ids"]).loss
        total_loss += loss.item()
    return math.exp(total_loss / len(test_texts))

# 2. 任务特定指标
# 分类：accuracy, F1
# 生成：BLEU, ROUGE（机器翻译/摘要）
# 代码：pass@k（代码生成正确率）
# 数学：exact match（答案完全匹配）
```

**基准评测**：
```python
# 使用 lm-evaluation-harness
# pip install lm-eval

lm_eval --model hf \
    --model_args pretrained=./merged-model \
    --tasks mmlu,hellaswag,gsm8k \
    --num_fewshot 5 \
    --output_path ./results
```

**人工评估与 LLM-as-Judge**：
```python
# 使用 GPT-4 作为评判者（MT-Bench 风格）
prompt = f"""
请评估以下回答的质量（1-10分）：
问题：{question}
参考答案：{reference}
模型回答：{model_output}

评分标准：准确性、流畅度、完整性
"""
score = gpt4(prompt)
```

**对比实验框架**：
```
对照组：base model（无 LoRA）
实验组：LoRA r=4, r=8, r=16, r=64
测试集：保留 10% 原始数据

关注指标：
  - 目标任务性能（主要指标）
  - 通用能力保留（MMLU/HellaSwag）
  - 推理延迟（tokens/sec）
  - 训练时间（小时/epoch）
```

---

## 参考资料

- [LoRA 原论文](https://arxiv.org/abs/2106.09685)
- [QLoRA 原论文](https://arxiv.org/abs/2305.14314)
- [AdaLoRA 论文](https://arxiv.org/abs/2303.10512)
- [DoRA 论文](https://arxiv.org/abs/2402.09353)
- [LoftQ 论文](https://arxiv.org/abs/2310.08659)
- [RSLoRA 论文](https://arxiv.org/abs/2312.03732)
