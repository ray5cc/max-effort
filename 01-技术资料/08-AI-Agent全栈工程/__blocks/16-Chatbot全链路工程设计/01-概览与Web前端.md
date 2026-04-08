# Chatbot 全链路工程设计

> 从用户在浏览器输入框敲下第一个字开始，追踪消息穿越 CDN、网关、会话服务、推理引擎的完整旅程，构建支撑 10 万到 1000 万 DAU 的 Chatbot 产品架构

## TL;DR

- Web Chatbot 的前端核心挑战是流式 Markdown 渲染——需要增量解析、实时代码高亮、逐字打字效果
- SSE（Server-Sent Events）是 LLM 流式响应的最佳选择——单向、轻量、HTTP 原生、自动重连
- 会话管理是 Chatbot 的"心脏"——消息存储、上下文组装、分支管理（regenerate/edit）、共享功能
- CDN 只能加速静态资源，API 请求必须直连后端——长连接场景下需要特殊的负载均衡策略
- RAG（检索增强生成）让 Chatbot 从"凭记忆回答"升级为"查资料回答"——搜索→切片→嵌入→重排→生成
- 推理层的核心优化三件套：Continuous Batching + PagedAttention + Speculative Decoding
- 内容安全审查必须同时覆盖输入和输出——输入过滤恶意 prompt，输出过滤有害内容
- 从 10 万到 1000 万 DAU：核心瓶颈从 GPU 算力转移到数据库 I/O 和全球网络延迟

## 相关链接

- 对应面试题：[Chatbot全链路工程设计面试题](../../02-面试指南/08-AI-Agent全栈工程面试/16-Chatbot全链路工程设计面试题.md)

## 目录

