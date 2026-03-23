import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Max Effort — AI Agent 全栈开发知识库","description":"","frontmatter":{},"headers":[],"relativePath":"README.md","filePath":"README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="max-effort-—-ai-agent-全栈开发知识库" tabindex="-1">Max Effort — AI Agent 全栈开发知识库 <a class="header-anchor" href="#max-effort-—-ai-agent-全栈开发知识库" aria-label="Permalink to &quot;Max Effort — AI Agent 全栈开发知识库&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>覆盖 AI Agent 全链路开发知识（LLM 原理 → Prompt 工程 → 工具调用 → 记忆系统 → Agent 框架 → 后端服务 → 前端渲染 → 评测部署），同时提供前端、后端、数据库、算法、系统设计、DevOps 等核心领域的技术资料与面试指南。</p></blockquote><h2 id="项目简介" tabindex="-1">项目简介 <a class="header-anchor" href="#项目简介" aria-label="Permalink to &quot;项目简介&quot;">&amp;ZeroWidthSpace;</a></h2><p>本项目分为两大根目录，内容分类一一对应，支持相互跳转：</p><table tabindex="0"><thead><tr><th>目录</th><th>说明</th></tr></thead><tbody><tr><td><a href="./01-技术资料/">01-技术资料</a></td><td>各技术领域的系统性学习文档</td></tr><tr><td><a href="./02-面试指南/">02-面试指南</a></td><td>对应领域的面试题目、解题思路与高频考点</td></tr></tbody></table><h2 id="技术分类" tabindex="-1">技术分类 <a class="header-anchor" href="#技术分类" aria-label="Permalink to &quot;技术分类&quot;">&amp;ZeroWidthSpace;</a></h2><p>两大目录均按以下分类组织，分类编号一一对应：</p><ol><li><strong>前端</strong> — React/JavaScript/TypeScript/Next.js/状态管理/浏览器原理</li><li><strong>后端</strong> — Java/Go/Python/Node.js/微服务/网络协议</li><li><strong>数据库</strong> — Redis/PostgreSQL/MySQL/MongoDB/Elasticsearch/向量数据库</li><li><strong>算法与数据结构</strong> — 排序搜索/动态规划/图算法/基础数据结构</li><li><strong>系统设计</strong> — 分布式系统/消息队列/LLM推理引擎/分布式训练</li><li><strong>DevOps 与云计算</strong> — Docker/Kubernetes/CI-CD/GitOps</li><li><strong>AI Agent 全栈开发</strong> — LLM 原理/Prompt 工程/RAG/Agent 框架/微调/多Agent/流式渲染</li><li><strong>编码题</strong> — 编码技巧与解题策略、各领域手写代码实战</li></ol><h2 id="使用说明" tabindex="-1">使用说明 <a class="header-anchor" href="#使用说明" aria-label="Permalink to &quot;使用说明&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>每个目录下包含一个 <code>README.md</code> 总目录文件，列出所有子文档的链接与描述</li><li>文件夹和文件均以序号开头，保持有序</li><li>技术资料与面试指南的分类相互对应，方便对照学习与备考</li></ul><h2 id="ai-工具接入" tabindex="-1">AI 工具接入 <a class="header-anchor" href="#ai-工具接入" aria-label="Permalink to &quot;AI 工具接入&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li><a href="./AGENTS.html"><code>AGENTS.md</code></a> — AI Agent 精简入口（TOC 式，Harness Engineering 规范）</li><li><a href="./.agent-docs/operations.html"><code>.agent-docs/operations.md</code></a> — 详细操作规范（渐进式披露）</li><li><a href="./llms.txt"><code>llms.txt</code></a> — 符合 llms.txt 规范，供 AI 工具快速理解项目结构</li><li><a href="./CLAUDE.html"><code>CLAUDE.md</code></a> — Claude AI 助手协作指南（含记忆系统最佳实践）</li></ul><h2 id="操作记录" tabindex="-1">操作记录 <a class="header-anchor" href="#操作记录" aria-label="Permalink to &quot;操作记录&quot;">&amp;ZeroWidthSpace;</a></h2><p>变更日志存放于 <a href="./CHANGELOG/"><code>CHANGELOG/</code></a> 目录，按月份分文件记录。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
