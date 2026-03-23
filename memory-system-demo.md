# 记忆系统演示文档

> 本文档展示新的记忆优化颜色系统在实际文档中的应用效果

## 核心概念示例

::: concept 核心概念：React Fiber 架构
Fiber 是 React 16 引入的新协调引擎，将原本递归不可中断的渲染过程改造为可中断的链表遍历，使得高优先级任务（如用户输入）能够打断低优先级任务（如列表渲染）。

**类比**：就像操作系统的进程调度，可以随时暂停一个进程去执行更重要的任务，而不是必须等它全部完成。
:::

## 警告陷阱示例

::: warning ❌ 常见陷阱：useEffect 无限循环
```javascript
// ❌ 错误：依赖数组缺失导致每次渲染都触发
useEffect(() => {
  setData(fetchData())
})

// ✅ 正确：明确依赖，只在 id 变化时执行
useEffect(() => {
  setData(fetchData())
}, [id])
```

如果不指定依赖数组，useEffect 会在每次组件渲染后执行，导致状态更新 → 重新渲染 → 再次执行的死循环。
:::

## 实践案例示例

::: practice 实践案例：优化大列表渲染
使用虚拟滚动库 `react-window` 优化 10 万条数据的列表：

```typescript
import { FixedSizeList } from 'react-window'

const Row = ({ index, style }) => (
  <div style={style}>Row {index}</div>
)

<FixedSizeList
  height={600}
  itemCount={100000}
  itemSize={35}
  width="100%"
>
  {Row}
</FixedSizeList>
```

虚拟滚动只渲染可见区域的元素，将 DOM 节点数量从 10 万个降低到约 20 个，性能提升 5000 倍。
:::

## 提示技巧示例

::: tip 💡 面试技巧
回答 Fiber 原理时，按照"问题→方案→实现"的三段论结构讲述：

1. **问题**：React 15 递归渲染导致主线程长时间阻塞，用户输入响应延迟
2. **方案**：引入时间切片（Time Slicing），实现可中断的渲染
3. **实现**：Fiber 数据结构（链表） + 双缓冲树（current/workInProgress） + 优先级调度（Scheduler）

这种结构化表达能让面试官快速理解你对问题的深度思考。
:::

## 自测回忆示例

::: recall 自测：React 18 并发特性
在继续阅读前，先尝试用自己的话回答：
1. React 18 的并发模式解决了什么问题？
2. `startTransition` 的作用是什么？
3. 自动批处理（Automatic Batching）的原理是什么？
:::

## 交互式自测组件

<RecallBlock title="自测：Fiber 架构的核心目标">
  <template #question>

**问题 1**：Fiber 解决了 React 的哪个核心问题？

**问题 2**：Fiber 数据结构相比递归调用栈的优势是什么？

**问题 3**：什么是时间切片（Time Slicing）？

提示：从"可中断性"的角度思考这三个问题。
  </template>
  <template #answer>

**答案 1**：Fiber 解决了 React 15 递归渲染不可中断的问题。在 React 15 中，一旦开始协调（Reconciliation），就必须一次性处理完整个组件树，期间主线程被完全占用，导致用户输入、动画等高优先级任务无法响应。

**答案 2**：Fiber 采用链表结构，每个节点包含 `child`、`sibling`、`return` 指针，可以随时保存当前进度并暂停。而递归调用栈一旦开始就无法中断，必须等待整个调用栈清空。

**答案 3**：时间切片是将长时间任务拆分成多个小片段，在每个片段执行完后检查是否有更高优先级任务（如用户点击）需要处理。如果有，就先暂停当前任务，处理高优先级任务后再继续。

**类比**：就像看书时可以随时用书签标记当前页码，去处理其他事情，回来后继续从标记处读起。而递归就像必须一口气读完整本书，中途不能停。

**延伸**：React 18 引入了并发渲染（Concurrent Rendering），进一步增强了时间切片能力，允许同时准备多个版本的 UI，根据优先级决定最终提交哪个版本。
  </template>
</RecallBlock>

## 多个知识点串联

### 1. Fiber 的数据结构

::: concept 核心数据结构
```typescript
type Fiber = {
  type: any,              // 组件类型（函数/类/原生标签）
  key: null | string,     // 列表中的唯一标识

  // 链表指针
  child: Fiber | null,    // 第一个子节点
  sibling: Fiber | null,  // 下一个兄弟节点
  return: Fiber | null,   // 父节点

  // 状态
  pendingProps: any,      // 新的 props
  memoizedProps: any,     // 上次渲染的 props
  memoizedState: any,     // 上次渲染的 state

  // 副作用
  flags: Flags,           // 副作用标记（插入/更新/删除）

  // 双缓冲
  alternate: Fiber | null // 指向另一棵树中的对应节点
}
```
:::

### 2. 双缓冲机制

::: tip 类比：双缓冲 = 画家的两块画布
想象画家有两块画布：
- **画布 A（current）**：正在展览的完成作品
- **画布 B（workInProgress）**：正在创作的新版本

