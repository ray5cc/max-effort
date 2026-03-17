# React 核心原理与源码解析

> 基于 facebook/react 仓库深度解析 Fiber 架构、并发渲染、Hooks 实现、虚拟 DOM 及 React Compiler 的核心原理，从源码级别理解 React 的设计哲学。

## 相关链接

- 对应面试题：[React 核心面试题](../../02-面试指南/01-前端面试/01-React面试题.md)

## 目录

1. [Fiber 架构与协调算法](#1-fiber-架构与协调算法)
2. [并发渲染（Concurrent Rendering）](#2-并发渲染concurrent-rendering)
3. [Hooks 实现原理](#3-hooks-实现原理)
4. [虚拟 DOM 与渲染流程](#4-虚拟-dom-与渲染流程)
5. [React Compiler（React Forget）](#5-react-compilerreact-forget)
6. [React 19 与未来趋势](#6-react-19-与未来趋势)

---

## 1. Fiber 架构与协调算法

### 1.1 为何需要 Fiber？——Stack Reconciler 的瓶颈

React 16 之前使用**同步递归**的 Stack Reconciler：整棵组件树的 Diff 一旦开始就无法中断，主线程被长时间占据，导致动画卡顿（丢帧）。

```
Stack Reconciler（旧）：
  reconcile(root)
    └─ reconcile(child1)
         └─ reconcile(grandchild1)  ← 递归无法中断
              └─ ...（可能耗时 100ms+）

主线程时间轴：
  [JS 长任务 100ms] → [布局] → [绘制]
        ↑
  16ms 帧预算被严重超出，用户感知到卡顿
```

Fiber 的本质是**将递归改为可中断的迭代**：把渲染工作拆分成最小工作单元（Fiber Node），利用浏览器空闲时间（requestIdleCallback 思想，实际用 MessageChannel 模拟）逐步处理。

### 1.2 FiberNode 数据结构

源码位置：`packages/react-reconciler/src/ReactFiber.js`

```typescript
// 精简自 ReactFiber.js 中的 FiberNode 构造函数
function FiberNode(tag, pendingProps, key, mode) {
  // ─── 静态数据结构 ───────────────────────────────
  this.tag = tag; // 组件类型标记（FunctionComponent=0, ClassComponent=1, HostRoot=3...）
  this.key = key; // React key，用于 Diff
  this.elementType = null; // createElement 的第一个参数（组件函数/类/字符串）
  this.type = null; // 解析后的类型（lazy 组件会解析出实际类型）
  this.stateNode = null; // 关联的真实 DOM 节点或类组件实例

  // ─── Fiber 树链接 ───────────────────────────────
  this.return = null; // 父 Fiber（注意：不叫 parent，叫 return）
  this.child = null; // 第一个子 Fiber
  this.sibling = null; // 右侧兄弟 Fiber
  this.index = 0; // 在兄弟中的位置索引

  // ─── 动态工作单元 ────────────────────────────────
  this.pendingProps = pendingProps; // 本次渲染的新 props
  this.memoizedProps = null; // 上次渲染完成时的 props
  this.updateQueue = null; // 状态更新队列（useState/setState 的更新链表）
  this.memoizedState = null; // 上次渲染完成时的 state（Hook 链表的头节点）
  this.dependencies = null; // Context/EventSource 依赖列表

  // ─── 副作用 ──────────────────────────────────────
  this.flags = NoFlags; // 副作用标记（Placement|Update|Deletion 等）
  this.subtreeFlags = NoFlags; // 子树的副作用标记（优化：跳过无副作用子树）
  this.deletions = null; // 待删除的子 Fiber 列表

  // ─── 调度优先级 ──────────────────────────────────
  this.lanes = NoLanes; // 本 Fiber 挂起的更新优先级
  this.childLanes = NoLanes; // 子树中挂起的更新优先级

  // ─── 双缓冲 ──────────────────────────────────────
  this.alternate = null; // 指向另一棵树中对应的 Fiber 节点
}
```

**关键设计点**：

- `return` 而非 `parent`：因为 Fiber 完成工作后需要"返回"给父节点继续处理，与调用栈的返回语义一致。
- `subtreeFlags`：避免遍历没有副作用的子树，是 React 18 的重要优化。
- `alternate`：双缓冲树的核心，指向另一棵树中的对应节点。

### 1.3 双缓冲树（Double Buffering）

React 同时维护**两棵** Fiber 树，类比 Canvas 双缓冲技术：

```
                    ┌─────────────────────────────────────┐
  fiberRoot.current │                                     │
         │          ▼                                     │
         │    current 树（屏幕上显示的）                    │
         │    ┌──────────┐                                │
         │    │  rootFiber│◄── stateNode ──┐              │
         │    └──────────┘                │              │
         │         │ child                │              │
         │    ┌────▼─────┐               fiberRoot       │
         │    │   App    │◄── alternate ──►│              │
         │    └──────────┘                │              │
         │                                │              │
         └──────────────────────────►workInProgress 树   │
                                     (正在构建/可中断)     │
                                    ┌──────────┐         │
                                    │  rootFiber│        │
                                    └──────────┘         │
                                         │ child         │
                                    ┌────▼─────┐         │
                                    │   App    │         │
                                    └──────────┘         │
                                                         │
  commit 阶段完成后：fiberRoot.current 切换为 workInProgress 树 ┘
```

- **current 树**：当前屏幕上渲染的内容，`fiberRoot.current` 指向其根节点。
- **workInProgress 树（wip 树）**：Render 阶段正在构建的新树，每个节点通过 `alternate` 与 current 树对应节点互相引用。
- **切换时机**：Commit 阶段的 Mutation 子阶段完成后，`fiberRoot.current = finishedWork`，wip 树变为新的 current 树。

### 1.4 协调过程（Reconciliation）三阶段

源码入口：`packages/react-reconciler/src/ReactFiberWorkLoop.js`

```
performConcurrentWorkOnRoot(root)
         │
         ▼
  ┌─────────────────────────────────────┐
  │         Render 阶段（可中断）          │
  │                                     │
  │   workLoopConcurrent()              │
  │       while (workInProgress !== null│
  │           && !shouldYield()) {      │
  │         performUnitOfWork(wip)      │
  │       }                             │
  │                                     │
  │   ┌──── beginWork(wip) ────────┐    │
  │   │ 根据 tag 分发处理逻辑         │    │
  │   │ 对比 current 与 pendingProps │    │
  │   │ 返回下一个要处理的子 Fiber     │    │
  │   └────────────────────────────┘    │
  │                                     │
  │   ┌── completeWork(wip) ─────────┐  │
  │   │ 创建/更新 DOM 节点（HostComponent）│  │
  │   │ 收集副作用 flags 到父 Fiber    │  │
  │   │ 返回兄弟节点继续处理           │  │
  │   └────────────────────────────┘    │
  └─────────────────────────────────────┘
         │
         ▼
  ┌─────────────────────────────────────┐
  │         Commit 阶段（不可中断）        │
  │                                     │
  │   commitRoot(root)                  │
  │     ├─ Before Mutation（commitBeforeMutationEffects）│
  │     │    getSnapshotBeforeUpdate / useEffect cleanup│
  │     ├─ Mutation（commitMutationEffects）│
  │     │    insertBefore / appendChild / removeChild   │
  │     │    fiberRoot.current = finishedWork  ← 切换！ │
  │     └─ Layout（commitLayoutEffects）│
  │          componentDidMount/Update   │
  │          useLayoutEffect            │
  └─────────────────────────────────────┘
```

**beginWork** 源码 `ReactFiberBeginWork.js`：

```javascript
// 简化自源码
function beginWork(current, workInProgress, renderLanes) {
  switch (workInProgress.tag) {
    case FunctionComponent: {
      const Component = workInProgress.type;
      return updateFunctionComponent(current, workInProgress, Component, ...);
    }
    case ClassComponent:
      return updateClassComponent(current, workInProgress, ...);
    case HostComponent:  // 原生 DOM 节点如 <div>
      return updateHostComponent(current, workInProgress, renderLanes);
    // ... 其他 tag 处理
  }
}
```

### 1.5 Diff 算法

React 的 Diff 基于三个假设（启发式策略），将 O(n³) 降为 O(n)：

1. 不同类型的节点产生不同树（直接删除旧树，创建新树）
2. `key` 属性可以标识跨位置的稳定节点
3. 同层节点才比较（不跨层）

#### 单节点 Diff

新子节点只有一个时（`reconcileSingleElement`）：

```
旧子节点列表     新子节点
  key=A           key=A   → 复用，更新 props
  key=B      ×
  key=C      ×

  key=A      ×
  key=B           key=B   → 删除 A，复用 B，删除 C
  key=C      ×

  key=A      ×
  key=B      ×    key=D   → 全部删除，新建 D
  key=C      ×
```

#### 多节点 Diff（两轮遍历）

`reconcileChildrenArray` 采用**两轮遍历**策略：

**第一轮**：从头遍历，处理节点更新（不移动位置）：

```
oldFibers: A  B  C  D  E
newElements: A  B  E  C  D

第一轮比较（按位置）：
  i=0: A↔A → 可复用 ✓
  i=1: B↔B → 可复用 ✓
  i=2: C↔E → key 不同，停止第一轮
```

**第二轮**：将剩余旧节点存入 `Map`，遍历剩余新节点：

```
剩余旧节点 Map: { C:fiberC, D:fiberD, E:fiberE }
继续遍历新节点:
  E → Map 中找到，复用。E 的 oldIndex=4，lastPlacedIndex=1（上次放置的最远旧索引）
      oldIndex(4) >= lastPlacedIndex(1)，不需移动，更新 lastPlacedIndex=4
  C → Map 中找到，复用。C 的 oldIndex=2
      oldIndex(2) < lastPlacedIndex(4)，需要移动！标记 Placement
  D → Map 中找到，复用。D 的 oldIndex=3
      oldIndex(3) < lastPlacedIndex(4)，需要移动！标记 Placement
```

**最终操作**：E 不动，C 和 D 移动到 E 后面。React 只做 DOM 移动，不重新创建。

---

## 2. 并发渲染（Concurrent Rendering）

### 2.1 Lane 优先级模型

源码位置：`packages/react-reconciler/src/ReactFiberLane.js`

React 18 用**位运算**实现优先级，一个 Lane 就是一个 32 位整数的某些位：

```javascript
// 源码中的 Lane 定义（精简）
export const NoLanes = 0b0000000000000000000000000000000;
export const SyncLane = 0b0000000000000000000000000000001; // 同步（最高优先级）
export const InputContinuousLane = 0b0000000000000000000000000000100; // 连续输入（滚动）
export const DefaultLane = 0b0000000000000000000000000010000; // 默认（fetch 回调）
export const TransitionLane1 = 0b0000000000000000000000001000000; // startTransition
// ... 共 31 个 Lane

// Lanes 是多个 Lane 的集合（OR 运算）
export const InputContinuousLanes = SyncLane | InputContinuousLane;
```

位运算的优势：

```javascript
// 判断是否包含某 Lane（比较操作）
function includesSomeLane(a, b) {
  return (a & b) !== NoLanes;
}

// 合并多个优先级（OR）
function mergeLanes(a, b) {
  return a | b;
}

// 移除某个优先级（AND NOT）
function removeLanes(set, subset) {
  return set & ~subset;
}
```

**Lane 与用户行为的对应关系**：

| 用户行为                          | Lane             | 调度优先级       |
| --------------------------------- | ---------------- | ---------------- |
| `onClick`/`onChange`              | `SyncLane`       | 同步，不可中断   |
| `useTransition`/`startTransition` | `TransitionLane` | 低优先级，可中断 |
| `useDeferredValue`                | `TransitionLane` | 可被高优先级打断 |
| `setTimeout` 内的 setState        | `DefaultLane`    | 正常调度         |
| `requestIdleCallback` 内          | `IdleLane`       | 最低优先级       |

### 2.2 时间切片（Time Slicing）

源码位置：`packages/scheduler/src/forks/Scheduler.js`

React 不直接用 `requestIdleCallback`（兼容性差、帧率固定），而是用 **MessageChannel** 模拟：

```javascript
// 源码中的调度器核心（精简）
let schedulePerformWorkUntilDeadline;

// 优先使用 MessageChannel（高精度，不受 setTimeout 4ms 最小延迟限制）
const channel = new MessageChannel();
const port = channel.port2;
channel.port1.onmessage = performWorkUntilDeadline;
schedulePerformWorkUntilDeadline = () => {
  port.postMessage(null);  // 在下一个宏任务执行
};

// 每次宏任务的时间预算：5ms（一帧 16.67ms，留余量给浏览器渲染）
const frameYieldMs = 5;
let deadline = 0;

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameYieldMs) return false;  // 预算内，继续
  // 检查是否有待处理的用户输入（如果有，立即让出）
  if (needsPaint || scheduling.isInputPending?.(['mousemove', 'mousedown', ...])) {
    return true;
  }
  return timeElapsed >= continuousYieldMs;  // 超过 50ms 无论如何让出
}
```

**时间切片工作流**：

```
主线程时间轴：
┌─────────────────────────────────────────────────────────────┐
│  宏任务1（5ms）   │  浏览器处理  │  宏任务2（5ms）  │  ...    │
│  renderA fibers  │  渲染/输入   │  renderA续 ...  │         │
│  shouldYield→true│             │  shouldYield→...│         │
└─────────────────────────────────────────────────────────────┘

Scheduler 任务队列（最小堆，按 sortIndex/过期时间排序）：
  [Task1: expirationTime=100ms, callback=performConcurrentWork]
  [Task2: expirationTime=200ms, callback=flushPassiveEffects]
  [Task3: expirationTime=∞,    callback=lowPriorityWork]
```

### 2.3 Scheduler 任务队列（小顶堆）

源码 `packages/scheduler/src/forks/Scheduler.js`：

```javascript
// 任务定义
var taskQueue = []; // 已到期任务（min-heap，按 expirationTime 排序）
var timerQueue = []; // 未到期任务（min-heap，按 startTime 排序）

// 入堆（push）
function push(heap, node) {
  const index = heap.length;
  heap.push(node);
  siftUp(heap, node, index); // 上浮调整堆
}

// 堆顶（peek）
function peek(heap) {
  return heap.length === 0 ? null : heap[0];
}

// 出堆（pop）
function pop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (last !== first) {
    heap[0] = last;
    siftDown(heap, last, 0); // 下沉调整堆
  }
  return first;
}
```

### 2.4 startTransition 与 useDeferredValue

```javascript
// startTransition 源码（packages/react/src/ReactStartTransition.js）
export function startTransition(scope, options) {
  const prevTransition = ReactSharedInternals.T;
  // 设置当前正在执行 transition
  ReactSharedInternals.T = {};
  try {
    scope(); // 执行回调，其中的 setState 会被打上 TransitionLane
  } finally {
    ReactSharedInternals.T = prevTransition;
  }
}

// useDeferredValue 的实现原理（ReactFiberHooks.js）：
// 1. 首次渲染：直接返回传入的 value
// 2. 更新时：先用旧值渲染（高优先级），再以 TransitionLane 调度一次用新值的渲染
// 这样紧急更新（如输入框）立刻显示，延迟值（如搜索结果）稍后更新
```

---

## 3. Hooks 实现原理

### 3.1 Hook 链表结构

源码位置：`packages/react-reconciler/src/ReactFiberHooks.js`

每个函数组件的所有 Hook 以**单向链表**形式存储在 `fiber.memoizedState` 上：

```
FiberNode.memoizedState
    │
    ▼
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│ Hook (useState)     │─next─►│ Hook (useEffect)    │─next─►│ Hook (useMemo)     │─next─► null
│  memoizedState: 0   │      │  memoizedState:     │      │  memoizedState:     │
│  queue: UpdateQueue │      │   { create, deps,   │      │   [value, deps]     │
│  baseState: 0       │      │     destroy, tag }  │      │                     │
│  baseQueue: null    │      │  queue: EffectList  │      │                     │
└─────────────────────┘      └─────────────────────┘      └─────────────────────┘
```

**规则"不能在条件语句中使用 Hook"的根本原因**：React 通过**链表顺序**标识每个 Hook 的状态。若条件语句导致某次渲染跳过了一个 Hook，链表的对应关系就会错位，读取到错误的状态。

### 3.2 Dispatcher 模式

源码位置：`packages/react/src/ReactHooks.js`

所有 Hook API（`useState`、`useEffect` 等）通过 `resolveDispatcher()` 分发：

```javascript
// packages/react/src/ReactHooks.js
function resolveDispatcher() {
  const dispatcher = ReactSharedInternals.H; // H = current dispatcher
  // ReactSharedInternals 是 react 和 react-reconciler 包的共享内部状态
  return dispatcher;
}

export function useState(initialState) {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState); // 委托给当前 dispatcher
}

export function useEffect(create, deps) {
  const dispatcher = resolveDispatcher();
  return dispatcher.useEffect(create, deps);
}
```

Dispatcher 在不同阶段切换：

```javascript
// ReactFiberHooks.js 中的 dispatcher 切换逻辑
function renderWithHooks(current, workInProgress, Component, props, ...) {
  if (current !== null && current.memoizedState !== null) {
    // update 阶段
    ReactSharedInternals.H = HooksDispatcherOnUpdate;
  } else {
    // mount 阶段
    ReactSharedInternals.H = HooksDispatcherOnMount;
  }

  // 调用函数组件，此时 Hook 调用会路由到正确的 dispatcher
  const children = Component(props, secondArg);

  // 渲染完成后切换为无效 dispatcher，防止在渲染外调用 Hook
  ReactSharedInternals.H = ContextOnlyDispatcher;
}
```

Dispatcher 对象：

```javascript
const HooksDispatcherOnMount = {
  useState: mountState,
  useEffect: mountEffect,
  useMemo: mountMemo,
  // ...
};

const HooksDispatcherOnUpdate = {
  useState: updateState,
  useEffect: updateEffect,
  useMemo: updateMemo,
  // ...
};
```

### 3.3 useState 实现：mountState vs updateState

**mountState**（首次渲染）：

```javascript
// 源码精简自 ReactFiberHooks.js
function mountState(initialState) {
  // 创建新 Hook 节点，追加到链表末尾
  const hook = mountWorkInProgressHook();

  // 处理 initialState 函数形式（惰性初始化）
  if (typeof initialState === "function") {
    initialState = initialState();
  }

  hook.memoizedState = hook.baseState = initialState;

  // 创建更新队列
  const queue = {
    pending: null, // 待处理的 Update 环形链表
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer, // (state, action) => action
    lastRenderedState: initialState,
  };
  hook.queue = queue;

  // dispatch 函数绑定到当前 fiber 和 queue
  const dispatch = (queue.dispatch = dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ));
  return [hook.memoizedState, dispatch];
}
```

**updateState**（后续渲染，处理 bailout 优化）：

```javascript
function updateState(initialState) {
  return updateReducer(basicStateReducer, initialState);
}

function updateReducer(reducer, initialArg) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;

  // 处理待执行的 Update 链表（可能有多次 setState 累积）
  let baseQueue = hook.baseQueue;
  const pendingQueue = queue.pending;

  if (pendingQueue !== null) {
    // 将 pending 链表接入 baseQueue（环形链表转线性）
    // ...
  }

  // 遍历 Update 链表，计算新 state
  let newState = hook.baseState;
  let update = baseQueue.next; // 从链表头开始
  do {
    if (!isSubsetOfLanes(renderLanes, update.lane)) {
      // 优先级不够，跳过此 update，保留到下次渲染
    } else {
      newState = reducer(newState, update.action); // 应用 update
    }
    update = update.next;
  } while (update !== null && update !== baseQueue.next);

  // Bailout 优化：如果 state 没有变化，跳过渲染
  if (Object.is(newState, hook.memoizedState)) {
    return [newState, queue.dispatch]; // 直接返回，不触发重渲染
  }

  hook.memoizedState = newState;
  return [hook.memoizedState, queue.dispatch];
}
```

### 3.4 useEffect vs useLayoutEffect 执行时机

```
Commit 阶段时间轴：
                                   ┌─── fiberRoot.current 切换 ───┐
                                   │                              │
  Before Mutation   │   Mutation   │         Layout               │   (异步)
  ─────────────────────────────────│──────────────────────────────│────────────
  getSnapshot       │  DOM 变更    │  useLayoutEffect cleanup      │  useEffect cleanup
  scheduleEffect    │  (插入/删除) │  componentDidMount/Update     │  useEffect create
                    │             │  useLayoutEffect create        │  (通过 Scheduler 调度)
                    │             │  ref 赋值                      │

  同步执行（阻塞浏览器绘制）       │  同步执行（阻塞浏览器绘制）  │  浏览器绘制后异步执行
```

**useLayoutEffect**：

- 在 DOM 变更完成后、浏览器绘制前**同步执行**。
- 适用场景：需要在绘制前读取/修改 DOM（如计算滚动位置、避免闪烁）。
- 类比 `componentDidMount`/`componentDidUpdate`。

**useEffect**：

- 通过 Scheduler 调度，在浏览器绘制**完成后**异步执行。
- 不阻塞主线程，适合大多数副作用（数据获取、事件监听）。

源码中 `useEffect` 的调度（`ReactFiberCommitWork.js`）：

```javascript
// commitRootImpl 末尾
scheduleCallback(NormalSchedulerPriority, () => {
  flushPassiveEffects(); // 执行 useEffect
  return null;
});
```

### 3.5 useMemo/useCallback 依赖比较

`areHookInputsEqual` 函数（`ReactFiberHooks.js`）：

```javascript
function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) return false; // 首次渲染，不相等

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false; // 找到不相等的依赖，重新计算
  }
  return true; // 所有依赖都相等，使用缓存
}
```

`Object.is` 与 `===` 的区别：

- `NaN === NaN` → `false`，`Object.is(NaN, NaN)` → `true`
- `+0 === -0` → `true`，`Object.is(+0, -0)` → `false`

因此 React 对 `NaN` 依赖的处理是**正确**的（值没变，不重新计算）。

---

## 4. 虚拟 DOM 与渲染流程

### 4.1 JSX → ReactElement

JSX 经 Babel 编译后调用 `React.createElement`（新版本用 `jsx` 函数）：

```jsx
// 编译前
const element = (
  <div className="app">
    <h1>Hello</h1>
  </div>
);

// 编译后（React 17+ 自动引入 jsx runtime）
import { jsx as _jsx } from "react/jsx-runtime";
const element = _jsx("div", {
  className: "app",
  children: _jsx("h1", { children: "Hello" }),
});
```

`ReactElement` 对象结构（`packages/react/src/jsx/ReactJSXElement.js`）：

```javascript
{
  $$typeof: Symbol(react.element),  // 防 XSS，JSON 中不能序列化 Symbol
  type: "div",                       // 字符串/函数组件/类组件
  key: null,
  ref: null,
  props: {
    className: "app",
    children: { type: "h1", props: { children: "Hello" }, ... }
  }
}
```

### 4.2 完整渲染流水线

```
用户代码                    React 内部
─────────────────────────────────────────────────────────────────
<App />                     创建 ReactElement（虚拟 DOM 描述对象）
   │
   ▼
ReactDOM.createRoot(div)    创建 FiberRootNode，设置容器
   │
   ▼
root.render(<App />)
   │
   ▼
scheduleUpdateOnFiber()     触发更新，根据上下文决定 Lane
   │
   ▼
ensureRootIsScheduled()     将渲染任务提交给 Scheduler 队列
   │
   ▼ (Scheduler 调度，可能在下一个宏任务执行)
performConcurrentWorkOnRoot()
   │
   ├── Render 阶段 ──────── workLoopConcurrent()
   │   │                   每 5ms 检查 shouldYield()，可中断
   │   │
   │   ├── beginWork()      深度优先，处理每个 Fiber 节点
   │   │   ├── 对比 current 与 pendingProps，决定是否复用
   │   │   ├── 调用函数组件/render()，生成子 ReactElement
   │   │   └── reconcileChildren()，Diff 子节点，打上 flags
   │   │
   │   └── completeWork()   回溯，处理 HostComponent
   │       ├── 创建真实 DOM 节点（mount 时）
   │       ├── 设置 DOM 属性、事件监听
   │       └── 将 flags 归并到父 Fiber.subtreeFlags
   │
   └── Commit 阶段 ─────── commitRoot()，同步执行
       ├── Before Mutation   读取 DOM 快照
       ├── Mutation          真正修改 DOM
       └── Layout            同步副作用（useLayoutEffect）
           │
           └── (异步) flushPassiveEffects()  useEffect
```

### 4.3 Commit 三子阶段详解

**Before Mutation** (`commitBeforeMutationEffects`)：

- 调用 `getSnapshotBeforeUpdate`（类组件）
- 调度 `useEffect` 的 cleanup（异步）

**Mutation** (`commitMutationEffects`)：

- 处理 `Deletion` flag：移除 DOM 节点，调用 `useLayoutEffect` cleanup 和 `componentWillUnmount`
- 处理 `Placement` flag：`insertBefore`/`appendChild` 插入 DOM
- 处理 `Update` flag：更新 DOM 属性
- **此处**：`fiberRoot.current = finishedWork`（切换双缓冲树）

**Layout** (`commitLayoutEffects`)：

- 调用 `componentDidMount`/`componentDidUpdate`（类组件）
- 执行 `useLayoutEffect` 的 create 回调
- 赋值 `ref`（`ref.current = DOM 节点`）

源码路径：`packages/react-reconciler/src/ReactFiberCommitWork.js`

---

## 5. React Compiler（React Forget）

### 5.1 背景与动机

手动 `useMemo`/`useCallback`/`React.memo` 的问题：

1. **认知负担高**：需要开发者手动判断哪些值需要缓存
2. **容易遗漏**：忘记 memoize 导致子组件不必要重渲染
3. **依赖数组维护**：deps 不正确导致 stale closure 或过度重渲染

React Compiler（原名 React Forget）在**编译时**自动插入等价的 `useMemo`/`useCallback`，实现"零运行时开销的自动优化"。

### 5.2 编译原理

源码位置：`compiler/packages/babel-plugin-react-compiler/`

编译器的核心流程：

```
源码 JSX/TSX
     │
     ▼
 Babel Parse     → AST（抽象语法树）
     │
     ▼
 React Compiler  ────────────────────────────────────────────────
     │
     ├── HIR（High-level IR）构建    分析控制流、函数边界
     │
     ├── 别名分析（Alias Analysis）  检测变量是否被修改/转义
     │
     ├── 效果分析（Effect Analysis）  判断副作用范围
     │
     ├── 反应性分析（Reactivity Analysis）
     │       确定哪些值是"响应式"的（依赖 props/state）
     │       以及哪些值可以被安全缓存
     │
     └── 代码生成                     插入 useMemo/useCallback/React.memo
     │
     ▼
 优化后的 JSX/TSX（语义等价）
```

**编译示例**：

```javascript
// 开发者编写的原始代码
function TodoList({ todos, filter }) {
  const visibleTodos = todos.filter((todo) => todo.status === filter);
  return (
    <ul>
      {visibleTodos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}

// React Compiler 输出（伪代码，实际更复杂）
function TodoList({ todos, filter }) {
  const $ = useMemoCache(3); // 编译器分配的缓存槽

  let visibleTodos;
  if ($[0] !== todos || $[1] !== filter) {
    visibleTodos = todos.filter((todo) => todo.status === filter);
    $[0] = todos;
    $[1] = filter;
    $[2] = visibleTodos;
  } else {
    visibleTodos = $[2]; // 缓存命中
  }

  return (
    <ul>
      {visibleTodos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}
```

### 5.3 编译时 vs 运行时优化对比

| 维度         | 运行时（手动 useMemo） | 编译时（React Compiler）       |
| ------------ | ---------------------- | ------------------------------ |
| **开发体验** | 需手动判断、维护 deps  | 自动，零额外代码               |
| **精确度**   | 依赖开发者判断         | 编译器静态分析，更精确         |
| **适用范围** | 任意 React 版本        | 需要支持 Compiler 的构建工具链 |
| **调试难度** | 直观，源码可见         | 需要 Compiler DevTools         |
| **规避问题** | 可手动控制跳过         | 需满足 Rules of React 才能优化 |

### 5.4 Rules of React（编译器前提）

React Compiler 要求代码遵循 **Rules of React**，否则跳过优化（不会报错，只是不优化）：

1. **纯函数**：相同输入必须产生相同输出，无副作用
2. **不修改 props/state**：直接 mutate 会导致别名分析失败
3. **正确使用 Hook**：不在条件/循环中调用 Hook

```javascript
// ❌ 无法被编译器优化（mutate props）
function BadComponent({ items }) {
  items.push(newItem); // 修改了 props！
  return <List items={items} />;
}

// ✅ 可以被优化（创建新数组）
function GoodComponent({ items }) {
  const newItems = [...items, newItem];
  return <List items={newItems} />;
}
```

### 5.5 useMemoCache 内部实现

编译器生成的代码依赖 `react` 包内部的 `useMemoCache` Hook：

```javascript
// packages/react-reconciler/src/ReactFiberHooks.js（精简）
function useMemoCache(size) {
  let memoCache = null;
  const updateQueue = currentlyRenderingFiber.updateQueue;
  if (updateQueue !== null) {
    memoCache = updateQueue.memoCache;
  }

  if (memoCache == null) {
    // 首次渲染：分配固定大小的缓存数组
    memoCache = { data: [], index: 0 };
    if (updateQueue !== null) {
      updateQueue.memoCache = memoCache;
    }
  }

  let data = memoCache.data[memoCache.index];
  if (data === undefined) {
    // 初始化缓存槽，用 Symbol 表示"未缓存"
    data = new Array(size).fill(REACT_MEMO_CACHE_SENTINEL);
    memoCache.data[memoCache.index] = data;
  }
  memoCache.index++;
  return data;
}
```

---

## 6. React 19 与未来趋势

### 为什么关注这个

React 18 引入了并发渲染的基础设施，但许多开发者的日常体验变化有限——你仍然在手写 `useEffect` 处理数据获取，用 `<Helmet>` 管理 `<title>`，用第三方库做乐观更新。**React 19（2024 年底正式发布，2025-2026 年生态全面适配）** 是自 Hooks 以来最大的 API 变革，它把这些"本该是框架职责"的事情收归核心。

> **类比**：如果 React 18 是给高速公路铺好了路基（并发能力），React 19 就是在路基上架好了收费站、服务区和导航系统，让司机（开发者）不再需要自备这些设施。

### 6.1 `use` Hook——在渲染中读取 Promise 和 Context

`use` 是 React 19 唯一"可以在条件语句中调用"的 Hook，它能直接读取 Promise 或 Context。

```jsx
import { use, Suspense } from "react";

// 在组件外创建 Promise（通常来自框架或缓存层）
const userPromise = fetchUser(userId);

function UserProfile() {
  // use 会在 Promise 未 resolve 时抛出，触发最近的 <Suspense> fallback
  const user = use(userPromise);

  // 条件读取 Context——以前 useContext 做不到
  if (user.isAdmin) {
    const theme = use(ThemeContext);
    return <AdminPanel theme={theme} user={user} />;
  }
  return <UserDashboard user={user} />;
}

// 使用
<Suspense fallback={<Skeleton />}>
  <UserProfile />
</Suspense>;
```

**与 useEffect + useState 数据获取模式对比**：

| 方面       | React 18（useEffect 模式）                    | React 19（use + Suspense）     |
| ---------- | --------------------------------------------- | ------------------------------ |
| 代码量     | 需要 loading/error/data 三个状态              | 一行 `use(promise)`            |
| 瀑布流问题 | 父组件 useEffect → 子组件 useEffect，串行请求 | Promise 在渲染前创建，并行获取 |
| 服务端渲染 | 需要 useEffect 在客户端重新获取               | Suspense 与 SSR 深度集成       |
| 错误处理   | try-catch 或 .catch()                         | ErrorBoundary 自动捕获         |

### 6.2 Actions 与 `useActionState`——表单处理的终极方案

React 19 引入 **Actions** 概念：任何使用 `async` 转换（transition）的函数都是 Action。配合 `useActionState`，表单处理变得极其简洁。

```jsx
import { useActionState } from "react";

async function submitOrder(prevState, formData) {
  const name = formData.get("name");
  const address = formData.get("address");

  // 服务端校验
  const result = await createOrder({ name, address });
  if (result.error) {
    return { error: result.error, success: false };
  }
  return { error: null, success: true, orderId: result.id };
}

function OrderForm() {
  const [state, formAction, isPending] = useActionState(submitOrder, {
    error: null,
    success: false,
  });

  return (
    <form action={formAction}>
      <input name="name" required />
      <input name="address" required />
      <button disabled={isPending}>{isPending ? "提交中..." : "下单"}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.success && <p>订单 {state.orderId} 已创建！</p>}
    </form>
  );
}
```

> **关键**：`<form action={formAction}>` 是 React 19 对 HTML `<form>` 的增强——action 可以是 async 函数，React 自动管理 pending 状态。

### 6.3 `useOptimistic`——乐观更新

在社交应用中点赞、购物车修改数量等场景，用户不想等服务端响应才看到 UI 变化。`useOptimistic` 让你在请求发出的同时立即显示预期结果，失败时自动回滚。

```jsx
import { useOptimistic } from "react";

function MessageList({ messages, sendMessage }) {
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    // 乐观更新函数：描述"如果成功了 UI 应该长什么样"
    (currentMessages, newMessage) => [
      ...currentMessages,
      { text: newMessage, sending: true },
    ],
  );

  async function handleSend(formData) {
    const text = formData.get("message");
    addOptimistic(text); // 立即显示（乐观）
    await sendMessage(text); // 实际请求
    // 成功后 messages prop 更新，sending: true 消失
    // 失败则自动回滚到 messages
  }

  return (
    <>
      {optimisticMessages.map((msg, i) => (
        <div key={i} style={{ opacity: msg.sending ? 0.6 : 1 }}>
          {msg.text} {msg.sending && "⏳"}
        </div>
      ))}
      <form action={handleSend}>
        <input name="message" />
        <button>发送</button>
      </form>
    </>
  );
}
```

### 6.4 文档元数据——组件内管理 `<title>` / `<meta>` / `<link>`

以前需要 `react-helmet` 或框架特定方案管理 `<head>` 内容。React 19 原生支持在组件内渲染 `<title>`、`<meta>`、`<link>`，React 自动提升（hoist）到 `<head>` 中。

```jsx
function BlogPost({ post }) {
  return (
    <article>
      {/* React 19 自动提升到 <head> */}
      <title>{post.title} - My Blog</title>
      <meta name="description" content={post.excerpt} />
      <link rel="canonical" href={`https://blog.com/${post.slug}`} />

      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}
```

### 6.5 资源预加载——组件内声明 `<link rel="preload">`

```jsx
import { prefetchDNS, preconnect, preload, preinit } from "react-dom";

function CriticalPage() {
  // 这些调用会提升到 <head>，在页面加载早期执行
  preinit("/critical.js", { as: "script" }); // 预加载 + 执行
  preload("/hero.webp", { as: "image" }); // 预加载（不执行）
  preconnect("https://api.example.com"); // DNS + TCP + TLS
  prefetchDNS("https://cdn.example.com"); // 仅 DNS

  return <div>...</div>;
}
```

### 6.6 React Server Components 成熟度（2026）

| 维度       | 2024 状态                                    | 2026 状态                                 |
| ---------- | -------------------------------------------- | ----------------------------------------- |
| 框架支持   | Next.js App Router（实验性）                 | Next.js / Remix / Waku 全面支持           |
| 打包工具   | 仅 Next.js 自带打包                          | Rspack / Turbopack / Vite 均支持 RSC 协议 |
| 数据库直连 | 可行但生态不成熟                             | Drizzle / Prisma 有官方 RSC 适配层        |
| 流式渲染   | 支持但边界情况多                             | 稳定、错误恢复机制完善                    |
| 开发者体验 | `'use client'` / `'use server'` 边界容易混淆 | IDE 插件自动标注、编译器报错更友好        |

### 6.7 React Compiler 进展

React Compiler（已在[第 5 节](#5-react-compilerreact-forget)详细介绍）在 2025-2026 年进入稳定阶段：

- Meta 内部已在 Instagram Web 全面部署
- 与 React 19 配合后，`useMemo`、`useCallback`、`React.memo` 基本可以移除
- 支持 Vite / Rspack / Next.js 等主流构建工具的 Babel 插件集成

### 6.8 React 18 vs 19 关键变化对照表

| 特性         | React 18                                | React 19                                  |
| ------------ | --------------------------------------- | ----------------------------------------- |
| 数据获取     | useEffect + useState 手动管理           | `use(promise)` + Suspense                 |
| 表单处理     | onChange + onSubmit + 手动 pending 状态 | `<form action>` + `useActionState`        |
| 乐观更新     | 手动实现回滚逻辑                        | `useOptimistic` 内置                      |
| 文档元数据   | react-helmet / next/head                | 原生 `<title>` `<meta>` `<link>`          |
| 资源预加载   | 手动在 HTML 中添加                      | `preload` / `preinit` API                 |
| `ref` 传递   | 需要 `forwardRef` 包裹                  | props 直接传 `ref`（forwardRef 不再需要） |
| Context 使用 | `<Context.Provider>`                    | `<Context>` 直接作为 Provider             |
| 错误处理     | 有限的 ErrorBoundary                    | 改进的错误报告 + 重试机制                 |
| Compiler     | 实验性                                  | 稳定，Meta 生产部署                       |

### 6.9 常见陷阱与最佳实践

1. **不要在渲染中创建新 Promise 传给 `use`**——每次渲染都会创建新 Promise，导致无限请求。应在组件外部或通过缓存层创建。
2. **Actions 与 Server Actions 的区别**——Actions 是客户端概念（async transition），Server Actions 是 RSC 框架的概念（`'use server'` 标记的函数）。
3. **`useOptimistic` 的回滚时机**——当传入的"真实数据"（第一个参数）更新时自动回滚，不是 Promise reject 触发的。
4. **渐进式迁移**——React 19 向后兼容 React 18 的 API，无需一次性重写。优先在新功能中采用新 API。

---

## 附录：关键源码文件索引

| 文件                                                      | 核心内容                                 |
| --------------------------------------------------------- | ---------------------------------------- |
| `packages/react/src/ReactHooks.js`                        | Hook 公开 API，`resolveDispatcher()`     |
| `packages/react-reconciler/src/ReactFiber.js`             | `FiberNode` 构造函数，Fiber 数据结构     |
| `packages/react-reconciler/src/ReactFiberHooks.js`        | Hook 完整实现（mount/update dispatcher） |
| `packages/react-reconciler/src/ReactFiberBeginWork.js`    | Render 阶段向下递归，Diff 子节点         |
| `packages/react-reconciler/src/ReactFiberCompleteWork.js` | Render 阶段向上回溯，创建 DOM            |
| `packages/react-reconciler/src/ReactFiberCommitWork.js`   | Commit 三子阶段，真实 DOM 操作           |
| `packages/react-reconciler/src/ReactFiberWorkLoop.js`     | 工作循环，`performConcurrentWorkOnRoot`  |
| `packages/react-reconciler/src/ReactFiberLane.js`         | Lane 优先级模型，位运算操作              |
| `packages/scheduler/src/forks/Scheduler.js`               | 任务调度器，小顶堆，`shouldYieldToHost`  |
| `compiler/packages/babel-plugin-react-compiler/`          | React Compiler Babel 插件                |
