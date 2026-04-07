# Chatbot 全链路工程设计面试题

> 覆盖从 Web 浏览器到 GPU 推理返回的完整 Chatbot 工程链路

## 相关链接

- 对应技术资料：[Chatbot全链路工程设计](../../01-技术资料/09-AI-Agent工程化/14-Chatbot全链路工程设计.md)

## 题目导航

| 难度 | 题号 | 题目 |
|------|------|------|
| ⭐ 基础 | Q1 | SSE 和 WebSocket 在 Chatbot 场景下如何选型？ |
| ⭐ 基础 | Q2 | 如何实现流式 Markdown 的增量渲染？ |
| ⭐ 基础 | Q3 | Chatbot 的会话数据模型如何设计？ |
| ⭐ 基础 | Q4 | CDN 在 Chatbot 产品中的部署策略是什么？ |
| ⭐⭐ 进阶 | Q5 | 长连接场景下负载均衡有什么特殊挑战？ |
| ⭐⭐ 进阶 | Q6 | RAG 检索增强的完整 Pipeline 如何设计？ |
| ⭐⭐ 进阶 | Q7 | 消息分支（Regenerate/Edit）的数据结构如何设计？ |
| ⭐⭐ 进阶 | Q8 | 多级缓存策略在 Chatbot 中如何应用？ |
| ⭐⭐ 进阶 | Q9 | 如何设计用户级别的限流策略？ |
| ⭐⭐⭐ 高级 | Q10 | 多区域 Active-Active 部署如何处理会话一致性？ |
| ⭐⭐⭐ 高级 | Q11 | 数据库分片策略如何支撑千万级用户的会话存储？ |
| ⭐⭐⭐ 高级 | Q12 | Speculative Decoding 推理加速的原理和工程实现？ |
| ⭐⭐⭐ 高级 | Q13 | 输入输出内容安全审查 Pipeline 如何设计？ |
| 🎯 场景设计 | Q14 | 设计一个类 ChatGPT 的产品架构（支撑 100 万 DAU）|
| 🎯 场景设计 | Q15 | 设计 Perplexity 式搜索增强 AI 系统 |
| 🎯 场景设计 | Q16 | 大促/热点事件期间的降级策略设计 |

---

## ⭐ 基础题

### Q1: SSE 和 WebSocket 在 Chatbot 场景下如何选型？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

在 Chatbot 产品中，用户发送一条消息后，模型的推理结果需要以「逐 token 流式」的方式返回前端，而非等待全部生成完毕再一次性返回。这背后涉及两种主流的实时通信协议选型：**Server-Sent Events（SSE）** 和 **WebSocket**。

SSE 是一种基于 HTTP/1.1 的单向推送协议，服务端通过一个持久的 HTTP 连接向客户端持续发送事件流。它的最大优势是**天然兼容 HTTP 基础设施**——CDN、反向代理、负载均衡器、API 网关都能直接透传，无需额外配置。ChatGPT、Claude 等主流产品均采用 SSE 作为流式响应的传输协议。

WebSocket 则是全双工协议，客户端和服务端都可以随时发送消息。它适用于需要**双向高频通信**的场景，如多人协作编辑、实时游戏等。但在 Chatbot 场景中，通信模式本质是「用户发一条，模型回一段」，属于典型的**请求-流式响应**模式，全双工能力反而引入了不必要的复杂度。

#### 架构图

```
SSE 模式（ChatGPT 采用）:
┌──────────┐    POST /chat     ┌─────────────┐    gRPC stream   ┌──────────────┐
│  浏览器   │ ───────────────> │  API Gateway  │ ──────────────> │  推理服务     │
│          │ <─── SSE ──────── │  (Nginx/CF)   │ <── tokens ──── │  (vLLM/TGI)  │
└──────────┘  text/event-stream └─────────────┘                  └──────────────┘
   │                                │
   │ EventSource API               │ 标准 HTTP，CDN 友好
   │ 自动重连                       │ 无需 Upgrade 协商
   │ 浏览器原生支持                  │ 防火墙无阻碍

WebSocket 模式:
┌──────────┐  HTTP Upgrade    ┌─────────────┐   持久连接       ┌──────────────┐
│  浏览器   │ ──────────────> │  API Gateway  │ ──────────────> │  推理服务     │
│          │ <══ 全双工 ═════ │  (需WS支持)   │ <══ 全双工 ═══ │              │
└──────────┘                  └─────────────┘                  └──────────────┘
   │                                │
   │ 需要心跳保活                    │ 需要 Upgrade 支持
   │ 需要手动重连逻辑                │ 部分 CDN/代理不支持
   │ 状态管理更复杂                  │ 连接亲和性问题
```

#### 代码示例

```typescript
// SSE 客户端实现 —— 基于 fetch + ReadableStream（生产级）
async function streamChat(message: string, onToken: (t: string) => void) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, stream: true }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      }
    }
  }
}

// SSE 服务端实现 —— Node.js + Express
app.post('/api/chat', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
  });

  const stream = await llm.createCompletion({
    model: 'gpt-4',
    messages: req.body.messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
```

#### 关键对比

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| 通信方向 | 单向（服务端 → 客户端） | 全双工 |
| 协议基础 | HTTP/1.1 或 HTTP/2 | 独立的 ws:// 协议 |
| 基础设施兼容性 | 完全兼容 CDN / 反向代理 | 需要特殊配置 |
| 自动重连 | 浏览器原生支持 | 需要手动实现 |
| 连接数限制 | HTTP/1.1 下每域名 6 个 | 无硬性限制 |
| 二进制数据 | 不支持（仅文本） | 原生支持 |
| 主流产品选型 | ChatGPT、Claude、Gemini | Discord Bot、Slack |
| 适用场景 | 请求-流式响应 | 双向高频通信 |

#### 实际案例

**OpenAI ChatGPT** 的流式接口采用 SSE 协议，其 API 端点 `POST /v1/chat/completions` 当 `stream: true` 时返回 `text/event-stream`。在高峰期，ChatGPT 每秒处理超过 1000 万次 SSE 事件推送，单个响应的 token 流持续 5-30 秒。SSE 的 HTTP 兼容性使其能够无缝接入 Cloudflare CDN 进行全球边缘加速，无需额外的 WebSocket 代理层。OpenAI 在 2023 年的工程博客中提到，选择 SSE 的核心原因是"减少基础设施复杂度，HTTP 生态的每个环节都能直接理解和处理 SSE 流"。

#### 面试追问

1. **HTTP/1.1 下 SSE 有每域名 6 个连接的限制，如何解决？** 提示：HTTP/2 多路复用、域名分片、或在 SSE 断开后按需重建连接。
2. **如果产品需要支持"用户中途打断生成"，SSE 和 WebSocket 分别如何实现？** 提示：SSE 通过 `AbortController` 关闭连接，WebSocket 发送取消指令帧。
3. **SSE 在弱网环境下的重连策略如何设计？** 提示：指数退避 + Last-Event-ID + 服务端断点续传支持。

</details>

---

### Q2: 如何实现流式 Markdown 的增量渲染？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

当 LLM 逐 token 输出响应时，内容往往包含丰富的 Markdown 格式——标题、加粗、代码块、表格、LaTeX 公式等。前端需要在 token **持续到达**的过程中实时渲染这些格式，而不是等全部内容接收完毕后再解析。这就是「流式 Markdown 增量渲染」的核心挑战。

最大的难点在于 Markdown 的**语法边界不确定性**。当收到 `` ` `` 字符时，它可能是行内代码的开始，也可能是三个反引号代码块的前缀；当收到 `*` 时，可能是加粗、斜体或列表项的开始。因此，渲染引擎需要维护一个**状态机**，在已接收内容的基础上进行「乐观解析」——先按当前最可能的语法结构渲染，当后续 token 到达后修正之前的判断。

工业界的主流方案是**增量解析 + 虚拟 DOM diff**。每次收到新 token 后，将完整的已接收文本重新交给 Markdown 解析器（如 `marked`、`markdown-it`），生成新的 AST，然后通过 React 的 diff 算法只更新变化的 DOM 节点。虽然听起来每次都"全量解析"很浪费，但现代解析器处理 10KB 文本的耗时通常不超过 1ms，配合 `requestAnimationFrame` 节流后完全不影响用户体验。

#### 架构图

```
Token 流入渲染管线:

  token₁  token₂  token₃  ...  tokenₙ
    │       │       │             │
    ▼       ▼       ▼             ▼
┌─────────────────────────────────────┐
│         累积文本缓冲区               │  "## Hello\n```py\nprint("
│         (Accumulated Buffer)        │
└──────────────┬──────────────────────┘
               │
    ┌──────────▼──────────┐
    │  rAF 节流 (16ms)     │  ← 每帧最多解析一次
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │  Markdown Parser     │  marked / markdown-it
    │  全量解析 → AST       │  ~0.5ms per 10KB
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │  AST → React VDOM    │  react-markdown / rehype
    │  增量 Diff 渲染       │  只更新变化节点
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │  特殊块处理           │
    │  • 代码块: 增量高亮   │  shiki / prism
    │  • LaTeX: KaTeX 渲染  │  行内 vs 块级
    │  • 表格: 流式构建     │  等待行结束
    └──────────┬──────────┘
               │
        浏览器 DOM 更新
```

#### 代码示例

```typescript
import { useRef, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

// 流式 Markdown 渲染器核心 Hook
function useStreamRenderer() {
  const bufferRef = useRef('');
  const [rendered, setRendered] = useState('');
  const rafRef = useRef<number | null>(null);

  const appendToken = useCallback((token: string) => {
    bufferRef.current += token;

    // rAF 节流：每帧最多触发一次渲染
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        setRendered(bufferRef.current);
        rafRef.current = null;
      });
    }
  }, []);

  // 处理未闭合语法块的临时修复
  const sanitizePartial = useCallback((text: string): string => {
    // 检测未闭合的代码块
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      text += '\n```';  // 临时闭合代码块
    }
    // 检测未闭合的加粗标记
    const boldCount = (text.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
      text += '**';
    }
    return text;
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
    setRendered('');
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return { rendered, appendToken, sanitizePartial, reset };
}

// 流式消息组件
function StreamingMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const lang = className?.replace('language-', '') || '';
          const codeStr = String(children).replace(/\n$/, '');
          return lang ? (
            <SyntaxHighlighter language={lang}>
              {codeStr}
            </SyntaxHighlighter>
          ) : (
            <code className="inline-code" {...props}>{children}</code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

#### 关键对比

| 维度 | 全量重解析方案 | 增量 AST Patch 方案 |
|------|--------------|-------------------|
| 实现复杂度 | 低（直接用现成库） | 高（需自研 diff 算法） |
| 解析性能 | 10KB 文本 ~0.5ms | 理论更优但实际差距小 |
| 语法修正 | 自动处理（每次全量） | 需手动处理中间状态 |
| 代码高亮 | 每次重新高亮（可优化） | 增量高亮，性能更好 |
| 闪烁问题 | 依赖 VDOM diff 质量 | 更少闪烁 |
| 业界采用 | ChatGPT、Claude | 少数自研团队 |

#### 实际案例

**ChatGPT 的前端渲染方案**采用 `react-markdown` + `remark-gfm` + `rehype-katex` 的组合，本质上就是全量重解析方案。通过 React 的虚拟 DOM diff，即使每次 token 到达都重新解析完整文本，实际的 DOM 操作也被最小化。ChatGPT 在长响应（超过 2000 token）时的渲染帧率稳定在 55-60 FPS，每次解析耗时不超过 2ms。其代码高亮使用 `highlight.js` 的增量模式，避免长代码块的重复高亮计算。对于 LaTeX 公式，ChatGPT 使用 KaTeX 而非 MathJax，因为 KaTeX 的渲染速度快 10-100 倍，更适合流式场景。

#### 面试追问

1. **如果用户快速滚动查看历史消息，同时新消息仍在流式生成，如何避免 UI 卡顿？** 提示：虚拟列表（Virtualization）+ 将流式渲染限制在可视区域内。
2. **代码块在流式渲染时语言标识还未到达（如 `` ``` `` 后面的 `python` 还没来），如何处理？** 提示：先渲染为纯文本代码块，语言标识到达后再触发语法高亮。
3. **用户复制流式渲染中的消息内容时，如何确保复制的是原始 Markdown 而非渲染后的 HTML？** 提示：在 DOM 上设置 `data-raw` 属性存储原始文本，通过 `copy` 事件拦截。

</details>

---

### Q3: Chatbot 的会话数据模型如何设计？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Chatbot 的数据模型是整个系统的基石，它需要同时满足**用户体验**和**工程效率**两个维度的需求。从用户视角看，一个 Chatbot 有"对话列表→单个对话→消息列表"的层级结构；从工程视角看，还需要支持消息分支（Regenerate）、多模态附件、工具调用记录、token 用量统计等复杂功能。

核心实体通常包括三层：**Conversation（对话）**、**Message（消息）** 和 **MessageVersion（消息版本）**。Conversation 是用户左侧栏看到的一个对话会话；Message 表示对话中的一轮交互；MessageVersion 则支持 Regenerate 和 Edit 场景下同一位置可以有多个版本的需求。这种三层结构既保持了数据模型的清晰，也为后续的分支功能提供了扩展空间。

除了核心消息数据，还需要考虑**元数据层**的设计：每条消息的 token 使用量、模型参数配置、响应延迟等指标数据，以及用户的反馈评价（thumbs up/down）。这些元数据对产品改进和成本控制至关重要，但不应与消息正文混在同一张表中，以避免高频写入影响消息读取的性能。

#### 架构图

```
数据模型 ER 关系图:

┌──────────────────────────────────┐
│           User                    │
│  ─────────────────────────────   │
│  id          UUID  PK             │
│  email       VARCHAR              │
│  plan_tier   ENUM(free,plus,team) │
│  created_at  TIMESTAMP            │
└──────────────┬───────────────────┘
               │ 1:N
┌──────────────▼───────────────────┐
│        Conversation               │
│  ─────────────────────────────   │
│  id          UUID  PK             │
│  user_id     UUID  FK → User      │
│  title       VARCHAR(200)         │
│  model       VARCHAR(50)          │
│  sys_prompt  TEXT                  │
│  is_archived BOOLEAN              │
│  created_at  TIMESTAMP            │
│  updated_at  TIMESTAMP            │
└──────────────┬───────────────────┘
               │ 1:N
┌──────────────▼───────────────────┐
│          Message                  │
│  ─────────────────────────────   │
│  id          UUID  PK             │
│  conv_id     UUID  FK → Conv      │
│  role        ENUM(user,assistant) │
│  position    INT                  │
│  active_ver  UUID  FK → Version   │
│  created_at  TIMESTAMP            │
└──────────────┬───────────────────┘
               │ 1:N
┌──────────────▼───────────────────┐
│      MessageVersion               │
│  ─────────────────────────────   │
│  id          UUID  PK             │
│  message_id  UUID  FK → Message   │
│  content     TEXT                  │
│  model       VARCHAR(50)          │
│  tokens_in   INT                  │
│  tokens_out  INT                  │
│  latency_ms  INT                  │
│  finish_reason VARCHAR(20)        │
│  created_at  TIMESTAMP            │
└──────────────────────────────────┘
```

#### 代码示例

```python
# SQLAlchemy 数据模型定义（核心三层结构）
from sqlalchemy import Column, String, Integer, Boolean, Text, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base
import uuid
import enum

Base = declarative_base()

class PlanTier(enum.Enum):
    FREE = "free"
    PLUS = "plus"
    TEAM = "team"

class Role(enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"

class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        Index("idx_conv_user_updated", "user_id", "updated_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String(200), default="New Chat")
    model = Column(String(50), default="gpt-4")
    system_prompt = Column(Text, nullable=True)
    is_archived = Column(Boolean, default=False)
    message_count = Column(Integer, default=0)

    messages = relationship("Message", order_by="Message.position", lazy="dynamic")

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_msg_conv_pos", "conversation_id", "position"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"))
    role = Column(Enum(Role), nullable=False)
    position = Column(Integer, nullable=False)
    active_version_id = Column(UUID(as_uuid=True), nullable=True)

    versions = relationship("MessageVersion", back_populates="message")

class MessageVersion(Base):
    __tablename__ = "message_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id"))
    content = Column(Text, nullable=False)
    model = Column(String(50))
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    finish_reason = Column(String(20))

    message = relationship("Message", back_populates="versions")
