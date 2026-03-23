import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"04-算法与数据结构 — 技术资料","description":"","frontmatter":{},"headers":[],"relativePath":"01-技术资料/04-算法与数据结构/index.md","filePath":"01-技术资料/04-算法与数据结构/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "01-技术资料/04-算法与数据结构/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_04-算法与数据结构-—-技术资料" tabindex="-1">04-算法与数据结构 — 技术资料 <a class="header-anchor" href="#_04-算法与数据结构-—-技术资料" aria-label="Permalink to &quot;04-算法与数据结构 — 技术资料&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>覆盖排序搜索、动态规划、基础数据结构、图算法与贪心等核心算法知识。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应面试指南：<a href="./../../02-面试指南/04-算法与数据结构面试/">04-算法与数据结构面试</a></li></ul><h2 id="文档列表" tabindex="-1">文档列表 <a class="header-anchor" href="#文档列表" aria-label="Permalink to &quot;文档列表&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件名</th><th>覆盖技术知识点</th><th>关联面试题</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-排序与搜索算法.html">01-排序与搜索算法.md</a></td><td>Big O / 冒泡/选择/插入排序 / 归并/快排/堆排序 / 二分搜索变体 / DFS/BFS / TimSort</td><td><a href="./../../02-面试指南/04-算法与数据结构面试/01-排序与搜索面试题.html">面试题</a></td></tr><tr><td>02</td><td><a href="./02-动态规划.html">02-动态规划.md</a></td><td>DP 五步法 / 背包问题 / LCS / 编辑距离 / 区间DP / 状态压缩 / 空间优化</td><td><a href="./../../02-面试指南/04-算法与数据结构面试/02-动态规划面试题.html">面试题</a></td></tr><tr><td>03</td><td><a href="./03-基础数据结构.html">03-基础数据结构.md</a></td><td>数组/链表/栈/队列/哈希表(链地址法+扩容)/BST/AVL vs 红黑树/Trie/堆/图 / 双指针 / 滑动窗口 / 单调栈 / 数据结构选型</td><td><a href="./../../02-面试指南/04-算法与数据结构面试/03-基础数据结构面试题.html">面试题</a></td></tr><tr><td>04</td><td><a href="./04-图算法与贪心.html">04-图算法与贪心.md</a></td><td>BFS/DFS / Dijkstra / Bellman-Ford / Floyd / 拓扑排序 / 并查集 / 最小生成树(Kruskal/Prim) / 贪心策略 / 回溯(子集/排列/组合/N皇后)</td><td><a href="./../../02-面试指南/04-算法与数据结构面试/04-图算法与贪心面试题.html">面试题</a></td></tr></tbody></table><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">技术资料总目录</a></li><li>↔ <a href="./../../02-面试指南/04-算法与数据结构面试/">对应面试指南</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("01-技术资料/04-算法与数据结构/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
