# TRL 常见面试题库

> 涵盖 RLHF、DPO、PPO、GRPO 等对齐技术的深度面试题，含详细解答。

## 相关链接

- 对应技术资料：[13-对齐训练技术TRL](../../01-技术资料/07-AI-Agent全栈开发/13-对齐训练技术TRL.md)

## 题目分类

| 类别          | 题号    | 难度     |
| ------------- | ------- | -------- |
| RLHF 基础流程 | Q1~Q5   | ⭐⭐     |
| DPO 原理      | Q6~Q10  | ⭐⭐⭐   |
| PPO 算法      | Q11~Q14 | ⭐⭐⭐   |
| KL 散度与对齐 | Q15~Q17 | ⭐⭐⭐   |
| GRPO 与推理   | Q18~Q21 | ⭐⭐⭐⭐ |
| 工程实践      | Q22~Q26 | ⭐⭐⭐   |

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点             | 核心要点（一句话）                                       | 出题概率 |
| --- | ---------------- | -------------------------------------------------------- | -------- |
| 1   | RLHF 流程        | SFT→训练奖励模型(RM)→PPO优化策略模型                     | ★★★★★    |
| 2   | DPO              | Direct Preference Optimization，跳过RM直接用偏好对训练   | ★★★★★    |
| 3   | PPO vs DPO       | PPO(复杂但灵活)/DPO(简单但受参考模型约束)                | ★★★★★    |
| 4   | 奖励模型         | 人类偏好对→Bradley-Terry模型→pair-wise loss训练          | ★★★★☆    |
| 5   | KL 散度约束      | 防止策略模型偏离参考模型太远(reward hacking)             | ★★★★☆    |
| 6   | SFTTrainer       | TRL的SFT入口，支持packing/chat_template/PEFT集成         | ★★★★☆    |
| 7   | 偏好数据构建     | chosen/rejected对，标注一致性(Inter-annotator agreement) | ★★★★☆    |
| 8   | ORPO/SimPO       | 新一代对齐算法，无需参考模型，更简单                     | ★★★☆☆    |
| 9   | Reward Hacking   | 模型学会骗过RM而非真正对齐，KL约束+RM ensemble           | ★★★★☆    |
| 10  | 在线 vs 离线对齐 | PPO=在线(采样+评估)/DPO=离线(静态数据集)                 | ★★★☆☆    |

---

## RLHF 基础流程

### Q1：RLHF 的完整流水线包含哪些步骤？每个步骤的目标是什么？

**答：**

RLHF（Reinforcement Learning from Human Feedback）包含三个阶段：

**Stage 1：SFT（监督微调）**

```
目标：教会模型理解指令并生成有用的回复
数据：高质量的 (instruction, response) 对
方法：标准语言模型训练（最大化 response 的对数似然）
输出：SFT 模型（具备基础指令遵循能力）
```

**Stage 2：奖励模型训练（Reward Modeling）**

```
目标：学习评估回复质量，给出人类偏好分数
数据：(prompt, chosen_response, rejected_response) 三元组
      人类标注员判断哪个回复更好
方法：Bradley-Terry 模型
      Loss = -log σ(r_chosen - r_rejected)
输出：奖励模型 RM（输入 prompt+response，输出标量分数）
```

**Stage 3：PPO 强化学习对齐**

```
目标：用奖励信号指导策略优化，使模型输出更符合人类偏好
方法：PPO（近端策略优化）
      总 reward = RM_score - β × KL(policy || ref)
      β：KL 惩罚系数，防止 reward hacking
输出：对齐后的模型（遵循人类偏好，如 InstructGPT、ChatGPT）
```

---

### Q2：为什么 RLHF 需要 KL 散度惩罚？没有它会发生什么？

**答：**

**KL 散度惩罚的作用**：

```
总 reward = RM_score - β × KL(π_policy || π_ref)
```

防止 **Reward Hacking**：

- 策略会学习"欺骗"奖励模型，生成获得高分但实际无用的回复
- 例如：发现奖励模型倾向于打高分给"冗长详细"的回复，就生成充满废话的超长回复

**没有 KL 惩罚会发生什么**：

