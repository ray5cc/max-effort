# 02-JavaScript核心与ES6+

> JavaScript 执行机制、事件循环、原型链、ES6+ 核心特性与 TypeScript 类型系统的系统性讲解，覆盖高频面试考点与工程实践。

## 相关链接

- 对应面试题：[JavaScript 面试题](../../02-面试指南/01-前端面试/02-JavaScript面试题.md)
- 所在目录：[前端技术资料](./README.md)
- 技术资料总目录：[01-技术资料](../README.md)

---

## 目录

1. [执行机制](#1-执行机制)
   - 1.1 [执行上下文与调用栈](#11-执行上下文与调用栈)
   - 1.2 [作用域链与闭包](#12-作用域链与闭包)
   - 1.3 [变量提升：var / let / const](#13-变量提升varletconst)
   - 1.4 [this 绑定规则](#14-this-绑定规则)
2. [事件循环（Event Loop）](#2-事件循环event-loop)
   - 2.1 [浏览器事件循环](#21-浏览器事件循环)
   - 2.2 [Node.js 事件循环](#22-nodejs-事件循环)
   - 2.3 [调度 API 对比](#23-调度-api-对比)
   - 2.4 [经典题目解析](#24-经典题目解析)
3. [原型与继承](#3-原型与继承)
   - 3.1 [原型链](#31-原型链)
   - 3.2 [proto vs prototype](#32-__proto__-vs-prototype)
   - 3.3 [ES6 class 与底层原型](#33-es6-class-与底层原型)
   - 3.4 [寄生组合继承 vs extends](#34-寄生组合继承-vs-extends)
4. [ES6+ 核心特性](#4-es6-核心特性)
   - 4.1 [Promise / async-await / Generator](#41-promise--async-await--generator)
   - 4.2 [Proxy / Reflect 元编程](#42-proxy--reflect-元编程)
   - 4.3 [Symbol / Iterator / for...of](#43-symbol--iterator--forof)
   - 4.4 [WeakMap / WeakSet / WeakRef](#44-weakmap--weakset--weakref)
   - 4.5 [模块系统：ESM vs CommonJS](#45-模块系统esm-vs-commonjs)
5. [TypeScript 核心](#5-typescript-核心)
   - 5.1 [类型系统基础](#51-类型系统基础)
   - 5.2 [泛型与约束](#52-泛型与约束)
   - 5.3 [类型推断与类型守卫](#53-类型推断与类型守卫)
   - 5.4 [高级类型](#54-高级类型)
   - 5.5 [内置工具类型实现原理](#55-内置工具类型实现原理)
   - 5.6 [Declaration Merging 与 Module Augmentation](#56-declaration-merging-与-module-augmentation)

---

## 1. 执行机制

### 1.1 执行上下文与调用栈

**执行上下文（Execution Context）** 是 JavaScript 代码执行的环境抽象，每次调用函数或进入全局代码都会创建一个新的执行上下文。

#### 执行上下文的三种类型

| 类型 | 创建时机 | 说明 |
|------|----------|------|
| 全局执行上下文 | 脚本开始执行时 | 整个程序只有一个，`this` 指向全局对象 |
| 函数执行上下文 | 每次函数调用时 | 每次调用都创建新的上下文 |
| Eval 执行上下文 | `eval()` 调用时 | 不推荐使用 |

#### 执行上下文的组成

每个执行上下文包含三个关键组件：

```
ExecutionContext = {
  VariableEnvironment,   // 变量环境（var 声明存储于此）
  LexicalEnvironment,    // 词法环境（let/const/函数存储于此）
  ThisBinding            // this 的值
}
```

#### 调用栈（Call Stack）

调用栈是一个 LIFO（后进先出）的数据结构，用于追踪函数调用的执行顺序。

```javascript
function third() {
  console.log('third'); // 执行时调用栈: [global, first, second, third]
}

function second() {
  third();              // 调用 third，压栈
}

function first() {
  second();             // 调用 second，压栈
}

first();                // 调用 first，压栈

// 调用栈变化过程：
// [] → [global]
// [global] → [global, first]
// [global, first] → [global, first, second]
// [global, first, second] → [global, first, second, third]
// third 执行完出栈 → [global, first, second]
// second 执行完出栈 → [global, first]
// first 执行完出栈 → [global]
```

**栈溢出（Stack Overflow）**：递归调用过深，超过引擎限制（通常约 10,000 层）会抛出 `RangeError: Maximum call stack size exceeded`。

```javascript
// 错误示例：无限递归
function infinite() {
  return infinite(); // RangeError!
}

// 修复：尾递归优化（部分引擎支持）或改用迭代
function factorial(n, acc = 1) {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc); // 尾调用形式
}
```

---

### 1.2 作用域链与闭包

#### 作用域（Scope）

JavaScript 使用**词法作用域**（Lexical Scope），作用域在代码编写时就已确定，而非运行时。

```javascript
const x = 'global';

function outer() {
  const x = 'outer';

  function inner() {
    const x = 'inner';
    console.log(x); // 'inner'：优先查找自身作用域
  }

  function noOwn() {
    console.log(x); // 'outer'：自身没有，向上查找
  }

  inner(); // 'inner'
  noOwn(); // 'outer'
}

outer();
```

#### 作用域链（Scope Chain）

当访问变量时，引擎从当前作用域开始，沿着作用域链向上查找，直到全局作用域。

```
inner 作用域
    ↓ (未找到，向上查找)
outer 作用域
    ↓ (未找到，向上查找)
全局作用域
    ↓ (未找到)
ReferenceError
```

#### 闭包（Closure）深度解析

**闭包**是函数与其词法环境的组合。当一个函数能够访问其定义时所在作用域中的变量，即使该作用域已执行完毕，这种能力就叫做闭包。

```javascript
// 经典闭包示例
function makeCounter(start = 0) {
  let count = start; // count 是私有状态

  return {
    increment() { count++; },
    decrement() { count--; },
    getCount()  { return count; },
  };
}

const counter = makeCounter(10);
counter.increment();
counter.increment();
console.log(counter.getCount()); // 12
// count 对外不可见，但被闭包持有
```

```javascript
// 闭包陷阱：循环中的 var
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// 输出：3, 3, 3（因为 var 是函数作用域，所有回调共享同一个 i）

// 修复方案1：使用 let（块级作用域）
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// 输出：0, 1, 2

// 修复方案2：IIFE 创建独立作用域
for (var i = 0; i < 3; i++) {
  ((j) => setTimeout(() => console.log(j), 0))(i);
}
// 输出：0, 1, 2
```

```javascript
// 闭包的实际应用：函数柯里化
function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) {
      return fn.apply(this, args);
    }
    // 返回新函数，通过闭包保存已有参数
    return function(...moreArgs) {
      return curried.apply(this, args.concat(moreArgs));
    };
  };
}

const add = (a, b, c) => a + b + c;
const curriedAdd = curry(add);
console.log(curriedAdd(1)(2)(3)); // 6
console.log(curriedAdd(1, 2)(3)); // 6
```

**闭包的内存影响**：闭包会持有对外部作用域变量的引用，如果闭包长期存活，这些变量无法被垃圾回收。

```javascript
// 潜在内存泄漏
function createHeavy() {
  const largeData = new Array(1e6).fill('data'); // 大型数据

  return function() {
    // 即使不使用 largeData，闭包仍持有引用
    return 'result';
  };
}

// 修复：手动解除引用
function createHeavyFixed() {
  let largeData = new Array(1e6).fill('data');
  const result = processData(largeData);
  largeData = null; // 显式解除引用，允许 GC 回收

  return function() {
    return result;
  };
}
```

---

### 1.3 变量提升：var/let/const

#### 提升（Hoisting）机制

JavaScript 引擎在代码执行前会先进行"编译"，将变量和函数声明提升到其所在作用域顶部。

```javascript
// var 提升：声明提升，但初始化不提升
console.log(x); // undefined（不是 ReferenceError）
var x = 5;
console.log(x); // 5

// 等价于：
var x;           // 声明提升到顶部
console.log(x);  // undefined
x = 5;           // 赋值留在原处
console.log(x);  // 5
```

```javascript
// 函数声明整体提升（包括函数体）
sayHello(); // 'Hello!'（可以在声明前调用）

function sayHello() {
  console.log('Hello!');
}

// 函数表达式：只提升变量声明
sayWorld(); // TypeError: sayWorld is not a function
var sayWorld = function() {
  console.log('World!');
};
```

#### 暂时性死区（Temporal Dead Zone, TDZ）

`let` 和 `const` 也存在提升，但在声明语句执行之前，变量处于 TDZ（暂时性死区），访问会抛出 `ReferenceError`。

```javascript
// TDZ 示例
{
  // TDZ 开始 ← let x 在此被"预知"存在，但不可访问
  console.log(x); // ReferenceError: Cannot access 'x' before initialization
  let x = 10;     // TDZ 结束，x 初始化为 10
  console.log(x); // 10
}
```

#### var / let / const 完整对比

| 特性 | `var` | `let` | `const` |
|------|-------|-------|---------|
| 作用域 | 函数作用域 | 块级作用域 | 块级作用域 |
| 提升 | 声明提升，初始化为 `undefined` | 提升但 TDZ，不可访问 | 提升但 TDZ，不可访问 |
| 重复声明 | ✅ 允许 | ❌ 报错 | ❌ 报错 |
| 重新赋值 | ✅ 允许 | ✅ 允许 | ❌ 报错（引用不可变）|
| 全局属性 | ✅ 挂载到 `window` | ❌ 不挂载 | ❌ 不挂载 |
| 循环中 | 共享同一变量 | 每次迭代独立绑定 | 每次迭代独立绑定 |

```javascript
// const 对象的可变性
const obj = { name: 'Alice' };
obj.name = 'Bob';      // ✅ 允许（修改属性，不修改引用）
obj = { name: 'Bob' }; // ❌ TypeError（修改引用）

// 冻结对象（深不可变需要递归）
const frozen = Object.freeze({ a: 1, b: { c: 2 } });
frozen.a = 99;      // 静默失败（严格模式下报错）
frozen.b.c = 99;    // ✅ 允许（浅冻结，嵌套对象未冻结）
```

---

### 1.4 this 绑定规则

`this` 的值取决于函数的**调用方式**，而非定义位置（箭头函数除外）。

#### 规则优先级（高 → 低）

```
new 绑定 > 显式绑定(call/apply/bind) > 隐式绑定(对象方法) > 默认绑定
```

#### 1. 默认绑定

```javascript
function show() {
  console.log(this); // 非严格模式：全局对象(window/global)
                     // 严格模式：undefined
}
show();
```

#### 2. 隐式绑定

```javascript
const user = {
  name: 'Alice',
  greet() {
    console.log(`Hello, ${this.name}`); // this → user
  },
};
user.greet(); // 'Hello, Alice'

// 隐式绑定丢失
const fn = user.greet;
fn(); // 'Hello, undefined'（this → global，因为不再通过对象调用）

// 回调中的隐式绑定丢失
setTimeout(user.greet, 0); // 'Hello, undefined'
```

#### 3. 显式绑定：call / apply / bind

```javascript
function introduce(greeting, punct) {
  console.log(`${greeting}, I'm ${this.name}${punct}`);
}

const alice = { name: 'Alice' };

// call：立即调用，参数列表
introduce.call(alice, 'Hi', '!');    // "Hi, I'm Alice!"

// apply：立即调用，参数数组
introduce.apply(alice, ['Hey', '.']); // "Hey, I'm Alice."

// bind：返回新函数，永久绑定 this
const aliceIntro = introduce.bind(alice);
aliceIntro('Hello', '~'); // "Hello, I'm Alice~"

// bind 的偏函数特性
const hiAlice = introduce.bind(alice, 'Hi');
hiAlice('?'); // "Hi, I'm Alice?"
```

#### 4. new 绑定

```javascript
function Person(name) {
  // new 调用时，引擎隐式执行：
  // 1. 创建空对象：const obj = Object.create(Person.prototype)
  // 2. 将 this 绑定到 obj
  this.name = name;
  // 3. 若无显式 return 对象，则隐式 return this
}

const alice = new Person('Alice');
console.log(alice.name); // 'Alice'
console.log(alice instanceof Person); // true
```

#### 5. 箭头函数：词法 this

箭头函数**没有自己的 this**，它捕获定义时外层作用域的 this，且无法被 call/apply/bind 改变。

```javascript
const timer = {
  name: 'Timer',
  start() {
    // 普通函数：this 丢失
    setTimeout(function() {
      console.log(this.name); // undefined（this → global）
    }, 100);

    // 箭头函数：捕获 start 方法的 this（即 timer）
    setTimeout(() => {
      console.log(this.name); // 'Timer' ✅
    }, 100);
  },
};
timer.start();
```

```javascript
// 注意：对象字面量中的箭头函数
const obj = {
  name: 'obj',
  // 箭头函数捕获的是对象字面量外层（全局）的 this
  greet: () => console.log(this.name), // undefined（箭头函数无自己的 this）
  // 应该使用普通函数
  greetOk() { console.log(this.name); }, // 'obj'
};
```

---

## 2. 事件循环（Event Loop）

### 2.1 浏览器事件循环

JavaScript 是单线程语言，事件循环机制使其能够处理异步操作。

#### 核心概念

| 概念 | 说明 | 示例 |
|------|------|------|
| 调用栈（Call Stack） | 同步代码执行 | 函数调用 |
| Web APIs | 浏览器提供的异步 API | setTimeout, fetch, DOM 事件 |
| 宏任务队列（MacroTask Queue） | 待执行的宏任务列表 | setTimeout, setInterval, I/O, UI渲染 |
| 微任务队列（MicroTask Queue） | 待执行的微任务列表 | Promise.then, MutationObserver, queueMicrotask |

#### 浏览器事件循环流程图

```
┌─────────────────────────────────────────────────────┐
│                    JavaScript 引擎                    │
│  ┌──────────────┐        ┌───────────────────────┐  │
│  │  调用栈       │        │  微任务队列             │  │
│  │  Call Stack  │        │  MicroTask Queue       │  │
│  │              │        │  • Promise.then        │  │
│  │  [fn3]       │        │  • queueMicrotask      │  │
│  │  [fn2]       │        │  • MutationObserver    │  │
│  │  [fn1]       │        └───────────────────────┘  │
│  │  [global]    │                                    │
│  └──────┬───────┘                                    │
│         │ 栈空时                                      │
│         ▼                                            │
│  ┌──────────────┐        ┌───────────────────────┐  │
│  │  事件循环     │◄───────│  宏任务队列             │  │
│  │  Event Loop  │        │  MacroTask Queue       │  │
│  └──────────────┘        │  • setTimeout          │  │
│                          │  • setInterval         │  │
└─────────────────────────-│  • I/O 回调            │──┘
                           │  • requestAnimationFrame│
                           └───────────────────────┘

事件循环算法：
1. 从宏任务队列取出一个任务执行
2. 执行完毕后，清空所有微任务队列（直到队列为空）
3. 执行 UI 渲染（如有需要）
4. 回到步骤 1
```

#### 宏任务（MacroTask）vs 微任务（MicroTask）

| 分类 | API | 优先级 |
|------|-----|--------|
| **微任务** | `Promise.then/catch/finally` | 高（当前宏任务结束后立即执行） |
| **微任务** | `MutationObserver` | 高 |
| **微任务** | `queueMicrotask()` | 高 |
| **宏任务** | `setTimeout(fn, 0)` | 低（下一轮事件循环） |
| **宏任务** | `setInterval` | 低 |
| **宏任务** | `MessageChannel` | 低 |
| **宏任务** | `I/O 事件` | 低 |
| **宏任务** | `requestAnimationFrame` | 特殊（渲染前执行）|

---

### 2.2 Node.js 事件循环

Node.js 基于 libuv 实现事件循环，分为 **6 个阶段**，按顺序循环执行。

#### Node.js 事件循环六阶段

```
   ┌─────────────────────────────┐
   │           timers            │  ← 执行 setTimeout/setInterval 到期回调
   └─────────────┬───────────────┘
                 │
   ┌─────────────▼───────────────┐
   │       pending callbacks     │  ← 执行上一轮延迟的 I/O 错误回调
   └─────────────┬───────────────┘
                 │
   ┌─────────────▼───────────────┐
   │        idle, prepare        │  ← 仅内部使用
   └─────────────┬───────────────┘
                 │
   ┌─────────────▼───────────────┐
   │            poll             │  ← 获取新的 I/O 事件（核心阶段）
   │                             │    若队列为空则等待新事件
   └─────────────┬───────────────┘
                 │
   ┌─────────────▼───────────────┐
   │            check            │  ← 执行 setImmediate 回调
   └─────────────┬───────────────┘
                 │
   ┌─────────────▼───────────────┐
   │       close callbacks       │  ← 执行 close 事件回调（如 socket.destroy）
   └─────────────┬───────────────┘
                 │
        （进入下一轮循环）

  ⚠️  每个阶段切换前，都会清空 process.nextTick 队列和 Promise 微任务队列
```

#### 各阶段详解

| 阶段 | 描述 | 相关 API |
|------|------|----------|
| **timers** | 执行 `setTimeout`/`setInterval` 的到期回调 | `setTimeout`, `setInterval` |
| **pending callbacks** | 执行系统操作错误回调（如 TCP 错误） | 内部 |
| **idle, prepare** | 仅 Node.js 内部使用 | 内部 |
| **poll** | 检索 I/O 事件；执行 I/O 回调；如无回调则等待 | `fs.readFile`, 网络 |
| **check** | 执行 `setImmediate` 回调 | `setImmediate` |
| **close callbacks** | 关闭事件回调 | `socket.on('close', ...)` |

```javascript
// Node.js 特有：process.nextTick vs setImmediate
setImmediate(() => console.log('setImmediate'));      // check 阶段
process.nextTick(() => console.log('nextTick'));      // 微任务，阶段切换前

// 输出：nextTick → setImmediate

// process.nextTick 优先级高于 Promise.then
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
// 输出：nextTick → promise
```

---

### 2.3 调度 API 对比

| API | 执行时机 | 浏览器 | Node.js | 用途 |
|-----|----------|--------|---------|------|
| `queueMicrotask(fn)` | 当前任务结束后，下一宏任务前 | ✅ | ✅ v11+ | 精确微任务调度 |
| `requestAnimationFrame(fn)` | 下一次屏幕重绘前 | ✅ | ❌ | 动画、视觉更新 |
| `requestIdleCallback(fn)` | 浏览器空闲时 | ✅ | ❌ | 低优先级后台任务 |
| `setTimeout(fn, 0)` | 最小延迟后（约 4ms） | ✅ | ✅ | 延迟到下一宏任务 |
| `setImmediate(fn)` | I/O 后立即执行 | ❌ | ✅ | Node.js I/O 后调度 |
| `process.nextTick(fn)` | 当前操作完成后，阶段切换前 | ❌ | ✅ | Node.js 高优先级微任务 |

```javascript
// requestIdleCallback 示例：分批处理大型任务
function processBatch(tasks) {
  function doWork(deadline) {
    // deadline.timeRemaining() 返回当前帧剩余时间（ms）
    while (tasks.length > 0 && deadline.timeRemaining() > 1) {
      const task = tasks.shift();
      task(); // 执行任务
    }

    if (tasks.length > 0) {
      // 还有未完成的任务，等下次空闲
      requestIdleCallback(doWork);
    }
  }
  requestIdleCallback(doWork);
}
```

---

### 2.4 经典题目解析

```javascript
// 经典题：输出顺序是什么？
console.log('1');                                    // 同步

setTimeout(() => console.log('2'), 0);               // 宏任务

Promise.resolve()
  .then(() => {
    console.log('3');                                // 微任务1
    setTimeout(() => console.log('4'), 0);           // 宏任务（注册在微任务中）
  })
  .then(() => console.log('5'));                     // 微任务2（上一个then完成后入队）

console.log('6');                                    // 同步

// 解析：
// 同步执行：1, 6
// 清空微任务队列：3（执行过程中注册宏任务4），5
// 执行宏任务2：2
// 执行宏任务4：4
// 最终输出：1, 6, 3, 5, 2, 4
```

```javascript
// 进阶题：async/await 的本质
async function asyncFn() {
  console.log('A');
  await Promise.resolve(); // 相当于 Promise.resolve().then(续后代码)
  console.log('B');        // 这里是微任务
}

console.log('start');
asyncFn();
console.log('end');

// 输出：start → A → end → B
// 解析：
// 1. 'start' 同步输出
// 2. asyncFn() 调用，输出 'A'
// 3. await 挂起 asyncFn，控制权返回调用者
// 4. 'end' 同步输出
// 5. 微任务执行：恢复 asyncFn，输出 'B'
```

---

## 3. 原型与继承

### 3.1 原型链

每个 JavaScript 对象都有一个内部链接指向另一个对象（其原型），形成原型链。

#### 原型链 ASCII 图

```
实例对象 alice
┌─────────────────┐
│  name: 'Alice'  │
│  [[Prototype]] ─┼──→ Person.prototype
└─────────────────┘     ┌─────────────────────┐
                        │  constructor: Person │
                        │  greet: function     │
                        │  [[Prototype]] ─────┼──→ Object.prototype
                        └─────────────────────┘     ┌──────────────────────┐
                                                     │  toString: function   │
                                                     │  hasOwnProperty: fn  │
                                                     │  [[Prototype]] ──────┼──→ null
                                                     └──────────────────────┘

访问 alice.greet：
1. alice 自身 → 没有 greet
2. Person.prototype → 找到 greet ✅

访问 alice.toString：
1. alice 自身 → 没有
2. Person.prototype → 没有
3. Object.prototype → 找到 toString ✅

访问 alice.nonExistent：
1. alice → Person.prototype → Object.prototype → null
2. 返回 undefined
```

---

### 3.2 `__proto__` vs `prototype`

| 属性 | 所在对象 | 说明 |
|------|----------|------|
| `prototype` | 函数对象 | 函数作为构造函数时，实例的原型模板 |
| `__proto__` | 所有对象 | 指向对象的原型（非标准，但广泛支持） |
| `Object.getPrototypeOf(obj)` | — | 标准方式获取对象原型（推荐） |
| `Object.setPrototypeOf(obj, proto)` | — | 标准方式设置对象原型（性能差，慎用）|

```javascript
function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function() {
  console.log(`${this.name} makes a sound.`);
};

const dog = new Animal('Dog');

// 验证原型关系
console.log(dog.__proto__ === Animal.prototype);              // true
console.log(Object.getPrototypeOf(dog) === Animal.prototype); // true（推荐）
console.log(Animal.prototype.constructor === Animal);         // true
console.log(dog instanceof Animal);                           // true

// instanceof 的本质
function myInstanceOf(obj, Constructor) {
  let proto = Object.getPrototypeOf(obj);
  while (proto !== null) {
    if (proto === Constructor.prototype) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
```

---

### 3.3 ES6 class 与底层原型

ES6 的 `class` 是原型继承的**语法糖**，底层仍然使用原型链。

```javascript
class Animal {
  constructor(name) {
    this.name = name;
  }

  // 定义在 Animal.prototype 上
  speak() {
    console.log(`${this.name} makes a sound.`);
  }

  // 静态方法：定义在 Animal 构造函数上
  static create(name) {
    return new Animal(name);
  }
}

class Dog extends Animal {
  constructor(name) {
    super(name); // 必须在使用 this 前调用
    this.type = 'dog';
  }

  speak() {
    console.log(`${this.name} barks.`); // 方法覆盖（override）
  }
}

const dog = new Dog('Rex');
dog.speak(); // 'Rex barks.'

// class 与原型的等价关系
console.log(typeof Animal);                                    // 'function'
console.log(Dog.prototype.__proto__ === Animal.prototype);    // true
console.log(Object.getPrototypeOf(Dog) === Animal);           // true（静态方法继承）
```

#### class 的特性

```javascript
class Person {
  // 公有字段（ES2022）
  greeting = 'Hello';

  // 私有字段（#前缀，真正的私有）
  #age;

  constructor(name, age) {
    this.name = name;
    this.#age = age;
  }

  // getter/setter
  get info() {
    return `${this.name}, ${this.#age}`;
  }

  set age(value) {
    if (value < 0) throw new Error('Age must be positive');
    this.#age = value;
  }

  // 私有方法
  #validate() {
    return this.#age > 0;
  }
}

const p = new Person('Alice', 30);
console.log(p.info);    // 'Alice, 30'
// console.log(p.#age); // SyntaxError：私有字段不可外部访问
```

---

### 3.4 寄生组合继承 vs extends

#### 寄生组合继承（ES5 最优方案）

```javascript
// 父类
function Animal(name) {
  this.name = name;
  this.sounds = []; // 实例属性
}
Animal.prototype.speak = function() {
  console.log(`${this.name}: ${this.sounds.join(', ')}`);
};

// 子类
function Dog(name, breed) {
  Animal.call(this, name); // 1. 借用构造函数（继承实例属性）
  this.breed = breed;
}

// 2. 寄生式原型继承（不调用父类构造函数）
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog; // 修复 constructor 指向

Dog.prototype.bark = function() {
  this.sounds.push('woof');
  this.speak();
};

const dog = new Dog('Rex', 'Labrador');
dog.bark(); // 'Rex: woof'

// 特点：
// ✅ 只调用一次父类构造函数
// ✅ 实例属性正确继承（不共享引用）
// ✅ 原型链完整
```

#### ES6 extends（推荐）

```javascript
class Animal {
  constructor(name) {
    this.name = name;
    this.sounds = [];
  }
  speak() {
    console.log(`${this.name}: ${this.sounds.join(', ')}`);
  }
}

class Dog extends Animal {
  constructor(name, breed) {
    super(name); // 等价于 Animal.call(this, name)
    this.breed = breed;
  }
  bark() {
    this.sounds.push('woof');
    this.speak();
  }
}

// extends 还支持继承内置类
class MyArray extends Array {
  sum() {
    return this.reduce((a, b) => a + b, 0);
  }
}

const arr = new MyArray(1, 2, 3);
console.log(arr.sum()); // 6
console.log(arr instanceof Array); // true
```

---

## 4. ES6+ 核心特性

### 4.1 Promise / async-await / Generator

#### Promise 核心实现

```javascript
// Promise 三种状态
// pending → fulfilled（resolve）
// pending → rejected（reject）
// 状态一旦改变，不可逆

const p = new Promise((resolve, reject) => {
  // 异步操作
  setTimeout(() => resolve('success'), 1000);
});

// 链式调用
p.then(value => {
    console.log(value); // 'success'
    return value.toUpperCase(); // 传递给下一个 then
  })
  .then(upper => console.log(upper)) // 'SUCCESS'
  .catch(err => console.error(err))  // 错误捕获
  .finally(() => console.log('done')); // 无论成功失败都执行

// Promise 组合器
Promise.all([p1, p2, p3])         // 全部成功 or 一个失败
Promise.allSettled([p1, p2, p3])  // 等待全部完成（ES2020）
Promise.race([p1, p2, p3])        // 最快完成（无论成败）
Promise.any([p1, p2, p3])         // 最快成功（ES2021）
```

```javascript
// 手写 Promise.all
function myPromiseAll(promises) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completed = 0;

    if (promises.length === 0) return resolve([]);

    promises.forEach((p, i) => {
      Promise.resolve(p).then(value => {
        results[i] = value;
        if (++completed === promises.length) resolve(results);
      }).catch(reject); // 一个失败立即 reject
    });
  });
}
```

#### async/await 本质

`async/await` 是 Generator + Promise 的语法糖，让异步代码以同步方式书写。

```javascript
// 错误处理方式对比
// 方式1：try/catch（推荐）
async function fetchUser(id) {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const user = await res.json();
    return user;
  } catch (err) {
    console.error('获取用户失败:', err);
    throw err; // 重新抛出让调用者处理
  }
}

// 方式2：辅助函数（避免多层 try/catch）
function to(promise) {
  return promise.then(data => [null, data]).catch(err => [err, null]);
}

async function fetchUserSafe(id) {
  const [err, user] = await to(fetch(`/api/users/${id}`).then(r => r.json()));
  if (err) return handleError(err);
  return user;
}

// 并发 vs 串行
async function serial() {
  const a = await fetchA(); // 等 A 完成
  const b = await fetchB(); // 再等 B 完成（串行，总时间 = A + B）
  return [a, b];
}

async function concurrent() {
  const [a, b] = await Promise.all([fetchA(), fetchB()]); // 并发（总时间 = max(A, B)）
  return [a, b];
}
```

#### Generator 生成器

```javascript
// Generator 基础
function* counter(start = 0) {
  while (true) {
    const reset = yield start++;  // yield 暂停并返回值；next(val) 传入值赋给 reset
    if (reset) start = 0;
  }
}

const gen = counter(10);
console.log(gen.next().value);        // 10
console.log(gen.next().value);        // 11
console.log(gen.next(true).value);    // 0（传入 true，触发重置）
console.log(gen.next().value);        // 1

// Generator 实现异步控制流（async/await 前身）
function* fetchUserGen(id) {
  try {
    const user = yield fetch(`/api/users/${id}`);
    const posts = yield fetch(`/api/posts?userId=${user.id}`);
    return posts;
  } catch (err) {
    console.error(err);
  }
}

// 执行器函数（将 Promise 与 Generator 结合）
function run(genFn) {
  const gen = genFn();
  function step(value) {
    const { value: promise, done } = gen.next(value);
    if (!done) promise.then(step).catch(err => gen.throw(err));
  }
  step();
}
```

---

### 4.2 Proxy / Reflect 元编程

#### Proxy 基础

`Proxy` 允许拦截并自定义对象的基本操作（读取、设置、删除等）。

```javascript
const handler = {
  // 拦截属性读取
  get(target, prop, receiver) {
    console.log(`读取属性: ${prop}`);
    return Reflect.get(target, prop, receiver); // 默认行为
  },

  // 拦截属性设置
  set(target, prop, value, receiver) {
    if (prop === 'age' && typeof value !== 'number') {
      throw new TypeError('age 必须是数字');
    }
    console.log(`设置属性: ${prop} = ${value}`);
    return Reflect.set(target, prop, value, receiver);
  },

  // 拦截 in 操作符
  has(target, prop) {
    console.log(`检查属性: ${prop}`);
    return Reflect.has(target, prop);
  },

  // 拦截 delete 操作符
  deleteProperty(target, prop) {
    if (prop.startsWith('_')) throw new Error(`不允许删除私有属性: ${prop}`);
    return Reflect.deleteProperty(target, prop);
  },
};

const user = new Proxy({ name: 'Alice', age: 30, _id: 'secret' }, handler);
console.log(user.name);    // 读取属性: name → 'Alice'
user.age = 'young';        // TypeError: age 必须是数字
delete user._id;           // Error: 不允许删除私有属性
```

#### 实战：响应式系统（Vue 3 原理简化版）

```javascript
// 依赖追踪
let currentEffect = null;
const targetMap = new WeakMap();

function track(target, prop) {
  if (!currentEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let deps = depsMap.get(prop);
  if (!deps) depsMap.set(prop, (deps = new Set()));
  deps.add(currentEffect);
}

function trigger(target, prop) {
  const deps = targetMap.get(target)?.get(prop);
  deps?.forEach(effect => effect());
}

function reactive(obj) {
  return new Proxy(obj, {
    get(target, prop) {
      track(target, prop);         // 收集依赖
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      const result = Reflect.set(target, prop, value);
      trigger(target, prop);       // 触发更新
      return result;
    },
  });
}

function effect(fn) {
  currentEffect = fn;
  fn(); // 执行一次，触发 get，收集依赖
  currentEffect = null;
}

// 使用
const state = reactive({ count: 0 });
effect(() => console.log('count:', state.count)); // 初始执行：count: 0
state.count = 1;  // 触发更新：count: 1
state.count = 2;  // 触发更新：count: 2
```

---

### 4.3 Symbol / Iterator / for...of

#### Symbol

```javascript
// Symbol 是唯一且不可变的原始值
const s1 = Symbol('desc');
const s2 = Symbol('desc');
console.log(s1 === s2); // false（每次创建都是唯一的）

// 常用内置 Symbol
const iterable = {
  data: [1, 2, 3],
  [Symbol.iterator]() { // 定义迭代器协议
    let index = 0;
    return {
      next: () => index < this.data.length
        ? { value: this.data[index++], done: false }
        : { value: undefined, done: true },
    };
  },
};

for (const item of iterable) {
  console.log(item); // 1, 2, 3
}

// Symbol.toPrimitive：自定义类型转换
class Temperature {
  constructor(celsius) { this.celsius = celsius; }

  [Symbol.toPrimitive](hint) {
    if (hint === 'number') return this.celsius;
    if (hint === 'string') return `${this.celsius}°C`;
    return this.celsius; // 'default'
  }
}

const temp = new Temperature(25);
console.log(+temp);      // 25（number hint）
console.log(`${temp}`);  // '25°C'（string hint）
```

#### 自定义迭代器与生成器

```javascript
// 无限序列生成器
function* fibonacci() {
  let [a, b] = [0, 1];
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

// 取前 8 个斐波那契数
const fib = fibonacci();
const first8 = Array.from({ length: 8 }, () => fib.next().value);
console.log(first8); // [0, 1, 1, 2, 3, 5, 8, 13]

// for...of 与解构
function* range(start, end, step = 1) {
  for (let i = start; i < end; i += step) yield i;
}

const arr = [...range(0, 10, 2)]; // [0, 2, 4, 6, 8]
for (const n of range(1, 4)) console.log(n); // 1, 2, 3
```

---

### 4.4 WeakMap / WeakSet / WeakRef

#### WeakMap / WeakSet：弱引用集合

弱引用不阻止垃圾回收器回收对象。

```javascript
// WeakMap 使用场景：为对象附加私有数据（不影响 GC）
const privateData = new WeakMap();

class Person {
  constructor(name, age) {
    this.name = name;
    privateData.set(this, { age }); // 私有数据存储
  }

  getAge() {
    return privateData.get(this).age; // 通过 WeakMap 访问私有数据
  }
}

const alice = new Person('Alice', 30);
console.log(alice.getAge()); // 30
// alice = null 后，WeakMap 中对应的条目自动被 GC 回收

// WeakMap vs Map
// WeakMap：key 必须是对象；不可枚举；key 弱引用，可被 GC
// Map：key 可以是任意值；可枚举；key 强引用，阻止 GC
```

#### WeakRef / FinalizationRegistry（ES2021）

```javascript
// WeakRef：弱引用（不阻止 GC）
let cache = new WeakRef({ data: 'heavy data' });

// 使用时需检查是否已被 GC 回收
function getCache() {
  const obj = cache.deref(); // 可能返回 undefined（已被 GC）
  if (obj) {
    return obj.data;
  } else {
    // 重新创建
    const newObj = { data: 'heavy data' };
    cache = new WeakRef(newObj);
    return newObj.data;
  }
}

// FinalizationRegistry：对象被 GC 后执行清理回调
const registry = new FinalizationRegistry((heldValue) => {
  console.log(`对象 "${heldValue}" 已被垃圾回收`);
  // 执行清理操作，如关闭数据库连接、清除定时器等
});

let obj = { name: 'temp' };
registry.register(obj, 'my-temp-object'); // 注册清理回调
obj = null; // 允许 GC；GC 发生后触发回调
```

---

### 4.5 模块系统：ESM vs CommonJS

#### 全面对比表

| 特性 | ESM（ES Modules） | CommonJS（CJS） |
|------|------------------|-----------------|
| 语法 | `import/export` | `require/module.exports` |
| 加载时机 | 静态（编译时） | 动态（运行时） |
| 同步/异步 | 异步（可并行加载） | 同步 |
| 树摇（Tree Shaking） | ✅ 支持 | ❌ 不支持 |
| 循环依赖 | 支持（live binding） | 支持（可能得到未完成的 exports）|
| `this` 顶层值 | `undefined` | `module.exports` |
| 文件扩展名 | `.mjs` 或 `"type":"module"` | `.cjs` 或默认 |
| 动态导入 | `import()` 函数 | `require()` |
| 命名空间 | 严格的命名绑定 | 对象属性 |
| 浏览器原生支持 | ✅ | ❌（需打包工具）|

```javascript
// ESM
// 命名导出
export const PI = 3.14159;
export function add(a, b) { return a + b; }
export default class Calculator { /* ... */ } // 默认导出

// 命名导入
import { PI, add } from './math.js';
import Calculator, { PI as pi } from './math.js';
import * as Math from './math.js'; // 命名空间导入

// 动态导入（懒加载）
const { default: calc } = await import('./calculator.js');

// CommonJS
const fs = require('fs');
module.exports = { PI, add };
module.exports = Calculator; // 或者

// 导出单个值
exports.PI = PI;      // 等价于 module.exports.PI = PI
exports.add = add;
```

```javascript
// ESM 的 Live Binding（实时绑定）
// counter.mjs
export let count = 0;
export function increment() { count++; }

// main.mjs
import { count, increment } from './counter.mjs';
console.log(count); // 0
increment();
console.log(count); // 1（ESM：导入的是绑定，值同步更新）

// CommonJS 对比：导入的是值的拷贝
const { count, increment } = require('./counter');
console.log(count); // 0
increment();
console.log(count); // 0（CJS：导入时的快照，不更新）
```

---

## 5. TypeScript 核心

### 5.1 类型系统基础

#### 基础类型

```typescript
// 原始类型
let str: string = 'hello';
let num: number = 42;
let bool: boolean = true;
let n: null = null;
let u: undefined = undefined;
let big: bigint = 100n;
let sym: symbol = Symbol('key');

// 特殊类型
let any: any = '任意类型';     // 关闭类型检查，慎用
let unknown: unknown = '未知'; // 安全版 any，使用前必须类型检查
let never: never;              // 永不发生的值（死循环/总是抛错的函数）
let void_: void;               // 无返回值

// 数组与元组
let arr: number[] = [1, 2, 3];
let arr2: Array<string> = ['a', 'b'];
let tuple: [string, number, boolean] = ['Alice', 30, true]; // 固定长度和类型
```

#### 联合类型与交叉类型

```typescript
// 联合类型（Union）：A 或 B
type StringOrNumber = string | number;
type Status = 'loading' | 'success' | 'error'; // 字面量联合

function format(value: StringOrNumber): string {
  // 需要类型收窄才能使用特定类型的方法
  if (typeof value === 'string') {
    return value.toUpperCase(); // value: string
  }
  return value.toFixed(2);      // value: number
}

// 交叉类型（Intersection）：A 且 B（合并所有属性）
type Employee = { name: string; salary: number };
type Manager = { name: string; reports: Employee[] };
type ManagerEmployee = Employee & Manager;

// 等价于：{ name: string; salary: number; reports: Employee[] }
const boss: ManagerEmployee = {
  name: 'Alice',
  salary: 100000,
  reports: [],
};
```

#### 字面量类型与模板字面量类型

```typescript
// 字面量类型
type Direction = 'north' | 'south' | 'east' | 'west';
type DiceRoll = 1 | 2 | 3 | 4 | 5 | 6;

// 模板字面量类型（TS 4.1+）
type EventName = 'click' | 'focus' | 'blur';
type Handler = `on${Capitalize<EventName>}`; // 'onClick' | 'onFocus' | 'onBlur'

type CSSUnit = 'px' | 'em' | 'rem' | '%';
type CSSValue = `${number}${CSSUnit}`; // '16px' | '1.5em' | ...（类型层面）

// 实用示例
type GetterName<T extends string> = `get${Capitalize<T>}`;
type SetterName<T extends string> = `set${Capitalize<T>}`;
```

---

### 5.2 泛型与约束

#### 泛型基础

```typescript
// 泛型函数：类型参数化
function identity<T>(arg: T): T {
  return arg;
}
identity<string>('hello'); // 显式指定类型
identity(42);              // 类型推断：T = number

// 泛型接口
interface Repository<T> {
  findById(id: string): Promise<T>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}

// 泛型类
class Stack<T> {
  private items: T[] = [];

  push(item: T): void { this.items.push(item); }
  pop(): T | undefined { return this.items.pop(); }
  peek(): T | undefined { return this.items[this.items.length - 1]; }
  isEmpty(): boolean { return this.items.length === 0; }
  size(): number { return this.items.length; }
}

const stack = new Stack<number>();
stack.push(1);
stack.push(2);
console.log(stack.pop()); // 2
```

#### 泛型约束

```typescript
// extends 约束：限制泛型范围
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { name: 'Alice', age: 30 };
getProperty(user, 'name'); // string
getProperty(user, 'age');  // number
// getProperty(user, 'email'); // TS Error：'email' 不在 keyof typeof user 中

// 多个约束
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}

// 条件约束
type NonNullable<T> = T extends null | undefined ? never : T;
type NonNullableString = NonNullable<string | null | undefined>; // string

// 默认类型参数
interface Container<T = string> {
  value: T;
}
const c1: Container = { value: 'default string type' }; // T 默认为 string
const c2: Container<number> = { value: 42 };
```

---

### 5.3 类型推断与类型守卫

#### 类型推断

```typescript
// TypeScript 能自动推断大多数类型
const name = 'Alice';          // string
const age = 30;                // number
const items = [1, 2, 3];       // number[]
const mixed = [1, 'two', true]; // (number | string | boolean)[]

// 函数返回值推断
function add(a: number, b: number) { // 返回值推断为 number
  return a + b;
}

// 上下文类型推断
const handler: (e: MouseEvent) => void = (e) => {
  console.log(e.clientX); // e 被推断为 MouseEvent
};
```

#### 类型守卫

```typescript
// typeof 类型守卫
function processInput(input: string | number | boolean) {
  if (typeof input === 'string') {
    return input.toUpperCase(); // input: string
  } else if (typeof input === 'number') {
    return input.toFixed(2);    // input: number
  }
  return input;                 // input: boolean
}

// instanceof 类型守卫
class Cat { meow() {} }
class Dog { bark() {} }

function makeSound(animal: Cat | Dog) {
  if (animal instanceof Cat) {
    animal.meow(); // animal: Cat
  } else {
    animal.bark(); // animal: Dog
  }
}

// 自定义类型守卫（类型谓词）
interface Fish { swim(): void }
interface Bird { fly(): void }

function isFish(animal: Fish | Bird): animal is Fish {
  return (animal as Fish).swim !== undefined;
}

function move(animal: Fish | Bird) {
  if (isFish(animal)) {
    animal.swim(); // animal: Fish
  } else {
    animal.fly();  // animal: Bird
  }
}

// in 操作符类型守卫
function handleShape(shape: { kind: 'circle', radius: number } | { kind: 'square', side: number }) {
  if ('radius' in shape) {
    return Math.PI * shape.radius ** 2; // Circle
  }
  return shape.side ** 2;              // Square
}

// 可辨识联合（Discriminated Union）
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; side: number }
  | { kind: 'triangle'; base: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':   return Math.PI * shape.radius ** 2;
    case 'square':   return shape.side ** 2;
    case 'triangle': return 0.5 * shape.base * shape.height;
    default:
      // 穷举检查：若添加新 kind 但未处理，这里会报错
      const _exhaustive: never = shape;
      throw new Error(`Unknown shape: ${_exhaustive}`);
  }
}
```

---

### 5.4 高级类型

#### 条件类型

```typescript
// 基本条件类型：T extends U ? X : Y
type IsString<T> = T extends string ? true : false;
type A = IsString<'hello'>; // true
type B = IsString<42>;      // false

// infer：在条件类型中推断类型
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type FR = ReturnType<() => string>; // string

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type Unpacked = UnpackPromise<Promise<number>>; // number

// 分布式条件类型（裸类型参数才会分发）
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArr = ToArray<string | number>; // string[] | number[]

// 非分布式版本（包裹在元组中）
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;
type Together = ToArrayNonDist<string | number>; // (string | number)[]
```

#### 映射类型

```typescript
// 映射类型：遍历类型的属性
type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};

type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

// 键重映射（TS 4.1+）
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface User { name: string; age: number }
type UserGetters = Getters<User>;
// { getName: () => string; getAge: () => number }

// 过滤属性（条件类型 + 映射类型）
type FilterByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};

type StringFields = FilterByType<{ a: string; b: number; c: string }, string>;
// { a: string; c: string }
```

---

### 5.5 内置工具类型实现原理

```typescript
// Partial<T>：所有属性可选
type Partial<T> = { [K in keyof T]?: T[K] };

// Required<T>：所有属性必填（移除可选标记）
type Required<T> = { [K in keyof T]-?: T[K] }; // -? 移除可选

// Readonly<T>：所有属性只读
type Readonly<T> = { readonly [K in keyof T]: T[K] };

// Pick<T, K>：选取指定属性
type Pick<T, K extends keyof T> = { [P in K]: T[P] };

// Omit<T, K>：排除指定属性
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

// Record<K, V>：构造键值类型
type Record<K extends keyof any, V> = { [P in K]: V };

// Exclude<T, U>：从 T 中排除 U（联合类型）
type Exclude<T, U> = T extends U ? never : T;
type E = Exclude<string | number | boolean, number>; // string | boolean

// Extract<T, U>：从 T 中提取 U
type Extract<T, U> = T extends U ? T : never;
type Ex = Extract<string | number | boolean, string | boolean>; // string | boolean

// NonNullable<T>：排除 null 和 undefined
type NonNullable<T> = T extends null | undefined ? never : T;

// ReturnType<T>：获取函数返回类型
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;

// Parameters<T>：获取函数参数类型（元组）
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;

// InstanceType<T>：获取构造函数实例类型
type InstanceType<T extends abstract new (...args: any) => any> =
  T extends abstract new (...args: any) => infer R ? R : any;

// Awaited<T>（TS 4.5+）：递归解包 Promise
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;
type AW = Awaited<Promise<Promise<string>>>; // string

// 使用示例
interface ApiResponse {
  id: number;
  name: string;
  email: string;
  password: string; // 不应暴露
  createdAt: Date;
}

// 创建安全的公开类型
type PublicUser = Omit<ApiResponse, 'password'>;
// 创建更新请求类型（所有字段可选）
type UpdateUser = Partial<Pick<ApiResponse, 'name' | 'email'>>;
// 创建字段配置映射
type FieldConfig = Record<keyof PublicUser, { label: string; editable: boolean }>;
```

---

### 5.6 Declaration Merging 与 Module Augmentation

#### 声明合并（Declaration Merging）

TypeScript 允许多个同名声明合并为一个定义。

```typescript
// 接口合并（最常见）
interface User {
  name: string;
}
interface User {
  age: number;
}
// 合并后：interface User { name: string; age: number }

const user: User = { name: 'Alice', age: 30 }; // 必须包含所有属性

// 命名空间合并
namespace Validation {
  export interface StringValidator {
    isAcceptable(s: string): boolean;
  }
}
namespace Validation {
  export const lettersRegexp = /^[A-Za-z]+$/;
}
// Validation.StringValidator 和 Validation.lettersRegexp 都可用

// 函数与命名空间合并（为函数添加属性）
function buildLabel(name: string): string {
  return buildLabel.prefix + name + buildLabel.suffix;
}
namespace buildLabel {
  export let suffix = '';
  export let prefix = 'Hello, ';
}
console.log(buildLabel('Alice')); // 'Hello, Alice'
```

#### 模块扩展（Module Augmentation）

```typescript
// 扩展第三方库的类型
// types/express.d.ts
import 'express';

declare module 'express' {
  interface Request {
    user?: {
      id: string;
      name: string;
      roles: string[];
    };
    requestId?: string;
  }
}

// 使用时即可访问扩展属性
import { Request, Response } from 'express';

function authMiddleware(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log(req.user.name); // TypeScript 不再报错
}

// 扩展全局类型
declare global {
  interface Window {
    __APP_CONFIG__: {
      apiUrl: string;
      version: string;
    };
  }

  interface Array<T> {
    // 为 Array 添加自定义方法的类型定义
    groupBy<K extends string>(fn: (item: T) => K): Record<K, T[]>;
  }
}

// 使用
window.__APP_CONFIG__.apiUrl; // 有类型提示
[1, 2, 3].groupBy(n => n % 2 === 0 ? 'even' : 'odd');
```

---

## 总结

| 主题 | 核心要点 |
|------|----------|
| **执行上下文** | 调用栈 LIFO，词法作用域，闭包保持引用 |
| **this 绑定** | new > 显式 > 隐式 > 默认；箭头函数词法 this |
| **事件循环** | 宏任务 → 清空所有微任务 → 渲染 → 下一宏任务 |
| **Node.js 事件循环** | 6 阶段，nextTick > Promise 微任务 > setImmediate |
| **原型链** | `__proto__` 链接，`prototype` 是构造函数的模板 |
| **Promise** | 三态不可逆，链式调用，.all/.allSettled/.race/.any |
| **async/await** | Generator + Promise 语法糖，串行/并发注意性能 |
| **Proxy/Reflect** | 拦截 13 种基本操作，响应式系统核心 |
| **ESM vs CJS** | ESM 静态分析支持 Tree Shaking，Live Binding |
| **TypeScript** | 结构化类型系统，强大的类型推断，工具类型 |

---

*← [前端技术资料目录](./README.md) | [JavaScript 面试题 →](../../02-面试指南/01-前端面试/02-JavaScript面试题.md)*
