## 5. 会话管理服务

> 会话管理是 Chatbot 的「记忆中枢」——它不仅要记住用户说了什么、AI 回了什么，还要支持消息编辑、重新生成、对话分享等复杂交互。

### 5.1 数据模型设计

**生活类比**：Chatbot 的数据模型就像一个聊天应用的数据库——但多了 AI 特有的字段，比如使用了哪个模型、消耗了多少 Token、花了多少钱。

**实体关系**：

```
┌──────────┐     1:N     ┌───────────────┐     1:N     ┌──────────────┐
│   User   │────────────►│ Conversation  │────────────►│   Message    │
│          │             │               │             │              │
│ id       │             │ id            │             │ id           │
│ email    │             │ user_id       │             │ conv_id      │
│ tier     │             │ title         │             │ parent_id    │
│ created  │             │ model         │             │ role         │
└──────────┘             │ system_prompt │             │ content      │
                         │ created_at    │             │ model        │
                         │ updated_at    │             │ tokens_in    │
                         │ is_archived   │             │ tokens_out   │
                         └───────────────┘             │ cost         │
                                                       │ metadata     │
                                                       │ created_at   │
                              1:N                      └──────┬───────┘
                         ┌──────────────┐                     │ 1:N
                         │  Attachment  │◄────────────────────┘
                         │              │
                         │ id           │
                         │ message_id   │
                         │ type         │
                         │ url          │
                         │ size_bytes   │
                         └──────────────┘
```

**Message 表的核心字段**：

```sql
CREATE TABLE messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    parent_id     UUID REFERENCES messages(id),  -- 支持消息树（分支）
    
    -- 消息内容
    role          VARCHAR(20) NOT NULL,  -- system / user / assistant / tool
    content       TEXT NOT NULL,
    
    -- AI 特有字段（人类消息时为 NULL）
    model         VARCHAR(50),           -- gpt-4o / claude-3.5-sonnet
    tokens_input  INT,                   -- 输入 Token 数
    tokens_output INT,                   -- 输出 Token 数
    cost_usd      DECIMAL(10, 6),        -- 本次调用成本
    finish_reason VARCHAR(20),           -- stop / length / tool_calls
    
    -- 元数据
    metadata      JSONB DEFAULT '{}',    -- 灵活扩展字段
    is_active     BOOLEAN DEFAULT TRUE,  -- 当前活跃分支的消息
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    
    -- 索引
    CONSTRAINT valid_role CHECK (role IN ('system','user','assistant','tool'))
);

-- 按对话 + 时间排序的复合索引（最常用的查询）
CREATE INDEX idx_messages_conv_time 
    ON messages(conversation_id, created_at);

-- 父消息索引（消息树查询）
CREATE INDEX idx_messages_parent 
    ON messages(parent_id) WHERE parent_id IS NOT NULL;
```

### 5.2 数据库选型

不同类型的数据应该存储在最合适的数据库中：

```
┌───────────────────────────────────────────────────────────┐
│                    数据库选型矩阵                          │
├──────────────────┬────────────────┬───────────────────────┤
│   数据类型        │    存储选择     │      原因              │
├──────────────────┼────────────────┼───────────────────────┤
│ 对话 & 消息       │ PostgreSQL     │ ACID 事务、JSON 支持    │
│ 用户信息 & 配额   │ PostgreSQL     │ 强一致性、关联查询      │
│ 活跃会话状态      │ Redis          │ 低延迟、自动过期        │
│ 流式缓冲区       │ Redis Streams  │ 有序消息、消费者组      │
│ 速率限制计数器    │ Redis          │ 原子操作、TTL 自动重置  │
│ 文件附件         │ S3 / GCS       │ 大文件、CDN 分发       │
│ 生成的图片       │ S3 / GCS       │ 大文件、按需访问        │
│ 向量嵌入         │ pgvector       │ 与 PG 集成、SQL 查询   │
│ 操作日志         │ ClickHouse     │ 列式存储、高效聚合      │
└──────────────────┴────────────────┴───────────────────────┘
```

```python
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

import asyncpg


class ConversationRepository:
    """对话数据仓库
    
    封装所有与对话和消息相关的数据库操作。
    使用 asyncpg 实现异步数据库访问。
    """

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def create_conversation(
        self,
        user_id: UUID,
        title: str = "新对话",
        model: str = "gpt-4o",
        system_prompt: Optional[str] = None,
    ) -> dict:
        """创建新对话"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO conversations (id, user_id, title, model, system_prompt)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, user_id, title, model, created_at
            """,
            uuid4(), user_id, title, model, system_prompt,
        )
        return dict(row)

    async def add_message(
        self,
        conversation_id: UUID,
        role: str,
        content: str,
        parent_id: Optional[UUID] = None,
        model: Optional[str] = None,
        tokens_input: Optional[int] = None,
        tokens_output: Optional[int] = None,
        cost_usd: Optional[float] = None,
    ) -> dict:
        """添加消息到对话中"""
        row = await self._pool.fetchrow(
            """
            INSERT INTO messages 
                (id, conversation_id, parent_id, role, content,
                 model, tokens_input, tokens_output, cost_usd)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, role, content, created_at
            """,
            uuid4(), conversation_id, parent_id, role, content,
            model, tokens_input, tokens_output, cost_usd,
        )
        return dict(row)

    async def get_conversation_messages(
        self,
        conversation_id: UUID,
        limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[dict]:
        """获取对话中的消息列表（仅活跃分支）
        
        按时间倒序获取，用于上下文组装和前端展示。
        """
        query = """
            SELECT id, role, content, model, tokens_input, tokens_output,
                   cost_usd, parent_id, metadata, created_at
            FROM messages
            WHERE conversation_id = $1
              AND is_active = TRUE
        """
        params: list = [conversation_id]

        if before:
            query += " AND created_at < $2"
            params.append(before)

        query += " ORDER BY created_at DESC LIMIT $" + str(len(params) + 1)
        params.append(limit)

        rows = await self._pool.fetch(query, *params)
        return [dict(r) for r in reversed(rows)]  # 返回时按时间正序

    async def get_conversation_token_usage(
        self, conversation_id: UUID
    ) -> dict:
        """统计对话的 Token 使用量和成本"""
        row = await self._pool.fetchrow(
            """
            SELECT 
                COUNT(*) as message_count,
                COALESCE(SUM(tokens_input), 0) as total_input_tokens,
                COALESCE(SUM(tokens_output), 0) as total_output_tokens,
                COALESCE(SUM(cost_usd), 0) as total_cost_usd
            FROM messages
            WHERE conversation_id = $1 AND role = 'assistant'
            """,
            conversation_id,
        )
        return dict(row)

    async def list_conversations(
        self,
        user_id: UUID,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        """获取用户的对话列表（侧边栏展示）"""
        rows = await self._pool.fetch(
            """
            SELECT c.id, c.title, c.model, c.updated_at,
                   (SELECT content FROM messages 
                    WHERE conversation_id = c.id 
                    ORDER BY created_at DESC LIMIT 1) as last_message
            FROM conversations c
            WHERE c.user_id = $1 AND c.is_archived = FALSE
            ORDER BY c.updated_at DESC
            LIMIT $2 OFFSET $3
            """,
            user_id, limit, offset,
        )
        return [dict(r) for r in rows]

    async def delete_conversation(self, conversation_id: UUID, user_id: UUID):
        """软删除对话（标记为归档）"""
        await self._pool.execute(
            """
            UPDATE conversations 
            SET is_archived = TRUE, updated_at = NOW()
            WHERE id = $1 AND user_id = $2
            """,
            conversation_id, user_id,
        )
```