1. 模型退化为奖励最大化机器（而非对用户有帮助的助手）
2. 语言质量下降（重复、乱码、不相关内容）
3. 遗忘预训练学到的世界知识
4. 输出越来越偏离真实语言分布

**β 的调节**：

- β 过小 → Reward Hacking 风险高
- β 过大 → policy 无法有效更新（被束缚在 reference 附近）
- PPO 通常使用自适应 KL 控制，动态调整 β 使 KL ≈ target_kl

---

### Q3：奖励模型如何构建？它的训练数据应该具备什么特性？

**答：**

**奖励模型构建**：

- 基于预训练语言模型（通常是 SFT 模型）
- 在最后一层添加线性 scalar head
- 输入：prompt + response（完整序列）
- 输出：单个标量分数

**损失函数（Bradley-Terry）**：

```python
loss = -log σ(r_chosen - r_rejected)

# 等价于：最大化 chosen > rejected 的概率
```

**训练数据要求**：

1. **多样性**：覆盖不同任务类型、难度级别
2. **标注一致性**：标注员之间对"好回答"的判断标准一致
3. **差异性**：chosen 和 rejected 有明显质量差异（太相似则无信息）
4. **规模**：通常需要 > 10K 对才能训练出可靠的 RM
5. **分布匹配**：数据分布要与实际使用 prompt 相近

**评估指标**：

- Accuracy = chosen 得分 > rejected 得分的比例
- 优秀 RM：> 75%；基线随机：50%

---

### Q4：SFT 阶段的训练数据和奖励模型的训练数据有什么区别？

**答：**

| 维度         | SFT 数据                     | 奖励模型数据                       |
| ------------ | ---------------------------- | ---------------------------------- |
| **格式**     | (instruction, response) 单对 | (prompt, chosen, rejected) 三元组  |
| **标注要求** | 高质量单一回复               | 相对偏好比较（哪个更好）           |
| **标注难度** | 需要写出好回答               | 只需判断"A vs B 哪个更好"          |
| **数量要求** | 万级别足够                   | 需要较多对（10K+）                 |
| **多样性**   | 需要覆盖各类任务             | 需要覆盖各类 prompt + 不同质量回复 |
| **来源**     | 专家书写，ChatGPT 蒸馏       | 人类偏好标注，LLM-as-Judge         |

关键区别：奖励模型不关心"绝对质量"，只关心"相对偏好"，这使得标注更容易（比较比创作容易）。

---

### Q5：为什么 RLHF 难以训练？有哪些主要挑战？

**答：**

**挑战1：高方差策略梯度**

- PPO 使用蒙特卡洛估计，方差大，训练不稳定
- 解决：GAE（广义优势估计）、多次 epoch 更新

**挑战2：奖励模型不完美**

- RM 是从有限标注数据训练的，有偏差
- Policy 会发现 RM 的弱点并利用（Reward Hacking）

**挑战3：同时维护多个模型**

- Policy、Reference、Reward Model、Critic
- 内存需求是 SFT 的 4~5 倍
- 各模型的更新时机需要精心协调

**挑战4：超参数敏感**

- PPO clip、KL 系数、学习率、batch size 等超参数相互影响
- 调参困难，需要大量实验

**挑战5：人类标注成本**

- 获取高质量人类偏好数据昂贵且慢
- 标注者偏见（sycophancy bias：倾向于更长、更自信的回答）

这也是 DPO 等简化方法出现的原因。

---

## DPO 原理

### Q6：DPO 如何在不使用奖励模型的情况下进行对齐训练？

**答：**

DPO 的关键洞察：**RLHF 的最优解可以表达为 policy 的函数，无需显式建模奖励**。

**推导过程**：

```
1. RLHF 最优策略具有解析解：
   π*(y|x) ∝ π_ref(y|x) × exp(r(x,y)/β)

2. 反解奖励函数：
   r(x, y) = β × log(π*(y|x)/π_ref(y|x)) + β × log Z(x)

3. 代入 Bradley-Terry 偏好模型：
   P(y_w > y_l|x) = σ(r(x,y_w) - r(x,y_l))
                  = σ(β × log(π(y_w|x)/π_ref(y_w|x))
                       - β × log(π(y_l|x)/π_ref(y_l|x)))

4. 用 π_θ 代替 π*，得到 DPO 损失：
   L_DPO = -E[log σ(β × log(π_θ(y_w|x)/π_ref(y_w|x))
                    - β × log(π_θ(y_l|x)/π_ref(y_l|x)))]
```

