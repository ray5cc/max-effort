# TensorFlow 常见面试题库

> 涵盖初级、中级、高级共 30+ 道面试题，每题附详细答案，适合面试备考与技术复盘。

## 相关链接

- 对应技术资料：[../../01-技术资料/04-算法与数据结构/01-TensorFlow/00-项目综述与技术原理.md](../../01-技术资料/04-算法与数据结构/01-TensorFlow/00-项目综述与技术原理.md)
- 架构详解：[../../01-技术资料/04-算法与数据结构/01-TensorFlow/01-架构详解与核心组件.md](../../01-技术资料/04-算法与数据结构/01-TensorFlow/01-架构详解与核心组件.md)
- 工程实践：[../../01-技术资料/04-算法与数据结构/01-TensorFlow/02-生产应用与工程实践.md](../../01-技术资料/04-算法与数据结构/01-TensorFlow/02-生产应用与工程实践.md)


## 题目索引

| 编号 | 题目 | 难度 | 分类 |
|------|------|------|------|
| Q01 | TensorFlow 是什么？与 NumPy 有何区别？ | 初级 | 基础概念 |
| Q02 | 什么是张量（Tensor）？与矩阵的区别？ | 初级 | 基础概念 |
| Q03 | TF 1.x 和 TF 2.x 的主要区别？ | 初级 | 基础概念 |
| Q04 | 什么是 Eager Execution？有什么优缺点？ | 初级 | 基础概念 |
| Q05 | `@tf.function` 的作用和工作原理？ | 中级 | 图执行 |
| Q06 | 计算图（Computation Graph）如何执行？ | 中级 | 架构原理 |
| Q07 | `tf.Variable` vs `tf.constant` 的区别？ | 初级 | 基础概念 |
| Q08 | GradientTape 的原理与使用方式？ | 中级 | 自动微分 |
| Q09 | Keras 三种 API 的区别与适用场景？ | 初级 | Keras |
| Q10 | `model.fit()` vs 自定义训练循环的选择？ | 中级 | 训练 |
| Q11 | 什么是 Callback？常用 Callback 有哪些？ | 初级 | 训练 |
| Q12 | tf.data 流水线如何优化性能？ | 中级 | 数据流水线 |
| Q13 | SavedModel 格式的结构和用途？ | 中级 | 部署 |
| Q14 | TF Serving 的架构和工作原理？ | 中级 | 部署 |
| Q15 | REST vs gRPC 接口的选择？ | 中级 | 部署 |
| Q16 | TFLite 转换流程和量化方式？ | 中级 | 边缘部署 |
| Q17 | 分布式训练策略有哪些？各自适用场景？ | 中级 | 分布式 |
| Q18 | All-Reduce vs Parameter Server 的区别？ | 高级 | 分布式 |
| Q19 | XLA 编译器做了哪些优化？ | 高级 | 性能优化 |
| Q20 | 混合精度训练的原理和注意事项？ | 高级 | 性能优化 |
| Q21 | 如何自定义 Keras Layer 和 Loss？ | 中级 | Keras 进阶 |
| Q22 | 梯度消失/爆炸的原因和解决方案？ | 中级 | 训练调优 |
| Q23 | Batch Normalization 的原理和作用？ | 中级 | 训练调优 |
| Q24 | 什么是 tf.function 的 tracing 机制？ | 高级 | 图执行 |
| Q25 | 如何在 TF 中实现自定义梯度？ | 高级 | 自动微分 |
| Q26 | TensorBoard Profiler 如何定位性能瓶颈？ | 中级 | 性能分析 |
| Q27 | 如何进行模型剪枝和知识蒸馏？ | 高级 | 模型压缩 |
| Q28 | TF Serving 如何实现无停机模型热更新？ | 高级 | 部署运维 |
| Q29 | TensorFlow 和 PyTorch 的核心差异？ | 中级 | 横向对比 |
| Q30 | 如何解决训练和推理的 training flag 问题？ | 中级 | 实践陷阱 |
| Q31 | tf.data 中 cache() 应该放在哪个位置？ | 中级 | 数据流水线 |
| Q32 | 如何实现 Learning Rate Warmup + Decay？ | 中级 | 训练调优 |

---

## 初级题目