```

#### 关键对比

| 维度 | 扁平消息模型 | 三层分版本模型 |
|------|------------|--------------|
| 数据结构 | 单表 messages，无版本 | Conversation → Message → Version |
| Regenerate 支持 | 删除旧消息，创建新消息 | 在同一 Message 下新增 Version |
| 历史完整性 | 丢失被覆盖的回答 | 保留所有生成版本 |
| 查询复杂度 | 简单 SELECT | 需 JOIN active_version |
| 存储效率 | 更省空间 | 更多冗余但可审计 |
| 适用阶段 | MVP / 原型验证 | 生产级产品 |

#### 实际案例

**ChatGPT 的数据模型**采用了类似的分层设计。通过浏览器 DevTools 观察其 API 响应可以发现，每个 conversation 对象包含一个 `mapping` 字段，其中每个 message 节点都有 `parent` 和 `children` 指针，形成一棵**消息树**而非简单的线性列表。这种树形结构支撑了 ChatGPT 的 Edit 和 Regenerate 功能——用户编辑中间某条消息后，会从该节点分叉出一个新的子树分支。据估算，ChatGPT 在 2024 年的日均消息量超过 5 亿条，对应的 `message_versions` 数据量约为消息量的 1.3 倍（约 30% 的消息有过 Regenerate 操作）。

#### 面试追问

1. **如果用户删除一条中间的消息，后续消息的 position 如何处理？** 提示：软删除 + 保持 position 不变，或使用稀疏编号（10, 20, 30）预留空间。
2. **消息内容存储在 PostgreSQL 的 TEXT 字段中，当单条消息超过 100KB（含长代码块）时如何优化？** 提示：大内容外置到对象存储（S3），数据库只存引用。
3. **如何为"对话搜索"功能设计索引？** 提示：PostgreSQL 全文检索（tsvector）或 Elasticsearch 异步同步。

</details>

---

### Q4: CDN 在 Chatbot 产品中的部署策略是什么？

**难度**: ⭐ 基础

<details>
<summary>💡 查看解答</summary>

#### 核心概念

CDN（Content Delivery Network）在 Chatbot 产品中扮演着多重角色，远不止于传统的静态资源分发。一个成熟的 Chatbot 产品需要 CDN 同时处理**静态资源加速**、**API 请求路由**和**流式响应透传**三大职责，这对 CDN 的配置和选型提出了特殊要求。

对于静态资源层（HTML、CSS、JS、图片），CDN 的配置与普通 Web 应用无异——边缘缓存、Gzip/Brotli 压缩、长缓存策略。但 Chatbot 的特殊之处在于前端 JS 包通常较大（包含 Markdown 解析器、代码高亮引擎、LaTeX 渲染器等），首屏加载的 JS 总量可达 500KB-1MB（压缩后），因此代码分割和边缘预加载策略尤为重要。

对于 API 请求层，CDN 需要正确识别并透传 SSE 流式响应。核心难点是：大多数 CDN 默认会**缓冲**响应体直到完整接收后才下发给客户端（response buffering），这与流式推送的实时性要求直接冲突。必须在 CDN 层面显式禁用响应缓冲，启用"streaming mode"或"chunked transfer"透传。Cloudflare、AWS CloudFront 和 Fastly 都支持此配置，但默认行为和配置方式各不相同。

#### 架构图

```
全球 CDN 部署拓扑:

     用户请求
        │
        ▼
