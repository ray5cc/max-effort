import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"Max Effort","text":"AI Agent 全栈开发知识库","tagline":"覆盖 LLM 原理 → Prompt 工程 → 工具调用 → 记忆系统 → Agent 框架 → 后端服务 → 前端渲染 → 评测部署","actions":[{"theme":"brand","text":"📚 技术资料","link":"/01-技术资料/"},{"theme":"alt","text":"🎯 面试指南","link":"/02-面试指南/"},{"theme":"alt","text":"🤖 llms.txt","link":"https://github.com/ray5cc/max-effort/blob/main/llms.txt"}]},"features":[{"icon":"💻","title":"前端","details":"React / JavaScript / TypeScript / Next.js / 状态管理 / 浏览器原理"},{"icon":"⚙️","title":"后端","details":"Java / Go / Python / Node.js / 微服务 / 网络协议"},{"icon":"🗄️","title":"数据库","details":"Redis / PostgreSQL / MySQL / MongoDB / Elasticsearch / 向量数据库"},{"icon":"🧮","title":"算法与数据结构","details":"排序搜索 / 动态规划 / 图算法 / 基础数据结构"},{"icon":"🏗️","title":"系统设计","details":"分布式系统 / 消息队列 / LLM 推理引擎 / 分布式训练"},{"icon":"🚀","title":"DevOps 与云计算","details":"Docker / Kubernetes / CI-CD / GitOps"},{"icon":"🤖","title":"AI Agent 全栈开发","details":"LLM 原理 / Prompt 工程 / RAG / Agent 框架 / 微调 / 多 Agent / 流式渲染"},{"icon":"✍️","title":"编码题","details":"编码技巧与解题策略、各领域手写代码实战"}]},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
