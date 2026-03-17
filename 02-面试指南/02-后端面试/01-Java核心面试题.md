# Java 核心面试题

> 基于 OpenJDK HotSpot 源码的分层面试题，涵盖 JVM 内存模型、垃圾收集器、类加载机制、并发编程底层原理与 Java 内存模型（JMM）。

## 相关链接
- 对应技术资料：[Java 核心与 JVM](../../01-技术资料/02-后端/01-Java核心与JVM.md)

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| # | 考点 | 核心要点（一句话） | 出题概率 |
|---|------|-------------------|----------|
| 1 | JVM 内存模型 | 堆(Young/Old分区) + 方法区(Metaspace) + 栈 + PC | ★★★★★ |
| 2 | GC 算法与收集器 | G1(Region化+暂停目标) 是默认，ZGC(<1ms) 是未来 | ★★★★★ |
| 3 | synchronized 锁升级 | 无锁→偏向锁→轻量级锁(CAS)→重量级锁(Monitor) | ★★★★★ |
| 4 | volatile 与 JMM | 可见性+有序性(内存屏障)，不保证原子性 | ★★★★☆ |
| 5 | HashMap 原理 | 数组+链表+红黑树，扩容 rehash，线程不安全 | ★★★★★ |
| 6 | 类加载机制 | 双亲委派：Bootstrap→Extension→App，确保类唯一性 | ★★★★☆ |
| 7 | AQS 框架 | state + CLH 队列，ReentrantLock/Semaphore 的基石 | ★★★☆☆ |
| 8 | 线程池 | 核心线程→队列→最大线程→拒绝策略，生产禁用 Executors | ★★★★☆ |
| 9 | ConcurrentHashMap | JDK 8: CAS+synchronized 分段锁，JDK 7: Segment 锁 | ★★★★☆ |
| 10 | OOM 排查 | jmap dump → MAT/VisualVM 分析 → 大对象/泄漏定位 | ★★★★☆ |

---

## 题目列表

### ⭐ 基础题

---

**Q1. JVM 运行时数据区分为哪几个区域？哪些是线程私有的，哪些是线程共享的？**

**参考答案：**

**线程共享（进程级别）：**
- **堆（Heap）**：存储所有对象实例和数组，GC 的主要工作区域
- **方法区（Method Area）/ Metaspace（JDK 8+）**：存储类信息、运行时常量池、静态变量、JIT 编译代码

**线程私有（每线程独立）：**
- **虚拟机栈（VM Stack）**：每个方法调用创建一个栈帧（局部变量表、操作数栈、动态链接、返回地址）
- **本地方法栈（Native Method Stack）**：执行 native 方法使用
- **程序计数器（Program Counter）**：当前执行的字节码行号，唯一不会 OOM 的区域（native 方法为 undefined）

**JDK 8 的重要变化：** 永久代（PermGen）→ Metaspace，后者使用本地内存（Native Memory），不受 `-Xmx` 限制，但可用 `-XX:MaxMetaspaceSize` 限制。

---

**Q2. Java 对象在堆中的分配流程是什么？**

**参考答案：**

1. **TLAB（Thread-Local Allocation Buffer）优先**：每个线程在 Eden 区预分配一块独占缓冲区，对象分配直接在 TLAB 内 bump pointer，无需锁（CAS），是最快路径

2. **TLAB 不够**：TLAB 剩余空间不足时，申请新的 TLAB 或直接在 Eden 区上 CAS 分配

3. **Eden 满**：触发 Minor GC

4. **大对象**：超过 `-XX:PretenureSizeThreshold` 的对象直接分配到老年代，避免在 Young Gen 来回复制

5. **老年代不够**：Full GC → 仍不够 → `OutOfMemoryError: Java heap space`

**动态年龄晋升：** 若 Survivor 区中某年龄段对象的总大小超过 Survivor 空间的一半，该年龄及以上的对象直接晋升（不必等到 MaxTenuringThreshold=15）。

---

**Q3. Minor GC 和 Full GC 的区别是什么？什么情况会触发 Full GC？**

**参考答案：**

| | Minor GC | Full GC |
|--|----------|---------|
| 回收区域 | Young Generation（Eden + Survivor）| 整个堆 + Metaspace |
| 触发条件 | Eden 区空间不足 | 多种情况（见下）|
| STW 时间 | 短（Young Gen 通常较小）| 长 |
| 频率 | 频繁 | 少 |