┌───────────────────────────────────────────────────┐
│                  CDN 边缘节点                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ 东京 PoP │  │ 法兰克福 │  │ 弗吉尼亚│  ... 300+ │
│  └────┬────┘  └────┬────┘  └────┬────┘           │
│       │            │            │                  │
│  路由规则:                                          │
│  ├── /assets/*     → 边缘缓存（TTL 1年，immutable）│
│  ├── /api/models   → 边缘缓存（TTL 5分钟）         │
│  ├── /api/chat     → 直接回源（streaming 模式）     │
│  └── /api/auth/*   → 直接回源（不缓存）             │
└───────────────────────┬───────────────────────────┘
                        │
              ┌─────────▼─────────┐
              │    Origin Shield    │  ← 回源保护层
              │   (区域缓存节点)    │     减少回源压力
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────┐
              │   API 网关集群      │
              │   (多区域部署)      │
              └───────────────────┘
```

#### 代码示例

```typescript
// Cloudflare Worker —— Chatbot CDN 边缘路由逻辑
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. 静态资源 → 边缘缓存
    if (url.pathname.startsWith('/assets/')) {
      const cache = caches.default;
      let response = await cache.match(request);
      if (response) return response;

      response = await fetch(request);
      response = new Response(response.body, {
        ...response,
        headers: {
          ...Object.fromEntries(response.headers),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'CDN-Cache-Control': 'max-age=31536000',
        },
      });
      await cache.put(request, response.clone());
      return response;
    }

    // 2. 流式聊天 API → 直通回源，禁用缓冲
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const origin = env.CHAT_ORIGIN;
      const response = await fetch(`${origin}${url.pathname}`, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        // Cloudflare 自动支持 SSE 透传
      });
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        },
      });
    }

    // 3. 模型列表等低频 API → 短时缓存
    if (url.pathname === '/api/models') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      let response = await cache.match(cacheKey);
      if (response) return response;

      response = await fetch(`${env.API_ORIGIN}${url.pathname}`);
      response = new Response(response.body, {
        headers: { 'Cache-Control': 's-maxage=300', 'Vary': 'Accept' },
      });
      await cache.put(cacheKey, response.clone());
      return response;
    }

    // 4. 其他请求 → 直接代理
    return fetch(request);
  },
};
```

#### 关键对比

| 维度 | Cloudflare | AWS CloudFront | Fastly |
|------|-----------|----------------|--------|
| SSE 透传 | 原生支持 | 需配置 Origin Response Timeout | 原生支持 |
| 边缘计算 | Workers（V8 隔离） | Lambda@Edge / Functions | Compute@Edge（Wasm） |
| 全球 PoP 数 | 300+ | 450+ | 90+ |
| 流式缓冲控制 | 自动透传 | 需设置 MinTTL=0 | 需设置 beresp.do_stream |
| WebSocket 支持 | 企业版支持 | 支持 | 支持 |
| 成本模型 | 按请求计费 | 按流量 + 请求 | 按请求 + 计算时间 |

#### 实际案例

**Claude（Anthropic）** 使用 Cloudflare 作为其 CDN 和边缘安全层。其前端静态资源部署在 Cloudflare Pages 上，API 请求通过 Cloudflare Workers 路由到后端推理集群。Cloudflare 的 300+ 全球 PoP 节点确保全球用户的首屏加载时间低于 1.5 秒。在流式响应处理上，Cloudflare 天然支持 SSE 透传无需额外配置，这是 Anthropic 选择 Cloudflare 而非 AWS CloudFront 的关键因素之一。据 Cloudflare 2024 年的客户案例报告，Anthropic 的 API 流量峰值带宽超过 500 Gbps，其中 85% 是 SSE 流式响应流量。

#### 面试追问

1. **Chatbot 产品如何处理 CDN 缓存污染攻击？** 提示：缓存键隔离、用户级变体（Vary 头）、缓存预热白名单。
2. **多区域部署下，如何确保用户始终被路由到延迟最低的 Origin？** 提示：GeoDNS + Anycast + 定期延迟探测 + 就近路由策略。
3. **前端资源更新时如何做到零停机切换？** 提示：内容哈希文件名 + HTML 不缓存 + 蓝绿部署 + Service Worker 预缓存。

</details>

---

## ⭐⭐ 进阶题

### Q5: 长连接场景下负载均衡有什么特殊挑战？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

在传统的 HTTP 短连接场景中，负载均衡器可以简单地使用轮询（Round Robin）或最少连接（Least Connections）策略将每个请求分发到不同的后端节点。但在 Chatbot 的流式响应场景下，一个 SSE 连接会持续 5-60 秒甚至更久（取决于模型的输出长度），这意味着**连接的生命周期远长于传统请求**，给负载均衡带来了一系列特殊挑战。

第一个挑战是**负载不均衡的雪崩效应**。假设一个集群有 10 台推理节点，某一时刻一台节点因 GC 或 GPU 显存压力变慢，它上面的长连接迟迟不释放，新连接无法分配到该节点。其他 9 台节点分担了原本 10 台的请求量，导致它们的响应时间也变长、连接也释放得更慢，最终形成级联劣化。这与短连接场景有本质区别——短连接即使某节点变慢，请求完成后连接立即释放，影响是瞬时的。

第二个挑战是**连接亲和性与扩缩容的矛盾**。在自动扩缩容场景下，当新节点上线时，已有的长连接不会迁移到新节点上，新节点可能长时间处于空闲状态；当旧节点需要下线时，必须等待所有存量长连接完成后才能安全移除（Graceful Drain），否则正在流式传输的消息会中断。在 Chatbot 场景中，单个响应的流式传输可能持续一分钟以上，这使得 Drain 的窗口期远超常规服务。

第三个挑战是**异构节点的能力差异**。推理集群通常混合部署不同型号的 GPU（A100 80GB、H100、H200 等），不同 GPU 的推理速度差异可达 2-3 倍。简单的 Round Robin 策略会导致高性能 GPU 被浪费，而低性能 GPU 被打满。需要基于节点的**实际处理能力**（而非连接数）来分配负载。

#### 架构图

```
智能负载均衡架构:

                    ┌─────────────────────────────────────┐
                    │         Global Load Balancer          │
                    │       (L7 / Application Layer)        │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      智能调度层 (Smart Router)         │
                    │                                       │
                    │  ┌─────────────────────────────────┐ │
                    │  │ 1. 实时指标采集                    │ │
                    │  │    • 每节点活跃连接数              │ │
                    │  │    • GPU 显存使用率                │ │
                    │  │    • 请求队列深度                  │ │
                    │  │    • P99 延迟                     │ │
                    │  └─────────────┬───────────────────┘ │
                    │  ┌─────────────▼───────────────────┐ │
                    │  │ 2. 加权评分算法                    │ │
                    │  │    score = w₁·(1 - gpu_util)     │ │
                    │  │          + w₂·(1 - queue_depth)  │ │
                    │  │          + w₃·(1 / p99_latency)  │ │
                    │  └─────────────┬───────────────────┘ │
                    │  ┌─────────────▼───────────────────┐ │
                    │  │ 3. 路由决策                       │ │
                    │  │    选择 score 最高的节点           │ │
                    │  └─────────────────────────────────┘ │
                    └───┬──────────┬──────────┬────────────┘
                        │          │          │
               ┌────────▼──┐ ┌────▼─────┐ ┌──▼────────┐
               │  Node A    │ │  Node B   │ │  Node C    │
               │  H100×8    │ │  A100×8   │ │  H100×4    │
               │  GPU: 45%  │ │  GPU: 78% │ │  GPU: 30%  │
               │  Queue: 3  │ │  Queue: 12│ │  Queue: 1  │
               │  Score: 82 │ │  Score: 31│ │  Score: 91 │ ← 选这个
               └────────────┘ └──────────┘ └───────────┘
```

#### 代码示例

```python
# 智能负载均衡路由器实现
import time
import heapq
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import asyncio
import aiohttp

@dataclass
class NodeMetrics:
    node_id: str
    gpu_utilization: float      # 0.0 ~ 1.0
    active_connections: int
    queue_depth: int
    p99_latency_ms: float
    gpu_memory_free_gb: float
    max_capacity: int           # 最大并发数（取决于 GPU 型号）
    is_draining: bool = False
    last_updated: float = field(default_factory=time.time)

    @property
    def load_score(self) -> float:
        """计算节点负载评分，分数越高表示越适合接收新请求"""
        if self.is_draining:
            return -1.0  # 正在下线的节点不接受新连接

        # 各维度归一化到 0-1，然后加权求和
        gpu_score = 1.0 - self.gpu_utilization
        queue_score = max(0, 1.0 - self.queue_depth / self.max_capacity)
        latency_score = max(0, 1.0 - self.p99_latency_ms / 5000)
        capacity_ratio = 1.0 - self.active_connections / self.max_capacity

        return (
            0.35 * gpu_score +
            0.25 * queue_score +
            0.20 * latency_score +
            0.20 * capacity_ratio
        )

class SmartLoadBalancer:
    def __init__(self):
        self.nodes: Dict[str, NodeMetrics] = {}
        self._metrics_lock = asyncio.Lock()

    async def update_metrics(self, node_id: str, metrics: dict):
        """接收节点上报的实时指标"""
        async with self._metrics_lock:
            self.nodes[node_id] = NodeMetrics(node_id=node_id, **metrics)

    async def select_node(self, request_context: dict) -> Optional[str]:
        """选择最优节点"""
        async with self._metrics_lock:
            candidates = [
                n for n in self.nodes.values()
                if not n.is_draining
                and time.time() - n.last_updated < 10  # 10秒内有心跳
                and n.active_connections < n.max_capacity
            ]

        if not candidates:
            return None  # 所有节点满载，触发排队或降级

        # 按评分降序排列，选最优节点
        best = max(candidates, key=lambda n: n.load_score)
        return best.node_id

    async def graceful_drain(self, node_id: str, timeout_sec: int = 120):
        """优雅下线节点，等待存量连接完成"""
        async with self._metrics_lock:
            if node_id in self.nodes:
                self.nodes[node_id].is_draining = True

        start = time.time()
        while time.time() - start < timeout_sec:
            async with self._metrics_lock:
                node = self.nodes.get(node_id)
                if node and node.active_connections == 0:
                    del self.nodes[node_id]
                    return True
            await asyncio.sleep(2)

        # 超时强制移除
        async with self._metrics_lock:
            self.nodes.pop(node_id, None)
        return False
```

#### 关键对比

| 维度 | Round Robin | Least Connections | 加权评分（本方案） |
|------|-----------|------------------|----------------|
| 实现复杂度 | 极低 | 低 | 中高 |
| 长连接场景表现 | 严重不均衡 | 较好但忽略 GPU 差异 | 最优 |
| 异构节点支持 | 不支持 | 不支持 | 原生支持 |
| 扩缩容友好度 | 差 | 中等 | 好（支持 Drain） |
| 指标采集开销 | 无 | 仅连接数 | 需要完整指标上报 |
| 适用规模 | 小型 | 中型 | 大型生产环境 |

#### 实际案例

**vLLM 项目的负载均衡方案**采用了基于"pending requests"的调度策略。vLLM 的 API 服务器会跟踪每个推理 Worker 的待处理请求队列深度，新请求始终路由到队列最短的 Worker。在实际部署中，一个混合了 8 台 A100 和 4 台 H100 的集群，使用这种加权调度后相比 Round Robin 策略，P99 延迟降低了 40%，GPU 整体利用率从 65% 提升到 82%。Anthropic 在其 2024 年的技术分享中提到，他们的推理集群使用了自研的"capacity-aware router"，除了 GPU 利用率和队列深度外，还会根据请求的预估 token 数量（基于 prompt 长度和 max_tokens 参数）来预判单个请求的资源消耗，实现更精准的负载预测。

#### 面试追问

1. **如果负载均衡器本身成为单点瓶颈，如何设计高可用方案？** 提示：LB 集群 + VIP 漂移（Keepalived/VRRP），或客户端侧负载均衡（gRPC client-side LB）。
2. **在 Kubernetes 环境下，如何让 HPA 自动扩缩容与长连接负载均衡协同工作？** 提示：自定义 metrics（GPU 利用率而非 CPU）+ PodDisruptionBudget + preStop hook 实现 Graceful Drain。
3. **当所有后端节点都满载时，如何设计公平的排队机制？** 提示：虚拟队列 + 基于用户等级的优先级 + 预估等待时间反馈 + 超时自动取消。

</details>
### Q6: RAG 检索增强的完整 Pipeline 如何设计？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

RAG（Retrieval-Augmented Generation）的核心思想是让 LLM 在生成回答前，先从外部知识库中检索相关信息，再将检索结果作为上下文注入 Prompt，从而减少幻觉、提升回答准确性。一个生产级 RAG Pipeline 远非"向量检索 + 拼接 Prompt"这么简单——它涉及文档预处理、分块策略、多路召回、重排序、上下文压缩等多个环节。

在 Chatbot 场景中，RAG 需要额外考虑对话上下文的融合：用户的当前提问可能依赖前几轮的对话历史，因此查询改写（Query Rewriting）是不可或缺的一步。例如用户先问"Redis 的数据结构有哪些？"，再追问"它的持久化机制呢？"——此时"它"指代 Redis，检索系统需要将问题改写为"Redis 的持久化机制"才能正确召回。

生产环境中，RAG Pipeline 的性能瓶颈往往在召回质量而非生成速度。因此业界普遍采用"粗召回 + 精排序"的两阶段架构：第一阶段用向量检索 + 关键词检索做多路召回，第二阶段用 Cross-Encoder 或小型 LLM 做重排序，最终只将 Top-K 个最相关的文档片段送入生成模型。

#### 架构图

```
用户提问
    │
    ▼
┌─────────────────┐
│  Query 预处理    │  ← 指代消解、多轮改写、意图分类
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ 向量检索│ │关键词检索│  ← 多路召回（Hybrid Search）
│(Dense) │ │(Sparse)│
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌─────────────────┐
│   结果融合 (RRF) │  ← Reciprocal Rank Fusion
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Re-Ranking     │  ← Cross-Encoder / Cohere Rerank
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  上下文压缩/裁剪  │  ← Token 预算控制
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Prompt 组装     │  ← System + Context + History + Query
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   LLM 生成      │  ← 带引用标注的回答
└─────────────────┘
```

#### 代码示例

```python
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

@dataclass
class RetrievedChunk:
    chunk_id: str
    content: str
    source: str
    score: float
    metadata: dict = field(default_factory=dict)

class RAGPipeline:
    def __init__(self, embedder, vector_store, keyword_index, reranker, llm):
        self.embedder = embedder
        self.vector_store = vector_store
        self.keyword_index = keyword_index
        self.reranker = reranker
        self.llm = llm

    async def query_rewrite(self, query: str, history: list[dict]) -> str:
        """利用 LLM 将多轮对话中的模糊指代改写为独立查询"""
        if not history:
            return query
        rewrite_prompt = (
            "根据对话历史，将用户最新问题改写为一个独立、完整的检索查询。\n"
            f"对话历史: {history[-4:]}\n"
            f"当前问题: {query}\n"
            "改写后的查询:"
        )
        return await self.llm.generate(rewrite_prompt, max_tokens=100)

    async def hybrid_retrieve(self, query: str, top_k: int = 20) -> list[RetrievedChunk]:
        """混合检索：向量 + 关键词，使用 RRF 融合"""
        query_embedding = await self.embedder.encode(query)

        dense_results = await self.vector_store.search(query_embedding, top_k=top_k)
        sparse_results = await self.keyword_index.search(query, top_k=top_k)

        return self._reciprocal_rank_fusion(dense_results, sparse_results, k=60)

    def _reciprocal_rank_fusion(self, *result_lists, k: int = 60) -> list[RetrievedChunk]:
        """RRF 融合算法：score = Σ 1/(k + rank_i)"""
        scores: dict[str, float] = {}
        chunk_map: dict[str, RetrievedChunk] = {}

        for results in result_lists:
            for rank, chunk in enumerate(results):
                scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0) + 1.0 / (k + rank + 1)
                chunk_map[chunk.chunk_id] = chunk

        sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
        return [
            RetrievedChunk(**{**chunk_map[cid].__dict__, "score": scores[cid]})
            for cid in sorted_ids
        ]

    async def rerank_and_compress(
        self, query: str, chunks: list[RetrievedChunk], max_tokens: int = 3000
    ) -> list[RetrievedChunk]:
        """重排序 + Token 预算裁剪"""
        reranked = await self.reranker.rerank(query, chunks, top_k=10)

        selected, token_count = [], 0
        for chunk in reranked:
            chunk_tokens = len(chunk.content) // 2  # 粗略估算中文 token
            if token_count + chunk_tokens > max_tokens:
                break
            selected.append(chunk)
            token_count += chunk_tokens
        return selected

    async def run(self, query: str, history: list[dict]) -> str:
        rewritten = await self.query_rewrite(query, history)
        candidates = await self.hybrid_retrieve(rewritten)
        context_chunks = await self.rerank_and_compress(rewritten, candidates)

        context_text = "\n---\n".join(
            f"[来源: {c.source}]\n{c.content}" for c in context_chunks
        )
        prompt = (
            f"参考资料:\n{context_text}\n\n"
            f"用户问题: {query}\n\n"
            "请基于以上资料回答，回答中用 [来源: xxx] 标注引用。"
        )
        return await self.llm.generate(prompt)
```

#### 关键对比

| 维度 | 纯向量检索 | 混合检索 (Hybrid) | GraphRAG |
|------|-----------|-------------------|----------|
| 语义理解 | ✅ 强 | ✅ 强 | ✅ 强 |
| 精确匹配 | ❌ 弱（如型号、编号） | ✅ 关键词补充 | ✅ 实体精确 |
| 多跳推理 | ❌ 不支持 | ❌ 不支持 | ✅ 图遍历 |
| 实现复杂度 | 低 | 中 | 高 |
| 延迟 | ~100ms | ~150ms | ~500ms+ |
| 适用场景 | 通用问答 | 企业知识库 | 复杂关系推理 |

#### 实际案例

- **Bing Chat**：采用 Hybrid Search + 多轮 Query Rewriting，首次查询延迟约 200ms，使用 Bing 搜索引擎作为检索后端
- **Notion AI**：对 Workspace 内文档建立向量索引，分块策略按 Block 粒度（标题/段落/表格），平均检索 Top-5 文档片段
- **企业实践数据**：某金融客服系统引入 RAG 后，回答准确率从 62% 提升至 89%，幻觉率从 23% 降至 4%，但 P99 延迟增加了 300ms

#### 面试追问

1. **分块策略如何选择？** 固定长度切分 vs 语义切分（按段落/章节）各有什么优缺点？Overlap 应该设置多大？
2. **检索质量如何评估？** 如何构建评测集？MRR、NDCG、Recall@K 等指标分别衡量什么？
3. **当知识库频繁更新时，如何做增量索引？** 向量索引的增量更新和全量重建各有什么 trade-off？

</details>

---

### Q7: 消息分支（Regenerate/Edit）的数据结构如何设计？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

现代 Chatbot（如 ChatGPT）支持用户对已发送的消息进行编辑（Edit），或对 AI 回复进行重新生成（Regenerate）。这些操作本质上创建了消息的"分支"——原始消息和修改后的消息并存，用户可以在不同分支之间切换浏览。这种能力要求底层数据结构不再是简单的线性链表，而是一棵**消息树（Message Tree）**。

消息树的核心设计是：每条消息有一个 parent_id 指向其父消息，同一个父节点可以有多个子节点（代表不同的分支）。会话中维护一个"活跃路径"（Active Path），即从根节点到当前叶节点的路径，这就是用户当前看到的对话内容。当用户点击分支切换按钮时，实际上是改变了某个分叉点处的 active_child 指针。

这种树形结构的优势在于：历史不会丢失（所有分支都保留），支持任意深度的嵌套分支，且存储效率高（共享公共前缀路径的消息不重复存储）。ChatGPT 的前端就是基于这种数据结构实现了 "< 2/3 >" 这样的分支导航 UI。

#### 架构图

```
                    [system]
                       │
                    [user: A]
                       │
               ┌───────┴───────┐
               │               │
         [assistant: B1]  [assistant: B2]   ← Regenerate 产生分支
               │               │
          [user: C]       [user: C']        ← Edit 产生分支
               │               │
         [assistant: D]  [assistant: D']
               │
          ┌────┴────┐
          │         │
     [user: E1] [user: E2]                 ← 用户编辑产生分支

活跃路径示例: system → A → B1 → C → D → E1
分支导航:     在 B 层级显示 "< 1/2 >"
```

#### 代码示例

```typescript
interface Message {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
  metadata: {
    model?: string;
    tokens?: number;
    isEdited?: boolean;
    editOf?: string;       // 指向被编辑的原消息
  };
}

interface ConversationNode {
  message: Message;
  children: string[];      // 子消息 ID 列表（有序）
  activeChildIndex: number; // 当前活跃的子节点索引
}

class MessageTree {
  private nodes: Map<string, ConversationNode> = new Map();
  private rootId: string | null = null;

  addMessage(message: Message): void {
    const node: ConversationNode = {
      message,
      children: [],
      activeChildIndex: 0,
    };
    this.nodes.set(message.id, node);

    if (message.parentId === null) {
      this.rootId = message.id;
    } else {
      const parent = this.nodes.get(message.parentId);
      if (parent) {
        parent.children.push(message.id);
        // 新分支自动成为活跃分支
        parent.activeChildIndex = parent.children.length - 1;
      }
    }
  }

  /** 获取当前活跃路径（用户看到的对话） */
  getActivePath(): Message[] {
    const path: Message[] = [];
    let currentId = this.rootId;

    while (currentId) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      path.push(node.message);

      if (node.children.length === 0) break;
      currentId = node.children[node.activeChildIndex];
    }
    return path;
  }

  /** 切换分支：在指定节点处切换到第 n 个子节点 */
  switchBranch(parentId: string, childIndex: number): Message[] {
    const node = this.nodes.get(parentId);
    if (!node || childIndex < 0 || childIndex >= node.children.length) {
      throw new Error('Invalid branch index');
    }
    node.activeChildIndex = childIndex;
    return this.getActivePath();
  }

  /** 获取分支信息：当前是第几个/共几个 */
  getBranchInfo(messageId: string): { current: number; total: number } | null {
    const msg = this.nodes.get(messageId);
    if (!msg || !msg.message.parentId) return null;

    const parent = this.nodes.get(msg.message.parentId);
    if (!parent) return null;

    const index = parent.children.indexOf(messageId);
    return { current: index + 1, total: parent.children.length };
  }

  /** Regenerate：在同一父节点下创建新的 assistant 回复 */
  regenerate(originalMsgId: string, newContent: string): Message {
    const original = this.nodes.get(originalMsgId);
    if (!original || original.message.role !== 'assistant') {
      throw new Error('Can only regenerate assistant messages');
    }

    const newMessage: Message = {
      id: crypto.randomUUID(),
      conversationId: original.message.conversationId,
      parentId: original.message.parentId,
      role: 'assistant',
      content: newContent,
      createdAt: new Date(),
      metadata: { isEdited: false },
    };

    this.addMessage(newMessage);
    return newMessage;
  }
}
```

#### 关键对比

| 维度 | 线性数组 | 链表 + 版本号 | 消息树 (Tree) | DAG 结构 |
|------|---------|-------------|--------------|----------|
| Regenerate 支持 | ❌ 覆盖原消息 | ⚠️ 需遍历版本 | ✅ 天然支持 | ✅ 支持 |
| Edit 支持 | ❌ 截断后续 | ⚠️ 复杂 | ✅ 天然支持 | ✅ 支持 |
| 分支切换 | ❌ | ❌ | ✅ O(1) | ✅ O(1) |
| 查询活跃对话 | ✅ O(1) | ⚠️ O(n) | ✅ O(depth) | ⚠️ O(depth) |
| 实现复杂度 | 极低 | 低 | 中 | 高 |
| 存储效率 | 最优 | 冗余版本 | 共享前缀 | 共享前缀 |

#### 实际案例

- **ChatGPT**：采用消息树结构，前端通过 `< 1/3 >` 导航组件支持分支切换。每次 Regenerate 在同一 parent 下新增子节点，历史回复永不删除
- **Claude**：采用类似的树结构，但 UI 上选择了简化呈现——Edit 会创建新的对话分支，旧分支通过列表展示
- **数据规模参考**：ChatGPT Plus 用户平均每天产生 50-100 条消息，其中约 15% 涉及 Regenerate 操作，5% 涉及 Edit 操作，因此分支数据量约占总消息量的 20%

#### 面试追问

1. **消息树的数据库存储方案怎么选？** 邻接表（Adjacency List）、路径枚举（Path Enumeration）、嵌套集（Nested Set）各有什么优劣？
2. **当对话树很深（100+ 层）时，如何优化 `getActivePath` 的性能？** 是否需要缓存活跃路径？
3. **前端如何高效渲染分支切换？** 切换分支时需要重新渲染整个对话还是只更新变化部分？Virtual List 如何配合？

</details>

---

### Q8: 多级缓存策略在 Chatbot 中如何应用？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Chatbot 系统中，LLM 推理是最昂贵的操作——无论是调用 OpenAI API 的费用还是自部署模型的 GPU 算力。多级缓存策略的核心目标是：**对于语义相同或高度相似的查询，尽量复用已有的生成结果，避免重复推理**。这不仅降低成本，还能显著减少响应延迟（缓存命中时从秒级降到毫秒级）。

Chatbot 缓存与传统 Web 缓存的关键区别在于：用户的提问是自然语言，同一个意图可以有无数种表述方式。因此，简单的精确匹配缓存（Exact Match）命中率极低，必须引入**语义缓存（Semantic Cache）**——通过向量相似度判断两个问题是否"语义等价"。例如"Python 怎么排序列表？"和"如何对 Python 的 list 进行排序？"应该命中同一条缓存。

生产级 Chatbot 通常采用 L1-L2-L3 三级缓存架构：L1 是进程内的精确匹配缓存（命中延迟 <1ms），L2 是基于 Redis 的语义缓存（命中延迟 ~10ms），L3 是持久化的知识缓存（命中延迟 ~50ms）。缓存的失效策略也比传统 Web 更复杂——除了 TTL 过期，还需要考虑知识更新、模型升级等场景下的主动失效。

#### 架构图

```
用户请求
    │
    ▼
┌─────────────────────────────────┐
│ L1: 进程内精确缓存 (LRU)         │  ← <1ms, 命中率 5-10%
│ Key = hash(query + context)      │
└──────────┬──────────────────────┘
           │ MISS
           ▼
┌─────────────────────────────────┐
│ L2: Redis 语义缓存               │  ← ~10ms, 命中率 15-25%
│ 向量相似度 > 0.95 → 命中          │
│ ┌───────────┐  ┌──────────────┐ │
│ │ Query向量  │→│ 相似度检索    │ │
│ └───────────┘  └──────────────┘ │
└──────────┬──────────────────────┘
           │ MISS
           ▼
