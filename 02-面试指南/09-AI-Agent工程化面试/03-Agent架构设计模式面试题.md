# Agent 架构设计模式面试题

> 覆盖 ReAct、Harness Engineering、多 Agent 系统、上下文管理等架构面试题

## 相关链接

- 对应技术资料：[Agent架构设计模式](../../01-技术资料/09-AI-Agent工程化/03-Agent架构设计模式.md)

## 题目列表

| 题号 | 题目 | 难度 |
|------|------|------|
| Q1 | 解释 Agent 的"感知-推理-行动"循环 | ⭐ 基础 |
| Q2 | ReAct 模式的工作流程是什么？ | ⭐ 基础 |
| Q3 | 比较 ReAct 和 Plan-and-Execute 两种 Agent 模式 | ⭐⭐ 进阶 |
| Q4 | Claude Code 的 Harness Engineering 模式是什么？有什么优势？ | ⭐⭐ 进阶 |
| Q5 | CLAUDE.md / AGENTS.md 这类项目配置文件解决了什么问题？ | ⭐⭐ 进阶 |
| Q6 | 如何解决 Agent 的上下文窗口限制问题？ | ⭐⭐ 进阶 |
| Q7 | 多 Agent 系统的 Hub-Spoke、Pipeline、Peer-to-Peer 拓扑各有什么优缺点？ | ⭐⭐ 进阶 |
| Q8 | 如何防止 Agent 陷入无限循环？ | ⭐⭐ 进阶 |
| Q9 | 设计一个 Coding Agent 的工具权限体系 | ⭐⭐⭐ 高阶 |
| Q10 | 比较 Claude Code、Codex CLI、OpenHands 三者的架构设计差异 | ⭐⭐⭐ 高阶 |
| Q11 | 如何评估一个 Agent 系统的可靠性？ | ⭐⭐⭐ 高阶 |
| Q12 | 设计一个能自动修复 GitHub Issue 的 Agent 系统 | 🎯 场景 |

## 🔥 高频考点速记

| # | 考点 | 核心要点 | 出题概率 |
|---|------|---------|---------|
| 1 | ReAct 模式 | Think→Act→Observe 循环 → 工具调用 → 最终回答 | ★★★★★ |
| 2 | 上下文管理 | 渐进加载 / 滑动窗口摘要 / 记忆层级 | ★★★★★ |
| 3 | 安全边界 | 最小权限 / 沙箱隔离 / HITL 审批 | ★★★★☆ |
| 4 | 多 Agent 架构 | Hub-Spoke(清晰) / Pipeline(简单) / P2P(灵活) | ★★★★☆ |

## 参考答案

### Q1: Agent 的"感知-推理-行动"循环

<details>
<summary>参考答案</summary>

**Agent 本质是一个自主循环系统：感知环境（输入+工具返回）→ 推理决策（LLM）→ 执行行动（工具调用）→ 观察结果 → 再循环。**

#### 类比理解

Agent 就像一个实习生：老板给了任务（用户输入），实习生先想该怎么做（推理），然后去查资料、写代码（行动），看看结果对不对（观察），不对就继续改，直到完成。

#### 循环过程

```
用户输入 → [感知] 获取上下文 + 可用工具列表
              ↓
         [推理] LLM 分析问题，决定下一步
              ↓
         ┌─ 需要更多信息 → [行动] 调用工具 → [观察] 获取结果 → 回到[推理]
         │
         └─ 已有足够信息 → [输出] 生成最终回答
```

#### 与传统 Chatbot 的区别

| 维度 | 传统 Chatbot | Agent |
|------|-------------|-------|
| 决策能力 | 无，直接生成回答 | 有，选择工具和策略 |
| 环境交互 | 无 | 读写文件、执行代码、搜索 |
| 自主性 | 一问一答 | 多步自主完成任务 |
| 循环 | 单次 | 多次感知-推理-行动循环 |

</details>

---

### Q2: ReAct 模式工作流程

<details>
<summary>参考答案</summary>

**ReAct = Reasoning + Acting。LLM 交替进行思考（Thought）和行动（Action），每次行动后观察结果（Observation），循环直到得出最终答案。**

#### 执行流程

