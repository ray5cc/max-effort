# 07-LLM 基础 — 技术资料

> 覆盖大语言模型（LLM）的核心原理与技术基础，从 Transformer 架构到推理引擎，从微调技术到对齐训练。

## 相关链接

- 对应面试指南：[07-LLM基础面试](../../02-面试指南/07-LLM基础面试/)

## 文档列表

| 序号 | 文件名 | 覆盖技术知识点 | 关联面试题 |
|------|--------|---------------|-----------|
| 01 | [01-LLM原理.md](./01-LLM原理.md) | Transformer架构/Self-Attention推导/RoPE/ALiBi/BPE/Scaling Laws/解码策略/MoE架构/推理模型/多模态/长上下文 | [面试题](../../02-面试指南/07-LLM基础面试/01-LLM原理面试题.md) |
| 02 | [02-Prompt工程.md](./02-Prompt工程.md) | PromptTemplate/CoT/ReAct/ToT/Self-Consistency/Reflexion/结构化输出/Prompt Injection防御 | [面试题](../../02-面试指南/07-LLM基础面试/02-Prompt工程面试题.md) |
| 03 | [03-Transformers与模型架构.md](./03-Transformers与模型架构.md) | RMSNorm/RoPE/GQA/KV Cache/FlashAttention/量化/投机解码/开源模型全景图/代码模型对比/模型选型指南 | [面试题](../../02-面试指南/07-LLM基础面试/03-Transformers与模型架构面试题.md) |
| 04 | [04-深度学习框架与计算图.md](./04-深度学习框架与计算图.md) | 计算图/自动微分/Eager vs 图执行/TensorFlow工程实践/PyTorch深度解析(Autograd/torch.compile/DDP/FSDP) | [面试题](../../02-面试指南/07-LLM基础面试/04-深度学习框架面试题.md) |
| 05 | [05-LLM推理引擎架构.md](./05-LLM推理引擎架构.md) | PagedAttention/RadixAttention/Continuous Batching/Chunked Prefill/量化技术/推测解码/分布式推理/结构化输出 | [面试题](../../02-面试指南/07-LLM基础面试/05-LLM推理引擎面试题.md) |
| 06 | [06-LLM微调技术.md](./06-LLM微调技术.md) | LoRA/QLoRA/RLHF/DPO/GRPO/分布式微调/数据策展管线/端到端实战/评估体系 | [面试题](../../02-面试指南/07-LLM基础面试/06-LLM微调技术面试题.md) |
| 07 | [07-参数高效微调PEFT.md](./07-参数高效微调PEFT.md) | LoRA 数学原理/QLoRA/Adapter/Prefix Tuning/PEFT 生态 | [面试题](../../02-面试指南/07-LLM基础面试/07-PEFT面试题.md) |
| 08 | [08-对齐训练技术TRL.md](./08-对齐训练技术TRL.md) | RLHF/PPO/DPO/GRPO/SFT/奖励模型/TRL 参考实现 | [面试题](../../02-面试指南/07-LLM基础面试/08-TRL面试题.md) |

## 与 08-AI-Agent全栈工程 的关系

| 07-LLM基础 | 08-AI-Agent全栈工程 |
|------------|---------------------|
| 侧重 LLM **原理与基础知识** | 侧重 AI Agent **生产工程实践** |
| Transformer 架构、注意力机制 | LLM 推理引擎部署与优化 |
| 微调原理（LoRA/DPO/RLHF） | 微调工程（数据/评估/部署上线） |
| 推理引擎架构原理 | 推理服务运维与扩展 |
| Prompt 工程技巧 | Agent 架构设计与全链路工程 |

> 💡 07 是"知其然"（理论基础），08 是"知其所以然"并能"做出来"（工程实践）。面试中需要两者结合。

## 说明

- 每篇文档聚焦于 LLM 相关的**核心原理与基础知识**
- 工程化实践内容（Agent 架构、RAG 工程化、网关、对话系统等）已整合至 [08-AI-Agent全栈工程](../08-AI-Agent全栈工程/)

## 导航

- ← [技术资料总目录](../)
- ↔ [对应面试指南](../../02-面试指南/07-LLM基础面试/)