┌─────────────────────────────────┐
│ L3: 知识库预计算缓存              │  ← ~50ms, 命中率 10-15%
│ 高频问题 + 标准答案               │
│ 定期由离线任务更新                 │
└──────────┬──────────────────────┘
           │ MISS
           ▼
┌─────────────────────────────────┐
│ LLM 推理                        │  ← 500ms-5s
│ 结果异步回写各级缓存              │
└─────────────────────────────────┘
```

#### 代码示例

```python
import hashlib
import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class CacheEntry:
    query: str
    response: str
    embedding: list[float]
    model_version: str
    created_at: float
    hit_count: int = 0
    ttl: int = 3600  # 默认 1 小时

class MultiLevelCache:
    def __init__(self, redis_client, vector_store, embedder, config: dict):
        self.l1_cache: dict[str, CacheEntry] = {}  # 进程内 LRU
        self.l1_max_size = config.get("l1_max_size", 1000)
        self.redis = redis_client
        self.vector_store = vector_store
        self.embedder = embedder
        self.similarity_threshold = config.get("similarity_threshold", 0.95)

    def _make_exact_key(self, query: str, context_hash: str) -> str:
        raw = f"{query.strip().lower()}:{context_hash}"
        return f"cache:exact:{hashlib.sha256(raw.encode()).hexdigest()}"

    async def get(self, query: str, context_hash: str = "") -> Optional[str]:
        # L1: 精确匹配
        exact_key = self._make_exact_key(query, context_hash)
        if exact_key in self.l1_cache:
            entry = self.l1_cache[exact_key]
            if time.time() - entry.created_at < entry.ttl:
                entry.hit_count += 1
                return entry.response

        # L2: Redis 语义缓存
        query_embedding = await self.embedder.encode(query)
        cached = await self.redis.get(exact_key)
        if cached:
            return cached

        # L2.5: 向量相似度检索
        similar = await self.vector_store.search(
            query_embedding, top_k=1, threshold=self.similarity_threshold
        )
        if similar:
            best_match = similar[0]
            # 额外校验：防止语义漂移
            if self._context_compatible(query, best_match.query):
                await self._promote_to_l1(exact_key, best_match)
                return best_match.response

        # L3: 预计算知识库
        faq_result = await self.redis.get(f"cache:faq:{hashlib.md5(query.encode()).hexdigest()}")
        if faq_result:
            return faq_result

        return None  # 全部未命中，需要 LLM 推理

    async def put(self, query: str, response: str, context_hash: str = ""):
        """异步回写各级缓存"""
        exact_key = self._make_exact_key(query, context_hash)
        embedding = await self.embedder.encode(query)

        entry = CacheEntry(
            query=query, response=response, embedding=embedding,
            model_version="gpt-4o-2024-08", created_at=time.time(),
        )

        # L1 回写（LRU 淘汰）
        if len(self.l1_cache) >= self.l1_max_size:
            oldest = min(self.l1_cache, key=lambda k: self.l1_cache[k].created_at)
            del self.l1_cache[oldest]
        self.l1_cache[exact_key] = entry

        # L2 回写
        await self.redis.setex(exact_key, entry.ttl, response)
        await self.vector_store.upsert(entry)

    def _context_compatible(self, query: str, cached_query: str) -> bool:
        """防止跨场景的语义缓存误命中"""
        return len(query) > 5 and abs(len(query) - len(cached_query)) < len(query) * 0.5

    async def _promote_to_l1(self, key: str, entry: CacheEntry):
        self.l1_cache[key] = entry
```

#### 关键对比

| 维度 | 精确匹配缓存 | 语义缓存 | 预计算 FAQ 缓存 |
|------|------------|---------|---------------|
| 命中率 | 5-10% | 15-25% | 10-15%（特定场景更高） |
| 延迟 | <1ms | 10-30ms | 5-10ms |
| 误命中风险 | 无 | 有（阈值过低时） | 无 |
| 存储成本 | 低 | 高（需向量索引） | 中 |
| 个性化支持 | ✅ 区分上下文 | ⚠️ 需额外处理 | ❌ 通用答案 |
| 适用场景 | 重复查询多 | 长尾查询多 | 客服/FAQ 场景 |

#### 实际案例

- **GPTCache（开源项目）**：专为 LLM 设计的语义缓存库，支持多种相似度算法和逐出策略，实测可将 API 调用量降低 30-40%
- **某电商客服系统**：采用三级缓存后，LLM API 调用量下降 42%，月度 API 成本从 $12,000 降至 $7,000，P50 延迟从 2.1s 降至 180ms
- **缓存失效策略**：模型升级（如 GPT-4 → GPT-4o）时需全量失效语义缓存；知识库更新时按文档级别部分失效；TTL 一般设为 1-24 小时，根据内容时效性动态调整

#### 面试追问

1. **语义缓存的相似度阈值如何确定？** 阈值太高导致命中率低，太低导致误命中——如何找到最优平衡点？是否需要 A/B 测试？
2. **多轮对话场景下，缓存的 Key 如何设计？** 同一个问题在不同对话上下文中答案不同，如何避免错误命中？
3. **缓存穿透和缓存雪崩如何防御？** 恶意用户构造大量唯一查询怎么办？LLM 服务不可用时缓存集中过期怎么处理？

</details>

---

### Q9: 如何设计用户级别的限流策略？

**难度**: ⭐⭐ 进阶

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Chatbot 的限流设计比传统 API 限流更复杂，因为一次 LLM 调用的成本远高于普通请求——单次 GPT-4 调用可能消耗数千 Token，耗时数秒，占用 GPU 显存。因此，Chatbot 的限流不仅要控制请求频率（RPM），还需要控制 Token 消耗量（TPM）、并发连接数、以及单次请求的最大 Token 数。

用户级限流的核心挑战是**差异化**：免费用户、付费用户、企业用户应有不同的配额；同时需要防止单个用户耗尽共享资源（Noisy Neighbor 问题）。生产系统通常采用多维度限流：维度一是请求频率（如 10 RPM），维度二是 Token 总量（如 100K TPM），维度三是并发数（如 3 个并行会话），任一维度触发即限流。

限流算法的选择也很关键。传统的固定窗口（Fixed Window）算法在窗口边界会出现双倍突发，滑动窗口对数器（Sliding Window Counter）在精度和性能之间取得了良好平衡，是 Chatbot 场景的推荐选择。令牌桶（Token Bucket）算法适合需要允许短暂突发的场景，如 ChatGPT 允许用户快速连续发几条消息，但不能持续高频。

#### 架构图

```
用户请求
    │
    ▼
┌────────────────────────────────────┐
│          API Gateway               │
│  ┌──────────────────────────────┐  │
│  │    全局限流 (保护后端整体)     │  │
│  │    令牌桶: 10,000 RPM        │  │
│  └──────────┬───────────────────┘  │
│             │                      │
│  ┌──────────▼───────────────────┐  │
│  │   用户级限流 (公平性)         │  │
│  │                              │  │
│  │  ┌─────────┐ ┌────────────┐  │  │
│  │  │ RPM 限制 │ │ TPM 限制   │  │  │
│  │  │(频率)    │ │(Token消耗) │  │  │
│  │  └─────────┘ └────────────┘  │  │
│  │  ┌─────────┐ ┌────────────┐  │  │
│  │  │ 并发限制 │ │ 日配额限制  │  │  │
│  │  │(连接数)  │ │(每日上限)  │  │  │
│  │  └─────────┘ └────────────┘  │  │
│  └──────────┬───────────────────┘  │
│             │                      │
│  ┌──────────▼───────────────────┐  │
│  │   优先级队列                  │  │
│  │   VIP > 付费 > 免费          │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

#### 代码示例

```python
import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class UserTier(Enum):
    FREE = "free"
    PLUS = "plus"
    TEAM = "team"
    ENTERPRISE = "enterprise"

@dataclass
class RateLimitConfig:
    rpm: int               # 每分钟请求数
    tpm: int               # 每分钟 Token 数
    max_concurrency: int   # 最大并发
    daily_quota: int       # 每日总 Token 配额
    max_tokens_per_req: int  # 单次最大 Token

TIER_LIMITS: dict[UserTier, RateLimitConfig] = {
    UserTier.FREE:       RateLimitConfig(rpm=5,  tpm=10_000,    max_concurrency=1, daily_quota=50_000,     max_tokens_per_req=2_000),
    UserTier.PLUS:       RateLimitConfig(rpm=30, tpm=100_000,   max_concurrency=3, daily_quota=500_000,    max_tokens_per_req=8_000),
    UserTier.TEAM:       RateLimitConfig(rpm=60, tpm=500_000,   max_concurrency=5, daily_quota=2_000_000,  max_tokens_per_req=16_000),
    UserTier.ENTERPRISE: RateLimitConfig(rpm=200,tpm=2_000_000, max_concurrency=20,daily_quota=20_000_000, max_tokens_per_req=32_000),
}

class SlidingWindowCounter:
    """滑动窗口计数器 — 基于 Redis 实现"""

    def __init__(self, redis_client):
        self.redis = redis_client

    async def is_allowed(self, key: str, limit: int, window_secs: int = 60) -> tuple[bool, dict]:
        now = time.time()
        current_window = int(now // window_secs)
        prev_window = current_window - 1
        elapsed_ratio = (now % window_secs) / window_secs

        current_key = f"rl:{key}:{current_window}"
        prev_key = f"rl:{key}:{prev_window}"

        pipe = self.redis.pipeline()
        pipe.get(current_key)
        pipe.get(prev_key)
        current_count, prev_count = await pipe.execute()

        current_count = int(current_count or 0)
        prev_count = int(prev_count or 0)

        # 加权计算：前一个窗口的剩余权重 + 当前窗口的计数
        weighted_count = prev_count * (1 - elapsed_ratio) + current_count
        allowed = weighted_count < limit

        return allowed, {
            "limit": limit,
            "remaining": max(0, int(limit - weighted_count)),
            "reset": int((current_window + 1) * window_secs - now),
        }

    async def increment(self, key: str, count: int = 1, window_secs: int = 60):
        current_window = int(time.time() // window_secs)
        window_key = f"rl:{key}:{current_window}"
        pipe = self.redis.pipeline()
        pipe.incrby(window_key, count)
        pipe.expire(window_key, window_secs * 2)
        await pipe.execute()

class UserRateLimiter:
    def __init__(self, redis_client):
        self.counter = SlidingWindowCounter(redis_client)
        self.redis = redis_client

    async def check_and_consume(
        self, user_id: str, tier: UserTier, estimated_tokens: int
    ) -> tuple[bool, Optional[str], dict]:
        config = TIER_LIMITS[tier]
        headers = {}

        # 检查 1: RPM
        allowed, info = await self.counter.is_allowed(f"rpm:{user_id}", config.rpm)
        headers["X-RateLimit-Limit-RPM"] = str(config.rpm)
        headers["X-RateLimit-Remaining-RPM"] = str(info["remaining"])
        if not allowed:
            return False, f"请求频率超限，请 {info['reset']} 秒后重试", headers

        # 检查 2: TPM
        allowed, info = await self.counter.is_allowed(f"tpm:{user_id}", config.tpm)
        if not allowed:
            return False, "Token 消耗超限，请稍后再试", headers

        # 检查 3: 并发数
        concurrency = int(await self.redis.get(f"conc:{user_id}") or 0)
        if concurrency >= config.max_concurrency:
            return False, f"并发请求超限（最大 {config.max_concurrency}）", headers

        # 检查 4: 日配额
        daily_key = f"daily:{user_id}:{time.strftime('%Y%m%d')}"
        daily_used = int(await self.redis.get(daily_key) or 0)
        if daily_used + estimated_tokens > config.daily_quota:
            return False, "今日配额已用完，明天再来吧", headers

        # 全部通过，消费配额
        await self.counter.increment(f"rpm:{user_id}")
        await self.counter.increment(f"tpm:{user_id}", estimated_tokens)
        await self.redis.incr(f"conc:{user_id}")

        return True, None, headers
```

#### 关键对比

| 维度 | 固定窗口 | 滑动日志 | 滑动窗口计数器 | 令牌桶 |
|------|---------|---------|-------------|--------|
| 精度 | ❌ 边界突发 | ✅ 精确 | ✅ 近似精确 | ✅ 精确 |
| 内存消耗 | 极低 | 高（存每条日志） | 低（两个计数器） | 低 |
| 突发容忍 | 窗口边界 2x | 无 | 微小 | ✅ 可配置 |
| 实现复杂度 | 极低 | 中 | 低 | 低 |
| 分布式支持 | ✅ | ⚠️ 需排序 | ✅ | ✅ |
| Chatbot 推荐 | ❌ | ❌ | ✅ RPM/TPM | ✅ 并发控制 |

#### 实际案例

- **OpenAI API 限流**：按组织维度实施 RPM + TPM 双维度限流。GPT-4 Tier 1 用户限制 500 RPM / 30,000 TPM，Tier 5 用户 10,000 RPM / 1,500,000 TPM
- **ChatGPT Plus**：在 GPT-4o 上限制约 80 条/3 小时（动态调整），触发限流后自动降级到 GPT-4o-mini 模型继续服务
- **成本影响**：某 SaaS Chatbot 实施用户级限流后，月度 GPU 成本从 $45,000 降至 $28,000（降 38%），同时 P99 延迟从 12s 降至 4s（减少了排队等待）

#### 面试追问

1. **限流后的用户体验如何优化？** 除了返回 429 状态码，还有哪些"优雅降级"策略？（如降级模型、缩短回复长度、排队机制）
2. **分布式限流的一致性如何保证？** 多实例部署时，基于 Redis 的限流如何处理网络分区？是否接受短暂的超额？
3. **如何应对限流绕过攻击？** 用户注册大量免费账号、使用代理 IP 等方式绕过限流，如何检测和防御？

</details>

---

### Q10: 多区域 Active-Active 部署如何处理会话一致性？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

当 Chatbot 服务扩展到全球化部署时，需要在多个地理区域（如美东、美西、欧洲、亚太）同时部署完整的服务栈，以降低用户的访问延迟。Active-Active 意味着每个区域都可以独立处理读写请求，而不是像 Active-Passive 那样只有一个主区域可写。这带来了一个核心挑战：**会话数据的跨区域一致性**。

Chatbot 的会话一致性需求比较特殊：一个用户通常在一个区域内完成一段对话，但当用户切换网络（如从公司 Wi-Fi 切到 4G）或旅行时，可能被路由到不同区域。如果新区域看不到之前的对话历史，用户体验会非常差。然而，要求所有区域实时同步所有会话数据又不现实——跨洋网络延迟通常在 100-200ms，强一致同步会严重拖慢写入性能。

业界主流方案是**会话亲和性（Session Affinity）+ 异步复制 + 冲突解决**：通过 DNS/负载均衡将同一用户的请求尽量路由到同一区域（利用 Sticky Session），减少跨区域同步的需求；同时通过异步复制保证数据最终一致性；在极端情况下通过 CRDT 或 Last-Write-Wins 策略解决冲突。

#### 架构图