### Q01 🟢 TensorFlow 是什么？与 NumPy 有何区别？

**参考答案：**

TensorFlow 是 Google 开发的端到端开源机器学习框架，核心能力包括：
1. **自动微分**：通过 `GradientTape` 自动计算梯度
2. **硬件加速**：原生支持 GPU/TPU 并行计算
3. **计算图优化**：`@tf.function` 编译为图，支持算子融合等优化
4. **完整部署链路**：TF Serving、TFLite、TF.js

**与 NumPy 的核心区别：**

| 维度 | NumPy | TensorFlow |
|------|-------|-----------|
| 硬件 | 仅 CPU | CPU / GPU / TPU |
| 自动微分 | 无 | `GradientTape` |
| 分布式 | 无 | `tf.distribute.Strategy` |
| 计算方式 | 即时求值 | Eager + 可选 Graph |
| 数据类型 | `ndarray` | `tf.Tensor` |
| 互操作 | - | `.numpy()` 互转 |

```python
import numpy as np, tensorflow as tf

# NumPy 无法自动求导
x_np = np.array([2.0])
y_np = x_np ** 2  # y = x²，但无法得到 dy/dx

# TensorFlow 可以
x_tf = tf.Variable([2.0])
with tf.GradientTape() as tape:
    y_tf = x_tf ** 2
dy_dx = tape.gradient(y_tf, x_tf)  # → [4.0]
```

---

### Q02 🟢 什么是张量（Tensor）？与矩阵的区别？

**参考答案：**

张量是多维数组的泛化概念，通过**秩（rank）**描述维度数量：

| 秩 | 名称 | 例子 | 形状 |
|----|------|------|------|
| 0 | 标量（Scalar） | 温度值 3.14 | `()` |
| 1 | 向量（Vector） | 特征向量 | `(n,)` |
| 2 | 矩阵（Matrix） | 权重矩阵 | `(m, n)` |
| 3 | 3D 张量 | 文本序列批次 | `(batch, seq, dim)` |
| 4 | 4D 张量 | 图像批次 | `(batch, H, W, C)` |

矩阵是秩为 2 的特殊张量。张量的关键属性：`dtype`（数据类型）、`shape`（各维度大小）、`device`（所在设备）。

---

### Q03 🟢 TF 1.x 和 TF 2.x 的主要区别？

**参考答案：**

| 维度 | TF 1.x | TF 2.x |
|------|--------|--------|
| 执行模式 | 静态图（先建图再 `sess.run()`） | Eager 默认（立即执行） |
| 调试 | 需要 Session，调试困难 | 直接 Python 断点调试 |
| 核心 API | 低级冗余，多套 API 并存 | Keras 为一等公民 |
| 变量创建 | `tf.get_variable()`，作用域管理复杂 | `tf.Variable()` |
| 保存格式 | checkpoint + GraphDef | SavedModel（统一） |
| 控制流 | `tf.cond`、`tf.while_loop` | Python 原生 if/for |
| 图加速 | 手动选择 | `@tf.function` 自动编译 |

---

### Q04 🟢 什么是 Eager Execution？有什么优缺点？

**参考答案：**

Eager Execution（即时执行）是指 TensorFlow 操作像普通 Python 代码一样**立即**返回具体值，而不需要先构建计算图再通过 Session 执行。

**优点：**
- 直观调试：可以在任意位置 `print()` 张量值
- 与 Python 控制流自然融合（`if/for/while`）
- 错误信息更明确，堆栈追踪直接指向 Python 行

**缺点：**
- 性能低于图模式：缺少图级别优化（算子融合等）
- 每次调用都有 Python 解释器开销
- 不适合生产部署（需配合 `@tf.function` 使用）

**最佳实践：**开发/调试用 Eager，`@tf.function` 编译热路径函数用于生产。

---

### Q07 🟢 `tf.Variable` vs `tf.constant` 的区别？

**参考答案：**

| 特性 | `tf.Variable` | `tf.constant` |
|------|--------------|--------------|
| 可变性 | **可变**，可通过 `.assign()` 更新 | **不可变** |
| 梯度追踪 | 自动被 `GradientTape` 追踪 | 需要 `tape.watch()` 手动注册 |
| 用途 | 模型参数（权重、偏置） | 固定数据（超参数、常量） |
| 持久化 | 随 `SavedModel` 保存 | 不自动保存 |
| 内存 | 独立分配 | 嵌入计算图 |

