# AGENTS.md — AI Agent 入口（精简目录）

> **Harness Engineering 规范**：本文件保持精简，作为 AI Agent 的快速导航入口。
> 详细操作规范请参阅 [`docs/operations.md`](./docs/operations.md)，避免上下文窗口拥塞。

## 关键资源（优先阅读）

| 资源 | 说明 |
|------|------|
| [`llms.txt`](./llms.txt) | 项目全局结构，AI 工具入口 |
| [`CLAUDE.md`](./CLAUDE.md) | 协作规范与技术分类（含记忆系统指南） |
| [`docs/operations.md`](./docs/operations.md) | 详细操作规范：命名、目录更新、日志格式 |
| [`README.md`](./README.md) | 项目背景与整体介绍 |

## 项目结构速览

```
max-effort/
├── AGENTS.md               # AI Agent 入口（本文件，精简 TOC）
├── README.md               # 项目概览
├── CLAUDE.md               # 协作规范（含记忆系统最佳实践）
├── llms.txt                # llms.txt 规范
├── docs/                   # 详细规范文档（渐进式披露）
│   └── operations.md       # 操作规范详情
├── CHANGELOG/              # 操作记录
├── 01-技术资料/             # 技术学习文档（共 7 个分类）
└── 02-面试指南/             # 面试题目与解析（共 7 个分类）
```

> 完整目录树见 [`docs/operations.md`](./docs/operations.md#目录结构总览)

## 核心约束（机械化强制执行）

每次修改文件后，Agent **必须**执行以下检查：

- [ ] 子目录 `README.md` 已更新
- [ ] 根 `llms.txt` 已更新
- [ ] `CHANGELOG/YYYY-MM.md` 已追加记录
- [ ] `01-技术资料` 与 `02-面试指南` 的对应分类保持同步

## 架构边界（不可违反）

1. **序号连续**：文件夹和文档均以 `NN-` 开头，编号不可跳跃
2. **分类对应**：两大目录的 `NN` 编号一一对应，不可单独新增
3. **相对路径**：所有文档内链接必须使用相对路径
4. **渐进披露**：`AGENTS.md` 保持精简；大量细节放入 `docs/` 子目录

## 记忆与上下文管理

本项目遵循以下上下文策略（参考 Claude Memory 最佳实践）：

- **上下文内记忆**：优先使用 `llms.txt` + `AGENTS.md` 快速定位，避免一次性加载全量文档
- **外部检索**：通过分类目录的 `README.md` 渐进式获取所需技术资料或面试题
- **Skills 模式**：各分类目录下的 `README.md` 充当"技能模块"，按需加载，不全量注入上下文