**直觉**：DPO 隐式地训练了一个奖励函数（由 policy/reference 的比值定义），但不需要显式建模。

---

### Q7：DPO 中的 β 参数代表什么？如何调节？

**答：**

β 在 DPO 中控制 **policy 可以偏离参考模型（SFT 模型）的程度**：

```python
L_DPO = -E[log σ(β × (advantage_chosen - advantage_rejected))]

其中 advantage = log(π_θ(y|x)/π_ref(y|x))
```

**β 的影响**：

```
β 大（0.5~1.0）：
  → 约束更强，policy 必须接近 π_ref
  → 对齐效果有限，但预训练知识保留好
  → 训练更稳定

β 小（0.01~0.1）：
  → 约束弱，policy 可以大幅偏离 π_ref
  → 对齐效果更强
  → 可能过度对齐（忘记预训练知识）

典型值：β = 0.1（大多数 DPO 论文默认值）
```

**调节建议**：

- 先用 β=0.1 作为起点
- 若 chosen 概率持续下降：增大 β（保护 SFT 知识）
- 若 margin 增长缓慢：减小 β（允许更大更新）

---

### Q8：DPO 损失函数中有哪两个"相对比较"？各自的作用是什么？

**答：**

DPO 损失中有两层"相对"：

**第一层：相对于参考模型（Reference Model）**

```
log(π_θ(y|x) / π_ref(y|x))
```

含义：policy 对这个回答的"额外倾向"（相对于 reference）
作用：确保不会单纯学习"哪些词常见"，而是学习"什么更符合人类偏好"

**第二层：chosen vs rejected 的对比**

```
log(π_θ(y_w|x)/π_ref(y_w|x)) - log(π_θ(y_l|x)/π_ref(y_l|x))
```

含义：policy 对 chosen 的相对倾向 > policy 对 rejected 的相对倾向
作用：直接最大化偏好差距

**两层相对的必要性**：

- 只有第一层（vs ref）：能保持与 SFT 的距离，但不知道方向
- 只有第二层（chosen vs rejected）：会简单地提高 chosen 的绝对概率（可能忘记 reference）
- 两层结合：在保持与 reference 合理距离的同时，学习人类偏好方向

---

### Q9：如何准备 DPO 的训练数据？chosen 和 rejected 的质量差异需要多大？

**答：**

**数据格式**：

```python
{"prompt": "...", "chosen": "...", "rejected": "..."}
```

**质量差异的影响**：

- **差异太小**（相似度 > 90%）：
  - 损失信号弱，训练难以收敛
  - 模型学不到明确的偏好方向
  - 建议过滤掉（similarity < 0.9 作为阈值）

- **差异适中**（相似度 60~90%）：
  - 最理想的范围
  - 提供清晰的偏好信号

- **差异太大**（chosen 非常好，rejected 非常差）：
  - 损失快速下降，但可能学到"表面特征"
  - 泛化性可能较差

**高质量 DPO 数据的特征**：

1. chosen 和 rejected 回答同一个 prompt
2. chosen 明显更准确、更有帮助或更安全
3. 两者都是合理的（不是乱码 vs 好回答）
4. 覆盖多种任务类型
5. 避免数据标注者偏见（如长 = 好的偏见）

---

### Q10：DPO 相比 PPO 有什么优势和局限性？

**答：**

**DPO 优势**：

```
1. 简单：不需要奖励模型和 Critic，代码更少
2. 稳定：监督学习范式，比策略梯度方差小
3. 高效：只需维护 policy + reference（2 个模型 vs PPO 的 4 个）
3. 可调参数少：主要就是 β 和学习率
4. 实践效果好：多项论文显示接近甚至超过 PPO
```

**DPO 局限性**：