1. [全链路概览](#1-全链路概览)
2. [Web 前端架构](#2-web-前端架构)
3. [网络传输层](#3-网络传输层)
4. [API 网关与负载均衡](#4-api-网关与负载均衡)
5. [会话管理服务](#5-会话管理服务)
6. [RAG 检索增强](#6-rag-检索增强)
7. [推理服务层](#7-推理服务层)
8. [实时功能与用户体验](#8-实时功能与用户体验)
9. [10 万 → 1000 万 DAU 扩展](#9-10-万--1000-万-dau-扩展)
10. [常见陷阱与最佳实践](#10-常见陷阱与最佳实践)

---

## 1. 全链路概览

### 1.1 端到端链路全景图

想象你在一个外卖 App 上点餐：打开 App 浏览菜单（前端 UI），选好菜品提交订单（API 请求），平台验证你的身份和优惠券（网关认证），订单被派到后厨（推理集群），厨师开始做菜（模型推理），做好一道上一道（流式输出），骑手将每道菜逐个递到你手上（SSE 流式传输），你一边接菜一边开吃（前端增量渲染）。

这个类比几乎完美地映射了 Chatbot 的全链路：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Chatbot 全链路架构                                    │
│                                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │  Browser  │────▶│   CDN    │────▶│ Static Files │     │              │   │
│  │(React SPA)│     │(Cloudflare)    │  JS/CSS/IMG  │     │              │   │
│  │          │     └──────────┘     └──────────────┘     │              │   │
│  │          │                                            │              │   │
│  │          │     ┌──────────┐     ┌──────────────┐     │   Inference  │   │
│  │          │────▶│   Load   │────▶│  API Gateway │     │   Cluster    │   │
│  │          │     │ Balancer │     │              │     │              │   │
│  │          │     │ (L7/ALB) │     │ ┌──────────┐│     │ ┌──────────┐ │   │
│  │          │     └──────────┘     │ │   Auth   ││     │ │  Model   │ │   │
│  │          │                      │ └────┬─────┘│     │ │  Router  │ │   │
│  │          │                      │ ┌────▼─────┐│     │ └────┬─────┘ │   │
│  │          │                      │ │Rate Limit││     │ ┌────▼─────┐ │   │
│  │          │                      │ └────┬─────┘│     │ │  vLLM /  │ │   │
│  │          │                      └──────┼──────┘     │ │  TGI     │ │   │
│  │          │                             │             │ └────┬─────┘ │   │
│  │          │                      ┌──────▼──────┐     │ ┌────▼─────┐ │   │
│  │          │                      │ Conversation │     │ │  GPU     │ │   │
│  │          │                      │   Service    │────▶│ │ A100/H100│ │   │
│  │          │                      │              │     │ └──────────┘ │   │
│  │          │                      │ ┌──────────┐ │     │              │   │
│  │          │                      │ │ Context  │ │     │              │   │
│  │          │                      │ │ Assembly │ │     │              │   │
│  │          │◀─ ─ ─SSE Stream─ ─ ─│ └──────────┘ │◀────│              │   │
│  └──────────┘                      └──────────────┘     └──────────────┘   │
│                                                                             │
│  ─────▶ 请求方向          ◀─ ─ ─ 流式响应方向                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 请求生命周期

一条用户消息从发送到最终显示的完整旅程：

```
时间轴 ──────────────────────────────────────────────────────────▶

[0ms]          用户点击发送按钮
               │
[1-5ms]        前端乐观更新 UI，显示用户消息气泡
               │
[5-30ms]       请求经过 CDN 边缘节点路由到最近的负载均衡器
               │
[30-50ms]      API Gateway：JWT 验证 + 速率限制检查
               │
[50-80ms]      会话服务：加载历史消息，组装上下文窗口
               │
[80-120ms]     （可选）RAG：向量检索相关文档片段
               │
[120-150ms]    模型路由：根据模型选择分发到对应 GPU 集群
               │
[150-300ms]    推理引擎：预填充阶段（Prefill）—— 处理全部输入 token
               │
[300ms-30s]    推理引擎：解码阶段（Decode）—— 逐 token 生成
               │  ↓ 每生成一个 token 就通过 SSE 推送
               │
[持续]          前端增量接收 token，实时渲染 Markdown
               │
[完成]          前端显示完整回答，启用复制/重新生成/评价按钮
```

### 1.3 各层核心职责速览

| 层级 | 核心职责 | 关键技术 | 延迟贡献 |
|------|---------|---------|---------|
| **前端层** | 流式渲染、用户交互、离线缓存 | React + SSE + IndexedDB | 1-5ms |
| **CDN 层** | 静态资源加速、边缘计算 | Cloudflare/Fastly + Workers | 5-30ms |
| **负载均衡** | 请求分发、健康检查、长连接保持 | ALB/Nginx + L7 路由 | 1-3ms |
| **API 网关** | 认证、限流、请求转换 | Kong/Envoy + JWT + Redis | 10-20ms |
| **会话服务** | 消息存储、上下文组装、分支管理 | PostgreSQL + Redis + S3 | 20-50ms |
| **RAG 引擎** | 文档检索、上下文增强 | Embedding + Milvus + Reranker | 30-100ms |
| **推理服务** | 模型推理、Token 生成 | vLLM + CUDA + PagedAttention | 150ms-30s |

### 1.4 外卖类比深度版

为什么用外卖类比？因为两者在架构上有惊人的相似性：

| 外卖系统 | Chatbot 系统 | 关键相似点 |
|---------|-------------|-----------|
| App 首页 | Chat UI | 都需要即时响应用户操作 |
| 商家列表 CDN 缓存 | 静态资源 CDN | 不常变化的内容在边缘加速 |
| 下单接口 | Chat API | 核心业务请求，不可缓存 |
| 身份验证 + 优惠券校验 | JWT + 配额检查 | 每次请求都要鉴权 + 配额 |
| 订单派发到后厨 | 请求路由到 GPU | 根据负载选择最优执行节点 |
| 厨师做菜（耗时最长） | GPU 推理（耗时最长） | 瓶颈都在"生产"环节 |
| 做好一道上一道 | Token 逐个流式输出 | 都是增量交付，而非全量等待 |
| 骑手实时位置 | SSE 流式推送 | 都需要持续的状态推送 |

---

## 2. Web 前端架构

### 2.1 组件架构设计

#### 组件树全景

一个生产级 Chatbot 前端的组件树大致如下。把它想象成一棵树：根是整个应用壳，主干分出侧边栏和聊天区域，聊天区域又长出消息列表、输入框等叶子节点：

```
App
├── AuthProvider                    // 全局认证上下文
├── ThemeProvider                   // 深色/浅色主题
└── ChatLayout                      // 主布局（左右分栏）
    ├── Sidebar                     // 左侧边栏
    │   ├── NewChatButton           // 新建对话
    │   ├── SearchBar               // 搜索历史对话
    │   └── ConversationList        // 对话列表
    │       └── ConversationItem    // 单个对话（标题、时间、删除）
    └── ChatWindow                  // 右侧聊天区域
        ├── ChatHeader              // 模型选择器 + 对话设置
        │   ├── ModelSelector       // 模型下拉选择
        │   └── ChatSettings        // 温度、System Prompt 等
        ├── MessageList             // 消息列表（虚拟滚动）
        │   └── Message             // 单条消息
        │       ├── Avatar          // 用户/AI 头像
        │       ├── MessageContent  // 消息正文（Markdown 渲染）
        │       │   ├── CodeBlock   // 代码块（高亮 + 复制）
        │       │   ├── MathBlock   // 数学公式（KaTeX）
        │       │   └── ImageBlock  // 图片（点击放大）
        │       └── MessageActions  // 复制/重新生成/编辑/评价
        ├── StreamingIndicator      // AI 正在输入... 动画
        └── InputBar                // 输入区域
            ├── TextArea            // 自动扩展文本框
            ├── FileUpload          // 文件/图片上传
            ├── VoiceInput          // 语音输入
            └── SendButton          // 发送按钮（带加载状态）
```

#### 状态管理设计

Chatbot 前端的状态比典型 CRUD 应用复杂得多——既有持久化数据（对话历史），又有瞬时状态（流式 Token），还有 UI 状态（侧边栏开关）。推荐按"生命周期"分层管理：

```typescript
// 状态分层：三层架构
// 1. 服务端状态（持久化）—— React Query / SWR
//    对话列表、历史消息、用户设置
// 2. 客户端状态（会话级）—— Zustand / Redux
//    当前对话 ID、流式内容、UI 偏好
// 3. 局部状态（组件级）—— useState / useReducer
//    输入框内容、下拉展开、工具提示
```

#### 核心代码：ChatWindow 组件

```typescript
import React, { useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSSE } from '@/hooks/useSSE';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { StreamingIndicator } from './StreamingIndicator';

interface ChatWindowProps {
  conversationId: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ conversationId }) => {
  const {
    messages,
    streamingContent,
    isStreaming,
    addMessage,
    updateStreamingContent,
    finalizeStreaming,
  } = useChatStore();

  const { connect, disconnect } = useSSE();
  const messageListRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 自动滚动到底部：只在用户已经在底部时触发
  const scrollToBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // 发送消息的核心逻辑
  const handleSend = useCallback(async (content: string, attachments?: File[]) => {
    // 1. 乐观更新：立即显示用户消息
    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content,
      attachments: attachments?.map(f => ({
        name: f.name,
        type: f.type,
        url: URL.createObjectURL(f),
      })),
      createdAt: new Date().toISOString(),
    };
    addMessage(userMessage);

    // 2. 创建 AbortController 用于取消请求
    abortControllerRef.current = new AbortController();

    // 3. 建立 SSE 连接，接收流式响应
    try {
      await connect({
        url: `/api/chat/${conversationId}/messages`,
        method: 'POST',
        body: { content, attachments },
        signal: abortControllerRef.current.signal,
        onToken: (token: string) => {
          updateStreamingContent(prev => prev + token);
          scrollToBottom();
        },
        onComplete: (metadata) => {
          finalizeStreaming(metadata);
        },
        onError: (error) => {
          console.error('Streaming error:', error);
          finalizeStreaming({ error: error.message });
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        finalizeStreaming({ aborted: true });
      }
    }
  }, [conversationId, connect, addMessage, updateStreamingContent,
      finalizeStreaming, scrollToBottom]);

  // 停止生成
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // 清理：组件卸载或切换对话时断开连接
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      disconnect();
    };
  }, [conversationId, disconnect]);

  return (
    <div className="flex flex-col h-full">
      <div ref={messageListRef} className="flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
        />
        {isStreaming && <StreamingIndicator />}
      </div>
      <InputBar
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
      />
    </div>
  );
};
```

### 2.2 流式 Markdown 渲染

#### 核心挑战

流式 Markdown 渲染是 Chatbot 前端的头号技术难题。想象你在读一封信，但这封信是一个字一个字地写出来的——你需要在每个字到达时理解句子，同时信还没写完，你不知道当前这段话是普通文本还是代码块的一部分。

具体来说，有这些棘手场景：

```
场景 1：不完整的代码块
收到的文本："这是一段 Python 代码：\n```py\ndef hello("
问题：代码块还没关闭（缺少 ```），如何渲染？

场景 2：不完整的链接
收到的文本："请参考 [这篇文章](https://exam"
问题：链接还没关闭，显示原始文本还是等待？

场景 3：不完整的表格
收到的文本："| 名称 | 类型 |\n| --- |"
问题：表格还没完成，如何渲染已有行？

场景 4：数学公式中的特殊字符
收到的文本："根据公式 $E = mc^"
问题：公式还没关闭，$ 是分隔符还是普通字符？
```

#### 增量解析策略

核心思路：维护一个"已确认完成"的部分和一个"待定缓冲区"。每当新 token 到达时，尝试将缓冲区中尽可能多的内容移入"已确认"部分：

```
已确认完成                       待定缓冲区
┌──────────────────────────┐   ┌──────────────┐
│ # 标题                    │   │ ```py        │
│                          │   │ def hello(   │
│ 这是一段说明文字。          │   │              │
│                          │   │              │
│ （安全渲染为 HTML）         │   │ （显示为等宽文本）│
└──────────────────────────┘   └──────────────┘

当收到结束标记 ``` 时：
┌──────────────────────────────────────────────┐
│ # 标题                                        │
│                                              │
│ 这是一段说明文字。                               │
│                                              │
│ ┌──────────────────────────┐                 │
│ │ def hello():        [py] │                 │
│ │     print("Hi!")         │                 │
│ └──────────────────────────┘                 │
└──────────────────────────────────────────────┘
```

#### 核心代码：StreamingMarkdownRenderer

```typescript
import React, { useMemo, useRef } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';

interface StreamingMarkdownProps {
  content: string;       // 当前已接收的全部文本
  isStreaming: boolean;   // 是否正在接收中
}

// 检测未闭合的 Markdown 结构
function detectPendingStructures(text: string) {
  const lines = text.split('\n');
  const state = {
    inCodeBlock: false,
    codeBlockLang: '',
    inMathBlock: false,
  };

  for (const line of lines) {
    // 检查代码块围栏（```）
    const codeMatch = line.match(/^(`{3,})([\w-]*)/);
    if (codeMatch) {
      if (!state.inCodeBlock) {
        state.inCodeBlock = true;
        state.codeBlockLang = codeMatch[2] || '';
      } else {
        state.inCodeBlock = false;
        state.codeBlockLang = '';
      }
      continue;
    }
    // 检查数学块（$$）
    if (line.trim() === '$$') {
      state.inMathBlock = !state.inMathBlock;
    }
  }

  return state;
}

// 补全未闭合的结构，使 Markdown 可安全解析
function completePartialMarkdown(text: string): string {
  const state = detectPendingStructures(text);
  let completed = text;

  if (state.inCodeBlock) {
    // 未关闭的代码块——追加结束标记以便安全解析
    completed += '\n```';
  }
  if (state.inMathBlock) {
    completed += '\n$$';
  }

  // 修复行内元素：未闭合的粗体、斜体、行内代码
  const openBackticks = (completed.match(/(?<!`)`(?!`)/g) || []).length;
  if (openBackticks % 2 !== 0) {
    completed += '`';
  }

  return completed;
}

export const StreamingMarkdownRenderer: React.FC<StreamingMarkdownProps> = ({
  content,
  isStreaming,
}) => {
  const processorRef = useRef(
    unified()
      .use(remarkParse)
      .use(remarkGfm)         // 表格、任务列表、删除线
      .use(remarkMath)        // 数学公式
      .use(remarkRehype)
      .use(rehypeKatex)       // 公式渲染
      .use(rehypeHighlight)   // 代码高亮
      .use(rehypeReact, {
        createElement: React.createElement,
        components: {
          pre: CodeBlockWrapper,  // 自定义代码块（带复制按钮）
          code: InlineCode,
          a: SafeLink,            // 安全链接（新标签页打开）
        },
      })
  );

  const renderedContent = useMemo(() => {
    if (!content) return null;

    // 流式期间：补全不完整结构后再解析
    const safeContent = isStreaming
      ? completePartialMarkdown(content)
      : content;

    try {
      return processorRef.current.processSync(safeContent).result;
    } catch {
      // 解析失败时的降级方案：显示纯文本
      return <pre className="whitespace-pre-wrap">{content}</pre>;
    }
  }, [content, isStreaming]);

  return (
    <div className="markdown-body prose dark:prose-invert max-w-none">
      {renderedContent}
      {isStreaming && <span className="animate-pulse">▍</span>}
    </div>
  );
};

// 自定义代码块包装器（带复制按钮和语言标签）
const CodeBlockWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const codeRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    const code = codeRef.current?.textContent || '';
    await navigator.clipboard.writeText(code);
  };

  return (
    <div className="relative group">
      <pre ref={codeRef} className="rounded-lg overflow-x-auto">
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100
                   transition-opacity px-2 py-1 text-xs bg-gray-700 rounded"
      >
        复制
      </button>
    </div>
  );
};
```

#### 性能关键：避免全量重渲染

每次收到新 token 都重新解析整个 Markdown 文本是巨大的性能浪费。两种优化策略：

```
策略 A：分块解析（推荐）
──────────────────────────────────
将文本按段落分块，只重新解析最后一个"活跃块"。

块 1: "# 标题\n\n正文第一段..."          ← 已解析，缓存 React 节点
块 2: "```python\ndef foo():\n..."     ← 已解析，缓存 React 节点
块 3: "接下来我们看看如何|"              ← 活跃块，每个 token 重新解析

策略 B：双缓冲
──────────────────────────────────
维护两个渲染层，交替切换，避免闪烁：

渲染层 A: 当前显示的内容
渲染层 B: 后台正在解析新 token 的结果
当 B 准备好 → 一次性替换 A → B 成为新的活跃层
```

### 2.3 代码高亮

#### Shiki vs Prism.js 对比

对于 Chatbot 中的代码高亮，Shiki 和 Prism.js 各有优劣：

| 维度 | Shiki | Prism.js |
|------|-------|----------|
| **高亮质量** | ⭐⭐⭐ VS Code 同款 TextMate 语法 | ⭐⭐ 基于正则，部分语法不精确 |
| **支持语言** | 200+ 语言（VS Code 全量） | 300+ 语言（社区插件丰富） |
| **主题** | VS Code 主题直接复用 | 自有主题系统 |
| **包体积** | 较大（~300KB core + 语言包） | 较小（~20KB core） |
| **流式友好** | ⭐⭐ 需要完整代码才能精确高亮 | ⭐⭐⭐ 逐行高亮更容易 |
| **首次加载** | 较慢（WASM 初始化） | 快 |
| **推荐场景** | 注重高亮质量，可接受初始加载 | 注重性能，流式优先 |

**实际选择建议**：流式场景下用 Prism.js 做即时高亮，代码块完成后切换到 Shiki 做精确高亮——"先粗后精"策略。

#### 流式代码高亮实现

```typescript
import Prism from 'prismjs';

interface StreamingCodeBlockProps {
  code: string;          // 当前已接收的代码文本
  language: string;      // 从 ``` 后提取的语言标识
  isComplete: boolean;   // 代码块是否已关闭
}

export const StreamingCodeBlock: React.FC<StreamingCodeBlockProps> = ({
  code,
  language,
  isComplete,
}) => {
  // 动态加载语言包
  useEffect(() => {
    if (language && !Prism.languages[language]) {
      import(`prismjs/components/prism-${language}`)
        .catch(() => console.warn(`Language ${language} not supported`));
    }
  }, [language]);

  const highlightedHtml = useMemo(() => {
    const grammar = Prism.languages[language] || Prism.languages.plaintext;
    return Prism.highlight(code, grammar, language || 'plaintext');
  }, [code, language]);

  const lineCount = code.split('\n').length;

  return (
    <div className="code-block rounded-lg bg-gray-900 overflow-hidden">
      {/* 头部：语言标签 + 复制按钮 */}
      <div className="flex justify-between items-center px-4 py-2 bg-gray-800">
        <span className="text-xs text-gray-400">{language || 'text'}</span>
        <CopyButton text={code} />
      </div>

      {/* 代码区域：行号 + 高亮内容 */}
      <div className="flex overflow-x-auto">
        {/* 行号栏 */}
        <div className="select-none text-right pr-4 pl-4 py-3 text-gray-600 text-sm">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* 代码内容 */}
        <pre className="py-3 pr-4 flex-1 text-sm">
          <code
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
          {!isComplete && <span className="animate-pulse text-green-400">▍</span>}
        </pre>
      </div>
    </div>
  );
};
```

### 2.4 多模态输入

现代 Chatbot 不仅仅接受文字——用户可能粘贴截图、拖拽文件、甚至语音输入。这就像一个智能快递柜，不仅能寄信（文字），还能寄包裹（文件）、拍照寄（图片）、语音下单（语音转文字）。

#### 文件上传与拖拽

```typescript
import { useCallback, useState } from 'react';

interface FileUploadState {
  files: UploadFile[];
  isDragging: boolean;
}

interface UploadFile {
  id: string;
  file: File;
  preview?: string;       // 图片预览 URL
  uploadProgress: number;  // 0-100
  status: 'pending' | 'uploading' | 'done' | 'error';
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;  // 20MB
const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'text/plain', 'text/markdown'],
  code: ['text/javascript', 'text/typescript', 'text/python',
         'application/json', 'text/csv'],
};

const ALL_ALLOWED = Object.values(ALLOWED_TYPES).flat();

export function useFileUpload() {
  const [state, setState] = useState<FileUploadState>({
    files: [],
    isDragging: false,
  });

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `文件 "${file.name}" 超过 20MB 限制`;
    }
    if (!ALL_ALLOWED.includes(file.type)) {
      return `不支持的文件类型：${file.type}`;
    }
    return null;
  };

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const newFiles: UploadFile[] = [];

    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        console.warn(error);
        continue;
      }

      const uploadFile: UploadFile = {
        id: crypto.randomUUID(),
        file,
        uploadProgress: 0,
        status: 'pending',
      };

      // 图片类型生成预览——先压缩再显示
      if (file.type.startsWith('image/')) {
        uploadFile.preview = await compressAndPreview(file);
      }

      newFiles.push(uploadFile);
    }

    setState(prev => ({ ...prev, files: [...prev.files, ...newFiles] }));
  }, []);

  // 拖拽事件处理
  const dragHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setState(prev => ({ ...prev, isDragging: true }));
    },
    onDragLeave: () => {
      setState(prev => ({ ...prev, isDragging: false }));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setState(prev => ({ ...prev, isDragging: false }));
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
  };

  // 粘贴事件处理（从剪贴板粘贴图片）
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      const files = imageItems
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null);
      addFiles(files);
    }
  }, [addFiles]);

  return { ...state, addFiles, dragHandlers, handlePaste };
}