### 5.3 上下文窗口组装

上下文窗口组装是 Chatbot 最关键的环节之一——你需要在有限的 Token 预算内，把最有用的信息塞进去。

**生活类比**：就像收拾行李箱——箱子大小有限（Token 上限），你得决定哪些东西必须带（系统提示词）、哪些最好带（最近的对话）、哪些可以不带（很早之前的消息）。

**组装管线**：

```
Token 预算分配（以 128K 模型为例）：

总预算：128,000 tokens
  │
  ├─ 预留给回复：4,000 tokens（模型生成的内容）
  │
  └─ 可用上下文：124,000 tokens
       │
       ├─ ① 系统提示词：~2,000 tokens（固定，最高优先级）
       │
       ├─ ② RAG 检索结果：~4,000 tokens（如果触发了搜索）
       │
       ├─ ③ 工具调用结果：~3,000 tokens（如果有函数调用）
       │
       ├─ ④ 当前用户消息：~500 tokens（用户输入）
       │
       └─ ⑤ 对话历史：剩余全部 ~114,500 tokens
            │
            ├─ 从最新消息开始往回填充
            ├─ 超出预算时截断最早的消息
            └─ 可选：对最早的消息做摘要压缩
```

```python
from dataclasses import dataclass
from typing import Optional

import tiktoken


@dataclass
class Message:
    role: str
    content: str
    tokens: int = 0


class ContextAssembler:
    """上下文窗口组装器
    
    负责在有限的 Token 预算内，按优先级组装最终发送给 LLM 的消息列表。
    
    优先级（从高到低）：
    1. 系统提示词 —— 定义 AI 行为，永远保留
    2. 当前用户消息 —— 用户刚发送的，必须保留
    3. RAG 结果 —— 与当前问题直接相关的外部知识
    4. 最近对话历史 —— 从最新到最旧，尽可能多保留
    """

    def __init__(
        self,
        model: str = "gpt-4o",
        max_tokens: int = 128_000,
        reserved_for_response: int = 4_096,
    ):
        self._model = model
        self._max_context = max_tokens - reserved_for_response
        try:
            self._encoder = tiktoken.encoding_for_model(model)
        except KeyError:
            self._encoder = tiktoken.get_encoding("cl100k_base")

    def count_tokens(self, text: str) -> int:
        """精确计算文本的 Token 数"""
        return len(self._encoder.encode(text))

    def assemble(
        self,
        system_prompt: str,
        user_message: str,
        history: list[Message],
        rag_context: Optional[str] = None,
        tool_results: Optional[list[Message]] = None,
    ) -> list[dict]:
        """组装最终的消息列表
        
        Returns:
            list[dict]: 可直接传给 OpenAI API 的 messages 列表
        """
        budget = self._max_context
        result: list[dict] = []

        # ① 系统提示词（最高优先级，始终保留）
        sys_tokens = self.count_tokens(system_prompt)
        result.append({"role": "system", "content": system_prompt})
        budget -= sys_tokens

        # ② 当前用户消息（必须保留）
        user_tokens = self.count_tokens(user_message)
        budget -= user_tokens

        # ③ RAG 检索结果（如果有）
        if rag_context:
            rag_tokens = self.count_tokens(rag_context)
            if rag_tokens <= budget * 0.3:  # RAG 最多占 30% 剩余预算
                budget -= rag_tokens
            else:
                # RAG 结果太长，截断
                rag_context = self._truncate_to_budget(
                    rag_context, int(budget * 0.3)
                )
                budget -= self.count_tokens(rag_context)

        # ④ 工具调用结果（如果有）
        tool_budget_used = 0
        included_tools: list[Message] = []
        if tool_results:
            for tool_msg in tool_results:
                t = self.count_tokens(tool_msg.content)
                if tool_budget_used + t <= budget * 0.2:
                    included_tools.append(tool_msg)
                    tool_budget_used += t
            budget -= tool_budget_used

        # ⑤ 对话历史（从最新到最旧，尽可能多保留）
        included_history: list[Message] = []
        for msg in reversed(history):
            msg_tokens = self.count_tokens(msg.content)
            if msg_tokens <= budget:
                included_history.insert(0, msg)
                budget -= msg_tokens
            else:
                break  # 预算不足，停止添加更早的消息

        # 按正确顺序组装最终结果
        for msg in included_history:
            result.append({"role": msg.role, "content": msg.content})

        for msg in included_tools:
            result.append({"role": msg.role, "content": msg.content})

        if rag_context:
            result.append({
                "role": "system",
                "content": f"以下是与用户问题相关的参考资料：\n\n{rag_context}",
            })

        result.append({"role": "user", "content": user_message})

        return result

    def _truncate_to_budget(self, text: str, max_tokens: int) -> str:
        """将文本截断到指定 Token 数以内"""
        tokens = self._encoder.encode(text)
        if len(tokens) <= max_tokens:
            return text
        truncated = tokens[:max_tokens]
        return self._encoder.decode(truncated) + "\n\n[内容已截断...]"
```

