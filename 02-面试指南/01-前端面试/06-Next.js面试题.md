# Next.js 与服务端渲染面试题

> 覆盖 SSR/SSG/ISR、App Router、React Server Components、缓存策略的高频面试题。

## 相关链接

- 对应技术资料：[Next.js与服务端渲染](../../01-技术资料/01-前端/06-Next.js与服务端渲染.md)

## 🔥 高频考点速记

| #   | 考点                    | 核心要点（一句话）                                   | 出题概率 |
| --- | ----------------------- | ---------------------------------------------------- | -------- |
| 1   | SSR vs SSG vs ISR       | SSR=每次请求渲染，SSG=构建时渲染，ISR=增量再生       | ★★★★★    |
| 2   | React Server Components | 默认 Server(零JS)，"use client" 标注交互组件         | ★★★★★    |
| 3   | App Router              | 文件系统路由，layout/page/loading/error 约定         | ★★★★★    |
| 4   | Server Actions          | "use server" 函数 + form action，替代 API Route      | ★★★★☆    |
| 5   | 缓存机制                | 四层缓存(Request→Data→Route→Router)，revalidate 失效 | ★★★★☆    |
| 6   | Streaming SSR           | Suspense 边界流式传输，逐步显示内容                  | ★★★★☆    |
| 7   | 数据获取                | Server Component 直接 fetch，自动去重+缓存           | ★★★★☆    |
| 8   | Middleware              | Edge Runtime 运行，路由拦截/重写/认证                | ★★★☆☆    |
| 9   | 图片优化                | next/image 自动 WebP/AVIF/resize/lazy                | ★★★☆☆    |
| 10  | PPR                     | Partial Prerendering，静态 shell + 动态 streaming    | ★★★☆☆    |

## 目录