```
                    ┌─────────────────┐
                    │   Global DNS    │
                    │  (GeoDNS/GTM)   │
                    └────┬───────┬────┘
                         │       │
              ┌──────────┘       └──────────┐
              ▼                              ▼
    ┌─────────────────┐            ┌─────────────────┐
    │   Region: US-East│            │  Region: AP-SE  │
    │                  │            │                  │
    │ ┌──────────────┐ │   异步     │ ┌──────────────┐ │
    │ │ API Gateway  │ │   复制     │ │ API Gateway  │ │
    │ └──────┬───────┘ │ ◄════════► │ └──────┬───────┘ │
    │        ▼         │  (CDC /    │        ▼         │
    │ ┌──────────────┐ │  Event     │ ┌──────────────┐ │
    │ │ Chat Service │ │  Stream)   │ │ Chat Service │ │
    │ └──────┬───────┘ │            │ └──────┬───────┘ │
    │        ▼         │            │        ▼         │
    │ ┌──────────────┐ │            │ ┌──────────────┐ │
    │ │  CockroachDB │ │◄══════════►│ │  CockroachDB │ │
    │ │ / TiDB       │ │  多活同步  │ │ / TiDB       │ │
    │ └──────┬───────┘ │            │ └──────┬───────┘ │
    │        ▼         │            │        ▼         │
    │ ┌──────────────┐ │            │ ┌──────────────┐ │
    │ │ Redis Cluster│ │◄──────────►│ │ Redis Cluster│ │
    │ │(Session缓存) │ │ CRDT 同步  │ │(Session缓存) │ │
    │ └──────────────┘ │            │ └──────────────┘ │
    └─────────────────┘            └─────────────────┘
```

#### 代码示例

```python
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class Region(Enum):
    US_EAST = "us-east-1"
    US_WEST = "us-west-2"
    EU_WEST = "eu-west-1"
    AP_SOUTHEAST = "ap-southeast-1"

@dataclass
class VectorClock:
    """向量时钟：用于检测跨区域的因果关系和冲突"""
    clocks: dict[str, int] = field(default_factory=dict)

    def increment(self, region: str):
        self.clocks[region] = self.clocks.get(region, 0) + 1

    def merge(self, other: "VectorClock"):
        for region, ts in other.clocks.items():
            self.clocks[region] = max(self.clocks.get(region, 0), ts)

    def is_concurrent_with(self, other: "VectorClock") -> bool:
        """判断两个事件是否并发（互不因果）"""
        self_ahead = any(
            self.clocks.get(r, 0) > other.clocks.get(r, 0) for r in self.clocks
        )
        other_ahead = any(
            other.clocks.get(r, 0) > self.clocks.get(r, 0) for r in other.clocks
        )
        return self_ahead and other_ahead

@dataclass
class SessionRecord:
    session_id: str
    user_id: str
    home_region: str
    messages: list[dict]
    vector_clock: VectorClock
    last_active: float
    version: int

class MultiRegionSessionManager:
    def __init__(self, local_region: Region, db, redis_client, event_bus):
        self.local_region = local_region
        self.db = db
        self.redis = redis_client
        self.event_bus = event_bus

    async def route_request(self, user_id: str) -> Region:
        """决定请求应该由哪个区域处理"""
        session_meta = await self.redis.hgetall(f"session:routing:{user_id}")
        if session_meta:
            home_region = Region(session_meta["home_region"])
            last_active = float(session_meta["last_active"])
            # 如果用户 5 分钟内在其他区域活跃，优先路由到那个区域
            if time.time() - last_active < 300:
                return home_region
        return self.local_region

    async def get_session(self, session_id: str) -> Optional[SessionRecord]:
        """获取会话，优先本地，降级远程拉取"""
        # 1. 尝试本地缓存
        cached = await self.redis.get(f"session:data:{session_id}")
        if cached:
            return SessionRecord(**cached)

        # 2. 尝试本地数据库
        record = await self.db.get_session(session_id)
        if record:
            await self._cache_session(record)
            return record

        # 3. 跨区域拉取（最后手段）
        record = await self._fetch_from_home_region(session_id)
        if record:
            await self.db.upsert_session(record)
            await self._cache_session(record)
        return record

    async def append_message(self, session_id: str, message: dict) -> SessionRecord:
        """追加消息并异步复制到其他区域"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        session.vector_clock.increment(self.local_region.value)
        session.messages.append({
            **message,
            "region": self.local_region.value,
            "vector_clock": session.vector_clock.clocks.copy(),
        })
        session.last_active = time.time()
        session.version += 1

        await self.db.upsert_session(session)
        await self._cache_session(session)

        # 异步发布到跨区域事件流
        await self.event_bus.publish("session.message.appended", {
            "session_id": session_id,
            "message": message,
            "source_region": self.local_region.value,
            "vector_clock": session.vector_clock.clocks,
            "version": session.version,
        })
        return session

    async def handle_replication_event(self, event: dict):
        """处理来自其他区域的复制事件"""
        session_id = event["session_id"]
        source_region = event["source_region"]
        if source_region == self.local_region.value:
            return  # 忽略自己发出的事件

        local_session = await self.db.get_session(session_id)
        incoming_clock = VectorClock(clocks=event["vector_clock"])

        if local_session and local_session.vector_clock.is_concurrent_with(incoming_clock):
            # 检测到冲突：两个区域同时修改了同一个会话
            await self._resolve_conflict(local_session, event)
        else:
            # 无冲突：直接应用远程变更
            if local_session:
                local_session.messages.append(event["message"])
                local_session.vector_clock.merge(incoming_clock)
                local_session.version = max(local_session.version, event["version"])
            await self.db.upsert_session(local_session)

    async def _resolve_conflict(self, local: SessionRecord, remote_event: dict):
        """冲突解决：LWW（Last-Write-Wins）+ 消息合并"""
        # 对于聊天消息，冲突通常意味着用户在两个区域几乎同时发消息
        # 策略：按时间戳排序合并所有消息，不丢弃任何一条
        remote_msg = remote_event["message"]
        local.messages.append(remote_msg)
        local.messages.sort(key=lambda m: m.get("timestamp", 0))
        local.vector_clock.merge(VectorClock(clocks=remote_event["vector_clock"]))
        await self.db.upsert_session(local)

    async def _cache_session(self, session: SessionRecord):
        await self.redis.setex(
            f"session:data:{session.session_id}", 300, session.__dict__
        )

    async def _fetch_from_home_region(self, session_id: str) -> Optional[SessionRecord]:
        """通过内部 API 从会话的 home region 拉取数据"""
        # 实现略：通过 gRPC/HTTP 调用目标区域的内部接口
        pass
```

#### 关键对比

| 维度 | 单区域部署 | Active-Passive | Active-Active (异步) | Active-Active (同步) |
|------|-----------|---------------|---------------------|---------------------|
| 写延迟 | 最低 | 主区域低 | 各区域低 | 高（跨洋 RTT） |
| 读延迟 | 取决于用户位置 | 被动区域高 | 各区域低 | 各区域低 |
| 一致性 | 强一致 | 强一致 | 最终一致 | 强一致 |
| 可用性 | 单点故障 | 手动切换 | 自动容灾 | 受限于最慢节点 |
| 数据冲突 | 无 | 无 | 可能 | 无 |
| 运维复杂度 | 低 | 中 | 高 | 极高 |
| 适用规模 | <100K DAU | <1M DAU | >1M DAU | 特殊场景 |

#### 实际案例

- **ChatGPT 全球部署**：OpenAI 在美国东部和西部各部署了推理集群，使用 Azure Cosmos DB 的多区域写入能力实现会话数据同步，通过 Azure Front Door 做全球流量调度
- **Discord（类似场景）**：全球 5 个区域的 Active-Active 部署，使用 Cassandra 作为跨区域存储，消息通过一致性哈希分配到固定区域，跨区域消息延迟 P99 < 500ms
- **跨区域延迟参考**：US-East ↔ US-West ≈ 60ms，US ↔ Europe ≈ 80-100ms，US ↔ Asia ≈ 150-200ms。异步复制通常在 200-500ms 内完成全球同步
- **故障切换数据**：某全球 Chatbot 服务在美东区域故障时，亚太区域在 30 秒内承接了 100% 流量，期间约 0.3% 的会话出现短暂的消息丢失（后通过修复任务补齐）

#### 面试追问

1. **如何处理"脑裂"场景？** 网络分区导致两个区域各自认为对方不可用，同一会话在两边被同时修改，分区恢复后如何合并？
2. **CRDT 在 Chatbot 场景的适用性如何？** 消息列表可以用 G-Set/OR-Set CRDT 吗？有什么限制？
3. **如何做跨区域的限流和配额同步？** 用户在 A 区域用了 50% 配额，切换到 B 区域后，如何保证全局配额一致性？最终一致是否可接受？

</details>
### Q11: 数据库分片策略如何支撑千万级用户的会话存储？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Chatbot 系统中，会话（conversation）和消息（message）是最核心的存储实体。当用户规模从百万增长到千万级别时，单库单表的架构必然遇到瓶颈——单表行数超过 5000 万后查询性能急剧下降，连接池耗尽、主从延迟飙升等问题接踵而来。数据库分片（Sharding）是解决这类水平扩展问题的标准方案。

分片策略的核心选择是 **分片键（Shard Key）**。对于 Chatbot 场景，`user_id` 是最优分片键，因为绝大多数查询模式都是"查询某个用户的会话列表"或"查询某个会话下的消息"。按 `user_id` 分片能保证同一用户的所有数据落在同一个分片上，避免跨分片查询。如果按 `conversation_id` 分片，虽然消息读取效率高，但查询"用户的所有会话"就需要广播到所有分片，这在千万用户场景下是不可接受的。

除了分片键选择，还需要考虑 **分片算法**（哈希取模 vs 一致性哈希 vs 范围分片）、**数据迁移**（扩容时的 rehash 问题）、**全局有序 ID 生成**（Snowflake / ULID）等工程问题。实际生产中，通常采用逻辑分片（如 1024 个虚拟分片）映射到物理节点的两层架构，扩容时只需调整映射关系，无需全量数据迁移。

#### 架构图

```
                        ┌─────────────────────┐
                        │   Application Layer  │
                        │  (Chatbot Service)   │
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   Sharding Proxy     │
                        │  (ShardingSphere /   │
                        │   Vitess / 自研)     │
                        └──────────┬──────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               │                   │                   │
     ┌─────────▼─────────┐ ┌──────▼──────────┐ ┌──────▼──────────┐
     │  Physical Node 0   │ │ Physical Node 1  │ │ Physical Node 2  │
     │                    │ │                  │ │                  │
     │ ┌────────────────┐ │ │ ┌──────────────┐ │ │ ┌──────────────┐ │
     │ │ VSlot 0~341    │ │ │ │ VSlot 342~682│ │ │ │VSlot 683~1023│ │
     │ │                │ │ │ │              │ │ │ │              │ │
     │ │ conversations  │ │ │ │ conversations│ │ │ │ conversations│ │
     │ │ messages       │ │ │ │ messages     │ │ │ │ messages     │ │
     │ │ user_settings  │ │ │ │ user_settings│ │ │ │ user_settings│ │
     │ └────────────────┘ │ │ └──────────────┘ │ │ └──────────────┘ │
     │                    │ │                  │ │                  │
     │  Master ──► Slave  │ │ Master ──► Slave │ │ Master ──► Slave │
     └────────────────────┘ └──────────────────┘ └──────────────────┘

     分片算法: shard_id = hash(user_id) % 1024
     物理映射: vslot → physical_node (可动态调整)
```

#### 代码示例

```python
import hashlib
from typing import Dict, List, Optional
from dataclasses import dataclass, field

TOTAL_VIRTUAL_SLOTS = 1024

@dataclass
class ShardConfig:
    """虚拟分片到物理节点的映射配置"""
    slot_to_node: Dict[int, str] = field(default_factory=dict)
    node_connections: Dict[str, object] = field(default_factory=dict)

class ConversationShardRouter:
    """会话数据分片路由器"""

    def __init__(self, config: ShardConfig):
        self.config = config

    def _hash_user_id(self, user_id: str) -> int:
        """使用一致性哈希计算用户所属的虚拟分片"""
        digest = hashlib.md5(user_id.encode()).hexdigest()
        return int(digest[:8], 16) % TOTAL_VIRTUAL_SLOTS

    def get_shard(self, user_id: str) -> str:
        """根据 user_id 获取目标物理节点"""
        vslot = self._hash_user_id(user_id)
        return self.config.slot_to_node[vslot]

    def get_connection(self, user_id: str):
        """获取用户数据所在节点的数据库连接"""
        node = self.get_shard(user_id)
        return self.config.node_connections[node]

    async def create_conversation(self, user_id: str, title: str) -> dict:
        conn = self.get_connection(user_id)
        conv_id = generate_ulid()  # 全局有序 ID，自带时间戳
        await conn.execute(
            """INSERT INTO conversations (id, user_id, title, created_at)
               VALUES ($1, $2, $3, NOW())""",
            conv_id, user_id, title
        )
        return {"id": conv_id, "user_id": user_id, "title": title}

    async def list_user_conversations(self, user_id: str,
                                       limit: int = 20,
                                       cursor: Optional[str] = None) -> List[dict]:
        """查询用户会话列表 — 单分片查询，无需跨分片"""
        conn = self.get_connection(user_id)
        if cursor:
            rows = await conn.fetch(
                """SELECT * FROM conversations
                   WHERE user_id = $1 AND id < $2
                   ORDER BY id DESC LIMIT $3""",
                user_id, cursor, limit
            )
        else:
            rows = await conn.fetch(
                """SELECT * FROM conversations
                   WHERE user_id = $1
                   ORDER BY id DESC LIMIT $2""",
                user_id, limit
            )
        return [dict(r) for r in rows]
```

#### 关键对比

| 分片策略 | 优点 | 缺点 | 适用场景 |
|---------|------|------|---------|
| 哈希取模 | 实现简单，数据分布均匀 | 扩容需全量 rehash | 节点数固定的小规模集群 |
| 一致性哈希 | 扩缩容仅影响相邻节点 | 可能出现数据倾斜 | 动态扩缩容频繁的场景 |
| 虚拟分片映射 | 扩容灵活、粒度可控 | 需维护映射元数据 | **生产推荐方案** |
| 范围分片（时间） | 冷热分离天然支持 | 热点写入集中在最新分片 | 日志类数据 |

#### 实际案例

以某 Chatbot 平台的生产数据为参考：
- **用户规模**：2000 万注册用户，300 万 DAU
- **数据量**：会话表 5 亿行，消息表 200 亿行
- **分片方案**：1024 虚拟分片 → 16 台物理节点（每台 64 虚拟分片）
- **单节点配置**：64C128G、NVMe SSD 2TB、PostgreSQL 16
- **查询性能**：用户会话列表 P99 < 15ms，单会话消息加载 P99 < 25ms
- **扩容实践**：16 节点扩至 32 节点，通过虚拟分片迁移完成，业务零停机
- **月度成本**：约 ¥48 万（含主从冗余），单用户存储成本约 ¥0.024/月

#### 面试追问

1. **如果某个大 V 用户产生了极大量会话和消息（热点分片），如何处理？** 提示：二级分片、会话归档、冷热分离策略。
2. **跨分片的全局搜索需求（如管理后台搜索所有用户消息）如何实现？** 提示：异步同步到 Elasticsearch，读写分离。
3. **分片扩容过程中如何保证数据一致性和服务可用性？** 提示：双写 + 数据校验 + 灰度切流。

</details>

---

### Q12: Speculative Decoding 推理加速的原理和工程实现？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