### 5.4 消息分支（Regenerate / Edit-and-Continue）

现代 Chatbot 支持「重新生成」和「编辑后重发」功能，这需要一个树状的消息结构而非简单的线性列表。

**生活类比**：想象一本「选择你自己的冒险」的书——在某一页你可以做不同的选择，每个选择会引向不同的故事线。「重新生成」就是在同一个决策点尝试不同的选择，「编辑」就是回到更早的页码重新开始。

```
消息树结构示例：

                    [sys] 你是一个助手
                         │
                    [user] 解释量子计算
                         │
              ┌──────────┼──────────┐
              ▼                     ▼
    [asst] 回答v1              [asst] 回答v2     ← 用户点击「重新生成」
         │                     （当前活跃分支）
    [user] 继续深入
         │
    [asst] 更详细的回答

    ──────────────────────────────────────────
    
    编辑场景：

                    [user] 解释量子计算    ← 原始消息
                         │
                    [asst] 回答v1
                         │
    用户编辑原始消息为 →  [user] 用简单语言解释量子计算
                              │
                         [asst] 更简单的回答  ← 新分支
```

```python
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID, uuid4


@dataclass
class TreeMessage:
    """消息树中的节点"""
    id: UUID
    parent_id: Optional[UUID]
    role: str
    content: str
    children: list["TreeMessage"] = field(default_factory=list)
    is_active: bool = True  # 当前活跃分支


class MessageTree:
    """消息树管理器
    
    支持：
    - 线性追加（普通对话）
    - 分支创建（重新生成 / 编辑重发）
    - 活跃分支切换（在不同生成结果间切换）
    - 分支路径提取（获取当前活跃分支的完整消息链）
    """

    def __init__(self):
        self._nodes: dict[UUID, TreeMessage] = {}
        self._root_id: Optional[UUID] = None

    def add_message(
        self,
        role: str,
        content: str,
        parent_id: Optional[UUID] = None,
    ) -> TreeMessage:
        """添加消息（普通追加）"""
        msg = TreeMessage(
            id=uuid4(), parent_id=parent_id,
            role=role, content=content,
        )
        self._nodes[msg.id] = msg

        if parent_id and parent_id in self._nodes:
            self._nodes[parent_id].children.append(msg)
        elif self._root_id is None:
            self._root_id = msg.id

        return msg

    def regenerate(self, message_id: UUID, new_content: str) -> TreeMessage:
        """重新生成：在同一父节点下创建新的 assistant 分支
        
        原理：找到要重新生成的消息的父节点，
        在父节点下创建一个新的子节点，并将其设为活跃。
        """
        original = self._nodes[message_id]
        if original.parent_id is None:
            raise ValueError("无法重新生成根消息")

        # 将原消息标记为非活跃
        original.is_active = False

        # 在同一父节点下创建新分支
        new_msg = self.add_message(
            role=original.role,
            content=new_content,
            parent_id=original.parent_id,
        )
        new_msg.is_active = True
        return new_msg

    def edit_and_continue(
        self, message_id: UUID, new_content: str
    ) -> TreeMessage:
        """编辑并继续：修改用户消息，创建新分支
        
        原理：创建一个新的用户消息节点作为原消息父节点的子节点，
        后续的 AI 回复将挂在这个新节点下面。
        """
        original = self._nodes[message_id]
        original.is_active = False

        # 在同一父节点下创建编辑后的新消息
        edited = self.add_message(
            role="user",
            content=new_content,
            parent_id=original.parent_id,
        )
        edited.is_active = True
        return edited

    def get_active_path(self) -> list[TreeMessage]:
        """获取当前活跃分支的完整消息链（从根到叶）
        
        用于组装发送给 LLM 的对话历史。
        """
        if self._root_id is None:
            return []

        path: list[TreeMessage] = []
        current = self._nodes[self._root_id]
        path.append(current)

        while current.children:
            # 选择活跃的子节点
            active_child = next(
                (c for c in current.children if c.is_active),
                current.children[-1],  # fallback：最新的子节点
            )
            path.append(active_child)
            current = active_child

        return path

    def switch_branch(self, message_id: UUID):
        """切换到指定消息所在的分支"""
        target = self._nodes[message_id]
        if target.parent_id is None:
            return

        parent = self._nodes[target.parent_id]
        for child in parent.children:
            child.is_active = (child.id == message_id)
```

### 5.5 共享对话

用户经常想要分享有趣或有用的对话——这需要安全的分享机制。

**核心流程**：

```
用户点击「分享」
    │
    ▼
生成唯一分享 Token
    │
    ├─ Token 格式：share_xxxxxxxxxxxxxxxx（22 位随机字符串）
    │
    ▼
克隆消息到 shared_conversations 表
    │
    ├─ 为什么克隆？避免原对话修改影响分享视图
    ├─ 移除敏感信息（cost, tokens, metadata 中的内部字段）
    │
    ▼
返回分享链接
    │
    └─ https://chatbot.com/share/share_xxxxxxxxxxxxxxxx
```

**权限模型**：

```
┌─────────────────────────────────────────────────┐
│               共享权限级别                        │
├──────────────┬──────────────────────────────────┤
│ 级别          │ 说明                             │
├──────────────┼──────────────────────────────────┤
│ public       │ 任何人可看，搜索引擎可索引          │
│ link_only    │ 只有知道链接的人可看（默认）         │
│ password     │ 需要输入密码才能查看               │
│ disabled     │ 分享已关闭，链接失效               │
└──────────────┴──────────────────────────────────┘
```