- [⭐ 基础题 (Q1-Q8)](#⭐-基础题)
- [⭐⭐ 进阶题 (Q9-Q16)](#⭐⭐-进阶题)
- [⭐⭐⭐ 高级题 (Q17-Q22)](#⭐⭐⭐-高级题)
- [🎯 场景题 (Q23-Q25)](#🎯-场景题)

---

## ⭐ 基础题

### Q1: CSR、SSR、SSG、ISR 各是什么？有什么区别？

**思路分析**：这是 Next.js 面试的入门题，考察对四种渲染模式的理解。需要从渲染时机、SEO、性能、适用场景多维度对比。

**参考答案**：

| 渲染模式 | 全称                            | 渲染时机              | SEO   | TTFB          | 适用场景             |
| -------- | ------------------------------- | --------------------- | ----- | ------------- | -------------------- |
| **CSR**  | Client-Side Rendering           | 浏览器运行时          | ❌ 差 | 快（空 HTML） | 后台管理系统         |
| **SSR**  | Server-Side Rendering           | 每次请求时            | ✅ 好 | 慢（需渲染）  | 个性化页面、搜索结果 |
| **SSG**  | Static Site Generation          | 构建时                | ✅ 好 | 极快（CDN）   | 博客、文档、营销页   |
| **ISR**  | Incremental Static Regeneration | 构建时 + 后台增量更新 | ✅ 好 | 极快          | 电商列表、新闻聚合   |

**核心区别在于「谁在什么时候生成 HTML」**：

- CSR：浏览器通过 JS 生成 → 用户等待时间最长
- SSR：服务器在请求到达时生成 → 每次请求都有服务端开销
- SSG：构建工具在 `next build` 时生成 → 内容变化需要重新部署
- ISR：在 SSG 基础上增加后台重新生成 → 平衡了静态性能和数据新鲜度

---

### Q2: Next.js App Router 中有哪些特殊文件约定？各有什么作用？

**思路分析**：考察对 App Router 文件系统路由的理解。需列举核心特殊文件并说明用途。

**参考答案**：

App Router 通过文件名约定自动识别路由结构中的特殊文件：

| 文件            | 作用                  | 关键特性                                       |
| --------------- | --------------------- | ---------------------------------------------- |
| `page.tsx`      | 路由的 UI 内容        | 存在 page 才能使路由可访问                     |
| `layout.tsx`    | 共享布局              | **导航时不重新渲染**，保持状态（如滚动位置）   |
| `loading.tsx`   | 加载 UI               | 基于 Suspense，自动包裹 page 显示 loading 状态 |
| `error.tsx`     | 错误边界              | 捕获子树中的错误，必须是 Client Component      |
| `not-found.tsx` | 404 页面              | 调用 `notFound()` 函数时渲染                   |
| `template.tsx`  | 类似 layout           | 区别：每次导航**重新挂载**（重新创建实例）     |
| `route.ts`      | API Route             | HTTP 方法处理器（GET/POST/PUT/DELETE）         |
| `default.tsx`   | Parallel Route 的回退 | 当 slot 没有匹配的路由时渲染                   |

**重点区分 layout vs template**：

- `layout.tsx`：跨导航持久化，不会触发重新渲染，适合导航栏、侧边栏
- `template.tsx`：每次导航重新挂载，适合需要入场/退场动画的场景

---

### Q3: Server Component 和 Client Component 有什么区别？什么时候用 `"use client"`？

**思路分析**：RSC 是 App Router 的核心概念，必考题。需要从运行环境、能力、JS Bundle 大小三个维度回答。

**参考答案**：

**核心区别**：

| 维度      | Server Component（默认）    | Client Component（`"use client"`） |
| --------- | --------------------------- | ---------------------------------- |
| 运行环境  | 仅服务器                    | 服务器(SSR) + 浏览器               |
| JS Bundle | **零 JS 发到客户端**        | 包含在客户端 Bundle                |
| 可访问    | 数据库、文件系统、env 变量  | useState/useEffect/事件/浏览器 API |
| 不可做    | Hooks、事件处理、浏览器 API | 直接读数据库/文件                  |

**`"use client"` 使用时机**：

```
需要 useState/useReducer/useEffect → "use client"
需要 onClick/onChange 等事件        → "use client"
需要浏览器 API (window/document)    → "use client"
引用了使用了上述 API 的第三方库     → "use client"
只是展示数据/渲染静态内容           → 保持 Server Component ✅
```

**最佳实践**：把 `"use client"` 推到组件树的**叶子节点**，最大化 Server Component 的覆盖范围。

```tsx
// ✅ 好：只有交互按钮是 Client Component
// Server Component
export default async function Page() {
  const data = await db.query(...)  // 服务端获取数据
  return (
    <div>
      <h1>{data.title}</h1>        {/* 静态渲染，零 JS */}
      <LikeButton id={data.id} />  {/* 仅这个是 Client Component */}
    </div>
  )
}
```

---

### Q4: layout.tsx 和 page.tsx 有什么区别？layout 嵌套是如何工作的？

**思路分析**：考察对 App Router 布局系统的理解。关键点在于 layout **不会在导航时重新渲染**。

**参考答案**：

**区别**：

- `page.tsx`：路由的实际内容，每次导航都会重新渲染
- `layout.tsx`：包裹子路由的布局容器，导航时**不重新渲染、不丢失状态**

**嵌套机制**：

```
app/layout.tsx          → 包裹所有页面
  app/dashboard/layout.tsx   → 包裹 dashboard 下所有页面
    app/dashboard/page.tsx        → /dashboard 内容
    app/dashboard/settings/page.tsx → /dashboard/settings 内容
```

从 `/dashboard` 导航到 `/dashboard/settings` 时：

1. `app/layout.tsx` — ❌ 不重新渲染
2. `app/dashboard/layout.tsx` — ❌ 不重新渲染（侧边栏状态保持）
3. `app/dashboard/settings/page.tsx` — ✅ 渲染新内容

**重要**：layout 接收 `children` prop，它就是当前激活的子路由的`page.tsx`：

```tsx
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex">
      <Sidebar /> {/* 导航时不重新渲染 */}
      <main>{children}</main> {/* 这里渲染子 page */}
    </div>
  );
}
```

---

### Q5: Next.js App Router 中如何获取数据？与 Pages Router 有什么不同？

**思路分析**：对比新旧两种数据获取方式，重点说明 App Router 的简洁性。

**参考答案**：

**Pages Router（旧）** — 通过专用函数获取数据：

```tsx
// SSR
export async function getServerSideProps() {
  const data = await fetch(...)
  return { props: { data } }
}

// SSG
export async function getStaticProps() {
  const data = await fetch(...)
  return { props: { data }, revalidate: 60 }
}
```

**App Router（新）** — 直接在 Server Component 中 `async/await`：

```tsx
// 不需要特殊函数！直接 fetch
export default async function Page() {
  const data = await fetch("https://api.example.com/data", {
    next: { revalidate: 60 }, // ISR：60 秒后重新验证
  });
  const json = await data.json();
  return <div>{json.title}</div>;
}
```

**关键差异**：

1. **无需 `getServerSideProps`/`getStaticProps`**：Server Component 本身就运行在服务器，直接 fetch 即可
2. **自动请求去重**：同一渲染树中相同 URL 的 fetch 自动去重（Request Memoization）
3. **更细粒度**：数据获取发生在需要数据的组件内部，而非页面顶层
4. **缓存控制**：通过 `cache`、`next.revalidate`、`next.tags` 精确控制

---

### Q6: `<Link>` 组件的预取（Prefetching）机制是怎样的？

**思路分析**：考察对客户端导航和预取优化的理解。

**参考答案**：

`<Link>` 组件在链接进入浏览器视口时会**自动预取**目标路由的数据：

```tsx
import Link from 'next/link'

// 默认：进入视口时自动预取
<Link href="/about">关于</Link>

// 禁用预取
<Link href="/heavy" prefetch={false}>重页面</Link>
```

**预取行为（App Router）**：

- **静态路由**：预取完整的 RSC Payload（包括数据）→ 导航几乎瞬时
- **动态路由**：仅预取到最近的 `loading.tsx` 边界的共享布局 → 导航时先显示 loading，内容后续加载
- **Router Cache**：预取结果存储在客户端 Router Cache 中，有效期内再次导航直接使用缓存

**与 `<a>` 标签的区别**：

- `<a>`：全页面刷新（完整 HTTP 请求 + HTML 解析 + 资源加载）
- `<Link>`：客户端导航（仅获取变化部分的 RSC Payload，布局保持不变）

---

### Q7: `next/image` 是如何优化图片的？

**思路分析**：图片优化是 Web 性能的重要话题，考察对 next/image 内置优化能力的理解。

**参考答案**：

`next/image` 提供以下自动优化：

1. **格式转换**：自动输出 WebP/AVIF（根据浏览器支持），比 PNG/JPEG 小 25-50%
2. **响应式尺寸**：根据设备宽度生成多个尺寸，通过 `srcset` 提供最合适的图片
3. **懒加载**：默认 `loading="lazy"`，图片进入视口才加载（LCP 图片应设 `priority` 禁用）
4. **防止布局偏移（CLS）**：必须声明 `width`/`height`（或使用 `fill`），浏览器提前分配空间
5. **按需生成**：首次请求时服务端生成优化图片，后续请求直接使用缓存
6. **模糊占位**：`placeholder="blur"` 显示低分辨率模糊版本，渐进式加载

```tsx
import Image from "next/image";

<Image
  src="/hero.jpg"
  alt="首页封面"
  width={1200}
  height={630}
  priority // LCP 图片：禁用懒加载，优先加载
  placeholder="blur"
  quality={85} // 压缩质量（默认 75）
/>;
```

---

### Q8: 什么是动态路由？`generateStaticParams` 有什么用？

**思路分析**：考察动态路由和预渲染的关系。

**参考答案**：

**动态路由**：用方括号 `[param]` 命名的文件夹，匹配任意值：

```
app/blog/[slug]/page.tsx → /blog/hello-world, /blog/my-post, ...
app/users/[id]/page.tsx  → /users/123, /users/456, ...
```

**`generateStaticParams`**：在构建时列出所有可能的参数值，让 Next.js 预生成静态页面（SSG）：

```tsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await fetch("https://api.example.com/posts").then((r) =>
    r.json(),
  );
  return posts.map((post: Post) => ({ slug: post.slug }));
  // 构建时生成：/blog/hello-world.html, /blog/my-post.html, ...
}

export default async function BlogPost({
  params,
}: {
  params: { slug: string };
}) {
  const post = await getPost(params.slug);
  return <article dangerouslySetInnerHTML={{ __html: post.html }} />;
}
```

**没有 `generateStaticParams` 的动态路路由**：默认在请求时动态渲染（SSR）。可以通过 `dynamicParams = false` 限制只允许预生成的路径。

---

## ⭐⭐ 进阶题

### Q9: RSC 序列化协议（RSC Wire Format）是什么？Server Component 的渲染产物是什么？

**思路分析**：深入 RSC 内部机制，属于进阶考察点。需理解 RSC Payload 的结构。

**参考答案**：

Server Component 的渲染产物**不是 HTML 字符串**，而是一种叫做 **RSC Payload** 的流式 JSON 格式：

```
0:["$","div",null,{"children":[
  ["$","h1",null,{"children":"用户名"}],
  ["$","$L1",null,{"userId":"123","initialName":"张三"}]
]}]
1:I["./interactive-profile.tsx",["chunk-abc123"],"InteractiveProfile"]
```

**格式解读**：

- `$` — React 元素标记
- `$L1` — 延迟加载的 Client Component 引用（L = Lazy）
- `1:I[...]` — Client Component 的模块引用（告诉浏览器去加载哪个 JS chunk）

**关键点**：

1. RSC Payload 只传输**组件树的结构和数据**，不传输 Server Component 的代码
2. Client Component 在 Payload 中只是一个**引用**，浏览器根据引用加载对应 JS
3. 支持**流式传输**：Suspense 边界内的内容可以后续流式发送，不阻塞初始响应
4. 同一路由在首次加载时生成 RSC Payload + HTML（用于 SSR），客户端导航时只传输 RSC Payload（不需要 HTML）

**与传统 SSR 的区别**：传统 SSR 输出 HTML 字符串，Hydration 后完全丢弃。RSC Payload 保留了组件树结构，支持**增量更新**。

---

### Q10: Server Actions 的原理是什么？什么是 Progressive Enhancement？

**思路分析**：考察对 Server Actions 内部工作原理的理解，以及渐进增强的概念。

**参考答案**：

**Server Actions 原理**：

1. 编译时，每个 `"use server"` 函数被分配一个唯一的 **Action ID**
2. 客户端的 `<form action={serverAction}>` 被编译为包含 Action ID 的隐藏字段
3. 表单提交时，浏览器发送 POST 请求（带 `FormData`）到当前页面 URL
4. Next.js 服务器根据 Action ID 找到对应函数并执行
5. 执行完成后返回新的 RSC Payload，客户端更新 UI

```
用户提交表单
  → POST 请求（FormData + Action ID）
  → Next.js 路由匹配 action
  → 服务器执行 Server Action
  → 可能触发 revalidatePath/revalidateTag
  → 返回更新后的 RSC Payload
  → 客户端无刷新更新 UI
```

**Progressive Enhancement（渐进增强）**：

Server Actions 的表单在 **JavaScript 未加载时也能工作**：

- 没有 JS → 浏览器原生表单提交（POST 请求 → 全页面刷新）
- 有 JS → React 拦截提交（POST 请求 → 流式更新，无刷新）

这意味着：

1. 慢网络用户在 JS 加载前就能提交表单
2. 搜索引擎爬虫能正常处理表单
3. 即使 JS 出错，核心功能仍然可用

---

### Q11: Next.js 的四层缓存机制是什么？分别解决什么问题？

**思路分析**：缓存是 Next.js 性能的核心，也是最容易混淆的部分。逐层解释。

**参考答案**：

| 层级 | 名称                | 位置             | 读写粒度                | 生命周期                       |
| ---- | ------------------- | ---------------- | ----------------------- | ------------------------------ |
| L1   | Request Memoization | 服务器（内存）   | 单个 fetch URL          | 一次渲染（请求结束即失效）     |
| L2   | Data Cache          | 服务器（持久化） | 单个 fetch 结果         | 直到手动 revalidate 或时间到期 |
| L3   | Full Route Cache    | 服务器（持久化） | 整页 RSC Payload + HTML | 直到 revalidate（仅静态路由）  |
| L4   | Router Cache        | 客户端（浏览器） | 路由的 RSC Payload      | 会话期间（Next.js 15 默认 0）  |

**详解**：

**L1 Request Memoization**：同一渲染树中多个组件 fetch 相同 URL → 自动去重，只发一次请求。

```tsx
// 两个组件 fetch 同一 URL，实际只发一次请求
async function UserName() {
  const user = await fetch("/api/user/1"); // 请求 1
  return <h1>{user.name}</h1>;
}
async function UserEmail() {
  const user = await fetch("/api/user/1"); // 去重，复用请求 1 的结果
  return <p>{user.email}</p>;
}
```

**L2 Data Cache**：fetch 结果持久化存储在服务器，跨请求/跨部署有效，通过 `revalidate` 控制更新。

**L3 Full Route Cache**：静态路由整页缓存，构建时生成。

**L4 Router Cache**：客户端浏览器内存中缓存已访问的路由，前进/后退时直接使用。

**缓存失效方法**：

- `revalidatePath('/path')` — 按路径失效 L2 + L3
- `revalidateTag('tag')` — 按标签失效 L2 + L3
- `router.refresh()` — 清除 L4 并重新请求
- `next: { revalidate: N }` — 时间到期自动失效 L2

---

### Q12: Streaming SSR 是如何与 React Suspense 配合工作的？

**思路分析**：考察 React 18 流式渲染在 Next.js 中的应用。

**参考答案**：

**传统 SSR 的问题**：必须等**所有数据**准备好才能发送 HTML → 最慢的数据源决定了整体 TTFB。

**Streaming SSR 的解决方案**：

1. 服务器先发送页面的**静态骨架 HTML**（不包含需要等待数据的部分）
2. 等待数据的部分用 Suspense `fallback` 占位
3. 数据就绪后，服务器**流式追加** HTML 片段 + 一段内联 `<script>`
4. 浏览器执行脚本，将 fallback 替换为真实内容

```tsx
export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1> {/* 立即发送 */}
      <Suspense fallback={<Skeleton />}>
        <SlowChart /> {/* 数据就绪后流式发送 */}
      </Suspense>
      <Suspense fallback={<Skeleton />}>
        <SlowerTable /> {/* 更慢的数据也独立流式发送 */}
      </Suspense>
    </div>
  );
}
```

**时间线**：

```
0ms   → 发送 <h1>Dashboard</h1> + 两个 Skeleton
800ms → SlowChart 数据就绪 → 流式发送 Chart HTML → 替换第一个 Skeleton
2000ms→ SlowerTable 数据就绪 → 流式发送 Table HTML → 替换第二个 Skeleton
```

**优势**：

- TTFB 极快（不等数据即可发送骨架）
- 每个 Suspense 边界独立加载，用户逐步看到内容
- 慢的数据源不阻塞快的

---

### Q13: Middleware 在 Next.js 中的工作原理是什么？有哪些常见用途？

**思路分析**：考察 Middleware 的执行时机和 Edge Runtime 限制。

**参考答案**：

**工作原理**：

- Middleware 在**请求到达 Server Component / API Route 之前**执行
- 运行在 **Edge Runtime**（V8 Isolate，非 Node.js），启动极快（~1ms）
- 项目根目录只有一个 `middleware.ts`，通过 `matcher` 配置匹配路由

**常见用途**：

```tsx
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // 1. 鉴权：未登录用户重定向
  const token = request.cookies.get("token")?.value;
  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // 2. 国际化：根据 Accept-Language 重定向
  const locale = request.headers.get("accept-language")?.split(",")[0];
  if (locale?.startsWith("zh") && !request.nextUrl.pathname.startsWith("/zh")) {
    return NextResponse.redirect(
      new URL(`/zh${request.nextUrl.pathname}`, request.url),
    );
  }

  // 3. A/B 测试：随机分配变体
  const response = NextResponse.next();
  if (!request.cookies.has("ab-variant")) {
    response.cookies.set("ab-variant", Math.random() > 0.5 ? "A" : "B");
  }

  // 4. 日志/监控
  response.headers.set("x-request-id", crypto.randomUUID());

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**Edge Runtime 限制**：不能使用 Node.js API（如 `fs`、`path`）、不能使用大型 npm 包、执行时间有限。

---

### Q14: Parallel Routes 和 Intercepting Routes 分别是什么？给出实际用例。

**思路分析**：App Router 的高级路由特性，考察理解深度。

**参考答案**：

**Parallel Routes（`@slotName`）**：在同一个 layout 中**同时渲染多个页面**。

用例：Dashboard 多面板 — 左侧主内容、右侧分析图表可以独立加载和出错：

```
app/dashboard/
├── layout.tsx         # 接收 children + @analytics + @team
├── page.tsx          # children slot
├── @analytics/
│   ├── page.tsx      # 分析面板
│   └── error.tsx     # 分析面板出错时独立处理
└── @team/
    └── page.tsx      # 团队面板
```

```tsx
// layout.tsx
export default function Layout({
  children,
  analytics,
  team,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  team: React.ReactNode;
}) {
  return (
    <div>
      <main>{children}</main>
      <aside>
        {analytics}
        {team}
      </aside>
    </div>
  );
}
```

**Intercepting Routes（`(.)`）**：在当前布局中**拦截导航到其他路由**。

用例：Instagram 式的图片浏览 — 列表页点击图片弹出 Modal，直接访问 URL 显示完整页面：

```
app/
├── feed/page.tsx         # 图片列表
├── photo/[id]/page.tsx   # 直接访问的完整图片页面
└── @modal/
    └── (.)photo/[id]/
        └── page.tsx      # 拦截导航，显示为 Modal
```

- 从 feed 点击图片 → 拦截路由生效 → 显示在 Modal 中
- 直接访问 `/photo/123` → 显示完整页面
- 刷新 Modal 状态 → 变成完整页面

---

### Q15: Pages Router 到 App Router 的迁移策略是什么？

**思路分析**：实际工程问题，考察迁移经验和两者差异的深入理解。

**参考答案**：

**渐进式迁移策略**（`pages/` 和 `app/` 可以共存）：

**第一步：布局迁移**

```
// 旧: pages/_app.tsx + pages/_document.tsx
// 新: app/layout.tsx（合并两者功能）
```

**第二步：逐页面迁移**

```
pages/about.tsx → app/about/page.tsx
pages/blog/[slug].tsx → app/blog/[slug]/page.tsx
```

**第三步：数据获取迁移**

```tsx
// 旧: getServerSideProps
export async function getServerSideProps() {
  return { props: { data } };
}

// 新: 直接在 Server Component 中 fetch
export default async function Page() {
  const data = await getData();
  return <div>{data}</div>;
}
```

**第四步：API Routes 迁移**

```tsx
// 旧: pages/api/hello.ts
export default function handler(req, res) {
  res.json({ msg: "hello" });
}

// 新: app/api/hello/route.ts
export async function GET() {
  return Response.json({ msg: "hello" });
}
```

**注意事项**：

- 同一路由不能同时存在于 `pages/` 和 `app/` 中
- App Router 优先级高于 Pages Router
- 全局状态管理（如 Redux Provider）需要移到 Client Component 中

---

### Q16: Edge Runtime 和 Node.js Runtime 有什么区别？在 Next.js 中如何选择？

**思路分析**：考察对两种运行时的理解和选型能力。

**参考答案**：

| 维度         | Edge Runtime                            | Node.js Runtime      |
| ------------ | --------------------------------------- | -------------------- |
| 基础设施     | V8 Isolate（Cloudflare Workers 类似）   | 完整 Node.js 进程    |
| 启动速度     | ~1ms 冷启动                             | ~250ms 冷启动        |
| 代码大小限制 | 通常 1-4MB                              | 无限制               |
| API 支持     | Web APIs（fetch/crypto/URL）            | 完整 Node.js API     |
| 文件系统     | ❌ 无 `fs`                              | ✅ 支持              |
| 数据库驱动   | 仅 HTTP 协议（Prisma Edge/PlanetScale） | 所有驱动（TCP 连接） |
| 部署位置     | 全球边缘节点（CDN 级别）                | 特定区域数据中心     |

**选择建议**：

- **Edge Runtime**：Middleware（默认）、简单 API 路由、不需要 Node.js API 的场景
- **Node.js Runtime**：需要文件系统、需要传统数据库驱动、需要大型 npm 包

```tsx
// 在 Route Handler 中指定 Runtime
export const runtime = "edge"; // 或 'nodejs'（默认）

export async function GET() {
  return new Response("Hello from Edge!");
}
```

---

## ⭐⭐⭐ 高级题

### Q17: 如何用 Next.js 实现多租户 SaaS 架构？

**思路分析**：考察架构设计能力。需要处理域名路由、数据隔离、租户识别。

**参考答案**：

**方案：Middleware + 子域名路由 + 动态数据源**

```tsx
// middleware.ts — 从子域名提取租户标识
export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  // acme.myapp.com → tenant = 'acme'
  const tenant = hostname.split(".")[0];

  if (tenant && tenant !== "www" && tenant !== "myapp") {
    // 将租户信息注入请求头
    const response = NextResponse.next();
    response.headers.set("x-tenant", tenant);

    // 或通过 URL 重写实现路由
    const url = request.nextUrl.clone();
    url.pathname = `/tenant/${tenant}${url.pathname}`;
    return NextResponse.rewrite(url);
  }
}
```

```tsx
// app/tenant/[slug]/layout.tsx — 租户 Layout
import { getTenantConfig } from "@/lib/tenant";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const config = await getTenantConfig(params.slug);

  return (
    <div style={{ "--primary": config.primaryColor } as React.CSSProperties}>
      <header>{config.logo && <img src={config.logo} alt="" />}</header>
      {children}
    </div>
  );
}
```

**数据隔离策略**：

1. **行级隔离（RLS）**：同一数据库，每个查询加 `WHERE tenant_id = ?`
2. **Schema 隔离**：同一数据库，不同 Schema（PostgreSQL）
3. **数据库隔离**：不同租户使用不同数据库连接

**追问方向**：

- 如何处理自定义域名（CNAME）？→ Middleware 查表映射
- 如何做租户级别的资源限制？→ Middleware + Rate Limiting
- 缓存如何隔离？→ cache key 包含 tenant ID

---

### Q18: Next.js + AI Streaming（使用 Vercel AI SDK）如何实现？

**思路分析**：考察 AI 应用场景下 Next.js 的流式能力。

**参考答案**：

**后端 — Route Handler 流式返回 AI 响应**：

```tsx
// app/api/chat/route.ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
    system: "你是一个帮助用户学习 Next.js 的助手。",
  });

  return result.toDataStreamResponse(); // 流式 HTTP 响应
}
```

**前端 — Client Component 消费流**：

```tsx
"use client";
import { useChat } from "ai/react";