**触发 Full GC 的常见原因：**
1. 老年代空间不足（对象晋升失败 / 大对象分配失败）
2. Minor GC 后晋升到老年代的对象大于老年代剩余空间（空间担保失败）
3. 显式调用 `System.gc()`（建议 `-XX:+DisableExplicitGC`）
4. Metaspace 空间不足
5. CMS GC promotion failed / concurrent mode failure

---

**Q4. 什么是 GC Roots？常见的 GC Roots 有哪些？**

**参考答案：**

GC Roots 是**可达性分析**的起始点——从 GC Roots 出发，能被引用到的对象都是存活对象，不可达的对象是垃圾。

**常见 GC Roots：**
1. 虚拟机栈中的局部变量（各线程的栈帧中正在使用的对象引用）
2. 方法区中的静态变量引用的对象
3. 方法区中常量引用的对象（如字符串常量池中的引用）
4. 本地方法栈中 JNI（native 方法）引用的对象
5. JVM 内部引用（如基本数据类型对应的 Class 对象、常驻异常对象 `NullPointerException` 等）
6. 同步锁（synchronized）持有的对象
7. 被 JVM 内部使用的 JMX Bean、JVMTI 中注册的回调、本地代码缓存等

---

**Q5. 解释 Java 中的 `volatile` 关键字，它能解决什么问题，不能解决什么？**

**参考答案：**

**`volatile` 保证：**

1. **可见性**：对 volatile 变量的写立即刷新到主内存，其他线程的读从主内存获取最新值（通过内存屏障实现）

2. **有序性（禁止重排序）**：volatile 写前插入 `StoreStore` 屏障，写后插入 `StoreLoad` 屏障；volatile 读后插入 `LoadLoad` + `LoadStore` 屏障

**`volatile` 不保证：**

- **原子性**：`i++` 不是原子操作（读取→加1→写回三步），多线程并发执行仍有数据竞争
  ```java
  volatile int i = 0;
  // 线程A和线程B同时执行 i++，结果可能不是 2
  ```

**适用场景：**
- 状态标志（`volatile boolean stopped = false`）
- DCL（双重检查锁）中的 `volatile instance`
- 轻量级的读多写少场景（写操作本身已是原子的，如 volatile long 赋值）

---

**Q6. `synchronized` 和 `ReentrantLock` 的区别是什么？各自适用场景？**

**参考答案：**

| 特性 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 实现层次 | JVM 字节码（monitorenter/monitorexit）| Java API（AQS）|
| 锁释放 | 自动（代码块结束/异常时）| 必须手动 `unlock()`（finally 块）|
| 可中断 | 不支持 | `lockInterruptibly()` 支持 |
| 超时尝试 | 不支持 | `tryLock(time, unit)` 支持 |
| 公平性 | 非公平（性能更好）| 可选公平/非公平 |
| 多 Condition | `wait()/notify()`（一个等待队列）| `newCondition()` 可创建多个等待队列 |
| 性能（JDK 8+）| 相当（锁升级优化）| 相当 |

**选择建议：**
- 简单场景：优先 `synchronized`（代码简洁，不会忘记 unlock）
- 需要超时、可中断、公平锁、多个 Condition：选 `ReentrantLock`

---

### ⭐⭐ 进阶题

---

**Q7. 描述 G1 收集器的工作原理，它如何实现可预测停顿时间？**

**参考答案：**

**G1 Region 化内存管理：**

G1 将堆划分为大小相等的 Region（1-32MB，通常 2048 个），每个 Region 可以动态扮演 Eden/Survivor/Old/Humongous 角色，打破了传统分代的物理边界。

**可预测停顿的实现：**

1. **Region 粒度回收**：G1 每次 GC 选择若干个 Region（而非整个 Young/Old 区）进行回收
2. **Garbage First 策略**：优先回收 **垃圾比例最高**的 Region（单位时间内回收效益最大）
3. **停顿预测模型**：G1 基于历史数据（每个 Region 的回收时间）建立预测模型，在 `-XX:MaxGCPauseMillis`（默认 200ms）限制内选择尽量多的 Region
4. **Young GC 控制**：通过动态调整 Eden Region 数量，使 Young GC 停顿不超过目标

**RSet（Remembered Set）：** 每个 Region 维护一个 RSet，记录其他 Region 对本 Region 的引用。避免 GC 时扫描整个堆来找跨 Region 引用，大幅减少扫描范围。

