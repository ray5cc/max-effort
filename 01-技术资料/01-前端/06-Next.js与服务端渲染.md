# Next.js 与服务端渲染

> 从 SSR/SSG/ISR 原理到 App Router 架构，从 React Server Components 到全栈开发实践。现代 React 应用的生产级框架。

## 相关链接

- 对应面试题：[Next.js面试题](../../02-面试指南/01-前端面试/06-Next.js面试题.md)
- 相关技术资料：[React核心原理](./01-React核心原理.md) | [前端工程化](./03-前端工程化.md)

## 目录

1. [为什么需要 SSR 框架](#1-为什么需要-ssr-框架)
2. [渲染策略全景](#2-渲染策略全景)
3. [Next.js App Router 架构](#3-nextjs-app-router-架构)
4. [React Server Components 深度解析](#4-react-server-components-深度解析)
5. [数据获取模式](#5-数据获取模式)
6. [路由与导航](#6-路由与导航)
7. [Server Actions](#7-server-actions)
8. [缓存机制](#8-缓存机制)
9. [部署与优化](#9-部署与优化)
10. [Next.js 15 新特性（2025-2026）](#10-nextjs-15-新特性2025-2026)

---

## 1. 为什么需要 SSR 框架

### 1.1 SPA 的三大痛点

传统单页应用（SPA）如 Create React App 构建的项目，存在先天缺陷：

| 痛点           | 表现                                   | 根因                                              |
| -------------- | -------------------------------------- | ------------------------------------------------- |
| **白屏时间长** | 用户看到内容前需等待 JS 加载+解析+执行 | HTML 只有空 `<div id="root">`，内容全靠 JS 生成   |
| **SEO 极差**   | 搜索引擎爬虫看到空页面                 | 爬虫不执行 JavaScript（或执行不完整）             |
| **首屏性能差** | TTFB 快但 FCP/LCP 慢                   | 需要串行：下载 JS → 解析 JS → 请求 API → 渲染 DOM |

### 1.2 生活化类比

> **SPA = 餐厅自己做菜（客户端渲染）**：顾客（浏览器）进餐厅后收到一个空盘子（空 HTML）和一本菜谱（JS Bundle），然后自己去厨房做菜。做完才能吃上饭。
>
> **SSR = 外卖直接送成品（服务端渲染）**：外卖小哥（服务器）把做好的饭菜直接送到门口。顾客打开就能吃，不用自己动手。
>
> **SSG = 提前做好便当（静态生成）**：便利店提前做好几百份便当放在货架上。顾客来了直接拿，连等外卖的时间都省了。

### 1.3 渲染模式速览对比

| 维度           | CSR (SPA)    | SSR                | SSG              | ISR                    |
| -------------- | ------------ | ------------------ | ---------------- | ---------------------- |
| **渲染时机**   | 浏览器运行时 | 每次请求时         | 构建时           | 构建时 + 增量更新      |
| **SEO**        | ❌ 差        | ✅ 好              | ✅ 好            | ✅ 好                  |
| **TTFB**       | 快           | 慢（需服务端渲染） | 极快（CDN 缓存） | 极快（CDN + 后台再生） |
| **动态性**     | ✅ 完全动态  | ✅ 完全动态        | ❌ 构建时固定    | ⚠️ 有延迟的动态        |
| **服务器成本** | 低（纯静态） | 高（每次渲染）     | 极低（CDN）      | 低（按需再生）         |
| **适用场景**   | 后台管理系统 | 新闻/电商详情      | 博客/文档站      | 电商列表/内容站        |

---

## 2. 渲染策略全景

### 2.1 CSR — Client-Side Rendering（客户端渲染）

全部在浏览器渲染。服务器返回空 HTML + JS 包，浏览器执行 JS 后生成 DOM。

```
浏览器请求 → 服务器返回空 HTML → 下载 JS → 执行 JS → 请求 API → 渲染 DOM
                                                                    ↑
                                                          用户此时才看到内容
```

**特点**：首次加载慢，但后续导航快（不需要重新请求 HTML）。适合需要丰富交互的后台管理系统。

### 2.2 SSR — Server-Side Rendering（服务端渲染）

每次请求时，服务器运行 React 生成完整 HTML，发送给浏览器。浏览器先显示 HTML（用户立即看到内容），然后下载 JS 进行 **hydration（水合）** 使页面可交互。

```
浏览器请求 → 服务器执行 React → 返回完整 HTML → 用户看到内容(不可交互)
                                                → 下载 JS → Hydration → 可交互
```

**水合（Hydration）类比**：SSR 就像先寄一封信的照片（HTML），让你先看到内容；然后再寄实物信件（JS），让你能回信（交互）。

### 2.3 SSG — Static Site Generation（静态站点生成）

构建时（`next build`）预渲染所有页面为静态 HTML 文件。部署到 CDN，用户请求直接返回静态文件。

```
构建阶段：Next.js 执行 React → 生成 .html 文件 → 上传 CDN
用户请求 → CDN 直接返回 HTML → 极速显示 → 下载 JS → Hydration
```

**适合**：内容不频繁变化的页面（博客、文档、营销页面）。

### 2.4 ISR — Incremental Static Regeneration（增量静态再生）

SSG 的进化版。静态页面可以在指定时间后**后台重新生成**，无需全量重新构建。

```
用户 A 请求 → 返回缓存的静态页面（即使数据已变）
             → 后台触发重新生成
用户 B 请求 → 返回新生成的页面 ✅
```

```tsx
// Next.js App Router 中启用 ISR
export const revalidate = 60; // 每 60 秒重新验证

export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await fetch(`https://api.example.com/products/${params.id}`);
  return <div>{product.name}</div>;
}
```

### 2.5 Streaming SSR — 流式服务端渲染

React 18+ 的 Suspense 边界允许服务器**分块发送** HTML。不需要等所有数据就绪，可以先发送页面骨架，数据就绪后再流式传输对应 HTML 片段。

```
服务器 → [页面骨架 HTML] ──→ 浏览器立即显示骨架
       → [数据区块 1 HTML] ──→ 浏览器替换 loading → 显示内容 1
       → [数据区块 2 HTML] ──→ 浏览器替换 loading → 显示内容 2
```

```tsx
import { Suspense } from "react";

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      {/* 先显示骨架，数据就绪后替换 */}
      <Suspense fallback={<LoadingSkeleton />}>
        <SlowDataComponent /> {/* 可能需要 2 秒 */}
      </Suspense>
      <Suspense fallback={<LoadingSkeleton />}>
        <AnotherSlowComponent /> {/* 可能需要 3 秒 */}
      </Suspense>
    </div>
  );
}
```

### 2.6 PPR — Partial Prerendering（Next.js 15）

Next.js 15 引入的混合策略：**同一个路由中，静态部分预渲染，动态部分流式传输**。

```
一个页面 = 静态 Shell（CDN 缓存） + 动态洞（Streaming 填充）

[静态 Header] [静态侧边栏]
[动态: 用户信息 ← 流式加载]
[静态 Footer]
```

### 2.7 渲染策略选择流程

```
需要 SEO 吗？
├── 否 → 需要实时交互吗？
│        ├── 是 → CSR（后台管理/SaaS dashboard）
│        └── 否 → SSG（内部工具文档）
└── 是 → 内容变化频率？
         ├── 几乎不变 → SSG（博客/文档）
         ├── 定期更新（分钟~小时级）→ ISR（电商列表/新闻聚合）
         ├── 每次请求都不同 → SSR（个性化页面/搜索结果）
         └── 混合（静态 + 动态） → PPR + Streaming SSR
```

---

## 3. Next.js App Router 架构

### 3.1 从 Pages Router 到 App Router

Next.js 13 引入 App Router，这是一次**架构级升级**，不仅仅是 API 变化：

| 维度           | Pages Router (`pages/`)                 | App Router (`app/`)        |
| -------------- | --------------------------------------- | -------------------------- |
| 组件默认       | Client Component                        | **Server Component**       |
| 数据获取       | `getServerSideProps` / `getStaticProps` | 直接 `async/await`         |
| 布局           | `_app.tsx` + `_document.tsx`            | **嵌套 `layout.tsx`**      |
| 流式渲染       | 不支持                                  | **Suspense + Streaming**   |
| Server Actions | 不支持                                  | **"use server"**           |
| 路由分组       | 不支持                                  | **Route Groups `(group)`** |

### 3.2 文件系统路由

App Router 使用 `app/` 目录，文件夹结构**直接映射为 URL 路径**：

```
app/
├── layout.tsx          # 根布局（包裹所有页面）
├── page.tsx            # 首页 → /
├── loading.tsx         # 全局 loading UI
├── error.tsx           # 全局错误边界
├── not-found.tsx       # 全局 404 页面
├── (marketing)/        # Route Group（不影响 URL）
│   ├── about/
│   │   └── page.tsx    # → /about
│   └── blog/
│       ├── page.tsx    # → /blog
│       └── [slug]/
│           └── page.tsx # → /blog/:slug（动态路由）
├── dashboard/
│   ├── layout.tsx      # Dashboard 独立布局
│   ├── page.tsx        # → /dashboard
│   ├── settings/
│   │   └── page.tsx    # → /dashboard/settings
│   └── @analytics/     # Parallel Route（并行路由）
│       └── page.tsx    # 与 dashboard/page.tsx 同时渲染
├── (.)photo/[id]/
│   └── page.tsx        # Intercepting Route（路由拦截）
└── api/
    └── chat/
        └── route.ts    # API Route → /api/chat
```

### 3.3 特殊文件约定

每个路由文件夹可以包含以下特殊文件，Next.js 自动识别并按约定使用：

| 文件            | 用途                           | 渲染时机              |
| --------------- | ------------------------------ | --------------------- |
| `page.tsx`      | 路由的 UI 内容                 | 访问该路由时          |
| `layout.tsx`    | 共享布局（不重新渲染）         | 包裹子路由            |
| `loading.tsx`   | 加载占位 UI                    | 路由切换时自动显示    |
| `error.tsx`     | 错误边界                       | 渲染出错时            |
| `not-found.tsx` | 404 页面                       | `notFound()` 被调用时 |
| `route.ts`      | API 路由处理器                 | HTTP 请求到达时       |
| `template.tsx`  | 类似 layout 但每次导航重新渲染 | 每次路由切换          |
| `default.tsx`   | Parallel Route 的回退 UI       | 未匹配时              |

### 3.4 布局嵌套

Layout 是 App Router 的核心设计。**嵌套的 layout 不会在导航时重新渲染**，只有变化的部分会更新：

```tsx
// app/layout.tsx — 根布局
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <header>全局导航栏</header>
        <main>{children}</main> {/* 子路由内容插入这里 */}
        <footer>全局页脚</footer>
      </body>
    </html>
  );
}

// app/dashboard/layout.tsx — Dashboard 布局
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex">
      <aside>侧边栏（导航时不重新渲染）</aside>
      <section>{children}</section> {/* Dashboard 子页面 */}
    </div>
  );
}
```

导航到 `/dashboard/settings` 时，只有 `settings/page.tsx` 被替换，根布局和 Dashboard 布局**保持不变**，侧边栏的状态（如滚动位置）不丢失。

### 3.5 Route Groups

用圆括号 `(groupName)` 命名的文件夹**不会出现在 URL 中**，用于逻辑分组：

```
app/
├── (marketing)/     # 营销页面用一套布局
│   ├── layout.tsx   # 简洁布局
│   ├── about/page.tsx   # → /about
│   └── pricing/page.tsx # → /pricing
├── (dashboard)/     # 后台用另一套布局
│   ├── layout.tsx   # 带侧边栏布局
│   └── admin/page.tsx   # → /admin
```

### 3.6 Parallel Routes 与 Intercepting Routes

**Parallel Routes（并行路由）**：使用 `@slotName` 同时渲染多个页面。适用于 Dashboard 的多面板布局：

```tsx
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
  analytics,
  team,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode; // @analytics/page.tsx
  team: React.ReactNode; // @team/page.tsx
}) {
  return (
    <div>
      {children}
      <div className="grid grid-cols-2">
        {analytics}
        {team}
      </div>
    </div>
  );
}
```

**Intercepting Routes（路由拦截）**：在当前布局中拦截某个路由。典型用例：点击图片列表打开 Modal 预览，直接访问 URL 则显示完整页面。

```
(.)  — 匹配同级路由段
(..) — 匹配上一级
(..)(..) — 匹配上两级
(...) — 匹配根目录
```

---

## 4. React Server Components 深度解析

> 这是 Next.js App Router 最核心的概念。理解 RSC，才能真正理解 App Router。

### 4.1 Server Components vs Client Components

在 App Router 中，**所有组件默认都是 Server Components**。只有显式添加 `"use client"` 指令的组件才是 Client Components。

| 维度          | Server Component（默认）             | Client Component（`"use client"`）        |
| ------------- | ------------------------------------ | ----------------------------------------- |
| **运行环境**  | 仅在服务器运行                       | 服务器（SSR）+ 浏览器                     |
| **JS Bundle** | **零 JS 发送到客户端**               | 包含在客户端 JS Bundle 中                 |
| **能力**      | 访问数据库、文件系统、环境变量       | useState、useEffect、事件处理、浏览器 API |
| **不能做**    | 使用 Hooks、绑定事件、访问浏览器 API | 直接访问数据库、读文件                    |
| **渲染**      | 服务端渲染为 RSC Payload             | 服务端预渲染 HTML + 客户端 Hydration      |

### 4.2 类比：后厨与前厅

> **Server Components = 后厨**：厨师（服务器）可以直接接触食材（数据库）、使用厨具（Node.js API）、查看秘密配方（环境变量）。但厨师不能跑到前厅和顾客互动。
>
> **Client Components = 前厅服务员**：服务员（浏览器）可以和顾客互动（事件处理）、调整餐具摆放（DOM 操作）、记住顾客偏好（useState）。但服务员不能进后厨直接拿食材。
>
> **协作方式**：后厨做好菜（数据处理），交给前厅服务员上桌（渲染到用户界面）。

### 4.3 何时使用 `"use client"`？

```
需要 useState / useReducer？          → "use client"
需要 useEffect / useLayoutEffect？    → "use client"
需要 onClick / onChange 等事件处理？   → "use client"
需要浏览器 API（window/document）？   → "use client"
需要 React Class Component？          → "use client"
需要第三方库使用了上述 API？           → "use client"
只是渲染数据/展示内容？               → 保持 Server Component ✅
```

### 4.4 代码示例：Server 与 Client 协作

```tsx
// ========== Server Component（默认）— 可直接访问数据库 ==========
// app/users/[id]/page.tsx
import { db } from "@/lib/db";
import { InteractiveProfile } from "./interactive-profile";

export default async function UserProfile({
  params,
}: {
  params: { id: string };
}) {
  // ✅ 直接查数据库，这段代码永远不会发送到客户端
  const user = await db.user.findUnique({
    where: { id: params.id },
    include: { posts: true },
  });

  if (!user) return notFound();

  return (
    <div>
      <h1>{user.name}</h1>
      <p>邮箱: {user.email}</p>
      <p>文章数: {user.posts.length}</p>

      {/* 将数据作为 props 传递给 Client Component */}
      <InteractiveProfile userId={user.id} initialName={user.name} />

      {/* Server Component 可以嵌套 Server Component */}
      <UserPosts posts={user.posts} />
    </div>
  );
}

// Server Component — 纯展示
function UserPosts({ posts }: { posts: Post[] }) {
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

```tsx
// ========== Client Component — 需要 "use client" 指令 ==========
// app/users/[id]/interactive-profile.tsx
"use client";

import { useState, useTransition } from "react";
import { updateUserName } from "@/app/actions";

export function InteractiveProfile({
  userId,
  initialName,
}: {
  userId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      await updateUserName(userId, name); // 调用 Server Action
      setIsEditing(false);
    });
  };

  return (
    <div>
      {isEditing ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={handleSave} disabled={isPending}>
            {isPending ? "保存中..." : "保存"}
          </button>
        </>
      ) : (
        <button onClick={() => setIsEditing(true)}>编辑名字</button>
      )}
    </div>
  );
}
```

### 4.5 RSC 序列化协议（RSC Wire Format）

Server Components 的渲染结果不是 HTML 字符串，而是一种特殊的**流式 JSON 格式**（RSC Payload）：

```
0:["$","div",null,{"children":[
  ["$","h1",null,{"children":"用户名"}],
  ["$","$L1",null,{"userId":"123","initialName":"张三"}]
]}]
1:I["./interactive-profile.tsx",["chunk-abc123"],"InteractiveProfile"]
```

- `$` 代表 React 元素
- `$L1` 代表一个**延迟加载的 Client Component 引用**（L = Lazy）
- `1:I[...]` 告诉浏览器去加载对应的 JS chunk

**关键洞察**：RSC Payload 只传输组件树的**结构和数据**，不传输 Server Component 的代码。Client Component 通过引用加载。

### 4.6 组合模式（Composition Pattern）

**错误做法** ❌ —— 在 Client Component 内导入 Server Component：

```tsx
"use client";
import ServerComponent from "./server-component"; // ❌ 会变成 Client Component！

export function ClientWrapper() {
  return <ServerComponent />; // 失去 Server Component 的能力
}
```

**正确做法** ✅ —— 通过 props / children 传递：

```tsx
// Server Component（父）
import { ClientWrapper } from "./client-wrapper";
import { ServerContent } from "./server-content";

export default function Page() {
  return (
    <ClientWrapper>
      <ServerContent /> {/* ✅ 通过 children 传入 */}
    </ClientWrapper>
  );
}

// Client Component
("use client");
export function ClientWrapper({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)}>切换</button>
      {open && children} {/* children 仍然是 Server Component */}
    </div>
  );
}
```

---

## 5. 数据获取模式

### 5.1 Server Components 直接 Fetch

在 Server Component 中，可以直接使用 `async/await` + `fetch`。Next.js **自动去重**相同的请求：

```tsx
// 同一渲染树中多次调用相同 URL，Next.js 只发一次请求
async function UserName({ id }: { id: string }) {
  const res = await fetch(`https://api.example.com/users/${id}`);
  const user = await res.json();
  return <h1>{user.name}</h1>;
}

async function UserEmail({ id }: { id: string }) {
  // 和上面相同的 URL，Next.js 会自动去重（Request Memoization）
  const res = await fetch(`https://api.example.com/users/${id}`);
  const user = await res.json();
  return <p>{user.email}</p>;
}
```

### 5.2 Fetch 扩展选项

Next.js 扩展了原生 `fetch`，增加了缓存控制：

```tsx
// 默认行为（Next.js 15 默认 no-store）
const res = await fetch("https://api.example.com/data");

// 强制缓存（类似 SSG）
const res = await fetch("https://api.example.com/data", {
  cache: "force-cache",
});

// 基于时间的重新验证（类似 ISR）
const res = await fetch("https://api.example.com/data", {
  next: { revalidate: 3600 }, // 每小时重新验证
});

// 基于标签的重新验证
const res = await fetch("https://api.example.com/products", {
  next: { tags: ["products"] }, // 打标签
});
// 在 Server Action 中手动失效
import { revalidateTag } from "next/cache";
revalidateTag("products"); // 使所有带 'products' 标签的缓存失效
```

### 5.3 generateStaticParams — 路由预生成（SSG）

对于动态路由，使用 `generateStaticParams` 在构建时生成所有静态页面：

```tsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await fetch("https://api.example.com/posts").then((r) =>
    r.json(),
  );

  return posts.map((post: Post) => ({
    slug: post.slug, // 构建时为每个 slug 生成静态页面
  }));
}