```
1. 需要高质量偏好数据（成对标注）
   - PPO 可以使用任何奖励信号（包括规则、执行结果）
   - DPO 必须有 (chosen, rejected) 对

2. 静态数据（非在线学习）
   - PPO 可以根据当前 policy 生成数据（online RL）
   - DPO 使用固定数据集（offline）
   - 当前 policy 与收集数据的 policy 差异大时，可能效果差

3. 难以优化不可微的目标
   - 代码执行、事实准确性等可用规则评估的目标
   - PPO/GRPO 可以用任意奖励函数
   - DPO 必须将偏好转化为成对比较

4. 长序列时可能不稳定
   - 长回答的对数概率和较大，训练不稳定
   - 解决：SimPO 的长度归一化
```

---

## PPO 算法

### Q11：PPO 的 Clip 目标函数在 NLP 语境下起什么作用？

**答：**

**PPO Clip 目标**：

```python
ratio = π_θ(a|s) / π_old(a|s)  # 新旧策略的概率比

L_CLIP = E[min(ratio × A, clip(ratio, 1-ε, 1+ε) × A)]

A = 优势函数（当前回答比 baseline 好多少）
ε = 0.2（通常值）
```

**在 NLP 中的意义**：

- `ratio` 是每个 token 的新策略概率 / 旧策略概率
- 若某 token 的概率变化过大（ratio < 1-ε 或 > 1+ε），梯度被截断
- 作用：防止单次更新过大，维持训练稳定性

**直觉理解**：

```
想象 PPO 在说：
"我想提高这个 token 的概率（优势 > 0），
但如果我已经把它的概率提高了 20%，
我就先停下来，等下次再说。"

这防止了：一次性把某些 token 的概率推得太高，
导致语言分布崩溃。
```

---

### Q12：PPO 训练 LLM 时为什么需要 Value Head（Critic）？Value Head 如何训练？

**答：**

**为什么需要 Value Head**：

PPO 使用 GAE（Generalized Advantage Estimation）计算优势：

```
A_t = r_t + γ × V(s_{t+1}) - V(s_t)

V(s)：状态价值函数 = 从当前状态开始的期望累积奖励
```

没有 V(s)：只能用蒙特卡洛（MC）估计，方差极大
有了 V(s)：用 TD 差分，方差大幅降低，训练更稳定

**Value Head 结构**：

```python
# 在 LM 之上添加一个线性层
class ValueHead(nn.Module):
    def __init__(self, hidden_size):
        self.linear = nn.Linear(hidden_size, 1)

    def forward(self, hidden_states):
        # 取每个 token 的 hidden state，预测该状态的价值
        return self.linear(hidden_states).squeeze(-1)
```

**训练方式**：

- 与 policy 联合训练（共享基础模型，不同头）
- Value Loss：`L_VF = E[(V(s) - r_cumulative)²]`（均方误差）
- 是 GRPO 省掉 Critic 的主要动机（Value Head 与 policy 规模相同，代价高）

---

### Q13：PPO 的 clip ratio 和 KL 惩罚的关系是什么？两者能否同时使用？

**答：**

**clip ratio（PPO-Clip）**：

- 在更新时限制策略变化幅度
- 通过截断 ratio = π_new/π_old 来限制
- 是算法层面的约束

**KL 惩罚**：

- 在奖励函数中加 KL 项：total_reward = task_reward - β × KL
- 防止策略偏离参考模型（SFT 模型）
- 是任务层面的约束

**两者的区别**：

```
clip ratio：限制 π_new 与 π_old（上一步 policy）的差异
           → 短期约束（每步更新）

KL 惩罚：  限制 π_policy 与 π_ref（SFT 模型）的差异
          → 长期约束（全局）
```

**是否可以同时使用**：可以，且 PPO-RLHF 通常同时使用：

- clip ratio 保证训练稳定（每步不过激进）
- KL 惩罚保证对齐安全（全程不偏离太远）

PPO-clip 论文本身是 clip 作为 KL 惩罚的替代，但在 LLM 对齐场景，两者目的不同，通常同时使用。

---

### Q14：如何评判 PPO 训练是否在正常运行？关键指标有哪些？

**答：**

**正常训练的信号**：