```python
w = tf.Variable([1.0, 2.0])
c = tf.constant([3.0, 4.0])

with tf.GradientTape() as tape:
    tape.watch(c)       # 常量需手动 watch
    y = w * c

# 对 w 求导（Variable 自动追踪）
dy_dw = tape.gradient(y, w)  # [3.0, 4.0]
```

---

### Q09 🟢 Keras 三种 API 的区别与适用场景？

**参考答案：**

| API | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| **Sequential** | 最简洁 | 只支持线性拓扑 | 简单线性堆叠模型 |
| **Functional** | 支持复杂拓扑 | 需显式声明输入 | 多输入/输出、残差网络、共享层 |
| **Subclassing** | 最灵活 | 无法自动推断 shape | 自定义前向传播逻辑（GAN、Transformer） |

```python
# Sequential：适合 MLP、简单 CNN
model = tf.keras.Sequential([Dense(64), Dense(10)])

# Functional：适合 ResNet、多任务学习
inputs = Input(shape=(784,))
x = Dense(64)(inputs)
out_a = Dense(10, name='task_a')(x)
out_b = Dense(1, name='task_b')(x)
model = Model(inputs, [out_a, out_b])

# Subclassing：适合需要动态结构的模型
class Transformer(tf.keras.Model):
    def call(self, inputs, training=False):
        # 可根据 training 动态改变行为
        ...
```

---

### Q11 🟢 什么是 Callback？常用 Callback 有哪些？

**参考答案：**

Callback 是在 `model.fit()` 训练过程的特定时机（`on_epoch_begin`/`on_epoch_end`/`on_batch_end` 等）自动触发的钩子函数。

**常用内置 Callback：**

| Callback | 功能 |
|---------|------|
| `EarlyStopping` | 监控指标不再改善时停止训练 |
| `ModelCheckpoint` | 保存最优 checkpoint |
| `ReduceLROnPlateau` | 指标停滞时降低学习率 |
| `TensorBoard` | 记录训练指标到 TensorBoard |
| `LearningRateScheduler` | 按调度函数动态调整学习率 |
| `CSVLogger` | 将训练日志写入 CSV 文件 |

**自定义 Callback：**

```python
class TimingCallback(tf.keras.callbacks.Callback):
    def on_epoch_begin(self, epoch, logs=None):
        self.epoch_start = time.time()

    def on_epoch_end(self, epoch, logs=None):
        elapsed = time.time() - self.epoch_start
        print(f"\nEpoch {epoch} took {elapsed:.2f}s")
```

---

## 中级题目

### Q05 🟡 `@tf.function` 的作用和工作原理？

**参考答案：**

`@tf.function` 将 Python 函数转换为可复用的 TensorFlow 计算图，实现**开发时 Eager 灵活性**与**部署时图性能**的结合。

**工作原理（Tracing 机制）：**

```
首次调用（特定输入 shape/dtype）：
  Python 函数 → AutoGraph 转换 Python 控制流
             → 追踪执行，记录 TF 操作为 FuncGraph
             → Grappler 图优化（常量折叠、算子融合）
             → 缓存为 ConcreteFunction

后续调用（相同签名）：
  直接执行缓存的 ConcreteFunction（跳过追踪）
```

**注意事项：**

```python
@tf.function
def f(x):
    print("Python print（仅追踪时执行一次）")  # 只在追踪时打印
    tf.print("TF print（每次执行都打印）")      # 每次执行都打印
    return x * 2

f(tf.constant(1))  # 追踪 + 执行
f(tf.constant(2))  # 仅执行（不再追踪）

# 动态 shape 导致多次追踪（潜在性能陷阱）
f(tf.constant([1, 2]))    # 追踪 shape=(2,)
f(tf.constant([1, 2, 3])) # 再次追踪 shape=(3,)

# 解决方案：使用 input_signature 固定输入规格
@tf.function(input_signature=[tf.TensorSpec(shape=[None], dtype=tf.int32)])
def f_fixed(x):
    return x * 2
```

---

### Q08 🟡 GradientTape 的原理与使用方式？

**参考答案：**