export function ChatUI() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      api: "/api/chat",
    });

  return (
    <div>
      {messages.map((m) => (
        <div
          key={m.id}
          className={m.role === "user" ? "text-right" : "text-left"}
        >
          <p>{m.content}</p>
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="输入问题..."
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "思考中..." : "发送"}
        </button>
      </form>
    </div>
  );
}
```

**Server Action 版本（更简洁）**：

```tsx
"use server";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { createStreamableValue } from "ai/rsc";

export async function chat(messages: Message[]) {
  const stream = createStreamableValue("");
  (async () => {
    const result = streamText({
      model: openai("gpt-4o"),
      messages,
    });
    for await (const text of result.textStream) {
      stream.update(text);
    }
    stream.done();
  })();
  return { output: stream.value };
}
```

**追问方向**：

- 如何处理 AI 响应的 Token 计费？→ 中间件计数 + usage 回调
- 如何实现对话历史持久化？→ Server Action 写入数据库
- 如何实现 RAG？→ 在 Route Handler 中先检索向量数据库

---

### Q19: 大规模 ISR 缓存策略如何设计？（如 10 万+ 商品页面）

**思路分析**：考察对 ISR 的深入理解和大规模应用的工程经验。

**参考答案**：

**挑战**：10 万+ 商品页面不可能全部在构建时生成（构建时间太长）。

**分层策略**：

```tsx
// 1. 热门商品：构建时预生成（Top 1000）
export async function generateStaticParams() {
  const hotProducts = await db.product.findMany({
    where: { pageViews: { gt: 1000 } },
    take: 1000,
    orderBy: { pageViews: "desc" },
  });
  return hotProducts.map((p) => ({ id: p.id.toString() }));
}

// 2. 长尾商品：On-demand ISR（首次访问时生成）
export const dynamicParams = true; // 允许未预生成的路径

// 3. 重新验证策略
export const revalidate = 3600; // 基于时间：1 小时

// 4. 价格/库存变化时主动失效
// app/api/webhook/route.ts
import { revalidateTag } from "next/cache";

export async function POST(req: Request) {
  const { productId, type } = await req.json();

  if (type === "price_change" || type === "stock_change") {
    revalidateTag(`product-${productId}`);
  }
  return Response.json({ revalidated: true });
}
```

**缓存与 CDN 架构**：

```
用户请求 → CDN（Full Route Cache）
          ├── 命中 → 直接返回（TTFB < 50ms）
          └── 未命中 → Origin Server
                      ├── Data Cache 命中 → 生成 HTML → 更新 CDN
                      └── Data Cache 未命中 → 查数据库 → 缓存 → 生成 HTML
```

**追问方向**：

- CDN 缓存和 Next.js 缓存如何协调？→ Cache-Control + Stale-While-Revalidate
- 如何监控缓存命中率？→ 自定义 Header + 监控系统
- 构建时间优化？→ Turborepo 缓存、增量构建、CI 并行

---

### Q20: Partial Prerendering (PPR) 的原理是什么？解决了什么问题？

**思路分析**：Next.js 15 的前沿特性，考察对最新技术的跟进。

**参考答案**：

**PPR 解决的问题**：传统方案中，一个路由要么完全静态（SSG），要么完全动态（SSR）。但真实页面往往是混合的 — 导航栏/侧边栏是静态的，用户信息/购物车是动态的。

**PPR 原理**：

1. **构建时**：预渲染所有静态内容 → 生成 HTML Shell（含 Suspense fallback 占位）
2. **请求时**：CDN 立即返回静态 Shell → 服务器**同时**开始渲染动态内容
3. **流式注入**：动态内容就绪后流式发送给浏览器 → 替换 fallback

```
构建时生成：
┌──────────────────────────┐
│ [静态] 网站Header         │
│ [静态] 产品描述           │
│ [占位] <Suspense>价格</> │  ← 动态「洞」
│ [占位] <Suspense>库存</> │  ← 动态「洞」
│ [静态] Footer             │
└──────────────────────────┘

请求时：
1. CDN 立即返回静态 HTML（带 Skeleton 占位）   → TTFB < 50ms
2. 服务器开始渲染动态部分
3. 价格数据就绪 → 流式发送替换 Skeleton       → ~200ms
4. 库存数据就绪 → 流式发送替换 Skeleton       → ~400ms
```

**技术实现**：PPR 自动根据 **Suspense 边界**区分静态和动态。Suspense 内部的组件如果使用了动态函数（`cookies()`/`headers()`/`searchParams`/uncached `fetch`），就被标记为动态「洞」。

```tsx
export default function ProductPage() {
  return (
    <div>
      <StaticHeader /> {/* 静态：预渲染 */}
      <StaticDescription /> {/* 静态：预渲染 */}
      <Suspense fallback={<PriceSkeleton />}>
        <DynamicPrice /> {/* 动态洞：流式填充 */}
      </Suspense>
      <StaticFooter /> {/* 静态：预渲染 */}
    </div>
  );
}
```

---

### Q21: 如何设计自托管 Next.js 的高可用架构？

**思路分析**：考察脱离 Vercel 后的生产级部署能力。

**参考答案**：

**架构设计**：

```
                        ┌──── Next.js Instance 1 (Node.js)
用户 → CDN → L7 LB ────┼──── Next.js Instance 2 (Node.js)
       ↑               └──── Next.js Instance 3 (Node.js)
       │                        │
     静态资源                ┌───┤
     (_next/static)        Redis Cache    PostgreSQL
                          (Data Cache)    (数据库)
```

**关键配置**：

```js
// next.config.js
module.exports = {
  output: "standalone", // 自包含输出
  images: {
    loader: "custom", // 自托管图片优化
    loaderFile: "./lib/image-loader.ts",
  },
};
```

**Docker + Kubernetes 部署**：

```yaml
# k8s deployment
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: nextjs
          image: myapp:latest
          ports:
            - containerPort: 3000
          env:
            - name: HOSTNAME
              value: "0.0.0.0"
          resources:
            requests: { memory: "256Mi", cpu: "200m" }
            limits: { memory: "512Mi", cpu: "500m" }
          readinessProbe:
            httpGet: { path: /api/health, port: 3000 }
```

**自托管需要自行解决的问题**：

1. **图片优化**：使用 Sharp 库或外部 CDN（Cloudflare Images/Imgix）
2. **ISR 缓存共享**：多实例间通过 Redis 共享 Data Cache（`cacheHandler`）
3. **增量部署**：蓝绿部署或金丝雀发布，避免缓存不一致
4. **静态资源 CDN**：`_next/static/` 上传到 CDN，配置 `assetPrefix`

**追问方向**：

- 多实例间 ISR 缓存如何一致？→ 自定义 Cache Handler + Redis
- 如何实现零停机部署？→ Rolling Update + 健康检查

---

### Q22: 如何优化 Next.js 应用的 LCP（Largest Contentful Paint）？

**思路分析**：综合性能优化题，考察从渲染策略到资源加载的全链路理解。

**参考答案**：

**LCP 分解**：LCP = TTFB + 资源加载时间 + 渲染时间

**Step 1: 减少 TTFB**

```tsx
// 使用 SSG/ISR 代替 SSR（CDN 直接返回）
export const revalidate = 3600

// 使用 Streaming SSR + Suspense（不等所有数据就绪）
<Suspense fallback={<Skeleton />}>
  <SlowComponent />
</Suspense>

// PPR（静态 shell 从 CDN 返回，动态部分流式填充）
```

**Step 2: 优化 LCP 元素加载**

```tsx
// 图片是 LCP 元素：标记 priority
<Image src="/hero.jpg" priority alt="" width={1200} height={630} />;

// 字体优化：避免 FOIT/FOUT
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"], display: "swap" });

// 预加载关键资源
// app/layout.tsx
export const metadata = {
  other: { link: [{ rel: "preload", href: "/hero.jpg", as: "image" }] },
};
```

**Step 3: 减少客户端 JS**

```tsx
// 最大化 Server Components（零 JS）
// 避免不必要的 "use client"
// 动态导入非关键 Client Components
const HeavyChart = dynamic(() => import("./HeavyChart"), {
  loading: () => <Skeleton />,
  ssr: false, // 仅客户端渲染（不影响 LCP）
});
```

**Step 4: 基础设施**

- CDN 缓存静态资源和 ISR 页面
- HTTP/2 或 HTTP/3 多路复用
- Brotli 压缩
- Edge Function 就近处理（Middleware）

**检测工具**：`next build` 输出页面大小 → Lighthouse → Web Vitals 监控

---

## 🎯 场景题

### Q23: 设计一个电商网站，不同页面应该选择什么渲染策略？

**思路分析**：综合应用题，需要对每种页面类型选择最合适的渲染策略并说明理由。

**参考答案**：

| 页面类型          | 渲染策略               | 理由                                       |
| ----------------- | ---------------------- | ------------------------------------------ |
| **首页**          | ISR（60s）             | 需要 SEO + 内容定期更新（推荐商品/Banner） |
| **商品列表页**    | ISR（300s）+ Streaming | SEO 重要 + 筛选条件动态 + 分页             |
| **商品详情页**    | ISR（3600s）+ PPR      | SEO 必须 + 静态描述 + 动态价格/库存        |
| **搜索结果页**    | SSR + Streaming        | 完全动态 + 需要 SEO                        |
| **购物车**        | CSR                    | 纯用户私有数据，不需要 SEO                 |
| **结账页**        | CSR                    | 安全敏感，不需要 SEO                       |
| **用户中心**      | CSR                    | 私有数据 + 高交互                          |
| **博客/帮助中心** | SSG                    | 内容稳定，构建时生成即可                   |

**商品详情页深入设计（PPR）**：

```tsx
export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProduct(params.id); // 缓存 1 小时

  return (
    <div>
      {/* 静态部分 — CDN 缓存 */}
      <h1>{product.name}</h1>
      <ProductImages images={product.images} />
      <ProductDescription description={product.description} />

      {/* 动态部分 — 流式填充 */}
      <Suspense fallback={<PriceSkeleton />}>
        <DynamicPrice productId={params.id} /> {/* 实时价格 */}
      </Suspense>

      <Suspense fallback={<StockSkeleton />}>
        <DynamicStock productId={params.id} /> {/* 实时库存 */}
      </Suspense>

      <Suspense fallback={<ReviewsSkeleton />}>
        <ProductReviews productId={params.id} /> {/* 用户评价 */}
      </Suspense>
    </div>
  );
}
```

---

### Q24: 如何用 Next.js 实现一个实时协作编辑功能？

**思路分析**：考察全栈能力，需结合 WebSocket/SSE + CRDT + React 状态管理。

**参考答案**：

**技术架构**：

```
                              ┌──── Next.js Server
