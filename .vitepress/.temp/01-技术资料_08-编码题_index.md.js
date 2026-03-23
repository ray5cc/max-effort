import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"08-编码题","description":"","frontmatter":{},"headers":[],"relativePath":"01-技术资料/08-编码题/index.md","filePath":"01-技术资料/08-编码题/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "01-技术资料/08-编码题/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_08-编码题" tabindex="-1">08-编码题 <a class="header-anchor" href="#_08-编码题" aria-label="Permalink to &quot;08-编码题&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>手写代码相关的技巧、方法论与实践指南，涵盖编码面试的核心能力培养。</p></blockquote><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件名</th><th>描述</th><th>关联文档</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-编码技巧与解题策略.html">编码技巧与解题策略</a></td><td>系统性讲解手写代码的方法论、常见模式、代码规范、时间管理与调试技巧</td><td><a href="./../../02-面试指南/08-编码题面试/">编码题面试集合</a></td></tr></tbody></table><h2 id="说明" tabindex="-1">说明 <a class="header-anchor" href="#说明" aria-label="Permalink to &quot;说明&quot;">&amp;ZeroWidthSpace;</a></h2><p>编码题（Hand-written Code / Live Coding）是技术面试中最核心的环节之一，不仅考察技术能力，也考察问题解决能力和沟通协作能力。</p><p>本目录包含：</p><ul><li><strong>编码方法论</strong>：四步解题法（理解题意 → 设计方案 → 编码实现 → 测试验证）</li><li><strong>常见代码模式</strong>：双指针、哈希表、栈、递归、动态规划、二分查找、位运算等</li><li><strong>代码规范</strong>：命名规范、注释文档、错误处理、边界条件</li><li><strong>时间管理</strong>：如何在限定时间内高效完成编码</li><li><strong>调试技巧</strong>：打印调试、断言验证、手动追踪</li><li><strong>实战案例</strong>：前端、后端、算法、系统设计等各领域典型编码题解析</li></ul><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">技术资料总目录</a></li><li>→ <a href="./../../02-面试指南/08-编码题面试/">对应面试题</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("01-技术资料/08-编码题/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