```
Thought: 用户问的是 X，我需要先查找 Y
Action: search("Y 相关信息")
Observation: 搜索结果显示...

Thought: 根据搜索结果，我还需要查看文件 Z
Action: read_file("Z.py")
Observation: 文件内容是...

Thought: 现在我有足够信息回答了
Answer: 最终答案是...
```

#### Prompt 模板核心

```
你是一个 AI 助手，可以使用以下工具：{tool_descriptions}

回答问题时，使用以下格式：
Thought: 我需要思考...
Action: tool_name(params)
Observation: [工具返回结果]
...（重复 Thought/Action/Observation）
Answer: 最终答案
```

#### 优缺点

| 优势 | 劣势 |
|------|------|
| 推理过程透明（可解释性） | 每步都需要 LLM 调用（延迟高） |
| 灵活应对意外情况 | Token 消耗大（历史累积） |
| 工具使用自然 | 可能陷入循环 |

</details>

---

### Q3: ReAct vs Plan-and-Execute

<details>
<summary>参考答案</summary>

**ReAct 是"走一步看一步"（反应式），Plan-and-Execute 是"先规划再执行"（计划式）。**

#### 对比

| 维度 | ReAct | Plan-and-Execute |
|------|-------|-----------------|
| 决策方式 | 每步实时决策 | 先制定完整计划再逐步执行 |
| 灵活性 | 高（随时调整） | 中（需要 replan） |
| Token 效率 | 低（每步重传历史） | 高（计划阶段一次性） |
| 适合任务 | 探索性、不确定性高 | 结构化、步骤明确 |
| 错误恢复 | 自然（下一步调整） | 需要显式 replan |
| 代表系统 | LangChain ReAct Agent | Claude Code、BabyAGI |

#### Plan-and-Execute 流程

```
1. [Planner] 分析任务，生成步骤列表：
   Step 1: 搜索相关代码文件
   Step 2: 分析 Bug 原因
   Step 3: 编写修复代码
   Step 4: 运行测试验证

2. [Executor] 逐步执行：
   执行 Step 1 → 结果
   执行 Step 2 → 结果
   ...

3. [Replanner] 如果某步失败，重新规划剩余步骤
```

#### 实际选择

**生产建议**：多数 Coding Agent（如 Claude Code）使用混合模式——先做高层规划，执行时用 ReAct 风格处理每一步的不确定性。

</details>

---

### Q4: Harness Engineering 模式

<details>
<summary>参考答案</summary>

**Claude Code 开创的模式：Agent 不是独立程序，而是运行在受控 Harness（宿主环境）中的 LLM。Harness 提供工具、权限、上下文、安全边界。**

#### 核心架构

```
┌────────────────────────────────────────────┐
│  Harness（宿主环境）                         │
│                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │系统提示词 │ │工具注册表│ │权限系统   │   │
│  │(CLAUDE.md)│ │(文件/终端)│ │(分级审批)│   │
│  └──────────┘ └──────────┘ └──────────┘   │
│                                            │
│  ┌────────────────────────────────────┐    │
│  │  LLM Agent（核心推理循环）          │    │
│  │  - 接收上下文                       │    │
│  │  - 选择工具                         │    │
│  │  - 生成行动                         │    │
│  └────────────────────────────────────┘    │
│                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │沙箱隔离  │ │审计日志  │ │资源限制   │   │
│  └──────────┘ └──────────┘ └──────────┘   │
└────────────────────────────────────────────┘
```

#### 关键组件

1. **上下文注入**：CLAUDE.md 项目配置 → 系统提示词，让 Agent 理解项目规范
2. **工具集**：文件读写、终端执行、搜索等预定义工具（agent 不能自定义工具）
3. **权限系统**：只读 → 写入 → 执行 → 网络，分级控制
4. **沙箱隔离**：限制文件系统和网络访问范围

#### vs 其他模式

| 维度 | Harness Engineering | Docker 沙箱（OpenHands） | 自主 Agent（AutoGPT） |
|------|--------------------|-----------------------|---------------------|
| 隔离方式 | 进程级 + 权限系统 | 容器级 | 无隔离 |
| 工具定义 | 宿主预定义 | Agent 自选 | Agent 自选 |
| 安全性 | 高（HITL + 权限） | 中（容器逃逸风险） | 低 |
| 灵活性 | 中（受限工具集） | 高 | 最高 |
| 可控性 | 最高 | 中 | 最低 |

