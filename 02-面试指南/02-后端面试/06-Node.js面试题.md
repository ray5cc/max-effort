# Node.js 核心面试题

> 涵盖事件循环、libuv、V8 引擎、异步编程模式、Express/Koa/NestJS 框架、Worker Threads、Cluster、Stream 等 Node.js 核心知识点的面试题。

## 相关链接

- 对应技术资料：[Node.js 核心与 Web 框架](../../01-技术资料/02-后端/06-Node.js核心与Web框架.md)

## 🔥 高频考点速记

| #   | 考点                     | 核心要点（一句话）                                                             | 出题概率 |
| --- | ------------------------ | ------------------------------------------------------------------------------ | -------- |
| 1   | 事件循环六阶段           | timers→pending→idle/prepare→poll→check→close，每阶段之间清空微任务队列         | ★★★★★    |
| 2   | nextTick vs Promise      | nextTick 优先于 Promise.then，两者都在阶段切换前执行，nextTick 可能饿死 I/O    | ★★★★★    |
| 3   | libuv 线程池             | 默认 4 线程(UV_THREADPOOL_SIZE 最大 1024)，DNS/fs/crypto 走线程池，网络走 epoll | ★★★★★    |
| 4   | V8 JIT 编译管线          | Ignition(字节码)→Sparkplug(快速编译)→Maglev(中间层)→TurboFan(最优化)           | ★★★★☆    |
| 5   | Stream 背压机制          | write()返回 false 时暂停生产者，drain 事件恢复；pipeline()自动处理背压         | ★★★★★    |
| 6   | Express 中间件链         | 线性执行 next()传递，错误中间件 4 参数(err,req,res,next)，路由级/应用级/第三方 | ★★★★☆    |
| 7   | Cluster 多进程           | master fork worker，共享端口(SO_REUSEPORT/round-robin)，PM2 管理生产部署       | ★★★★★    |
| 8   | Worker Threads           | 真正多线程，SharedArrayBuffer 零拷贝共享内存，适合 CPU 密集型                  | ★★★★☆    |
| 9   | 内存泄漏排查             | heapdump→Chrome DevTools 对比快照，常见原因:全局变量/闭包/事件监听器未移除     | ★★★★★    |
| 10  | NestJS 依赖注入          | @Injectable+providers 注册，Module 作用域隔离，请求级/瞬态/单例三种生命周期    | ★★★★☆    |

## 目录

- [⭐ 基础题 (Q1-Q12)](#-基础题-q1-q12)
- [⭐⭐ 进阶题 (Q13-Q24)](#-进阶题-q13-q24)
- [⭐⭐⭐ 高级题 (Q25-Q33)](#-高级题-q25-q33)
- [🎯 场景题 (Q34-Q38)](#-场景题-q34-q38)

---

## ⭐ 基础题 (Q1-Q12)

### Q1: Node.js 是什么？为什么说它是"单线程"的？

**面试官意图**：考察对 Node.js 运行时本质的理解，而非停留在"JavaScript 运行在服务端"的表面认知。

<details>
<summary>参考答案</summary>

Node.js 是一个基于 **V8 引擎**的 JavaScript 运行时，核心由三层组成：

```
┌─────────────────────────────┐
│     JavaScript 应用代码      │  ← 用户代码 + npm 模块
├─────────────────────────────┤
│    Node.js Bindings (C++)   │  ← JS 与 C++ 的桥梁
├──────────────┬──────────────┤
│    V8 引擎   │    libuv     │  ← 执行 JS / 异步 I/O
└──────────────┴──────────────┘
```

**"单线程"的准确含义**：

- **JavaScript 代码**运行在单一线程上（主线程/事件循环线程）
- **底层 I/O 操作**并不是单线程的——libuv 维护一个线程池（默认 4 个线程）处理文件 I/O、DNS 查询等
- **网络 I/O**通过操作系统的异步机制（Linux epoll、macOS kqueue、Windows IOCP）实现非阻塞

**类比**：把 Node.js 想象成一个餐厅的单人前台（主线程），客人（请求）点单后，前台把订单交给后厨多个厨师（libuv 线程池），厨师做好后通知前台，前台再把菜端给客人。前台始终只有一个人，但后厨有多人并行工作。

```javascript
const crypto = require('crypto');

// 这段代码会并行执行，因为 pbkdf2 在 libuv 线程池中运行
const start = Date.now();

for (let i = 0; i < 4; i++) {
  crypto.pbkdf2('password', 'salt', 100000, 64, 'sha512', () => {
    console.log(`Task ${i}: ${Date.now() - start}ms`);
  });
}
// 输出（4 核机器）: 四个任务几乎同时完成（~80ms）
// 如果改为 5 个任务，第 5 个会等前面某个完成后再执行
```

</details>

---

### Q2: 事件循环（Event Loop）的六个阶段是什么？

**面试官意图**：考察对事件循环机制的系统性理解，而非只知道"异步回调"。

<details>
<summary>参考答案</summary>

Node.js 事件循环基于 libuv 实现，每次迭代（tick）按固定顺序经过 **六个阶段**：

```
   ┌───────────────────────────┐
┌─>│        1. Timers          │  setTimeout / setInterval 回调
│  └───────────┬───────────────┘
│              │ ← 微任务队列（nextTick → Promise）
│  ┌───────────┴───────────────┐
│  │   2. Pending Callbacks    │  系统级回调（TCP 错误等）
│  └───────────┬───────────────┘
│              │ ← 微任务队列
│  ┌───────────┴───────────────┐
│  │   3. Idle / Prepare       │  Node.js 内部使用
│  └───────────┬───────────────┘
│              │ ← 微任务队列
│  ┌───────────┴───────────────┐
│  │        4. Poll            │  I/O 回调（文件读写、网络请求）
│  └───────────┬───────────────┘
│              │ ← 微任务队列
│  ┌───────────┴───────────────┐
│  │        5. Check           │  setImmediate 回调
│  └───────────┬───────────────┘
│              │ ← 微任务队列
│  ┌───────────┴───────────────┐
│  │     6. Close Callbacks    │  socket.on('close') 等
│  └───────────┬───────────────┘
│              │ ← 微任务队列
└──────────────┘
```

**各阶段详解**：

| 阶段              | 执行内容                           | 典型 API                          |
| ----------------- | ---------------------------------- | --------------------------------- |
| Timers            | 执行已到期的定时器回调             | `setTimeout`, `setInterval`       |
| Pending Callbacks | 执行上一轮延迟到本轮的 I/O 回调   | 系统级错误回调（如 TCP ECONNREFUSED） |
| Idle / Prepare    | Node.js 内部使用                   | 开发者不可直接使用                |
| **Poll**          | 检索新的 I/O 事件，执行 I/O 回调  | `fs.readFile` 回调、网络请求回调  |
| Check             | 执行 `setImmediate` 回调           | `setImmediate`                    |
| Close Callbacks   | 执行关闭事件回调                   | `socket.on('close')`              |

**关键机制**：Poll 阶段是最核心的——如果没有定时器到期且没有 `setImmediate`，事件循环会在 Poll 阶段**阻塞等待**新的 I/O 事件，避免空转浪费 CPU。

</details>

---

### Q3: `process.nextTick()` 和 `Promise.then()` 的执行优先级是什么？

**面试官意图**：考察对微任务队列优先级的精确理解。

<details>
<summary>参考答案</summary>

在 Node.js 中，微任务队列分为两个子队列，**nextTick 队列优先于 Promise 微任务队列**：

```
每个阶段切换时：
  1. 清空 nextTick 队列（全部执行完毕）
  2. 清空 Promise 微任务队列（全部执行完毕）
  3. 进入下一阶段
```

**验证代码**：

```javascript
Promise.resolve().then(() => console.log('Promise 1'));
process.nextTick(() => console.log('nextTick 1'));
Promise.resolve().then(() => console.log('Promise 2'));
process.nextTick(() => console.log('nextTick 2'));

// 输出顺序：
// nextTick 1
// nextTick 2
// Promise 1
// Promise 2
```

**为什么 nextTick 优先级更高？**

- `process.nextTick` 直接加入 C++ 层的微任务队列（V8 的 microtask queue 之前）
- `Promise.then` 加入 V8 的 microtask queue

**注意事项**：递归调用 `process.nextTick` 会**饿死 I/O**，因为在清空 nextTick 队列之前不会进入下一阶段：

```javascript
// ❌ 危险：I/O 永远无法执行
function recursiveNextTick() {
  process.nextTick(recursiveNextTick);
}
recursiveNextTick();

// ✅ 安全：setImmediate 不会饿死 I/O
function safeRecursive() {
  setImmediate(safeRecursive);
}
```

</details>

---

### Q4: `setImmediate()` 和 `setTimeout(fn, 0)` 有什么区别？

**面试官意图**：考察对 Timers 阶段和 Check 阶段执行时机的理解。

<details>
<summary>参考答案</summary>

两者的执行顺序取决于调用的**上下文**：

**1. 在主模块中调用（非 I/O 回调内）——顺序不确定**：

```javascript
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));

// 输出可能是：
// timeout → immediate 或 immediate → timeout
```

**原因**：`setTimeout(fn, 0)` 实际最低延迟为 1ms。如果事件循环启动时已超过 1ms，Timers 阶段会先执行 setTimeout；如果未超过 1ms，Timers 阶段跳过，进入 Poll → Check 阶段先执行 setImmediate。

**2. 在 I/O 回调中调用——`setImmediate` 始终先执行**：

```javascript
const fs = require('fs');

fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});

// 始终输出：
// immediate
// timeout
```

**原因**：I/O 回调在 Poll 阶段执行，Poll 之后紧接着是 Check 阶段（执行 setImmediate），然后下一轮才到 Timers 阶段。

```
Poll（执行 readFile 回调）
  → 注册 setTimeout 到 Timers 队列
  → 注册 setImmediate 到 Check 队列
→ Check（执行 setImmediate）  ← 先到
→ Close → Timers（执行 setTimeout）← 后到
```

</details>

---

### Q5: Node.js 中 `require()` 的模块加载机制是怎样的？

**面试官意图**：考察 CommonJS 模块解析规则和缓存机制。

<details>
<summary>参考答案</summary>

`require()` 按以下顺序解析模块：

```
require('X')
│
├─ 1. X 是核心模块？（fs, http, path...）
│     → 直接从 Node.js 内置加载，优先级最高
│
├─ 2. X 以 './' 或 '../' 或 '/' 开头？
│     → 作为文件路径解析
│     → 依次尝试: X → X.js → X.json → X.node
│     → 若 X 是目录: X/index.js → X/index.json → X/index.node
│
└─ 3. 否则作为第三方模块
      → 从当前目录逐级向上查找 node_modules/
      → ./node_modules/X
      → ../node_modules/X
      → ../../node_modules/X
      → ... 直到根目录
```

**核心特性——模块缓存**：

```javascript
// counter.js
let count = 0;
module.exports = { increment: () => ++count, getCount: () => count };

// a.js
const counter = require('./counter');
counter.increment();
console.log(counter.getCount()); // 1

// b.js — 拿到的是同一个缓存实例
const counter = require('./counter');
console.log(counter.getCount()); // 1（不是 0！）
```

`require()` 的结果会缓存在 `require.cache` 中，同一模块只会执行一次。可以通过 `delete require.cache[require.resolve('./counter')]` 清除缓存强制重新加载。

**循环依赖处理**：Node.js 不会报错，而是返回**部分导出对象**（执行到 require 那一行时已导出的内容）。

</details>

---

### Q6: Buffer 是什么？和 String 有什么区别？

**面试官意图**：考察对二进制数据处理的理解。

<details>
<summary>参考答案</summary>

Buffer 是 Node.js 用于处理**二进制数据**的固定大小内存区域，分配在 V8 堆外内存（C++ 层面）。

| 维度         | Buffer                        | String                   |
| ------------ | ----------------------------- | ------------------------ |
| 存储内容     | 原始二进制字节                | Unicode 字符（UTF-16）   |
| 内存位置     | V8 堆外（C++ 管理）          | V8 堆内                  |
| 大小         | 创建后固定不可变              | 不可变（拼接产生新对象） |
| 用途         | 文件 I/O、网络传输、加密      | 文本处理                 |
| 编码转换     | 支持多种编码（utf8, hex 等）  | 内部 UTF-16              |

```javascript
// 创建 Buffer 的三种方式
const buf1 = Buffer.alloc(10);              // 10 字节，初始化为 0
const buf2 = Buffer.from('Hello', 'utf8');  // 从字符串创建
const buf3 = Buffer.from([0x48, 0x65]);     // 从字节数组创建

// Buffer 与 String 互转
const str = buf2.toString('utf8');     // 'Hello'
const hex = buf2.toString('hex');      // '48656c6c6f'
const base64 = buf2.toString('base64'); // 'SGVsbG8='

// ⚠️ 安全注意：Buffer.allocUnsafe() 不初始化内存，可能包含敏感旧数据
const unsafe = Buffer.allocUnsafe(10); // 可能包含旧数据！生产环境慎用
```

**为什么 Buffer 分配在堆外？** V8 堆有大小限制（默认约 1.7GB），且频繁 GC 大块内存效率低。Buffer 由 C++ 管理，突破堆限制，适合处理大文件和流数据。

</details>

---

### Q7: Express.js 中间件的执行机制是什么？

**面试官意图**：考察对 Express 中间件链式调用和错误处理的理解。

<details>
<summary>参考答案</summary>

Express 中间件是按**注册顺序线性执行**的函数链，每个中间件通过 `next()` 将控制权传递给下一个：

```
请求 → 中间件1 → 中间件2 → 中间件3 → 路由处理 → 响应
         ↓          ↓          ↓
       next()     next()     next()
```

**三种中间件类型**：

```javascript
const express = require('express');
const app = express();

// 1. 应用级中间件（所有请求都经过）
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${Date.now()}`);
  next(); // 必须调用 next()，否则请求挂起
});

// 2. 路由级中间件（特定路由才触发）
app.get('/api/users', 
  (req, res, next) => {
    // 鉴权中间件
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  },
  (req, res) => {
    res.json({ users: [] });
  }
);

// 3. 错误处理中间件（4 个参数，必须放在最后）
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});
```

**关键规则**：

- 中间件的注册顺序决定执行顺序
- 不调用 `next()` 则请求终止在当前中间件
- 调用 `next(err)` 会跳过后续普通中间件，直接进入错误处理中间件
- 错误处理中间件**必须有 4 个参数**（即使不用 `next`），Express 通过参数数量识别

</details>

---

### Q8: callback、Promise、async/await 三种异步模式有什么区别？

**面试官意图**：考察异步编程演进历程和各模式的优劣。

<details>
<summary>参考答案</summary>

| 维度       | Callback                  | Promise                  | async/await              |
| ---------- | ------------------------- | ------------------------ | ------------------------ |
| 错误处理   | 回调第一个参数 `(err, data)` | `.catch()` 链式捕获      | `try/catch` 同步风格     |
| 可读性     | 嵌套深（回调地狱）        | 链式调用，较好           | 接近同步代码，最佳       |
| 并行控制   | 需要手动计数              | `Promise.all/race/allSettled` | 同 Promise 工具方法   |
| 取消       | 无标准方式                | 无原生支持               | 可配合 AbortController   |
| 调试       | 堆栈信息丢失              | 堆栈较完整               | 堆栈最完整               |

**从回调地狱到 async/await 的演进**：

```javascript
// ❌ Callback Hell
getUser(id, (err, user) => {
  if (err) return handleError(err);
  getOrders(user.id, (err, orders) => {
    if (err) return handleError(err);
    getOrderDetails(orders[0].id, (err, details) => {
      if (err) return handleError(err);
      console.log(details);
    });
  });
});