```
✅ ppo/mean_scores（平均奖励）：稳定上升
✅ objective/kl（KL 散度）：在 target_kl 附近（通常 6~15）
✅ ppo/loss/policy（策略损失）：稳定下降
✅ ppo/val/clipfrac：0.1~0.3（clip 比例合理）
✅ env/reward_mean：与 ppo/mean_scores 一致上升
```

**问题信号**：

```
❌ mean_scores 不上升 → 奖励模型质量差，或学习率太低
❌ KL >> target_kl → β 太小，Reward Hacking 开始
❌ KL ≈ 0 → 策略没有在更新，β 太大或学习率太低
❌ clipfrac → 1.0 → 步长太大，训练不稳定
❌ loss 出现 NaN → 梯度爆炸，降低学习率
❌ response 越来越长 → 奖励模型偏好长回答，Length Reward Hacking
```

---

## KL 散度与对齐

### Q15：KL 散度在 LLM 对齐中有哪些不同的用途？

**答：**

**1. PPO 中的 KL 惩罚**（在奖励函数中）：

```python
reward = rm_score - β × KL(policy || reference)
# 防止策略偏离 SFT 模型（Reward Hacking 预防）
```

**2. DPO 中的隐式 KL 约束**（在损失函数中）：

```python
# DPO 的推导基于 RLHF 的 KL 约束优化
# β 控制偏好学习的"保守程度"
```

**3. 模型蒸馏**（KL 作为训练目标）：

```python
L_distill = KL(teacher_distribution || student_distribution)
# 让学生模型学习教师模型的输出分布
```

**4. 监控偏离程度**（评估时）：

```python
# 衡量对齐训练后模型偏离 SFT 模型的程度
# 过大的 KL 可能意味着遗忘了预训练知识
```

---

### Q16：什么情况下 DPO 训练会导致"偏好对齐但通用能力下降"？

**答：**

**现象**：DPO 后，模型在偏好任务上变好，但 MMLU、HellaSwag 等通用基准下降。

**原因分析**：

1. **β 过小**：允许 policy 大幅偏离 reference，遗忘预训练知识
2. **数据分布窄**：偏好数据只覆盖某类任务，对其他任务过拟合
3. **训练轮次过多**：DPO 本质上是在"改变"模型行为，过度训练会侵蚀泛化性
4. **Reference 模型问题**：若 reference 本身质量差，对齐方向就不准

**解决方案**：

```python
# 1. 增大 β（更保守的对齐）
dpo_config = DPOConfig(beta=0.3)  # 默认 0.1 → 增大到 0.3

# 2. 减少训练轮次
dpo_config = DPOConfig(num_train_epochs=1)  # 1 epoch 通常足够

# 3. 使用多样的偏好数据集
# 不只是对话，还要包含知识推理、代码等

# 4. 在评估中监控通用能力（不只看偏好任务）
from lm_eval import simple_evaluate
results = simple_evaluate(model, tasks=["mmlu", "hellaswag", "gsm8k"])
```

---

### Q17：如何构建高质量的偏好数据集以避免 Sycophancy（谄媚）问题？

**答：**

**Sycophancy 问题**：

- 标注者偏向"听起来令人印象深刻"的回答，而不是"实际上正确"的回答
- 导致模型学会迎合（长篇大论但不准确），而不是真正有用

**检测 Sycophancy**：

```python
# 测试：改变提问者的立场，看模型是否改变答案
prompt_1 = "地球是圆的吗？"
prompt_2 = "我认为地球是平的，你同意吗？"

if model_answer(prompt_1) != model_answer(prompt_2):
    print("⚠️ 模型可能有 sycophancy 问题！")
```

**数据构建防范措施**：

1. **基于事实验证的偏好**：chosen = 事实正确的；rejected = 事实错误的
2. **使用多个标注员**并取一致性判断
3. **专家标注**（对知识密集型任务）
4. **自动化验证**：能执行/验证的任务（数学、代码）用规则判断正确性
5. **Reward Model 校准**：检查 RM 是否倾向于给长回答打高分

---

## GRPO 与推理

### Q18：GRPO 如何用"组采样"代替 Critic？数学上是否等价？

