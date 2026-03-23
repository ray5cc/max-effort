# 02-JavaScript面试题

> JavaScript 核心原理与 ES6+ 高频面试题，涵盖执行机制、事件循环、原型链、异步编程与 TypeScript 类型系统。

## 相关链接

- 对应技术资料：[JavaScript核心与ES6+](../../01-技术资料/01-前端/02-JavaScript核心与ES6+.md)
- 所属分类：[前端面试](./)

---

## 目录

1. [⭐ 基础题](#基础题)
2. [⭐⭐ 进阶题](#进阶题)
3. [⭐⭐⭐ 高阶题](#高阶题)

---

## 🔥 高频考点速记

> 面试中最常被问到的 JavaScript 核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                  | 核心要点（一句话）                                                      | 出题概率 |
| --- | --------------------- | ----------------------------------------------------------------------- | -------- |
| 1   | 闭包                  | 函数 + 词法环境，内层函数引用外层变量，即使外层已执行完毕               | ★★★★★    |
| 2   | 原型链                | `__proto__` 链式查找，prototype 是构造函数模板，Object.prototype 为终点 | ★★★★★    |
| 3   | Event Loop            | 宏任务 → 清空所有微任务 → 渲染 → 下一宏任务；Promise 微任务优先         | ★★★★★    |
| 4   | Promise / async-await | 三态不可逆，链式调用，async 是 Generator+Promise 语法糖                 | ★★★★★    |
| 5   | this 绑定             | new > call/apply/bind > obj.fn > 默认；箭头函数继承外层 this            | ★★★★★    |
| 6   | 作用域与变量提升      | var 函数作用域 + 提升；let/const 块级作用域 + TDZ 暂时性死区            | ★★★★☆    |
| 7   | 深拷贝与浅拷贝        | structuredClone > JSON.parse > 递归；注意循环引用与特殊类型             | ★★★★☆    |
| 8   | ES6+ 核心特性         | 解构/展开/Symbol/Iterator/Proxy/Reflect/WeakMap/ESM                     | ★★★★☆    |
| 9   | 防抖与节流            | debounce 延迟执行（搜索框），throttle 固定频率（滚动）                  | ★★★☆☆    |
| 10  | TypeScript 类型系统   | 结构化类型、泛型约束、条件类型、infer 推断、工具类型                    | ★★★☆☆    |

---

## 基础题

### 1. ⭐ `var`、`let`、`const` 有什么区别？

**参考答案：**

| 特性          | var                           | let                      | const                    |
| ------------- | ----------------------------- | ------------------------ | ------------------------ |
| 作用域        | 函数作用域                    | 块级作用域               | 块级作用域               |
| 变量提升      | ✅ 提升并初始化为 `undefined` | ✅ 提升但不初始化（TDZ） | ✅ 提升但不初始化（TDZ） |
| 重复声明      | ✅ 允许                       | ❌ 报错                  | ❌ 报错                  |
| 重新赋值      | ✅ 允许                       | ✅ 允许                  | ❌ 基本类型不允许        |
| 挂载到 window | ✅                            | ❌                       | ❌                       |

**TDZ（Temporal Dead Zone）示例：**

```js
console.log(a); // undefined（var 提升）
console.log(b); // ReferenceError: Cannot access 'b' before initialization
var a = 1;
let b = 2;
```

**const 注意：** `const` 只保证绑定不变，对象属性仍可修改：

```js
const obj = { x: 1 };
obj.x = 2; // ✅ 合法
obj = {}; // ❌ TypeError
```

**关键知识点：** `let`/`const` 解决了 `var` 的变量提升和函数作用域导致的循环变量共享问题。

---

### 2. ⭐ 什么是闭包？请举例说明实际应用场景。

**参考答案：**

**定义：** 闭包是函数与其词法环境（声明时的作用域）的组合。内层函数可以访问外层函数的变量，即使外层函数已经执行完毕。

```js
function makeCounter(initial = 0) {
  let count = initial; // 被闭包捕获的变量
  return {
    increment: () => ++count,
    decrement: () => --count,
    value: () => count,
  };
}

const counter = makeCounter(10);
counter.increment(); // 11
counter.increment(); // 12
counter.value(); // 12
```

**实际应用场景：**

1. **数据私有化（模块模式）：**

```js
const bank = (() => {
  let balance = 0; // 私有变量，外部无法直接访问
  return {
    deposit: (amount) => (balance += amount),
    withdraw: (amount) => (balance -= amount),
    getBalance: () => balance,
  };
})();
```

2. **函数工厂 / 柯里化：**

```js
const multiply = (factor) => (num) => num * factor;
const double = multiply(2);
double(5); // 10
```

3. **防抖 / 节流：**

```js
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
```

**内存注意：** 闭包持有对外部变量的引用，可能导致内存泄漏，使用完毕后应将引用置 `null`。

---

### 3. ⭐ 解释 JavaScript 的 `this` 绑定规则

**参考答案：**

**四种绑定规则（优先级从高到低）：**

```js
// 1. new 绑定 — this 指向新创建的对象
function Person(name) {
  this.name = name; // this → 新对象
}
const p = new Person("Alice");

// 2. 显式绑定 — call/apply/bind
function greet() {
  return this.name;
}
greet.call({ name: "Bob" }); // 'Bob'
const boundGreet = greet.bind({ name: "Carol" });
boundGreet(); // 'Carol'

// 3. 隐式绑定 — 方法调用，this 指向调用对象
const obj = {
  name: "Dave",
  greet() {
    return this.name;
  },
};
obj.greet(); // 'Dave'

// 4. 默认绑定 — 普通函数调用，严格模式 undefined，非严格模式 window
function hello() {
  return this;
}
hello(); // window（非严格）/ undefined（严格）
```

**箭头函数没有自己的 this：**

```js
const obj = {
  name: "Eve",
  // 箭头函数捕获定义时的 this（此处为 obj 外的 this）
  greet: () => this.name, // undefined 或 window.name
  // 普通方法
  greetNormal() {
    // 箭头函数捕获 greetNormal 执行时的 this（即 obj）
    const inner = () => this.name;
    return inner();
  },
};
obj.greetNormal(); // 'Eve'
```

**隐式绑定丢失（常见坑）：**

```js
const fn = obj.greet; // 赋值给变量，丢失隐式绑定
fn(); // undefined（严格模式）
```

---

### 4. ⭐ 说明 JavaScript 事件循环（Event Loop）的工作机制

**参考答案：**

**执行顺序：同步代码 → 微任务队列 → 宏任务队列（循环）**

```diagram
┌──────────────────────────────────────────────────────┐
│                     Call Stack                        │
└────────────────────────┬─────────────────────────────┘
                         │ 空时检查
          ┌──────────────▼──────────────┐
          │      Microtask Queue         │  ← Promise.then / queueMicrotask
          │  （每个宏任务后清空全部）      │    MutationObserver
          └──────────────┬──────────────┘
                         │ 全部执行完后
          ┌──────────────▼──────────────┐
          │      Macrotask Queue         │  ← setTimeout / setInterval
          │   （每次取出一个执行）         │    I/O / MessageChannel
          └─────────────────────────────┘
```

**经典题目：**

```js
console.log("1");

setTimeout(() => console.log("2"), 0);

Promise.resolve()
  .then(() => console.log("3"))
  .then(() => console.log("4"));

console.log("5");

// 输出顺序：1 → 5 → 3 → 4 → 2
```

**解析：**

1. 同步执行：打印 `1`、`5`
2. Call Stack 空 → 清空微任务队列：打印 `3`（then 注册 `4`）→ 打印 `4`
3. 取出一个宏任务（setTimeout callback）：打印 `2`

**async/await 本质是 Promise 语法糖：**

```js
async function foo() {
  console.log("A");
  await Promise.resolve();
  console.log("B"); // 等同于 Promise.resolve().then(() => console.log('B'))
}
foo();
console.log("C");
// 输出：A → C → B
```

---

### 5. ⭐ `==` 和 `===` 的区别是什么？

**参考答案：**

- `===`（严格相等）：类型和值都必须相同，不进行类型转换
- `==`（抽象相等）：类型不同时先进行类型转换再比较

**`==` 类型转换规则（简化）：**

```js
null == undefined  // true（特殊规则）
null == 0          // false
undefined == 0     // false

// 对象 vs 原始值：调用 valueOf() / toString()
[] == 0            // true（[] → '' → 0）
[] == false        // true（[] → '' → 0，false → 0）
{} == '[object Object]' // true

// NaN 特殊：与任何值都不等，包括自身
NaN === NaN        // false
Number.isNaN(NaN)  // true（推荐用法）
```

**最佳实践：** 始终使用 `===`，避免隐式类型转换导致的 bug。

---

### 6. ⭐ 什么是原型链（Prototype Chain）？

**参考答案：**

每个 JavaScript 对象都有一个内部链接 `[[Prototype]]`（可通过 `__proto__` 访问），指向另一个对象（原型）。当访问对象属性时，引擎沿原型链逐级向上查找，直到找到属性或到达 `null`。

```
obj.__proto__ === Object.prototype
Object.prototype.__proto__ === null

// 函数的原型链
function Foo() {}
const f = new Foo();

f.__proto__ === Foo.prototype               // true
Foo.prototype.__proto__ === Object.prototype // true
Foo.__proto__ === Function.prototype         // true（函数也是对象）
```

**`prototype` vs `__proto__`：**
| 属性 | 存在于 | 指向 |
|------|--------|------|
| `prototype` | 函数对象 | 该函数创建的实例的原型 |
| `__proto__` | 所有对象 | 该对象的原型（即构造函数的 `prototype`） |

**属性查找：**

```js
function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function () {
  return `${this.name} speaks`;
};

const dog = new Animal("Rex");
dog.speak(); // 'Rex speaks'（在 Animal.prototype 上找到）
dog.toString(); // '[object Object]'（在 Object.prototype 上找到）
```

---

### 7. ⭐ Promise 的三种状态和基本用法

**参考答案：**

**三种状态：** `pending` → `fulfilled` 或 `rejected`（状态不可逆）

```js
// 创建 Promise
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve("done"), 1000);
});

// 消费 Promise
p.then((value) => console.log(value)) // 'done'
  .catch((err) => console.error(err))
  .finally(() => console.log("clean up"));

// Promise 静态方法
Promise.all([p1, p2, p3]); // 全部成功才 resolve，一个失败立即 reject
Promise.allSettled([p1, p2]); // 等全部完成，返回状态数组（不会 reject）
Promise.race([p1, p2]); // 第一个完成（无论成功失败）
Promise.any([p1, p2]); // 第一个成功，全部失败才 reject（AggregateError）
```

**async/await：**

```js
async function fetchUser(id) {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed:", err);
    throw err; // 重新抛出让调用者处理
  }
}
```

---

### 8. ⭐ ES6 模块（ESM）与 CommonJS 的区别

**参考答案：**

| 特性         | ESM                    | CommonJS                 |
| ------------ | ---------------------- | ------------------------ |
| 语法         | `import/export`        | `require/module.exports` |
| 加载时机     | 静态（编译时确定依赖） | 动态（运行时执行）       |
| 执行         | 异步加载（浏览器中）   | 同步加载                 |
| this（顶层） | `undefined`            | `module.exports` 对象    |
| 循环依赖     | 支持（live binding）   | 可能得到未初始化值       |
| Tree Shaking | ✅ 支持（静态分析）    | ❌ 不支持                |
| 严格模式     | 默认开启               | 需手动声明               |

**ESM 的 live binding：**

```js
// counter.mjs
export let count = 0;
export const increment = () => count++;

// main.mjs
import { count, increment } from "./counter.mjs";
console.log(count); // 0
increment();
console.log(count); // 1（live binding，反映最新值）
```

**CJS 得到的是值的拷贝，ESM 得到的是值的实时绑定。**

---

## 进阶题

### 9. ⭐⭐ 手写 `Promise.all` 实现

**参考答案：**

```js
function promiseAll(promises) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(promises)) {
      return reject(new TypeError("promises must be an array"));
    }

    const results = [];
    let remaining = promises.length;

    if (remaining === 0) return resolve(results);

    promises.forEach((promise, index) => {
      // 用 Promise.resolve 包装，支持非 Promise 值
      Promise.resolve(promise).then(
        (value) => {
          results[index] = value;
          if (--remaining === 0) resolve(results);
        },
        (reason) => reject(reason), // 任意一个 reject 立即 reject
      );
    });
  });
}

// 测试
promiseAll([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]).then(
  console.log,
); // [1, 2, 3]
```

**关键点：** 用 `remaining` 计数器而非 `index === length - 1` 判断完成，因为异步操作完成顺序不确定。

---

### 10. ⭐⭐ 深拷贝的实现及边界情况处理

**参考答案：**

```js
function deepClone(value, seen = new WeakMap()) {
  // 基本类型直接返回
  if (value === null || typeof value !== "object") return value;

  // 处理循环引用
  if (seen.has(value)) return seen.get(value);

  // 处理特殊类型
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);
    value.forEach((v, k) => clone.set(deepClone(k, seen), deepClone(v, seen)));
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);
    value.forEach((v) => clone.add(deepClone(v, seen)));
    return clone;
  }

  // 处理数组和普通对象
  const clone = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone); // 先存入，再递归（处理循环引用）

  for (const key of [
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value),
  ]) {
    clone[key] = deepClone(value[key], seen);
  }

  return clone;
}
```

**各方案对比：**
| 方案 | 循环引用 | 特殊类型 | 性能 |
|------|---------|---------|------|
| `JSON.parse(JSON.stringify())` | ❌ 报错 | ❌ 丢失 Function/undefined/Date | 最快 |
| `structuredClone()` | ✅ | ✅ 大部分 | 较快 |
| 手写递归 | ✅（WeakMap） | ✅ 可完全控制 | 较慢 |
| lodash `_.cloneDeep` | ✅ | ✅ | 中等 |

---

### 11. ⭐⭐ 解释 Node.js 事件循环的六个阶段

**参考答案：**

```diagram
   ┌───────────────────────────┐
┌─►│           timers          │ ← setTimeout / setInterval 回调
│  └─────────────┬─────────────┘
│  ┌─────────────▼─────────────┐
│  │     pending callbacks     │ ← 上一轮 I/O 的错误回调
│  └─────────────┬─────────────┘
│  ┌─────────────▼─────────────┐
│  │       idle, prepare       │ ← 内部使用
│  └─────────────┬─────────────┘
│  ┌─────────────▼─────────────┐
│  │           poll            │ ← 获取新的 I/O 事件（阻塞等待）
│  └─────────────┬─────────────┘
│  ┌─────────────▼─────────────┐
│  │           check           │ ← setImmediate 回调
│  └─────────────┬─────────────┘
│  ┌─────────────▼─────────────┐
└──│      close callbacks      │ ← socket.on('close', ...)
   └───────────────────────────┘

每个阶段之间都会清空微任务队列（process.nextTick 优先于 Promise）
```

**关键：**

- `process.nextTick` 在当前操作完成后、进入下一阶段前执行（高于 Promise 微任务）
- `setImmediate` 在 check 阶段执行，`setTimeout(fn, 0)` 在 timers 阶段执行

**经典题目：**

```js
setImmediate(() => console.log("setImmediate"));
setTimeout(() => console.log("setTimeout"), 0);
process.nextTick(() => console.log("nextTick"));
Promise.resolve().then(() => console.log("promise"));

// 输出：nextTick → promise → setTimeout/setImmediate（顺序不确定）
```

---

### 12. ⭐⭐ 实现一个 `curry`（柯里化）函数

**参考答案：**

```js
function curry(fn) {
  return function curried(...args) {
    // 如果参数够了，直接调用
    if (args.length >= fn.length) {
      return fn.apply(this, args);
    }
    // 参数不够，返回新函数等待更多参数
    return function (...moreArgs) {
      return curried.apply(this, args.concat(moreArgs));
    };
  };
}

// 使用
const add = curry((a, b, c) => a + b + c);
add(1)(2)(3); // 6
add(1, 2)(3); // 6
add(1)(2, 3); // 6
add(1, 2, 3); // 6

// 实际应用：创建可复用的函数
const multiply = curry((factor, num) => num * factor);
const double = multiply(2);
const triple = multiply(3);
[1, 2, 3].map(double); // [2, 4, 6]
[1, 2, 3].map(triple); // [3, 6, 9]
```

---

### 13. ⭐⭐ Proxy 和 Reflect 的用途，Vue 3 响应式原理

**参考答案：**

```js
// Proxy 拦截对象操作
const handler = {
  get(target, key, receiver) {
    console.log(`Reading ${key}`);
    return Reflect.get(target, key, receiver); // 转发给原始对象
  },
  set(target, key, value, receiver) {
    console.log(`Setting ${key} = ${value}`);
    return Reflect.set(target, key, value, receiver);
  },
};
const proxy = new Proxy({}, handler);
proxy.x = 1; // Setting x = 1
proxy.x; // Reading x
```

**Vue 3 响应式简化实现：**

```js
const targetMap = new WeakMap(); // 存储依赖关系
let activeEffect = null; // 当前正在执行的 effect

function track(target, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let deps = depsMap.get(key);
  if (!deps) depsMap.set(key, (deps = new Set()));
  deps.add(activeEffect); // 收集依赖
}

function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  depsMap.get(key)?.forEach((effect) => effect()); // 触发更新
}

function reactive(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      track(target, key);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      const result = Reflect.set(target, key, value, receiver);
      trigger(target, key);
      return result;
    },
  });
}
```

**为什么用 Reflect：** 保持 `receiver`（通常是 Proxy 本身）正确传递，处理 getter/setter 中的 `this` 指向。

---

### 14. ⭐⭐ Generator 函数与异步迭代的工作原理

**参考答案：**

```js
// Generator 是可以暂停/恢复执行的函数
function* range(start, end) {
  for (let i = start; i <= end; i++) {
    yield i; // 暂停，返回值
  }
}

const gen = range(1, 3);
gen.next(); // { value: 1, done: false }
gen.next(); // { value: 2, done: false }
gen.next(); // { value: 3, done: false }
gen.next(); // { value: undefined, done: true }

// Generator 实现异步流程控制（async/await 的底层原理）
function* asyncFlow() {
  const user = yield fetch("/api/user"); // 暂停，等待 Promise
  const posts = yield fetch(`/api/posts/${user.id}`);
  return posts;
}

// 执行器（类似 co 库）
function run(gen) {
  const iterator = gen();
  function step(value) {
    const { value: promise, done } = iterator.next(value);
    if (done) return Promise.resolve(promise);
    return Promise.resolve(promise).then(step);
  }
  return step();
}
```

**async/await 本质：** 语言内置的 Generator 执行器，`await` 对应 `yield`，自动处理 Promise 链。

---

### 15. ⭐⭐ WeakMap/WeakSet 与 Map/Set 的区别及使用场景

**参考答案：**

| 特性      | Map/Set         | WeakMap/WeakSet               |
| --------- | --------------- | ----------------------------- |
| 键类型    | 任意值          | 仅对象（WeakRef 支持 Symbol） |
| 垃圾回收  | 强引用，阻止 GC | 弱引用，不阻止 GC             |
| 可迭代    | ✅              | ❌                            |
| size 属性 | ✅              | ❌                            |

**WeakMap 典型使用场景：**

1. **存储 DOM 节点关联数据（节点删除后自动 GC）：**

```js
const domData = new WeakMap();
const button = document.querySelector("button");
domData.set(button, { clickCount: 0 });
// button 移除后，domData 中的数据自动被 GC，不会内存泄漏
```

2. **私有数据（类的私有字段替代方案）：**

```js
const _private = new WeakMap();
class Person {
  constructor(name, age) {
    _private.set(this, { age }); // age 对外不可见
    this.name = name;
  }
  getAge() {
    return _private.get(this).age;
  }
}
```

3. **缓存计算结果（对象作为 key）：**

```js
const cache = new WeakMap();
function processData(obj) {
  if (cache.has(obj)) return cache.get(obj);
  const result = expensiveCompute(obj);
  cache.set(obj, result);
  return result;
}
```

---

### 16. ⭐⭐ 实现 `debounce`（防抖）和 `throttle`（节流）

**参考答案：**

```js
// 防抖：连续触发只执行最后一次（等稳定后执行）
function debounce(fn, delay, immediate = false) {
  let timer = null;
  return function (...args) {
    const callNow = immediate && !timer;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!immediate) fn.apply(this, args);
    }, delay);
    if (callNow) fn.apply(this, args);
  };
}

// 节流：固定时间内只执行一次（均匀执行）
function throttle(fn, interval) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}

// 使用场景
window.addEventListener("resize", debounce(handleResize, 300)); // 防抖：窗口 resize 完毕后处理
window.addEventListener("scroll", throttle(handleScroll, 100)); // 节流：滚动时每 100ms 处理一次
```

---

### 17. ⭐⭐ TypeScript 的泛型约束如何使用？

**参考答案：**

```ts
// 基础泛型
function identity<T>(arg: T): T {
  return arg;
}

// extends 约束
function getLength<T extends { length: number }>(arg: T): number {
  return arg.length; // 有了约束才能访问 .length
}
getLength("hello"); // 5
getLength([1, 2]); // 2

// keyof 约束（常用于属性访问）
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const user = { name: "Alice", age: 30 };
getProperty(user, "name"); // string 类型
getProperty(user, "age"); // number 类型
// getProperty(user, 'email'); // ❌ 编译错误

// 泛型工厂函数
function createInstance<T>(ctor: new (...args: unknown[]) => T): T {
  return new ctor();
}

// 条件类型约束
type NonNullable<T> = T extends null | undefined ? never : T;
type StringOnly<T> = T extends string ? T : never;
```

---

## 高阶题

### 18. ⭐⭐⭐ 详细解释 JavaScript 执行上下文的创建过程

**参考答案：**

每次调用函数时，JS 引擎创建一个**执行上下文（Execution Context）**，包含：

**创建阶段（编译阶段）：**

```
ExecutionContext = {
  VariableEnvironment: {     // 处理 var 声明和函数声明
    var x = undefined,       // var 提升，初始化为 undefined
    function foo = <fn ref>  // 函数声明提升，直接赋值
  },
  LexicalEnvironment: {      // 处理 let/const/class/外部引用
    let y = <uninitialized>, // TDZ：已绑定但未初始化
    const z = <uninitialized>,
    outer: <parent env ref>  // 作用域链（词法环境链）
  },
  ThisBinding: <determined by call site>
}
```

**执行阶段：**

1. 按顺序执行代码
2. 遇到 `let y = 1` → 初始化（TDZ 结束）
3. 遇到函数调用 → 创建新的执行上下文，压栈

**作用域链形成：**

```js
function outer() {
  const x = 10;
  function inner() {
    const y = 20;
    console.log(x + y); // 通过作用域链访问 outer 的 x
    // inner.[[Environment]] → outer 的词法环境 → global
  }
  inner();
}
```

---

### 19. ⭐⭐⭐ 解释 JavaScript 内存管理与垃圾回收机制

**参考答案：**

**V8 引擎内存结构：**

```diagram
V8 堆内存
├── New Space（新生代，1-8MB）
│   ├── From Space（当前使用）
│   └── To Space（GC 时复制到此）
└── Old Space（老生代，数百 MB~GB）
    ├── Old Pointer Space（含指针的对象）
    ├── Old Data Space（字符串/数字等纯数据）
    ├── Code Space（JIT 编译的代码）
    └── Large Object Space（超过 512KB 的对象）
```

**新生代 GC（Scavenge / Minor GC）：**

```
From Space 满时触发：
1. 遍历 From Space 中存活的对象（根可达）
2. 复制到 To Space（自动整理内存碎片）
3. 交换 From/To Space
4. 经历两次 Minor GC 仍存活 → 晋升到老生代
```

**老生代 GC（Mark-Sweep-Compact / Major GC）：**

```
1. Mark（标记）：从 GC Roots 开始，标记所有可达对象
2. Sweep（清除）：清除未标记的死对象，释放内存
3. Compact（整理）：移动存活对象消除碎片（非每次执行）
```

**常见内存泄漏场景：**

```js
// 1. 意外的全局变量
function leak() {
  forgotten = "I am global"; // 没有 var/let/const
}

// 2. 被遗忘的定时器
const timer = setInterval(() => {
  // 持有外部对象引用
  processData(hugeData);
}, 1000);
// 需要 clearInterval(timer) 否则 hugeData 永不 GC

// 3. 闭包持有大对象
function outer() {
  const bigArray = new Array(1e6).fill(0);
  return function inner() {
    return bigArray[0]; // 整个 bigArray 被闭包持有
  };
}

// 4. DOM 引用未清理
const map = new Map();
const el = document.getElementById("btn");
map.set(el, "data");
document.body.removeChild(el); // DOM 已移除，但 Map 仍持有引用
// 应使用 WeakMap 代替
```

---

### 20. ⭐⭐⭐ TypeScript 的条件类型和 `infer` 关键字

**参考答案：**

```ts
// 基础条件类型：T extends U ? X : Y
type IsString<T> = T extends string ? true : false;
type A = IsString<"hello">; // true
type B = IsString<42>; // false

// infer：在条件类型的 extends 子句中推断类型
// 提取函数返回值类型（内置 ReturnType 的实现原理）
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type Fn = () => { name: string };
type Result = MyReturnType<Fn>; // { name: string }

// 提取 Promise 中的类型
type Awaited<T> = T extends Promise<infer R> ? Awaited<R> : T;
type P = Awaited<Promise<Promise<string>>>; // string

// 提取数组元素类型
type ElementType<T> = T extends (infer E)[] ? E : never;
type Elem = ElementType<number[]>; // number

// 提取构造函数参数类型（内置 ConstructorParameters）
type CtorParams<T> = T extends new (...args: infer P) => any ? P : never;

// 分布式条件类型（union 自动分发）
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArr = ToArray<string | number>; // string[] | number[]
// 注意：ToArray<string | number> 分发为 ToArray<string> | ToArray<number>

// 阻止分布：用 [] 包裹
type NoDistribute<T> = [T] extends [any] ? T[] : never;
type Together = NoDistribute<string | number>; // (string | number)[]
```

---

### 21. ⭐⭐⭐ 实现一个简化版的 `EventEmitter`（发布订阅模式）

**参考答案：**

```js
class EventEmitter {
  constructor() {
    this._events = new Map(); // eventName → Set<listener>
  }

  on(event, listener) {
    if (!this._events.has(event)) {
      this._events.set(event, new Set());
    }
    this._events.get(event).add(listener);
    return this; // 支持链式调用
  }

  once(event, listener) {
    const wrapper = (...args) => {
      listener(...args);
      this.off(event, wrapper); // 执行一次后自动移除
    };
    wrapper._original = listener; // 保存原始引用以便 off 时找到
    return this.on(event, wrapper);
  }

  off(event, listener) {
    const listeners = this._events.get(event);
    if (!listeners) return this;
    // 支持 once 包装的监听器
    for (const fn of listeners) {
      if (fn === listener || fn._original === listener) {
        listeners.delete(fn);
        break;
      }
    }
    if (listeners.size === 0) this._events.delete(event);
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events.get(event);
    if (!listeners) return false;
    // 复制 Set 避免在 emit 中 off 导致迭代问题
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  removeAllListeners(event) {
    if (event) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }
}

// 测试
const emitter = new EventEmitter();
emitter
  .on("data", (x) => console.log("Listener 1:", x))
  .once("data", (x) => console.log("Once:", x));

emitter.emit("data", 42); // Listener 1: 42  |  Once: 42
emitter.emit("data", 43); // Listener 1: 43  （once 已移除）
```

---

### 22. ⭐⭐⭐ 解释 JavaScript 的模块系统循环依赖问题

**参考答案：**

**CommonJS 循环依赖（得到未完成的导出）：**

```js
// a.js
const b = require("./b");
console.log("a gets b.value:", b.value); // undefined ← b 尚未执行完
module.exports = { value: "A" };

// b.js
const a = require("./a");
console.log("b gets a.value:", a.value); // 'A' ← a 已缓存（部分）
module.exports = { value: "B" };

// main.js
require("./a");
// 输出：b gets a.value: A → a gets b.value: undefined
```

**ESM 循环依赖（live binding，但需注意初始化顺序）：**

```js
// a.mjs
import { b } from "./b.mjs";
export const a = "A";
console.log("a sees b:", b); // 取决于执行顺序

// b.mjs
import { a } from "./a.mjs";
export const b = "B";
console.log("b sees a:", a); // 取决于执行顺序
```

**ESM 的解决方案：函数引用（惰性求值）：**

```js
// a.mjs
import { getB } from "./b.mjs";
export const a = "A";
export function getA() {
  return a;
} // 函数在调用时才访问 b

// b.mjs
import { getA } from "./a.mjs";
export const b = "B";
export function getB() {
  return b;
}
// 使用 getA() 而非直接访问 a，避免初始化顺序问题
```

**最佳实践：** 提取公共依赖到第三个模块，避免循环导入；或使用函数/工厂模式延迟访问。

---

### 23. ⭐⭐⭐ 手写实现 `async/await`（基于 Generator + Promise）

**参考答案：**

```js
// async/await 的脱糖本质：Generator + 自动执行器
function asyncToGenerator(generatorFn) {
  return function (...args) {
    const gen = generatorFn.apply(this, args);

    return new Promise((resolve, reject) => {
      function step(key, value) {
        let result;
        try {
          result = gen[key](value); // gen.next(value) 或 gen.throw(value)
        } catch (e) {
          return reject(e);
        }

        const { value: promise, done } = result;

        if (done) {
          return resolve(promise); // Generator 执行完毕
        }

        // 等待 yield 的 Promise，然后继续
        Promise.resolve(promise).then(
          (val) => step("next", val), // 成功 → 传入值继续
          (err) => step("throw", err), // 失败 → 抛入错误
        );
      }

      step("next", undefined); // 启动执行
    });
  };
}

// 等价于 async function fetchData() { ... }
const fetchData = asyncToGenerator(function* () {
  const user = yield fetch("/api/user").then((r) => r.json());
  const posts = yield fetch(`/api/posts/${user.id}`).then((r) => r.json());
  return posts;
});

fetchData().then(console.log).catch(console.error);
```

**错误处理对应关系：**

```js
// async/await
async function fn() {
  try {
    const result = await riskyOp();
  } catch (e) {
    // 处理错误
  }
}

// Generator 等价
function* fn() {
  try {
    const result = yield riskyOp();
  } catch (e) {
    // gen.throw(e) 被捕获
  }
}
```

---

### 24. ⭐⭐⭐ V8 的 JIT 编译优化与反优化（Deoptimization）

**参考答案：**

**V8 编译流水线：**

```
源代码
  ↓ 解析
  AST（抽象语法树）
  ↓ Ignition 解释器
  字节码（Bytecode）+ 执行 + 收集类型反馈
  ↓ TurboFan JIT（热点函数，运行 N 次后触发）
  优化机器码（内联缓存、内联展开、逃逸分析）
  ↓ 如果类型假设违反
  反优化（Deoptimization）→ 回到字节码
```

**内联缓存（Inline Cache）：**

```js
function add(obj) {
  return obj.x + obj.y; // V8 假设 obj 总是同一个"形状"（Hidden Class）
}

const a = { x: 1, y: 2 };
const b = { x: 3, y: 4 };
add(a); // ① 记录 a 的形状（{x, y}），缓存属性偏移量
add(b); // ② b 与 a 形状相同 → 命中缓存，直接访问偏移量（快！）

const c = { x: 1, y: 2, z: 3 }; // 不同形状
add(c); // ③ 形状不同 → 缓存 miss，退化为慢速查找（Megamorphic）
```

**触发反优化的常见原因：**

```js
function badAdd(a, b) {
  return a + b; // V8 优化为整数加法
}
badAdd(1, 2); // 整数，触发 JIT 优化
badAdd(1.5, 2); // 浮点！违反假设 → 反优化

// 对象形状变化导致反优化
function process(obj) {
  return obj.x;
}
const obj = {};
obj.x = 1; // 形状1：{x}
process(obj); // JIT 优化
obj.y = 2; // 形状2：{x, y}，已优化的代码需要反优化
```

**编写 JIT 友好代码：**

1. 保持对象形状一致（在构造函数中声明所有属性）
2. 避免动态添加/删除属性（`delete obj.x` 触发形状变化）
3. 保持数组元素类型一致（全整数 vs 混合浮点）
4. 避免 `arguments` 对象（阻止优化，用 rest 参数代替）

---

### 25. ⭐⭐⭐ 解释 TypeScript 的映射类型与模板字面量类型的高级用法

**参考答案：**

```ts
// 基础映射类型
type Readonly<T> = { readonly [K in keyof T]: T[K] };
type Optional<T> = { [K in keyof T]?: T[K] };

// 键重映射（as 子句）
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
type UserGetters = Getters<{ name: string; age: number }>;
// { getName: () => string; getAge: () => number }

// 过滤属性（结合 never）
type PickByValue<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};
type StringOnly = PickByValue<{ a: string; b: number; c: string }, string>;
// { a: string; c: string }

// 模板字面量类型
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickEvent = EventName<"click">; // 'onClick'

// 组合：从事件名映射到处理函数类型
type EventMap = {
  click: MouseEvent;
  keydown: KeyboardEvent;
  focus: FocusEvent;
};
type EventHandlers = {
  [K in keyof EventMap as `on${Capitalize<K>}`]: (e: EventMap[K]) => void;
};
// { onClick: (e: MouseEvent) => void; onKeydown: (e: KeyboardEvent) => void; ... }

// 深度 Readonly
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

---

## 延伸阅读

- [You Don't Know JS（书籍）](https://github.com/getify/You-Dont-Know-JS)
- [JavaScript Visualized — Event Loop（文章）](https://dev.to/lydiahallie/javascript-visualized-event-loop-3dif)
- [V8 博客 — 编译优化](https://v8.dev/blog)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [MDN JavaScript 指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide)
- [ECMAScript 规范](https://tc39.es/ecma262/)