export default async function BlogPost({
  params,
}: {
  params: { slug: string };
}) {
  const post = await fetch(`https://api.example.com/posts/${params.slug}`).then(
    (r) => r.json(),
  );
  return <article>{post.content}</article>;
}
```

### 5.4 并行数据获取

避免瀑布式请求（一个等一个），用 `Promise.all` 并行获取：

```tsx
export default async function Dashboard() {
  // ❌ 串行（瀑布式）— 总耗时 = 2s + 1s + 1.5s = 4.5s
  // const user = await getUser()      // 2s
  // const posts = await getPosts()    // 1s
  // const stats = await getStats()    // 1.5s

  // ✅ 并行 — 总耗时 = max(2s, 1s, 1.5s) = 2s
  const [user, posts, stats] = await Promise.all([
    getUser(), // 2s
    getPosts(), // 1s
    getStats(), // 1.5s
  ]);

  return (
    <div>
      <UserCard user={user} />
      <PostList posts={posts} />
      <StatsPanel stats={stats} />
    </div>
  );
}
```

### 5.5 React `use` Hook + Suspense

在 Client Component 中消费 Server Component 传递的 Promise：

```tsx
// Server Component
export default function Page() {
  // 不 await，直接传 Promise
  const dataPromise = fetchData();
  return (
    <Suspense fallback={<Loading />}>
      <DataDisplay dataPromise={dataPromise} />
    </Suspense>
  );
}