```typescript
import { randomBytes } from "crypto";

interface ShareOptions {
  permission: "public" | "link_only" | "password" | "disabled";
  password?: string;
  expiresAt?: Date;       // 可选：过期时间
  allowFork?: boolean;    // 允许他人基于此对话继续聊
}

interface SharedConversation {
  shareToken: string;
  originalConversationId: string;
  ownerId: string;
  title: string;
  messages: SharedMessage[];
  permission: string;
  createdAt: Date;
  expiresAt?: Date;
  viewCount: number;
}

interface SharedMessage {
  role: string;
  content: string;
  model?: string;
  createdAt: Date;
  // 注意：不包含 tokens, cost 等敏感字段
}

class ConversationSharer {
  /**
   * 生成分享链接
   *
   * 安全措施：
   * 1. Token 足够随机，不可枚举
   * 2. 克隆消息快照，隔离原始数据
   * 3. 移除敏感字段（成本、Token 用量等）
   */
  async createShare(
    conversationId: string,
    userId: string,
    options: ShareOptions
  ): Promise<{ shareUrl: string; shareToken: string }> {
    // 生成不可猜测的分享 Token
    const shareToken = "share_" + randomBytes(16).toString("base64url");

    // 获取原始对话消息
    const messages = await this.getConversationMessages(conversationId);

    // 克隆并清洗敏感信息
    const sanitizedMessages: SharedMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      model: msg.role === "assistant" ? msg.model : undefined,
      createdAt: msg.createdAt,
    }));

    // 存储分享记录
    const shared: SharedConversation = {
      shareToken,
      originalConversationId: conversationId,
      ownerId: userId,
      title: await this.getConversationTitle(conversationId),
      messages: sanitizedMessages,
      permission: options.permission,
      createdAt: new Date(),
      expiresAt: options.expiresAt,
      viewCount: 0,
    };

    await this.saveSharedConversation(shared);

    // 如果设置了密码，单独存储密码哈希
    if (options.password) {
      await this.setSharePassword(shareToken, options.password);
    }

    return {
      shareUrl: `https://chatbot.com/share/${shareToken}`,
      shareToken,
    };
  }

  /**
   * 访问分享对话 —— 需验证权限和有效期
   */
  async viewShare(
    shareToken: string,
    password?: string
  ): Promise<SharedConversation | null> {
    const shared = await this.getSharedConversation(shareToken);
    if (!shared) return null;

    // 检查有效期
    if (shared.expiresAt && new Date() > shared.expiresAt) {
      return null;
    }

    // 检查权限
    if (shared.permission === "disabled") return null;
    if (shared.permission === "password") {
      if (!password || !(await this.verifyPassword(shareToken, password))) {
        throw new Error("密码错误");
      }
    }

    // 增加浏览次数
    await this.incrementViewCount(shareToken);

    return shared;
  }

  // ... 数据库操作方法省略
  private async getConversationMessages(id: string) { return []; }
  private async getConversationTitle(id: string) { return ""; }
  private async saveSharedConversation(s: SharedConversation) {}
  private async getSharedConversation(t: string) { return null as any; }
  private async setSharePassword(t: string, p: string) {}
  private async verifyPassword(t: string, p: string) { return false; }
  private async incrementViewCount(t: string) {}
}
```

**SEO 考虑**：对于 `public` 权限的分享对话，需要服务端渲染（SSR）以支持搜索引擎索引：

```
搜索引擎爬虫访问 /share/xxx
        │
        ▼
  服务端渲染 HTML
  ├─ <title>对话标题</title>
  ├─ <meta name="description" content="对话摘要">
  ├─ <meta property="og:title" content="...">  ← 社交媒体预览
  └─ 完整对话内容以 HTML 呈现
        │
        ▼
  返回完整 HTML（不依赖 JavaScript）
```

---

## 6. RAG 检索增强（Perplexity 模式）

> 📖 **深入学习**：本节为全链路视角概述，详细原理与实践请参阅 [RAG工程化实践](./07-RAG工程化实践.md)

> RAG（Retrieval-Augmented Generation）让 Chatbot 从「凭记忆回答」升级为「带着参考资料回答」。这一节我们构建一个类似 Perplexity 的搜索增强对话系统。

### 6.1 为什么需要 RAG

**生活类比**：
- **没有 RAG 的 LLM** = 闭卷考试——只能凭记忆答题，记错了就错了
- **有 RAG 的 LLM** = 开卷考试——可以翻参考书，但需要会找、会读、会总结

```
没有 RAG：
用户："2024 年诺贝尔物理学奖颁给了谁？"
LLM："我无法确定，我的训练数据截止到 ..." ← 知识截止

有 RAG：
用户："2024 年诺贝尔物理学奖颁给了谁？"
  │
  ├─ 搜索互联网 → 找到相关文章
  ├─ 提取关键信息 → "John Hopfield 和 Geoffrey Hinton"
  └─ 生成回答（附带引用来源）
LLM："2024 年诺贝尔物理学奖授予了 John Hopfield 和 Geoffrey Hinton，
      以表彰他们在人工神经网络机器学习方面的基础性发现。[1][2]"
```

**RAG 解决的三大问题**：

```
┌─────────────────────────────────────────────────────┐
│  问题 1：知识截止（Knowledge Cutoff）                 │
│  ───────────────────────────────                     │
│  模型训练数据有截止日期，无法回答最新事件。              │
│  RAG 方案：实时搜索互联网或知识库，获取最新信息。        │
├─────────────────────────────────────────────────────┤
│  问题 2：幻觉（Hallucination）                       │
│  ────────────────────                                │
│  模型可能自信地给出错误答案（编造事实）。                │
│  RAG 方案：用检索到的真实文档作为事实依据（grounding）。  │
├─────────────────────────────────────────────────────┤
│  问题 3：领域知识不足                                  │
│  ──────────────                                      │
│  通用模型对特定企业/行业知识了解有限。                    │
│  RAG 方案：接入企业内部知识库，提供专业准确的回答。       │
└─────────────────────────────────────────────────────┘
```

### 6.2 查询理解与搜索

用户的问题往往不能直接用来搜索——需要先「理解」用户想要什么，再转化为有效的搜索查询。

**查询处理管线**：

```
用户原始问题
     │
     ▼
┌──────────────┐
│ 意图分类      │ → 事实查询 / 观点对比 / 操作指导 / 闲聊
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 查询分解      │ → 将复合问题拆分为多个子查询
└──────┬───────┘   例："对比 React 和 Vue 的性能和生态"
       │           → 子查询1: "React 性能特点"
       │           → 子查询2: "Vue 性能特点"
       │           → 子查询3: "React 生态系统"
       │           → 子查询4: "Vue 生态系统"
       ▼
┌──────────────┐
│ 查询改写      │ → 添加关键词、去除口语化表达
└──────┬───────┘   "React 咋用啊" → "React 框架使用教程入门"
       │
       ▼