`GradientTape` 通过**记录计算过程**（tape，磁带），在前向传播时录制操作，反向传播时按录制反向计算梯度（反向模式自动微分）。

```python
x = tf.Variable(3.0)
y = tf.Variable(2.0)

# 默认只记录 Variable，常量需手动 watch
with tf.GradientTape() as tape:
    tape.watch(tf.constant(1.0))  # 手动 watch 常量
    z = x**2 + y**2

# 一阶梯度
dz_dx, dz_dy = tape.gradient(z, [x, y])  # [6.0, 4.0]
# 注意：tape 默认使用一次即释放（persistent=False）

# 持久化 tape（可多次调用 gradient）
with tf.GradientTape(persistent=True) as tape:
    z = x**2 + y**2

print(tape.gradient(z, x))  # 6.0
print(tape.gradient(z, y))  # 4.0
del tape  # 手动释放持久 tape

# 高阶导数
with tf.GradientTape() as t2:
    with tf.GradientTape() as t1:
        y = x**3
    dy_dx = t1.gradient(y, x)   # 3x²
d2y_dx2 = t2.gradient(dy_dx, x) # 6x
```

---

### Q12 🟡 tf.data 流水线如何优化性能？

**参考答案：**

**核心原则：消除 I/O 等待，让 CPU 预处理与 GPU 计算并行**

**关键优化手段：**

1. **`prefetch(AUTOTUNE)`**：最重要的优化，使当前 batch 训练与下一 batch 预处理并行

2. **`cache()`**：
   - 位置：在昂贵的解码操作后、shuffle 前
   - 适合：数据集能完整放入内存

3. **`num_parallel_calls=AUTOTUNE`**：在 `map()`、`interleave()` 中并行执行

4. **`interleave()`**：并行读取多个文件，消除磁盘 I/O 延迟

5. **向量化 `map`**：操作批次而非单样本

```python
# 推荐流水线顺序
dataset = (tf.data.TFRecordDataset(files)
    .interleave(lambda x: tf.data.TFRecordDataset(x),
                cycle_length=8, num_parallel_calls=AUTOTUNE)
    .map(decode_fn, num_parallel_calls=AUTOTUNE)
    .cache()                       # 缓存解码后结果
    .shuffle(10000)
    .batch(32, drop_remainder=True)
    .map(augment_fn, num_parallel_calls=AUTOTUNE)  # 批次增强
    .prefetch(AUTOTUNE)            # 必须放最后
)
```

---

### Q13 🟡 SavedModel 格式的结构和用途？

**参考答案：**

SavedModel 是 TF 2.x 统一的模型序列化格式，包含：

```
saved_model/
├── saved_model.pb      # 计算图定义（GraphDef）+ 函数定义 + 签名（Signatures）
├── variables/
│   ├── variables.index             # 变量名索引
│   └── variables.data-*-of-*      # 变量值（分片存储）
└── assets/             # 附加资源（词表文件、配置等）
```

**核心概念——签名（Signature）：**
- 定义模型的输入/输出接口，类似 API 契约
- `serving_default` 是默认签名，TF Serving 直接使用

**用途：**
1. TF Serving 直接加载，无需 Python 环境
2. TFLite 转换的起点
3. C++/Java/Go 等多语言加载
4. 跨平台迁移（不依赖训练代码）

---

### Q17 🟡 分布式训练策略有哪些？各自适用场景？

**参考答案：**

```
策略选择决策树：

单机？
  ├── 是，多 GPU → MirroredStrategy（NCCL All-Reduce）
  └── 否，多机？
        ├── 同步训练，GPU 集群 → MultiWorkerMirroredStrategy
        ├── TPU Pod → TPUStrategy
        └── 大规模异步，参数量极大 → ParameterServerStrategy

特殊：
  单机，CPU 内存大于 GPU 显存 → CentralStorageStrategy
```

| 策略 | 通信模式 | 适用场景 | 典型规模 |
|------|---------|---------|---------|
| `MirroredStrategy` | All-Reduce (NCCL) | 单机多卡 | 2-8 GPU |
| `MultiWorkerMirroredStrategy` | All-Reduce (gRPC/NCCL) | 多机同步 | 8-64 GPU |
| `TPUStrategy` | All-Reduce (TPU 互联) | Cloud TPU | 8-512 TPU cores |
| `ParameterServerStrategy` | Push/Pull | 超大规模异步 | 100+ workers |