// Client Component
("use client");
import { use } from "react";

function DataDisplay({ dataPromise }: { dataPromise: Promise<Data> }) {
  const data = use(dataPromise); // React 19 的 use hook
  return <div>{data.title}</div>;
}
```

---

## 6. 路由与导航

### 6.1 `<Link>` 组件与预取

Next.js 的 `<Link>` 组件在链接进入视口时**自动预取**目标路由：

```tsx
import Link from "next/link";

export default function Navigation() {
  return (
    <nav>
      {/* 默认：在视口中时自动预取 */}
      <Link href="/about">关于我们</Link>

      {/* 禁用预取 */}
      <Link href="/heavy-page" prefetch={false}>
        重页面
      </Link>

      {/* 动态路由 */}
      <Link href={`/blog/${post.slug}`}>{post.title}</Link>
    </nav>
  );
}
```

预取行为：

- **静态路由**：预取整个路由（RSC Payload + 数据）
- **动态路由**：预取到最近的 `loading.tsx` 边界

### 6.2 编程式导航

```tsx
"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function NavigationExample() {
  const router = useRouter();
  const pathname = usePathname(); // 当前路径 '/dashboard'
  const searchParams = useSearchParams(); // URL 查询参数

  return (
    <div>
      <p>当前路径: {pathname}</p>
      <p>查询参数 q: {searchParams.get("q")}</p>

      <button onClick={() => router.push("/about")}>跳转到 About</button>
      <button onClick={() => router.replace("/login")}>替换到 Login</button>
      <button onClick={() => router.back()}>返回</button>
      <button onClick={() => router.refresh()}>
        刷新（重新获取 Server Component）
      </button>
    </div>
  );
}
```

### 6.3 路由拦截实现 Modal

典型用例：图片列表 → 点击打开 Modal 预览 → 直接访问 URL 显示完整页面。

```
app/
├── @modal/
│   └── (.)photo/[id]/
│       └── page.tsx      # 拦截 /photo/[id]，显示为 Modal
├── photo/[id]/
│   └── page.tsx          # 直接访问 /photo/[id] 显示完整页面
└── page.tsx              # 图片列表
```

### 6.4 Middleware 中间件

Middleware 在**请求到达服务器之前**执行（Edge Runtime），用于鉴权、重定向、国际化等：

```tsx
// middleware.ts（项目根目录）
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;

  // 未登录用户重定向到登录页
  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 添加自定义 Header
  const response = NextResponse.next();
  response.headers.set("x-request-id", crypto.randomUUID());
  return response;
}

