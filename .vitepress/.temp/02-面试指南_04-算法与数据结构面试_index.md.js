import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"04-算法与数据结构面试 — 面试指南","description":"","frontmatter":{},"headers":[],"relativePath":"02-面试指南/04-算法与数据结构面试/index.md","filePath":"02-面试指南/04-算法与数据结构面试/README.md","lastUpdated":1774066204000}');
const _sfc_main = { name: "02-面试指南/04-算法与数据结构面试/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_04-算法与数据结构面试-—-面试指南" tabindex="-1">04-算法与数据结构面试 — 面试指南 <a class="header-anchor" href="#_04-算法与数据结构面试-—-面试指南" aria-label="Permalink to &quot;04-算法与数据结构面试 — 面试指南&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>覆盖排序搜索、动态规划、基础数据结构、图算法与贪心等核心算法高频面试题。</p></blockquote><h2 id="相关链接" tabindex="-1">相关链接 <a class="header-anchor" href="#相关链接" aria-label="Permalink to &quot;相关链接&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>对应技术资料：<a href="./../../01-技术资料/04-算法与数据结构/">04-算法与数据结构</a></li></ul><h2 id="面试题目录" tabindex="-1">面试题目录 <a class="header-anchor" href="#面试题目录" aria-label="Permalink to &quot;面试题目录&quot;">&amp;ZeroWidthSpace;</a></h2><table tabindex="0"><thead><tr><th>序号</th><th>文件名</th><th>覆盖知识点</th><th>关联技术资料</th></tr></thead><tbody><tr><td>01</td><td><a href="./01-排序与搜索面试题.html">01-排序与搜索面试题.md</a></td><td>排序算法对比 / 二分搜索变体(左右边界/旋转数组/峰值) / 双指针(3Sum/接雨水/滑动窗口) / 堆(中位数/K路归并) / 外部排序(败者树) / TimSort / 主定理 / 搜索排序 / Top-K 33 道分层题</td><td><a href="./../../01-技术资料/04-算法与数据结构/01-排序与搜索算法.html">技术资料</a></td></tr><tr><td>02</td><td><a href="./02-动态规划面试题.html">02-动态规划面试题.md</a></td><td>背包 / LCS / 编辑距离 / 区间DP(矩阵链乘/石子合并/戳气球) / 树形DP(换根) / 博弈DP(Nim/SG函数) / 状压DP / 数位DP / 单调队列优化 / 斜率优化 / 股票状态机 / 零钱兑换 / 分割等和 33 道分层题</td><td><a href="./../../01-技术资料/04-算法与数据结构/02-动态规划.html">技术资料</a></td></tr><tr><td>03</td><td><a href="./03-基础数据结构面试题.html">03-基础数据结构面试题.md</a></td><td>链表翻转/哈希表原理/二叉树遍历/LRU Cache/单调栈/BST/堆TopK/Trie/红黑树 25 道分层题</td><td><a href="./../../01-技术资料/04-算法与数据结构/03-基础数据结构.html">技术资料</a></td></tr><tr><td>04</td><td><a href="./04-图算法与贪心面试题.html">04-图算法与贪心面试题.md</a></td><td>BFS/DFS/岛屿问题/Dijkstra/拓扑排序/并查集/贪心区间调度/回溯排列组合/N皇后 25 道分层题</td><td><a href="./../../01-技术资料/04-算法与数据结构/04-图算法与贪心.html">技术资料</a></td></tr></tbody></table><h2 id="导航" tabindex="-1">导航 <a class="header-anchor" href="#导航" aria-label="Permalink to &quot;导航&quot;">&amp;ZeroWidthSpace;</a></h2><ul><li>← <a href="./../">面试指南总目录</a></li><li>↔ <a href="./../../01-技术资料/04-算法与数据结构/">对应技术资料</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("02-面试指南/04-算法与数据结构面试/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