**触发 Mixed GC 的条件：** Old Region 占堆的比例超过 `InitiatingHeapOccupancyPercent`（默认 45%），开始混合回收 Young + 部分 Old Region。

---

**Q8. 解释 AQS（AbstractQueuedSynchronizer）的核心机制。**

**参考答案：**

AQS 是 `java.util.concurrent` 包中大多数同步器的共同框架，核心是一个**volatile int state + CLH 变体等待队列**。

**核心数据结构：**

```java
// state: 同步状态（不同子类含义不同）
// ReentrantLock: 0=未锁，>=1=锁定重入次数
// Semaphore: 剩余许可数
// CountDownLatch: 剩余计数
private volatile int state;

// CLH 变体等待队列（Node 双向链表）
private transient volatile Node head;
private transient volatile Node tail;
```

**独占模式获取锁（`lock()` → `acquire(1)`）流程：**

1. `tryAcquire(1)`：子类尝试获取（ReentrantLock 中 CAS state 0→1）
2. 成功 → 直接返回
3. 失败 → `addWaiter(Node.EXCLUSIVE)` 将当前线程加入队列尾部（CAS 操作）
4. `acquireQueued(node, 1)` 自旋：
   - 如果前驱是头节点：再次 `tryAcquire()`（防止前驱刚释放锁）
   - 成功 → 设自己为头节点，返回
   - 失败 → 检查是否应该 park：前驱状态为 `SIGNAL` → `LockSupport.park(this)` 阻塞

**释放锁（`unlock()` → `release(1)`）流程：**

1. `tryRelease(1)`：state 减 1（重入次数递减）
2. state == 0：`unparkSuccessor(head)` 唤醒头节点的后继节点（`LockSupport.unpark(nextThread)`）

**公平锁 vs 非公平锁：** 非公平锁在 `tryAcquire` 时不检查队列是否有等待者，直接 CAS 竞争（可能插队）；公平锁先检查队列为空才 CAS。非公平锁吞吐量更高，但可能饥饿。

---

**Q9. CMS 收集器有哪些缺陷？G1 如何解决了这些问题？**

**参考答案：**

**CMS 的三大缺陷：**

1. **内存碎片：** CMS 使用标记-清除算法，不移动对象，久而久之产生大量内存碎片。当需要分配大对象时，碎片化的老年代找不到连续空间，被迫触发 Serial Old（单线程 STW Full GC）。

2. **浮动垃圾（Floating Garbage）：** 并发标记阶段（CMS 不停用户线程），新产生的垃圾对象无法在本轮 GC 中回收，必须等到下轮 GC——这些就是"浮动垃圾"。因此 CMS 必须在老年代使用率达到约 92%（`CMSInitiatingOccupancyFraction`）时就触发 GC，不能等满再 GC。

3. **Concurrent Mode Failure：** 若 CMS 并发清除阶段，老年代空间不足（浮动垃圾 + 新晋升对象），退化为 Serial Old Full GC——这是最严重的性能灾难，可能导致几秒到几十秒的停顿。

**G1 的解决方案：**

1. **内存碎片：** G1 使用标记-复制算法回收 Region，存活对象被复制到新 Region，无碎片
2. **浮动垃圾：** G1 的 Remembered Set 和 SATB（Snapshot-At-The-Beginning）写屏障准确跟踪对象变化，浮动垃圾问题大幅减轻
3. **停顿预测：** G1 通过停顿模型控制每次 GC 的 Region 数量，规避 Full GC（但 Evacuation Failure 时仍可能触发）

---

**Q10. 什么是类加载的双亲委派机制？为什么这样设计？如何打破双亲委派？**

**参考答案：**

**双亲委派工作流程：**

```java
// ClassLoader.loadClass() 核心逻辑：
Class<?> c = findLoadedClass(name);  // 已加载则直接返回
if (c == null) {
    try {
        c = parent.loadClass(name);  // 委托父类加载器
    } catch (ClassNotFoundException e) {}
    if (c == null) c = findClass(name);  // 父加载器找不到，自己加载
}
```

**设计目的：**
1. **防止核心类被替换**：`java.lang.Object` 始终由 Bootstrap ClassLoader 加载，自定义的同名类无法替代
2. **类的唯一性**：同一路径的类只被加载一次（同一类加载器），避免重复加载