大语言模型推理的根本瓶颈在于自回归解码的串行特性——每生成一个 token 都需要完整的前向传播，且依赖前一个 token 的结果。对于参数量 70B+ 的模型，这意味着即使在高端 GPU 上，单请求的首 token 延迟（TTFT）和逐 token 延迟（TBT）都很可观。Speculative Decoding（投机解码）是近年来最具影响力的推理加速技术之一，它的核心思想是：**用一个小而快的 Draft 模型先"猜测"多个 token，再用大模型一次性并行验证这些猜测，接受正确的部分，拒绝错误的部分**。

这种方法之所以有效，基于两个关键洞察：（1）自然语言中大量 token 是"容易预测"的（如常见短语、语法结构），小模型就能猜对；（2）大模型验证 K 个 token 的计算量，与生成 1 个 token 的计算量几乎相同（因为可以并行处理）。因此，如果 Draft 模型的命中率足够高（通常 > 70%），就能实现 2-3 倍的端到端加速，同时 **输出质量与原始大模型完全一致**——这是因为验证步骤使用了严格的拒绝采样算法，保证了输出分布的无损性。

工程实现上的关键挑战包括：Draft 模型的选择与训练（通常是大模型的蒸馏版本，参数量为 1/10~1/50）、Draft 长度的动态调整（根据命中率实时调节猜测步数）、KV Cache 的协调管理（Draft 和 Target 模型共享部分 cache）、以及 Batch 场景下的调度优化（不同请求的 Draft 命中率不同，需要灵活处理）。

#### 架构图

```
  Speculative Decoding 工作流程

  ┌─────────────────────────────────────────────────────┐
  │                  一次投机迭代                         │
  │                                                     │
  │  Step 1: Draft 模型快速生成 K 个候选 token            │
  │  ┌──────────┐                                       │
  │  │Draft (1B) │──→ [t1, t2, t3, t4, t5]  (K=5)      │
  │  │ ~2ms/tok  │    猜测序列                           │
  │  └──────────┘                                       │
  │       │                                             │
  │       ▼                                             │
  │  Step 2: Target 模型并行验证所有候选                   │
  │  ┌──────────┐                                       │
  │  │Target(70B)│──→ 一次前向传播验证 5 个 token          │
  │  │ ~50ms/tok │    P(t1), P(t2|t1), ..., P(t5|t1..t4)│
  │  └──────────┘                                       │
  │       │                                             │
  │       ▼                                             │
  │  Step 3: 拒绝采样，确定接受位置                       │
  │  [t1:✅, t2:✅, t3:✅, t4:❌, t5:丢弃]               │
  │       │                                             │
  │       ▼                                             │
  │  结果: 一次迭代生成了 3 个有效 token + 1 个修正 token   │
  │  等效速度: 4 tokens / 60ms ≈ 66 tok/s               │
  │  (原始速度: 1 token / 50ms ≈ 20 tok/s)              │
  └─────────────────────────────────────────────────────┘

  Draft 命中率与加速比关系:
  ┌────────────────────────────────────────────────┐
  │  命中率   │  K=3  │  K=5  │  K=8  │  最优 K   │
  │───────────┼───────┼───────┼───────┼──────────│
  │  60%      │ 1.5x  │ 1.4x  │ 1.2x  │  3       │
  │  75%      │ 2.0x  │ 2.2x  │ 2.0x  │  5       │
  │  85%      │ 2.3x  │ 2.8x  │ 3.1x  │  7-8     │
  │  95%      │ 2.5x  │ 3.2x  │ 4.0x  │  10+     │
  └────────────────────────────────────────────────┘
```

#### 代码示例

```python
import torch
from typing import List, Tuple

class SpeculativeDecoder:
    """投机解码引擎核心实现"""

    def __init__(self, draft_model, target_model, max_draft_len: int = 5):
        self.draft = draft_model
        self.target = target_model
        self.max_k = max_draft_len
        self.adaptive_k = max_draft_len  # 动态调整的猜测长度

    @torch.no_grad()
    def generate(self, input_ids: torch.Tensor, max_new_tokens: int) -> List[int]:
        generated = []

        while len(generated) < max_new_tokens:
            # Step 1: Draft 模型快速生成 K 个候选 token
            draft_tokens, draft_probs = self._draft_generate(
                input_ids, k=self.adaptive_k
            )

            # Step 2: Target 模型并行验证
            target_probs = self._target_verify(input_ids, draft_tokens)

            # Step 3: 拒绝采样
            accepted, correction = self._rejection_sample(
                draft_tokens, draft_probs, target_probs
            )

            # 更新已生成序列
            generated.extend(accepted)
            if correction is not None:
                generated.append(correction)

            # 更新 input_ids
            new_tokens = accepted + ([correction] if correction else [])
            input_ids = torch.cat([
                input_ids,
                torch.tensor([new_tokens], device=input_ids.device)
            ], dim=-1)

            # 自适应调整 K 值
            self._adapt_k(len(accepted), self.adaptive_k)

        return generated[:max_new_tokens]

    def _rejection_sample(
        self,
        draft_tokens: List[int],
        draft_probs: torch.Tensor,
        target_probs: torch.Tensor
    ) -> Tuple[List[int], int]:
        """拒绝采样：保证输出分布与 Target 模型完全一致"""
        accepted = []
        for i, token in enumerate(draft_tokens):
            p_target = target_probs[i, token].item()
            p_draft = draft_probs[i, token].item()

            # 接受概率 = min(1, p_target / p_draft)
            if torch.rand(1).item() < min(1.0, p_target / p_draft):
                accepted.append(token)
            else:
                # 从修正分布中采样
                residual = torch.clamp(target_probs[i] - draft_probs[i], min=0)
                residual = residual / residual.sum()
                correction = torch.multinomial(residual, 1).item()
                return accepted, correction

        # 所有 draft token 都被接受，额外从 target 采样一个
        bonus = torch.multinomial(target_probs[-1], 1).item()
        return accepted, bonus

    def _adapt_k(self, accepted_count: int, current_k: int):
        """根据命中率动态调整猜测长度"""
        acceptance_rate = accepted_count / current_k if current_k > 0 else 0
        if acceptance_rate > 0.8 and self.adaptive_k < self.max_k:
            self.adaptive_k += 1  # 命中率高，增加猜测步数
        elif acceptance_rate < 0.5 and self.adaptive_k > 1:
            self.adaptive_k -= 1  # 命中率低，减少猜测步数
```

#### 关键对比

| 技术方案 | 加速比 | 质量保证 | 额外显存 | 实现复杂度 |
|---------|--------|---------|---------|-----------|
| Speculative Decoding | 2-3x | 无损（数学证明） | +10~20% | 中等 |
| Medusa（多头预测） | 2-3x | 近似无损 | +5% | 低 |
| Lookahead Decoding | 1.5-2x | 无损 | +15% | 高 |
| Quantization (INT4) | 1.5-2x | 轻微损失 | -60% | 低 |
| 组合: Spec + INT4 | 3-5x | 轻微损失 | -50% | 高 |

#### 实际案例

以某在线 Chatbot 部署 Speculative Decoding 的生产数据：
- **模型配置**：Target = Llama-3-70B (4x A100-80G)，Draft = Llama-3-8B (同机共享)
- **Draft 显存开销**：额外 ~16GB（INT8 量化后），占总显存 5%
- **平均接受长度**：3.8 tokens/iteration（命中率 ~76%）
- **吞吐量提升**：单请求 18 tok/s → 47 tok/s（2.6 倍加速）
- **首 token 延迟**：略有增加（+8ms），因需初始化 Draft KV Cache
- **适用场景对比**：代码生成（命中率 85%+，加速 3x）> 通用对话（75%，2.5x）> 创意写作（60%，1.8x）
- **成本影响**：推理成本降低约 55%，因同等吞吐量可减少 GPU 数量

#### 面试追问

1. **Speculative Decoding 为什么能保证输出质量与原始模型完全一致？** 提示：拒绝采样的数学证明，修正分布 max(0, p_target - p_draft) 的正确性。
2. **在 Continuous Batching 场景下，不同请求的 Draft 命中率不同，如何高效调度？** 提示：分组验证、异步 Draft 生成、动态 Batch 重组。
3. **如果没有现成的 Draft 模型，有哪些替代方案？** 提示：Self-Speculative（利用浅层 exit）、N-gram 查表、Prompt Lookup Decoding。

</details>

---

### Q13: 输入输出内容安全审查 Pipeline 如何设计？

**难度**: ⭐⭐⭐ 高级

<details>
<summary>💡 查看解答</summary>

#### 核心概念

内容安全是 Chatbot 产品上线的"生死线"——无论模型能力多强，一旦输出有害内容（仇恨言论、虚假医疗建议、违法信息等），或被用户通过 Prompt Injection 操纵绕过安全策略，整个产品都面临下架风险。内容安全审查 Pipeline 需要覆盖 **输入侧**（用户提交的 prompt）和 **输出侧**（模型生成的 response）两个方向，形成双向防护。

一个成熟的安全审查 Pipeline 通常采用**分层过滤**架构：第一层是高性能的规则引擎（正则匹配、关键词黑名单、IP/设备风控），延迟 < 5ms，拦截最明显的违规；第二层是轻量级分类模型（如 BERT-base 级别的安全分类器），延迟 10-20ms，覆盖语义层面的违规；第三层是基于 LLM 的深度审查（如 GPT-4 Judge 或专门微调的安全模型），延迟 200-500ms，处理需要上下文理解的复杂场景（如隐喻式有害内容、多轮对话中的渐进式 Jailbreak）。三层架构的设计哲学是"漏斗式过滤"——越往后精度越高但成本也越高，前两层过滤掉 95%+ 的违规，大幅降低第三层的调用量。

输出侧审查的额外挑战在于流式场景：当使用 SSE 流式输出时，不能等到全部生成完再审查（用户已经看到了），也不能逐 token 审查（粒度太细没有语义）。工程上通常采用**滑动窗口审查**——每积攒 N 个 token（如 20-30 个）或遇到句号/换行时，对窗口内容进行实时审查，一旦检测到风险立即中断流并替换为安全回复。

#### 架构图

```
  ┌─────────────────────────────────────────────────────────────┐
  │                  内容安全审查 Pipeline                        │
  │                                                             │
  │  用户输入                                                    │
  │     │                                                       │
  │     ▼                                                       │
  │  ┌──────────────┐  通过   ┌──────────────┐  通过            │
  │  │ L1: 规则引擎  │──────→ │ L2: 分类模型  │──────→           │
  │  │ - 关键词黑名单│        │ - BERT 分类器 │        ┌────────┐│
  │  │ - 正则匹配   │        │ - 多标签分类  │        │L3: LLM ││
  │  │ - 频率限制   │        │ - 意图识别    │──────→ │深度审查 ││
  │  │ 延迟: <5ms   │        │ 延迟: ~15ms   │  可疑   │延迟:   ││
  │  └──────┬───────┘        └──────┬───────┘        │~300ms  ││
  │    拦截 │                  拦截 │                 └───┬────┘│
  │         ▼                      ▼                     │     │
  │  ┌──────────┐           ┌──────────┐           拦截  │     │
  │  │ 直接拒绝 │           │ 安全回复  │                 ▼     │
  │  └──────────┘           └──────────┘           ┌─────────┐ │
  │                                                │ 安全回复 │ │
  │     通过所有层 ───────────────────→ LLM 推理     └─────────┘ │
  │                                      │                     │
  │                                      ▼                     │
  │                              ┌───────────────┐             │
  │                              │ 输出侧审查     │             │
  │                              │ (滑动窗口模式)  │             │
  │                              │               │             │
  │                              │ 每30 token审查 │             │
  │                              │ 句末触发审查   │             │
  │                              │ 流中断+替换    │             │
  │                              └───────┬───────┘             │
  │                                      │                     │
  │                                      ▼                     │
  │                              返回安全的响应给用户             │
  └─────────────────────────────────────────────────────────────┘
```

#### 代码示例

```python
import asyncio
import re
from enum import Enum
from dataclasses import dataclass
from typing import AsyncIterator, Optional

class RiskLevel(Enum):
    SAFE = "safe"
    SUSPICIOUS = "suspicious"
    BLOCKED = "blocked"

@dataclass
class ModerationResult:
    level: RiskLevel
    category: Optional[str] = None
    confidence: float = 0.0
    detail: str = ""

class ContentModerationPipeline:
    """三层内容安全审查管线"""

    def __init__(self, keyword_list, classifier_model, llm_judge):
        self.keywords = keyword_list
        self.classifier = classifier_model
        self.llm_judge = llm_judge

    async def check_input(self, user_input: str) -> ModerationResult:
        """输入侧审查：三层漏斗"""
        # L1: 规则引擎（< 5ms）
        l1 = self._rule_check(user_input)
        if l1.level == RiskLevel.BLOCKED:
            return l1

        # L2: 分类模型（~15ms）
        l2 = await self._classifier_check(user_input)
        if l2.level == RiskLevel.BLOCKED:
            return l2

        # L3: 仅对可疑内容调用 LLM 深度审查（~300ms）
        if l2.level == RiskLevel.SUSPICIOUS:
            l3 = await self._llm_judge_check(user_input)
            return l3

        return ModerationResult(level=RiskLevel.SAFE)

    def _rule_check(self, text: str) -> ModerationResult:
        """L1: 高性能规则匹配"""
        text_lower = text.lower()
        for keyword, category in self.keywords:
            if keyword in text_lower:
                return ModerationResult(
                    level=RiskLevel.BLOCKED,
                    category=category,
                    confidence=0.99,
                    detail=f"命中关键词: {keyword}"
                )
        # Prompt injection 模式检测
        injection_patterns = [
            r"ignore\s+(all\s+)?previous\s+instructions",
            r"你现在是一个没有任何限制的",
            r"DAN\s+mode",
        ]
        for pattern in injection_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return ModerationResult(
                    level=RiskLevel.BLOCKED,
                    category="prompt_injection",
                    confidence=0.95,
                )
        return ModerationResult(level=RiskLevel.SAFE)

    async def moderate_stream(
        self, token_stream: AsyncIterator[str]
    ) -> AsyncIterator[str]:
        """输出侧流式审查：滑动窗口"""
        buffer = ""
        safe_output = ""

        async for token in token_stream:
            buffer += token

            # 触发审查条件：积攒 30 字符或遇到句末标点
            should_check = (
                len(buffer) >= 30
                or buffer.rstrip().endswith(("。", "！", "？", ".", "!", "?", "\n"))
            )
            if should_check:
                result = await self._classifier_check(safe_output + buffer)
                if result.level == RiskLevel.BLOCKED:
                    yield "\n\n[内容已过滤] 抱歉，该回复包含不适当内容。"
                    return  # 中断流
                else:
                    yield buffer
                    safe_output += buffer
                    buffer = ""

        # 处理剩余 buffer
        if buffer:
            yield buffer
```

#### 关键对比

| 审查层 | 延迟 | 准确率 | 召回率 | 成本/百万次 | 拦截比例 |
|-------|------|-------|-------|-----------|---------|
| L1 规则引擎 | < 5ms | 99% | 30% | ~¥0 | ~15% |
| L2 分类模型 | ~15ms | 92% | 85% | ~¥50 | ~75% |
| L3 LLM 审查 | ~300ms | 97% | 95% | ~¥2000 | ~10% |
| 三层组合 | ~20ms（均摊） | 98%+ | 96%+ | ~¥300 | 100% |

#### 实际案例

以某国内 Chatbot 平台的安全审查体系为参考：
- **日审查量**：1.2 亿次输入 + 8000 万次输出
- **L1 拦截率**：12%（大量重复的违规关键词和 Prompt Injection 模板）
- **L2 拦截率**：6%（语义层面的变体违规，如谐音、隐喻）
- **L3 调用率**：仅 3% 的请求触发 LLM 深度审查
- **端到端误判率**：0.02%（通过人工标注反馈持续优化）
- **月度成本**：安全审查总成本约 ¥35 万，占总推理成本的 8%
- **关键事件**：上线首月拦截了 3 起试图通过多轮渐进式对话诱导模型输出有害内容的攻击