┌──────────────┐
│ 多源搜索      │ → 并行搜索多个数据源
└──────┬───────┘
       │
  ┌────┼────┬──────────┐
  ▼    ▼    ▼          ▼
 Web  向量DB 知识库   API文档
```

```python
from dataclasses import dataclass
from enum import Enum


class SearchIntent(Enum):
    FACTUAL = "factual"         # 事实查询："X 是什么"
    COMPARISON = "comparison"   # 对比分析："A vs B"
    HOW_TO = "how_to"           # 操作指导："如何做 X"
    OPINION = "opinion"         # 观点类："X 好不好"
    CASUAL = "casual"           # 闲聊（不需要搜索）


@dataclass
class ProcessedQuery:
    """处理后的查询"""
    original: str
    intent: SearchIntent
    sub_queries: list[str]
    search_keywords: list[str]
    needs_web_search: bool
    needs_knowledge_base: bool


class QueryProcessor:
    """查询理解与处理器
    
    用 LLM 自身来理解用户意图，并生成优化后的搜索查询。
    这是 "LLM 调用 LLM" 的典型应用——用一次廉价的 LLM 调用
    来优化后续的检索质量。
    """

    DECOMPOSE_PROMPT = """你是一个搜索查询优化器。给定用户问题，请：
1. 判断搜索意图（factual/comparison/how_to/opinion/casual）
2. 如果是复合问题，拆分为 2-4 个子查询
3. 提取 3-5 个搜索关键词
4. 判断是否需要搜索互联网（最新信息）
5. 判断是否需要搜索内部知识库

以 JSON 格式输出。"""

    def __init__(self, llm_client):
        self._llm = llm_client

    async def process(self, user_query: str) -> ProcessedQuery:
        """处理用户查询，输出优化后的搜索请求"""
        response = await self._llm.chat(
            model="gpt-4o-mini",  # 用便宜快速的模型做查询理解
            messages=[
                {"role": "system", "content": self.DECOMPOSE_PROMPT},
                {"role": "user", "content": user_query},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )

        result = response.parsed_json

        return ProcessedQuery(
            original=user_query,
            intent=SearchIntent(result.get("intent", "factual")),
            sub_queries=result.get("sub_queries", [user_query]),
            search_keywords=result.get("keywords", []),
            needs_web_search=result.get("needs_web_search", True),
            needs_knowledge_base=result.get("needs_knowledge_base", False),
        )

    async def search_all_sources(
        self, query: ProcessedQuery
    ) -> list[dict]:
        """并行搜索所有相关数据源"""
        import asyncio

        tasks = []

        if query.needs_web_search:
            for sub_q in query.sub_queries:
                tasks.append(self._search_web(sub_q))

        if query.needs_knowledge_base:
            for sub_q in query.sub_queries:
                tasks.append(self._search_knowledge_base(sub_q))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 合并去重
        all_docs = []
        seen_urls = set()
        for result in results:
            if isinstance(result, Exception):
                continue
            for doc in result:
                if doc["url"] not in seen_urls:
                    seen_urls.add(doc["url"])
                    all_docs.append(doc)

        return all_docs

    async def _search_web(self, query: str) -> list[dict]:
        """调用 Web 搜索 API（如 Bing/Google/Serper）"""
        # 实际实现中调用搜索 API
        return []

    async def _search_knowledge_base(self, query: str) -> list[dict]:
        """搜索内部向量知识库"""
        # 实际实现中查询向量数据库
        return []
```

### 6.3 文档处理 Pipeline

搜索返回的是完整网页或文档，需要经过处理才能用于 RAG：切块（Chunking）→ 嵌入（Embedding）→ 存储（Indexing）。

**生活类比**：就像图书馆管理员整理书籍——先把厚书拆分成章节索引卡片（切块），给每张卡片打上主题标签（嵌入），然后按主题分类放入索引柜（向量存储）。

**切块策略对比**：

```
原文："深度学习是机器学习的一个子领域。它使用多层神经网络
      来学习数据的层次表示。卷积神经网络（CNN）特别适用于
      图像识别任务。循环神经网络（RNN）则适用于序列数据。"

策略 1：固定大小切块（256 tokens）
┌─────────────────────────────┐
│ "深度学习是机器学习的一个子   │ ← 可能在句子中间截断 ❌
│ 领域。它使用多层神经网络来学  │
│ 习数据的层..."              │
└─────────────────────────────┘

策略 2：句子边界切块
┌─────────────────────────────┐
│ "深度学习是机器学习的一个子   │ ← 完整句子 ✅
│ 领域。它使用多层神经网络来学  │
│ 习数据的层次表示。"          │
├─────────────────────────────┤
│ "卷积神经网络（CNN）特别适用  │
│ 于图像识别任务。循环神经网络  │
│ （RNN）则适用于序列数据。"    │
└─────────────────────────────┘

策略 3：语义切块（推荐）
┌─────────────────────────────┐
│ [主题：深度学习概述]          │ ← 按语义主题分组 ✅✅
│ "深度学习是...层次表示。"    │
├─────────────────────────────┤
│ [主题：CNN 与图像]           │
│ "卷积神经网络...图像识别。"  │
├─────────────────────────────┤
│ [主题：RNN 与序列]           │
│ "循环神经网络...序列数据。"  │
└─────────────────────────────┘
```

**Embedding 模型对比**：

```
┌───────────────────────────────────────────────────────────────┐
│                   主流 Embedding 模型对比                      │
├──────────────────────┬──────┬────────┬───────┬───────────────┤
│ 模型                  │ 维度 │ 速度    │ 质量   │ 适用场景       │
├──────────────────────┼──────┼────────┼───────┼───────────────┤
│ text-embedding-3-small│ 1536 │ ⚡ 极快  │ ⭐⭐⭐ │ 成本敏感场景    │
│ text-embedding-3-large│ 3072 │ 🔄 快   │ ⭐⭐⭐⭐│ 高质量检索     │
│ Cohere embed-v3       │ 1024 │ 🔄 快   │ ⭐⭐⭐⭐│ 多语言场景     │
│ BGE-M3 (开源)         │ 1024 │ 🔄 中   │ ⭐⭐⭐⭐│ 自部署 & 隐私   │
│ Jina embeddings-v3    │ 1024 │ ⚡ 快    │ ⭐⭐⭐⭐│ 长文本 (8K)    │
└──────────────────────┴──────┴────────┴───────┴───────────────┘
```

```python
from dataclasses import dataclass


@dataclass
class DocumentChunk:
    """文档块"""
    chunk_id: str
    document_id: str
    content: str
    metadata: dict          # 来源 URL、标题、作者等
    embedding: list[float]  # 向量嵌入
    token_count: int


class DocumentProcessor:
    """文档处理 Pipeline
    
    完整流程：
    原始文档 → 清洗 → 切块 → 嵌入 → 存储到向量数据库
    """

    def __init__(self, embedding_client, vector_store):
        self._embedder = embedding_client
        self._vector_store = vector_store
        self._chunk_size = 512       # 目标块大小（tokens）
        self._chunk_overlap = 50     # 块之间的重叠（tokens）

    async def process_document(
        self, content: str, metadata: dict
    ) -> list[DocumentChunk]:
        """处理单个文档：清洗 → 切块 → 嵌入 → 存储"""

        # 第一步：清洗文档
        cleaned = self._clean_content(content)

        # 第二步：语义切块
        chunks_text = self._semantic_chunk(cleaned)

        # 第三步：批量生成嵌入向量
        embeddings = await self._embedder.embed_batch(
            texts=chunks_text,
            model="text-embedding-3-small",
        )

        # 第四步：组装 Chunk 对象
        chunks = []
        for i, (text, embedding) in enumerate(zip(chunks_text, embeddings)):
            chunk = DocumentChunk(
                chunk_id=f"{metadata.get('doc_id', 'unknown')}_{i}",
                document_id=metadata.get("doc_id", "unknown"),
                content=text,
                metadata={
                    **metadata,
                    "chunk_index": i,
                    "total_chunks": len(chunks_text),
                },
                embedding=embedding,
                token_count=len(text.split()) * 2,  # 粗略估计
            )
            chunks.append(chunk)

        # 第五步：存储到向量数据库
        await self._vector_store.upsert(chunks)

        return chunks

    def _clean_content(self, content: str) -> str:
        """清洗文档内容"""
        import re
        # 移除 HTML 标签
        content = re.sub(r"<[^>]+>", "", content)
        # 移除多余空行
        content = re.sub(r"\n{3,}", "\n\n", content)
        # 移除特殊字符
        content = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", content)
        return content.strip()

    def _semantic_chunk(self, text: str) -> list[str]:
        """基于语义的文档切块
        
        策略：按段落分割，如果段落太长则按句子分割，
        然后将短段落合并直到接近目标块大小。
        """
        paragraphs = text.split("\n\n")
        chunks: list[str] = []
        current_chunk: list[str] = []
        current_size = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            para_size = len(para.split())
            target_words = self._chunk_size // 2  # 粗略 token→word

            if current_size + para_size > target_words and current_chunk:
                # 当前块已满，保存并开始新块
                chunks.append("\n\n".join(current_chunk))
                # 保留最后一段作为重叠（上下文连续性）
                overlap = current_chunk[-1] if current_chunk else ""
                current_chunk = [overlap] if overlap else []
                current_size = len(overlap.split())

            current_chunk.append(para)
            current_size += para_size

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks
```

### 6.4 检索与重排序

检索分两个阶段：先用向量搜索快速召回候选文档（粗筛），再用精排模型对候选进行重新排序（精排）。

**生活类比**：就像高考录取——先按分数线筛掉明显不合格的考生（向量检索），再由招生委员会对入围者进行面试评估（交叉编码器重排序）。

```
两阶段检索流程：

  用户查询
     │
     ▼
┌────────────────┐
│ Stage 1: 召回   │
│ ANN 向量搜索    │  ← 从 100 万文档中找出 Top 20
│ (毫秒级)        │     用的是 embedding 的余弦相似度
└───────┬────────┘     粗略但超快
        │
        ▼
   Top 20 候选文档
        │
        ▼
┌────────────────┐
│ Stage 2: 精排   │
│ Cross-Encoder  │  ← 对 20 个候选逐一精确打分
│ (百毫秒级)      │     用 query-document 对做交叉注意力
└───────┬────────┘     精确但较慢
        │
        ▼
   Top 5 最终结果
        │
        ├─ 多样性过滤：去除内容高度重复的结果
        └─ 新鲜度加权：更新的文档适当加分
```

```python
from dataclasses import dataclass


@dataclass
class RetrievalResult:
    """检索结果"""
    chunk_id: str
    content: str
    score: float           # 相关性分数 (0-1)
    source_url: str
    source_title: str
    metadata: dict


class Retriever:
    """两阶段检索器
    
    Stage 1: 向量 ANN 搜索 → 召回 Top-K 候选
    Stage 2: Cross-Encoder 重排序 → 精选 Top-N 结果
    """

    def __init__(self, vector_store, reranker, embedding_client):
        self._vector_store = vector_store
        self._reranker = reranker
        self._embedder = embedding_client

    async def retrieve(
        self,
        query: str,
        top_k: int = 20,      # Stage 1 召回数量
        top_n: int = 5,        # Stage 2 最终数量
        diversity_threshold: float = 0.85,
    ) -> list[RetrievalResult]:
        """执行两阶段检索"""

        # Stage 1：向量搜索（毫秒级）
        query_embedding = await self._embedder.embed(
            text=query, model="text-embedding-3-small"
        )
        candidates = await self._vector_store.search(
            vector=query_embedding,
            top_k=top_k,
            include_metadata=True,
        )

        if not candidates:
            return []

        # Stage 2：Cross-Encoder 重排序（百毫秒级）
        reranked = await self._reranker.rerank(
            query=query,
            documents=[c.content for c in candidates],
            top_n=top_k,  # 先全部重排，再做多样性过滤
        )

        # 按重排分数排序
        scored = []
        for rank_result in reranked:
            candidate = candidates[rank_result.index]
            scored.append(RetrievalResult(
                chunk_id=candidate.chunk_id,
                content=candidate.content,
                score=rank_result.relevance_score,
                source_url=candidate.metadata.get("url", ""),
                source_title=candidate.metadata.get("title", ""),
                metadata=candidate.metadata,
            ))

        scored.sort(key=lambda x: x.score, reverse=True)

        # 多样性过滤：去除内容高度重复的结果
        diverse_results = self._diversity_filter(scored, diversity_threshold)

        return diverse_results[:top_n]

    def _diversity_filter(
        self,
        results: list[RetrievalResult],
        threshold: float,
    ) -> list[RetrievalResult]:
        """多样性过滤 —— 避免返回重复内容
        
        使用 Jaccard 相似度快速判断两个文档是否过于相似。
        如果相似度超过阈值，只保留分数更高的那个。
        """
        if not results:
            return []

        filtered = [results[0]]

        for candidate in results[1:]:
            is_diverse = True
            candidate_words = set(candidate.content.split())

            for kept in filtered:
                kept_words = set(kept.content.split())
                intersection = candidate_words & kept_words
                union = candidate_words | kept_words

                if union and len(intersection) / len(union) > threshold:
                    is_diverse = False
                    break

            if is_diverse:
                filtered.append(candidate)

        return filtered
```

### 6.5 引用溯源

RAG 系统的一个核心价值是让用户知道信息来源——每一条主张都应可追溯到具体的来源文档。

**引用格式**：

```
用户："量子计算的最新进展是什么？"

AI 回答（带引用）：
"2024 年，量子计算领域取得了多项重要突破。Google 的 Willow
芯片实现了低于阈值的量子纠错[1]，这意味着量子计算机首次
能够随着规模增大而变得更可靠，而非更容易出错。与此同时，
IBM 发布了 1000+ 量子比特的 Condor 处理器[2]，并展示了
量子优势在材料科学模拟中的应用[3]。"

---
引用来源：
[1] Google Quantum AI Blog - "Quantum error correction below threshold"
    https://blog.google/technology/quantum/...
[2] IBM Research - "IBM Condor: 1121-qubit quantum processor"  
    https://research.ibm.com/blog/...
[3] Nature - "Quantum advantage in materials simulation"
    https://nature.com/articles/...
```

```python
from dataclasses import dataclass, field


@dataclass
class Citation:
    """引用信息"""
    index: int                  # 引用编号 [1], [2], ...
    source_url: str
    source_title: str
    relevant_snippet: str       # 来源中的相关段落
    confidence: float           # 置信度 (0-1)


@dataclass
class CitedResponse:
    """带引用的回答"""
    content: str                           # 带 [1][2] 标记的正文
    citations: list[Citation] = field(default_factory=list)


class CitationManager:
    """引用管理器
    
    职责：
    1. 将检索到的来源转换为编号引用
    2. 让 LLM 在生成回答时引用来源
    3. 验证引用的准确性（claim 是否真的来自 source）
    """

    CITE_PROMPT = """你是一个严谨的 AI 助手。基于以下参考资料回答问题。

规则：
1. 只使用参考资料中的信息来回答
2. 每个事实性陈述后必须标注引用来源，格式为 [N]
3. 如果参考资料中没有相关信息，坦诚说明
4. 不要编造参考资料中没有的内容

参考资料：
{sources}

请回答以下问题："""

    def __init__(self, llm_client):
        self._llm = llm_client

    async def generate_cited_response(
        self,
        query: str,
        retrieval_results: list,  # RetrievalResult 列表
    ) -> CitedResponse:
        """生成带引用的回答"""

        # 构建引用来源文本
        sources_text = ""
        citations = []
        for i, result in enumerate(retrieval_results, 1):
            sources_text += f"\n[{i}] {result.source_title}\n"
            sources_text += f"URL: {result.source_url}\n"
            sources_text += f"内容: {result.content}\n"

            citations.append(Citation(
                index=i,
                source_url=result.source_url,
                source_title=result.source_title,
                relevant_snippet=result.content[:200],
                confidence=result.score,
            ))

        # 调用 LLM 生成带引用的回答
        prompt = self.CITE_PROMPT.format(sources=sources_text)
        response = await self._llm.chat(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": query},
            ],
        )

        # 提取回答中实际使用的引用编号
        import re
        used_indices = set(
            int(m) for m in re.findall(r"\[(\d+)\]", response.content)
        )
        used_citations = [c for c in citations if c.index in used_indices]

        return CitedResponse(
            content=response.content,
            citations=used_citations,
        )

    def format_footnotes(self, cited_response: CitedResponse) -> str:
        """格式化引用脚注（用于前端展示）"""
        footnotes = "\n\n---\n**参考来源：**\n"
        for cite in cited_response.citations:
            confidence_bar = "🟢" if cite.confidence > 0.8 else "🟡"
            footnotes += (
                f"[{cite.index}] {confidence_bar} {cite.source_title}\n"
                f"    {cite.source_url}\n"
            )
        return cited_response.content + footnotes