// 配置匹配的路由
export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
```

---

## 7. Server Actions

### 7.1 什么是 Server Actions？

Server Actions 允许你在组件中定义**运行在服务器上的函数**，直接作为 `<form>` 的 `action` 使用。无需手动创建 API 路由。

> **类比**：传统方式像写信（创建 API → fetch 调用 → 处理响应），Server Actions 像打电话直接说需求（函数调用 → 服务器执行 → 自动更新 UI）。

### 7.2 基本用法

```tsx
// app/actions.ts
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createPost(formData: FormData) {
  // 输入验证
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;

  if (!title || title.length < 3) {
    return { error: "标题至少 3 个字符" };
  }

  // 数据库操作
  const post = await db.post.create({
    data: { title, content },
  });

  // 缓存失效 + 重定向
  revalidatePath("/posts");
  redirect(`/posts/${post.id}`);
}
```

### 7.3 Progressive Enhancement

Server Actions 的表单在**没有 JavaScript 的情况下也能工作**（渐进增强）：

```tsx
// app/posts/new/page.tsx — Server Component
import { createPost } from "@/app/actions";

export default function NewPost() {
  return (
    <form action={createPost}>
      <label>
        标题
        <input name="title" required minLength={3} />
      </label>
      <label>
        内容
        <textarea name="content" required />
      </label>
      <SubmitButton />
    </form>
  );
}
```

### 7.4 `useActionState` + `useFormStatus`

```tsx
"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createPost } from "@/app/actions";