#### 面试追问

1. **如何应对不断演化的 Jailbreak 攻击（如多语言混合、Unicode 混淆、渐进式诱导）？** 提示：对抗训练、红队持续攻防、动态规则更新。
2. **流式输出审查中，如果有害内容恰好被切分到两个窗口怎么办？** 提示：窗口重叠策略、上下文累积审查。
3. **安全审查带来的延迟如何优化，是否可以与推理并行？** 提示：输入审查与 prefill 并行、输出审查异步化、分级审查策略。

</details>

---

### Q14: 设计一个类 ChatGPT 的产品架构（支撑 100 万 DAU）

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

设计一个支撑百万 DAU 的 ChatGPT 类产品，需要从用户交互层、业务逻辑层、模型推理层、数据存储层四个维度进行系统性架构设计。核心挑战包括：（1）推理资源极其昂贵，GPU 成本占总成本的 70%+，必须精细化资源管理；（2）流式交互对延迟极其敏感，TTFT > 3s 将导致 30%+ 的用户流失；（3）会话数据的持久化和检索需要支撑高并发读写；（4）多模型、多功能的统一调度需要灵活的路由机制。

关键设计决策包括：Gateway 层如何实现智能限流和优先级调度、推理集群如何根据负载弹性伸缩、KV Cache 如何跨请求复用以降低成本、以及如何通过分级服务（免费/付费/企业）实现商业化。

#### 架构图

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    类 ChatGPT 产品全局架构 (100 万 DAU)                   │
  │                                                                         │
  │  ┌──────────────────────────────────────────────────────┐                │
  │  │                 用户接入层 (Edge)                      │                │
  │  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌────────────────┐   │                │
  │  │  │Web UI│  │iOS   │  │Android│  │ API (开发者)    │   │                │
  │  │  └──┬───┘  └──┬───┘  └──┬───┘  └──────┬─────────┘   │                │
  │  │     └─────────┼────────┼──────────────┘              │                │
  │  │               ▼        ▼                              │                │
  │  │         CDN + Global Load Balancer                    │                │
  │  └──────────────────────┬───────────────────────────────┘                │
  │                         ▼                                                │
  │  ┌──────────────────────────────────────────────────────┐                │
  │  │              API Gateway & 流量治理                    │                │
  │  │  ┌────────────┐ ┌──────────┐ ┌────────────────────┐  │                │
  │  │  │ 认证/鉴权   │ │ 限流/配额 │ │ 优先级队列调度      │  │                │
  │  │  │ JWT + API   │ │ 滑动窗口  │ │ Plus > Free       │  │                │
  │  │  │ Key 验证    │ │ 令牌桶    │ │ 动态权重调整       │  │                │
  │  │  └────────────┘ └──────────┘ └────────────────────┘  │                │
  │  └──────────────────────┬───────────────────────────────┘                │
  │                         ▼                                                │
  │  ┌──────────────────────────────────────────────────────┐                │
  │  │              业务服务层 (Microservices)                │                │
  │  │                                                      │                │
  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │                │
  │  │  │ 会话管理  │  │ 用户服务  │  │ 内容安全审查      │   │                │
  │  │  │ Service   │  │ Service  │  │ Service          │   │                │
  │  │  └──────────┘  └──────────┘  └──────────────────┘   │                │
  │  │                                                      │                │
  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │                │
  │  │  │ 模型路由  │  │ Prompt   │  │ 文件/多模态      │   │                │
  │  │  │ Service   │  │ 管理     │  │ 处理 Service     │   │                │
  │  │  └──────────┘  └──────────┘  └──────────────────┘   │                │
  │  └──────────────────────┬───────────────────────────────┘                │
  │                         ▼                                                │
  │  ┌──────────────────────────────────────────────────────┐                │
  │  │              推理引擎层 (GPU Cluster)                  │                │
  │  │                                                      │                │
  │  │  ┌───────────────┐  ┌───────────────┐                │                │
  │  │  │  GPT-4 集群    │  │  GPT-3.5 集群  │                │                │
  │  │  │  64x A100      │  │  32x A100     │                │                │
  │  │  │  vLLM/TRT-LLM  │  │  vLLM         │                │                │
  │  │  └───────────────┘  └───────────────┘                │                │
  │  │                                                      │                │
  │  │  ┌───────────────┐  ┌───────────────┐                │                │
  │  │  │  Embedding 集群│  │  安全分类模型   │                │                │
  │  │  │  8x A10        │  │  4x A10       │                │                │
  │  │  └───────────────┘  └───────────────┘                │                │
  │  └──────────────────────────────────────────────────────┘                │
  │                                                                         │
  │  ┌──────────────────────────────────────────────────────┐                │
  │  │              数据存储层                                │                │
  │  │  ┌──────────┐ ┌─────────┐ ┌───────┐ ┌─────────────┐ │                │
  │  │  │PostgreSQL│ │  Redis  │ │  S3   │ │Elasticsearch│ │                │
  │  │  │(分片x16) │ │ Cluster │ │ 文件  │ │ 全文检索     │ │                │
  │  │  │会话+消息  │ │缓存+会话 │ │ 存储  │ │             │ │                │
  │  │  └──────────┘ └─────────┘ └───────┘ └─────────────┘ │                │
  │  └──────────────────────────────────────────────────────┘                │
  └─────────────────────────────────────────────────────────────────────────┘
```

#### 代码示例

```typescript
// 智能模型路由 — 根据用户层级、请求类型、系统负载动态选择模型
interface RouteDecision {
  model: string;
  cluster: string;
  priority: number;
  maxTokens: number;
  timeout: number;
}

class ModelRouter {
  private loadMonitor: ClusterLoadMonitor;

  async route(request: ChatRequest): Promise<RouteDecision> {
    const userTier = await this.getUserTier(request.userId);
    const clusterLoad = await this.loadMonitor.getSnapshot();
    const complexity = this.estimateComplexity(request);

    // 付费用户优先使用高端模型
    if (userTier === 'plus') {
      if (clusterLoad.gpt4Usage < 0.85) {
        return {
          model: 'gpt-4-turbo',
          cluster: 'gpu-cluster-premium',
          priority: 10,
          maxTokens: 8192,
          timeout: 120_000,
        };
      }
      // GPU 负载过高时，Plus 用户降级到 3.5 但提高优先级
      return {
        model: 'gpt-3.5-turbo',
        cluster: 'gpu-cluster-standard',
        priority: 8,  // 仍高于免费用户
        maxTokens: 4096,
        timeout: 60_000,
      };
    }

    // 免费用户根据复杂度路由
    if (complexity === 'simple') {
      return {
        model: 'gpt-3.5-turbo',
        cluster: 'gpu-cluster-standard',
        priority: 3,
        maxTokens: 2048,
        timeout: 30_000,
      };
    }

    // 免费用户的复杂请求 — 加入排队
    return {
      model: 'gpt-3.5-turbo',
      cluster: 'gpu-cluster-standard',
      priority: 1,
      maxTokens: 2048,
      timeout: 60_000,
    };
  }

  private estimateComplexity(req: ChatRequest): 'simple' | 'complex' {
    const totalTokens = req.messages.reduce(
      (sum, m) => sum + this.countTokens(m.content), 0
    );
    return totalTokens > 2000 || req.messages.length > 10
      ? 'complex'
      : 'simple';
  }
}
```

#### 资源估算

| 资源类型 | 规格 | 数量 | 月度成本（估算） | 说明 |
|---------|------|------|---------------|------|
| GPU (A100-80G) | 推理集群 | 96 张 | ¥576 万 | 核心成本，含冗余 |
| GPU (A10-24G) | Embedding/安全 | 12 张 | ¥14 万 | 辅助模型 |
| CPU 服务器 | 64C128G | 40 台 | ¥32 万 | 业务微服务 |
| PostgreSQL | 64C128G + 2T SSD | 32 台 | ¥48 万 | 16 分片 x 主从 |
| Redis Cluster | 32G 内存 | 12 节点 | ¥9 万 | 会话缓存 |
| 带宽 + CDN | - | - | ¥15 万 | 全球加速 |
| **总计** | | | **~¥694 万/月** | |

**单用户成本分析**：
- 100 万 DAU，日均 10 轮对话，平均 500 token/轮
- 日消耗 ~50 亿 token，推理成本占 83%
- 单用户日成本 ≈ ¥2.3，月成本 ≈ ¥69（远高于 ¥20/月的 Plus 订阅价）
- **降本关键**：KV Cache 复用（-20%）、Prompt Caching（-15%）、Speculative Decoding（-30%）

#### 分阶段上线计划

| 阶段 | 时间 | DAU 目标 | 关键里程碑 |
|------|------|---------|-----------|
| P0 内测 | 第 1-2 月 | 1 万 | 单模型、基础对话、邀请制 |
| P1 公测 | 第 3-4 月 | 10 万 | 多模型路由、流式输出、会话历史 |
| P2 正式版 | 第 5-8 月 | 50 万 | 付费订阅、插件系统、移动端 |
| P3 规模化 | 第 9-12 月 | 100 万 | 全球多区域部署、企业 API、多模态 |

#### 降级策略

| 触发条件 | 降级措施 | 恢复条件 |
|---------|---------|---------|
| GPU 负载 > 90% | 免费用户排队，限制 max_tokens | GPU < 75% |
| GPU 负载 > 95% | 全部降级到轻量模型 | GPU < 80% |
| 存储层延迟 > 500ms | 关闭历史消息加载，仅保留当前会话 | 延迟 < 100ms |
| 全局故障 | 返回预设静态回复 + 故障提示 | 服务恢复 |

#### 面试追问

1. **如何设计 Prompt Caching 机制来降低 System Prompt 的重复计算成本？** 提示：前缀树索引、KV Cache 共享池、TTL 管理。
2. **全球多区域部署时，用户数据（会话历史）如何处理跨区域访问？** 提示：数据本地化 vs 全局同步、GDPR 合规。
3. **免费用户的转化率只有 3%，如何通过技术手段提升付费转化？** 提示：体验差异化设计、使用量可视化、渐进式限流。

</details>

---

### Q15: 设计 Perplexity 式搜索增强 AI 系统

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Perplexity 代表了"搜索 + LLM"融合的新范式，其核心价值在于：用户提出问题后，系统自动搜索实时网络信息，将检索结果作为上下文注入 LLM，生成带有引用来源的结构化回答。与传统 RAG 不同，Perplexity 式系统需要面对 **开放域实时搜索**（而非私有知识库）、**多源信息融合与冲突消解**、**引用准确性保证**、以及 **搜索与生成的延迟平衡** 等独特挑战。

系统的核心链路是：Query 理解 → 搜索意图分解 → 多源并行检索 → 结果排序与去重 → Chunk 提取与相关性过滤 → LLM 生成带引用回答 → 引用验证与后处理。每个环节都需要精细的工程优化，特别是搜索和生成的并行化——不能串行等待所有搜索结果后再开始生成，而应采用流式注入的方式，让 LLM 在搜索结果逐步到达时就开始生成。

#### 架构图

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │            Perplexity 式搜索增强 AI 系统架构                          │
  │                                                                      │
  │  用户: "2025年全球AI芯片市场格局如何？"                                 │
  │     │                                                                │
  │     ▼                                                                │
  │  ┌────────────────────────────────────────────┐                      │
  │  │          Query 理解与分解引擎                 │                      │
  │  │                                            │                      │
  │  │  1. 意图识别: 信息查询 + 市场分析             │                      │
  │  │  2. 查询分解:                                │                      │
  │  │     q1: "2025 global AI chip market share"  │                      │
  │  │     q2: "AI芯片厂商排名 2025"               │                      │
  │  │     q3: "NVIDIA AMD Intel AI chip revenue"  │                      │
  │  │  3. 时效性判断: 需要实时数据                   │                      │
  │  └────────────────────┬───────────────────────┘                      │
  │                       │                                              │
  │          ┌────────────┼────────────┐                                 │
  │          ▼            ▼            ▼                                 │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    ← 多源并行检索            │
  │  │ Web 搜索  │ │ 学术搜索  │ │ 新闻搜索  │                             │
  │  │ Bing API  │ │ Semantic │ │ News API │                             │
  │  │ Google    │ │ Scholar  │ │          │                             │
  │  └────┬─────┘ └────┬─────┘ └────┬─────┘                             │
  │       └────────────┼────────────┘                                    │
  │                    ▼                                                 │
  │  ┌────────────────────────────────────────────┐                      │
  │  │        检索后处理 Pipeline                    │                      │
  │  │                                            │                      │
  │  │  1. URL 去重 + 域名权威性评分                 │                      │
  │  │  2. 页面抓取 + 正文提取 (Readability)         │                      │
  │  │  3. Chunk 切分 (512 token/chunk)            │                      │
  │  │  4. 相关性重排序 (Cross-Encoder Reranker)    │                      │
  │  │  5. Top-K 选择 (K=8~12 个 chunk)            │                      │
  │  └────────────────────┬───────────────────────┘                      │
  │                       ▼                                              │
  │  ┌────────────────────────────────────────────┐                      │
  │  │        LLM 生成层 (带引用生成)                │                      │
  │  │                                            │                      │
  │  │  System: "基于以下来源回答，使用[1][2]标注引用" │                      │
  │  │  Context: [Source 1] ... [Source 8]         │                      │
  │  │  Query: 用户原始问题                         │                      │
  │  │                                            │                      │
  │  │  输出: 结构化回答 + 内联引用标记               │                      │
  │  └────────────────────┬───────────────────────┘                      │
  │                       ▼                                              │
  │  ┌────────────────────────────────────────────┐                      │
  │  │        引用验证与后处理                       │                      │
  │  │                                            │                      │
  │  │  1. 验证 [N] 标记对应的来源确实支持该论述      │                      │
  │  │  2. 移除无法验证的引用                        │                      │
  │  │  3. 生成来源卡片 (标题+摘要+URL+favicon)      │                      │
  │  │  4. 生成追问建议                             │                      │
  │  └────────────────────────────────────────────┘                      │
  └──────────────────────────────────────────────────────────────────────┘
```

#### 代码示例

```python
import asyncio
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class SearchSource:
    url: str
    title: str
    snippet: str
    content: str = ""
    relevance_score: float = 0.0
    domain_authority: float = 0.0

@dataclass
class CitedAnswer:
    text: str
    sources: List[SearchSource] = field(default_factory=list)
    follow_up_questions: List[str] = field(default_factory=list)

class SearchAugmentedGenerator:
    """搜索增强生成引擎"""

    def __init__(self, search_client, reranker, llm_client):
        self.search = search_client
        self.reranker = reranker
        self.llm = llm_client

    async def answer(self, query: str) -> CitedAnswer:
        # Step 1: Query 分解（并行生成多个搜索查询）
        sub_queries = await self._decompose_query(query)

        # Step 2: 多源并行搜索
        search_tasks = []
        for sq in sub_queries:
            search_tasks.append(self.search.web_search(sq, count=10))
            search_tasks.append(self.search.news_search(sq, count=5))
        raw_results = await asyncio.gather(*search_tasks)

        # Step 3: 合并去重
        all_sources = self._deduplicate(
            [src for batch in raw_results for src in batch]
        )

        # Step 4: 并行抓取页面正文
        fetch_tasks = [self._fetch_content(s) for s in all_sources[:20]]
        all_sources = await asyncio.gather(*fetch_tasks)

        # Step 5: Reranker 重排序，选择 Top-K
        ranked = await self.reranker.rank(query, all_sources)
        top_sources = ranked[:10]

        # Step 6: 构建 Prompt 并生成带引用的回答
        context = self._build_context(top_sources)
        answer_text = await self.llm.generate(
            system_prompt=CITATION_SYSTEM_PROMPT,
            user_message=f"来源资料:\n{context}\n\n用户问题: {query}",
            max_tokens=2048,
        )

        # Step 7: 验证引用准确性
        verified_text = await self._verify_citations(answer_text, top_sources)

        # Step 8: 生成追问建议
        follow_ups = await self._generate_follow_ups(query, verified_text)

        return CitedAnswer(
            text=verified_text,
            sources=top_sources,
            follow_up_questions=follow_ups,
        )

    def _build_context(self, sources: List[SearchSource]) -> str:
        parts = []
        for i, src in enumerate(sources, 1):
            parts.append(
                f"[来源 {i}] {src.title}\n"
                f"URL: {src.url}\n"
                f"内容: {src.content[:800]}\n"
            )
        return "\n---\n".join(parts)
```