观众看到的始终是画布 A。当画布 B 完成后，瞬间切换展出画布 B，同时画布 A 变成新的工作画布。

React 同样维护两棵 Fiber 树：
- `current` 树：当前屏幕显示的内容
- `workInProgress` 树：正在构建的新版本

提交（Commit）阶段只是修改指针，让 `current` 指向新树，O(1) 时间复杂度。
:::

### 3. 常见误区

::: warning ❌ 误区：Fiber 提升了渲染性能
很多人认为 Fiber 让 React 变快了，这是误解。

**真相**：Fiber 的核心目标是"**可中断性**"和"**优先级调度**"，而不是速度。实际上，Fiber 引入了额外的链表遍历和优先级判断开销，单次渲染可能比 React 15 稍慢。

**真正的价值**：用户**感知的流畅度**提升了。高优先级任务（用户输入）不再被低优先级任务（列表渲染）阻塞，应用的响应性大幅改善。

类比：快递员送 100 个包裹，优化路线可以让总耗时从 10 小时降到 8 小时（性能优化）。但如果有紧急文件，立即停下当前路线去送紧急件（优先级调度），虽然总耗时可能变成 9 小时，但客户体验更好。
:::

### 4. 实战场景

::: practice 场景：优化搜索输入的卡顿
**问题**：用户在搜索框输入时，触发列表过滤渲染，导致输入延迟。

**React 18 解决方案**：
```typescript
import { useState, useDeferredValue } from 'react'

function SearchResults() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  // 昂贵的过滤操作使用 deferred 值
  const results = useMemo(() =>
    bigList.filter(item => item.includes(deferredQuery)),
    [deferredQuery]
  )

  return (
    <>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <ResultList items={results} />
    </>
  )
}
```

**原理**：
- `query` 立即更新，输入框立刻响应（高优先级）
- `deferredQuery` 延迟更新，列表渲染被标记为低优先级
- 如果用户继续输入，React 会丢弃未完成的列表渲染，用最新值重新开始
:::

## 章节自测

<RecallBlock title="综合自测：检验你的理解深度">
  <template #question>

**场景题**：假设你在面试中被问到："为什么 React 选择 Fiber 架构而不是直接用 Web Workers？"

请从以下角度构思答案：
1. Web Workers 的局限性
2. Fiber 的优势
3. React 团队的权衡考虑

提示：思考 DOM 操作的限制和状态管理的复杂性。
  </template>
  <template #answer>

**参考答案框架**：

### 1. Web Workers 的局限性
- **无法访问 DOM**：Web Workers 运行在独立线程，不能直接操作 DOM。如果用 Worker 做协调（Reconciliation），最终还是要把结果传回主线程执行 DOM 操作，存在序列化和通信开销。
- **状态管理复杂**：React 组件的状态、Context、Ref 等都在主线程，Worker 中需要同步整个状态树，代价高昂。
- **调试困难**：跨线程调试比单线程复杂得多。

### 2. Fiber 的优势
- **细粒度控制**：可以精确控制每个 Fiber 节点的处理时间，而 Worker 是整体任务粒度。
- **无通信成本**：所有操作在主线程，无需序列化和跨线程通信。
- **渐进式调度**：可以随时暂停/恢复，而 Worker 任务一旦开始就必须完成。

### 3. React 团队的权衡
React 的核心问题是"**主线程被长任务阻塞**"，解决方案是：
- **方案 A（Worker）**：把任务移到其他线程 → 引入新的复杂性
- **方案 B（Fiber）**：把长任务拆成短任务 → 在现有架构上优雅演进

React 选择了方案 B，因为：
1. 兼容性好：不改变现有组件写法
2. 调试友好：单线程推理更简单
3. 灵活性高：可以根据优先级动态调整

**类比**：堵车时，与其修建新的高架桥（Worker，成本高），不如优化红绿灯配时（Fiber，渐进式改进）。

**延伸阅读**：Dan Abramov 的博客文章 [《Beyond React 16》](https://reactjs.org/blog/2018/03/01/sneak-peek-beyond-react-16.html) 详细讨论了这个设计决策。
  </template>
</RecallBlock>

## 标记复习

如果你觉得这份文档值得定期回顾，可以点击下方按钮标记：

<BookmarkReview />

---

## 使用说明

本文档演示了以下记忆优化功能：

1. **自定义容器**（5 种）
   - `::: concept` - 核心概念（蓝色）
   - `::: warning` - 警告陷阱（橙红色）
   - `::: practice` - 实践案例（绿色）
   - `::: tip` - 提示技巧（青色）
   - `::: recall` - 自测回忆（紫色）

2. **交互组件**
   - `<RecallBlock>` - 可展开的自测问题
   - `<BookmarkReview>` - 页面书签功能

详细使用方法见 [记忆系统使用指南](/.vitepress/memory-system-guide.md)