// 图片压缩：将大图压缩到合理尺寸后再上传
async function compressAndPreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();

    img.onload = () => {
      const maxDim = 1920;
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };

    img.src = URL.createObjectURL(file);
  });
}
```

#### 语音输入

```typescript
export function useVoiceInput() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('当前浏览器不支持语音输入');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;      // 持续识别
    recognition.interimResults = true;  // 显示中间结果
    recognition.lang = 'zh-CN';         // 中文识别

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      setTranscript(prev => prev + final);
      // interim 显示为灰色预览文本
    };

    recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      setIsListening(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, transcript, startListening, stopListening, setTranscript };
}
```

### 2.5 性能优化

#### 虚拟滚动

当一个对话包含数百甚至数千条消息时，一次性渲染所有消息 DOM 节点会导致严重卡顿。虚拟滚动的原理就像电影胶片——虽然整部电影有几十万帧，但银幕上同一时刻只显示一帧。浏览器视口就是那块银幕，我们只需要渲染视口内可见的消息：

```
 ┌──────────────────┐
 │   不可见区域      │  ← 只保留高度占位，不渲染 DOM
 │   (200条消息)     │     总高度 = Σ(每条估算高度)
 │                  │
 ├──────────────────┤ ─ 视口上边界
 │   ✦ 消息 201     │
 │   ✦ 消息 202     │  ← 实际渲染的 DOM 节点
 │   ✦ 消息 203     │     通常 10-20 条 + 上下各 5 条缓冲
 │   ✦ 消息 204     │
 │   ✦ 消息 205     │
 ├──────────────────┤ ─ 视口下边界
 │   不可见区域      │  ← 只保留高度占位
 │   (795条消息)     │
 └──────────────────┘