```

### 6.6 RAG 评估指标

RAG 系统需要持续评估和优化。评估分三个层面：检索质量、生成质量、端到端质量。

```
RAG 评估三层框架：

┌─────────────────────────────────────────────────────┐
│                  端到端指标 (E2E)                     │
│  ─────────────────────────────────                   │
│  用户满意度、回答正确率、任务完成率                       │
├─────────────────┬───────────────────────────────────┤
│  检索质量         │          生成质量                  │
│  ──────         │          ──────                    │
│  找到对的文档了吗？ │  用对的文档生成了好回答吗？           │
│                  │                                   │
│  • Precision@K  │  • Faithfulness (忠实度)            │
│  • Recall@K     │  • Answer Relevance (答案相关性)    │
│  • MRR          │  • Context Precision (上下文精度)   │
│  • NDCG         │  • Hallucination Rate (幻觉率)     │
└─────────────────┴───────────────────────────────────┘
```

**各指标详解**：

```
检索质量指标：
═══════════

Precision@K（精确率）：Top-K 结果中有多少是相关的？
  公式：相关文档数 / K
  例：Top 5 中 3 个相关 → Precision@5 = 3/5 = 0.6

Recall@K（召回率）：所有相关文档中，有多少被检索到了？
  公式：检索到的相关文档数 / 全部相关文档数
  例：共 10 个相关文档，Top 5 中有 3 个 → Recall@5 = 3/10 = 0.3

