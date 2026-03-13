# 10-AI-CLI与代码Agent — 技术资料

> 深入讲解 AI 驱动的命令行工具（CLI Agent）与代码生成 Agent 的架构设计、工具调用机制和安全沙箱实现，涵盖 Google Gemini CLI、OpenAI Codex CLI 和浏览器自动化 Agent（browser-use），帮助开发者构建实用的 AI 自动化工具。

## 目录

- [1. 概述](#1-概述)
- [2. Gemini CLI 架构解析](#2-gemini-cli-架构解析)
  - [2.1 整体架构](#21-整体架构)
  - [2.2 工具调用机制](#22-工具调用机制)
  - [2.3 沙箱与安全机制](#23-沙箱与安全机制)
- [3. OpenAI Codex CLI](#3-openai-codex-cli)
  - [3.1 架构设计](#31-架构设计)
  - [3.2 审批模式](#32-审批模式)
  - [3.3 代码生成 Agent 核心逻辑](#33-代码生成-agent-核心逻辑)
- [4. browser-use：浏览器自动化Agent](#4-browser-use浏览器自动化agent)
  - [4.1 架构原理](#41-架构原理)
  - [4.2 DOM 感知与行动空间](#42-dom-感知与行动空间)
  - [4.3 实战示例](#43-实战示例)
- [5. CLI Agent 架构对比](#5-cli-agent-架构对比)
- [6. 安全沙箱深度解析](#6-安全沙箱深度解析)
- [7. 自建 CLI Agent 指南](#7-自建-cli-agent-指南)
- [8. 最佳实践](#8-最佳实践)
- [导航](#导航)

---

## 1. 概述

### 1.1 什么是 CLI Agent

**CLI Agent（命令行 Agent）** 是能够在终端环境中自主执行任务的 AI 程序，区别于聊天机器人的核心在于：

| 特性 | 聊天机器人 | CLI Agent |
|------|-----------|----------|
| 执行能力 | 只能生成文本 | 可执行命令、修改文件、调用 API |
| 环境感知 | 无 | 能读取文件系统、环境变量、进程状态 |
| 副作用 | 无 | 会真实改变系统状态 |
| 安全要求 | 低 | **极高**（需沙箱隔离） |

### 1.2 核心能力

一个完整的 CLI Agent 具备以下核心能力：

```
用户输入（自然语言）
        │
   ┌────▼────┐
   │ LLM 核心 │  ← 理解意图、规划步骤
   └────┬────┘
        │ 工具调用
   ┌────▼──────────────────┐
   │      工具集            │
   ├──── 文件系统工具 ───────┤  读写文件、创建目录
   ├──── Shell 执行工具 ─────┤  执行命令、获取输出
   ├──── 代码分析工具 ───────┤  语法检查、测试运行
   ├──── 网络工具 ──────────┤  HTTP 请求、API 调用
   └──── 搜索工具 ──────────┘  代码搜索、文档查询
        │ 观测结果
   ┌────▼────┐
   │ 结果整合 │  ← 分析执行结果，决定下一步
   └─────────┘
```

---

## 2. Gemini CLI 架构解析

> 项目参考：[google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)

Gemini CLI 是 Google 发布的开源命令行 AI 工具，使用 Gemini 2.5 Pro 模型，支持 **100 万 Token 上下文**，可处理整个代码仓库。

### 2.1 整体架构

```
Gemini CLI 核心架构
┌─────────────────────────────────────────────────┐
│                  CLI 入口（Node.js）              │
│  命令解析 │ REPL 交互 │ 流式输出 │ 会话管理       │
└─────────────────────────┬───────────────────────┘
                          │
┌─────────────────────────▼───────────────────────┐
│                  GeminiClient                    │
│  API 封装 │ 流式处理 │ 工具调用调度 │ 错误重试     │
└─────────────────────────┬───────────────────────┘
                          │
                    ┌─────┼──────┐
                    │     │      │
             ┌──────▼──┐ ┌▼──────┐ ┌▼─────────┐
             │文件系统工具│ │Shell  │ │内置工具   │
             │read_file │ │execute│ │web_fetch │
             │write_file│ │_bash  │ │glob_files│
             └─────────┘ └───────┘ └──────────┘
```

**技术栈：**
- 语言：TypeScript（Node.js 运行时）
- LLM：Gemini 2.5 Pro / Flash（通过 Google AI API）
- UI：React + Ink（终端 UI 框架）
- 工具：内置 14 种核心工具

### 2.2 工具调用机制

Gemini CLI 的工具通过 **Function Calling** 机制实现。以 `read_file` 工具为例：

```typescript
// 工具定义（来自 gemini-cli 源码）
const readFileTool: Tool = {
  name: "read_file",
  description: "读取指定路径的文件内容",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "文件的绝对或相对路径",
      },
      offset: {
        type: "number",
        description: "从第几行开始读取（可选）",
      },
      limit: {
        type: "number",
        description: "最多读取多少行（可选）",
      },
    },
    required: ["path"],
  },
};

// 工具执行器
async function executeReadFile(params: {
  path: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  const { path, offset = 0, limit } = params;
  const absolutePath = resolvePath(path);
  
  // 安全检查：确保路径在工作目录内
  if (!isPathSafe(absolutePath)) {
    throw new Error(`路径超出允许范围: ${path}`);
  }
  
  const content = await fs.readFile(absolutePath, "utf-8");
  const lines = content.split("\n");
  return lines.slice(offset, limit ? offset + limit : undefined).join("\n");
}
```

**工具调用循环（ReAct 模式）：**

```typescript
async function runAgentLoop(userMessage: string): Promise<string> {
  const messages = [{ role: "user", content: userMessage }];
  
  while (true) {
    // 1. 调用 Gemini API（附带工具定义）
    const response = await geminiClient.generateContent({
      contents: messages,
      tools: allTools,
    });
    
    // 2. 检查是否有工具调用
    if (response.toolCalls?.length > 0) {
      const toolResults = [];
      for (const toolCall of response.toolCalls) {
        // 3. 执行工具
        const result = await executeTool(toolCall.name, toolCall.args);
        toolResults.push({ toolCallId: toolCall.id, result });
        console.log(`🔧 ${toolCall.name}(${JSON.stringify(toolCall.args)}) → ${result}`);
      }
      // 4. 将工具结果加入对话历史
      messages.push({ role: "model", content: response.text, toolCalls: response.toolCalls });
      messages.push({ role: "tool", toolResults });
    } else {
      // 5. 无工具调用，返回最终答案
      return response.text;
    }
  }
}
```

### 2.3 沙箱与安全机制

Gemini CLI 的安全设计遵循 **最小权限原则**：

```
Gemini CLI 安全层次
┌───────────────────────────────────────────────┐
│              用户审批层（可选）                  │
│  危险操作（删除文件、执行脚本）需用户确认         │
├───────────────────────────────────────────────┤
│              路径沙箱层                         │
│  所有文件操作限制在 --project-dir 目录内          │
├───────────────────────────────────────────────┤
│              命令过滤层                         │
│  黑名单命令（rm -rf /、dd 等）直接拒绝           │
├───────────────────────────────────────────────┤
│              进程隔离层                         │
│  Shell 命令在子进程中执行，有超时限制             │
└───────────────────────────────────────────────┘
```

```typescript
// 命令执行安全检查（简化版）
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,          // 删除根目录
  /dd\s+if=.+of=\/dev/,     // 覆盖块设备
  />\s*\/dev\/sd/,           // 写入磁盘设备
  /chmod\s+777\s+\//,        // 修改系统权限
];

function isSafeCommand(command: string): boolean {
  return !DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

async function executeShell(command: string, options: ExecOptions) {
  if (!isSafeCommand(command)) {
    throw new SecurityError(`拒绝执行危险命令: ${command}`);
  }
  
  return new Promise((resolve, reject) => {
    const proc = exec(command, {
      cwd: options.workingDir,
      timeout: 30000,  // 30 秒超时
      maxBuffer: 1024 * 1024 * 10,  // 10MB 输出限制
    }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}
```

---

## 3. OpenAI Codex CLI

> 项目参考：[openai/codex](https://github.com/openai/codex)

OpenAI Codex CLI 是面向开发者的代码 Agent，特点是高度关注**代码理解与生成**，以及灵活的**审批模式**。

### 3.1 架构设计

```
Codex CLI 架构
┌─────────────────────────────────────────────┐
│               CLI 层（React + Ink）          │
│  交互式 REPL │ 流式输出 │ 差异对比视图        │
└──────────────────────────┬──────────────────┘
                           │
┌──────────────────────────▼──────────────────┐
│               Agent 核心                     │
│  ┌──────────────────────────────────┐        │
│  │  系统 Prompt（含文件树、Git状态）  │        │
│  └──────────────────────────────────┘        │
│  工具调用循环（Function Calling）              │
└──────────────────────────┬──────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼───┐       ┌──────▼──┐      ┌──────▼──┐
    │shell工具│       │patch工具 │      │文件系统  │
    │执行命令 │       │应用diff  │      │读写文件  │
    └────────┘       └─────────┘      └─────────┘
```

### 3.2 审批模式

Codex CLI 提供三种审批模式，平衡自动化与安全性：

| 模式 | 说明 | 风险级别 | 适用场景 |
|------|------|---------|---------|
| `suggest` | 只建议，不执行（默认） | 无风险 | 探索性使用 |
| `auto-edit` | 自动编辑文件，命令需审批 | 低风险 | 日常开发 |
| `full-auto` | 全自动执行，无需确认 | **高风险** | CI/CD 自动化（需隔离环境） |

```bash
# 不同模式的使用方式
codex "重构这个函数，提高可读性"                    # suggest 模式（默认）
codex --approval-mode auto-edit "添加错误处理"      # auto-edit 模式
codex --approval-mode full-auto "运行所有测试"      # full-auto 模式（危险！）
```

### 3.3 代码生成 Agent 核心逻辑

```typescript
// Codex CLI Agent 的系统提示构建（简化版）
async function buildSystemPrompt(workDir: string): Promise<string> {
  const fileTree = await getFileTree(workDir, { maxDepth: 3 });
  const gitStatus = await getGitStatus(workDir);
  const recentCommits = await getRecentCommits(workDir, 5);
  
  return `你是一个代码 Agent，在以下项目环境中工作：

## 项目结构
\`\`\`
${fileTree}
\`\`\`

## Git 状态
\`\`\`
${gitStatus}
\`\`\`

## 最近提交记录
${recentCommits}

## 可用工具
- shell: 执行 Shell 命令（需审批）
- apply_patch: 应用 unified diff 格式的代码修改
- read_file: 读取文件内容
- write_file: 写入文件内容

## 行为准则
- 修改代码前先阅读相关文件
- 使用 apply_patch 而非直接 write_file（便于审查）
- 运行测试验证修改正确性
- 保持代码风格与项目一致`;
}
```

**Patch 工具（unified diff 格式）：**

```typescript
// apply_patch 工具使用示例（模型生成的调用）
const patchCall = {
  tool: "apply_patch",
  args: {
    patch: `--- a/src/utils.py
+++ b/src/utils.py
@@ -10,7 +10,12 @@
 def process_data(data):
-    return data.strip()
+    if not isinstance(data, str):
+        raise TypeError(f"Expected str, got {type(data).__name__}")
+    result = data.strip()
+    if not result:
+        raise ValueError("Data cannot be empty after stripping")
+    return result`
  }
};
```

---

## 4. browser-use：浏览器自动化Agent

> 项目参考：[browser-use/browser-use](https://github.com/browser-use/browser-use)

browser-use 是一个让 LLM 直接操控浏览器的 Agent 框架，核心思想是将网页 DOM 转化为 LLM 可理解的结构化信息。

### 4.1 架构原理

```
browser-use 工作原理

网页
  │ Playwright 自动化
  ▼
┌──────────────────────────────────────────┐
│          DOM 提取与结构化                  │
│  可交互元素 → 编号索引                     │
│  [1] 搜索框  [2] 提交按钮  [3] 链接...     │
└──────────────────────┬───────────────────┘
                       │ 结构化 DOM 文本
┌──────────────────────▼───────────────────┐
│                LLM 核心                   │
│  理解页面 → 决定操作 → 生成 Action         │
└──────────────────────┬───────────────────┘
                       │ Action 指令
┌──────────────────────▼───────────────────┐
│            浏览器控制层（Playwright）       │
│  click(index=2) │ type(index=1, "text")  │
│  navigate(url) │ scroll() │ screenshot() │
└──────────────────────────────────────────┘
```

### 4.2 DOM 感知与行动空间

browser-use 的关键创新是 **交互元素索引化**：

```python
# browser-use 内部：将 DOM 转为 LLM 可操作的格式
"""
当前页面：Google 搜索 (https://google.com)

可交互元素：
[1] <input> 搜索框 (id=search-input)
[2] <button> Google 搜索 (id=search-btn)  
[3] <button> 手气不错 (id=lucky-btn)
[4] <a> 关于 Google (href=/about)

当前 URL: https://google.com
页面标题: Google
"""

# LLM 的 Action 输出格式
action = {
    "action": "type",
    "index": 1,
    "text": "OpenAI GPT-4 最新进展"
}
# 然后：
action = {
    "action": "click", 
    "index": 2
}
```

**支持的 Action 类型：**

| Action | 说明 |
|--------|------|
| `click(index)` | 点击指定索引的元素 |
| `type(index, text)` | 在输入框输入文字 |
| `navigate(url)` | 导航到指定 URL |
| `scroll(direction, amount)` | 滚动页面 |
| `screenshot()` | 截图（用于多模态 LLM） |
| `extract_content(goal)` | 提取页面中特定信息 |
| `done(result)` | 任务完成，返回结果 |

### 4.3 实战示例

```python
from browser_use import Agent
from langchain_openai import ChatOpenAI

async def main():
    agent = Agent(
        task="在 GitHub 上搜索 'fastapi'，找到 star 数最多的仓库，提取其 README 的第一段",
        llm=ChatOpenAI(model="gpt-4o"),
        max_actions_per_step=5,
    )
    
    result = await agent.run()
    print(result.final_result())

# 更复杂的任务：自动填写表单
async def fill_form_example():
    agent = Agent(
        task="""
        1. 打开 https://example.com/register
        2. 填写用户名为 "test_user"
        3. 填写邮箱为 "test@example.com"  
        4. 不要提交表单，截图后返回
        """,
        llm=ChatOpenAI(model="gpt-4o"),
    )
    result = await agent.run()
```

**带自定义工具的 Agent：**

```python
from browser_use import Agent, Controller

controller = Controller()

@controller.action("保存文本到文件")
def save_to_file(text: str, filename: str):
    """将文本保存到本地文件"""
    with open(filename, "w", encoding="utf-8") as f:
        f.write(text)
    return f"已保存到 {filename}"

agent = Agent(
    task="搜索 Python 最佳实践文章，提取关键点并保存到 best_practices.txt",
    llm=ChatOpenAI(model="gpt-4o"),
    controller=controller,  # 注入自定义工具
)
```

---

## 5. CLI Agent 架构对比

| 维度 | Gemini CLI | Codex CLI | browser-use |
|------|-----------|----------|-------------|
| **执行环境** | 文件系统 + Shell | 文件系统 + Shell | 浏览器 DOM |
| **主要任务** | 通用编码助手 | 代码编写/重构 | 网页自动化 |
| **LLM** | Gemini 2.5 Pro | GPT-4o / o3 | 任意 LLM |
| **上下文大小** | 1M tokens（整仓库）| 适中 | 视页面大小 |
| **安全机制** | 路径沙箱 + 命令过滤 | 审批模式 | 浏览器隔离 |
| **开源许可** | Apache 2.0 | Apache 2.0 | MIT |
| **多模态** | 支持（Gemini Vision）| 不支持 | 支持截图输入 |
| **工具语言** | TypeScript | TypeScript | Python |

---

## 6. 安全沙箱深度解析

### 6.1 沙箱的核心目标

| 威胁类型 | 沙箱防护 |
|---------|---------|
| 提示注入（Prompt Injection） | 限制 Agent 可访问的范围，即使被注入也无法逃逸 |
| 误操作（Accidental Harm） | 危险操作需要用户审批 |
| 数据泄露 | 网络访问白名单，禁止上传敏感文件 |
| 权限提升 | 以最低权限用户运行 Agent |

### 6.2 Docker 沙箱（生产推荐）

```dockerfile
# Gemini CLI / Codex CLI Docker 沙箱示例
FROM node:20-slim

# 创建非 root 用户
RUN useradd -ms /bin/bash agent_user

# 仅挂载项目目录（只读基础层，读写工作目录）
VOLUME /workspace

# 网络限制（仅允许 LLM API）
# iptables -A OUTPUT -d api.openai.com -j ACCEPT
# iptables -A OUTPUT -j DROP

USER agent_user
WORKDIR /workspace

# 资源限制（防止资源耗尽攻击）
# 通过 docker run --memory=2g --cpus=2 --pids-limit=100 传入
```

```bash
# 启动沙箱 Agent
docker run \
  --rm \
  --memory=2g \
  --cpus=2 \
  --pids-limit=100 \
  --network=api-only \          # 仅允许访问 API 网络
  -v $(pwd):/workspace \
  -e OPENAI_API_KEY \
  codex-agent \
  "重构 src/utils.py，添加类型注解"
```

### 6.3 安全最佳实践

```python
# 最小权限工具集设计原则
SAFE_TOOLS = ["read_file", "list_dir", "search_code"]  # 只读，默认开放
SENSITIVE_TOOLS = ["write_file", "delete_file"]         # 写入，需审批
DANGEROUS_TOOLS = ["execute_shell", "network_request"]  # 执行，强制沙箱

class SafeAgent:
    def __init__(self, approval_mode="suggest"):
        self.approval_mode = approval_mode
        
    def can_execute_without_approval(self, tool_name: str) -> bool:
        if self.approval_mode == "full-auto":
            return tool_name not in DANGEROUS_TOOLS
        elif self.approval_mode == "auto-edit":
            return tool_name in SAFE_TOOLS
        else:  # suggest
            return False  # 所有工具都需要审批
```

---

## 7. 自建 CLI Agent 指南

### 最小可行 CLI Agent（Python 实现）

```python
#!/usr/bin/env python3
"""最小可行 CLI Agent 示例"""

import os
import subprocess
from openai import OpenAI

client = OpenAI()

# 工具定义
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取文件内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "执行 Shell 命令（会请求用户确认）",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的命令"}
                },
                "required": ["command"]
            }
        }
    }
]

def execute_tool(name: str, args: dict) -> str:
    if name == "read_file":
        try:
            with open(args["path"]) as f:
                return f.read()
        except Exception as e:
            return f"错误: {e}"
    
    elif name == "run_command":
        cmd = args["command"]
        # 安全：必须用户确认
        confirm = input(f"执行命令？ [{cmd}] (y/N): ")
        if confirm.lower() != "y":
            return "用户取消执行"
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            return result.stdout + result.stderr
        except Exception as e:
            return f"执行失败: {e}"

def run_agent(task: str):
    messages = [{"role": "user", "content": task}]
    
    while True:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto"
        )
        
        msg = response.choices[0].message
        messages.append(msg)
        
        if not msg.tool_calls:
            print(f"\nAgent: {msg.content}")
            break
        
        for tool_call in msg.tool_calls:
            import json
            args = json.loads(tool_call.function.arguments)
            result = execute_tool(tool_call.function.name, args)
            print(f"  🔧 {tool_call.function.name} → {result[:200]}...")
            
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })

if __name__ == "__main__":
    import sys
    task = " ".join(sys.argv[1:]) or input("请输入任务: ")
    run_agent(task)
```

---

## 8. 最佳实践

### CLI Agent 开发清单

- ✅ **沙箱隔离**：使用 Docker 或 chroot 隔离 Agent 运行环境
- ✅ **最小权限**：默认只读，写/执行权限需要明确开启
- ✅ **用户审批**：危险操作（删除、执行脚本）必须人工确认
- ✅ **操作日志**：记录所有工具调用，便于审计和调试
- ✅ **超时控制**：每个工具调用设置合理超时（通常 30 秒）
- ✅ **输出截断**：限制工具返回的内容大小（防止 Token 爆炸）
- ✅ **错误恢复**：工具失败时 Agent 应尝试替代方案，而非直接崩溃
- ✅ **干运行模式**：提供 `--dry-run` 选项，预览操作而不实际执行

### 常见陷阱

| 陷阱 | 描述 | 解决方案 |
|------|------|---------|
| 提示注入 | 恶意文件内容操控 Agent 行为 | 对文件内容进行清理，区分"数据"和"指令" |
| 无限循环 | Agent 反复尝试同一失败操作 | 设置最大步骤数（max_steps=50） |
| Token 爆炸 | 读取大文件撑满上下文 | 限制每次读取的行数（max_lines=200） |
| 权限蔓延 | Agent 自动安装包/修改系统配置 | 明确列出白名单操作 |

---

## 导航

- ← [09-多Agent系统](./09-多Agent系统.md)
- ← [技术资料总目录](../README.md)
- ↔ [对应面试题](../../02-面试指南/07-AI-Agent全栈开发面试/10-AI-CLI与代码Agent面试题.md)
- → [11-Transformers与模型架构](./11-Transformers与模型架构.md)