// ✅ Promise 链
getUser(id)
  .then(user => getOrders(user.id))
  .then(orders => getOrderDetails(orders[0].id))
  .then(details => console.log(details))
  .catch(handleError);

// ✅✅ async/await（推荐）
async function getFullOrderDetails(id) {
  try {
    const user = await getUser(id);
    const orders = await getOrders(user.id);
    const details = await getOrderDetails(orders[0].id);
    console.log(details);
  } catch (err) {
    handleError(err);
  }
}
```

**并行执行对比**：

```javascript
// 串行（慢）——每个 await 等前一个完成
const a = await fetchA(); // 1s
const b = await fetchB(); // 1s
// 总共 2s

// 并行（快）——同时发起
const [a, b] = await Promise.all([fetchA(), fetchB()]);
// 总共 1s
```

</details>

---

### Q9: EventEmitter 的工作原理是什么？

**面试官意图**：考察对观察者模式和 Node.js 事件驱动核心机制的理解。

<details>
<summary>参考答案</summary>

EventEmitter 是 Node.js 的核心类，实现了**观察者模式**（发布-订阅），几乎所有核心模块（Stream、HTTP、Net）都继承自它。

**核心原理**：内部维护一个事件名到监听器数组的映射（本质上是 `Map<string, Function[]>`）。

```javascript
const EventEmitter = require('events');

// 简化的内部实现原理
class MyEmitter {
  constructor() {
    this._events = {};  // { eventName: [listener1, listener2, ...] }
  }

  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this; // 支持链式调用
  }

  emit(event, ...args) {
    const listeners = this._events[event];
    if (!listeners) return false;
    listeners.forEach(fn => fn.apply(this, args));
    return true;
  }

  off(event, listener) {
    const listeners = this._events[event];
    if (!listeners) return this;
    this._events[event] = listeners.filter(fn => fn !== listener);
    return this;
  }
}
```

**实际使用**：

```javascript
const emitter = new EventEmitter();

// 监听事件
emitter.on('data', (chunk) => console.log('收到数据:', chunk));

// 一次性监听
emitter.once('connect', () => console.log('首次连接'));

// 触发事件
emitter.emit('data', 'Hello');  // 收到数据: Hello
emitter.emit('connect');         // 首次连接
emitter.emit('connect');         // 无输出（once 只执行一次）
```

**⚠️ 内存泄漏警告**：默认每个事件最多 10 个监听器，超过会打印警告。这是故意的保护机制：

```javascript
emitter.setMaxListeners(20); // 需要时可调整上限
// 或者 EventEmitter.defaultMaxListeners = 20;
```

</details>

---

### Q10: Node.js 中的错误处理方式有哪些？

**面试官意图**：考察对同步/异步错误处理的全面掌握。

<details>
<summary>参考答案</summary>

Node.js 的错误处理分为**同步**和**异步**两大类：

**1. 同步错误——try/catch**：

```javascript
try {
  JSON.parse('invalid json');
} catch (err) {
  console.error('解析失败:', err.message);
}
```

**2. 回调错误——Error-First Callback**：

```javascript
const fs = require('fs');
fs.readFile('/不存在的文件', (err, data) => {
  if (err) {
    console.error('读取失败:', err.code); // ENOENT
    return;
  }
  console.log(data);
});
```

**3. Promise 错误——.catch() 或 try/catch**：

```javascript
// .catch()
fetchData().catch(err => console.error(err));

// async/await + try/catch
async function run() {
  try {
    const data = await fetchData();
  } catch (err) {
    console.error(err);
  }
}
```

**4. EventEmitter 错误——必须监听 'error' 事件**：

```javascript
const emitter = new EventEmitter();

// ❌ 不监听 error 事件 → 进程崩溃
emitter.emit('error', new Error('boom'));

// ✅ 监听 error 事件
emitter.on('error', (err) => console.error('捕获:', err.message));
```

**5. 全局兜底（生产环境必备）**：

```javascript
// 未捕获的同步异常
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
  process.exit(1); // 必须退出，状态可能已损坏
});

// 未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  // Node.js 16+ 默认会在此终止进程
});
```

**最佳实践**：`uncaughtException` 只做日志记录和清理，然后**必须退出进程**——因为异常发生时应用状态可能已经不一致。

</details>

---

### Q11: CommonJS 和 ES Modules 有什么区别？

**面试官意图**：考察对两种模块系统的差异及其底层原因的理解。

<details>
<summary>参考答案</summary>

| 维度         | CommonJS (CJS)                    | ES Modules (ESM)                 |
| ------------ | --------------------------------- | -------------------------------- |
| 语法         | `require()` / `module.exports`    | `import` / `export`              |
| 加载方式     | **同步**加载                      | **异步**加载                     |
| 加载时机     | **运行时**加载（动态）            | **编译时**静态分析（可 tree-shaking） |
| 导出值       | 导出值的**拷贝**                  | 导出值的**活绑定**（live binding）|
| this 指向    | `this === module.exports`         | `this === undefined`             |
| 顶层 await   | ❌ 不支持                          | ✅ 支持                           |
| 文件扩展名   | `.js`（默认）/ `.cjs`             | `.mjs` 或 `package.json` 设置 `"type": "module"` |

**关键区别：拷贝 vs 活绑定**：

```javascript
// counter.cjs (CommonJS)
let count = 0;
module.exports = { count, increment: () => ++count };

// main.cjs
const mod = require('./counter.cjs');
mod.increment();
console.log(mod.count); // 0 ← 还是旧值！count 是值拷贝

// counter.mjs (ESM)
export let count = 0;
export function increment() { count++; }

// main.mjs
import { count, increment } from './counter.mjs';
increment();
console.log(count); // 1 ← 活绑定，实时反映变化
```

**互操作**：ESM 可以 `import` CJS 模块（默认导出），但 CJS 不能 `require` ESM 模块（需要 `import()` 动态导入）。

</details>

---

### Q12: `__dirname`、`__filename`、`process.cwd()` 有什么区别？

**面试官意图**：考察对路径解析的精确理解，常见于文件操作场景。

<details>
<summary>参考答案</summary>

| API              | 含义                         | 是否随执行位置变化 |
| ---------------- | ---------------------------- | ------------------ |
| `__dirname`      | 当前**文件所在目录**的绝对路径 | ❌ 始终固定          |
| `__filename`     | 当前**文件**的绝对路径       | ❌ 始终固定          |
| `process.cwd()`  | 进程**启动时的工作目录**     | ✅ 随启动位置变化    |

```javascript
// 文件位置：/app/src/utils/helper.js

console.log(__dirname);       // /app/src/utils
console.log(__filename);      // /app/src/utils/helper.js
console.log(process.cwd());   // 取决于从哪里运行

// cd /app && node src/utils/helper.js
// process.cwd() → /app

// cd / && node /app/src/utils/helper.js
// process.cwd() → /
```

**⚠️ ESM 中没有 `__dirname`**：

```javascript
// ESM 替代方案
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

**实战建议**：读取配置文件时用 `path.join(__dirname, '../config.json')`，不要用 `process.cwd()` 拼接，否则在不同目录启动会找不到文件。

</details>

---

## ⭐⭐ 进阶题 (Q13-Q24)

### Q13: 事件循环的 Poll 阶段是如何工作的？为什么说它是最核心的阶段？

**面试官意图**：考察对事件循环调度策略的深入理解。

<details>
<summary>参考答案</summary>

Poll 阶段承担两个核心职责：

1. **计算应该阻塞等待 I/O 的时间**
2. **处理 Poll 队列中的 I/O 回调**

**Poll 阶段的决策流程**：

```
进入 Poll 阶段
    │
    ├─ Poll 队列非空？
    │     → 同步执行队列中所有回调（直到队列清空或达到系统限制）
    │
    └─ Poll 队列为空？
          │
          ├─ 有 setImmediate 被注册？
          │     → 立即结束 Poll，进入 Check 阶段
          │
          └─ 没有 setImmediate？
                │
                ├─ 有定时器到期？
                │     → 回到 Timers 阶段执行定时器回调
                │
                └─ 没有定时器到期？
                      → 在 Poll 阶段阻塞等待新的 I/O 事件
                         （阻塞时间 = 最近定时器到期时间）
```

**为什么说 Poll 最核心？** 因为大部分时间事件循环都停在 Poll 阶段等待 I/O——这就是 Node.js 高效的原因：不忙等，而是由操作系统（epoll/kqueue）通知有事件到来时才唤醒。

**验证代码**：

```javascript
const fs = require('fs');

// 场景：Poll 阶段决定是否跳转到 Check
fs.readFile(__filename, () => {
  // 此回调在 Poll 阶段执行

  // 注册了 setImmediate → Poll 结束后立即进入 Check
  setImmediate(() => console.log('1. setImmediate'));

  // setTimeout 需要等到下一轮 Timers 阶段
  setTimeout(() => console.log('2. setTimeout'), 0);
});

// 输出：
// 1. setImmediate
// 2. setTimeout
```

**追问**：Poll 阶段最大回调执行数量是多少？——由 `uv_run` 内部控制，默认一次处理 1024 个事件（可通过 `UV_IO_LOOP_MAX` 调整）。

</details>

---

### Q14: libuv 线程池的工作原理是什么？UV_THREADPOOL_SIZE 怎么调优？

**面试官意图**：考察对 Node.js 底层 I/O 模型的理解。

<details>
<summary>参考答案</summary>

**libuv 的双轨 I/O 模型**：