// 提交按钮组件
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "发布中..." : "发布文章"}
    </button>
  );
}

// 表单组件
export function PostForm() {
  const [state, action] = useActionState(createPost, { error: null });

  return (
    <form action={action}>
      {state?.error && <p className="text-red-500">{state.error}</p>}
      <input name="title" required />
      <textarea name="content" required />
      <SubmitButton />
    </form>
  );
}
```

### 7.5 乐观更新 `useOptimistic`

在服务器还没响应时就更新 UI，提升用户体验：

```tsx
"use client";

import { useOptimistic } from "react";
import { toggleLike } from "@/app/actions";

export function LikeButton({
  postId,
  initialLiked,
}: {
  postId: string;
  initialLiked: boolean;
}) {
  const [optimisticLiked, addOptimistic] = useOptimistic(
    initialLiked,
    (currentState: boolean, newState: boolean) => newState,
  );

  return (
    <form
      action={async () => {
        addOptimistic(!optimisticLiked); // 立即更新 UI
        await toggleLike(postId); // 然后执行服务端操作
      }}
    >
      <button type="submit">{optimisticLiked ? "❤️" : "🤍"}</button>
    </form>
  );
}
```

---

## 8. 缓存机制

### 8.1 四层缓存架构

Next.js 的缓存是一个**多级缓存系统**，类似 CPU 的 L1/L2/L3 缓存：

```
请求 → [L1: Request Memoization] → [L2: Data Cache] → [L3: Full Route Cache] → [L4: Router Cache]
         服务器内，同一渲染           服务器端，跨请求       服务器端，整页缓存       客户端，路由缓存
         自动去重相同 fetch          持久化数据缓存        RSC Payload + HTML     浏览器内存中
