# React 核心面试题

> 基于 facebook/react 源码深挖的 React 分层面试题，共 35 道，覆盖 Fiber 架构、并发渲染、Hooks 原理、虚拟 DOM 及 React Compiler，从基础到源码级高级题。

## 相关链接

- 对应技术资料：[React 核心原理与源码解析](../../01-技术资料/01-前端/01-React核心原理.md)

## 目录

1. [基础题（⭐）](#基础题)
2. [进阶题（⭐⭐）](#进阶题)
3. [高级题（⭐⭐⭐）](#高级题)
4. [场景题（🎯）](#场景题)

---

## 🔥 高频考点速记

> 面试中最常被问到的核心知识点，按出现频率排序。建议优先掌握前 5 项。

| #   | 考点                    | 核心要点（一句话）                                             | 出题概率 |
| --- | ----------------------- | -------------------------------------------------------------- | -------- |
| 1   | Fiber 架构              | 链表结构替代递归栈，实现可中断渲染与优先级调度                 | ★★★★★    |
| 2   | Hooks 原理与规则        | 链表存储状态，Dispatcher 切换 mount/update，不能条件调用       | ★★★★★    |
| 3   | Virtual DOM 与 Diff     | 同层比较 + key 优化，O(n) 复杂度，双端 Diff                    | ★★★★★    |
| 4   | 并发渲染 (Concurrent)   | Lane 优先级模型 + 时间切片，startTransition 降低优先级         | ★★★★☆    |
| 5   | React 生命周期/Effect   | useEffect 异步执行 (paint 后)，useLayoutEffect 同步 (paint 前) | ★★★★☆    |
| 6   | 状态管理方案对比        | Context(简单) / Redux(复杂) / Zustand(轻量) / Jotai(原子)      | ★★★★☆    |
| 7   | 性能优化                | memo/useMemo/useCallback + 代码分割 + 虚拟列表                 | ★★★★☆    |
| 8   | React Server Components | 服务端渲染组件，零 JS bundle，减少客户端 hydration             | ★★★☆☆    |
| 9   | React 19 新特性         | use hook / Actions / useOptimistic / 文档元数据                | ★★★☆☆    |
| 10  | React Compiler          | 编译时自动 memoization，消除手动 useMemo/useCallback           | ★★★☆☆    |

---

## 基础题（⭐）

**Q1. 描述 React 组件从 JSX 到真实 DOM 的完整渲染流程。**

<details>
<summary>参考答案</summary>

完整流程分为五步：

```
JSX
 │ Babel 编译（或 jsx runtime）
 ▼
ReactElement 对象（虚拟 DOM 描述）
 │ react-reconciler 创建/更新 Fiber 树
 ▼
Fiber 树（Render 阶段，可中断）
 │ beginWork → completeWork
 ▼
带副作用标记的 Fiber 树（flags: Placement/Update/Deletion）
 │ Commit 阶段（不可中断）
 ▼
真实 DOM（浏览器渲染）
```

1. **JSX 编译**：Babel 将 `<div>` 转为 `jsx("div", props)`，生成 `ReactElement` 对象（含 `$$typeof: Symbol(react.element)`）。
2. **调度**：`root.render()` 触发 `scheduleUpdateOnFiber()`，将更新任务通过 Scheduler 放入任务队列。
3. **Render 阶段**：`workLoopConcurrent()` 循环调用 `performUnitOfWork()`，为每个 Fiber 节点执行 `beginWork`（创建子 Fiber、运行 Diff）和 `completeWork`（创建 DOM 节点、收集副作用）。
4. **Commit 阶段**：`commitRoot()` 同步执行三子阶段（Before Mutation → Mutation → Layout），将 Fiber 树的变更应用到真实 DOM。

**扩展**：`$$typeof` 使用 Symbol 的原因是防止 XSS——JSON 中无法序列化 Symbol，所以用户无法注入假的 React 元素。

</details>

---

**Q2. 虚拟 DOM 的优势和局限是什么？**

<details>
<summary>参考答案</summary>

**优势：**

- **跨平台**：Fiber 树是平台无关的抽象，可以对接不同渲染器（ReactDOM、React Native、React Three Fiber）。
- **批量更新**：多次 `setState` 可以合并成一次 DOM 操作，减少重排/重绘。
- **声明式编程**：开发者描述"应该是什么样子"，框架决定"如何变"，降低复杂度。

**局限：**

- **内存开销**：每个 DOM 节点对应一个 FiberNode 对象，大型列表（10000+ 节点）内存占用高。
- **初始渲染无优势**：首次渲染需要建立完整 Fiber 树，比直接操作 DOM 慢。
- **Diff 开销**：每次更新都需要遍历 Fiber 树做 Diff，对极简场景是额外开销。
- **不一定比直接操作 DOM 快**：虚拟 DOM 的价值在于**可维护性和跨平台**，而非绝对性能。

</details>

---

**Q3. 函数组件与类组件的核心区别是什么？**

<details>
<summary>参考答案</summary>

| 维度          | 函数组件                               | 类组件                                                       |
| ------------- | -------------------------------------- | ------------------------------------------------------------ |
| **数据模型**  | 每次渲染闭包捕获当时的 props/state     | `this.props`/`this.state` 是可变引用，可能出现 stale closure |
| **生命周期**  | `useEffect` 等 Hook 组合模拟           | `componentDidMount`/`componentDidUpdate` 等显式方法          |
| **性能优化**  | `React.memo` + `useMemo`/`useCallback` | `shouldComponentUpdate`/`PureComponent`                      |
| **this 问题** | 无 this，逻辑更清晰                    | 事件处理需要绑定 this                                        |
| **代码复用**  | 自定义 Hook（完美组合）                | HOC/render props（嵌套地狱）                                 |

**经典陷阱**（说明函数组件的闭包特性）：

```javascript
// 类组件：点击后 3 秒打印当前 count（可能是新值）
handleClick() {
  setTimeout(() => console.log(this.state.count), 3000);
}

// 函数组件：点击后 3 秒打印点击时的 count（闭包捕获）
const handleClick = () => {
  setTimeout(() => console.log(count), 3000);  // 闭包
};
```

**追问**：如果函数组件也需要访问最新值，可以用 `useRef` 存储最新值（ref 不参与渲染，但引用是稳定的）。

</details>

---

**Q4. React 合成事件（SyntheticEvent）的工作原理是什么？**

<details>
<summary>参考答案</summary>

React 并不直接在 DOM 节点上绑定原生事件，而是将所有事件委托到根容器（`root`）上：

```
原生 DOM 事件流：
  document
    └── root (React 根容器) ← React 在此注册事件监听
          └── div
                └── button ← 用户点击
```

当事件触发时，React 在根容器的监听器中：

1. 从触发元素向上遍历 Fiber 树，收集所有相关的事件处理函数。
2. 创建 `SyntheticEvent` 对象（跨浏览器兼容的事件封装）。
3. 模拟捕获/冒泡阶段，依次调用收集到的处理函数。

**React 17 之前**：事件委托在 `document` 上，与其他库（如 jQuery）混用时可能产生冲突。
**React 17+**：事件委托改为在 `root` 容器上，解决了多 React 版本共存问题。

**优先级映射**：React 事件被分配不同的 Lane 优先级：

- 离散事件（click/keydown）→ `SyncLane`（同步，最高优先级）
- 连续事件（mousemove/scroll）→ `InputContinuousLane`

</details>

---

**Q5. `key` 在 Diff 算法中的作用是什么？不用 key 或用 index 作为 key 会有什么问题？**

<details>
<summary>参考答案</summary>

`key` 是 React 标识列表中**哪个 Fiber 节点可以复用**的唯一标识。Diff 时（`reconcileChildrenArray`）：

1. 第一轮按位置遍历，key 不同则停止。
2. 第二轮将剩余旧节点存入 `Map<key, Fiber>`，遍历剩余新节点时通过 key 查找可复用节点。

**用 index 作为 key 的问题**：

```
旧列表（key=index）：[A(0), B(1), C(2)]
删除第一项后：      [B(0), C(1)]

React 认为：0 号节点从 A 变成了 B → 更新（而非删除 A 复用 B）
            1 号节点从 B 变成了 C → 更新
            2 号节点被删除

实际上应该：删除 A，复用 B(key=B) 和 C(key=C)
```

后果：

- **性能浪费**：本可以复用的节点被更新，导致不必要的 DOM 操作。
- **状态错乱**：受控组件（如输入框）的内部状态不会随节点位置移动，导致输入框内容错位。

**正确做法**：用稳定、唯一的业务 ID 作为 key（如数据库主键）。

</details>

---

**Q6. `useEffect` 和 `useLayoutEffect` 的执行时机有何区别？分别适用于什么场景？**

<details>
<summary>参考答案</summary>

```
Commit 阶段时序：
  Mutation（DOM 变更）
       │
       ▼
  Layout（同步）← useLayoutEffect 在此执行
       │
       ▼
  浏览器绘制
       │
       ▼
  (异步宏任务) ← useEffect 在此执行
```

| 特性         | useLayoutEffect                  | useEffect            |
| ------------ | -------------------------------- | -------------------- |
| 执行时机     | DOM 变更后，浏览器绘制前（同步） | 浏览器绘制后（异步） |
| 是否阻塞绘制 | 是                               | 否                   |
| 对应类组件   | componentDidMount/Update         | —                    |
| 服务端渲染   | ⚠️ 会收到警告（无 DOM）          | ✅ 安全              |

**适用场景**：

- `useLayoutEffect`：需要在绘制前读取/修改 DOM（计算元素尺寸、修复视觉闪烁、滚动到指定位置）。
- `useEffect`：大多数副作用（数据获取、事件订阅、日志上报），不阻塞渲染。

</details>

---

**Q7. 为什么 Hook 不能在条件语句或循环中调用？**

<details>
<summary>参考答案</summary>

React 通过 **Hook 链表的顺序**来标识每个 Hook 对应的状态。每次组件渲染时，React 按链表顺序依次取出 Hook 节点：

```
fiber.memoizedState → Hook1 → Hook2 → Hook3 → null
                      useState  useEffect useMemo
```

如果在条件语句中调用：

```javascript
function BadComponent({ condition }) {
  const [a] = useState(1); // Hook1
  if (condition) {
    const [b] = useState(2); // Hook2（条件渲染）
  }
  const [c] = useState(3); // 应该是 Hook3，但条件为 false 时变成了 Hook2
}
```

当 `condition` 从 `true` 变为 `false`，Hook 链表中 Hook2 的位置被 useState(3) 读取，导致状态错乱。

**React 在开发模式**下会通过 `ReactSharedInternals.H` 在组件外部赋值为 `ContextOnlyDispatcher`（每个 Hook 调用直接抛错），防止在渲染外使用 Hook。

</details>

---

**Q8. React 严格模式（StrictMode）的作用是什么？为什么会导致组件渲染两次？**

<details>
<summary>参考答案</summary>

`StrictMode` 是一个开发工具，在**开发模式**下执行额外检查，**不影响生产构建**。

主要检测项：

1. **检测副作用不纯**：React 有意在开发模式下调用组件函数、`useState` 初始化函数、`useMemo`/`useCallback` 各两次，验证这些纯函数对多次调用的幂等性。
2. **检测过时 API**：如 `componentWillMount`、字符串 ref、`ReactDOM.render`。
3. **检测 useEffect cleanup**：在开发模式下，React 18 会在 mount 后立即执行一次 `effect cleanup → effect create`，模拟组件卸载/重挂载，暴露遗漏清理副作用的问题。

```javascript
// 严格模式下开发环境的渲染时序（mount）：
// 1. 渲染（第一次）
// 2. 渲染（第二次，React 内部丢弃）← 检测副作用不纯
// 3. commit
// 4. useEffect cleanup（立即执行）
// 5. useEffect create（重新挂载）← 检测 cleanup 是否正确
```

</details>

---

**Q9. 什么是 React 的批处理（Batching）？React 18 的自动批处理与 React 17 有何不同？**

<details>
<summary>参考答案</summary>

**批处理**：将多次 `setState` 合并为一次重新渲染，减少不必要的 DOM 更新。

**React 17 及以前**：只在**合成事件处理函数**和**生命周期方法**中自动批处理：

```javascript
// React 17：批处理（只渲染一次）
onClick={() => {
  setState(1); setState(2);  // 批处理
}}

// React 17：不批处理（渲染两次）
setTimeout(() => {
  setState(1); setState(2);  // 不在合成事件中，各自触发渲染
}, 0);
```

**React 18**：引入**自动批处理（Automatic Batching）**，所有更新都自动批处理，包括 `setTimeout`、`Promise`、原生事件：

```javascript
// React 18：统一批处理（渲染一次）
setTimeout(() => {
  setState(1);
  setState(2); // 自动批处理！
}, 0);
```

**原理**：React 18 的更新通过 Scheduler 异步调度，多次 `setState` 会被合并到同一个 `renderRoot` 任务中。若需要强制立即渲染，使用 `flushSync()`。

</details>

---

**Q10. `React.memo`、`useMemo`、`useCallback` 的区别和使用场景？**

<details>
<summary>参考答案</summary>

| API           | 缓存对象 | 作用                                 |
| ------------- | -------- | ------------------------------------ |
| `React.memo`  | 组件     | 对比 props 相等性，跳过子组件重渲染  |
| `useMemo`     | 计算值   | 缓存计算结果，依赖不变则跳过重计算   |
| `useCallback` | 函数     | 缓存函数引用，依赖不变则返回同一引用 |

`useCallback(fn, deps)` 等价于 `useMemo(() => fn, deps)`，底层都是 `mountMemo`/`updateMemo`。

**正确使用场景**：

```javascript
// ✅ useMemo：代价高的计算（大数组过滤/排序）
const sorted = useMemo(() => heavySort(data), [data]);

// ✅ useCallback：传递给 React.memo 子组件的回调
const handleClick = useCallback(() => doSomething(id), [id]);
// <MemoChild onClick={handleClick} /> 只有 id 变时才重渲染

// ❌ 滥用：简单操作加 useMemo 徒增开销
const double = useMemo(() => count * 2, [count]); // 无需缓存
```

</details>

---

## 进阶题（⭐⭐）

**Q11. Fiber 架构解决了什么问题？与 Stack Reconciler 的区别是什么？**

<details>
<summary>参考答案</summary>

**Stack Reconciler 的问题**：

- 同步递归遍历组件树，一旦开始无法中断。
- 大型应用中，单次 Diff 可能超过 16ms（一帧预算），导致动画卡顿、输入延迟。

**Fiber 的解决方案**：
将渲染工作拆分为**可中断的工作单元**（FiberNode），每个单元可以：

- 暂停并在下一个时间片继续（时间切片）。
- 被高优先级更新打断（优先级调度）。
- 复用上次工作（bailout 优化）。

**核心数据结构区别**：

```
Stack Reconciler：
  调用栈（JS 引擎内部，不可控）
  reconcile(root) → reconcile(child) → reconcile(grandchild) ...

Fiber Reconciler：
  手动维护的链表（完全可控）
  workInProgress 指针逐步移动
  每处理一个 FiberNode 检查 shouldYield()
```

**关键能力**：

- **可中断**：`shouldYieldToHost()` 返回 true 时，保存 `workInProgress` 指针后退出，下次从同一节点继续。
- **优先级调度**：Lane 模型允许低优先级任务被高优先级任务打断。
- **双缓冲**：`current` 树和 `workInProgress` 树分离，用户始终看到完整的 UI 状态。

</details>

---

**Q12. 从源码角度分析 `useState` 的 bailout 优化机制。**

<details>
<summary>参考答案</summary>

`useState` 调用 `dispatch(newState)` 时，React 会在 `dispatchSetState` 中检查：

```javascript
// packages/react-reconciler/src/ReactFiberHooks.js
function dispatchSetState(fiber, queue, action) {
  // 计算新的 state
  const eagerState = queue.lastRenderedReducer(queue.lastRenderedState, action);

  // Bailout 优化：新旧 state 相同则跳过调度
  if (Object.is(eagerState, queue.lastRenderedState)) {
    return;  // 直接返回，不触发重渲染！
  }

  // 创建 Update 对象，加入队列
  const update = { lane, action, ... };
  enqueueUpdate(fiber, queue, update, lane);
  scheduleUpdateOnFiber(root, fiber, lane);
}
```

bailout 发生的两个时机：

1. **dispatch 时**（eager bailout）：新 state 与旧 state 相同（`Object.is`），直接跳过，不进入 Scheduler。
2. **beginWork 时**（render bailout）：检查 `fiber.lanes`，若当前渲染 lane 中不包含该 fiber 的更新，且 `props`/`context` 未变，调用 `bailoutOnAlreadyFinishedWork()`，跳过整个子树。

**注意**：对象/数组 `setState({})` 每次都是新引用，`Object.is` 返回 false，不会触发 bailout。

</details>

---

**Q13. 详述 React 并发模式下的 Lane 优先级系统。**

<details>
<summary>参考答案</summary>

Lane 模型用 **32 位整数的二进制位**表示优先级，支持同时处理多个优先级的更新：

```javascript
// packages/react-reconciler/src/ReactFiberLane.js
const SyncLane = 0b001; // 同步（用户输入）
const InputContinuousLane = 0b100; // 连续输入（滚动）
const DefaultLane = 0b10000; // 默认（setTimeout/fetch）
const TransitionLane1 = 0b1000000; // startTransition
const IdleLane = 0x10000000; // 空闲
```

**位运算操作**：

- 合并优先级：`mergeLanes(a, b) = a | b`
- 判断包含：`includesSomeLane(set, subset) = (set & subset) !== 0`
- 移除优先级：`removeLanes(set, subset) = set & ~subset`
- 获取最高优先级：`getHighestPriorityLane(lanes) = lanes & -lanes`（取最低位）

**调度流程**：

1. 用户事件 → 根据事件类型确定 Lane → 打在 `fiber.lanes` 上。
2. `ensureRootIsScheduled()` 根据 `root.pendingLanes` 中最高优先级的 Lane 决定调度策略：
   - `SyncLane` → `scheduleSyncCallback`（微任务，同步执行）
   - 其他 → `scheduleCallback(schedulerPriority, ...)`（Scheduler 宏任务）
3. 低优先级任务被高优先级任务打断后，下次调度时会提升优先级（**starved 防饥饿机制**）：

```javascript
// 若某个 lane 等待超过 expirationTime，提升至 expiredLanes
function markStarvedLanesAsExpired(root, currentTime) {
  const pendingLanes = root.pendingLanes;
  let lanes = pendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const expirationTime = root.expirationTimes[index];
    if (expirationTime <= currentTime) {
      root.expiredLanes |= 1 << index; // 标记为过期，下次必须同步处理
    }
    lanes &= ~(1 << index);
  }
}
```

</details>

---

**Q14. `startTransition` 的实现原理和使用场景。**

<details>
<summary>参考答案</summary>

**实现原理**（`packages/react/src/ReactStartTransition.js`）：

```javascript
export function startTransition(scope) {
  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = {}; // 标记当前在 transition 上下文中
  try {
    scope(); // 执行回调，其中的 setState 会被打上 TransitionLane
  } finally {
    ReactSharedInternals.T = prevTransition;
  }
}
```

在 `dispatchSetState` 中，读取 `ReactSharedInternals.T` 来确定当前是否在 transition 中，若是则使用 `TransitionLane`。

**与紧急更新的对比**：

```javascript
// 场景：搜索框输入，过滤大列表
const [query, setQuery] = useState("");
const [results, setResults] = useState([]);

function handleInput(e) {
  setQuery(e.target.value); // 紧急更新（SyncLane）：立即更新输入框

  startTransition(() => {
    setResults(filterData(e.target.value)); // 可中断更新（TransitionLane）
  });
}
```

React 保证：即使列表过滤很慢，输入框也能立即响应（紧急更新不被 Transition 阻塞）。

**Hook 形式**：`useTransition()` 返回 `[isPending, startTransition]`，`isPending` 在 Transition 进行中为 `true`，可用于显示加载状态。

</details>

---

**Q15. Suspense 的工作原理是什么（throw Promise 机制）？**

<details>
<summary>参考答案</summary>

Suspense 利用了 JavaScript 的异常机制实现"等待异步操作"：

```javascript
// 数据获取库（如 React Query）的封装
function fetchData(url) {
  if (cache[url]) return cache[url]; // 缓存命中，同步返回

  throw promise; // ← 抛出 Promise！
}

// 组件中使用
function UserProfile() {
  const data = fetchData("/api/user"); // 可能 throw Promise
  return <div>{data.name}</div>;
}
```

**React 的处理流程**（`ReactFiberWorkLoop.js`）：

```
beginWork(UserProfile)
  │
  └─ 执行 UserProfile()
       │
       └─ throw Promise ← React 捕获异常
              │
              ▼
       向上找最近的 <Suspense> 边界
              │
              ▼
       将 <Suspense> 的 fallback 渲染到屏幕
              │
              ▼
       向 Promise 注册 .then()
              │
              ▼（Promise resolve）
       重新触发渲染，此时 fetchData 返回缓存数据
              │
              ▼
       渲染实际内容，替换 fallback
```

**React 18 的 Suspense 改进**：配合并发渲染，`Suspense` 可以在不阻塞主线程的情况下等待数据，用于**流式 SSR**（`renderToPipeableStream`）。

</details>

---

**Q16. React Context 的性能问题与优化方案。**

<details>
<summary>参考答案</summary>

**性能问题根源**：

Context 的 `value` 引用变化时，所有消费该 Context 的组件都会强制重渲染，即使它们使用的字段没有变化：

```javascript
// 问题：整个 context 对象每次都是新引用
<Context.Provider value={{ theme, user, settings }}>
  {/* 任何字段变化都导致所有消费者重渲染 */}
</Context.Provider>
```

**优化方案**：

1. **拆分 Context**：将不同更新频率的数据拆到不同 Context：

```javascript
<ThemeContext.Provider value={theme}>
  <UserContext.Provider value={user}>
    <App />
  </UserContext.Provider>
</ThemeContext.Provider>
```

2. **稳定引用（useMemo）**：

```javascript
const value = useMemo(() => ({ theme, toggleTheme }), [theme]);
<Context.Provider value={value}>
```

3. **使用 `use(Context)` + `React.memo` 精确订阅**（React 19 方向）。

4. **Context selector 模式**：使用第三方库（`use-context-selector`），基于发布-订阅模式实现精准订阅，避免全量重渲染。

**源码原理**：`beginWork` 处理 Context.Provider 时调用 `propagateContextChange()`，遍历子树中所有消费该 Context 的 Fiber，标记它们需要重渲染（打上 `ForceUpdateForLegacyHiddenComponent` flag）。

</details>

---

**Q17. Error Boundary 的实现机制（`getDerivedStateFromError` vs `componentDidCatch`）。**

<details>
<summary>参考答案</summary>

Error Boundary 只能是**类组件**，需实现至少一个方法：

| 方法                       | 执行时机                       | 用途                    |
| -------------------------- | ------------------------------ | ----------------------- |
| `getDerivedStateFromError` | Render 阶段（同步）            | 更新 state，渲染降级 UI |
| `componentDidCatch`        | Commit 阶段（异步，layout 后） | 上报错误到监控服务      |

**工作原理**（`ReactFiberThrow.js`）：

```
子组件抛出错误
     │
     ▼
throwException()
     │ 向上遍历 Fiber 树，找最近的 ErrorBoundary
     ▼
createClassErrorUpdate()
     │ 调用 getDerivedStateFromError(error) 计算新 state
     │ 将更新加入 ErrorBoundary 的 updateQueue
     ▼
重新渲染 ErrorBoundary
     │ 用新 state 渲染（显示 fallback UI）
     ▼
Commit 阶段
     └── componentDidCatch(error, info) ← 异步执行，适合上报
```

**局限**：Error Boundary 无法捕获：

- 事件处理函数（需用 try-catch）
- 异步代码（setTimeout/Promise）
- 服务端渲染
- Error Boundary 自身的错误

</details>

---

**Q18. `useRef` 的实现原理——为何修改 ref 不会触发重渲染？**

<details>
<summary>参考答案</summary>

源码（`ReactFiberHooks.js`）：

```javascript
function mountRef(initialValue) {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue }; // 普通对象，非响应式
  hook.memoizedState = ref;
  return ref;
}

function updateRef(initialValue) {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState; // 每次渲染返回同一个对象引用
}
```

**核心原因**：`ref` 是一个普通的 JavaScript 对象 `{ current: value }`，React 不追踪它的属性变化。修改 `ref.current` 不会调用任何通知机制，因此 React 不知道值变了，也就不会触发重渲染。

对比 `useState`：

- `setState` 调用 `dispatchSetState()` → 创建 Update → 触发调度 → 重渲染。
- `ref.current = value` 直接修改对象属性，不经过任何 React 调度机制。

**适用场景**：

- 访问/操作 DOM 节点。
- 存储不影响 UI 的可变值（定时器 ID、上一次的 state 值）。
- 跨渲染保持稳定引用（避免 useEffect 依赖数组频繁变化）。

</details>

---

**Q19. Scheduler 的任务调度算法（小顶堆）。**

<details>
<summary>参考答案</summary>

Scheduler（`packages/scheduler/src/forks/Scheduler.js`）维护两个**最小堆**：

- `taskQueue`：已到期任务，按 `expirationTime` 排序（越小越优先）。
- `timerQueue`：未到期任务，按 `startTime` 排序。

**最小堆操作**（时间复杂度）：

- `push`：O(log n)，插入后上浮（siftUp）。
- `peek`：O(1)，堆顶元素。
- `pop`：O(log n)，移除堆顶后下沉（siftDown）。

**任务生命周期**：

```
scheduleCallback(priority, callback)
     │
     ├─ startTime > currentTime → 入 timerQueue，设置 setTimeout 等待
     └─ startTime <= currentTime → 入 taskQueue
                                        │
                                        ▼
                               MessageChannel 触发 workLoop
                                        │
                                        ▼
                               while (peek(taskQueue) !== null) {
                                 const task = peek(taskQueue)
                                 if (task.expirationTime > currentTime && shouldYield) break
                                 pop(taskQueue)
                                 task.callback(didTimeout)
                               }
```

**优先级 → expirationTime 映射**：

| Scheduler 优先级     | 超时时间         | 对应 React Lane     |
| -------------------- | ---------------- | ------------------- |
| ImmediatePriority    | -1ms（立即过期） | SyncLane            |
| UserBlockingPriority | 250ms            | InputContinuousLane |
| NormalPriority       | 5000ms           | DefaultLane         |
| LowPriority          | 10000ms          | TransitionLane      |
| IdlePriority         | 永不过期         | IdleLane            |

</details>

---

**Q20. React Server Components（RSC）的架构设计。**

<details>
<summary>参考答案</summary>

RSC 将组件分为三类：

| 类型              | 运行环境 | 标记方式                     | 能力                                           |
| ----------------- | -------- | ---------------------------- | ---------------------------------------------- |
| Server Components | 服务器   | 默认（无标记）/ `.server.js` | 直接访问 DB/文件系统，不能用 Hook，零客户端 JS |
| Client Components | 浏览器   | `"use client"` 指令          | 完整 React 能力（Hook/事件）                   |
| Shared Components | 两端均可 | 无副作用的纯组件             | —                                              |

**工作流程**：

```
服务器                              客户端
  │                                   │
  ├─ 执行 Server Components           │
  │   直接查询数据库                   │
  │   渲染为 RSC Payload              │
  │   （特殊 JSON 格式，含 Client     │
  │   Components 的占位符）           │
  │                                   │
  └─ RSC Payload ─────────────────►  │
                                      ├─ React 解析 Payload
                                      ├─ hydrate Client Components
                                      └─ 交互就绪
```

**关键优势**：

- Server Components 的代码**不发送到客户端**，减小 bundle 体积。
- 数据获取直接在服务器，消除客户端 waterfall 请求。
- Client Components 可以嵌套在 Server Components 中（但反之不行）。

</details>

---

**Q21. React 18 自动批处理（Automatic Batching）的实现原理。**

<details>
<summary>参考答案</summary>

React 17 的批处理通过 `executionContext`（位标记）实现：只在 `BatchedContext` 中的 setState 才会批处理。合成事件设置了 `BatchedContext`，但 `setTimeout`/`Promise` 中的代码没有。

React 18 的变化：所有调度都通过 Scheduler 的宏任务队列（MessageChannel），因此：

```
React 18 更新流程：
  setState(1) → dispatchSetState → scheduleUpdateOnFiber
                                         │ 注意：不立即执行，而是
                                         ▼
                              ensureRootIsScheduled()
                                         │
                                    已有任务在队列中？
                                    是 → 合并到现有任务（批处理）
                                    否 → 新建 Scheduler 任务
```

多次 `setState` 都会调用 `ensureRootIsScheduled()`，但 Scheduler 检测到同一个 root 已有任务时，只更新任务的优先级而不新建任务，从而实现批处理。

**flushSync 原理**：`flushSync` 在 `executionContext` 中加入 `SyncContext` 标记，强制同步执行，绕过 Scheduler 队列：

```javascript
flushSync(() => {
  setState(1); // 立即同步渲染，不等待批处理
});
```

</details>

---

**Q22. `useDeferredValue` 的实现原理。**

<details>
<summary>参考答案</summary>

```javascript
// 简化实现（ReactFiberHooks.js）
function updateDeferredValueImpl(hook, prevValue, value, renderLanes) {
  if (includesSomeLane(renderLanes, updateLane)) {
    // 当前是高优先级渲染，直接用旧值，避免阻塞
    hook.memoizedState = prevValue;

    // 以 TransitionLane 调度一次低优先级更新（用新值）
    scheduleUpdateOnFiber(currentlyRenderingFiber, TransitionLane);
    return prevValue; // 返回旧值
  } else {
    // 低优先级渲染（TransitionLane），使用新值
    hook.memoizedState = value;
    return value;
  }
}
```

**与 `startTransition` 的区别**：

- `startTransition`：包裹 setter，标记更新为低优先级。
- `useDeferredValue`：包裹 value，当高优先级渲染时自动"推迟"该值的更新。
- 适用场景：当你无法控制 setState 的调用方（如第三方组件），可用 `useDeferredValue` 延迟接收新值。

</details>

---

## 高级题（⭐⭐⭐）

**Q23. 从源码角度分析 `useEffect` 的完整生命周期。**

<details>
<summary>参考答案</summary>

`useEffect` 的完整生命周期涉及 **mount → update → unmount** 三个阶段：

**Mount 阶段**（`mountEffect` → `mountEffectImpl`）：

```javascript
function mountEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  currentlyRenderingFiber.flags |= fiberFlags; // 打上 PassiveEffect flag
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags, // 标记本次需要执行 create
    create,
    undefined, // destroy 初始为 undefined
    nextDeps,
  );
}
```

**Commit 阶段调度**：`commitRoot` 末尾通过 `scheduleCallback(NormalPriority, flushPassiveEffects)` 异步调度。

**flushPassiveEffects 执行顺序**：

```
1. 执行所有 useEffect cleanup（destroy 函数）
   │ 按 fiber 树的深度优先后序遍历
   ▼
2. 执行所有 useEffect create（create 函数）
   │ 将返回值（destroy 函数）保存到 hook.memoizedState.destroy
   ▼
3. 完成

注意：cleanup 和 create 是两个独立的遍历阶段，
所有 cleanup 都在所有 create 之前执行（保证一致性）
```

**Update 阶段**（`updateEffect`）：

```javascript
function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevEffect = hook.memoizedState;

  if (nextDeps !== null) {
    if (areHookInputsEqual(nextDeps, prevEffect.deps)) {
      // 依赖未变，不标记 HookHasEffect（本次不执行）
      hook.memoizedState = pushEffect(
        hookFlags,
        create,
        prevEffect.destroy,
        nextDeps,
      );
      return;
    }
  }

  // 依赖变化，标记需要执行
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,
    create,
    prevEffect.destroy, // 上次的 destroy 函数
    nextDeps,
  );
}
```

**Unmount 阶段**：Commit 的 Mutation 子阶段处理 `Deletion` flag，调用 `commitHookEffectListUnmount()`，执行所有 `useEffect` 的 destroy 函数。

</details>

---

**Q24. Fiber Diff 算法的两轮遍历策略详解。**

<details>
<summary>参考答案</summary>

多节点 Diff 在 `reconcileChildrenArray()` 中实现（`ReactChildFiber.js`）：

**第一轮遍历（处理更新）**：

```javascript
let oldFiber = currentFirstChild;
let newIdx = 0;
for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
  if (oldFiber.index > newIdx) break; // 位置跳跃，停止

  const newChild = newChildren[newIdx];
  const matchedFiber = updateSlot(returnFiber, oldFiber, newChild, lanes);

  if (matchedFiber === null) break; // key 不匹配，停止第一轮

  // key 匹配，复用或创建
  if (shouldTrackSideEffects && oldFiber && matchedFiber.alternate === null) {
    deleteChild(returnFiber, oldFiber); // 新类型，旧节点标记删除
  }
  placeChild(matchedFiber, lastPlacedIndex, newIdx);

  oldFiber = oldFiber.sibling;
}
```

**第一轮结束后的三种情况**：

```
情况1：新节点遍历完（newIdx === newChildren.length）
  → 删除剩余旧节点

情况2：旧节点遍历完（oldFiber === null）
  → 新增剩余新节点

情况3：都未遍历完（key 不匹配导致中断）
  → 进入第二轮
```

**第二轮遍历（处理移动/复用）**：

```javascript
// 将剩余旧节点存入 Map（key → Fiber 或 index → Fiber）
const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

for (; newIdx < newChildren.length; newIdx++) {
  const newFiber = updateFromMap(
    existingChildren,
    returnFiber,
    newIdx,
    newChildren[newIdx],
    lanes,
  );
  if (newFiber !== null) {
    if (shouldTrackSideEffects && newFiber.alternate !== null) {
      existingChildren.delete(newFiber.key || newIdx); // 从 Map 中移除（已使用）
    }
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
  }
}

// 删除未被使用的旧节点（Map 中剩余的）
if (shouldTrackSideEffects) {
  existingChildren.forEach((child) => deleteChild(returnFiber, child));
}
```

**`placeChild` 中的移动判断**：

```javascript
function placeChild(newFiber, lastPlacedIndex, newIndex) {
  newFiber.index = newIndex;
  const current = newFiber.alternate;
  if (current !== null) {
    const oldIndex = current.index;
    if (oldIndex < lastPlacedIndex) {
      // 旧位置在最后放置位置的左边 → 需要移动
      newFiber.flags |= Placement;
      return lastPlacedIndex;
    } else {
      // 不需要移动，更新 lastPlacedIndex
      return oldIndex;
    }
  } else {
    // 新节点，标记插入
    newFiber.flags |= Placement;
    return lastPlacedIndex;
  }
}
```

</details>

---

**Q25. React 并发渲染的时间切片机制（MessageChannel + shouldYieldToHost）。**

<details>
<summary>参考答案</summary>

**为何不用 requestIdleCallback（rAF）**：

- `requestIdleCallback` 兼容性差（Safari 不支持），且调用频率不稳定（浏览器限制约 20fps）。
- `requestAnimationFrame` 每帧只调用一次，粒度太粗。

**MessageChannel 实现**（`Scheduler.js`）：

```javascript
const channel = new MessageChannel();
const port = channel.port2;

channel.port1.onmessage = performWorkUntilDeadline; // 宏任务回调

function schedulePerformWorkUntilDeadline() {
  port.postMessage(null); // 触发下一个宏任务
}

function performWorkUntilDeadline() {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime();
    deadline = currentTime + frameInterval; // 5ms 时间预算
    const hasMoreWork = scheduledHostCallback(true, currentTime);
    if (hasMoreWork) {
      schedulePerformWorkUntilDeadline(); // 还有工作，继续调度
    } else {
      isMessageLoopRunning = false;
      scheduledHostCallback = null;
    }
  }
}
```

**shouldYieldToHost 逻辑**：

```javascript
function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameYieldMs) return false; // 5ms 内不让步

  // 检查浏览器是否有待处理的输入事件（Scheduling API）
  if (enableIsInputPending && navigator.scheduling?.isInputPending) {
    if (needsPaint) return true; // 需要绘制，立即让步
    return navigator.scheduling.isInputPending(continuousOptions);
  }

  // 超过 300ms（continuousYieldMs）无论如何让步
  return timeElapsed >= continuousYieldMs;
}
```

**完整时序**：

```
帧时间轴（16.67ms）：
┌──────────────────────────────────────────────────────────────┐
│  宏任务①(5ms)  │ 浏览器处理 │ 宏任务②(5ms)  │ 布局/绘制  │
│  React Render  │ (输入/rAF) │  React 续    │            │
│  shouldYield   │            │  shouldYield  │            │
│  → true 让步  │            │  → ...        │            │
└──────────────────────────────────────────────────────────────┘
```

</details>

---

**Q26. 手写简化版 `useState` 实现。**

<details>
<summary>参考答案</summary>

```javascript
// 简化版 React Hooks 实现（不含优先级、不含并发）
let workInProgressHook = null;
let currentHook = null;
let currentFiber = null;

// Hook 链表节点
function createHook() {
  return {
    memoizedState: null,
    queue: null,
    next: null,
  };
}

function mountWorkInProgressHook() {
  const hook = createHook();
  if (workInProgressHook === null) {
    currentFiber.memoizedState = workInProgressHook = hook;
  } else {
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook() {
  // 从 current 树对应 Hook 读取
  currentHook = currentHook.next;
  const hook = createHook();
  hook.memoizedState = currentHook.memoizedState;
  hook.queue = currentHook.queue;
  if (workInProgressHook === null) {
    currentFiber.memoizedState = workInProgressHook = hook;
  } else {
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

// useState 实现
function useState(initialState) {
  const isMounting = currentHook === null;

  if (isMounting) {
    // Mount 阶段
    const hook = mountWorkInProgressHook();
    hook.memoizedState =
      typeof initialState === "function" ? initialState() : initialState;

    const queue = { pending: null, dispatch: null };
    hook.queue = queue;

    const dispatch = (action) => {
      // 创建 update 对象，加入环形链表
      const update = { action, next: null };
      const pending = queue.pending;
      if (pending === null) {
        update.next = update;
      } else {
        update.next = pending.next;
        pending.next = update;
      }
      queue.pending = update;
      scheduleRender(); // 触发重新渲染
    };

    queue.dispatch = dispatch;
    return [hook.memoizedState, dispatch];
  } else {
    // Update 阶段
    const hook = updateWorkInProgressHook();
    const queue = hook.queue;

    // 处理待执行的 update
    let newState = hook.memoizedState;
    if (queue.pending !== null) {
      let update = queue.pending.next; // 环形链表的第一个
      do {
        newState =
          typeof update.action === "function"
            ? update.action(newState)
            : update.action;
        update = update.next;
      } while (update !== queue.pending.next);
      queue.pending = null;
    }

    // Bailout 优化
    if (Object.is(newState, hook.memoizedState)) {
      return [newState, queue.dispatch];
    }

    hook.memoizedState = newState;
    return [newState, queue.dispatch];
  }
}
```

**追问**：实际 React 中还有 `baseState`/`baseQueue` 处理优先级跳过的 update，以及 `eagerState` 的提前计算优化。

</details>

---

**Q27. React Compiler 的自动 memoization 原理。**

<details>
<summary>参考答案</summary>

React Compiler（`compiler/packages/babel-plugin-react-compiler/`）在编译时进行静态分析：

**分析步骤**：

1. **HIR（High-level IR）构建**：将 AST 转为高级中间表示，分析控制流和数据流。
2. **别名分析**：检测变量是否逃逸（被外部引用修改），不可逃逸的值可以安全缓存。
3. **响应性分析**：标记哪些值依赖 props/state（响应式），哪些是常量（可直接缓存）。
4. **代码生成**：插入 `useMemoCache(n)` 调用（内部 API），用 `$[i]` 读写缓存槽。

**生成代码模式**：

```javascript
// 编译器生成的缓存检查模式
const $ = useMemoCache(3);
let t0;
if ($[0] !== dep1 || $[1] !== dep2) {
  t0 = computeExpensiveValue(dep1, dep2);
  $[0] = dep1;
  $[1] = dep2;
  $[2] = t0;
} else {
  t0 = $[2]; // 缓存命中
}
```

**Rules of React 合规性检查**：
编译器会在编译时静态检测 React 规则违规，对无法优化的组件发出警告并跳过（降级为未优化代码），保证正确性。

**与手动 useMemo 的区别**：

- 编译器能分析**函数内任意子表达式**的可记忆性，粒度比手动 `useMemo` 更细。
- 编译器理解条件/循环中的缓存失效，而手动 `useMemo` 依赖数组容易遗漏。

</details>

---

**Q28. React 事件优先级如何映射到 Lane 优先级？**

<details>
<summary>参考答案</summary>

源码路径：`packages/react-dom/src/events/ReactDOMEventListener.js`

```javascript
function getEventPriority(domEventName) {
  switch (domEventName) {
    // 离散事件（每次独立，不连续）→ 同步 Lane
    case "click":
    case "keydown":
    case "keyup":
    case "submit":
    case "focus":
    case "blur":
      return DiscreteEventPriority; // = SyncLane

    // 连续事件（频繁触发）→ 连续 Lane
    case "drag":
    case "mousemove":
    case "scroll":
    case "touchmove":
      return ContinuousEventPriority; // = InputContinuousLane

    // 默认
    default:
      return DefaultEventPriority; // = DefaultLane
  }
}
```

**Scheduler 优先级映射**：

```javascript
// lanesToEventPriority：将 React Lane 转为 Scheduler 优先级
function lanesToEventPriority(lanes) {
  const lane = getHighestPriorityLane(lanes);
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority; // → ImmediateSchedulerPriority
  }
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority; // → UserBlockingSchedulerPriority
  }
  if (includesSomeLane(TransitionLanes, lane)) {
    return DefaultEventPriority; // → NormalSchedulerPriority
  }
  return IdleEventPriority; // → IdleSchedulerPriority
}
```

**实际效果**：用户点击触发的 setState → `SyncLane` → `ImmediateSchedulerPriority` → 在微任务/同步中执行，保证输入响应。

</details>

---

**Q29. Hydration 过程中的 Mismatch 处理机制。**

<details>
<summary>参考答案</summary>

Hydration 是将服务端渲染的静态 HTML 与客户端 React 树关联（attach）的过程，由 `ReactFiberHydrationContext.js` 实现。

**正常 Hydration 流程**：

1. `beginWork` 处理 `HostComponent` 时，调用 `tryToClaimNextHydratableInstance()`。
2. 从 SSR 生成的 DOM 中按位置（深度优先）匹配 Fiber 节点。
3. 复用现有 DOM 节点（不重新创建），只绑定事件监听和 ref。

**Mismatch 处理**：

```
发现 Mismatch：
  客户端 Fiber 期望：<div>
  服务端 HTML 实际：<span>
         │
         ▼
  开发模式：打印 hydration 警告
  生产模式：静默处理
         │
         ▼
  React 18 支持"可恢复的 Mismatch"：
  对受影响的子树重新客户端渲染（抛弃 SSR HTML）
  其他部分继续 hydration
```

**React 18 的并发 Hydration**（Selective Hydration）：

- 页面分段 hydration，优先 hydrate 用户正在交互的部分。
- 用户点击某个尚未 hydrated 的区域，React 立即 hydrate 该区域（通过 `SyncLane`），确保交互不丢失。

**Mismatch 常见原因**：

- 服务端/客户端时间不同（`Date.now()`）。
- 客户端特有的 API（`window.innerWidth`）。
- 随机数（`Math.random()`）。

**解决方案**：使用 `suppressHydrationWarning` 属性（仅用于叶子节点），或用 `useEffect` 在客户端更新值。

</details>

---

**Q30. `flushSync` 如何绕过批处理？**

<details>
<summary>参考答案</summary>

```javascript
// 源码（packages/react-dom/src/ReactDOMRoot.js）
function flushSync(fn) {
  const previousExecutionContext = executionContext;
  executionContext |= SyncContext; // 加入同步上下文标记
  try {
    if (fn) {
      return fn(); // 执行回调（其中的 setState 会立即处理）
    }
  } finally {
    executionContext = previousExecutionContext;
    // 执行完毕，立即处理所有 SyncLane 的更新
    flushSyncWorkOnAllRoots();
  }
}
```

**工作原理**：

1. `flushSync` 设置 `SyncContext`。
2. 回调中的 `setState` 调用 `scheduleUpdateOnFiber`，因处于 `SyncContext`，不进入 Scheduler 队列，而是直接标记为需要同步处理。
3. `flushSync` 的 `finally` 中调用 `flushSyncWorkOnAllRoots()`，同步执行所有挂起的更新。

**使用场景**：

```javascript
// 强制立即更新（如第三方库的回调中需要同步状态）
flushSync(() => {
  setState(newValue);
});
// 这里的 DOM 已经是最新状态
document.getElementById('result').textContent = ...;
```

**注意**：`flushSync` 内部嵌套调用会抛出警告，因为可能导致无限循环。

</details>

---

## 场景题（🎯）

**Q31. 设计一个支持并发请求、请求竞态处理的数据获取 Hook。**

<details>
<summary>参考答案</summary>

```typescript
import { useState, useEffect, useRef, useCallback } from "react";

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useFetch<T>(
  url: string | null,
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  // 用 ref 追踪最新请求 ID，解决竞态条件
  const requestIdRef = useRef(0);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    if (!url) return;

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const abortController = new AbortController();

    fetch(url, { signal: abortController.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((data) => {
        // 只处理最新请求的结果（防竞态）
        if (requestId === requestIdRef.current && !cancelled) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (requestId === requestIdRef.current && !cancelled) {
          if (error.name !== "AbortError") {
            setState({ data: null, loading: false, error });
          }
        }
      });

    return () => {
      cancelled = true;
      abortController.abort(); // 清理：取消请求
    };
  }, [url, refetchTrigger]);

  const refetch = useCallback(() => {
    setRefetchTrigger((n) => n + 1);
  }, []);

  return { ...state, refetch };
}
```

**关键设计点**：

1. **竞态处理**：`requestIdRef` 对比确保只处理最新请求。
2. **请求取消**：`AbortController` 在 `useEffect` cleanup 中取消进行中的请求。
3. **refetch 能力**：通过 `refetchTrigger` 触发重新请求。
4. **类型安全**：泛型 `T` 确保返回数据的类型。

**追问**：如何添加缓存？可用 `useRef` 存储 `Map<url, data>`，或用 `SWR`/`React Query`（其底层也是类似的竞态处理 + 缓存）。

</details>

---

**Q32. 优化一个大列表渲染的性能——虚拟滚动 vs `useDeferredValue`，如何选择？**

<details>
<summary>参考答案</summary>

| 方案                 | 原理                             | 适用场景                     | 局限                               |
| -------------------- | -------------------------------- | ---------------------------- | ---------------------------------- |
| **虚拟滚动**         | 只渲染可见区域的 DOM             | 列表项 DOM 复杂、数量 10000+ | 实现复杂，需精确知道条目高度       |
| **useDeferredValue** | 用旧值先渲染，低优先级更新为新值 | 过滤/搜索导致的列表更新      | 不减少 DOM 数量，仍受 DOM 数量影响 |
| **React.memo + key** | 跳过未变化条目的重渲染           | 列表更新频率高但每次变化量小 | 不解决初始渲染慢                   |
| **分页/无限滚动**    | 减少一次性渲染的条目数           | 数据量大、用户习惯翻页       | 需要后端支持                       |

**推荐决策**：

```
列表条目数量
    │
    ├─ < 100：React.memo 优化即可
    │
    ├─ 100~1000：
    │     ├─ 过滤/搜索场景 → useDeferredValue（保持输入响应）
    │     └─ 静态列表 → React.memo 足够
    │
    └─ > 1000：虚拟滚动（react-window 或 react-virtual）
```

**结合使用**：

```javascript
function SearchableList({ items }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  // 只有 deferredQuery 变化时才重新过滤（低优先级）
  const filtered = useMemo(
    () => items.filter((item) => item.name.includes(deferredQuery)),
    [items, deferredQuery],
  );

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      {/* 虚拟滚动处理大量结果 */}
      <VirtualList items={filtered} />
    </>
  );
}
```

</details>

---

**Q33. 如何排查一个 React 应用的内存泄漏问题？**

<details>
<summary>参考答案</summary>

**常见内存泄漏来源**：

1. **未清理的事件监听**：

```javascript
useEffect(() => {
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler); // 必须清理！
}, []);
```

2. **未取消的异步操作**（竞态/泄漏双问题）：

```javascript
useEffect(() => {
  const abort = new AbortController();
  fetch(url, { signal: abort.signal }).then(setData);
  return () => abort.abort();
}, [url]);
```

3. **闭包引用大对象**：`useCallback`/`useMemo` 的 deps 数组意外捕获大对象。

4. **Context 值变化导致大量组件保留旧值引用**。

**排查步骤**：

```
1. Chrome DevTools → Memory 面板
   → 拍摄堆快照（Heap Snapshot）
   → 操作（如打开/关闭弹窗多次）
   → 再拍快照
   → 对比两次快照，查看 "Comparison" 视图

2. 关注 "Detached DOM tree"（已从 DOM 移除但仍被 JS 引用的节点）

3. React DevTools Profiler
   → 录制一段操作
   → 查看 "Why did this render?" 追踪不必要渲染

4. 检查 useEffect 的 cleanup 函数
   → 严格模式会暴露缺少 cleanup 的 effect
```

**防范措施**：

- 开启 StrictMode（开发环境），暴露遗漏 cleanup 的 effect。
- 使用 `eslint-plugin-react-hooks` 检查 Hook 规则。
- 组件卸载时检查日志（在 cleanup 中 `console.log('cleanup')`）。

</details>

---

**Q34. 对比 Context vs Redux vs Zustand vs Jotai 状态管理方案，如何选择？**

<details>
<summary>参考答案</summary>

| 方案        | 适用规模      | 性能特性                 | 学习成本 | 特点                     |
| ----------- | ------------- | ------------------------ | -------- | ------------------------ |
| **Context** | 小型/低频更新 | 全量重渲染（需手动优化） | 极低     | React 内置，无依赖       |
| **Redux**   | 大型复杂应用  | 精确订阅（selector）     | 高       | 可预测、时间旅行调试     |
| **Zustand** | 中小型应用    | 精确订阅（内置）         | 低       | 简单直接，无 boilerplate |
| **Jotai**   | 原子化状态    | 原子粒度订阅             | 中       | 细粒度响应式，类 Recoil  |

**选型决策树**：

```
状态是否跨组件共享？
  否 → useState/useReducer 本地状态
  是 ↓
状态复杂度？
  简单（1-5个字段，低频） → Context
  复杂 ↓
团队规模/规范要求？
  大团队，需要严格规范 → Redux Toolkit
  中小团队，快速开发 → Zustand
  原子化、细粒度响应（如表格编辑器） → Jotai
```

**Zustand 的优势原理**：

- 使用发布-订阅模式，只有订阅了变化字段的组件重渲染。
- `useStore(state => state.count)` 的 selector 函数使用 `Object.is` 浅比较，等价于自动 `React.memo`。

```javascript
// Zustand 示例（简洁无 boilerplate）
const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

// 精确订阅，只有 count 变化时重渲染
const count = useStore((state) => state.count);
```

</details>

---

**Q35. 从零设计一个 React 错误监控系统。**

<details>
<summary>参考答案</summary>

**完整架构**：

```
React 应用
    │
    ├─ Error Boundary（React 错误）
    │      └─ componentDidCatch → ErrorReporter.report()
    │
    ├─ window.onerror（JS 运行时错误）
    │      └─ ErrorReporter.report()
    │
    ├─ window.onunhandledrejection（未处理 Promise 拒绝）
    │      └─ ErrorReporter.report()
    │
    └─ 性能监控（React Profiler API）
           └─ onRender callback → PerformanceReporter
```

**ErrorReporter 核心实现**：

```typescript
interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;  // React 组件栈
  url: string;
  userAgent: string;
  timestamp: number;
  userId?: string;
  sessionId: string;
  severity: 'fatal' | 'error' | 'warning';
}

class ErrorReporter {
  private queue: ErrorReport[] = [];
  private sessionId = crypto.randomUUID();

  report(error: Error, componentStack?: string, severity = 'error' as const) {
    const report: ErrorReport = {
      message: error.message,
      stack: error.stack,
      componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      severity,
    };

    this.queue.push(report);
    this.flush();  // 批量上报
  }

  private flush = debounce(() => {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];

    // 使用 sendBeacon 确保页面关闭时也能上报
    navigator.sendBeacon('/api/errors', JSON.stringify(batch));
  }, 1000);
}

// 全局 Error Boundary
class AppErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    errorReporter.report(error, info.componentStack, 'fatal');
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />;
    return this.props.children;
  }
}
```

**关键设计决策**：

1. **批量上报**（debounce 1s）：减少请求数量，同时用 `sendBeacon` 保证页面卸载时不丢失。
2. **组件栈信息**：`componentDidCatch` 的 `info.componentStack` 精确定位出错组件。
3. **会话 ID**：关联同一用户会话的多个错误，还原用户操作路径。
4. **分级**：`fatal`（Error Boundary）/`error`（普通 JS 错误）/`warning`（性能警告）。

</details>