```
                    Node.js 主线程（事件循环）
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     操作系统异步机制                libuv 线程池
     (epoll/kqueue/IOCP)           (默认 4 线程)
              │                         │
     ┌────────┤                    ┌────┼────┐
     │        │                    │    │    │
   TCP/UDP  管道                  DNS   fs  crypto
   网络 I/O  信号                查询  操作  计算
```

**走线程池的操作**（因为操作系统没有提供对应的异步接口）：

- **文件系统**操作（`fs.readFile`, `fs.stat` 等）
- **DNS 查询**（`dns.lookup`，注意不是 `dns.resolve`）
- **加密操作**（`crypto.pbkdf2`, `crypto.randomBytes`）
- **zlib 压缩**

**不走线程池的操作**（直接使用操作系统异步机制）：

- **网络 I/O**（TCP/UDP）—— epoll/kqueue/IOCP
- **`dns.resolve`** —— 使用 c-ares 异步 DNS 库

**调优 UV_THREADPOOL_SIZE**：

```bash
# 默认 4 线程，最大 1024
UV_THREADPOOL_SIZE=16 node server.js
```

```javascript
// 也可以在代码中设置（必须在任何异步操作之前）
process.env.UV_THREADPOOL_SIZE = '16';
```

**调优依据**：

| 场景                       | 建议值           |
| -------------------------- | ---------------- |
| I/O 密集（大量文件操作）   | CPU 核心数 × 2-4 |
| 计算密集（crypto 操作多）  | CPU 核心数       |
| DNS 密集（大量外部请求）   | 至少 8-16        |
| 通用 Web 服务器            | 保持默认 4       |

**验证线程池瓶颈**：

```javascript
const crypto = require('crypto');
const start = Date.now();

// 默认 4 线程：前 4 个并行完成，第 5 个要等
for (let i = 0; i < 5; i++) {
  crypto.pbkdf2('password', 'salt', 100000, 64, 'sha512', () => {
    console.log(`Task ${i}: ${Date.now() - start}ms`);
  });
}
// 输出（4核机器，UV_THREADPOOL_SIZE=4）：
// Task 0: 82ms
// Task 1: 83ms
// Task 2: 84ms
// Task 3: 85ms
// Task 4: 165ms  ← 第 5 个等到一个线程空闲才执行
```

</details>

---

### Q15: V8 的 JIT 编译管线是怎样的？从源码到机器码经过哪些步骤？

**面试官意图**：考察对 V8 引擎内部优化机制的理解。

<details>
<summary>参考答案</summary>

V8 采用**多层编译**策略，在启动速度和峰值性能之间取得平衡：

```
JavaScript 源码
       │
       ▼
   ┌────────┐
   │ Parser │  语法分析 → AST（抽象语法树）
   └───┬────┘
       ▼
   ┌──────────┐
   │ Ignition │  解释器，将 AST → 字节码（Bytecode）
   └───┬──────┘  快速启动，边执行边收集类型反馈（Type Feedback）
       │
       │  函数被调用多次？（热点代码 Hot Code）
       ▼
   ┌───────────┐
   │ Sparkplug │  非优化编译器，字节码 → 简单机器码
   └───┬───────┘  不做复杂优化，但比解释器快 5-15%
       │
       │  继续收集类型反馈...函数更热？
       ▼
   ┌────────┐
   │ Maglev │  中间层编译器（V8 v11.1+/Node.js 20+）
   └───┬────┘  做基本优化（内联、类型特化），编译时间适中
       │
       │  非常热的代码 + 类型信息稳定？
       ▼
   ┌──────────┐
   │ TurboFan │  最优化编译器，生成高度优化的机器码
   └──────────┘  做激进优化（逃逸分析、循环展开、内联缓存）
                 ⚠️ 如果类型假设失效 → Deoptimization（退回 Ignition）
```

**关键概念**：

- **类型反馈（Type Feedback）**：V8 在 Ignition 执行字节码时，记录变量的实际类型。TurboFan 根据这些信息做类型特化优化。
- **去优化（Deoptimization）**：如果 TurboFan 的类型假设被违反（如函数参数类型突然变了），会回退到 Ignition 重新解释执行。

**编写对 V8 友好的代码**：

```javascript
// ✅ 类型稳定 → TurboFan 能充分优化
function add(a, b) { return a + b; }
add(1, 2);     // 整数加法
add(3, 4);     // 整数加法（类型一致，V8 会优化为直接整数运算）

// ❌ 类型不稳定 → 反复去优化
add(1, 2);     // 整数
add('a', 'b'); // 字符串拼接 → Deoptimization!
add(1.5, 2.5); // 浮点数 → 又去优化!
```

</details>

---

### Q16: V8 的隐藏类（Hidden Classes）和内联缓存（Inline Caching）是什么？

**面试官意图**：考察对 V8 对象属性访问优化机制的理解。

<details>
<summary>参考答案</summary>

JavaScript 是动态类型语言，对象属性可以随时增删。V8 通过**隐藏类**和**内联缓存**把动态属性访问优化到接近静态语言的性能。

**隐藏类（Hidden Classes / Maps）**：

V8 为每个对象创建一个隐藏类，描述其属性布局。属性相同的对象共享同一隐藏类：

```
const a = {};       // HiddenClass H0: {}
a.x = 1;            // HiddenClass H1: {x: offset 0}
a.y = 2;            // HiddenClass H2: {x: offset 0, y: offset 1}

const b = {};       // H0
b.x = 10;           // H1 ← 与 a 相同的隐藏类！
b.y = 20;           // H2 ← 相同布局 → 共享隐藏类
```

**内联缓存（Inline Caching / IC）**：

V8 在**属性访问处**缓存隐藏类和属性偏移量，避免每次都查找：

```
function getX(obj) { return obj.x; }

// 第 1 次调用 getX(a)：
// 查找 a 的隐藏类 → 找到 x 在 offset 0 → 缓存 {H2 → offset 0}

// 第 2 次调用 getX(b)：
// b 的隐藏类也是 H2 → 命中缓存 → 直接读 offset 0（无需查找！）
```

**编写对隐藏类友好的代码**：

```javascript
// ✅ 好：以相同顺序初始化属性
function Point(x, y) {
  this.x = x;  // 所有 Point 实例共享相同的隐藏类
  this.y = y;
}
const p1 = new Point(1, 2);
const p2 = new Point(3, 4); // 与 p1 共享隐藏类

// ❌ 差：不同顺序创建属性 → 不同隐藏类
const obj1 = { a: 1, b: 2 }; // HiddenClass: {a, b}
const obj2 = { b: 2, a: 1 }; // HiddenClass: {b, a} ← 不同！

// ❌ 差：动态添加/删除属性
const obj = { x: 1 };
delete obj.x;           // 强制退出隐藏类优化（转为字典模式）
obj[dynamicKey] = value; // 无法预测属性布局
```

**追问**：什么是 Megamorphic IC？——当一个属性访问位置见过太多不同的隐藏类（通常 >4），V8 放弃内联缓存，退化为通用的哈希表查找（字典模式），性能急剧下降。

</details>

---

### Q17: Node.js 中 Stream 的四种类型是什么？背压（Backpressure）机制如何工作？

**面试官意图**：考察对流式处理和背压机制的深入理解。

<details>
<summary>参考答案</summary>

**四种 Stream 类型**：

| 类型        | 描述                 | 典型示例                              |
| ----------- | -------------------- | ------------------------------------- |
| Readable    | 可读流（数据生产者） | `fs.createReadStream`, `http.IncomingMessage` |
| Writable    | 可写流（数据消费者） | `fs.createWriteStream`, `http.ServerResponse` |
| Duplex      | 双工流（可读可写）   | `net.Socket`, `zlib.createGzip`       |
| Transform   | 转换流（读写+变换）  | `zlib.createGzip`, `crypto.createCipher` |

```
Readable ──────→ Transform ──────→ Writable
(文件读取)       (gzip 压缩)       (网络发送)
```

**背压（Backpressure）机制**：

当生产者（Readable）的速度快于消费者（Writable）时，需要背压机制防止内存溢出。

```
 Readable（快）           Writable（慢）
    │                         │
    │   write(chunk)          │
    ├────────────────────────>│
    │   返回 true             │  缓冲区未满
    │<────────────────────────│
    │                         │
    │   write(chunk)          │
    ├────────────────────────>│
    │   返回 false ⚠️         │  缓冲区已满（> highWaterMark）
    │<────────────────────────│
    │                         │
    │   暂停读取 pause()      │
    │   ......等待......      │
    │                         │
    │   'drain' 事件 ✅       │  缓冲区排空
    │<────────────────────────│
    │   恢复读取 resume()     │
    │                         │
```

**手动处理背压**：

```javascript
const fs = require('fs');
const readable = fs.createReadStream('huge-file.csv');
const writable = fs.createWriteStream('output.csv');

readable.on('data', (chunk) => {
  const canContinue = writable.write(chunk);
  if (!canContinue) {
    readable.pause(); // 暂停读取
    writable.once('drain', () => {
      readable.resume(); // 缓冲区排空后恢复
    });
  }
});

readable.on('end', () => writable.end());
```

**推荐用 pipeline() 自动处理背压**：

```javascript
const { pipeline } = require('stream/promises');
const zlib = require('zlib');

await pipeline(
  fs.createReadStream('input.log'),
  zlib.createGzip(),
  fs.createWriteStream('input.log.gz')
);
// pipeline 自动处理背压 + 错误传播 + 资源清理
```

</details>

---

### Q18: Express 和 Koa 的中间件模型有什么区别？

**面试官意图**：考察对两种框架设计哲学的对比理解。

<details>
<summary>参考答案</summary>

**Express——线性中间件模型**：

```
请求 → MW1 → MW2 → MW3 → 路由处理
            next()  next()  next()
响应 ← ──────────────────────────
```

中间件调用 `next()` 后，控制权一去不回（除非手动在 `next()` 回调中处理）。

**Koa——洋葱模型（Onion Model）**：

```
请求 ────────────────────→
  │                       │
  │  ┌── MW1 ──────────┐  │
  │  │  ┌── MW2 ────┐  │  │
  │  │  │  ┌─ MW3 ┐ │  │  │
  │  │  │  │ 路由  │ │  │  │
  │  │  │  └───────┘ │  │  │
  │  │  └────────────┘  │  │
  │  └──────────────────┘  │
  │                       │
←──────────────────────────
                      响应
```

```javascript
// Koa 洋葱模型示例
const Koa = require('koa');
const app = new Koa();

app.use(async (ctx, next) => {
  console.log('1. 请求进入 MW1');
  const start = Date.now();
  await next(); // 进入下一层
  const ms = Date.now() - start;
  console.log(`6. MW1 响应阶段 - 耗时 ${ms}ms`);
});

app.use(async (ctx, next) => {
  console.log('2. 请求进入 MW2');
  await next();
  console.log('5. MW2 响应阶段');
});

app.use(async (ctx, next) => {
  console.log('3. 请求进入 MW3（路由）');
  ctx.body = 'Hello';
  console.log('4. MW3 处理完毕');
});

// 输出顺序：1 → 2 → 3 → 4 → 5 → 6
```

**核心对比**：

| 维度         | Express                     | Koa                          |
| ------------ | --------------------------- | ---------------------------- |
| 中间件模型   | 线性（单向）                | 洋葱（双向）                 |
| 异步支持     | 基于 Callback               | 原生 async/await             |
| 错误处理     | 特殊的 4 参数中间件         | try/catch 包裹 `await next()` |
| 响应阶段     | 需要额外逻辑实现            | 天然支持（`await next()` 之后） |
| Context 对象 | `req + res` 分离            | 统一 `ctx` 对象封装          |
| 内置功能     | 内置路由、模板、静态文件    | 极简核心，一切靠中间件      |
| 体积         | ~560KB                      | ~55KB                        |

**Koa 洋葱模型的核心优势**：可以在 `await next()` 之后执行**响应阶段**的逻辑（如计时、日志、响应头修改），这在 Express 中很难优雅实现。

</details>

---

### Q19: Node.js 中如何处理 `uncaughtException` 和 `unhandledRejection`？

**面试官意图**：考察生产环境错误兜底策略。

<details>
<summary>参考答案</summary>

**两种全局异常事件**：

| 事件                 | 触发场景                       | Node.js 默认行为                |
| -------------------- | ------------------------------ | ------------------------------- |
| `uncaughtException`  | 同步代码抛出未被 catch 的异常  | 打印堆栈，退出进程（exit code 1）|
| `unhandledRejection` | Promise 被 reject 但没有 catch | Node.js 16+：终止进程            |