**打破双亲委派的合法场景：**

1. **SPI（Service Provider Interface）**：`java.util.ServiceLoader` 需要 Bootstrap ClassLoader 加载的接口，由 AppClassLoader 加载实现类。通过 **Thread Context ClassLoader** 打破：父加载器加载接口，委托给线程上下文类加载器加载实现

2. **OSGi / Tomcat**：每个模块/WebApp 有独立类加载器，实现类隔离（不同 WebApp 的同名类互不干扰）。Tomcat 的类加载优先从 WebApp 自己的 `/WEB-INF/classes` 和 `/WEB-INF/lib` 加载（先子后父，逆双亲委派）

3. **热部署/热更新**：丢弃旧类加载器（JVM 会 GC 掉），创建新类加载器重新加载更新后的类文件

---

**Q11. 解释 Java 内存模型中的 happens-before 关系，并举例说明。**

**参考答案：**

**happens-before 定义：** 如果操作 A happens-before 操作 B，则 A 的执行结果对 B 可见，且 A 的执行顺序在 B 之前（从可见性和有序性角度）。

**8 条天然 happens-before 规则：**

```java
// 1. 程序顺序规则：单线程内顺序执行
int a = 1;    // A
int b = a;    // B — A happens-before B，所以 b 一定是 1

// 2. volatile 规则
volatile int x = 0;
// 线程1: x = 1 (写)
// 线程2: int y = x (读，如果读到 y=1，则写 happens-before 读)

// 3. Monitor 锁规则
synchronized(obj) { count++; }  // T1 的 unlock
synchronized(obj) { read count; } // T2 的 lock（在 T1 unlock 后）
// T1 的 unlock happens-before T2 的 lock

// 4. 线程启动规则
// main 线程中设置的变量，t.start() 之后，t 线程能看到这些变量的值
int x = 42;
Thread t = new Thread(() -> System.out.println(x)); // 一定打印 42
t.start();

// 5. 线程终止规则
t.join(); // join() 返回后，t 线程中的所有操作对当前线程可见

// 6. 传递性：A hb B, B hb C → A hb C
```

**实际应用 — DCL 必须加 volatile 的原因：**

```java
instance = new Singleton();
// 底层三步：1.分配内存 2.初始化对象 3.引用赋值
// JIT 可能重排序为：1.分配内存 3.引用赋值 2.初始化对象
// 若线程 B 在步骤 3 完成后检查 instance != null，以为已初始化
// 实际上步骤 2 还未完成 → 使用了未初始化的对象
// volatile 保证步骤 3 在步骤 2 之后（StoreStore 屏障）
```

---

**Q12. ZGC 相对于 G1 的核心优势是什么？它是如何实现亚毫秒停顿的？**

**参考答案：**

**ZGC 的设计目标：** 任意大小堆（TB 级）上保持最大停顿时间 < 10ms（通常 < 1ms）。

**核心技术：**

**1. 染色指针（Colored Pointers）：**
64 位指针的高位用于存储 GC 元数据（标记位、重定位信息），无需额外内存存储对象状态。ZGC 最多支持 4TB 堆（42位地址）。

**2. 读屏障（Load Barrier）vs 写屏障：**
G1 使用写屏障维护 RSet，每次写操作都有额外开销。ZGC 只使用读屏障（`load barrier`），每次读取对象引用时 JIT 插入一个轻量检查，代价更小，且能实现"自愈"（读到过期指针时自动更新）。

**3. 完全并发的 Mark 和 Relocate：**
- G1 的 Remark 和对象复制（Evacuation）需要 STW
- ZGC 几乎所有阶段都是并发的，只有 3 个极短暂的 STW 阶段（各 < 1ms）：初始标记、再标记、初始重定位

**4. Region 大小可变：** ZGC 有小/中/大三种 Region，更灵活地管理不同大小的对象。

**vs G1 的劣势：** ZGC 的 CPU 开销（读屏障）比 G1 高约 5-10%；吞吐量略低于 G1（尤其批处理场景）；JDK 11 可用但 15 才生产就绪。

---

### ⭐⭐⭐ 高级题

---

**Q13. 分析以下代码存在的并发问题，并给出修复方案：**

```java
public class Counter {
    private int count = 0;
    public void increment() { count++; }
    public int get() { return count; }
}
```

**参考答案：**

**并发问题分析：**