**答：**

**PPO 中的 Critic（Value Function）**：

```python
# Critic 估计 baseline V(s)
# 优势 = 实际 reward - 期望 reward（baseline）
advantage = actual_reward - critic(state)  # V(s) 是 baseline
```

**GRPO 的组采样 baseline**：

```python
# 对每个 prompt 采样 G 个回答
responses = [policy.generate(prompt) for _ in range(G)]  # G = 8

# 计算每个回答的奖励
rewards = [reward_fn(r) for r in responses]

# 组内均值作为 baseline（代替 Critic）
baseline = mean(rewards)

# 优势 = 奖励 - 组内均值
advantages = [(r - baseline) / std(rewards) for r in rewards]
```

**数学等价性**：

- **不完全等价**，但在期望意义下近似：
  - Critic：E_π[V(s)]（对所有状态的期望）
  - 组采样均值：V̂ = 1/G × Σrᵢ（蒙特卡洛近似）
  - 当 G → ∞，两者收敛
- 实践中 G=8 通常已经足够好

**优势**：GRPO 无需 Critic 网络（节省 50% 模型显存），且 baseline 更稳定（Critic 本身需要训练）

---

### Q19：DeepSeek-R1 使用 GRPO 的奖励函数是怎么设计的？为什么不用奖励模型？

**答：**

**DeepSeek-R1 的奖励设计**（基于规则）：

```python
def r1_reward(response, ground_truth):
    """
    DeepSeek-R1 的混合奖励函数
    """
    reward = 0.0

    # 1. 准确性奖励（最重要，权重最大）
    extracted = extract_boxed_answer(response)  # LaTeX \boxed{} 格式
    if extracted == ground_truth:
        reward += 1.0
    elif is_approximately_equal(extracted, ground_truth):
        reward += 0.5

    # 2. 格式奖励（鼓励思考过程）
    if has_thinking_process(response):    # <think>...</think>
        reward += 0.3
    if has_proper_structure(response):    # 结构清晰
        reward += 0.2

    return reward
```

**为什么不用奖励模型**：

1. **可验证性**：数学答案可以程序验证，无需 RM
2. **无 Reward Hacking**：规则是确定性的，无法被"欺骗"
3. **数据无关**：不需要人工标注偏好数据
4. **计算省**：每次生成后直接规则判断，无需 RM 前向传播
5. **适用范围**：只适合有明确正确答案的任务（数学、代码、逻辑推理）

---

### Q20：GRPO 与 PPO 在 LLM 推理能力提升中，哪个更适合？为什么？

**答：**

**GRPO 更适合推理能力提升**，原因：

**1. 无需人工偏好数据**：

- PPO 需要奖励模型，通常来自人工标注的偏好数据
- 推理任务（数学/代码）有客观正确答案，可以用程序自动验证
- GRPO 可以直接使用"答案是否正确"作为奖励

**2. 组采样促进探索**：

- 每个 prompt 采样 G=8 个回答，包含不同的推理路径
- 正确路径得高奖励 → 被鼓励
- 错误路径得低奖励 → 被抑制
- 自然地发现有效的推理策略

**3. 更稳定**：

- 推理任务奖励稀疏（只有最终答案对才得分）
- GRPO 的组内归一化减小方差，比 PPO 更稳定

**4. 实际效果（DeepSeek-R1 验证）**：

- R1 用 GRPO 在数学推理上超越了很多 PPO 对齐的模型
- 引发了"reasoning via RL"的研究热潮

---

### Q21：什么是 "Chain-of-Thought via RL"？GRPO 如何激励模型自发学习推理？

**答：**

**现象**：DeepSeek-R1 在纯 GRPO 训练（无 CoT 监督数据）下，自发学习了：

- 逐步推理
- 自我反思（"我的上一步可能有误，让我重新检查..."）
- 多种解题策略尝试

**机制解析**：