**生产环境最佳实践**：

```javascript
const logger = require('./logger'); // Winston/Pino 等

// 未捕获同步异常
process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin }, '未捕获异常，准备退出');

  // 关键：尝试优雅关闭，然后强制退出
  gracefulShutdown().finally(() => {
    process.exit(1); // 必须退出！状态可能已损坏
  });
});

// 未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, '未处理的 Promise 拒绝');

  // 方案一：转为 uncaughtException 统一处理
  throw reason;

  // 方案二：直接退出
  // process.exit(1);
});

// 优雅关闭函数
async function gracefulShutdown() {
  const timeout = setTimeout(() => {
    logger.warn('强制退出（超时 10s）');
    process.exit(1);
  }, 10_000);

  try {
    await server.close();        // 停止接受新连接
    await database.disconnect(); // 关闭数据库连接
    await messageQueue.close();  // 关闭消息队列
  } finally {
    clearTimeout(timeout);
  }
}
```

**为什么 `uncaughtException` 后必须退出？**

`uncaughtException` 意味着应用处于**未定义状态**——可能有请求处理到一半、数据库事务未提交、锁未释放。继续运行可能导致数据损坏。正确做法是退出进程，由 PM2/Kubernetes 等进程管理器重启。

**追问**：如何区分 operational error 和 programmer error？

- **Operational error**（可预期）：网络超时、磁盘满、用户输入无效 → 捕获并处理
- **Programmer error**（Bug）：读取 undefined 的属性、传错参数 → 让进程崩溃重启

</details>

---

### Q20: Cluster 模式的工作原理是什么？如何实现多进程负载均衡？

**面试官意图**：考察 Node.js 多进程架构的理解。

<details>
<summary>参考答案</summary>

Node.js Cluster 模块利用 `fork()` 创建多个 Worker 进程，共享同一个端口。

**架构**：

```
                    ┌──────────────┐
                    │  Master 进程  │  不处理业务逻辑
                    │  (管理者)     │  负责 fork Worker + 监控
                    └──────┬───────┘
                           │ fork()
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Worker 1 │    │ Worker 2 │    │ Worker 3 │
    │ (PID 101)│    │ (PID 102)│    │ (PID 103)│
    └──────────┘    └──────────┘    └──────────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
                    端口 3000（共享）
```

**负载均衡策略**：

| 平台    | 策略                                                      |
| ------- | --------------------------------------------------------- |
| Linux   | 默认 Round-Robin（轮询），由 Master 分配连接给各 Worker   |
| Windows | 由操作系统调度（可能不均匀）                              |

**基础实现**：

```javascript
const cluster = require('cluster');
const http = require('http');
const os = require('os');

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} 启动，fork ${numCPUs} 个 Worker`);

  // 为每个 CPU 核心 fork 一个 Worker
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Worker 退出后自动重启
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} 退出 (${signal || code})`);
    if (!worker.exitedAfterDisconnect) {
      console.log('重启新 Worker...');
      cluster.fork();
    }
  });

} else {
  // Worker 进程：运行 HTTP 服务器
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end(`Worker ${process.pid} 处理请求\n`);
  }).listen(3000);

  console.log(`Worker ${process.pid} 已启动`);
}
```

**生产环境推荐使用 PM2**：

```bash
# PM2 自动管理 Cluster 模式
pm2 start app.js -i max          # max = CPU 核心数
pm2 reload app.js                # 零停机重启（逐个重启 Worker）
pm2 scale app.js +2              # 动态增加 2 个 Worker
```

**追问**：Cluster 模式下如何处理 WebSocket 的 Sticky Session（粘性会话）？——WebSocket 需要保持长连接，同一客户端的所有请求必须路由到同一 Worker。可以使用 `sticky-session` 库或 Nginx 的 `ip_hash` 实现。

</details>

---

### Q21: Worker Threads 和 `child_process` 有什么区别？各自适用什么场景？

**面试官意图**：考察对 Node.js 多线程与多进程模型的区别理解。

<details>
<summary>参考答案</summary>

| 维度         | Worker Threads                    | child_process                    |
| ------------ | --------------------------------- | -------------------------------- |
| 资源         | 线程（共享进程内存空间）          | 独立进程（独立内存空间）         |
| 内存共享     | 可通过 SharedArrayBuffer 共享     | 不共享，只能通过 IPC 通信        |
| 启动开销     | 轻量（~10ms，共享 V8 Isolate）    | 重量（~30-100ms，新建进程）      |
| 通信方式     | MessagePort（结构化克隆/转移）    | IPC（stdin/stdout/消息通道）     |
| 崩溃影响     | Worker 崩溃不会导致主进程退出     | 子进程崩溃不影响父进程           |
| 适用场景     | CPU 密集计算（图像处理、加密）    | 运行独立程序（Python 脚本等）    |

**Worker Threads 示例（CPU 密集任务）**：

```javascript
// main.js
const { Worker, isMainThread, parentPort } = require('worker_threads');

if (isMainThread) {
  // 主线程：创建 Worker 并接收结果
  const worker = new Worker(__filename, {
    workerData: { start: 1, end: 1_000_000 }
  });

  worker.on('message', (result) => {
    console.log('质数个数:', result);
  });

  worker.on('error', (err) => console.error('Worker 错误:', err));
  worker.on('exit', (code) => {
    if (code !== 0) console.error(`Worker 异常退出: code ${code}`);
  });

} else {
  // Worker 线程：执行 CPU 密集计算
  const { workerData } = require('worker_threads');

  function countPrimes(start, end) {
    let count = 0;
    for (let i = start; i <= end; i++) {
      if (isPrime(i)) count++;
    }
    return count;
  }

  function isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i <= Math.sqrt(n); i++) {
      if (n % i === 0) return false;
    }
    return true;
  }

  parentPort.postMessage(countPrimes(workerData.start, workerData.end));
}
```

**使用 SharedArrayBuffer 零拷贝共享数据**：

```javascript
// 主线程和 Worker 共享同一块内存（无需复制）
const sharedBuffer = new SharedArrayBuffer(1024);
const sharedArray = new Int32Array(sharedBuffer);

const worker = new Worker('./worker.js', {
  workerData: { sharedBuffer }
});

// worker.js 中：
// const { workerData } = require('worker_threads');
// const sharedArray = new Int32Array(workerData.sharedBuffer);
// Atomics.add(sharedArray, 0, 1); // 原子操作，线程安全
```

**选型建议**：

- **CPU 密集 + 需要共享内存** → Worker Threads
- **运行外部命令/脚本** → `child_process.exec/spawn`
- **多实例水平扩展** → Cluster

</details>

---

### Q22: NestJS 的模块化架构和依赖注入是怎样的？

**面试官意图**：考察对企业级 Node.js 框架设计模式的理解。

<details>
<summary>参考答案</summary>

NestJS 深度借鉴 Angular 的架构，核心概念有三个：**Module（模块）、Controller（控制器）、Provider/Service（服务）**。

```
Application
├── AppModule（根模块）
│   ├── UsersModule
│   │   ├── UsersController    ← 处理 HTTP 请求路由
│   │   ├── UsersService       ← 业务逻辑
│   │   └── UsersRepository    ← 数据访问
│   ├── AuthModule
│   │   ├── AuthController
│   │   ├── AuthService
│   │   └── JwtStrategy
│   └── SharedModule
│       ├── LoggerService
│       └── CacheService
```

**依赖注入（DI）的工作原理**：

```typescript
// 1. 定义 Service（用 @Injectable 标记为可注入）
@Injectable()
export class UsersService {
  constructor(
    // NestJS 的 IoC 容器自动注入 UsersRepository 实例
    private readonly usersRepo: UsersRepository,
    private readonly logger: LoggerService,
  ) {}

  async findById(id: string): Promise<User> {
    this.logger.log(`查找用户: ${id}`);
    return this.usersRepo.findOne(id);
  }
}

// 2. 定义 Controller（使用装饰器定义路由）
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}

// 3. 定义 Module（组织 Controller + Provider）
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  imports: [SharedModule],    // 导入其他模块
  exports: [UsersService],    // 导出供其他模块使用
})
export class UsersModule {}
```

**三种 Provider 作用域**：

| 作用域      | 说明                                    | 用途                     |
| ----------- | --------------------------------------- | ------------------------ |
| `DEFAULT`   | 单例（整个应用共享一个实例）            | 大部分 Service           |
| `REQUEST`   | 每个请求创建新实例                      | 需要请求级状态的 Service |
| `TRANSIENT` | 每次注入都创建新实例                    | 无状态的工具类           |

```typescript
@Injectable({ scope: Scope.REQUEST })
export class RequestScopedService {
  // 每个 HTTP 请求都会获得一个全新的实例
}
```

**追问**：NestJS 的 DI 容器是如何在运行时知道要注入什么的？——利用 TypeScript 的 `emitDecoratorMetadata` 编译选项，在编译时将类型信息保存为元数据，运行时通过 `Reflect.getMetadata('design:paramtypes', target)` 读取构造函数的参数类型。

</details>

---

### Q23: Node.js 的垃圾回收（GC）机制是怎样的？

**面试官意图**：考察对 V8 内存管理的理解。

<details>
<summary>参考答案</summary>

V8 将堆内存分为**新生代**和**老生代**，使用不同的 GC 算法：

```
V8 堆内存布局
┌─────────────────────────────────────┐
│              新生代 (Young Gen)      │  默认 ~16MB（64 位系统）
│  ┌──────────┐   ┌──────────────┐    │
│  │ Semi-     │   │ Semi-        │    │  Scavenger 算法
│  │ Space     │   │ Space        │    │  （复制式 GC）
│  │ (From)    │   │ (To)         │    │
│  └──────────┘   └──────────────┘    │
├─────────────────────────────────────┤
│              老生代 (Old Gen)        │  默认 ~1.4GB（64 位系统）
│                                     │  Mark-Sweep + Mark-Compact
│                                     │  （标记清除 + 标记整理）
└─────────────────────────────────────┘
```

**Scavenger（新生代 GC）**：

1. 新对象分配在 From 空间
2. GC 时，将 From 中存活对象复制到 To 空间
3. 交换 From 和 To 的角色
4. 如果对象经历了两次 Scavenge 仍然存活 → **晋升到老生代**

```
Scavenge 过程：
From: [A][B][C][D]    To: [空]
         ↓ GC（B、D 已死）
From: [空]            To: [A][C]
         ↓ 交换角色
From: [A][C]          To: [空]
```

**Mark-Compact（老生代 GC）**：

1. **标记阶段（Mark）**：从 GC Root 出发，标记所有可达对象
2. **清除阶段（Sweep）**：回收未标记对象的内存
3. **整理阶段（Compact）**：将存活对象移动到内存一端，消除碎片

**GC 调优手段**：

```bash
# 增加老生代内存（处理大数据时）
node --max-old-space-size=4096 app.js  # 4GB

# 增加新生代内存（高频创建临时对象时）
node --max-semi-space-size=64 app.js   # 64MB

# 查看 GC 日志
node --trace-gc app.js
# 输出: [12345:0x...] 8.2 ms: Scavenge 10.2 (20.4) -> 5.1 (20.4) MB
```

**追问**：V8 如何减少 GC 的 Stop-The-World（STW）时间？——增量标记（Incremental Marking）将标记工作分成小步与 JS 执行交替进行；并行标记（Parallel Marking）利用多个辅助线程同时标记；并发标记（Concurrent Marking）在 JS 运行的同时进行标记。

</details>

---

### Q24: 什么是原型链污染（Prototype Pollution）？Node.js 中如何防范？

**面试官意图**：考察 Node.js 安全意识。

<details>
<summary>参考答案</summary>

原型链污染是指攻击者通过修改 `Object.prototype`，向所有对象注入恶意属性。

**攻击原理**：

```javascript
// 不安全的对象合并函数
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// 攻击 payload
const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
merge({}, malicious);

// 现在所有对象都被污染了！
const user = {};
console.log(user.isAdmin); // true ← 攻击成功！
```

**真实攻击场景**：

```javascript
// Express 中常见的配置合并
app.use(express.json()); // 解析 JSON body

app.post('/settings', (req, res) => {
  merge(config, req.body); // ← 用户可以注入 __proto__
  res.json({ ok: true });
});

// 攻击者发送:
// POST /settings
// {"__proto__": {"isAdmin": true}}
// 之后所有用户对象都有 isAdmin=true
```

**防范措施**：