</details>

---

### Q5: CLAUDE.md/AGENTS.md 解决的问题

<details>
<summary>参考答案</summary>

**解决 Agent 的"项目理解"问题——让 Agent 不需要从零学习项目规范，直接获得项目特有的知识和约束。**

#### 问题背景

Agent 面对一个新项目时，不知道：
- 用什么包管理器？npm 还是 pnpm？
- 测试命令是什么？怎么跑 lint？
- 代码规范是什么？命名约定？
- 目录结构怎么组织？

#### 解决方案

```markdown
# CLAUDE.md 示例
## 构建命令
- `npm run build` 构建项目
- `npm test` 运行测试
- `npm run lint` 代码检查

## 代码规范
- 使用 TypeScript strict 模式
- 文件命名用 kebab-case
- 组件命名用 PascalCase

## 架构约束
- 不要直接修改 generated/ 目录
- API 路由在 src/routes/ 下
```

#### 层级继承

```
项目根目录 CLAUDE.md → 全局规范（构建命令、代码风格）
  ↓ 继承
子目录 CLAUDE.md → 模块特有规范（如 frontend/ 用 React）
  ↓ 继承
AGENTS.md → Agent 特有指令（如"先运行测试再提交"）
```

#### 面试追问

- **与 .editorconfig/.eslintrc 的区别**？后者是工具配置，CLAUDE.md 是给 AI Agent 的自然语言指令
- **如何避免 CLAUDE.md 过大**？渐进式披露——主文件精简，详细规范放子目录

</details>

---

### Q6: 解决上下文窗口限制

<details>
<summary>参考答案</summary>

**四种策略：渐进式加载、滑动窗口摘要、外部记忆检索、分层上下文管理。**

#### 问题

128K token 上下文看似很大，但一个 Agent 执行 20 步后，历史消息 + 工具返回 + 文件内容很容易超限。

#### 策略对比

| 策略 | 原理 | 适用场景 |
|------|------|---------|
| 渐进式加载 | 只在需要时加载文件内容 | 代码阅读 |
| 滑动窗口摘要 | 将旧消息摘要压缩 | 长对话 |
| 外部记忆（RAG） | 向量数据库存储/检索 | 知识密集任务 |
| 分层管理 | 系统提示词 > 近期消息 > 工具结果 | 通用 |

#### Claude Code 的实践

```
上下文预算分配：
  系统提示词（CLAUDE.md 等）：~10K tokens（固定）
  最近 5 轮对话：~20K tokens（保留）
  工具返回结果：~30K tokens（最新的）
  文件内容：按需加载，超限时摘要
  
  总预算：~100K / 200K tokens
  
自动压缩：
  当上下文达到 80% 时，将早期对话摘要为 1-2 段
```

#### 面试追问

- **摘要压缩会丢失关键信息吗**？会。解决方案：对关键信息打标签（pin），压缩时保留 pin 的内容
- **Gemini 1M 上下文解决了这个问题吗**？部分解决，但更长上下文 = 更高延迟 + 更高成本 + 注意力稀释（Lost in the Middle）

</details>

---

### Q7: 多 Agent 拓扑结构

<details>
<summary>参考答案</summary>

**Hub-Spoke 适合管理型任务，Pipeline 适合流水线型任务，Peer-to-Peer 适合协作型任务。**

#### 三种拓扑

```
Hub-Spoke（中心辐射）：          Pipeline（流水线）：         P2P（对等网络）：
      ┌─ Agent A               Agent A → Agent B           Agent A ↔ Agent B
Hub ──┼─ Agent B               → Agent C → Agent D         Agent B ↔ Agent C  
      └─ Agent C                                           Agent A ↔ Agent C
```

#### 详细对比

| 维度 | Hub-Spoke | Pipeline | Peer-to-Peer |
|------|-----------|----------|-------------|
| 协调方式 | 中心 Agent 分配任务 | 按顺序传递 | 自主协商 |
| 适用场景 | 任务分解+汇总 | ETL/多阶段处理 | 头脑风暴/辩论 |
| 复杂度 | 中 | 低 | 高 |
| 瓶颈 | Hub 单点 | 最慢的 Stage | 消息爆炸 |
| 容错 | Hub 故障全停 | 某 stage 故障后续停 | 部分节点故障可继续 |
| 代表系统 | Claude Code (sub-agents) | CI/CD pipeline | CrewAI debate |