```
初始状态：
  模型随机生成 8 个回答
  短回答和长推理回答都有

奖励信号：
  纯正确性奖励（答对 = 1，答错 = 0）

训练过程中的发现：
  1. 长推理回答因为有更多"尝试空间"，正确率更高
  2. 模型学到：更长的思考过程 = 更多正确答案
  3. 自发出现 CoT 模式（因为 CoT 能提高正确率从而获得更高奖励）

关键：
  - 没有明确教模型"你应该推理"
  - 而是通过奖励信号，模型自己发现"推理有助于得分"
  - 这是 Emergent Behavior（涌现行为）
```

这说明：对于推理任务，正确性奖励本身就足以诱导 CoT 的涌现，无需专门的 CoT 训练数据。

---

## 工程实践

### Q22：如何构建一个完整的 SFT → DPO 训练流水线？关键步骤有哪些？

**答：**

```
完整流水线：

Step 1: 数据准备
  ├─ SFT 数据：instruction-response 对（Alpaca 格式）
  └─ 偏好数据：(prompt, chosen, rejected)（UltraFeedback 等）

Step 2: SFT 训练
  ├─ 模型：LLaMA-2-7B（或其他基础模型）
  ├─ 方法：QLoRA（r=16, alpha=32）
  ├─ 轮次：3 epochs
  └─ 输出：SFT checkpoint（含 LoRA adapter）

Step 3: 合并 SFT adapter（可选，为 DPO 准备）
  ├─ merge_and_unload()
  └─ 输出：完整 SFT 模型权重

Step 4: DPO 训练
  ├─ Policy：SFT 模型 + LoRA（r=16）
  ├─ Reference：SFT 模型（固定）
  ├─ β：0.1
  ├─ 轮次：1~2 epochs
  └─ 输出：DPO 适配器

Step 5: 评估
  ├─ AlpacaEval：对话质量评估
  ├─ MT-Bench：多轮对话质量
  ├─ MMLU：通用知识保留
  └─ Human Eval：人工评估

Step 6: 合并与部署
  ├─ merge DPO adapter
  └─ 量化（GPTQ/AWQ）→ 部署（vLLM）
```

---

### Q23：DPO 训练时 rewards_accuracies 指标很低（< 60%），该如何排查？

**答：**

`rewards_accuracies` = chosen 隐式奖励 > rejected 隐式奖励的比例。< 60% 说明模型没有有效地学习偏好。

**排查清单**：

1. **数据质量检查**：

```python
# 检查 chosen 和 rejected 是否反了
# 抽取 10 条，人工验证
for i in range(10):
    print(f"Chosen: {dataset[i]['chosen'][:100]}")
    print(f"Rejected: {dataset[i]['rejected'][:100]}")
    print("---")
```

2. **学习率检查**：

```python
# DPO 学习率通常很小！5e-7 ~ 2e-6
# 如果用了 SFT 的学习率（2e-4），会不稳定
dpo_config = DPOConfig(learning_rate=5e-7)  # 很小的学习率
```

3. **β 值检查**：

```python
# β 太大会抑制更新
dpo_config = DPOConfig(beta=0.05)  # 尝试降低 β
```

4. **序列长度检查**：

```python
# max_length 是否足够？
# 如果 chosen 被截断，信息丢失
dpo_config = DPOConfig(max_length=2048, max_prompt_length=512)
```

5. **Reference 模型检查**：

```python
# 确认 ref_model 就是 SFT 模型（不是随机初始化的）
# 如果是 PEFT 模型，ref_model=None 时会禁用 adapter 作 reference
```

---

### Q24：如何防止 DPO 训练中的"chosen 概率下降"现象？

**答：**

**现象**：训练过程中，`logps_chosen`（chosen 回答的对数概率）不断下降。

**原因**：DPO 的目标是最大化 `chosen 相对于 ref 的概率` > `rejected 相对于 ref 的概率`。这个目标可以通过**降低 chosen 的绝对概率**来满足（只要 chosen 下降得比 rejected 慢）。

**危害**：

- 模型变得对 chosen 回答也不"确信"
- 生成质量下降
- 过度遗忘 SFT 知识

**解决方案**：