```javascript
// 1. 过滤危险属性
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue; // 跳过危险属性
    }
    // ...正常合并
  }
}

// 2. 使用 Object.create(null) 创建无原型对象
const safeObj = Object.create(null); // 没有 __proto__

// 3. 使用 Map 替代普通对象
const config = new Map();
config.set('theme', 'dark');

// 4. Object.freeze(Object.prototype)——极端方案
Object.freeze(Object.prototype);

// 5. 使用安全的库：lodash 4.17.21+ 的 _.merge 已修复
```

**追问**：如何检测项目中是否有原型链污染漏洞？——使用 `npm audit`、Snyk、或专用工具 `pp-finder` 扫描。CI/CD 中集成 `npm audit --audit-level=high` 自动阻断。

</details>

---

## ⭐⭐⭐ 高级题 (Q25-Q33)

### Q25: 请详细描述一段代码的事件循环执行顺序（含微任务、定时器、I/O）

**面试官意图**：考察对事件循环执行模型的精确、综合理解。

<details>
<summary>参考答案</summary>

**分析以下代码的输出顺序**：

```javascript
const fs = require('fs');

console.log('1. 同步代码');

setTimeout(() => {
  console.log('2. setTimeout 0ms');
  Promise.resolve().then(() => console.log('3. setTimeout 中的 Promise'));
}, 0);

setImmediate(() => {
  console.log('4. setImmediate');
  process.nextTick(() => console.log('5. setImmediate 中的 nextTick'));
});

fs.readFile(__filename, () => {
  console.log('6. I/O 回调');
  setTimeout(() => console.log('7. I/O 中的 setTimeout'), 0);
  setImmediate(() => console.log('8. I/O 中的 setImmediate'));
  process.nextTick(() => console.log('9. I/O 中的 nextTick'));
});

Promise.resolve().then(() => console.log('10. Promise'));
process.nextTick(() => console.log('11. nextTick'));

console.log('12. 同步代码结束');
```

**执行顺序分析**：

```
第一阶段：同步代码执行
  → 输出 "1. 同步代码"
  → 注册 setTimeout 到 Timers 队列
  → 注册 setImmediate 到 Check 队列
  → 发起 fs.readFile（libuv 线程池处理）
  → 注册 Promise.then 到微任务队列
  → 注册 nextTick 到 nextTick 队列
  → 输出 "12. 同步代码结束"

第二阶段：清空微任务队列（进入事件循环前）
  → nextTick 队列优先 → 输出 "11. nextTick"
  → Promise 队列       → 输出 "10. Promise"

第三阶段：Timers 阶段
  → 执行 setTimeout 回调 → 输出 "2. setTimeout 0ms"
  → 清空微任务 → 输出 "3. setTimeout 中的 Promise"

第四阶段：Pending → Idle → Poll 阶段
  → 如果 I/O 已完成：输出 "6. I/O 回调"
  → 清空微任务 → 输出 "9. I/O 中的 nextTick"

第五阶段：Check 阶段
  → 输出 "4. setImmediate"
  → 清空微任务 → 输出 "5. setImmediate 中的 nextTick"
  → 输出 "8. I/O 中的 setImmediate"

第六阶段：下一轮 Timers
  → 输出 "7. I/O 中的 setTimeout"
```

**最终输出**（最可能的顺序）：

```
1. 同步代码
12. 同步代码结束
11. nextTick
10. Promise
2. setTimeout 0ms
3. setTimeout 中的 Promise
4. setImmediate
5. setImmediate 中的 nextTick
6. I/O 回调
9. I/O 中的 nextTick
8. I/O 中的 setImmediate
7. I/O 中的 setTimeout
```

> **注意**：6-9 的位置取决于文件读取完成的时机。如果读取很快（已缓存），可能在第一轮 Poll 阶段就执行；如果较慢，可能推迟到下一轮。

**追问**：Node.js 11+ 和 Node.js 10 在微任务执行时机上有什么区别？

Node.js 11+ 对齐了浏览器行为：**每个宏任务执行完立即清空微任务队列**。而 Node.js 10 及之前版本是在**每个阶段的所有回调执行完毕后**才统一清空微任务队列。这意味着 `setTimeout` 队列中有多个回调时，Node.js 11+ 会在每个回调之间插入微任务执行。

</details>

---

### Q26: libuv 中一个异步 I/O 请求的完整生命周期是怎样的？

**面试官意图**：考察对 Node.js 异步 I/O 底层实现的深度理解。

<details>
<summary>参考答案</summary>

以 `fs.readFile()` 为例，完整生命周期如下：

```
JavaScript 层                    C++ / libuv 层
─────────────                    ──────────────
fs.readFile(path, cb)
       │
       ▼
Node.js Binding (C++)
       │  创建 uv_fs_t 请求对象
       ▼
uv_fs_read()
       │
       ├─ 提交到 libuv 线程池任务队列
       │
       │  ┌──────────── 线程池 ────────────┐
       │  │                                │
       │  │  空闲线程取出任务               │
       │  │       │                        │
       │  │       ▼                        │
       │  │  执行阻塞式系统调用            │
       │  │  read(fd, buf, count)          │
       │  │       │                        │
       │  │       ▼                        │
       │  │  系统调用返回                  │
       │  │  标记请求完成                  │
       │  │  通知事件循环(uv_async_send)   │
       │  │                                │
       │  └────────────────────────────────┘
       │
       ▼
事件循环被唤醒
       │
       ▼
Poll 阶段 / Pending Callbacks 阶段
       │  取出已完成的 I/O 请求
       │  调用 JavaScript 回调
       ▼
cb(null, data)  ← 用户回调在主线程执行
```

**关键技术细节**：

1. **任务提交**：`uv_fs_read()` 将请求封装为 `uv_work_t` 结构体，加入线程池的任务队列
2. **线程执行**：线程池中的空闲线程通过条件变量（`pthread_cond_wait`）被唤醒，执行阻塞式系统调用
3. **完成通知**：线程完成后调用 `uv_async_send()`，通过跨线程通知机制（`eventfd` / pipe）唤醒事件循环
4. **回调执行**：事件循环在 Poll 阶段取出已完成的请求，在主线程中调用 JavaScript 回调

**网络 I/O 的不同之处**：

网络 I/O **不走线程池**，而是直接使用操作系统的异步事件通知机制：

```
┌──────────────┐
│  事件循环     │
│              │
│  epoll_wait()│ ← 阻塞等待，直到有 I/O 事件就绪
│       │      │
│       ▼      │
│  socket 可读 │ → 执行 onData 回调
│  socket 可写 │ → 执行 onDrain 回调
│  新连接到达  │ → 执行 onConnection 回调
└──────────────┘
```

**追问**：为什么文件 I/O 不能像网络 I/O 那样使用 epoll？——因为 Linux 的 epoll 不支持普通文件描述符（只支持 socket、pipe 等）。虽然 Linux 5.1+ 提供了 io_uring 异步文件 I/O，libuv 1.45+ 已在实验性支持。

</details>

---

### Q27: V8 垃圾回收的 Scavenger 和 Mark-Compact 算法的具体工作步骤是什么？

**面试官意图**：考察对 GC 算法细节的深度理解。

<details>
<summary>参考答案</summary>

**一、Scavenger（新生代 — Cheney 算法变体）**

```
初始状态：
  From-Space: [A] [B] [C] [D] [E]
  To-Space:   [  空  空  空  空  ]

  GC Root → A → C    （A、C 可达）
            B          （B 不可达——垃圾）
            D → E      （D、E 可达）
```

**步骤**：

1. **从 GC Root 开始**，将根直接引用的对象（A、D）复制到 To-Space
2. **广度优先扫描** To-Space 中的对象，发现 A 引用 C → 复制 C 到 To-Space
3. 发现 D 引用 E → 复制 E 到 To-Space
4. **B 未被任何根或存活对象引用** → 不复制 → 内存回收
5. **交换 From 和 To 的角色**

```
完成后：
  From-Space（原 To）: [A'] [D'] [C'] [E']
  To-Space（原 From）: [   全部清空    ]

  对象晋升规则：
  - 经历 2 次 Scavenge 仍然存活 → 晋升到老生代
  - To-Space 使用率超过 25% → 直接晋升
```

**二、Mark-Compact（老生代）**

**Phase 1 — 标记（Mark）**：

```
对象图:
  Root → [A] → [B]
         [C] → [D]      Root → C
         [E]             E 无引用 → 垃圾

三色标记法：
  白色 = 未访问（潜在垃圾）
  灰色 = 已发现但子对象未扫描
  黑色 = 已扫描完毕（确认存活）

步骤：
  1. 所有对象初始为白色
  2. Root 引用的对象（A、C）标记为灰色
  3. 扫描灰色对象 A → 发现 B → B 标灰，A 标黑
  4. 扫描灰色对象 C → 发现 D → D 标灰，C 标黑
  5. 扫描灰色对象 B、D → 无新引用 → 标黑
  6. 剩余白色对象 E → 垃圾
```

**Phase 2 — 整理（Compact）**：

```
整理前（有碎片）：
  [A] [  ] [B] [  ] [  ] [C] [D] [  ]

整理后（连续内存）：
  [A] [B] [C] [D] [        空闲        ]

好处：
  - 消除内存碎片
  - 提高内存分配效率（只需移动指针）
  - 提高 CPU 缓存命中率
```

**V8 的增量/并发优化**：

| 技术           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 增量标记       | 将标记拆成小步，与 JS 执行交替（每次 ~5ms）       |
| 并发标记       | 辅助线程在 JS 运行时同时标记（利用写屏障保证一致性） |
| 并行清除       | 多个辅助线程同时清除/整理未标记对象               |
| 延迟清除       | 清除工作可以延后，不必在标记完成后立即执行        |

</details>

---

### Q28: 如何对 Node.js 应用进行性能分析（Profiling）？

**面试官意图**：考察生产环境性能优化的实战经验。

<details>
<summary>参考答案</summary>

Node.js 提供多种性能分析工具，从轻量到重量依次为：

**1. 内置 V8 Profiler（CPU 分析）**：

```bash
# 启动时收集 CPU Profile
node --prof app.js

# 处理生成的 isolate-*.log 文件
node --prof-process isolate-0x*.log > profile.txt
```

**2. 内置 Inspector（Chrome DevTools）**：

```bash
# 方法一：启动时开启调试
node --inspect app.js
# → 打开 Chrome DevTools → chrome://inspect

# 方法二：运行中发送信号开启（无需重启！）
kill -USR1 <PID>
```

**3. `perf_hooks` 精确计时**：

```javascript
const { performance, PerformanceObserver } = require('perf_hooks');

// 监听性能条目
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
  }
});
obs.observe({ entryTypes: ['measure'] });

// 标记和测量
performance.mark('db-start');
await database.query('SELECT * FROM users');
performance.mark('db-end');
performance.measure('数据库查询', 'db-start', 'db-end');
// 输出: 数据库查询: 12.34ms
```

**4. 事件循环延迟监控（Event Loop Lag）**：

```javascript
const { monitorEventLoopDelay } = require('perf_hooks');

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  console.log({
    min: (h.min / 1e6).toFixed(2) + 'ms',
    max: (h.max / 1e6).toFixed(2) + 'ms',
    mean: (h.mean / 1e6).toFixed(2) + 'ms',
    p99: (h.percentile(99) / 1e6).toFixed(2) + 'ms',
  });
  h.reset();
}, 5000);

// 健康指标: p99 < 50ms
// 告警阈值: p99 > 100ms → 可能有 CPU 密集操作阻塞事件循环
```

**5. Clinic.js（最佳实践工具链）**：

```bash
npm install -g clinic

# CPU 瓶颈分析
clinic doctor -- node app.js

# 事件循环分析（火焰图）
clinic flame -- node app.js

# I/O 瓶颈分析
clinic bubbleprof -- node app.js
```

**6. 生产环境 APM（Application Performance Monitoring）**：

| 工具           | 特点                               |
| -------------- | ---------------------------------- |
| Datadog APM    | 分布式追踪 + 基础设施监控          |
| New Relic      | 自动注入探针，零代码改动           |
| Elastic APM    | 开源，集成 ELK Stack              |
| OpenTelemetry  | 厂商中立标准，推荐用于新项目       |

**追问**：如何在生产环境中不重启服务就做 CPU Profile？

```bash
# 1. 给进程发信号开启 Inspector
kill -USR1 $(pgrep -f "node app.js")

# 2. 使用 Chrome DevTools 远程连接，录制 CPU Profile
# 或者使用 0x 工具:
npx 0x -p <PID>  # 自动生成火焰图
```

</details>

---

### Q29: NestJS 中 Interceptors、Guards、Pipes、Filters 的执行顺序是什么？

**面试官意图**：考察对 NestJS 请求生命周期的完整理解。

