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

### Q4: Harness Engineering 模式

**核心要点**：

Claude Code 开创的模式。核心理念：Agent 不是独立运行的程序，而是运行在受控 Harness（宿主环境）中的 LLM。

Harness 提供：
1. **上下文注入**：CLAUDE.md 项目配置 → 系统提示词
2. **工具集**：文件读写、终端执行、搜索等预定义工具
3. **权限系统**：分级权限（只读 → 写入 → 执行 → 网络）
4. **沙箱隔离**：限制 Agent 的文件系统和网络访问范围

**面试追问**：这种模式相比 OpenHands 的 Docker 沙箱模式有什么优劣？

### Q12: 自动修复 GitHub Issue 的 Agent

**设计方案**：
1. **触发**：监听 GitHub Webhook，Issue 创建时触发
2. **分析**：Agent 读取 Issue 描述，检索相关代码
3. **规划**：制定修复方案（Plan-and-Execute）
4. **执行**：在沙箱中修改代码、运行测试
5. **验证**：所有测试通过后创建 PR
6. **人工审核**：通知代码 Owner 审查 PR
7. **指标**：SWE-bench 式评估修复成功率