#### 资源估算

| 组件 | 规格 | 数量 | 月度成本 | 延迟贡献 |
|------|------|------|---------|---------|
| 搜索 API (Bing) | 1000 万次/月 | - | ¥7 万 | ~200ms |
| 页面抓取集群 | 16C32G | 10 台 | ¥4 万 | ~300ms |
| Reranker 模型 | A10 GPU | 4 张 | ¥5 万 | ~50ms |
| LLM 推理 (70B) | A100 GPU | 32 张 | ¥192 万 | ~2s |
| Redis 缓存 | 64G | 6 节点 | ¥5 万 | - |
| **总计** | | | **~¥213 万/月** | **~2.5s E2E** |

**缓存优化**：
- 热门查询缓存命中率 ~35%，节省搜索 API + 推理成本
- 页面内容缓存 TTL = 1h，减少重复抓取
- 缓存后均摊成本降低约 25%

#### 分阶段上线计划

| 阶段 | 时间 | 功能 | 关键指标 |
|------|------|------|---------|
| MVP | 第 1-3 月 | 单源搜索 + 基础引用 | E2E < 5s，引用准确率 > 80% |
| V1.0 | 第 4-6 月 | 多源搜索 + Reranker + 流式输出 | E2E < 3s，准确率 > 90% |
| V2.0 | 第 7-10 月 | 追问链、Pro 搜索（深度研究模式） | 深度模式支持 30+ 来源 |
| V3.0 | 第 11-15 月 | 多模态搜索（图片/视频）、API 开放 | 全媒体类型覆盖 |

#### 降级策略

| 触发条件 | 降级措施 | 用户感知 |
|---------|---------|---------|
| 搜索 API 超时 (>2s) | 使用缓存结果或仅基于 LLM 知识回答 | 提示"部分来源暂不可用" |
| 页面抓取失败率 > 30% | 仅使用搜索摘要（snippet）作为上下文 | 引用质量下降但可用 |
| LLM 集群过载 | 切换到轻量模型 (7B/14B) | 回答质量下降，速度提升 |
| 全链路故障 | 返回搜索结果列表（退化为传统搜索） | 展示"AI 总结暂不可用" |

#### 面试追问

1. **如何处理多个来源之间的信息冲突（如不同网站给出矛盾数据）？** 提示：来源权威性加权、时间新鲜度优先、冲突标注。
2. **如何实现"Pro 搜索"（深度研究模式），让系统像研究员一样迭代搜索？** 提示：多轮搜索、树状查询展开、中间结果摘要、Plan-and-Execute。
3. **搜索结果的版权问题如何处理？大段引用网页内容是否存在法律风险？** 提示：Fair Use 原则、摘要式引用 vs 原文引用、robots.txt 尊重。

</details>

---

### Q16: 大促/热点事件期间的降级策略设计

**难度**: 🎯 场景设计

<details>
<summary>💡 查看解答</summary>

#### 核心概念

Chatbot 系统在遭遇流量洪峰时（如产品发布引爆社交媒体、重大新闻事件导致用户涌入、大促活动等），请求量可能在几分钟内飙升至日常峰值的 5-10 倍。由于 LLM 推理的 GPU 资源无法像 CPU 服务那样快速弹性伸缩（GPU 实例启动需要 5-15 分钟，模型加载需要额外 2-5 分钟），**预案式降级** 是保障系统可用性的生命线。

降级策略的核心哲学是"**有损服务优于无服务**"——宁可降低服务质量（使用小模型、限制输出长度、关闭非核心功能），也不能让系统完全不可用。一个成熟的降级体系需要包含三个层次：（1）**预防性降级**——提前基于流量预测调整参数；（2）**自适应降级**——根据实时指标自动触发策略切换；（3）**熔断兜底**——在极端情况下快速失败而非长时间等待。

关键设计原则是**分级保护**：付费用户的体验应最后受影响，核心功能（基础对话）的可用性应高于增值功能（插件、文件分析），短回复的优先级应高于长文生成。

#### 架构图

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │               大促/热点事件降级策略体系                                 │
  │                                                                      │
  │  流量监控层                                                           │
  │  ┌──────────────────────────────────────────────────────┐            │
  │  │  实时指标 Dashboard                                   │            │
  │  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │            │
  │  │  │ QPS     │ │ GPU 利用率│ │ 队列深度  │ │ P99 延迟  │ │            │
  │  │  │ 5000/s  │ │   92%    │ │  1200    │ │  8.5s    │ │            │
  │  │  └─────────┘ └──────────┘ └──────────┘ └──────────┘ │            │
  │  └──────────────────────┬───────────────────────────────┘            │
  │                         │ 触发条件判断                                │
  │                         ▼                                            │
  │  ┌──────────────────────────────────────────────────────┐            │
  │  │           降级决策引擎 (Degradation Controller)        │            │
  │  │                                                      │            │
  │  │   Level 0: 正常    → 全功能服务                        │            │
  │  │   ──────────────────────────────────────              │            │
  │  │   Level 1: 预警    → GPU>75% 或 QPS>3000              │            │
  │  │   动作: 关闭非核心功能、预热备用节点                      │            │
  │  │   ──────────────────────────────────────              │            │
  │  │   Level 2: 降级    → GPU>85% 或 P99>5s                │            │
  │  │   动作: 免费用户限流、模型降级、限制输出长度              │            │
  │  │   ──────────────────────────────────────              │            │
  │  │   Level 3: 严重    → GPU>93% 或 队列>2000              │            │
  │  │   动作: 全用户排队、仅保留核心对话、关闭流式             │            │
  │  │   ──────────────────────────────────────              │            │
  │  │   Level 4: 熔断    → GPU>98% 或 错误率>10%             │            │
  │  │   动作: 新请求直接拒绝、返回降级页面                     │            │
  │  └──────────────────────┬───────────────────────────────┘            │
  │                         │                                            │
  │                         ▼                                            │
  │  各级降级动作详解                                                     │
  │  ┌──────────────────────────────────────────────────────┐            │
  │  │  Level 1 (预警)                                      │            │
  │  │  ┌───────────────────────────────────────────┐       │            │
  │  │  │ ✂ 关闭: 文件上传分析、图片生成、插件调用    │       │            │
  │  │  │ 🔄 启动: 备用 GPU 节点预热 (5-10min)       │       │            │
  │  │  │ 📊 通知: 运维团队进入待命状态               │       │            │
  │  │  └───────────────────────────────────────────┘       │            │
  │  │                                                      │            │
  │  │  Level 2 (降级)                                      │            │
  │  │  ┌───────────────────────────────────────────┐       │            │
  │  │  │ 🚦 免费用户: 限速 1 req/30s, max_tokens=512│       │            │
  │  │  │ 🔄 模型切换: GPT-4 → GPT-3.5 (免费用户)    │       │            │
  │  │  │ 📝 输出限制: 所有用户 max_tokens 减半        │       │            │
  │  │  │ 💾 缓存增强: 相似问题命中缓存直接返回        │       │            │
  │  │  └───────────────────────────────────────────┘       │            │
  │  │                                                      │            │
  │  │  Level 3 (严重)                                      │            │
  │  │  ┌───────────────────────────────────────────┐       │            │
  │  │  │ 🚫 全用户排队: 显示"当前等待 N 人"          │       │            │
  │  │  │ ⚡ 全部使用轻量模型 (7B/14B)                │       │            │
  │  │  │ 🔇 关闭流式: 批量处理提高吞吐量              │       │            │
  │  │  │ 📉 max_tokens = 256 (所有用户)              │       │            │
  │  │  └───────────────────────────────────────────┘       │            │
  │  └──────────────────────────────────────────────────────┘            │
  └──────────────────────────────────────────────────────────────────────┘
```

#### 代码示例

```python
import time
import asyncio
from enum import IntEnum
from dataclasses import dataclass

class DegradationLevel(IntEnum):
    NORMAL = 0
    WARNING = 1
    DEGRADED = 2
    SEVERE = 3
    CIRCUIT_BREAK = 4

@dataclass
class SystemMetrics:
    gpu_utilization: float      # 0-100
    request_qps: float
    queue_depth: int
    p99_latency_ms: float
    error_rate: float           # 0-1

@dataclass
class DegradationPolicy:
    level: DegradationLevel
    allowed_models: list
    max_tokens: int
    free_user_rate_limit: float  # req/s
    enable_streaming: bool
    enable_plugins: bool
    enable_file_upload: bool
    queue_enabled: bool

# 各级降级策略配置
POLICIES = {
    DegradationLevel.NORMAL: DegradationPolicy(
        level=DegradationLevel.NORMAL,
        allowed_models=["gpt-4-turbo", "gpt-3.5-turbo"],
        max_tokens=4096,
        free_user_rate_limit=1.0,
        enable_streaming=True,
        enable_plugins=True,
        enable_file_upload=True,
        queue_enabled=False,
    ),
    DegradationLevel.WARNING: DegradationPolicy(
        level=DegradationLevel.WARNING,
        allowed_models=["gpt-4-turbo", "gpt-3.5-turbo"],
        max_tokens=4096,
        free_user_rate_limit=0.5,
        enable_streaming=True,
        enable_plugins=False,      # 关闭插件
        enable_file_upload=False,  # 关闭文件上传
        queue_enabled=False,
    ),
    DegradationLevel.DEGRADED: DegradationPolicy(
        level=DegradationLevel.DEGRADED,
        allowed_models=["gpt-3.5-turbo"],  # 免费用户不可用 GPT-4
        max_tokens=2048,
        free_user_rate_limit=0.033,  # 1 req / 30s
        enable_streaming=True,
        enable_plugins=False,
        enable_file_upload=False,
        queue_enabled=False,
    ),
    DegradationLevel.SEVERE: DegradationPolicy(
        level=DegradationLevel.SEVERE,
        allowed_models=["llama-3-8b"],  # 全部切换轻量模型
        max_tokens=256,
        free_user_rate_limit=0.02,
        enable_streaming=False,  # 关闭流式提高吞吐
        enable_plugins=False,
        enable_file_upload=False,
        queue_enabled=True,
    ),
}

class DegradationController:
    """自适应降级控制器"""

    def __init__(self):
        self.current_level = DegradationLevel.NORMAL
        self._cooldown_until = 0  # 防抖：避免级别频繁切换

    def evaluate(self, metrics: SystemMetrics) -> DegradationPolicy:
        now = time.time()

        # 确定目标级别
        target = self._compute_target_level(metrics)

        # 防抖逻辑：升级立即执行，降级需要冷却 60s
        if target > self.current_level:
            self.current_level = target
            self._cooldown_until = now + 60
        elif target < self.current_level and now > self._cooldown_until:
            self.current_level = DegradationLevel(self.current_level - 1)
            self._cooldown_until = now + 60

        return POLICIES.get(self.current_level, POLICIES[DegradationLevel.CIRCUIT_BREAK])

    def _compute_target_level(self, m: SystemMetrics) -> DegradationLevel:
        if m.error_rate > 0.10 or m.gpu_utilization > 98:
            return DegradationLevel.CIRCUIT_BREAK
        if m.gpu_utilization > 93 or m.queue_depth > 2000:
            return DegradationLevel.SEVERE
        if m.gpu_utilization > 85 or m.p99_latency_ms > 5000:
            return DegradationLevel.DEGRADED
        if m.gpu_utilization > 75 or m.request_qps > 3000:
            return DegradationLevel.WARNING
        return DegradationLevel.NORMAL
```

#### 关键对比

| 降级级别 | 吞吐量提升 | 用户体验影响 | 成本变化 | 典型持续时间 |
|---------|-----------|------------|---------|------------|
| L0 正常 | 基准 | 无 | 基准 | - |
| L1 预警 | +10% | 轻微（无插件/文件） | -5% | 5-15 min |
| L2 降级 | +40% | 中等（免费用户受限） | -25% | 10-30 min |
| L3 严重 | +150% | 显著（全用户体验下降） | -60% | 5-20 min |
| L4 熔断 | ∞（拒绝服务） | 不可用 | -95% | 1-10 min |

#### 实际案例

以某 AI 产品在热点事件期间的降级实践：
- **事件**：某 AI 生图功能在社交媒体爆火，30 分钟内 QPS 从 800 飙升至 6500
- **L1 触发**（+5min）：关闭图片生成功能（释放 30% GPU），预热 8 台备用 A100
- **L2 触发**（+12min）：免费用户限流至 1 req/min，max_tokens 从 4096 降至 1024
- **L3 触发**（+18min）：全用户切换到 7B 模型，排队系统启动
- **备用节点就绪**（+25min）：新节点上线，模型加载完成
- **逐步恢复**（+30~60min）：每 5 分钟降一级，观察指标稳定后继续
- **全量恢复**（+65min）：恢复到 L0，总故障影响时间 65 分钟
- **事后复盘**：无数据丢失，付费用户全程可用（虽有延迟增加），免费用户最大等待时间 3 分钟

#### 分阶段建设计划

| 阶段 | 时间 | 建设内容 | 成熟度 |
|------|------|---------|-------|
| 基础版 | 第 1-2 月 | 手动降级开关 + 基础限流 | 需人工介入 |
| 自动版 | 第 3-5 月 | 指标驱动自动降级 + 分级策略 | 5min 内自动响应 |
| 智能版 | 第 6-9 月 | 流量预测 + 预防性扩缩容 | 提前 30min 预警 |
| 全面版 | 第 10-12 月 | 混沌工程演练 + 全链路压测 | 季度演练验证 |

#### 降级策略

| 场景 | 预案 | SLA 保证 |
|------|------|---------|
| GPU 供应商故障 | 多云 GPU 池（AWS + GCP + 自建） | 切换时间 < 5min |
| 单机房网络故障 | DNS 切流到备用机房 | 切换时间 < 2min |
| 模型服务 OOM | 自动重启 + 请求重试 | 影响时间 < 30s |
| 依赖服务（Redis）故障 | 降级到无缓存模式 | 延迟增加但可用 |

#### 面试追问

1. **降级过程中如何保证付费用户的体验？是否可以做到付费用户完全无感？** 提示：资源预留池、优先级队列、独立集群隔离。
2. **如何通过流量预测提前触发扩容，而不是被动降级？** 提示：基于社交媒体热度的预测模型、历史模式匹配、与市场团队的联动机制。
3. **如何设计混沌工程演练来验证降级策略的有效性？** 提示：故障注入框架、生产环境灰度演练、Gameday 机制。

</details>