<details>
<summary>参考答案</summary>

NestJS 的请求生命周期中，各组件按严格顺序执行：

```
HTTP 请求进入
    │
    ▼
┌───────────────────┐
│  1. Middleware     │  类似 Express 中间件
│     (全局 → 路由)  │
└────────┬──────────┘
         ▼
┌───────────────────┐
│  2. Guards         │  鉴权/授权判断（返回 true/false）
│     (全局→控制器→方法)│
└────────┬──────────┘
         ▼
┌───────────────────┐
│  3. Interceptors   │  前置逻辑（洋葱模型，类似 Koa）
│     (全局→控制器→方法)│  日志、缓存、响应转换
└────────┬──────────┘
         ▼
┌───────────────────┐
│  4. Pipes          │  参数验证和转换
│     (全局→方法参数)  │  class-validator / class-transformer
└────────┬──────────┘
         ▼
┌───────────────────┐
│  5. Controller     │  路由处理方法执行
│     Method Handler │
└────────┬──────────┘
         ▼
┌───────────────────┐
│  6. Interceptors   │  后置逻辑（响应映射、缓存写入）
│     (方法→控制器→全局)│  ← 逆序！
└────────┬──────────┘
         ▼
┌───────────────────┐
│  7. Exception      │  异常捕获和格式化
│     Filters        │  （仅在抛出异常时触发）
│     (方法→控制器→全局)│
└────────┬──────────┘
         ▼
    HTTP 响应返回
```

**各组件代码示例**：

```typescript
// Guard: 检查 JWT Token
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;
    return validateToken(token); // 返回 false → 403 Forbidden
  }
}

// Interceptor: 请求计时 + 响应日志
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    console.log('Before handler...');

    return next.handle().pipe(
      tap(() => {
        console.log(`After handler... ${Date.now() - start}ms`);
      }),
    );
  }
}

// Pipe: 参数验证
@Injectable()
export class ParseIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const val = parseInt(value, 10);
    if (isNaN(val)) throw new BadRequestException('Validation failed');
    return val;
  }
}

// Exception Filter: 统一异常格式
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: exception.message,
    });
  }
}

// 使用装饰器绑定到 Controller
@Controller('users')
@UseGuards(AuthGuard)
@UseInterceptors(LoggingInterceptor)
export class UsersController {
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }
}
```

**追问**：Guards 和 Middleware 的区别？——Middleware 没有 ExecutionContext，不知道接下来要执行哪个 Handler；Guards 可以通过 `ExecutionContext` 获取当前路由元数据（如 `@Roles('admin')`），做细粒度的权限控制。

</details>

---

### Q30: Worker Threads 中如何使用 SharedArrayBuffer 和 Atomics 进行线程安全的数据共享？

**面试官意图**：考察对多线程共享内存和并发原语的理解。

<details>
<summary>参考答案</summary>

**SharedArrayBuffer** 允许多个线程访问同一块内存（零拷贝），**Atomics** 提供原子操作保证线程安全。

```
主线程                    Worker 线程
   │                         │
   │  ┌─── SharedArrayBuffer ───┐
   │  │  [slot0][slot1][slot2]  │
   │  └─────────────────────────┘
   │         ↑                ↑
   │    Atomics.add      Atomics.load
   │   （原子写入）      （原子读取）
```

**实现线程安全计数器**：

```javascript
// main.js
const { Worker } = require('worker_threads');

const sharedBuffer = new SharedArrayBuffer(4); // 4 字节 = 1 个 Int32
const counter = new Int32Array(sharedBuffer);

// 启动 4 个 Worker，每个递增计数器 100 万次
const workers = [];
for (let i = 0; i < 4; i++) {
  const worker = new Worker(`
    const { workerData } = require('worker_threads');
    const counter = new Int32Array(workerData.sharedBuffer);

    for (let i = 0; i < 1_000_000; i++) {
      Atomics.add(counter, 0, 1); // 原子加 1
    }
  `, {
    eval: true,
    workerData: { sharedBuffer }
  });
  workers.push(new Promise(resolve => worker.on('exit', resolve)));
}

await Promise.all(workers);
console.log('最终计数:', Atomics.load(counter, 0));
// 输出: 最终计数: 4000000 ← 精确！无竞态条件
```

**Atomics 常用 API**：

| API                        | 说明                            |
| -------------------------- | ------------------------------- |
| `Atomics.add(arr, idx, v)` | 原子加法，返回旧值             |
| `Atomics.load(arr, idx)`   | 原子读取                       |
| `Atomics.store(arr, idx, v)` | 原子写入                     |
| `Atomics.compareExchange`  | CAS 操作（实现自旋锁的基础）   |
| `Atomics.wait(arr, idx, v)` | 阻塞等待值变化（类似 futex）  |
| `Atomics.notify(arr, idx)` | 唤醒等待的线程                 |

**实现简单的互斥锁（Mutex）**：

```javascript
class Mutex {
  constructor(sharedBuffer, offset = 0) {
    this.lock_state = new Int32Array(sharedBuffer, offset, 1);
  }

  lock() {
    while (true) {
      // CAS: 如果当前值为 0（未锁），设置为 1（已锁）
      if (Atomics.compareExchange(this.lock_state, 0, 0, 1) === 0) {
        return; // 获取锁成功
      }
      // 未获取到锁，阻塞等待
      Atomics.wait(this.lock_state, 0, 1);
    }
  }

  unlock() {
    Atomics.store(this.lock_state, 0, 0);
    Atomics.notify(this.lock_state, 0, 1); // 唤醒一个等待线程
  }
}
```

**追问**：SharedArrayBuffer 的安全问题？——由于 Spectre 攻击，浏览器中默认禁用 SharedArrayBuffer（需要 COOP/COEP 头），但 Node.js 中默认可用因为不存在跨域问题。

</details>

---

### Q31: Koa 洋葱模型（koa-compose）的实现原理是什么？

**面试官意图**：考察对 Koa 核心机制的源码级理解。

<details>
<summary>参考答案</summary>

Koa 的洋葱模型由 `koa-compose` 实现，核心代码只有不到 30 行，但设计精妙。

**简化版实现**：

```javascript
function compose(middlewares) {
  return function (context) {
    let index = -1;

    function dispatch(i) {
      if (i <= index) {
        return Promise.reject(new Error('next() 被多次调用'));
      }
      index = i;

      const fn = middlewares[i];
      if (!fn) return Promise.resolve(); // 所有中间件执行完毕

      try {
        // 关键：next = () => dispatch(i + 1)
        // 当中间件 await next() 时，实际上是 await dispatch(i+1)
        return Promise.resolve(fn(context, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return dispatch(0);
  };
}
```

**执行流程图解**：

```javascript
const middleware1 = async (ctx, next) => {
  console.log('A1');     // ① 进入
  await next();           // → dispatch(1)
  console.log('A2');     // ⑥ 回来
};

const middleware2 = async (ctx, next) => {
  console.log('B1');     // ② 进入
  await next();           // → dispatch(2)
  console.log('B2');     // ⑤ 回来
};

const middleware3 = async (ctx, next) => {
  console.log('C1');     // ③ 进入
  ctx.body = 'Hello';
  console.log('C2');     // ④ 执行完毕
  // 没有调用 next() → dispatch(3) → fn = undefined → resolve
};
```

```
调用栈展开：

dispatch(0) → middleware1 执行
  │  A1
  │  await next() = await dispatch(1)
  │    │
  │    └→ dispatch(1) → middleware2 执行
  │         │  B1
  │         │  await next() = await dispatch(2)
  │         │    │
  │         │    └→ dispatch(2) → middleware3 执行
  │         │         │  C1
  │         │         │  C2
  │         │         └→ Promise.resolve() (没有下一个中间件)
  │         │
  │         │  B2  ← await next() 的 Promise resolved
  │         └→ Promise.resolve()
  │
  │  A2  ← await next() 的 Promise resolved
  └→ Promise.resolve()
```

**关键设计点**：

1. **`index` 守卫**：防止同一中间件调用 `next()` 两次
2. **Promise 包装**：确保同步/异步中间件都能正确处理
3. **自然的错误传播**：任何中间件抛出异常，外层 try/catch 都能捕获

**追问**：为什么 Express 不能像 Koa 那样在 `next()` 之后执行逻辑？——Express 的 `next()` 是同步回调，没有返回 Promise，无法 `await`。当 `next()` 调用下一个中间件时，如果下一个中间件是异步的，Express 无法等待它完成就继续执行后续代码。

</details>

---

### Q32: 什么是 ReDoS 攻击？Node.js 中如何防范？

**面试官意图**：考察对正则表达式安全风险的理解。

<details>
<summary>参考答案</summary>

**ReDoS（Regular Expression Denial of Service）** 是利用正则表达式的**灾难性回溯**使 Node.js 主线程卡死的攻击。

**攻击原理**：

某些正则表达式在特定输入上会导致指数级回溯：

```javascript
// ❌ 有漏洞的正则
const evilRegex = /^(a+)+$/;

// 攻击输入
const input = 'a'.repeat(25) + 'b';

console.time('regex');
evilRegex.test(input);
console.timeEnd('regex');
// → 挂起数秒甚至数分钟！（2^25 次回溯）
```

**为什么会指数回溯？**

```
正则: (a+)+$
输入: aaab

V8 尝试匹配 $ 失败后，需要回溯所有 (a+)+ 的组合：
  (aaa)(b) → 失败
  (aa)(a)(b) → 失败
  (a)(aa)(b) → 失败
  (a)(a)(a)(b) → 失败
  ...

对于 n 个 a，尝试次数 = O(2^n)
```

**常见有漏洞的正则模式**：

```javascript
// ❌ 嵌套量词
/(a+)+/
/(a*)*b/
/(a|a)+/

// ❌ 重叠字符类 + 量词
/(\w+\s*)+/
/([a-zA-Z]+\d*)+/

// 真实案例：邮箱验证
/^([a-zA-Z0-9_.+-]+)+@/  // ← 嵌套量词！
```

**防范措施**：

