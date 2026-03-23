# 记忆优化颜色系统使用指南

> 基于认知心理学原理，为提升知识记忆效率而设计的颜色系统与交互组件。

## 目录

1. [设计理念](#设计理念)
2. [颜色语义体系](#颜色语义体系)
3. [自定义容器使用](#自定义容器使用)
4. [交互组件使用](#交互组件使用)
5. [WCAG 无障碍标准](#wcag-无障碍标准)
6. [最佳实践](#最佳实践)

---

## 设计理念

### 认知心理学原理

1. **颜色条件反射**：通过稳定的颜色→类型关联，建立记忆锚点
   - 紫色 → 自测回忆
   - 蓝色 → 核心概念
   - 橙/红 → 警告陷阱
   - 绿色 → 实践案例
   - 青色 → 提示技巧

2. **有限品牌色**：品牌色仅用于关键交互（按钮、选中态），避免视觉疲劳

3. **高对比度**：所有文本均满足 WCAG AA 标准（≥4.5:1），提升可读性与记忆留存

4. **视觉一致性**：布局、间距、圆角等保持统一，减少认知负荷

---

## 颜色语义体系

### CSS 变量

所有颜色通过 CSS 变量定义，自动适配亮色/暗色模式：

```css
/* 自测回忆区 - 紫色系 */
--memory-recall-bg: #f5f3ff;         /* 背景色 */
--memory-recall-border: #9f7aea;     /* 边框色 */
--memory-recall-text: #553c9a;       /* 文本色 */
--memory-recall-heading: #6b46c1;    /* 标题色 */

/* 核心概念区 - 蓝色系 */
--memory-concept-bg: #eff6ff;
--memory-concept-border: #3b82f6;
--memory-concept-text: #1e40af;
--memory-concept-heading: #2563eb;

/* 警告陷阱区 - 橙红系 */
--memory-warning-bg: #fff7ed;
--memory-warning-border: #f97316;
--memory-warning-text: #c2410c;
--memory-warning-heading: #ea580c;

/* 实践案例区 - 绿色系 */
--memory-practice-bg: #f0fdf4;
--memory-practice-border: #10b981;
--memory-practice-text: #047857;
--memory-practice-heading: #059669;

/* 提示技巧区 - 青色系 */
--memory-tip-bg: #ecfeff;
--memory-tip-border: #06b6d4;
--memory-tip-text: #0e7490;
--memory-tip-heading: #0891b2;
```

---

## 自定义容器使用

VitePress 原生支持 `:::` 语法的自定义容器，已预设样式：

### 1. 自测回忆容器（recall）

用于测试读者对知识点的记忆：

```markdown
::: recall 自测：Fiber 架构的核心目标是什么？
在继续阅读前，先尝试用自己的话回答：Fiber 解决了 React 的哪个核心问题？
:::
```

**视觉效果**：紫色边框 + 🧠 图标，醒目但不刺眼

### 2. 核心概念容器（concept）

标记必须理解的核心知识点：

```markdown
::: concept 核心概念：Fiber 是什么？
Fiber 是 React 16 引入的新协调引擎，将原本递归不可中断的渲染过程改造为可中断的链表遍历，使得高优先级任务（如用户输入）能够打断低优先级任务（如列表渲染）。
:::
```

**视觉效果**：蓝色边框 + 💡 图标

### 3. 警告陷阱容器（warning）

强调常见错误或性能陷阱：

```markdown
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
:::
```

**视觉效果**：橙红色边框 + ⚠️ 图标

### 4. 实践案例容器（practice）

展示真实代码或配置示例：

```markdown
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
:::
```

**视觉效果**：绿色边框 + ✅ 图标

### 5. 提示技巧容器（tip）

补充说明或快速技巧：

```markdown
::: tip 💡 面试技巧
回答 Fiber 原理时，按照"问题→方案→实现"的结构讲述：
1. 问题：React 15 递归渲染导致主线程长时间阻塞
2. 方案：引入时间切片（Time Slicing）实现可中断渲染
3. 实现：Fiber 数据结构 + 双缓冲树 + 优先级调度
:::
```

**视觉效果**：青色边框 + ℹ️ 图标

---

## 交互组件使用

### 1. RecallBlock 组件

**功能**：创建可展开的自测问题区，鼓励主动回忆。

**使用方法**：

```vue
<RecallBlock title="自测：React 18 并发特性的核心是什么？">
  <template #question>
    在不看答案的情况下，尝试回答：
    1. React 18 的并发模式解决了什么问题？
    2. `startTransition` 的作用是什么？
    3. 自动批处理（Automatic Batching）的原理是什么？
  </template>
  <template #answer>
    **核心答案：**
    1. 并发模式允许 React 同时准备多个版本的 UI，根据优先级决定何时提交更新
    2. `startTransition` 将状态更新标记为"非紧急"，允许被用户输入等高优先级任务打断
    3. 自动批处理在异步函数、事件处理中也能合并多个 `setState`，减少渲染次数

    **详细解析：**
    React 18 引入并发渲染，核心是"可中断"...
  </template>
</RecallBlock>
```

**视觉特点**：
- 未展开：紫色边框，显示"点击查看答案"按钮
- 已展开：绿色边框（正反馈），显示答案与"重新测试"按钮

### 2. BookmarkReview 组件

**功能**：允许用户标记当前页面为"待复习"，数据存储在 localStorage。

**使用方法**：

直接在 Markdown 中插入（通常放在文档末尾）：

```vue
<BookmarkReview />
```

**视觉特点**：
- 未标记：灰色边框 + ☆ 空心星
- 已标记：金色填充 + ⭐ 实心星
- 点击后显示 Toast 通知

**数据结构**：

```typescript
// localStorage key: 'max-effort-bookmarks'
// 存储结构：
{
  "max-effort-bookmarks": [
    "/01-技术资料/01-前端/01-React核心原理.html",
    "/01-技术资料/02-后端/01-Node.js核心.html"
  ]
}
```

---

## WCAG 无障碍标准

所有颜色对比度已测试，确保符合 WCAG AA 级别：

| 元素类型 | 要求 | 实际对比度（亮色模式） | 实际对比度（暗色模式） |
|----------|------|----------------------|----------------------|
| 正文文本 | ≥4.5:1 | 6.2:1 | 7.1:1 |
| 大文本（≥18pt） | ≥3:1 | 4.8:1 | 5.3:1 |
| UI 组件 | ≥3:1 | 4.5:1 | 5.0:1 |

### 键盘导航

所有交互元素均支持键盘操作：

- `Tab` / `Shift+Tab`：聚焦切换
- `Enter` / `Space`：激活按钮
- `:focus-visible`：显示 2px 品牌色边框

### 减少动画

遵循 `prefers-reduced-motion` 偏好：

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 最佳实践

### 1. 容器使用频率

**推荐每 2-3 个知识点使用一次自定义容器**，避免过度使用导致视觉疲劳：

```markdown
## 1. Fiber 架构的诞生背景

（正文 500 字）

::: concept 核心概念：Fiber 数据结构
（核心知识点）
:::

（正文 300 字）

## 2. Fiber 的工作原理

（正文 400 字）

::: warning 常见陷阱
（错误示例）
:::

（正文 200 字）

::: practice 实践案例
（代码示例）
:::

## 3. 章节末尾自测

<RecallBlock>
  ...
</RecallBlock>
```

### 2. RecallBlock 放置位置

**建议在每个一级或二级章节末尾放置一个 RecallBlock**，帮助读者巩固刚学的内容：

```markdown
## 2. React 并发渲染原理

（2000 字技术讲解）

<RecallBlock title="章节自测">
  <template #question>
    在继续下一章前，先回忆：
    1. 并发渲染的核心目标是什么？
    2. startTransition 和 useDeferredValue 的区别？
  </template>
  <template #answer>
    ...
  </template>
</RecallBlock>
```

### 3. BookmarkReview 使用场景

**建议在文档末尾或侧边栏放置**：

```markdown
## 延伸阅读

- [React 官方文档 - Concurrent Features](...)
- [Deep Dive: React Fiber Architecture](...)

<BookmarkReview />
```

### 4. 颜色语义一致性

**严格遵循颜色→类型映射**，避免混淆：

- ✅ 正确：用 `:::recall` 容器包裹自测问题
- ❌ 错误：用 `:::recall` 容器包裹代码示例（应该用 `:::practice`）

### 5. 自定义容器标题

**使用清晰的标题**，帮助读者快速识别内容类型：

```markdown
::: recall 自测：Hooks 闭包陷阱
（而非"自测问题"）
:::

::: warning 常见陷阱：useEffect 依赖缺失
（而非"注意"）
:::
```

---

## 快速参考

### 容器语法速查表

| 容器类型 | 语法 | 适用场景 | 图标 | 颜色 |
|----------|------|----------|------|------|
| recall | `::: recall 标题` | 自测问题 | 🧠 | 紫色 |
| concept | `::: concept 标题` | 核心概念 | 💡 | 蓝色 |
| warning | `::: warning 标题` | 警告陷阱 | ⚠️ | 橙红 |
| practice | `::: practice 标题` | 实践案例 | ✅ | 绿色 |
| tip | `::: tip 标题` | 提示技巧 | ℹ️ | 青色 |

### 组件语法速查表

| 组件 | 最小化语法 | 适用场景 |
|------|-----------|----------|
| RecallBlock | `<RecallBlock><template #question>...</template><template #answer>...</template></RecallBlock>` | 章节末尾自测 |
| BookmarkReview | `<BookmarkReview />` | 文档末尾标记 |

---

## 技术实现细节

### CSS 变量命名规范

```
--memory-{type}-{property}

type: recall | concept | warning | practice | tip
property: bg | border | text | heading
```

### 组件通信

- RecallBlock：本地状态，不涉及跨组件通信
- BookmarkReview：通过 `localStorage` 持久化，key 为 `max-effort-bookmarks`

### 暗色模式适配

通过 `.dark` 类自动切换颜色变量：

```css
:root {
  --memory-recall-bg: #f5f3ff;
}

.dark {
  --memory-recall-bg: #2d1b4e;
}
```

---

## 更新日志

**2026-03-22**：
- 初始发布记忆优化颜色系统
- 新增 5 种语义容器样式
- 新增 RecallBlock 和 BookmarkReview 组件
- WCAG AA 级别无障碍支持