---

### Q21 🟡 如何自定义 Keras Layer 和 Loss？

**参考答案：**

```python
# 自定义 Layer
class MultiHeadAttention(tf.keras.layers.Layer):
    def __init__(self, num_heads, d_model, **kwargs):
        super().__init__(**kwargs)
        self.num_heads = num_heads
        self.d_model = d_model

    def build(self, input_shape):
        # 在 build() 中创建可训练权重（此时知道输入 shape）
        self.wq = self.add_weight(
            shape=(self.d_model, self.d_model),
            initializer='glorot_uniform',
            trainable=True, name='wq'
        )
        self.wk = self.add_weight(shape=(self.d_model, self.d_model),
                                  trainable=True, name='wk')
        self.wv = self.add_weight(shape=(self.d_model, self.d_model),
                                  trainable=True, name='wv')
        super().build(input_shape)

    def call(self, query, key, value, training=False):
        q = tf.matmul(query, self.wq)
        k = tf.matmul(key, self.wk)
        v = tf.matmul(value, self.wv)
        # ... attention 计算 ...
        return output

    def get_config(self):
        # 实现 get_config 以支持序列化
        config = super().get_config()
        config.update({'num_heads': self.num_heads, 'd_model': self.d_model})
        return config

# 自定义 Loss
class FocalLoss(tf.keras.losses.Loss):
    def __init__(self, gamma=2.0, alpha=0.25, **kwargs):
        super().__init__(**kwargs)
        self.gamma = gamma
        self.alpha = alpha

    def call(self, y_true, y_pred):
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1 - 1e-7)
        cross_entropy = -y_true * tf.math.log(y_pred)
        weight = self.alpha * tf.pow(1 - y_pred, self.gamma)
        return tf.reduce_mean(weight * cross_entropy)
```

---

### Q29 🟡 TensorFlow 和 PyTorch 的核心差异？

**参考答案：**

| 维度 | TensorFlow 2.x | PyTorch |
|------|---------------|---------|
| **默认执行** | Eager + `@tf.function` | Eager + `torch.compile` |
| **部署生态** | 完整（Serving/Lite/JS/TFX） | 追赶中（TorchServe/ExecuTorch） |
| **移动端** | TFLite（成熟，大量设备部署） | ExecuTorch（2023+，较新） |
| **TPU 支持** | 原生 | 通过 torch_xla |
| **学术流行度** | 较低 | 高（主流研究框架） |
| **工业流行度** | 高（Google、Airbnb 等） | 增长迅速 |
| **模型格式** | SavedModel / TFLite | .pt / ONNX |
| **动态图灵活性** | Eager 默认，`@tf.function` 可选优化 | 天生动态 |
| **调试体验** | 良好（TF 2.x 后显著改善） | 优秀（更 Pythonic） |

---

### Q30 🟡 如何解决训练和推理的 training flag 问题？

**参考答案：**

Dropout 和 BatchNormalization 在训练和推理时行为不同，必须正确传递 `training` 标志：

```python
# ❌ 错误：忘记传递 training 标志
class BadModel(tf.keras.Model):
    def call(self, x):
        x = self.dropout(x)  # 永远以 training=False 行为运行
        return self.dense(x)

# ✅ 正确：显式传递 training
class GoodModel(tf.keras.Model):
    def call(self, x, training=False):
        x = self.dropout(x, training=training)
        x = self.bn(x, training=training)
        return self.dense(x)

# Keras model.fit() 会自动处理：
# - fit() 中调用 model(x, training=True)
# - evaluate()/predict() 中调用 model(x, training=False)

# 自定义训练循环中必须手动指定：
predictions = model(x_batch, training=True)   # 训练时
predictions = model(x_batch, training=False)  # 推理时
```

---

## 高级题目

### Q05-进阶 🔴 tf.function 的 tracing 机制与性能陷阱

**参考答案：**

**Tracing（追踪）** 是 `@tf.function` 首次调用时将 Python 代码转换为 TF 图的过程。每次输入的 **shape 或 dtype 不同**时，都会触发重新追踪（re-tracing），产生性能开销。

**常见陷阱与解决：**