用户 A (浏览器) ── WebSocket ──┤     (协调服务器)
用户 B (浏览器) ── WebSocket ──┤     ↓
用户 C (浏览器) ── WebSocket ──┘     Redis PubSub
                                    (多实例广播)
```

**方案：Yjs (CRDT) + WebSocket + Next.js**

```tsx
// 1. API Route — WebSocket 服务器
// app/api/collab/route.ts (使用 next-ws 或自定义 server)
import { WebSocketServer } from "ws";
import { setupWSConnection } from "y-websocket/bin/utils";

// 注意：标准 Next.js 不原生支持 WebSocket，需要自定义 server
// 或使用 Liveblocks/PartyKit 等第三方服务
```

```tsx
// 2. Client Component — 协作编辑器
"use client";

import { useEffect, useMemo } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export function CollaborativeEditor({ docId }: { docId: string }) {
  const ydoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    const provider = new WebsocketProvider(
      "wss://your-server.com",
      docId,
      ydoc,
    );

    const ytext = ydoc.getText("content");
    // 绑定到编辑器（如 TipTap/ProseMirror/Monaco）

    return () => {
      provider.disconnect();
      ydoc.destroy();
    };
  }, [docId, ydoc]);

  return <div id="editor" />;
}
```

```tsx
// 3. Server Component — 加载页面
// app/doc/[id]/page.tsx
import { db } from "@/lib/db";
import { CollaborativeEditor } from "./editor";

