import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"01-技术资料 — 总目录","description":"","frontmatter":{},"headers":[],"relativePath":"01-技术资料/index.md","filePath":"01-技术资料/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "01-技术资料/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_01-技术资料-—-总目录" tabindex="-1">01-技术资料 — 总目录 <a class="header-anchor" href="#_01-技术资料-—-总目录" aria-label="Permalink to &quot;01-技术资料 — 总目录&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>系统性技术学习文档，按技术领域分类整理。每个分类与 <a href="./../02-面试指南/">02-面试指南</a> 中的对应分类一一对应。</p></blockquote><h2 id="分类目录" tabindex="-1">分类目录 <a class="header-anchor" href="#分类目录" aria-label="Permalink to &quot;分类目录&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>编号</th><th>分类</th><th>目录链接</th><th>对应面试指南</th></tr></thead><tbody><tr><td>01</td><td>前端</td><td><a href="./01-前端/">01-前端</a></td><td><a href="./../02-面试指南/01-前端面试/">01-前端面试</a></td></tr><tr><td>02</td><td>后端</td><td><a href="./02-后端/">02-后端</a></td><td><a href="./../02-面试指南/02-后端面试/">02-后端面试</a></td></tr><tr><td>03</td><td>数据库</td><td><a href="./03-数据库/">03-数据库</a></td><td><a href="./../02-面试指南/03-数据库面试/">03-数据库面试</a></td></tr><tr><td>04</td><td>算法与数据结构</td><td><a href="./04-算法与数据结构/">04-算法与数据结构</a></td><td><a href="./../02-面试指南/04-算法与数据结构面试/">04-算法与数据结构面试</a></td></tr><tr><td>05</td><td>系统设计</td><td><a href="./05-系统设计/">05-系统设计</a></td><td><a href="./../02-面试指南/05-系统设计面试/">05-系统设计面试</a></td></tr><tr><td>06</td><td>DevOps 与云计算</td><td><a href="./06-DevOps与云计算/">06-DevOps与云计算</a></td><td><a href="./../02-面试指南/06-DevOps与云计算面试/">06-DevOps与云计算面试</a></td></tr><tr><td>07</td><td>AI Agent 全栈开发</td><td><a href="./07-AI-Agent全栈开发/">07-AI-Agent全栈开发</a></td><td><a href="./../02-面试指南/07-AI-Agent全栈开发面试/">07-AI-Agent全栈开发面试</a></td></tr><tr><td>08</td><td>编码题</td><td><a href="./08-编码题/">08-编码题</a></td><td><a href="./../02-面试指南/08-编码题面试/">08-编码题面试</a></td></tr></tbody></table><h2 id="使用说明" tabindex="-1">使用说明 <a class="header-anchor" href="#使用说明" aria-label="Permalink to &quot;使用说明&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>每个分类目录下的 <code>README.md</code> 包含该分类所有文档的列表与简介</li><li>文件以序号开头，保持有序（如 <code>01-JavaScript基础.md</code>）</li><li>每个文档末尾提供对应面试指南的跳转链接</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">项目主页</a></li><li>→ <a href="./../02-面试指南/">面试指南总目录</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("01-技术资料/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