`count++` 不是原子操作，字节码层面分三步：
1. `getfield`（读取 count 当前值到操作数栈）
2. `iconst_1` + `iadd`（加 1）
3. `putfield`（写回）

两个线程同时执行时，可能同时读到相同的值，然后都写回相同的结果，导致一次 increment 实际上只加了 1（丢失更新）。

**修复方案（4种）：**

```java
// 方案1：synchronized 方法
public synchronized void increment() { count++; }

// 方案2：AtomicInteger（推荐，无锁，基于 CAS）
private AtomicInteger count = new AtomicInteger(0);
public void increment() { count.incrementAndGet(); }
public int get() { return count.get(); }

// 方案3：LongAdder（高并发写推荐，减少 CAS 竞争）
private LongAdder count = new LongAdder();
public void increment() { count.increment(); }
public long get() { return count.sum(); }

// 方案4：volatile + synchronized（如果 get() 不需要强一致）
private volatile int count = 0;
public synchronized void increment() { count++; }
public int get() { return count; } // volatile 保证可见性
```

**选择建议：** 读多写少 → `AtomicInteger`；写多 → `LongAdder`（内部分桶，减少竞争）；复杂逻辑 → `synchronized`。

---

**Q14. 描述 CMS 垃圾收集器发生 "Concurrent Mode Failure" 的原因和解决方案。**

**参考答案：**

**Concurrent Mode Failure 触发条件：**

CMS 并发清除阶段（不 STW，与应用线程并行）期间，应用线程仍在运行，可能：
1. 将新对象晋升到老年代（Young GC 触发）
2. 大对象直接在老年代分配

如果老年代此时剩余空间不足以容纳这些新晋升/分配的对象 → **Concurrent Mode Failure** → 退化为 **Serial Old**（单线程 Full GC，STW），停顿时间可能长达数秒甚至数十秒。

**根本原因：** `CMSInitiatingOccupancyFraction` 阈值设置过高，CMS 启动太晚，来不及在老年代满之前完成并发清除。

**解决方案：**

```bash
# 1. 降低 CMS 触发阈值（越早触发，留给并发清除的时间越多）
-XX:CMSInitiatingOccupancyFraction=70  # 默认 92，降到 70-80
-XX:+UseCMSInitiatingOccupancyOnly     # 使用指定阈值，不自适应调整

# 2. 增大老年代（减少晋升压力）
-Xmx8g -XX:NewRatio=2  # Old:Young = 2:1

# 3. 减少对象晋升速度（增大 Survivor 区）
-XX:SurvivorRatio=6  # Eden:Survivor = 6:1（默认 8）

# 4. 根本解决：升级到 G1
-XX:+UseG1GC -XX:MaxGCPauseMillis=200
```

---

**Q15. 解释 synchronized 锁升级的全过程（偏向锁 → 轻量级锁 → 重量级锁）。**

**参考答案：**

**HotSpot 对象头 Mark Word（64位）：**

```
无锁:   [hashCode(31)|0|分代年龄(4)|偏向位(0)|01]
偏向锁: [线程ID(54)|Epoch(2)|年龄(4)|偏向位(1)|01]  
轻量级: [Lock Record 指针(62)                   |00]
重量级: [Monitor 指针(62)                        |10]
```

**升级过程：**

**无锁 → 偏向锁：**
- JVM 启动 4 秒后（`BiasedLockingStartupDelay`）开始偏向
- 第一个线程获取锁时，CAS 将线程 ID 写入 Mark Word（获得偏向）
- 该线程再次进入：只需比较 Mark Word 中的线程 ID，无 CAS（最快路径）

**偏向锁 → 轻量级锁（撤销偏向）：**
- 另一个线程尝试获取同一偏向锁 → 需要 STW（安全点）撤销偏向
- 撤销时：原持有线程仍在使用 → 升级为轻量级锁；否则设为无锁

**轻量级锁：**
- 线程在栈帧创建 Lock Record，CAS 将 Mark Word 中的内容替换为 Lock Record 指针
- 成功 → 获得轻量级锁；失败（竞争）→ 自旋等待
- 自旋若干次（自适应自旋，默认 10 次）仍失败 → 膨胀为重量级锁

**重量级锁：**
- 在堆中创建 Monitor 对象（内含 OS 互斥量 mutex）
- 未获得锁的线程进入 EntryList（阻塞，不消耗 CPU）
- 释放时唤醒 EntryList 中的线程