```

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export const VirtualizedMessageList: React.FC<{
  messages: Message[];
  streamingContent: string;
}> = ({ messages, streamingContent }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // 根据消息内容估算高度：
      // 短文本消息 ~80px，长文本 ~200px，带代码块 ~400px
      const msg = messages[index];
      const contentLength = msg.content.length;
      if (contentLength < 100) return 80;
      if (contentLength < 500) return 200;
      return 400;
    },
    overscan: 5, // 视口外额外渲染 5 条作为缓冲
  });

  // 自动滚动到最新消息
  useEffect(() => {
    if (streamingContent) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [streamingContent, messages.length, virtualizer]);

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualItem.start}px)`,
              width: '100%',
            }}
          >
            <MessageComponent message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
```

#### Web Worker 加速重计算

Markdown 解析和代码高亮都是 CPU 密集型任务，放在主线程会阻塞 UI 渲染。将它们移到 Web Worker 中，就像把厨房（计算）和餐厅（UI）分开——厨房再忙也不影响客人用餐体验：

```typescript
// markdown.worker.ts —— 独立的 Worker 线程
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkHtml from 'remark-html';

const processor = unified().use(remarkParse).use(remarkHtml);

self.onmessage = async (e: MessageEvent<{ id: string; markdown: string }>) => {
  const { id, markdown } = e.data;
  try {
    const result = await processor.process(markdown);
    self.postMessage({ id, html: String(result), error: null });
  } catch (error) {
    self.postMessage({ id, html: null, error: String(error) });
  }
};