export default async function DocPage({ params }: { params: { id: string } }) {
  const doc = await db.document.findUnique({ where: { id: params.id } });
  if (!doc) return notFound();

  return (
    <div>
      <h1>{doc.title}</h1>
      <CollaborativeEditor docId={params.id} />
    </div>
  );
}
```

**生产建议**：使用 Liveblocks 或 PartyKit 而非自建 WebSocket，它们与 Next.js 深度集成，自动处理连接管理、离线同步、冲突解决。

---

### Q25: 一个 Next.js 应用首屏加载需要 7 秒，如何优化到 2 秒以内？

**思路分析**：综合性能优化场景题，需要系统化的排查和解决思路。

**参考答案**：

**Step 1: 诊断 — 定位瓶颈**

```bash
# 1. 构建分析
ANALYZE=true next build
# 查看：哪些包最大？First Load JS 总量多少？

# 2. Lighthouse / DevTools Performance
# TTFB? FCP? LCP? 哪个阶段最慢？

# 3. 服务端耗时
# 添加 Server Timing Header 测量数据获取时间
```

**Step 2: 根据瓶颈针对性优化**

**如果 TTFB 慢（服务端渲染耗时长）**：

```tsx
// A. 使用 ISR/SSG 代替 SSR
export const revalidate = 60