MRR（平均倒数排名）：第一个相关文档排第几？
  公式：1 / 第一个相关文档的排名
  例：第一个相关文档排第 3 → MRR = 1/3 ≈ 0.33
  意义：越接近 1 越好，说明最相关的文档排得很靠前

───────────────────────────────────────

生成质量指标：
═══════════

Faithfulness（忠实度）：回答是否忠实于检索到的文档？
  衡量方法：将回答中的每个事实陈述与来源文档对比
  目标：> 0.9（几乎所有陈述都有来源支持）
  ❌ 低忠实度示例："文档说 A，但回答说了 B"

Answer Relevance（答案相关性）：回答是否切题？
  衡量方法：用 LLM 判断回答与问题的相关程度
  目标：> 0.85
  ❌ 低相关性示例：用户问 "如何部署"，回答了 "部署的历史"

Context Precision（上下文精度）：注入的上下文中有多少真正有用？
  衡量方法：分析上下文中各段落对回答的贡献度
  目标：> 0.7
  ❌ 低精度示例：注入了 5 段文档，但只有 1 段与问题相关
```

**RAGAS 评估框架**：

RAGAS（Retrieval Augmented Generation Assessment）是目前最流行的 RAG 评估框架，它将以上指标整合为一个自动化评估流程：

```python
# RAGAS 评估示例（伪代码）
from dataclasses import dataclass