// 主线程使用 Worker
class MarkdownWorkerPool {
  private workers: Worker[];
  private queue: Array<{
    markdown: string;
    resolve: (html: string) => void;
    reject: (err: Error) => void;
  }> = [];
  private nextWorker = 0;

  constructor(poolSize = navigator.hardwareConcurrency || 4) {
    this.workers = Array.from({ length: poolSize }, () => {
      const worker = new Worker(
        new URL('./markdown.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e) => {
        const { id, html, error } = e.data;
        // 通过 id 匹配并 resolve/reject 对应的 Promise
        this.resolveTask(id, html, error);
      };
      return worker;
    });
  }

  async parse(markdown: string): Promise<string> {
    const id = crypto.randomUUID();
    const workerIndex = this.nextWorker++ % this.workers.length;
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, { resolve, reject });
      this.workers[workerIndex].postMessage({ id, markdown });
    });
  }

  private pendingTasks = new Map<string, {
    resolve: (html: string) => void;
    reject: (err: Error) => void;
  }>();

  private resolveTask(id: string, html: string | null, error: string | null) {
    const task = this.pendingTasks.get(id);
    if (!task) return;
    this.pendingTasks.delete(id);
    if (error) task.reject(new Error(error));
    else task.resolve(html!);
  }
}
```

#### IndexedDB 离线缓存

将对话消息缓存在 IndexedDB 中，实现"打开即可看"的体验，无需等待网络请求：

```typescript
import { openDB, IDBPDatabase } from 'idb';

