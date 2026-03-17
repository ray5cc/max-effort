# Python 核心面试题

> 覆盖 Python 运行时机制、GIL、异步编程、内存管理的高频面试题。AI 工程师必备。

## 相关链接
- 对应技术资料：[Python核心与异步编程](../../01-技术资料/02-后端/04-Python核心与异步编程.md)

## 🔥 高频考点速记

| # | 考点 | 核心要点（一句话） | 出题概率 |
|---|------|-------------------|---------|
| 1 | GIL | 同一时刻只有一个线程执行字节码，绕过方法:多进程/C扩展/asyncio | ★★★★★ |
| 2 | 装饰器 | 闭包+高阶函数，@语法糖=func(wrapper)，functools.wraps保留元信息 | ★★★★★ |
| 3 | 生成器 | yield暂停/恢复执行上下文，惰性求值省内存 | ★★★★★ |
| 4 | asyncio | 事件循环+协程调度，I/O密集的最佳方案 | ★★★★★ |
| 5 | 深拷贝 vs 浅拷贝 | copy()=共享嵌套对象，deepcopy()=递归复制 | ★★★★☆ |
| 6 | 可变参数 | *args(元组)/**kwargs(字典)，默认参数陷阱(可变默认值) | ★★★★☆ |
| 7 | 内存管理 | 引用计数(实时)+分代GC(循环引用)，pymalloc小对象池 | ★★★★☆ |
| 8 | 元类 | type是所有类的元类，__new__控制类创建过程 | ★★★☆☆ |
| 9 | 上下文管理器 | __enter__/__exit__，with语句资源管理 | ★★★★☆ |
| 10 | Python 3.12+ | Per-interpreter GIL / Free-threaded(3.13) / JIT编译器 | ★★★☆☆ |

## 目录
- [⭐ 基础题 (Q1-Q10)](#-基础题-q1-q10)
- [⭐⭐ 进阶题 (Q11-Q20)](#-进阶题-q11-q20)
- [⭐⭐⭐ 高级题 (Q21-Q25)](#-高级题-q21-q25)
- [🎯 场景题 (Q26-Q28)](#-场景题-q26-q28)

---

## ⭐ 基础题 (Q1-Q10)

### Q1: Python 中 `is` 和 `==` 的区别是什么？

**面试官意图**：考察对 Python 对象模型的理解——identity vs equality。

**参考答案**：

`is` 比较的是**身份（identity）**，即两个变量是否指向内存中的同一个对象（比较 `id()`）；`==` 比较的是**值（equality）**，通过调用对象的 `__eq__()` 方法判断值是否相等。

```python
a = [1, 2, 3]
b = [1, 2, 3]
c = a

print(a == b)  # True  — 值相等
print(a is b)  # False — 不同对象（不同内存地址）
print(a is c)  # True  — c 和 a 指向同一个对象
```

**小整数缓存陷阱**：CPython 对 -5 到 256 范围内的整数做了缓存（interning），这些整数复用同一对象：

```python
x = 256
y = 256
print(x is y)  # True — 缓存范围内

x = 257
y = 257
print(x is y)  # False — 超出缓存（交互模式下）
```

**最佳实践**：比较值用 `==`，判断是否为 `None` 用 `is`（`if x is None`）。

---

### Q2: 列表推导式和生成器表达式有什么区别？

**面试官意图**：考察对惰性求值和内存效率的理解。

**参考答案**：

| 维度 | 列表推导式 `[...]` | 生成器表达式 `(...)` |
|------|-------------------|---------------------|
| 返回类型 | `list` | `generator` 对象 |
| 内存占用 | 一次性分配全部元素 | 按需生成，内存恒定 |
| 遍历次数 | 可多次遍历 | 只能遍历一次 |
| 速度 | 单次使用略慢（分配内存） | 单次使用略快 |

```python
import sys

# 列表推导式 — 占用大量内存
squares_list = [x**2 for x in range(1_000_000)]
print(sys.getsizeof(squares_list))  # ~8,448,728 bytes (~8MB)

# 生成器表达式 — 内存恒定
squares_gen = (x**2 for x in range(1_000_000))
print(sys.getsizeof(squares_gen))   # 200 bytes

# 适合只遍历一次的场景
total = sum(x**2 for x in range(1_000_000))  # 不需要 []
```

**原则**：如果只需要遍历一次，优先用生成器表达式；需要多次访问或索引，用列表推导式。

---

### Q3: `*args` 和 `**kwargs` 的作用是什么？

**面试官意图**：考察对 Python 函数参数机制的理解。

**参考答案**：

- `*args`：将**多余的位置参数**收集为一个 **元组 (tuple)**
- `**kwargs`：将**多余的关键字参数**收集为一个 **字典 (dict)**

```python
def example(a, b, *args, **kwargs):
    print(f"a={a}, b={b}")
    print(f"args={args}")       # 额外的位置参数 → tuple
    print(f"kwargs={kwargs}")   # 额外的关键字参数 → dict

example(1, 2, 3, 4, x=5, y=6)
# a=1, b=2
# args=(3, 4)
# kwargs={'x': 5, 'y': 6}
```

**参数顺序规则**：`def func(普通参数, *args, 仅关键字参数, **kwargs)`

```python
def strict(name, *, age, **extra):
    """* 之后的参数必须用关键字传递"""
    pass

strict("Alice", age=30, role="admin")  # ✅
# strict("Alice", 30)  # ❌ TypeError
```

**解包用法**：

```python
def add(a, b, c):
    return a + b + c

args = [1, 2, 3]
kwargs = {"a": 1, "b": 2, "c": 3}

add(*args)     # 等价于 add(1, 2, 3)
add(**kwargs)  # 等价于 add(a=1, b=2, c=3)
```

---

### Q4: Python 的深拷贝和浅拷贝有什么区别？

**面试官意图**：考察对可变对象和引用语义的理解。

**参考答案**：

- **浅拷贝 (shallow copy)**：创建新的外层容器，但内部元素仍然是原来的引用
- **深拷贝 (deep copy)**：递归复制所有嵌套对象，完全独立

```python
import copy

original = [[1, 2], [3, 4]]

# 浅拷贝 — 内部列表仍共享
shallow = copy.copy(original)
shallow[0].append(99)
print(original)  # [[1, 2, 99], [3, 4]] ← 被影响了！

# 深拷贝 — 完全独立
original = [[1, 2], [3, 4]]
deep = copy.deepcopy(original)
deep[0].append(99)
print(original)  # [[1, 2], [3, 4]] ← 不受影响
```

**浅拷贝的多种写法**：

```python
# 以下都是浅拷贝
a = [1, [2, 3]]
b = a[:]           # 切片
c = list(a)        # 构造函数
d = a.copy()       # copy 方法
e = copy.copy(a)   # copy 模块
```

**注意**：对于不可变对象（int、str、tuple），浅拷贝和深拷贝没有区别，因为不可变对象不会被修改。

---

### Q5: 闭包是什么？举例说明

**面试官意图**：考察对 Python 作用域和函数式编程的理解。

**参考答案**：

闭包是指一个**内部函数引用了外部函数的变量**，并且外部函数已经返回。被引用的变量不会被回收，而是保存在内部函数的 `__closure__` 属性中。

```python
def make_counter(start=0):
    count = start
    
    def counter():
        nonlocal count  # 引用外部变量
        count += 1
        return count
    
    return counter  # 外部函数返回，但 count 不会被回收

c = make_counter(10)
print(c())  # 11
print(c())  # 12
print(c())  # 13

# 查看闭包绑定的变量
print(c.__closure__[0].cell_contents)  # 13
```

**闭包三要素**：
1. 存在嵌套函数
2. 内部函数引用了外部函数的变量（自由变量）
3. 外部函数返回内部函数

**经典陷阱——循环变量捕获**：

```python
# ❌ 错误：闭包捕获的是变量引用，不是值
funcs = []
for i in range(3):
    funcs.append(lambda: i)
print([f() for f in funcs])  # [2, 2, 2] ← 全是最终值

# ✅ 解决：用默认参数"固定"当前值
funcs = []
for i in range(3):
    funcs.append(lambda x=i: x)
print([f() for f in funcs])  # [0, 1, 2]
```

---

### Q6: Python 中的作用域规则是什么？（LEGB）

**面试官意图**：考察变量查找机制。

**参考答案**：

Python 按照 **LEGB** 规则查找变量：

| 缩写 | 作用域 | 说明 |
|------|--------|------|
| **L** | Local | 函数/方法内部 |
| **E** | Enclosing | 外层嵌套函数（闭包） |
| **G** | Global | 模块级别 |
| **B** | Built-in | Python 内置（`print`, `len` 等） |

```python
x = "global"  # G

def outer():
    x = "enclosing"  # E
    
    def inner():
        x = "local"  # L
        print(x)     # → "local"
    
    inner()

outer()
```

**修改外层变量的关键字**：

```python
count = 0

def increment():
    global count      # 声明使用全局变量
    count += 1

def outer():
    value = 0
    def inner():
        nonlocal value  # 声明使用外层函数变量
        value += 1
    inner()
    return value

# 不加 global/nonlocal 而直接赋值 → 创建新的局部变量
```

---

### Q7: 什么是装饰器？如何编写带参数的装饰器？

**面试官意图**：高频考点，考察闭包、高阶函数和 Python 语法糖的理解。

**参考答案**：

装饰器是一个**接收函数并返回新函数的高阶函数**。`@decorator` 是语法糖，等价于 `func = decorator(func)`。

**无参装饰器**：

```python
import functools
import time

def timer(func):
    @functools.wraps(func)  # 保留原函数的 __name__, __doc__
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        print(f"{func.__name__}: {time.perf_counter() - start:.4f}s")
        return result
    return wrapper

@timer
def slow_func():
    time.sleep(1)

slow_func()  # → slow_func: 1.0005s
```

**带参数的装饰器**（三层嵌套）：

```python
def retry(max_retries=3, delay=1):
    """外层：接收装饰器参数"""
    def decorator(func):
        """中层：接收被装饰的函数"""
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            """内层：实际执行包装逻辑"""
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    print(f"Attempt {attempt + 1} failed: {e}")
                    time.sleep(delay * (2 ** attempt))
        return wrapper
    return decorator

@retry(max_retries=3, delay=0.5)  # retry(3, 0.5) 返回 decorator
def call_api(url):                # decorator(call_api) 返回 wrapper
    pass
```

**`functools.wraps` 的必要性**：不加 wraps，`call_api.__name__` 会变成 `'wrapper'`，影响调试和框架行为。

---

### Q8: `__init__` 和 `__new__` 的区别是什么？

**面试官意图**：考察对象创建机制。

**参考答案**：

| 方法 | 调用时机 | 参数 | 返回值 | 作用 |
|------|---------|------|--------|------|
| `__new__` | **创建**实例 | `cls`（类） | 必须返回实例 | 分配内存，创建对象 |
| `__init__` | **初始化**实例 | `self`（实例） | 返回 None | 设置属性值 |

调用顺序：`obj = MyClass()` → 先调用 `__new__` 创建实例 → 再调用 `__init__` 初始化实例。

```python
class Singleton:
    """单例模式：通过 __new__ 控制实例创建"""
    _instance = None
    
    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, name):
        self.name = name

a = Singleton("Alice")
b = Singleton("Bob")
print(a is b)    # True — 同一个实例
print(a.name)    # "Bob" — __init__ 被调用两次
```

**关键区别**：
- `__new__` 是**类方法**（虽然不用 @classmethod 修饰）
- `__new__` 可以返回其他类的实例（不触发 `__init__`）
- 不可变类型（int, str, tuple）必须用 `__new__` 自定义，因为它们在创建后不可修改

---

### Q9: Python 的可变对象和不可变对象有哪些？有什么影响？

**面试官意图**：考察对 Python 数据模型的理解。

**参考答案**：

| 不可变 (Immutable) | 可变 (Mutable) |
|-------------------|---------------|
| `int`, `float`, `bool`, `str`, `tuple`, `frozenset`, `bytes` | `list`, `dict`, `set`, `bytearray` |

**影响**：

1. **字典的 key 必须是不可变对象**（因为需要稳定的哈希值）：

```python
d = {}
d[(1, 2)] = "tuple key"     # ✅ tuple 不可变
# d[[1, 2]] = "list key"    # ❌ TypeError: unhashable type: 'list'
```

2. **函数参数传递**：Python 是"传对象引用"。对可变对象的修改会影响原对象：

```python
def modify(lst, num):
    lst.append(4)   # 修改了原对象
    num += 1        # 创建了新的 int 对象，不影响原变量

my_list = [1, 2, 3]
my_num = 10
modify(my_list, my_num)
print(my_list)  # [1, 2, 3, 4] ← 被修改
print(my_num)   # 10            ← 未受影响
```

3. **线程安全**：不可变对象天然线程安全。

---

### Q10: 为什么默认参数不能用可变对象（list/dict）？

**面试官意图**：经典坑，考察对可变默认参数行为的理解。

**参考答案**：

Python 的默认参数值在**函数定义时**只计算一次，之后被所有调用共享。如果默认值是可变对象，多次调用会修改同一个对象：

```python
# ❌ 经典陷阱
def append_to(item, target=[]):
    target.append(item)
    return target

print(append_to(1))  # [1]
print(append_to(2))  # [1, 2] ← 预期 [2]，实际共享了同一个 list！
print(append_to(3))  # [1, 2, 3]
```

**原因**：`target=[]` 在函数定义时创建了一个 list 对象，绑定到 `append_to.__defaults__`。每次调用都使用同一个 list。

**正确做法**：用 `None` 作为默认值，在函数体内创建新对象：

```python
# ✅ 正确
def append_to(item, target=None):
    if target is None:
        target = []  # 每次调用创建新 list
    target.append(item)
    return target

print(append_to(1))  # [1]
print(append_to(2))  # [2] ✅
```

---

## ⭐⭐ 进阶题 (Q11-Q20)

### Q11: 详细解释 GIL 的工作原理及绕过方法

**面试官意图**：考察对 CPython 内部机制的深入理解，AI 工程师必考题。

**思路分析**：需要讲清楚 GIL 存在的原因（引用计数）、具体行为（5ms 切换）、影响（CPU 密集无法并行）、绕过方案。

**参考答案**：

**GIL (Global Interpreter Lock)** 是 CPython 解释器中的全局互斥锁，确保同一时刻只有一个线程执行 Python 字节码。

**为什么需要 GIL**：CPython 使用引用计数管理内存，每个对象都有 `ob_refcnt`。多线程同时修改引用计数会导致数据竞争——计数错误可能导致内存泄漏或悬挂指针。GIL 是最简单的保护方式。

**GIL 的行为**：
- Python 3.2+ 基于时间切换，默认每 5ms 释放一次（`sys.getswitchinterval()`）
- I/O 操作时自动释放 GIL
- C 扩展可以显式释放 GIL（`Py_BEGIN_ALLOW_THREADS`）

**绕过方案**：

| 方案 | 适用场景 | 原理 |
|------|---------|------|
| `multiprocessing` | CPU 密集 | 每个进程有独立 GIL |
| C 扩展 (NumPy) | 数值计算 | C 层释放 GIL |
| `asyncio` | I/O 密集 | 单线程协程，不涉及 GIL |
| `concurrent.futures` | 混合场景 | ThreadPool / ProcessPool 统一接口 |
| Free-threaded (3.13+) | 实验性 | 彻底移除 GIL |

```python
# CPU 密集：多线程 ≈ 单线程（GIL 限制），多进程 ≈ 线性加速
import time, threading, multiprocessing

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b

# 多线程：受 GIL 约束
start = time.time()
threads = [threading.Thread(target=fib, args=(400_000,)) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print(f"4 threads: {time.time()-start:.2f}s")  # ≈ 单线程 × 1

# 多进程：真正并行
start = time.time()
procs = [multiprocessing.Process(target=fib, args=(400_000,)) for _ in range(4)]
for p in procs: p.start()
for p in procs: p.join()
print(f"4 processes: {time.time()-start:.2f}s")  # ≈ 单线程 × 0.25
```

**追问**：GIL 为什么不用细粒度锁替代？——细粒度锁的加锁/解锁开销太大，单线程性能下降 40%+（Guido 曾明确拒绝此方案）。

---

### Q12: asyncio 事件循环是如何工作的？

**面试官意图**：考察对 Python 异步编程核心机制的理解。

**思路分析**：事件循环 → 协程 / Task → await 机制 → I/O 多路复用。

**参考答案**：

**事件循环 (Event Loop)** 是 asyncio 的核心调度器，运行在单线程中，负责：
1. 监听 I/O 事件（基于 epoll / kqueue / IOCP）
2. 调度就绪的协程（Task）执行
3. 管理定时器和回调

**执行流程**:

```python
import asyncio

async def fetch(url, delay):
    print(f"Start fetching {url}")
    await asyncio.sleep(delay)  # 让出控制权给事件循环
    print(f"Done fetching {url}")
    return f"Result from {url}"

async def main():
    # create_task 将协程包装为 Task，注册到事件循环
    task1 = asyncio.create_task(fetch("api/a", 2))
    task2 = asyncio.create_task(fetch("api/b", 1))
    
    # await 挂起当前协程，直到 task 完成
    r1 = await task1
    r2 = await task2
    return r1, r2

asyncio.run(main())
# Start fetching api/a  (立即)
# Start fetching api/b  (立即)
# Done fetching api/b   (1秒后)
# Done fetching api/a   (2秒后)
# 总耗时 ~2秒，而非 3秒
```

**关键概念**：
- `async def` 定义的函数调用后返回 `coroutine` 对象，**不会立即执行**
- `await` 挂起当前协程，将控制权交还事件循环
- `create_task()` 把协程注册到事件循环，使其开始调度
- 底层 I/O 通过操作系统内核的事件通知机制（epoll/kqueue）实现非阻塞

---

### Q13: Python 的内存管理和垃圾回收机制

**面试官意图**：考察 CPython 运行时内存管理机制。

**参考答案**：

Python（CPython）使用**三层内存管理机制**：

**1. 引用计数 (Reference Counting)**——主要机制

每个对象有一个 `ob_refcnt` 计数器。引用增加（赋值、传参、加入容器）时 +1，引用减少（del、超出作用域、重新赋值）时 -1。计数归零时**立即释放**。

- 优点：实时回收，延迟低
- 缺点：**无法处理循环引用**

**2. 分代垃圾回收 (Generational GC)**——处理循环引用

三代（Generation 0/1/2），新对象在 Gen 0。Gen 0 回收最频繁，存活对象晋升到 Gen 1、Gen 2。

```python
import gc
print(gc.get_threshold())  # (700, 10, 10)
# Gen 0: 每 700 次分配触发
# Gen 1: 每 10 次 Gen 0 回收触发
# Gen 2: 每 10 次 Gen 1 回收触发
```

**3. pymalloc 小对象分配器**

≤512 字节的对象从内存池分配（Arena→Pool→Block），避免频繁调用系统 malloc。

```python
# 循环引用示例
a = []
b = []
a.append(b)
b.append(a)
del a, b  # 引用计数仍为 1，但分代 GC 可以检测并回收
```

---

### Q14: 什么是描述符？property 如何实现的？

**面试官意图**：考察对 Python 数据模型高级特性的理解。

**参考答案**：

描述符是实现了 `__get__`、`__set__`、`__delete__` 中**至少一个**方法的对象。当描述符作为类属性时，访问该属性会触发描述符的方法。

**两种描述符**：
- **数据描述符**：实现了 `__set__` 和/或 `__delete__`（优先级高于实例 `__dict__`）
- **非数据描述符**：只实现了 `__get__`（优先级低于实例 `__dict__`）

**`property` 就是一个数据描述符**：

```python
class property:
    """简化版 property 实现"""
    def __init__(self, fget=None, fset=None, fdel=None, doc=None):
        self.fget = fget
        self.fset = fset
        self.fdel = fdel
    
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return self.fget(obj)
    
    def __set__(self, obj, value):
        if self.fset is None:
            raise AttributeError("can't set attribute")
        self.fset(obj, value)
    
    def setter(self, fset):
        return type(self)(self.fget, fset, self.fdel)
```

**自定义描述符示例**——类型验证：

```python
class TypeChecked:
    def __init__(self, expected_type):
        self.expected_type = expected_type
    
    def __set_name__(self, owner, name):
        self.name = name
    
    def __get__(self, obj, objtype=None):
        if obj is None: return self
        return obj.__dict__.get(self.name)
    
    def __set__(self, obj, value):
        if not isinstance(value, self.expected_type):
            raise TypeError(f"{self.name} must be {self.expected_type}")
        obj.__dict__[self.name] = value

class Person:
    name = TypeChecked(str)
    age = TypeChecked(int)

p = Person()
p.name = "Alice"  # ✅
# p.age = "30"    # ❌ TypeError: age must be <class 'int'>
```

---

### Q15: 元类 (metaclass) 的原理和使用场景

**面试官意图**：考察 Python 对象创建链的深入理解。

**参考答案**：

**元类是"创建类的类"**。普通对象是类的实例，而类本身是元类的实例。默认元类是 `type`。

```
实例（如 obj）  ← 类（如 MyClass）  ← 元类（如 type）
type(obj) → MyClass    type(MyClass) → type    type(type) → type
```

**类创建过程**：

```python
# class MyClass(Base):
#     x = 1

# 等价于：
MyClass = type('MyClass', (Base,), {'x': 1})
```

**自定义元类**——自动注册子类：

```python
class PluginMeta(type):
    registry = {}
    
    def __new__(mcs, name, bases, namespace):
        cls = super().__new__(mcs, name, bases, namespace)
        if bases:  # 不注册基类本身
            PluginMeta.registry[name] = cls
        return cls

class Plugin(metaclass=PluginMeta):
    pass

class JSONPlugin(Plugin):
    pass

class XMLPlugin(Plugin):
    pass

print(PluginMeta.registry)
# {'JSONPlugin': <class 'JSONPlugin'>, 'XMLPlugin': <class 'XMLPlugin'>}
```

**使用场景**：
- ORM 框架（Django Model、SQLAlchemy）
- API 框架（自动注册路由/序列化器）
- 单例模式
- 接口强制约束

**注意**：大多数场景用装饰器或 `__init_subclass__` 替代元类更简洁。

---

### Q16: 上下文管理器的原理

**面试官意图**：考察资源管理和协议理解。

**参考答案**：

上下文管理器通过 `with` 语句管理资源的获取和释放，确保异常时也能正确清理。

**协议方法**：
- `__enter__(self)` → 进入 `with` 块时调用，返回值赋给 `as` 变量
- `__exit__(self, exc_type, exc_val, exc_tb)` → 退出 `with` 块时调用（无论是否异常）

```python
class DatabaseConnection:
    def __enter__(self):
        self.conn = create_connection()
        return self.conn
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()
        # 返回 True → 吞掉异常
        # 返回 False/None → 重新抛出异常
        return False

with DatabaseConnection() as conn:
    conn.execute("SELECT ...")
# 离开 with 块后自动关闭连接
```

**`contextlib` 简化写法**：

```python
from contextlib import contextmanager

@contextmanager
def timer(label):
    import time
    start = time.perf_counter()
    try:
        yield  # with 块的代码在这里执行
    finally:
        elapsed = time.perf_counter() - start
        print(f"{label}: {elapsed:.4f}s")

with timer("Processing"):
    time.sleep(1)
# → Processing: 1.0005s
```

**异步上下文管理器**（asyncio 中必不可少）：

```python
class AsyncDB:
    async def __aenter__(self):
        self.conn = await aiosqlite.connect("db.sqlite")
        return self.conn
    
    async def __aexit__(self, *exc):
        await self.conn.close()

async with AsyncDB() as conn:
    await conn.execute("SELECT ...")
```

---

### Q17: Python 协程的演进：生成器协程 → async/await

**面试官意图**：考察对 Python 异步编程历史和原理的理解。

**参考答案**：

**阶段 1：基于生成器的协程（Python 2.5 - 3.3）**

利用 `yield` 暂停和恢复函数执行，手动实现协程调度：

```python
def old_coroutine():
    result = yield "请求数据"  # 暂停，等待 send() 发送结果
    print(f"收到: {result}")

coro = old_coroutine()
value = next(coro)          # 启动协程 → "请求数据"
coro.send("数据内容")       # 恢复执行 → "收到: 数据内容"
```

**阶段 2：`yield from` + `@asyncio.coroutine`（Python 3.4）**

```python
import asyncio

@asyncio.coroutine
def fetch():
    yield from asyncio.sleep(1)  # yield from 委托给子生成器
    return "data"
```

**阶段 3：`async/await` 原生语法（Python 3.5+）**

```python
async def fetch():
    await asyncio.sleep(1)  # 语义清晰，不再依赖生成器
    return "data"
```

**本质区别**：`async def` 创建的是 `coroutine` 对象（而非 generator），Python 可以在字节码层面区分协程和普通生成器，提供更好的错误检测和优化。

---

### Q18: `__slots__` 的原理和使用场景

**面试官意图**：考察对 Python 内存优化的理解。

**参考答案**：

默认情况下，Python 实例属性存储在 `__dict__` 字典中。`__slots__` 告诉 Python 使用**固定的属性槽**替代 `__dict__`，节省内存。

```python
class WithDict:
    def __init__(self, x, y):
        self.x = x
        self.y = y

class WithSlots:
    __slots__ = ('x', 'y')
    def __init__(self, x, y):
        self.x = x
        self.y = y

# 内存对比
import sys
d = WithDict(1, 2)
s = WithSlots(1, 2)
print(sys.getsizeof(d) + sys.getsizeof(d.__dict__))  # ~200 bytes
print(sys.getsizeof(s))                                # ~56 bytes
```

**原理**：`__slots__` 声明后，Python 在类型对象中为每个属性分配一个固定偏移量，直接通过指针访问而非字典查找。

**限制**：
- 不能动态添加新属性（除非 `__slots__` 包含 `__dict__`）
- 继承时子类也必须声明 `__slots__`，否则效果失效
- 不支持弱引用（除非包含 `__weakref__`）

**使用场景**：需要创建大量实例的类（如数据点、ORM 行对象、消息对象）。

---

### Q19: Python 的 MRO (方法解析顺序) 和 C3 线性化

**面试官意图**：考察多重继承的理解。

**参考答案**：

当一个类有多个父类时，Python 需要确定方法的查找顺序。Python 3 使用 **C3 线性化算法** 计算 MRO：

```python
class A:
    def method(self):
        print("A")

class B(A):
    def method(self):
        print("B")

class C(A):
    def method(self):
        print("C")

class D(B, C):
    pass

# MRO 顺序
print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)

D().method()  # → "B"  (按 MRO 顺序找到 B.method)
```

**C3 算法核心规则**：
1. 子类优先于父类
2. 父类的先后顺序按声明顺序（`class D(B, C)` → B 先于 C）
3. 保持单调性（如果 X 在某个类的 MRO 中先于 Y，那么在所有子类的 MRO 中也应如此）

**`super()` 按 MRO 调用**：

```python
class A:
    def method(self):
        print("A")

class B(A):
    def method(self):
        print("B")
        super().method()  # MRO 中 B 的下一个

class C(A):
    def method(self):
        print("C")
        super().method()

class D(B, C):
    def method(self):
        print("D")
        super().method()

D().method()  # D → B → C → A（按 MRO）
```

---

### Q20: asyncio.gather vs TaskGroup 的区别

**面试官意图**：考察对现代 Python 异步编程最佳实践的了解。

**参考答案**：

| 维度 | `asyncio.gather` | `asyncio.TaskGroup` (3.11+) |
|------|-----------------|---------------------------|
| 异常处理 | 默认取消所有任务；`return_exceptions=True` 时异常作为结果返回 | 自动取消所有其他任务，抛出 `ExceptionGroup` |
| 任务生命周期 | 无明确边界，可能"泄漏"任务 | 任务与 `async with` 块绑定 |
| 动态添加任务 | 不支持 | 支持 `tg.create_task()` |
| 错误追踪 | 较差（异常栈可能不清晰） | 更好（结构化并发） |
| 兼容性 | Python 3.4+ | Python 3.11+ |

```python
# gather — 兼容性好，但异常处理需注意
results = await asyncio.gather(
    task1(), task2(), task3(),
    return_exceptions=True  # 异常不取消其他任务
)

# TaskGroup — 推荐方式（3.11+）
async with asyncio.TaskGroup() as tg:
    t1 = tg.create_task(task1())
    t2 = tg.create_task(task2())
    t3 = tg.create_task(task3())
# 任何失败 → 其余自动取消 → ExceptionGroup
```

**推荐**：新项目用 TaskGroup（结构化并发），维护旧代码用 gather。

---

## ⭐⭐⭐ 高级题 (Q21-Q25)

### Q21: 描述 CPython 解释器的执行流程（源码级别）

**面试官意图**：考察对 CPython 内部架构的深度理解。

**思路分析**：源代码 → AST → 字节码 → 虚拟机执行。需要了解编译和执行阶段的关键组件。

**参考答案**：

CPython 执行 Python 代码分为**编译阶段**和**执行阶段**：

```
源代码 (.py)
    │
    ▼ [词法分析 (Tokenizer)]
  Token 流
    │
    ▼ [语法分析 (Parser, PEG)]
  AST (抽象语法树)
    │
    ▼ [AST 优化 (Constant Folding 等)]
  优化后 AST
    │
    ▼ [编译 (Compiler)]
  字节码 (Code Object / .pyc 文件)
    │
    ▼ [Python 虚拟机 (ceval.c)]
  执行结果
```

**关键组件**：

1. **PEG Parser**（3.9+）：替代旧的 LL(1) parser，支持更灵活的语法
2. **Code Object**：`dis` 模块可以查看字节码

```python
import dis

def add(a, b):
    return a + b

dis.dis(add)
#   0 LOAD_FAST    0 (a)
#   2 LOAD_FAST    1 (b)
#   4 BINARY_ADD
#   6 RETURN_VALUE
```

3. **ceval.c**：CPython 虚拟机的核心，一个巨大的 `switch` 语句（3.12+ 使用计算跳转表优化）
4. **Specializing Adaptive Interpreter**（3.11+）：在运行时将通用字节码替换为类型特化版本（`BINARY_ADD` → `BINARY_ADD_INT`），提升热路径性能

**追问方向**：
- `.pyc` 文件的格式和缓存策略（`__pycache__/`）
- 3.11 的 Quickening / Specialization 机制
- 3.13 的 JIT 编译器如何进一步优化

---

### Q22: Python 3.13 Free-threaded 模式的原理和影响

**面试官意图**：考察对 Python 最新发展方向的关注。

**思路分析**：PEP 703 → 替代方案 → 性能影响 → 生态兼容性。

**参考答案**：

Python 3.13 引入了实验性的 **Free-threaded 模式**（PEP 703），通过以下技术替代 GIL：

**1. 偏向引用计数 (Biased Reference Counting)**

每个对象维护两个引用计数：
- **本地计数**：拥有该对象的线程修改时无需加锁（最常见的情况）
- **共享计数**：其他线程修改时使用原子操作

大多数引用计数更新是线程本地的，避免了 GIL 的全局竞争。

**2. 延迟引用计数 (Deferred Reference Counting)**

全局可访问的对象（如模块、内置函数）的引用计数推迟处理，由 GC 批量更新。

**3. 细粒度锁**

dict、list 等内置类型使用**对象级锁**（per-object lock）替代 GIL，只在实际发生竞争时阻塞。

**影响**：

| 维度 | 影响 |
|------|------|
| 性能（单线程） | 降低 ~5-10%（额外的原子操作开销） |
| 性能（多线程 CPU 密集） | 线性加速（终于能真正利用多核） |
| C 扩展兼容性 | 需要适配（NumPy、Cython 等大库已在进行中） |
| 现有代码 | 需要注意线程安全（之前被 GIL "保护"的代码可能不安全） |
| 生态成熟度 | 实验阶段，预计 3.15-3.16 稳定 |

```bash
# 使用方式
python3.13t script.py    # t 后缀表示 free-threaded build
PYTHON_GIL=0 python3.13t script.py  # 显式禁用 GIL
```

**追问**：为什么不直接用细粒度锁替代 GIL？——之前的尝试（如 2007 年的补丁）导致单线程性能下降 40%+。PEP 703 的创新在于组合使用偏向引用计数+延迟引用计数，将单线程开销控制在 5-10%。

---

### Q23: 如何设计一个高性能的 Python 异步服务？

**面试官意图**：考察架构设计能力和异步编程实战经验。

**思路分析**：技术选型 → 架构设计 → 性能优化 → 监控运维。

**参考答案**：

**技术栈选择**：

```
FastAPI (应用框架)
├── Uvicorn + uvloop (ASGI 服务器)
├── aiohttp / httpx (异步 HTTP 客户端)
├── asyncpg (异步 PostgreSQL)
├── aioredis (异步 Redis)
└── orjson (高性能 JSON 序列化)
```

**核心设计原则**：

1. **永不阻塞事件循环**——所有 I/O 必须是异步的

```python
# ❌ 阻塞调用
import requests
resp = requests.get(url)  # 整个事件循环被冻结！

# ✅ 异步调用
async with httpx.AsyncClient() as client:
    resp = await client.get(url)

# 如果必须调用同步库（如某些 SDK）
result = await asyncio.get_event_loop().run_in_executor(
    None, sync_function, args  # 卸载到线程池
)
```

2. **控制并发数**——防止打爆下游

```python
semaphore = asyncio.Semaphore(100)  # 最大 100 并发

async def controlled_call(url):
    async with semaphore:
        return await fetch(url)
```

3. **连接池复用**——避免频繁建立连接

```python
# 应用启动时创建，全局复用
app.state.db_pool = await asyncpg.create_pool(dsn, min_size=5, max_size=20)
app.state.redis = await aioredis.from_url(redis_url, max_connections=50)
app.state.http = httpx.AsyncClient(limits=httpx.Limits(max_connections=100))
```

4. **使用 uvloop 替代默认事件循环**

```python
# uvloop 比默认事件循环快 2-4 倍
# pip install uvloop
import uvloop
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
# 或 uvicorn --loop uvloop
```

5. **结构化错误处理和超时**

```python
async def resilient_call(url):
    try:
        async with asyncio.timeout(5):  # Python 3.11+
            return await fetch(url)
    except TimeoutError:
        return fallback_result()
    except aiohttp.ClientError as e:
        logger.error(f"HTTP error: {e}")
        raise
```

**追问**：如何做优雅停机 (Graceful Shutdown)？——捕获 SIGTERM，停止接受新请求，等待现有请求完成，设置最大等待时间。

---

### Q24: 描述一次 Python 代码优化经历（profile → 瓶颈 → 优化）

**面试官意图**：考察实际优化能力和系统性思维。

**思路分析**：模拟一个真实场景，展示完整的优化流程。

**参考答案**：

**场景**：一个日志分析服务处理 10GB 日志文件，耗时 15 分钟，需要优化到 3 分钟以内。

**Step 1: Profile 定位瓶颈**

```bash
# 使用 py-spy 采样分析（不侵入代码）
py-spy record -o profile.svg -- python analyze.py
```

火焰图显示 80% 时间花在两处：
1. `json.loads()` 解析每行日志（40%）
2. `if keyword in results_list` 去重检查（40%）

**Step 2: 分析原因**

1. 标准库 `json` 是纯 Python 实现，逐字符解析
2. `in list` 是 O(n) 线性扫描，100 万条记录时极慢

**Step 3: 针对性优化**

```python
# 优化前
import json

results = []
for line in open("huge.log"):
    data = json.loads(line)                    # 慢：纯 Python JSON
    if data["id"] not in results:              # 慢：O(n) 查找
        results.append(data["id"])

# 优化后
import orjson  # C 实现的 JSON 库，快 5-10 倍

seen = set()   # O(1) 查找
def process_log(file_path):
    with open(file_path) as f:
        for line in f:
            data = orjson.loads(line)           # 快：C 实现
            item_id = data[b"id"]              # orjson 返回 bytes
            if item_id not in seen:            # O(1) 哈希查找
                seen.add(item_id)
                yield item_id
```

**Step 4: 验证结果**

| 阶段 | 耗时 | 改进 |
|------|------|------|
| 原始 | 15 min | - |
| json → orjson | 8 min | -47% |
| list → set | 2.5 min | -83% |

**核心经验**：
1. **先 Profile，再优化**——不要凭感觉
2. **算法复杂度优先**——O(n) → O(1) 比换库效果更大
3. **用 C 扩展替代纯 Python 热点**——orjson/ujson/msgpack

---

### Q25: uvloop 为什么比默认事件循环快？

**面试官意图**：考察对事件循环底层实现的理解。

**参考答案**：

uvloop 是用 **Cython 包装 libuv**（Node.js 的事件循环库）实现的高性能事件循环，比 CPython 默认事件循环快 **2-4 倍**。原因：

**1. C 实现 vs Python 实现**

默认 `asyncio` 事件循环（`SelectorEventLoop` / `ProactorEventLoop`）大量逻辑用 Python 编写。uvloop 用 Cython + C 实现核心路径，减少解释器开销。

**2. libuv 的高效 I/O 模型**

libuv 是 Node.js 久经考验的事件循环库：
- 跨平台抽象：Linux 用 epoll，macOS 用 kqueue，Windows 用 IOCP
- 高效的定时器管理（最小堆）
- 优化的回调调度

**3. 更少的 Python 对象创建**

默认事件循环在调度每个回调时创建大量临时 Python 对象（Handle, TimerHandle）。uvloop 使用 C 层的结构体，减少 GC 压力。

**4. 优化的 DNS 解析和 TCP/UDP 处理**

libuv 内置异步 DNS 解析（使用线程池），避免阻塞事件循环。

```python
# 使用方式
import uvloop
import asyncio

asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

# 或者（更简洁）
uvloop.install()

# Uvicorn 中使用
# uvicorn app:app --loop uvloop
```

**基准测试对比**（HTTP echo server, req/s）：
| 事件循环 | 请求/秒 | 相对性能 |
|---------|--------|---------|
| asyncio (selector) | ~15,000 | 1x |
| uvloop | ~45,000 | 3x |

**追问**：uvloop 的劣势？——不支持 Windows（libuv 在 Windows 上不如 IOCP 原生支持好）；Debug 困难（C 层崩溃不易追踪）；不支持子进程监控（Linux 限定）。

---

## 🎯 场景题 (Q26-Q28)

### Q26: 设计一个有速率限制的异步 HTTP 客户端

**面试官意图**：考察异步编程实战能力，工程设计思维。

**思路分析**：令牌桶/滑动窗口 + Semaphore + 重试 + 连接池。

**参考答案**：

需求：每秒最多 50 个请求，支持重试和超时，并发上限 200。

```python
import asyncio
import time
import aiohttp
from dataclasses import dataclass

@dataclass
class RateLimiterConfig:
    max_per_second: int = 50
    max_concurrent: int = 200
    max_retries: int = 3
    timeout: float = 10.0

class AsyncRateLimitedClient:
    """基于令牌桶的异步 HTTP 客户端"""
    
    def __init__(self, config: RateLimiterConfig = None):
        self.config = config or RateLimiterConfig()
        self._semaphore = asyncio.Semaphore(self.config.max_concurrent)
        self._tokens = self.config.max_per_second
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None
    
    async def _acquire_token(self):
        """令牌桶：获取一个令牌"""
        while True:
            async with self._lock:
                now = time.monotonic()
                elapsed = now - self._last_refill
                # 按时间补充令牌
                self._tokens = min(
                    self.config.max_per_second,
                    self._tokens + elapsed * self.config.max_per_second
                )
                self._last_refill = now
                
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
            
            # 没有可用令牌，等待一小段时间
            await asyncio.sleep(1.0 / self.config.max_per_second)
    
    async def request(self, method: str, url: str, **kwargs) -> dict:
        """发送限速请求，含重试"""
        if self._session is None:
            self._session = aiohttp.ClientSession()
        
        for attempt in range(self.config.max_retries):
            await self._acquire_token()
            async with self._semaphore:
                try:
                    async with asyncio.timeout(self.config.timeout):
                        async with self._session.request(method, url, **kwargs) as resp:
                            if resp.status == 429:  # Too Many Requests
                                retry_after = float(resp.headers.get("Retry-After", 1))
                                await asyncio.sleep(retry_after)
                                continue
                            resp.raise_for_status()
                            return await resp.json()
                except (aiohttp.ClientError, TimeoutError) as e:
                    if attempt == self.config.max_retries - 1:
                        raise
                    await asyncio.sleep(2 ** attempt)  # 指数退避
        
        raise RuntimeError("Max retries exceeded")
    
    async def close(self):
        if self._session:
            await self._session.close()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, *exc):
        await self.close()

# 使用示例
async def main():
    config = RateLimiterConfig(max_per_second=50, max_concurrent=200)
    
    async with AsyncRateLimitedClient(config) as client:
        urls = [f"https://api.example.com/item/{i}" for i in range(500)]
        
        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(client.request("GET", url)) for url in urls]
        
        results = [t.result() for t in tasks]
        print(f"Fetched {len(results)} items within rate limits")

asyncio.run(main())
```

**设计要点**：
1. **令牌桶算法**：平滑限速，允许突发（令牌累积）
2. **Semaphore**：限制并发连接数，保护下游
3. **指数退避重试**：防止雪崩效应
4. **429 状态码处理**：尊重服务端的 Retry-After
5. **异步上下文管理器**：确保连接正确关闭

---

### Q27: Python 服务 CPU 打满但 QPS 很低，如何排查？

**面试官意图**：考察生产环境 troubleshooting 能力。

**思路分析**：CPU 高 + QPS 低 = 每个请求消耗大量 CPU → 定位 CPU 密集操作。

**参考答案**：

**排查步骤**：

**Step 1：确认是 Python 进程消耗 CPU**

```bash
top -H -p <pid>    # 查看具体线程 CPU 使用率
htop               # 可视化查看所有进程
```

**Step 2：用 py-spy 抓取线上火焰图（无需停机）**

```bash
# py-spy 通过 /proc/<pid>/mem 读取 Python 栈，零侵入
py-spy record -o profile.svg --pid <pid> --duration 30
py-spy top --pid <pid>  # 实时查看热点函数
```

**Step 3：分析常见原因**

| 原因 | 表现 | 解决方案 |
|------|------|---------|
| **同步阻塞调用** | 火焰图中 `requests.get` 等同步调用占比高 | 替换为 aiohttp/httpx 异步调用 |
| **CPU 密集计算在主线程** | JSON 解析/数据处理/正则匹配耗时高 | 用 orjson 替代 json；卸载到进程池 |
| **GIL 竞争** | 多线程但 CPU 利用率只用一个核 | 改用 multiprocessing 或 asyncio |
| **无限循环/死循环** | 某个函数 100% CPU | 代码 review + 添加超时 |
| **日志过多** | 同步日志写入磁盘 | 异步日志 (aiologger) 或降低日志级别 |
| **正则回溯** | `re.match` 耗时异常 | 优化正则表达式，避免灾难性回溯 |

**Step 4：验证修复**

```bash
# 修复后对比 QPS 和 CPU 使用率
wrk -t4 -c100 -d30s http://localhost:8000/api
py-spy record -o profile_after.svg --pid <new_pid>
```

**实际案例**：
- 某 AI 服务 CPU 100% 但 QPS 仅 10。py-spy 显示 60% 时间在 `json.dumps()` 序列化大响应。
- 方案：`json.dumps` → `orjson.dumps`（快 10 倍），QPS 提升到 80+。

---

### Q28: 从 Flask 迁移到 FastAPI，需要注意哪些问题？

**面试官意图**：考察工程迁移经验和两个框架的差异理解。

**思路分析**：同步→异步 / WSGI→ASGI / 数据验证 / 中间件 / 测试。

**参考答案**：

**核心差异对比**：

| 维度 | Flask | FastAPI |
|------|-------|---------|
| 协议 | WSGI（同步） | ASGI（异步） |
| 数据验证 | 手动或 Marshmallow | 内置 Pydantic |
| 类型注解 | 可选 | 核心依赖 |
| API 文档 | 需要 Swagger 插件 | 内置自动生成 |
| 性能 | 低（同步阻塞） | 高（异步非阻塞） |

**迁移注意事项**：

**1. 路由定义差异**

```python
# Flask
@app.route('/items/<int:item_id>', methods=['GET'])
def get_item(item_id):
    return jsonify(items.get(item_id))

# FastAPI — 类型注解驱动
@app.get('/items/{item_id}', response_model=ItemResponse)
async def get_item(item_id: int):
    return items.get(item_id)
```

**2. 数据库访问必须异步化**

```python
# Flask（同步 SQLAlchemy）
db.session.query(User).filter_by(id=1).first()

# FastAPI（异步 SQLAlchemy 2.0+）
async with async_session() as session:
    result = await session.execute(select(User).where(User.id == 1))
    user = result.scalar_one_or_none()
```

**3. 第三方库兼容性**

```python
# 同步库不能直接在 async 路由中使用
# ❌ 阻塞事件循环
@app.get("/data")
async def get_data():
    return requests.get("http://api.example.com").json()

# ✅ 方案1: 使用异步库
async with httpx.AsyncClient() as client:
    response = await client.get("http://api.example.com")

# ✅ 方案2: 卸载到线程池
import asyncio
result = await asyncio.to_thread(requests.get, "http://api.example.com")

# ✅ 方案3: 使用同步路由（FastAPI 自动放入线程池）
@app.get("/data")
def get_data():  # 注意：没有 async，FastAPI 自动用线程池处理
    return requests.get("http://api.example.com").json()
```

**4. 中间件迁移**

```python
# Flask
@app.before_request
def before():
    g.start_time = time.time()

@app.after_request
def after(response):
    duration = time.time() - g.start_time
    response.headers['X-Duration'] = str(duration)
    return response

# FastAPI
from starlette.middleware.base import BaseHTTPMiddleware

class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.time()
        response = await call_next(request)
        response.headers['X-Duration'] = str(time.time() - start)
        return response

app.add_middleware(TimingMiddleware)
```

**5. 测试迁移**

```python
# Flask
with app.test_client() as client:
    resp = client.get('/items/1')

# FastAPI
from httpx import AsyncClient, ASGITransport

async with AsyncClient(
    transport=ASGITransport(app=app),
    base_url="http://test"
) as client:
    resp = await client.get('/items/1')
```

**迁移策略**：
1. **渐进式迁移**：先把 Flask 挂载为 FastAPI 的子应用（`app.mount("/legacy", WSGIMiddleware(flask_app))`）
2. **逐个路由迁移**：新功能用 FastAPI 写，旧路由逐步迁移
3. **优先迁移 I/O 密集路由**——异步化收益最大
4. **保持同步路由兼容**——FastAPI 的 `def`（非 async）路由自动放入线程池

---

## 总结

| 难度 | 核心考点 | 面试关键词 |
|------|---------|-----------|
| ⭐ 基础 | 对象模型、可变/不可变、LEGB、装饰器 | identity vs equality、闭包、语法糖 |
| ⭐⭐ 进阶 | GIL、asyncio、内存管理、描述符、元类 | 引用计数、事件循环、分代GC、C3 |
| ⭐⭐⭐ 高级 | CPython 内部、Free-threaded、性能优化 | 字节码、PEP 703、uvloop |
| 🎯 场景 | 速率限制、CPU 排查、框架迁移 | 令牌桶、py-spy、WSGI→ASGI |