```

### 8.2 四层缓存详解

| 层级 | 名称                    | 位置               | 生命周期              | 功能                                       |
| ---- | ----------------------- | ------------------ | --------------------- | ------------------------------------------ |
| L1   | **Request Memoization** | 服务器（单次请求） | 一次渲染              | 同一渲染树中相同 URL 的 fetch 自动去重     |
| L2   | **Data Cache**          | 服务器（持久化）   | 跨请求、跨部署        | fetch 结果持久缓存，可通过 revalidate 控制 |
| L3   | **Full Route Cache**    | 服务器（持久化）   | 跨请求、到 revalidate | 静态路由的完整 RSC Payload + HTML          |
| L4   | **Router Cache**        | 客户端（浏览器）   | 会话期间              | 客户端缓存已访问路由的 RSC Payload         |

### 8.3 缓存失效

```tsx
import { revalidatePath, revalidateTag } from "next/cache";

// 按路径失效
revalidatePath("/posts"); // 失效 /posts 页面缓存
revalidatePath("/posts", "layout"); // 失效 /posts 下所有页面

// 按标签失效
revalidateTag("posts"); // 失效所有带 'posts' 标签的数据缓存

// 基于时间的自动失效
export const revalidate = 3600; // 页面级：每小时自动失效

const res = await fetch(url, {
  next: { revalidate: 60 }, // 请求级：每分钟自动失效
});
```

### 8.4 Next.js 15 的缓存变化

Next.js 15 **改变了默认缓存行为**：

| 行为                | Next.js 14 默认                | Next.js 15 默认                   |
| ------------------- | ------------------------------ | --------------------------------- |
| `fetch()`           | `cache: 'force-cache'`（缓存） | **`cache: 'no-store'`（不缓存）** |
| Route Handlers      | 被缓存                         | **不缓存**                        |
| Client Router Cache | 30s / 5min                     | **0（不缓存）**                   |

这意味着 Next.js 15 默认**更动态**，需要显式 opt-in 缓存。

---

## 9. 部署与优化

### 9.1 部署方式

**Vercel（推荐）**：Next.js 的亲爹，功能支持最完整。

- 自动识别 Next.js 项目
- 支持 ISR、Server Actions、Edge Runtime、Image Optimization
- 全球 CDN + Serverless Functions
- `git push` 即部署

**自托管**：

```bash
# 构建
next build