```python
# 方案1：增大 β（更保守）
dpo_config = DPOConfig(beta=0.3)  # 从 0.1 增到 0.3

# 方案2：使用 IPO 损失（不受 β 影响）
dpo_config = DPOConfig(loss_type="ipo")

# 方案3：添加 SFT 损失（保持 chosen 的对数概率）
# 在 DPO 损失中加入对 chosen 的 SFT 损失
# ORPO 就是这样做的：L = L_SFT + λ × L_OR

# 方案4：减少训练轮次
dpo_config = DPOConfig(num_train_epochs=1)
```

---

### Q25：如何正确设置 DPOTrainer 中的 ref_model？PEFT 和非 PEFT 有何区别？

**答：**

**非 PEFT 模型**（全参数）：

```python
# 必须显式提供 ref_model
ref_model = AutoModelForCausalLM.from_pretrained(sft_model_path)
# ref_model 在整个训练中保持冻结

trainer = DPOTrainer(
    model=policy_model,
    ref_model=ref_model,    # 必须提供
    ...
)
```

**PEFT 模型（LoRA）**：

```python
# 两种选择：

# 选择1：ref_model=None（推荐，节省内存）
# DPOTrainer 会自动禁用 LoRA adapter 作为参考模型
# 等效于：使用基础模型（pre-adapter）作 reference
trainer = DPOTrainer(
    model=peft_model,
    ref_model=None,   # 自动使用禁用 adapter 的基础模型
    ...
)

# 选择2：显式提供 ref_model（更灵活）
ref_peft_model = PeftModel.from_pretrained(
    base_model, sft_adapter_path
)
trainer = DPOTrainer(
    model=policy_model,
    ref_model=ref_peft_model,
    ...
)
```

**注意**：

- PEFT + `ref_model=None` 要求 policy 和 reference 使用相同的基础模型
- 这在大多数情况下是正确的（SFT → DPO 都基于同一基础模型）

---

### Q26：常见的对齐失败模式有哪些？如何在训练过程中早期发现？

**答：**

**失败模式1：过度对齐（Sycophancy）**

```
症状：模型变得"过于顺从"，不敢给出否定意见
检测：测试模型对明显错误观点的反应
     "地球是平的，对吗？" → 对齐好的模型应该纠正，而不是迎合
预防：偏好数据中包含"坚持正确立场"的正面示例
```

**失败模式2：Reward Hacking**

```
症状：reward 快速上升，但回答质量实际下降
     KL 散度持续增大（> target_kl 的 2 倍）
检测：人工评估生成内容，对比 SFT 和 RL 后的输出
预防：增大 β（KL 惩罚），使用多 RM 集成
```

**失败模式3：遗忘（Catastrophic Forgetting）**

```
症状：通用基准（MMLU）下降 > 3%
检测：每 100 steps 评估一次 MMLU（快速版）
预防：增大 β，减少训练轮次，使用多样偏好数据
```

**失败模式4：重复输出（Mode Collapse）**

```
症状：模型总是生成相似的回答，多样性丧失
检测：计算多次生成的 Self-BLEU（越低越多样）
预防：保持适当的采样温度，避免 KL 约束过强
```

**早期预警系统**：

```python
class EarlyWarningCallback(TrainerCallback):
    def on_evaluate(self, args, state, control, metrics, **kwargs):
        # 警告1：奖励准确率过低
        if metrics.get("eval/rewards_accuracies", 1) < 0.5:
            print(f"⚠️ Step {state.global_step}: 偏好准确率 < 50%！")

        # 警告2：margin 为负
        if metrics.get("eval/rewards_margins", 1) < 0:
            print(f"❌ Step {state.global_step}: reward margin 为负！")

        # 警告3：chosen logps 显著下降
        if metrics.get("eval/logps_chosen", 0) < -500:
            print(f"⚠️ Step {state.global_step}: chosen 对数概率过低！")
```

---

## 参考资料

- [InstructGPT/RLHF 论文](https://arxiv.org/abs/2203.02155)
- [DPO 论文](https://arxiv.org/abs/2305.18290)
- [PPO 原论文](https://arxiv.org/abs/1707.06347)
- [GRPO/DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948)
- [TRL 官方文档](https://huggingface.co/docs/trl)
- [Zephyr DPO 训练报告](https://arxiv.org/abs/2310.16944)
- [SimPO 论文](https://arxiv.org/abs/2405.14734)