**JDK 15 起默认禁用偏向锁**（偏向锁撤销需要 STW，在高并发场景下 STW 代价超过偏向收益）。

---

**Q16. 什么是 ThreadLocal？它如何工作？如何避免内存泄漏？**

**参考答案：**

**ThreadLocal 作用：** 为每个线程提供独立的变量副本，线程间互不干扰（无需同步）。

**实现原理：**

```java
// ThreadLocal.set(value) 内部实现：
public void set(T value) {
    Thread t = Thread.currentThread();
    ThreadLocalMap map = t.threadLocals;  // 每个 Thread 对象内的 Map
    if (map != null)
        map.set(this, value);             // key = ThreadLocal 实例（弱引用）
    else
        createMap(t, value);              // value = 存储的值（强引用）
}
```

**关键设计：** 数据存储在 `Thread.threadLocals`（`ThreadLocalMap`）中，而不是 `ThreadLocal` 对象中。`ThreadLocalMap` 的 key 是 `ThreadLocal` 对象的**弱引用**。

**内存泄漏风险：**

```
Thread → ThreadLocalMap → Entry[key(弱引用)=ThreadLocal, value(强引用)=T]

当 ThreadLocal 对象被 GC 回收（弱引用被清除）后：
  key = null（已被 GC）
  value = T（仍然存活！因为强引用）

如果 Thread 不死（线程池的核心线程），value 就永远不会被回收 → 内存泄漏
```

**正确使用姿势：**

```java
private static final ThreadLocal<Connection> conn = ThreadLocal.withInitial(...);

try {
    conn.set(getConnection());
    doWork();
} finally {
    conn.remove();  // !! 必须手动 remove，否则线程池场景下内存泄漏
}
```

**最佳实践：** 在 `try-finally` 中保证 `ThreadLocal.remove()` 被调用，尤其是在线程池中（线程复用，不 remove 上一次的 value 会泄漏到下次请求）。

---

**Q17. 如何排查 Java 应用的内存溢出（OOM）问题？**

**参考答案：**

**步骤 1：确认 OOM 类型**

```
OutOfMemoryError: Java heap space     → 堆空间不足（最常见）
OutOfMemoryError: Metaspace           → 方法区/元空间不足（类加载太多）
OutOfMemoryError: GC overhead exceeded → GC 时间占比 > 98%（对象创建太快）
OutOfMemoryError: Direct buffer memory → NIO Direct Buffer 用完
StackOverflowError                     → 线程栈溢出（递归太深）
```

**步骤 2：采集 Heap Dump**

```bash
# 方式1：OOM 时自动 dump
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof

# 方式2：手动 dump（进程仍在运行时）
jmap -dump:format=b,file=/tmp/heapdump.hprof <pid>

# 方式3：jcmd
jcmd <pid> VM.heap_dump /tmp/heapdump.hprof
```

**步骤 3：分析 Heap Dump**

工具：MAT（Eclipse Memory Analyzer）、VisualVM、JProfiler

```
在 MAT 中：
1. 打开 Heap Dump → Leak Suspects Report（自动找内存泄漏嫌疑）
2. 查看 Dominator Tree（占用最多内存的对象树）
3. 查看 Histogram（各类实例数量和内存占用）
4. 找到占用最大的对象，追踪其 GC Root 引用链（Paths to GC Roots）
```

**常见内存泄漏模式：**
- 静态 `Map/List` 持续增长，未设大小限制
- `ThreadLocal` 未 remove
- 监听器/回调未注销（Observer 模式）
- Connection/Stream 未关闭（try-with-resources）
- 内部类持有外部类引用（匿名类/Lambda）

---

**Q18. 什么是 JIT 即时编译？JVM 是如何决定什么代码值得 JIT 编译的？**

**参考答案：**

**JIT（Just-In-Time Compilation）：** JVM 启动时解释执行字节码（慢），运行过程中识别热点代码并编译为机器码（快），后续直接执行机器码。

**热点探测：**

HotSpot JVM 通过两种计数器确定热点代码：
1. **方法调用计数器**（`invocation_counter`）：方法被调用的次数
2. **循环回边计数器**（`backedge_counter`）：方法体内循环被执行的次数（用于 OSR，On-Stack Replacement）