```python
# 陷阱 1：Python 标量每次都会重新追踪
@tf.function
def f(x, n):
    for _ in range(n):   # n 是 Python int，不同值 = 不同图
        x = x + 1
    return x

f(tf.constant(1), 2)  # 追踪
f(tf.constant(1), 3)  # 再次追踪！

# 解决：使用 tf.Tensor 代替 Python int
@tf.function
def f_better(x, n):
    return x + tf.cast(n, x.dtype)

# 陷阱 2：动态 shape 导致重复追踪
@tf.function
def g(x):
    return tf.reduce_sum(x)

g(tf.constant([1, 2]))    # 追踪 shape=(2,)
g(tf.constant([1, 2, 3])) # 再次追踪 shape=(3,)

# 解决：使用 input_signature 声明动态维度
@tf.function(input_signature=[tf.TensorSpec([None], tf.int32)])
def g_fixed(x):
    return tf.reduce_sum(x)

# 陷阱 3：在追踪期间执行副作用
counter = [0]
@tf.function
def h(x):
    counter[0] += 1  # 仅在追踪时执行
    return x * 2

# 查看追踪次数（调试用）
print(h._get_tracing_count())
```

---

### Q18 🔴 All-Reduce vs Parameter Server 的区别？

**参考答案：**

```
All-Reduce（环形归约）：
  Worker 0 ─┐
  Worker 1  ├─ 每个 Worker 持有全量参数
  Worker 2 ─┘  同步更新：各自计算梯度 → 汇总 → 每人都得到聚合梯度

  通信模式：Ring All-Reduce（带宽利用率接近 100%）
  优点：通信效率高，无单点瓶颈
  缺点：同步等待，慢节点拖慢整体
  适用：模型可放入单卡，同构 GPU 集群

Parameter Server（参数服务器）：
  Worker 0 ──Push 梯度──→ PS
  Worker 1 ──Push 梯度──→ PS ──Pull 参数──→ Workers
  Worker 2 ──Push 梯度──→ PS

  通信模式：异步 Push/Pull
  优点：支持超大模型（参数分片在 PS 上），容忍慢节点
  缺点：PS 成为带宽瓶颈，存在梯度陈旧问题
  适用：超大规模稀疏模型（推荐系统 Embedding）
```

---

### Q19 🔴 XLA 编译器做了哪些优化？

**参考答案：**

XLA（Accelerated Linear Algebra）通过以下优化提升执行效率：

1. **算子融合（Operator Fusion）**
   ```
   未融合：MatMul → BiasAdd → ReLU（3 次 Kernel Launch，3 次显存读写）
   融合后：FusedMatMulBiasReLU（1 次 Kernel Launch，1 次显存读写）
   收益：减少内存带宽压力（对 Memory-Bound 操作尤其显著）
   ```

2. **缓冲区复用（Buffer Reuse）**
   - 分析整图生命周期，为不再需要的中间结果复用内存
   - 减少峰值显存占用

3. **循环展开（Loop Unrolling）**
   - 展开小型循环，减少循环控制开销

4. **常量传播（Constant Propagation）**
   - 在编译期计算常量子图，运行时直接使用结果

5. **形状特化（Shape Specialization）**
   - 针对已知形状生成专用代码，省去运行时 shape 检查

```python
# 启用 XLA 并对比性能
import time

@tf.function(jit_compile=False)
def without_xla(x, y):
    z = tf.matmul(x, y)
    return tf.nn.relu(z + 1.0)

@tf.function(jit_compile=True)  # 启用 XLA
def with_xla(x, y):
    z = tf.matmul(x, y)
    return tf.nn.relu(z + 1.0)

x = tf.random.normal([1024, 1024])
y = tf.random.normal([1024, 1024])

# 预热
without_xla(x, y); with_xla(x, y)

# 基准测试
t0 = time.perf_counter()
for _ in range(100): without_xla(x, y)
print(f"Without XLA: {time.perf_counter()-t0:.3f}s")

t0 = time.perf_counter()
for _ in range(100): with_xla(x, y)
print(f"With XLA:    {time.perf_counter()-t0:.3f}s")
```

---

### Q25 🔴 如何在 TF 中实现自定义梯度？

**参考答案：**