interface ChatDB {
  conversations: {
    key: string;
    value: {
      id: string;
      title: string;
      updatedAt: string;
      model: string;
    };
    indexes: { 'by-date': string };
  };
  messages: {
    key: string;
    value: {
      id: string;
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
    };
    indexes: { 'by-conversation': string };
  };
}

let dbInstance: IDBPDatabase<ChatDB> | null = null;

async function getDB(): Promise<IDBPDatabase<ChatDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<ChatDB>('chatbot-cache', 1, {
    upgrade(db) {
      const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
      convStore.createIndex('by-date', 'updatedAt');

      const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
      msgStore.createIndex('by-conversation', 'conversationId');
    },
  });

  return dbInstance;
}

// 读取时优先走缓存，后台静默刷新
export async function getMessagesWithCache(conversationId: string) {
  const db = await getDB();

  // 1. 立即返回缓存
  const cached = await db.getAllFromIndex(
    'messages', 'by-conversation', conversationId
  );

  // 2. 后台刷新（stale-while-revalidate 模式）
  fetchMessagesFromServer(conversationId).then(async (serverMessages) => {
    const tx = db.transaction('messages', 'readwrite');
    for (const msg of serverMessages) {
      await tx.store.put(msg);
    }
    await tx.done;
  });

  return cached;
}
```

---