# 生产模式启动（需要 Node.js 服务器）
next start -p 3000
```

Docker 部署示例：

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

需要 `next.config.js` 中启用 standalone 输出：

```js
// next.config.js
module.exports = {
  output: "standalone",
};
```

### 9.2 图片优化 — `next/image`

```tsx
import Image from "next/image";

// 自动：WebP/AVIF 转换、响应式尺寸、懒加载、防止布局偏移
<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={630}
  priority // LCP 图片应标记 priority，禁用懒加载
  placeholder="blur" // 模糊占位
  blurDataURL="..." // base64 缩略图
/>;
```

### 9.3 字体优化 — `next/font`

```tsx
import { Inter, Noto_Sans_SC } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });
const notoSansSC = Noto_Sans_SC({
  subsets: ["chinese-simplified"],
  weight: ["400", "700"],
});

// 在 layout 中使用
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html className={`${inter.className} ${notoSansSC.className}`}>
      <body>{children}</body>
    </html>
  );
}
```

优势：构建时下载字体文件并自包含，无运行时外部请求，避免 FOIT/FOUT（字体闪烁）。

### 9.4 Bundle 分析

```bash
npm install @next/bundle-analyzer

# next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
module.exports = withBundleAnalyzer({ /* config */ })

# 运行分析
ANALYZE=true next build
```

---

## 10. Next.js 15 新特性（2025-2026）

### 10.1 Partial Prerendering (PPR)

PPR 是 Next.js 最具野心的特性。**一个路由同时拥有静态 shell + 动态内容**：

```tsx
// next.config.js
module.exports = {
  experimental: {
    ppr: true,
  },
};