#### 实际选型建议

```
需要任务分解和汇总？ → Hub-Spoke（如 Claude Code 的 task agent）
有明确的多阶段流程？ → Pipeline（如 代码→Review→测试→部署）
需要多角度讨论？ → P2P（如 AI 辩论、多角色协作）
```

</details>

---

### Q8: 防止 Agent 无限循环

<details>
<summary>参考答案</summary>

**多层防御：步数上限 + 重复检测 + 进展判断 + 超时机制。**

#### 常见循环模式

```
❌ 模式1：相同错误重复
  Action: run_test() → Fail
  Action: run_test() → Fail  ← 不修改代码就重跑
  Action: run_test() → Fail
  
❌ 模式2：来回修改
  Action: edit(file, change A)
  Action: edit(file, change B)  ← 撤销了 A
  Action: edit(file, change A)  ← 又改回来
  
❌ 模式3：无效搜索
  Action: search("foo")
  Action: search("foo bar")
  Action: search("bar foo")  ← 搜索词无实质变化
```

#### 防御策略

| 策略 | 实现 | 触发条件 |
|------|------|---------|
| 步数上限 | `max_steps = 25` | 超过就强制终止 |
| 重复检测 | 检测连续相同 Action | 连续 3 次相同 → 终止 |
| 进展判断 | 检查是否有新信息获取 | 5 步无进展 → 请求人工介入 |
| 超时 | 总执行时间限制 | 超过 10 分钟 → 终止 |
| 预算限制 | Token/cost 上限 | 累计消耗超限 → 终止 |

#### 面试追问

- **终止后如何恢复**？保存 Agent 的当前状态（上下文、已完成的步骤），人工介入后可以从断点继续
- **Claude Code 如何处理**？通过 Harness 的步数限制 + 用户确认机制

</details>

---

### Q9: Coding Agent 工具权限体系

<details>
<summary>参考答案</summary>

**分级权限 + 白名单工具 + HITL 审批，确保 Agent 在安全边界内工作。**

#### 权限层级设计

```
Level 0 - 只读（无风险）：
  ✅ read_file, search, list_directory, git_log
  
Level 1 - 写入（低风险）：
  ✅ edit_file, create_file（仅工作目录内）
  🔒 需要首次确认

Level 2 - 执行（中风险）：
  ✅ run_test, run_lint, run_build
  🔒 命令白名单 + 沙箱执行

Level 3 - 系统操作（高风险）：
  ✅ git_commit, git_push, create_pr
  🔒 每次都需要人工确认

Level 4 - 网络/部署（最高风险）：
  ✅ curl, deploy, npm_publish
  🔒 明确授权 + 审计日志 + 确认对话框
```

#### 命令安全校验

```python
BLOCKED_PATTERNS = [
    r"rm\s+-rf\s+/",     # 危险删除
    r">\s*/etc/",         # 系统文件覆写
    r"chmod\s+777",       # 危险权限
    r"curl.*\|.*sh",      # 远程代码执行
    r"sudo\s+",           # 提权
]

def validate_command(cmd: str) -> bool:
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, cmd):
            return False
    return True
```

</details>

---

### Q10: Claude Code vs Codex CLI vs OpenHands 架构对比

<details>
<summary>参考答案</summary>

**三者代表了三种不同的 Agent 架构哲学：Harness 控制型、轻量终端型、Docker 沙箱型。**

#### 架构对比

| 维度 | Claude Code | Codex CLI | OpenHands |
|------|------------|-----------|-----------|
| 架构哲学 | Harness Engineering | 轻量终端 Agent | Docker 沙箱 Agent |
| 运行环境 | 本地进程 + 权限系统 | 本地终端 + 网络沙箱 | Docker 容器 |
| 模型 | Claude (Anthropic) | GPT-4o/o3 (OpenAI) | 任意模型 |
| 工具系统 | 预定义工具集 | Shell 命令 | Shell + Browser |
| 安全模型 | 分级权限 + HITL | 网络隔离 + 只读默认 | 容器隔离 |
| 上下文管理 | CLAUDE.md + 渐进加载 | 文件系统快照 | Docker volume |
| 多 Agent | Sub-agents (task) | 无 | 有 (delegate) |
| 适用场景 | 复杂项目开发 | 快速代码修改 | 自动化 SWE 任务 |

