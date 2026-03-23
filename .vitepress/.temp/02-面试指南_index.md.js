import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"02-面试指南 — 总目录","description":"","frontmatter":{},"headers":[],"relativePath":"02-面试指南/index.md","filePath":"02-面试指南/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "02-面试指南/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_02-面试指南-—-总目录" tabindex="-1">02-面试指南 — 总目录 <a class="header-anchor" href="#_02-面试指南-—-总目录" aria-label="Permalink to &quot;02-面试指南 — 总目录&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>技术面试题目与解析，按技术领域分类整理，与 <a href="./../01-技术资料/">01-技术资料</a> 中的对应分类一一对应。</p></blockquote><h2 id="分类目录" tabindex="-1">分类目录 <a class="header-anchor" href="#分类目录" aria-label="Permalink to &quot;分类目录&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>编号</th><th>分类</th><th>目录链接</th><th>对应技术资料</th></tr></thead><tbody><tr><td>01</td><td>前端面试</td><td><a href="./01-前端面试/">01-前端面试</a></td><td><a href="./../01-技术资料/01-前端/">01-前端</a></td></tr><tr><td>02</td><td>后端面试</td><td><a href="./02-后端面试/">02-后端面试</a></td><td><a href="./../01-技术资料/02-后端/">02-后端</a></td></tr><tr><td>03</td><td>数据库面试</td><td><a href="./03-数据库面试/">03-数据库面试</a></td><td><a href="./../01-技术资料/03-数据库/">03-数据库</a></td></tr><tr><td>04</td><td>算法与数据结构面试</td><td><a href="./04-算法与数据结构面试/">04-算法与数据结构面试</a></td><td><a href="./../01-技术资料/04-算法与数据结构/">04-算法与数据结构</a></td></tr><tr><td>05</td><td>系统设计面试</td><td><a href="./05-系统设计面试/">05-系统设计面试</a></td><td><a href="./../01-技术资料/05-系统设计/">05-系统设计</a></td></tr><tr><td>06</td><td>DevOps 与云计算面试</td><td><a href="./06-DevOps与云计算面试/">06-DevOps与云计算面试</a></td><td><a href="./../01-技术资料/06-DevOps与云计算/">06-DevOps与云计算</a></td></tr><tr><td>07</td><td>AI Agent 全栈开发面试</td><td><a href="./07-AI-Agent全栈开发面试/">07-AI-Agent全栈开发面试</a></td><td><a href="./../01-技术资料/07-AI-Agent全栈开发/">07-AI-Agent全栈开发</a></td></tr><tr><td>08</td><td>编码题面试</td><td><a href="./08-编码题面试/">08-编码题面试</a></td><td><a href="./../01-技术资料/08-编码题/">08-编码题</a></td></tr></tbody></table><h2 id="使用说明" tabindex="-1">使用说明 <a class="header-anchor" href="#使用说明" aria-label="Permalink to &quot;使用说明&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>每个分类目录下的 <code>README.md</code> 包含该分类所有面试题文档的列表与简介</li><li>面试题文档以序号开头（如 <code>01-JavaScript面试题.md</code>）</li><li>每道题目提供参考答案与扩展知识点，并链接到对应技术资料</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">项目主页</a></li><li>→ <a href="./../01-技术资料/">技术资料总目录</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("02-面试指南/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