// B. Streaming SSR — 不等慢查询
<Suspense fallback={<Skeleton />}>
  <SlowDatabaseQuery />
</Suspense>

// C. 数据库查询优化（加索引、减少关联查询）
// D. 使用 Redis 缓存热点数据
```

**如果 JS Bundle 过大（下载+解析慢）**：

```tsx
// A. 审查 "use client" 边界 — 减少 Client Component 数量
// B. 动态导入非首屏组件
const HeavyComponent = dynamic(() => import("./Heavy"), { ssr: false });

// C. 替换大型依赖
// moment.js (300KB) → dayjs (2KB)
// lodash (72KB) → lodash-es (tree-shakeable)

// D. 检查是否有大型库被意外打包
// next.config.js
module.exports = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@heroicons/react"],
  },
};
```

**如果图片/资源加载慢**：

```tsx
// A. 使用 next/image，LCP 图片标记 priority
<Image src="/hero.jpg" priority width={1200} height={630} alt="" />;

// B. 使用 next/font 避免字体闪烁
import { Inter } from "next/font/google";

// C. CDN 加速静态资源
// next.config.js
module.exports = { assetPrefix: "https://cdn.example.com" };
```

**如果 Hydration 慢**：

```tsx
// A. 减少 Client Component 的数量和大小
// B. 使用 React.lazy 延迟加载非关键交互组件
// C. 检查 Hydration 错误（服务端 HTML 与客户端不一致）
```

**优化目标拆解**：

```
7秒 → 2秒 分解：
┌─────────────────────────────────────────┐
│ 阶段          │ 优化前  │ 优化后  │ 手段   │
│ TTFB          │ 2.5s   │ 0.3s   │ ISR+CDN │
│ 下载 JS/CSS   │ 2s     │ 0.5s   │ 减包+CDN │
│ 下载图片       │ 1.5s   │ 0.3s   │ next/image │
│ Hydration     │ 1s     │ 0.4s   │ RSC优化  │
│ 合计          │ 7s     │ 1.5s   │ ✅目标达成 │
└─────────────────────────────────────────┘
```

**Step 3: 持续监控**

```tsx
// app/layout.tsx 添加 Web Vitals 上报
import { SpeedInsights } from "@vercel/speed-insights/next";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
```

或使用 `reportWebVitals` 上报到自己的监控系统（Grafana/DataDog）。