#### 安全模型深度对比

```
Claude Code: Harness 权限控制
  → 文件操作需确认
  → 命令执行需授权
  → 网络访问受限

Codex CLI: 网络隔离为主
  → 默认无网络访问
  → 读写文件默认只读
  → full-auto 模式需显式开启

OpenHands: Docker 容器隔离
  → 独立文件系统
  → 可安装任意工具
  → 容器销毁后清理
```

#### 面试追问

- **哪个性能最好**？SWE-bench 上 Claude Code 和 OpenHands 各有优势，Codex CLI 更轻量但能力有限
- **生产环境推荐哪个**？取决于安全需求：严格安全选 Claude Code，灵活性选 OpenHands

</details>

---

### Q11: 评估 Agent 系统可靠性

<details>
<summary>参考答案</summary>

**从任务成功率、步骤效率、安全合规、用户满意度四个维度评估。**

#### 评估框架

| 维度 | 指标 | 测量方式 |
|------|------|---------|
| 任务成功率 | 完成率、正确率 | SWE-bench / 内部评估集 |
| 步骤效率 | 平均步数、Token 消耗 | 日志统计 |
| 安全合规 | 越权次数、危险操作 | 审计日志分析 |
| 用户满意度 | 接受率、修改率 | 用户行为追踪 |

#### 关键指标

```
核心指标：
  Task Success Rate = 成功完成的任务 / 总任务数
  First-Try Success Rate = 一次成功 / 总任务数（不需要人工干预）
  
效率指标：
  Avg Steps per Task = 平均每个任务的 Agent 步数
  Avg Token Cost = 平均每个任务的 Token 消耗
  
安全指标：
  Unsafe Action Rate = 触发安全限制的次数 / 总操作数
  Escape Rate = 突破沙箱/权限的次数（应该为 0）
```

#### 评估方法

1. **基准测试集**：用 SWE-bench、HumanEval 等标准测试集
2. **回归测试**：每次 Agent 更新后运行标准测试集
3. **A/B 测试**：新旧版本在相同任务上对比
4. **生产监控**：持续追踪真实用户的成功率和满意度

</details>

---

### Q12: 自动修复 GitHub Issue 的 Agent 系统

<details>
<summary>参考答案</summary>

**端到端设计：Issue 触发 → 代码分析 → 修复规划 → 沙箱执行 → 测试验证 → PR 创建 → 人工审核。**

#### 系统架构

```
GitHub Webhook
     ↓
┌──────────────────────────────────────────┐
│  Issue 分析 Agent                         │
│  - 解析 Issue 描述                        │
│  - 检索相关代码（RAG）                    │
│  - 判断是否可自动修复                     │
│  - 评估复杂度和风险等级                   │
└──────────────┬───────────────────────────┘
               ↓ 可修复
┌──────────────────────────────────────────┐
│  规划 Agent（Plan-and-Execute）            │
│  - 制定修复方案                           │
│  - 确定需要修改的文件                     │
│  - 预估影响范围                           │
└──────────────┬───────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│  执行 Agent（沙箱环境）                    │
│  - 修改代码                               │
│  - 运行测试                               │
│  - 修复测试失败（最多 3 轮）              │
└──────────────┬───────────────────────────┘
               ↓ 测试通过
┌──────────────────────────────────────────┐
│  PR 创建                                  │
│  - 生成 PR 描述（引用 Issue）             │
│  - 请求 Code Owner 审查                  │
│  - 通知 Issue 创建者                      │
└──────────────────────────────────────────┘
```

#### 关键设计决策

1. **可修复性判断**：不是所有 Issue 都应该自动修复。Bug report + 有复现步骤 + 涉及代码量小 → 适合自动修复
2. **沙箱执行**：Docker 容器中修改代码 + 运行测试，防止破坏环境
3. **质量门禁**：测试通过 + lint 通过 + diff 大小限制（<500 行）
4. **人工审核**：永远不直接合并，创建 PR 等待审核

#### 评估指标

- **SWE-bench 式评估**：准备标准 Issue 集，测量修复成功率
- **目标**：简单 Bug 80%+ 成功率，中等 Bug 40-60%

</details>