```python
# 场景：实现 straight-through estimator（用于不可导操作）
@tf.custom_gradient
def sign_with_ste(x):
    """前向传播用 sign，反向传播用恒等（straight-through）"""
    def grad(upstream):
        # 反向传播时传递上游梯度（不做任何变换）
        return upstream
    return tf.sign(x), grad

# 场景：实现数值稳定的 log-sum-exp
@tf.custom_gradient
def stable_log_softmax(x):
    result = x - tf.reduce_logsumexp(x, axis=-1, keepdims=True)
    def grad(upstream):
        softmax = tf.exp(result)
        return upstream - tf.reduce_sum(upstream, axis=-1, keepdims=True) * softmax
    return result, grad

# 验证自定义梯度
x = tf.Variable([-1.0, 0.5, 2.0])
with tf.GradientTape() as tape:
    y = tf.reduce_sum(sign_with_ste(x))
grad = tape.gradient(y, x)
print(grad)  # [1.0, 1.0, 1.0]（straight-through）
```

---

### Q28 🔴 TF Serving 如何实现无停机模型热更新？

**参考答案：**

TF Serving 通过**版本管理 + 原子切换**实现热更新：

```
热更新流程：

1. 新模型就绪
   在 /models/my_model/ 下创建新版本目录（如 /models/my_model/3/）
   包含完整的 SavedModel 文件

2. TF Serving Source 检测变化
   FileSystemStoragePathSource 定期轮询（默认 2 秒）

3. 版本加载
   Loader 加载新版本到内存（旧版本继续服务）

4. 原子切换
   新版本加载完成后，Manager 原子地将流量切换到新版本
   切换前后没有请求中断（in-flight 请求由旧版本完成）

5. 旧版本卸载
   根据 version_policy 决定是否保留旧版本（默认保留最新 1 个）
```

```bash
# 动态模型配置（通过 REST API 更新）
curl -X POST http://localhost:8501/v1/config \
  -d '{"model_config_list": {"config": [{
    "name": "my_model",
    "base_path": "/models/my_model/",
    "model_platform": "tensorflow",
    "model_version_policy": {"latest": {"num_versions": 2}}
  }]}}'
```

---

### Q32 🟡 如何实现 Learning Rate Warmup + Cosine Decay？

**参考答案：**

```python
class WarmupCosineDecay(tf.keras.optimizers.schedules.LearningRateSchedule):
    """Warmup 阶段线性增长，之后余弦衰减"""
    def __init__(self, peak_lr, warmup_steps, total_steps):
        super().__init__()
        self.peak_lr = peak_lr
        self.warmup_steps = tf.cast(warmup_steps, tf.float32)
        self.total_steps = tf.cast(total_steps, tf.float32)

    def __call__(self, step):
        step = tf.cast(step, tf.float32)
        # Warmup 阶段
        warmup_lr = self.peak_lr * (step / self.warmup_steps)
        # Cosine Decay 阶段
        progress = (step - self.warmup_steps) / (self.total_steps - self.warmup_steps)
        progress = tf.clip_by_value(progress, 0.0, 1.0)
        cosine_lr = self.peak_lr * 0.5 * (1.0 + tf.cos(tf.constant(3.14159) * progress))
        # 根据阶段选择
        return tf.where(step < self.warmup_steps, warmup_lr, cosine_lr)

    def get_config(self):
        return {
            'peak_lr': self.peak_lr,
            'warmup_steps': int(self.warmup_steps.numpy()),
            'total_steps': int(self.total_steps.numpy())
        }

# 使用
schedule = WarmupCosineDecay(
    peak_lr=1e-3,
    warmup_steps=1000,
    total_steps=50000
)
optimizer = tf.keras.optimizers.Adam(learning_rate=schedule)
```

---

## 面试备考建议

1. **初级岗位**：重点掌握 Q01-Q04、Q07、Q09、Q11，能流利使用 Keras API 进行建模训练
2. **中级岗位**：掌握 Q05、Q08、Q12-Q17、Q21、Q29-Q30，理解 tf.data 优化和分布式训练原理
3. **高级/架构岗位**：深入掌握所有高级题目，能解释 XLA、All-Reduce 等底层机制，熟悉 TF Serving 生产运维
4. **实践建议**：每道题在本地跑通代码示例，理解输出结果，比死记答案更有效