@dataclass
class RAGEvalSample:
    """单个评估样本"""
    question: str                    # 用户问题
    ground_truth: str                # 标准答案（人工标注）
    retrieved_contexts: list[str]    # 检索到的文档
    generated_answer: str            # RAG 系统生成的回答


@dataclass
class RAGEvalResult:
    """评估结果"""
    faithfulness: float       # 忠实度 (0-1)
    answer_relevancy: float   # 答案相关性 (0-1)
    context_precision: float  # 上下文精度 (0-1)
    context_recall: float     # 上下文召回 (0-1)
    overall_score: float      # 综合分数


class RAGEvaluator:
    """RAG 评估器
    
    使用 LLM-as-Judge 方式评估 RAG 系统质量。
    """

    def __init__(self, judge_llm):
        self._judge = judge_llm

    async def evaluate_batch(
        self, samples: list[RAGEvalSample]
    ) -> RAGEvalResult:
        """批量评估 RAG 样本"""
        faithfulness_scores = []
        relevancy_scores = []
        precision_scores = []
        recall_scores = []

        for sample in samples:
            f = await self._eval_faithfulness(sample)
            r = await self._eval_relevancy(sample)
            p = await self._eval_context_precision(sample)
            c = await self._eval_context_recall(sample)

            faithfulness_scores.append(f)
            relevancy_scores.append(r)
            precision_scores.append(p)
            recall_scores.append(c)

        avg = lambda scores: sum(scores) / len(scores) if scores else 0

        faith = avg(faithfulness_scores)
        relev = avg(relevancy_scores)
        prec = avg(precision_scores)
        rec = avg(recall_scores)

        return RAGEvalResult(
            faithfulness=round(faith, 3),
            answer_relevancy=round(relev, 3),
            context_precision=round(prec, 3),
            context_recall=round(rec, 3),
            overall_score=round((faith + relev + prec + rec) / 4, 3),
        )

    async def _eval_faithfulness(self, sample: RAGEvalSample) -> float:
        """评估忠实度：回答中的陈述是否都有来源支持"""
        prompt = f"""判断以下回答中的每个事实陈述是否可以在给定的上下文中找到支持。

上下文：
{chr(10).join(sample.retrieved_contexts)}

回答：
{sample.generated_answer}

对于每个事实陈述，判断"支持"或"不支持"。
最后给出支持比例（0-1）。仅输出数字。"""

        result = await self._judge.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        try:
            return float(result.content.strip())
        except ValueError:
            return 0.0

    async def _eval_relevancy(self, sample: RAGEvalSample) -> float:
        """评估答案相关性：回答是否切题"""
        prompt = f"""评估以下回答与问题的相关程度。

问题：{sample.question}
回答：{sample.generated_answer}

评分标准：
1.0 = 完全切题，直接回答了问题
0.5 = 部分相关，但有偏题内容
0.0 = 完全不相关

仅输出 0-1 之间的数字。"""

        result = await self._judge.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        try:
            return float(result.content.strip())
        except ValueError:
            return 0.0

    async def _eval_context_precision(self, sample: RAGEvalSample) -> float:
        """评估上下文精度：检索的文档中有多少真正有用"""
        useful_count = 0
        for ctx in sample.retrieved_contexts:
            prompt = f"""判断以下上下文段落是否对回答问题有帮助。

问题：{sample.question}
上下文段落：{ctx}

仅回答 "是" 或 "否"。"""
            result = await self._judge.chat(
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            if "是" in result.content:
                useful_count += 1

        total = len(sample.retrieved_contexts)
        return useful_count / total if total > 0 else 0.0

    async def _eval_context_recall(self, sample: RAGEvalSample) -> float:
        """评估上下文召回：标准答案中的信息是否都被检索到了"""
        prompt = f"""标准答案中的关键信息是否都可以在检索的上下文中找到？

标准答案：{sample.ground_truth}
检索上下文：{chr(10).join(sample.retrieved_contexts)}

评估标准答案中每个关键要点，判断是否被上下文覆盖。
输出覆盖比例（0-1）。仅输出数字。"""

        result = await self._judge.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        try:
            return float(result.content.strip())
        except ValueError:
            return 0.0
```

**评估指标的实际目标值**：

```
┌────────────────────────────────────────────────────┐
│            RAG 系统质量基准线                        │
├──────────────────┬───────────┬─────────────────────┤
│ 指标              │  目标值    │  低于此值应优化       │
├──────────────────┼───────────┼─────────────────────┤
│ Faithfulness     │  > 0.90   │  < 0.80 有幻觉风险   │
│ Answer Relevancy │  > 0.85   │  < 0.70 回答跑题     │
│ Context Precision│  > 0.70   │  < 0.50 检索噪音太多  │
│ Context Recall   │  > 0.75   │  < 0.60 遗漏关键信息  │
│ Overall Score    │  > 0.80   │  < 0.65 需要全面改进  │
└──────────────────┴───────────┴─────────────────────┘

当指标不达标时的优化方向：
• Faithfulness 低   → 优化提示词，加强 "仅基于来源回答" 的指令
• Relevancy 低      → 优化查询理解，改进搜索关键词提取
• Precision 低      → 优化重排序模型，提高检索门槛分数
• Recall 低         → 增加检索数量、扩展搜索来源、改进切块策略
```