```javascript
// 1. 使用 re2（Google RE2 引擎，保证线性时间复杂度）
const RE2 = require('re2');
const safeRegex = new RE2('^(a+)+$');
safeRegex.test('a'.repeat(100) + 'b'); // 瞬间完成

// 2. 使用 safe-regex 检测危险正则
const safeRegexCheck = require('safe-regex');
safeRegexCheck(/^(a+)+$/);   // false ← 检测为危险！
safeRegexCheck(/^[a-z]+$/);  // true  ← 安全

// 3. 设置执行超时（Worker Threads 方案）
const { Worker } = require('worker_threads');

function regexWithTimeout(pattern, input, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads');
      const result = new RegExp(workerData.pattern).test(workerData.input);
      parentPort.postMessage(result);
    `, {
      eval: true,
      workerData: { pattern: pattern.source, input }
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('正则执行超时'));
    }, timeoutMs);

    worker.on('message', (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

// 4. CI/CD 中集成 eslint-plugin-regexp 静态扫描
// .eslintrc: { plugins: ['regexp'], rules: { 'regexp/no-super-linear-backtracking': 'error' } }
```

**追问**：Node.js 20+ 有没有内置的 ReDoS 防护？——目前没有，但可以通过 `--experimental-vm-modules` 和 `vm.Script` 设置超时来限制执行时间。社区也在讨论为正则表达式增加超时参数。

</details>

---

### Q33: 事件循环延迟（Event Loop Lag）的原因和监控方案是什么？

**面试官意图**：考察 Node.js 性能瓶颈定位能力。

<details>
<summary>参考答案</summary>

**事件循环延迟**是指事件循环一次迭代的实际时间超过预期的情况，本质是**主线程被阻塞**。

**常见原因**：

| 原因                     | 示例                                | 影响                     |
| ------------------------ | ----------------------------------- | ------------------------ |
| CPU 密集计算             | JSON.parse(巨大字符串)、加密运算    | 所有请求排队等待         |
| 同步 I/O                 | `fs.readFileSync` 读大文件          | 直接阻塞事件循环         |
| 垃圾回收 STW             | 大量临时对象导致频繁 Full GC        | 间歇性延迟突增           |
| 正则回溯                 | ReDoS 攻击或不当正则                | CPU 100% 单核           |
| DNS 查询积压             | 线程池满 + 大量 DNS 请求            | 新连接建立变慢           |
| 大量 nextTick/微任务     | 递归 nextTick                       | I/O 饿死               |

**监控方案一：perf_hooks 直方图（推荐）**：

```javascript
const { monitorEventLoopDelay } = require('perf_hooks');

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

// 每 10 秒上报一次
setInterval(() => {
  const stats = {
    min: ns2ms(histogram.min),
    max: ns2ms(histogram.max),
    mean: ns2ms(histogram.mean),
    stddev: ns2ms(histogram.stddev),
    p50: ns2ms(histogram.percentile(50)),
    p99: ns2ms(histogram.percentile(99)),
    p999: ns2ms(histogram.percentile(99.9)),
  };

  // 上报到 Prometheus / Datadog
  if (stats.p99 > 100) {
    console.warn('⚠️ 事件循环延迟过高:', stats);
  }

  histogram.reset();
}, 10_000);

function ns2ms(ns) { return (ns / 1e6).toFixed(2); }
```

**监控方案二：简单的 setInterval 检测**：

```javascript
let lastCheck = Date.now();

setInterval(() => {
  const now = Date.now();
  const lag = now - lastCheck - 1000; // 期望 1000ms，多出的就是延迟
  lastCheck = now;

  if (lag > 50) {
    console.warn(`事件循环延迟: ${lag}ms`);
  }
}, 1000);
```

**定位阻塞源**：

```bash
# 1. 使用 --prof 找到 CPU 热点函数
node --prof app.js
node --prof-process isolate-*.log | head -50

# 2. 使用 clinic flame 生成火焰图
clinic flame -- node app.js
# → 宽的火焰 = CPU 密集函数

# 3. 使用 blocked-at 定位阻塞位置（开发环境）
const blocked = require('blocked-at');
blocked((time, stack) => {
  console.log(`阻塞 ${time}ms:`, stack);
}, { threshold: 100 }); // 超过 100ms 告警
```

**追问**：如何设置事件循环延迟的告警阈值？

| 场景        | p99 延迟阈值 | 说明                   |
| ----------- | ------------ | ---------------------- |
| API 服务    | < 50ms       | 保证 <100ms 响应时间   |
| WebSocket   | < 20ms       | 保证消息实时性         |
| 后台任务    | < 200ms      | 可容忍稍高延迟         |
| 实时游戏    | < 10ms       | 帧率敏感               |

</details>

---

## 🎯 场景题 (Q34-Q38)

### Q34: 设计一个高吞吐的文件处理管道，使用 Stream 处理 10GB 的 CSV 文件

**面试官意图**：考察对 Stream 背压机制和 pipeline 组合的实战应用能力。

<details>
<summary>参考答案</summary>

**需求**：读取 10GB CSV 文件 → 过滤特定行 → 转换格式 → 写入新文件，全程内存占用 < 100MB。

**架构设计**：

```
ReadStream → CSVParser → FilterTransform → FormatTransform → WriteStream
  (64KB 块)    (逐行解析)   (条件过滤)       (格式转换)       (写入磁盘)
       │          │             │                │               │
       └──────────┴─────────────┴────────────────┴───────────────┘
                        pipeline() 自动背压管理
```

**完整实现**：

```javascript
const { Transform, pipeline } = require('stream');
const { createReadStream, createWriteStream } = require('fs');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

// 1. CSV 行解析器 — Transform Stream
class CSVParser extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true }); // objectMode: 输出对象而非 Buffer
    this.headers = null;
    this.buffer = '';
  }

  _transform(chunk, encoding, callback) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // 保留最后一行（可能不完整）

    for (const line of lines) {
      if (!line.trim()) continue;

      if (!this.headers) {
        this.headers = line.split(',').map(h => h.trim());
        continue;
      }

      const values = line.split(',');
      const record = {};
      this.headers.forEach((h, i) => {
        record[h] = values[i]?.trim();
      });
      this.push(record);
    }
    callback();
  }

  _flush(callback) {
    if (this.buffer.trim() && this.headers) {
      const values = this.buffer.split(',');
      const record = {};
      this.headers.forEach((h, i) => {
        record[h] = values[i]?.trim();
      });
      this.push(record);
    }
    callback();
  }
}

// 2. 过滤器 — 只保留金额 > 1000 的记录
class FilterTransform extends Transform {
  constructor() {
    super({ objectMode: true });
    this.filtered = 0;
    this.passed = 0;
  }

  _transform(record, encoding, callback) {
    if (parseFloat(record.amount) > 1000) {
      this.passed++;
      this.push(record);
    } else {
      this.filtered++;
    }
    callback();
  }

  _flush(callback) {
    console.log(`过滤统计: 通过 ${this.passed}, 过滤 ${this.filtered}`);
    callback();
  }
}

// 3. 格式转换器 — 对象转为 JSON Lines
class JsonLineFormatter extends Transform {
  constructor() {
    super({ objectMode: true, writableObjectMode: true, readableObjectMode: false });
  }

  _transform(record, encoding, callback) {
    callback(null, JSON.stringify(record) + '\n');
  }
}