阈值由 `-XX:CompileThreshold` 控制（Client 模式 1500，Server 模式 10000）。计数器有"热度衰减"机制：超过一段时间（`-XX:CounterHalfLifeTime`）减半，避免过去热的代码被永久 JIT。

**编译层次（Tiered Compilation，JDK 7+ 默认）：**

| 层次 | 说明 |
|------|------|
| Level 0 | 解释执行 |
| Level 1 | C1 简单编译（无 profiling）|
| Level 2 | C1 编译（有限 profiling）|
| Level 3 | C1 完整编译（完整 profiling）|
| Level 4 | C2 优化编译（激进优化）|

**JIT 的关键优化：**
- 内联（Inlining）：将小方法直接嵌入调用处（消除方法调用开销）
- 逃逸分析（Escape Analysis）：未逃逸的对象分配在栈上（无 GC 压力）
- 锁消除（Lock Elimination）：未逃逸的同步块消除锁操作
- 循环展开（Loop Unrolling）：减少循环分支判断

---

**Q19. 如何分析和解决 Java 应用的 CPU 使用率过高问题？**

**参考答案：**

**步骤 1：找到 CPU 占用最高的线程**

```bash
# Linux: 找到进程总 CPU
top | grep java

# 找到进程内 CPU 最高的线程（TID）
top -H -p <pid>  # H=显示线程, p=指定进程

# 或使用 ps
ps -mp <pid> -o THREAD,tid,time | sort -rn | head -20
```

**步骤 2：将线程 TID 转换为 16 进制**

```bash
printf '%x\n' <tid>   # 十进制 TID → 16 进制（用于 jstack 中查找）
```

**步骤 3：获取线程栈信息**

```bash
jstack -l <pid> > /tmp/thread_dump.txt
# 在 thread_dump.txt 中搜索上一步得到的 16 进制 TID（如 nid=0x1234）
```

**步骤 4：分析栈帧**

**常见 CPU 高场景：**

| 栈顶帧 | 可能原因 |
|--------|---------|
| `java.util.HashMap.put` | 死循环（多线程并发修改 HashMap，JDK 7 resize 死循环）|
| GC 线程 CPU 高 | 内存不足、GC 频繁 |
| `sun.nio.ch.EPoll*` | epoll 空轮询 Bug（旧版 Netty/JDK 问题）|
| 业务逻辑循环 | 死循环 Bug 或正常高计算 |
| `String.intern()` | 大量字符串 intern 导致常量池竞争 |

**步骤 5：使用 async-profiler 采样分析**

```bash
# 采样 30 秒，生成火焰图
./profiler.sh -d 30 -f /tmp/flamegraph.svg <pid>
# 火焰图中宽度最大的帧 = CPU 热点
```

---

**Q20. 什么是逃逸分析？它如何影响对象分配策略？**

**参考答案：**

**逃逸分析（Escape Analysis）：** JIT 编译器分析一个对象是否"逃逸"出其创建的方法或线程范围。

**三种逃逸状态：**
1. **无逃逸（No Escape）：** 对象只在方法内部使用，方法返回后对象不可达
2. **方法逃逸（Method Escape）：** 对象被作为返回值或参数传递到其他方法
3. **线程逃逸（Thread Escape）：** 对象被赋值给全局变量或可被其他线程访问的字段

**逃逸分析的优化：**

**1. 栈上分配（Stack Allocation）：** 无逃逸对象分配在线程栈上（而非堆），方法返回时自动回收，无 GC 压力

```java
public void foo() {
    // Point 未逃逸，可能被 JIT 分配在栈上
    Point p = new Point(1, 2);
    System.out.println(p.x + p.y);
}
```

**2. 标量替换（Scalar Replacement）：** 无逃逸对象被分解为各个字段（标量），直接存储在寄存器/栈上，对象本身不在堆上创建

```java
Point p = new Point(1, 2);
// JIT 可能优化为：
int p_x = 1; int p_y = 2;
```

**3. 锁消除（Lock Elimination）：** 无线程逃逸的 synchronized 块中的锁被消除

```java
public String concat(String s1, String s2) {
    // StringBuffer 未逃逸，JIT 会消除其内部 synchronized
    StringBuffer sb = new StringBuffer();
    sb.append(s1).append(s2);
    return sb.toString();
}
```

**启用参数：** JDK 8+ 默认开启（`-XX:+DoEscapeAnalysis`，`-XX:+EliminateLocks`）。