// app/product/[id]/page.tsx
import { Suspense } from "react";

export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div>
      {/* 静态 Shell — 构建时预渲染，从 CDN 提供 */}
      <header>网站导航</header>

      {/* 动态洞 — Suspense 边界标记动态部分 */}
      <Suspense fallback={<PriceSkeleton />}>
        <DynamicPrice productId={params.id} /> {/* 流式传输 */}
      </Suspense>

      <Suspense fallback={<ReviewsSkeleton />}>
        <DynamicReviews productId={params.id} /> {/* 流式传输 */}
      </Suspense>

      {/* 静态 — 预渲染 */}
      <footer>页脚信息</footer>
    </div>
  );
}
```

**效果**：用户看到的 TTFB 极快（CDN 返回静态 shell），动态内容随后流式填充。

### 10.2 `after()` API

在响应发送给用户**之后**执行异步任务（日志、分析、清理），不阻塞用户响应：

```tsx
import { after } from "next/server";

export default async function Page() {
  const data = await fetchData();

  after(async () => {
    // 这段代码在响应发送后执行
    await logPageView("/page");
    await updateAnalytics();
  });

  return <div>{data}</div>;
}
```

### 10.3 其他 Next.js 15 变化

| 特性                     | 说明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| **Turbopack 稳定**       | `next dev --turbo` 现在是稳定特性，开发模式比 Webpack 快 ~76%     |
| **React 19 支持**        | 支持 React 19 的 `use` hook、`useActionState`、`useOptimistic` 等 |
| **fetch 默认 no-store**  | `fetch()` 默认不缓存，需要显式 opt-in 缓存                        |
| **新 `<Form>` 组件**     | 扩展原生 `<form>`，支持预取和客户端导航                           |
| **`instrumentation.ts`** | 稳定的监控钩子，在服务器生命周期开始时执行                        |
| **`next.config.ts`**     | 支持 TypeScript 配置文件                                          |

---

## 常见陷阱与最佳实践

### 陷阱

1. **在 Client Component 中导入 Server Component** → 会丢失 Server Component 的能力，应通过 children/props 传递
2. **所有组件都加 "use client"** → 失去 RSC 的零 JS 优势，应默认 Server Component
3. **误解 Next.js 15 缓存默认值** → fetch 默认 no-store，想缓存需要显式设置
4. **Middleware 中执行重计算** → Middleware 运行在 Edge Runtime，应保持轻量
5. **Client Component 中使用 `async/await`** → Client Component 不能是 async 函数

### 最佳实践

1. **组件边界最小化**：把 `"use client"` 推到组件树的叶子节点，最大化 Server Component 覆盖
2. **数据获取就近原则**：在需要数据的组件中获取，而非在顶层获取后层层传递
3. **善用 Suspense 边界**：包裹慢数据组件，实现流式渲染
4. **图片使用 `next/image`**：自动优化格式/尺寸，LCP 图片标记 `priority`
5. **字体使用 `next/font`**：避免外部请求和字体闪烁