// 4. 执行管道
async function processLargeCSV(inputPath, outputPath) {
  const startTime = Date.now();
  let processed = 0;

  // 进度监控
  const progressMonitor = new Transform({
    objectMode: true,
    transform(record, enc, cb) {
      processed++;
      if (processed % 100_000 === 0) {
        const mem = process.memoryUsage();
        console.log(
          `已处理 ${(processed / 1e6).toFixed(1)}M 行 | ` +
          `RSS: ${(mem.rss / 1024 / 1024).toFixed(0)}MB | ` +
          `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB`
        );
      }
      cb(null, record);
    }
  });

  await pipelineAsync(
    createReadStream(inputPath, { highWaterMark: 64 * 1024 }), // 64KB 读取缓冲
    new CSVParser(),
    progressMonitor,
    new FilterTransform(),
    new JsonLineFormatter(),
    createWriteStream(outputPath, { highWaterMark: 64 * 1024 })
  );

  console.log(`完成! 耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

processLargeCSV('transactions.csv', 'output.jsonl');
```

**关键设计决策**：

| 决策                    | 原因                                         |
| ----------------------- | -------------------------------------------- |
| `highWaterMark: 64KB`   | 平衡内存和 I/O 效率，避免频繁系统调用        |
| `objectMode: true`      | 流处理结构化数据（对象）而非原始字节          |
| `pipeline()` 而非 `pipe()` | 自动处理背压 + 错误传播 + 资源清理        |
| 保留不完整行            | `_transform` 中缓冲不完整的最后一行          |
| 进度监控                | 作为 Transform Stream 嵌入管道中，不破坏流程  |

**追问**：如果需要并行处理（多核利用），怎么改造？——将文件按字节范围分片，每个分片由一个 Worker Thread 独立处理，最后合并结果。注意 CSV 分片需要对齐到行边界。

</details>

---

### Q35: 如何实现一个生产级 Node.js 服务的优雅停机（Graceful Shutdown）？

**面试官意图**：考察对生产环境运维最佳实践的掌握。

<details>
<summary>参考答案</summary>

**优雅停机的目标**：收到终止信号后，停止接受新请求 → 等待现有请求完成 → 关闭资源 → 退出进程。

**完整实现**：

```javascript
const http = require('http');
const { promisify } = require('util');

class GracefulShutdown {
  constructor(server, options = {}) {
    this.server = server;
    this.timeout = options.timeout || 30_000;  // 最大等待 30s
    this.logger = options.logger || console;
    this.connections = new Set();
    this.isShuttingDown = false;
    this.cleanupHandlers = [];

    this._trackConnections();
    this._registerSignals();
  }

  // 注册清理函数（数据库断开、消息队列关闭等）
  onCleanup(handler) {
    this.cleanupHandlers.push(handler);
    return this;
  }

  _trackConnections() {
    this.server.on('connection', (conn) => {
      this.connections.add(conn);
      conn.on('close', () => this.connections.delete(conn));
    });
  }

  _registerSignals() {
    const shutdown = (signal) => {
      this.logger.info(`收到 ${signal} 信号，开始优雅停机...`);
      this._shutdown(signal);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM')); // K8s/Docker 默认信号
    process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
  }

  async _shutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // 1. 健康检查端点返回 503（让负载均衡器摘除此实例）
    this.server.healthCheck = false;

    // 2. 停止接受新连接
    const closeServer = promisify(this.server.close.bind(this.server));

    // 3. 设置强制退出超时
    const forceExitTimer = setTimeout(() => {
      this.logger.error(`优雅停机超时 (${this.timeout}ms)，强制退出`);

      // 强制断开剩余连接
      for (const conn of this.connections) {
        conn.destroy();
      }

      process.exit(1);
    }, this.timeout);

    // 不让 timer 阻止进程退出
    forceExitTimer.unref();

    try {
      // 4. 等待现有请求完成
      this.logger.info(`等待 ${this.connections.size} 个活跃连接完成...`);

      // 为 keep-alive 连接设置 Connection: close
      this.server.on('request', (req, res) => {
        if (!res.headersSent) {
          res.setHeader('Connection', 'close');
        }
      });

      await closeServer();
      this.logger.info('所有连接已关闭');

      // 5. 执行清理函数（关闭数据库、消息队列等）
      for (const handler of this.cleanupHandlers) {
        await handler();
      }

      this.logger.info('清理完成，正常退出');
      clearTimeout(forceExitTimer);
      process.exit(0);

    } catch (err) {
      this.logger.error('优雅停机出错:', err);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }
}

// 使用示例
const app = require('./app'); // Express/Koa 应用
const server = http.createServer(app);

// 健康检查中间件
app.get('/health', (req, res) => {
  if (server.healthCheck === false) {
    return res.status(503).json({ status: 'shutting_down' });
  }
  res.json({ status: 'ok' });
});

server.listen(3000, () => console.log('服务启动在端口 3000'));

// 初始化优雅停机
const shutdown = new GracefulShutdown(server, { timeout: 30_000 })
  .onCleanup(async () => {
    console.log('关闭数据库连接...');
    await db.disconnect();
  })
  .onCleanup(async () => {
    console.log('关闭 Redis 连接...');
    await redis.quit();
  })
  .onCleanup(async () => {
    console.log('关闭消息队列...');
    await mq.close();
  });
```

**Kubernetes 中的配合**：

```yaml
# Pod 配置
spec:
  terminationGracePeriodSeconds: 60  # K8s 等待 60s
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["sleep", "5"]  # 等 5s 让 Service 更新 Endpoints
```

```
K8s 发送 SIGTERM
     │
     ├─ preStop hook (sleep 5s)  ← 等待 Service 摘除 Pod
     │
     ├─ 应用收到 SIGTERM
     │     ├─ 停止接受新连接
     │     ├─ 健康检查返回 503
     │     ├─ 等待现有请求完成
     │     ├─ 关闭外部资源
     │     └─ process.exit(0)
     │
     └─ 超过 terminationGracePeriodSeconds → SIGKILL 强杀
```

**追问**：PM2 的 graceful reload 和手写的优雅停机有什么区别？——PM2 在 cluster 模式下逐个重启 Worker：先 fork 新 Worker → 新 Worker 就绪后 → 给旧 Worker 发 `SIGINT` → 旧 Worker 优雅退出。零停机滚动重启。

</details>

---

### Q36: 排查一个 Node.js 应用的内存泄漏，从发现到修复的完整流程是什么？

**面试官意图**：考察生产环境故障排查的系统性方法论。

<details>
<summary>参考答案</summary>

**阶段一：发现内存泄漏**

```
内存使用量监控图：

  RSS (MB)
  400 │                                        ╱
  300 │                              ╱─────────
  200 │                    ╱─────────
  100 │     ╱──────────────
    0 │─────
      └──────────────────────────────────────── 时间
      正常应有周期性 GC 回落，持续上升 = 泄漏
```

**监控代码**：

```javascript
// 定期记录内存使用
setInterval(() => {
  const mem = process.memoryUsage();
  metrics.gauge('node.heap.used', mem.heapUsed);
  metrics.gauge('node.rss', mem.rss);
  metrics.gauge('node.external', mem.external);
  metrics.gauge('node.array_buffers', mem.arrayBuffers);

  // 告警：RSS 超过阈值
  if (mem.rss > 500 * 1024 * 1024) { // > 500MB
    console.warn('⚠️ RSS 超过 500MB，可能存在内存泄漏');
  }
}, 30_000);
```

**阶段二：获取堆快照（Heap Snapshot）**

```javascript
// 方法一：v8 模块（推荐，无需额外依赖）
const v8 = require('v8');
const fs = require('fs');

function takeHeapSnapshot() {
  const snapshotStream = v8.writeHeapSnapshot();
  console.log('堆快照已保存:', snapshotStream);
  return snapshotStream;
}

// 方法二：通过 HTTP 端点触发（生产环境用）
app.get('/debug/heapsnapshot', (req, res) => {
  if (req.headers['x-debug-key'] !== process.env.DEBUG_KEY) {
    return res.status(403).end();
  }
  const filename = v8.writeHeapSnapshot();
  res.json({ filename });
});

// 方法三：Inspector 协议远程获取
// kill -USR1 <PID>
// → 连接 Chrome DevTools → Memory → Take Heap Snapshot
```

**阶段三：对比分析（三次快照法）**

```
1. 应用刚启动 → 快照 A（基准线）
2. 运行一段时间（或触发可疑操作 N 次） → 快照 B
3. 再运行一段时间 → 快照 C

Chrome DevTools 中：
  选择快照 C → Comparison 视图 → 与快照 B 对比
  → 查看 "# Delta"（对象数量变化）和 "Size Delta"（内存增长）
  → 按 Size Delta 降序排列 → 找到持续增长的对象类型
```

**阶段四：常见泄漏模式和修复**

```javascript
// 1. ❌ 全局变量/数组无限增长
const cache = [];
app.get('/api', (req, res) => {
  cache.push(req.body); // 永远不清理！
  res.json({ cached: cache.length });
});
// ✅ 修复：使用 LRU Cache
const LRU = require('lru-cache');
const cache = new LRU({ max: 1000 }); // 最多 1000 条

// 2. ❌ EventListener 未移除
class DataProcessor {
  start() {
    // 每次调用 start 都添加新监听器，从不移除
    eventBus.on('data', this.handleData.bind(this));
  }
}
// ✅ 修复：保存引用并在销毁时移除
class DataProcessor {
  start() {
    this._handler = this.handleData.bind(this);
    eventBus.on('data', this._handler);
  }
  destroy() {
    eventBus.off('data', this._handler);
  }
}

// 3. ❌ 闭包引用导致大对象无法释放
function processData() {
  const hugeData = loadHugeDataset(); // 100MB
  return function query(key) {
    return hugeData[key]; // 闭包持有 hugeData 引用
  };
}
// ✅ 修复：只捕获需要的数据
function processData() {
  const hugeData = loadHugeDataset();
  const index = buildIndex(hugeData); // 只保留索引
  // hugeData 可以被 GC
  return function query(key) {
    return index[key];
  };
}

// 4. ❌ Timer 未清理
class WebSocketHandler {
  connect(ws) {
    this.heartbeat = setInterval(() => {
      ws.ping();
    }, 30_000);
  }
  // 忘记在断开时清理 interval！
}
// ✅ 修复
class WebSocketHandler {
  connect(ws) {
    this.heartbeat = setInterval(() => ws.ping(), 30_000);
    ws.on('close', () => clearInterval(this.heartbeat));
  }
}
```

**追问**：如何在不重启服务的情况下快速缓解内存泄漏？——临时方案：`global.gc()` 手动触发 Full GC（需要 `--expose-gc` 启动参数），或通过 PM2 设置 `max_memory_restart: '1G'` 自动重启达到内存阈值的进程。

</details>

---

### Q37: 设计一个基于 Node.js 的实时通知系统，支持百万级在线用户

**面试官意图**：考察系统设计能力，结合 Node.js 特性做架构决策。

<details>
<summary>参考答案</summary>

**架构总览**：

```
                        ┌─────────────────┐
                        │   Nginx / LB    │  WebSocket 负载均衡
                        │   (sticky)      │  (ip_hash / cookie)
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │  Node.js #1  │   │  Node.js #2  │   │  Node.js #3  │
    │  (Cluster ×4)│   │  (Cluster ×4)│   │  (Cluster ×4)│
    │  ~10K ws/进程│   │  ~10K ws/进程│   │  ~10K ws/进程│
    └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
           │                  │                  │
           └──────────────────┼──────────────────┘
                              │ Pub/Sub
                     ┌────────┴────────┐
                     │   Redis Cluster  │  跨实例消息广播
                     │  (Pub/Sub + 在线  │  用户-实例映射
                     │   状态存储)      │
                     └────────┬────────┘
                              │
                     ┌────────┴────────┐
                     │  消息队列        │  消息持久化/削峰
                     │  (Kafka/RabbitMQ)│
                     └────────┬────────┘
                              │
                     ┌────────┴────────┐
                     │  通知服务        │  触发通知的业务服务
                     │  (Producer)      │
                     └─────────────────┘
```

**核心代码实现**：

```javascript
// server.js — 单个 Node.js 实例
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');
const http = require('http');

const server = http.createServer();
const wss = new WebSocketServer({ server, perMessageDeflate: false });

// 用户连接映射：userId → Set<WebSocket>
const userConnections = new Map();

// Redis Pub/Sub — 跨实例广播
const subRedis = new Redis({ host: 'redis-cluster' });
const pubRedis = new Redis({ host: 'redis-cluster' });
const stateRedis = new Redis({ host: 'redis-cluster' });

const INSTANCE_ID = `${process.env.HOSTNAME}:${process.pid}`;

// 处理 WebSocket 连接
wss.on('connection', async (ws, req) => {
  const userId = authenticateFromURL(req); // 从 token 提取 userId
  if (!userId) return ws.close(4001, 'Unauthorized');

  // 注册用户连接
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId).add(ws);

  // Redis 记录用户在哪个实例上
  await stateRedis.sadd(`user:${userId}:instances`, INSTANCE_ID);
  await stateRedis.set(`online:${userId}`, '1', 'EX', 86400);

  // 发送离线期间积攒的未读消息
  const pending = await stateRedis.lrange(`pending:${userId}`, 0, -1);
  for (const msg of pending) {
    ws.send(msg);
  }
  await stateRedis.del(`pending:${userId}`);

  ws.on('close', async () => {
    const conns = userConnections.get(userId);
    conns?.delete(ws);
    if (conns?.size === 0) {
      userConnections.delete(userId);
      await stateRedis.srem(`user:${userId}:instances`, INSTANCE_ID);
    }
  });

  // 心跳保活
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// 心跳检测（每 30s 清理死连接）
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

// 订阅 Redis 频道 — 接收其他实例广播的消息
subRedis.subscribe('notifications');
subRedis.on('message', (channel, message) => {
  const { userId, payload } = JSON.parse(message);
  deliverToLocalUser(userId, payload);
});

// 本地投递
function deliverToLocalUser(userId, payload) {
  const conns = userConnections.get(userId);
  if (!conns) return;

  const data = JSON.stringify(payload);
  for (const ws of conns) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

// 发送通知的 API
async function sendNotification(userId, payload) {
  const isOnline = await stateRedis.get(`online:${userId}`);

  if (isOnline) {
    // 广播到所有实例（用户可能在多个实例上有连接）
    pubRedis.publish('notifications', JSON.stringify({ userId, payload }));
  } else {
    // 离线用户：存入待发送队列
    await stateRedis.rpush(`pending:${userId}`, JSON.stringify(payload));
    await stateRedis.expire(`pending:${userId}`, 7 * 86400); // 7 天过期
  }
}

server.listen(8080);
```

**容量估算**：

| 指标               | 数值                    |
| ------------------ | ----------------------- |
| 单进程 WS 连接数   | ~10,000 (受内存限制)    |
| 单机 Cluster(4进程) | ~40,000                 |
| 25 台机器           | ~1,000,000 连接         |
| 每连接内存开销      | ~10KB (含收发缓冲区)   |
| 单进程内存          | ~100MB                  |

**追问**：如何处理消息送达确认（ACK）和消息去重？——客户端收到消息后发送 ACK，服务端在一定时间内未收到 ACK 则重发。使用消息 ID（UUID）实现幂等性，客户端丢弃已处理过的消息 ID。

</details>

---

### Q38: Node.js 高并发场景下，一个 API 接口突然变慢（p99 从 50ms 飙升到 2s），如何排查？

**面试官意图**：考察生产环境性能问题的系统化排查能力。

<details>
<summary>参考答案</summary>

**排查思路：由外到内、由粗到细**

```
排查路径：

1. 确认范围 → 全部接口慢还是单个接口？
       │
       ├─ 全部接口慢 → 系统资源/事件循环问题
       │       │
       │       ├─ CPU 100%？ → 事件循环阻塞/GC/ReDoS
       │       ├─ 内存飙升？ → 内存泄漏/GC STW
       │       └─ 网络延迟？ → DNS/上游服务问题
       │
       └─ 单个接口慢 → 该接口的依赖问题
               │
               ├─ 数据库慢查询？ → 缺索引/锁争用
               ├─ 外部 API 超时？ → 下游服务异常
               └─ 业务逻辑问题？ → 数据量异常增长
```

**第一步：快速定位——检查事件循环延迟**

```javascript
// 如果已集成监控
// 看 event_loop_lag_p99 指标
// 正常: < 50ms，异常: > 200ms

// 临时检测（生产环境安全）
const { monitorEventLoopDelay } = require('perf_hooks');
const h = monitorEventLoopDelay();
h.enable();
setTimeout(() => {
  console.log('Event Loop p99:', (h.percentile(99) / 1e6).toFixed(2) + 'ms');
}, 10_000);
```

**第二步：CPU Profile（不重启服务）**

```bash
# 方法一：发信号开启 Inspector
kill -USR1 $(pgrep -f "node app.js")
# → Chrome DevTools → Performance → Record 30s → 查看火焰图

# 方法二：使用 0x 生成火焰图
npx 0x -p <PID> --collect-delay 30000
# → 查看哪些函数占用 CPU 时间最多
```

**第三步：检查 GC 影响**

```bash
# 查看 GC 日志
node --trace-gc app.js 2>&1 | grep -E "(Scavenge|Mark-sweep)"

# 正常：Scavenge ~5ms, Mark-sweep ~50ms
# 异常：Mark-sweep > 500ms → 堆太大或对象太多
```

**第四步：分布式追踪定位耗时环节**

```javascript
// 使用 OpenTelemetry 追踪
const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer('api-service');

app.get('/api/orders', async (req, res) => {
  const span = tracer.startSpan('getOrders');

  // 数据库查询
  const dbSpan = tracer.startSpan('db.query', { parent: span });
  const orders = await db.query('SELECT * FROM orders WHERE user_id = ?', [userId]);
  dbSpan.end();

  // 缓存查询
  const cacheSpan = tracer.startSpan('cache.get', { parent: span });
  const enriched = await cache.get(`user:${userId}:profile`);
  cacheSpan.end();

  span.end();
  res.json(orders);
});

// Jaeger/Zipkin 中查看 Trace：
// getOrders (2000ms)
//   ├─ db.query (1800ms) ← 瓶颈在这里！
//   └─ cache.get (2ms)
```

**第五步：常见原因和修复**

| #  | 现象                            | 原因                     | 修复方案                          |
| -- | ------------------------------- | ------------------------ | --------------------------------- |
| 1  | CPU 100% 单核                   | 同步代码阻塞事件循环     | 拆分到 Worker Thread              |
| 2  | 间歇性 STW 200ms+               | Full GC（堆太大）        | 减少对象创建/增加堆/优化数据结构  |
| 3  | 数据库查询突然变慢              | 缺索引/表锁/数据量增长   | 加索引/优化查询/分库分表          |
| 4  | DNS 解析超时                    | UV_THREADPOOL_SIZE 不够  | 增大线程池/使用 dns.resolve       |
| 5  | 外部 API 响应慢                 | 下游服务异常             | 加超时/断路器/降级                |
| 6  | 连接池耗尽                      | 连接泄漏/并发超预期      | 修复泄漏/扩容连接池              |
| 7  | 文件描述符耗尽                  | 打开文件/socket 未关闭   | `ulimit -n` 调大/修复泄漏        |

**追问**：如果 p99 是间歇性突增（不是持续高），最可能的原因是什么？

——最可能是 **GC 导致的 STW（Stop The World）**。Mark-Compact 在堆较大时可能暂停 200ms+。验证方法：`--trace-gc` 查看 GC 暂停时间是否与 p99 突增时间点吻合。解决方案：
1. 减少对象分配频率（对象池复用）
2. 增大 `--max-semi-space-size` 减少 Scavenge 频率
3. 使用 `--max-old-space-size` 控制堆上限
4. 升级到 Node.js 20+（V8 12.x 的 GC 暂停时间显著降低）

</details>

---

## 附录：面试答题策略

**基础题**：展示扎实的概念理解，用类比解释原理，给出代码验证。

**进阶题**：展示对底层机制的理解，能画架构图，知道 why 而非仅知道 what。

**高级题**：展示源码级理解和生产经验，能讨论 trade-off，给出具体数据和指标。

**场景题**：展示系统设计思维，先画架构 → 核心代码 → 容量估算 → 讨论 edge case。
