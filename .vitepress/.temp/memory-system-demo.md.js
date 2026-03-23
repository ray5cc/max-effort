import { resolveComponent, withCtx, createVNode, createTextVNode, useSSRContext } from "vue";
import { ssrRenderAttrs, ssrRenderStyle, ssrRenderComponent } from "vue/server-renderer";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"记忆系统演示文档","description":"","frontmatter":{},"headers":[],"relativePath":"memory-system-demo.md","filePath":"memory-system-demo.md","lastUpdated":1774223919000}');
const _sfc_main = { name: "memory-system-demo.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  const _component_RecallBlock = resolveComponent("RecallBlock");
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="记忆系统演示文档" tabindex="-1">记忆系统演示文档 <a class="header-anchor" href="#记忆系统演示文档" aria-label="Permalink to &quot;记忆系统演示文档&quot;">&amp;ZeroWidthSpace;</a></h1><blockquote><p>本文档展示新的记忆优化颜色系统在实际文档中的应用效果</p></blockquote><h2 id="核心概念示例" tabindex="-1">核心概念示例 <a class="header-anchor" href="#核心概念示例" aria-label="Permalink to &quot;核心概念示例&quot;">&amp;ZeroWidthSpace;</a></h2><p>::: concept 核心概念：React Fiber 架构 Fiber 是 React 16 引入的新协调引擎，将原本递归不可中断的渲染过程改造为可中断的链表遍历，使得高优先级任务（如用户输入）能够打断低优先级任务（如列表渲染）。</p><p><strong>类比</strong>：就像操作系统的进程调度，可以随时暂停一个进程去执行更重要的任务，而不是必须等它全部完成。 :::</p><h2 id="警告陷阱示例" tabindex="-1">警告陷阱示例 <a class="header-anchor" href="#警告陷阱示例" aria-label="Permalink to &quot;警告陷阱示例&quot;">&amp;ZeroWidthSpace;</a></h2><div class="warning custom-block"><p class="custom-block-title">❌ 常见陷阱：useEffect 无限循环</p><div class="language-javascript vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">javascript</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// ❌ 错误：依赖数组缺失导致每次渲染都触发</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">useEffect</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(() </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> {</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">  setData</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">fetchData</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">())</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">})</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// ✅ 正确：明确依赖，只在 id 变化时执行</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">useEffect</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(() </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> {</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">  setData</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">fetchData</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">())</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}, [id])</span></span></code></pre></div><p>如果不指定依赖数组，useEffect 会在每次组件渲染后执行，导致状态更新 → 重新渲染 → 再次执行的死循环。</p></div><h2 id="实践案例示例" tabindex="-1">实践案例示例 <a class="header-anchor" href="#实践案例示例" aria-label="Permalink to &quot;实践案例示例&quot;">&amp;ZeroWidthSpace;</a></h2><p>::: practice 实践案例：优化大列表渲染 使用虚拟滚动库 <code>react-window</code> 优化 10 万条数据的列表：</p><div class="language-typescript vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">import</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> { FixedSizeList } </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">from</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &#39;react-window&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">const</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Row</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> ({ </span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">index</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">, </span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">style</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> }) </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> (</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">  &lt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">div style</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{style}</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">Row {</span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">index</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&lt;/</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">div</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">)</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&lt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">FixedSizeList</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  height</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">600</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  itemCount</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">100000</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  itemSize</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">35</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  width</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">&quot;100%&quot;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  {Row}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&lt;/</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">FixedSizeList</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">&gt;</span></span></code></pre></div><p>虚拟滚动只渲染可见区域的元素，将 DOM 节点数量从 10 万个降低到约 20 个，性能提升 5000 倍。 :::</p><h2 id="提示技巧示例" tabindex="-1">提示技巧示例 <a class="header-anchor" href="#提示技巧示例" aria-label="Permalink to &quot;提示技巧示例&quot;">&amp;ZeroWidthSpace;</a></h2><div class="tip custom-block"><p class="custom-block-title">💡 面试技巧</p><p>回答 Fiber 原理时，按照&quot;问题→方案→实现&quot;的三段论结构讲述：</p><ol><li><strong>问题</strong>：React 15 递归渲染导致主线程长时间阻塞，用户输入响应延迟</li><li><strong>方案</strong>：引入时间切片（Time Slicing），实现可中断的渲染</li><li><strong>实现</strong>：Fiber 数据结构（链表） + 双缓冲树（current/workInProgress） + 优先级调度（Scheduler）</li></ol><p>这种结构化表达能让面试官快速理解你对问题的深度思考。</p></div><h2 id="自测回忆示例" tabindex="-1">自测回忆示例 <a class="header-anchor" href="#自测回忆示例" aria-label="Permalink to &quot;自测回忆示例&quot;">&amp;ZeroWidthSpace;</a></h2><p>::: recall 自测：React 18 并发特性 在继续阅读前，先尝试用自己的话回答：</p><ol><li>React 18 的并发模式解决了什么问题？</li><li><code>startTransition</code> 的作用是什么？</li><li>自动批处理（Automatic Batching）的原理是什么？ :::</li></ol><h2 id="交互式自测组件" tabindex="-1">交互式自测组件 <a class="header-anchor" href="#交互式自测组件" aria-label="Permalink to &quot;交互式自测组件&quot;">&amp;ZeroWidthSpace;</a></h2>`);
  _push(ssrRenderComponent(_component_RecallBlock, { title: "自测：Fiber 架构的核心目标" }, {
    question: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(`<p${_scopeId}><strong${_scopeId}>问题 1</strong>：Fiber 解决了 React 的哪个核心问题？</p><p${_scopeId}><strong${_scopeId}>问题 2</strong>：Fiber 数据结构相比递归调用栈的优势是什么？</p><p${_scopeId}><strong${_scopeId}>问题 3</strong>：什么是时间切片（Time Slicing）？</p><p${_scopeId}>提示：从&quot;可中断性&quot;的角度思考这三个问题。</p>`);
      } else {
        return [
          createVNode("p", null, [
            createVNode("strong", null, "问题 1"),
            createTextVNode("：Fiber 解决了 React 的哪个核心问题？")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "问题 2"),
            createTextVNode("：Fiber 数据结构相比递归调用栈的优势是什么？")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "问题 3"),
            createTextVNode("：什么是时间切片（Time Slicing）？")
          ]),
          createVNode("p", null, '提示：从"可中断性"的角度思考这三个问题。')
        ];
      }
    }),
    answer: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(`<p${_scopeId}><strong${_scopeId}>答案 1</strong>：Fiber 解决了 React 15 递归渲染不可中断的问题。在 React 15 中，一旦开始协调（Reconciliation），就必须一次性处理完整个组件树，期间主线程被完全占用，导致用户输入、动画等高优先级任务无法响应。</p><p${_scopeId}><strong${_scopeId}>答案 2</strong>：Fiber 采用链表结构，每个节点包含 <code${_scopeId}>child</code>、<code${_scopeId}>sibling</code>、<code${_scopeId}>return</code> 指针，可以随时保存当前进度并暂停。而递归调用栈一旦开始就无法中断，必须等待整个调用栈清空。</p><p${_scopeId}><strong${_scopeId}>答案 3</strong>：时间切片是将长时间任务拆分成多个小片段，在每个片段执行完后检查是否有更高优先级任务（如用户点击）需要处理。如果有，就先暂停当前任务，处理高优先级任务后再继续。</p><p${_scopeId}><strong${_scopeId}>类比</strong>：就像看书时可以随时用书签标记当前页码，去处理其他事情，回来后继续从标记处读起。而递归就像必须一口气读完整本书，中途不能停。</p><p${_scopeId}><strong${_scopeId}>延伸</strong>：React 18 引入了并发渲染（Concurrent Rendering），进一步增强了时间切片能力，允许同时准备多个版本的 UI，根据优先级决定最终提交哪个版本。</p>`);
      } else {
        return [
          createVNode("p", null, [
            createVNode("strong", null, "答案 1"),
            createTextVNode("：Fiber 解决了 React 15 递归渲染不可中断的问题。在 React 15 中，一旦开始协调（Reconciliation），就必须一次性处理完整个组件树，期间主线程被完全占用，导致用户输入、动画等高优先级任务无法响应。")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "答案 2"),
            createTextVNode("：Fiber 采用链表结构，每个节点包含 "),
            createVNode("code", null, "child"),
            createTextVNode("、"),
            createVNode("code", null, "sibling"),
            createTextVNode("、"),
            createVNode("code", null, "return"),
            createTextVNode(" 指针，可以随时保存当前进度并暂停。而递归调用栈一旦开始就无法中断，必须等待整个调用栈清空。")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "答案 3"),
            createTextVNode("：时间切片是将长时间任务拆分成多个小片段，在每个片段执行完后检查是否有更高优先级任务（如用户点击）需要处理。如果有，就先暂停当前任务，处理高优先级任务后再继续。")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "类比"),
            createTextVNode("：就像看书时可以随时用书签标记当前页码，去处理其他事情，回来后继续从标记处读起。而递归就像必须一口气读完整本书，中途不能停。")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "延伸"),
            createTextVNode("：React 18 引入了并发渲染（Concurrent Rendering），进一步增强了时间切片能力，允许同时准备多个版本的 UI，根据优先级决定最终提交哪个版本。")
          ])
        ];
      }
    }),
    _: 1
  }, _parent));
  _push(`<h2 id="多个知识点串联" tabindex="-1">多个知识点串联 <a class="header-anchor" href="#多个知识点串联" aria-label="Permalink to &quot;多个知识点串联&quot;">&amp;ZeroWidthSpace;</a></h2><h3 id="_1-fiber-的数据结构" tabindex="-1">1. Fiber 的数据结构 <a class="header-anchor" href="#_1-fiber-的数据结构" aria-label="Permalink to &quot;1. Fiber 的数据结构&quot;">&amp;ZeroWidthSpace;</a></h3><p>::: concept 核心数据结构</p><div class="language-typescript vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">type</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Fiber</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> {</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  type</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> any</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,              </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 组件类型（函数/类/原生标签）</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  key</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> null</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> string</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,     </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 列表中的唯一标识</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">  // 链表指针</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  child</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Fiber</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> null</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,    </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 第一个子节点</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  sibling</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Fiber</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> null</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,  </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 下一个兄弟节点</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  return</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Fiber</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> null</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,   </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 父节点</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">  // 状态</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  pendingProps</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> any</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,      </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 新的 props</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  memoizedProps</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> any</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,     </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 上次渲染的 props</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  memoizedState</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> any</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,     </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 上次渲染的 state</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">  // 副作用</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  flags</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Flags</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">,           </span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">// 副作用标记（插入/更新/删除）</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">  // 双缓冲</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">  alternate</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">:</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> Fiber</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> null</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"> // 指向另一棵树中的对应节点</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span></span></code></pre></div><p>:::</p><h3 id="_2-双缓冲机制" tabindex="-1">2. 双缓冲机制 <a class="header-anchor" href="#_2-双缓冲机制" aria-label="Permalink to &quot;2. 双缓冲机制&quot;">&amp;ZeroWidthSpace;</a></h3><div class="tip custom-block"><p class="custom-block-title">类比：双缓冲 = 画家的两块画布</p><p>想象画家有两块画布：</p><ul><li><strong>画布 A（current）</strong>：正在展览的完成作品</li><li><strong>画布 B（workInProgress）</strong>：正在创作的新版本</li></ul><p>观众看到的始终是画布 A。当画布 B 完成后，瞬间切换展出画布 B，同时画布 A 变成新的工作画布。</p><p>React 同样维护两棵 Fiber 树：</p><ul><li><code>current</code> 树：当前屏幕显示的内容</li><li><code>workInProgress</code> 树：正在构建的新版本</li></ul><p>提交（Commit）阶段只是修改指针，让 <code>current</code> 指向新树，O(1) 时间复杂度。</p></div><h3 id="_3-常见误区" tabindex="-1">3. 常见误区 <a class="header-anchor" href="#_3-常见误区" aria-label="Permalink to &quot;3. 常见误区&quot;">&amp;ZeroWidthSpace;</a></h3><div class="warning custom-block"><p class="custom-block-title">❌ 误区：Fiber 提升了渲染性能</p><p>很多人认为 Fiber 让 React 变快了，这是误解。</p><p><strong>真相</strong>：Fiber 的核心目标是&quot;<strong>可中断性</strong>&quot;和&quot;<strong>优先级调度</strong>&quot;，而不是速度。实际上，Fiber 引入了额外的链表遍历和优先级判断开销，单次渲染可能比 React 15 稍慢。</p><p><strong>真正的价值</strong>：用户<strong>感知的流畅度</strong>提升了。高优先级任务（用户输入）不再被低优先级任务（列表渲染）阻塞，应用的响应性大幅改善。</p><p>类比：快递员送 100 个包裹，优化路线可以让总耗时从 10 小时降到 8 小时（性能优化）。但如果有紧急文件，立即停下当前路线去送紧急件（优先级调度），虽然总耗时可能变成 9 小时，但客户体验更好。</p></div><h3 id="_4-实战场景" tabindex="-1">4. 实战场景 <a class="header-anchor" href="#_4-实战场景" aria-label="Permalink to &quot;4. 实战场景&quot;">&amp;ZeroWidthSpace;</a></h3><p>::: practice 场景：优化搜索输入的卡顿 <strong>问题</strong>：用户在搜索框输入时，触发列表过滤渲染，导致输入延迟。</p><p><strong>React 18 解决方案</strong>：</p><div class="language-typescript vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">import</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> { useState, useDeferredValue } </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">from</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &#39;react&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">function</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> SearchResults</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">() {</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">  const</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> [</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">query</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">, </span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">setQuery</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">] </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> useState</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">&#39;&#39;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">)</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">  const</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> deferredQuery</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> useDeferredValue</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(query)</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">  // 昂贵的过滤操作使用 deferred 值</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">  const</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> results</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> useMemo</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(() </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">    bigList.</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">filter</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(</span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">item</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> item.</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">includes</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(deferredQuery)),</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">    [deferredQuery]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  )</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">  return</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}"> (</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">    &lt;&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">      &lt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">input</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">        value</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{query}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">        onChange</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{</span><span style="${ssrRenderStyle({ "--shiki-light": "#E36209", "--shiki-dark": "#FFAB70" })}">e</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> =&gt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> setQuery</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">(e.target.value)}</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">      /&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">      &lt;</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">ResultList items</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">=</span><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">{results} </span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">/&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}">    &lt;/&gt;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  )</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">}</span></span></code></pre></div><p><strong>原理</strong>：</p><ul><li><code>query</code> 立即更新，输入框立刻响应（高优先级）</li><li><code>deferredQuery</code> 延迟更新，列表渲染被标记为低优先级</li><li>如果用户继续输入，React 会丢弃未完成的列表渲染，用最新值重新开始 :::</li></ul><h2 id="章节自测" tabindex="-1">章节自测 <a class="header-anchor" href="#章节自测" aria-label="Permalink to &quot;章节自测&quot;">&amp;ZeroWidthSpace;</a></h2>`);
  _push(ssrRenderComponent(_component_RecallBlock, { title: "综合自测：检验你的理解深度" }, {
    question: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(`<p${_scopeId}><strong${_scopeId}>场景题</strong>：假设你在面试中被问到：&quot;为什么 React 选择 Fiber 架构而不是直接用 Web Workers？&quot;</p><p${_scopeId}>请从以下角度构思答案：</p><ol${_scopeId}><li${_scopeId}>Web Workers 的局限性</li><li${_scopeId}>Fiber 的优势</li><li${_scopeId}>React 团队的权衡考虑</li></ol><p${_scopeId}>提示：思考 DOM 操作的限制和状态管理的复杂性。</p>`);
      } else {
        return [
          createVNode("p", null, [
            createVNode("strong", null, "场景题"),
            createTextVNode('：假设你在面试中被问到："为什么 React 选择 Fiber 架构而不是直接用 Web Workers？"')
          ]),
          createVNode("p", null, "请从以下角度构思答案："),
          createVNode("ol", null, [
            createVNode("li", null, "Web Workers 的局限性"),
            createVNode("li", null, "Fiber 的优势"),
            createVNode("li", null, "React 团队的权衡考虑")
          ]),
          createVNode("p", null, "提示：思考 DOM 操作的限制和状态管理的复杂性。")
        ];
      }
    }),
    answer: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(`<p${_scopeId}><strong${_scopeId}>参考答案框架</strong>：</p><h3 id="_1-web-workers-的局限性" tabindex="-1"${_scopeId}>1. Web Workers 的局限性 <a class="header-anchor" href="#_1-web-workers-的局限性" aria-label="Permalink to &quot;1. Web Workers 的局限性&quot;"${_scopeId}>&amp;ZeroWidthSpace;</a></h3><ul${_scopeId}><li${_scopeId}><strong${_scopeId}>无法访问 DOM</strong>：Web Workers 运行在独立线程，不能直接操作 DOM。如果用 Worker 做协调（Reconciliation），最终还是要把结果传回主线程执行 DOM 操作，存在序列化和通信开销。</li><li${_scopeId}><strong${_scopeId}>状态管理复杂</strong>：React 组件的状态、Context、Ref 等都在主线程，Worker 中需要同步整个状态树，代价高昂。</li><li${_scopeId}><strong${_scopeId}>调试困难</strong>：跨线程调试比单线程复杂得多。</li></ul><h3 id="_2-fiber-的优势" tabindex="-1"${_scopeId}>2. Fiber 的优势 <a class="header-anchor" href="#_2-fiber-的优势" aria-label="Permalink to &quot;2. Fiber 的优势&quot;"${_scopeId}>&amp;ZeroWidthSpace;</a></h3><ul${_scopeId}><li${_scopeId}><strong${_scopeId}>细粒度控制</strong>：可以精确控制每个 Fiber 节点的处理时间，而 Worker 是整体任务粒度。</li><li${_scopeId}><strong${_scopeId}>无通信成本</strong>：所有操作在主线程，无需序列化和跨线程通信。</li><li${_scopeId}><strong${_scopeId}>渐进式调度</strong>：可以随时暂停/恢复，而 Worker 任务一旦开始就必须完成。</li></ul><h3 id="_3-react-团队的权衡" tabindex="-1"${_scopeId}>3. React 团队的权衡 <a class="header-anchor" href="#_3-react-团队的权衡" aria-label="Permalink to &quot;3. React 团队的权衡&quot;"${_scopeId}>&amp;ZeroWidthSpace;</a></h3><p${_scopeId}>React 的核心问题是&quot;<strong${_scopeId}>主线程被长任务阻塞</strong>&quot;，解决方案是：</p><ul${_scopeId}><li${_scopeId}><strong${_scopeId}>方案 A（Worker）</strong>：把任务移到其他线程 → 引入新的复杂性</li><li${_scopeId}><strong${_scopeId}>方案 B（Fiber）</strong>：把长任务拆成短任务 → 在现有架构上优雅演进</li></ul><p${_scopeId}>React 选择了方案 B，因为：</p><ol${_scopeId}><li${_scopeId}>兼容性好：不改变现有组件写法</li><li${_scopeId}>调试友好：单线程推理更简单</li><li${_scopeId}>灵活性高：可以根据优先级动态调整</li></ol><p${_scopeId}><strong${_scopeId}>类比</strong>：堵车时，与其修建新的高架桥（Worker，成本高），不如优化红绿灯配时（Fiber，渐进式改进）。</p><p${_scopeId}><strong${_scopeId}>延伸阅读</strong>：Dan Abramov 的博客文章 <a href="https://reactjs.org/blog/2018/03/01/sneak-peek-beyond-react-16.html" target="_blank" rel="noreferrer"${_scopeId}>《Beyond React 16》</a> 详细讨论了这个设计决策。</p>`);
      } else {
        return [
          createVNode("p", null, [
            createVNode("strong", null, "参考答案框架"),
            createTextVNode("：")
          ]),
          createVNode("h3", {
            id: "_1-web-workers-的局限性",
            tabindex: "-1"
          }, [
            createTextVNode("1. Web Workers 的局限性 "),
            createVNode("a", {
              class: "header-anchor",
              href: "#_1-web-workers-的局限性",
              "aria-label": 'Permalink to "1. Web Workers 的局限性"'
            }, "&ZeroWidthSpace;")
          ]),
          createVNode("ul", null, [
            createVNode("li", null, [
              createVNode("strong", null, "无法访问 DOM"),
              createTextVNode("：Web Workers 运行在独立线程，不能直接操作 DOM。如果用 Worker 做协调（Reconciliation），最终还是要把结果传回主线程执行 DOM 操作，存在序列化和通信开销。")
            ]),
            createVNode("li", null, [
              createVNode("strong", null, "状态管理复杂"),
              createTextVNode("：React 组件的状态、Context、Ref 等都在主线程，Worker 中需要同步整个状态树，代价高昂。")
            ]),
            createVNode("li", null, [
              createVNode("strong", null, "调试困难"),
              createTextVNode("：跨线程调试比单线程复杂得多。")
            ])
          ]),
          createVNode("h3", {
            id: "_2-fiber-的优势",
            tabindex: "-1"
          }, [
            createTextVNode("2. Fiber 的优势 "),
            createVNode("a", {
              class: "header-anchor",
              href: "#_2-fiber-的优势",
              "aria-label": 'Permalink to "2. Fiber 的优势"'
            }, "&ZeroWidthSpace;")
          ]),
          createVNode("ul", null, [
            createVNode("li", null, [
              createVNode("strong", null, "细粒度控制"),
              createTextVNode("：可以精确控制每个 Fiber 节点的处理时间，而 Worker 是整体任务粒度。")
            ]),
            createVNode("li", null, [
              createVNode("strong", null, "无通信成本"),
              createTextVNode("：所有操作在主线程，无需序列化和跨线程通信。")
            ]),
            createVNode("li", null, [
              createVNode("strong", null, "渐进式调度"),
              createTextVNode("：可以随时暂停/恢复，而 Worker 任务一旦开始就必须完成。")
            ])
          ]),
          createVNode("h3", {
            id: "_3-react-团队的权衡",
            tabindex: "-1"
          }, [
            createTextVNode("3. React 团队的权衡 "),
            createVNode("a", {
              class: "header-anchor",
              href: "#_3-react-团队的权衡",
              "aria-label": 'Permalink to "3. React 团队的权衡"'
            }, "&ZeroWidthSpace;")
          ]),
          createVNode("p", null, [
            createTextVNode('React 的核心问题是"'),
            createVNode("strong", null, "主线程被长任务阻塞"),
            createTextVNode('"，解决方案是：')
          ]),
          createVNode("ul", null, [
            createVNode("li", null, [
              createVNode("strong", null, "方案 A（Worker）"),
              createTextVNode("：把任务移到其他线程 → 引入新的复杂性")
            ]),
            createVNode("li", null, [
              createVNode("strong", null, "方案 B（Fiber）"),
              createTextVNode("：把长任务拆成短任务 → 在现有架构上优雅演进")
            ])
          ]),
          createVNode("p", null, "React 选择了方案 B，因为："),
          createVNode("ol", null, [
            createVNode("li", null, "兼容性好：不改变现有组件写法"),
            createVNode("li", null, "调试友好：单线程推理更简单"),
            createVNode("li", null, "灵活性高：可以根据优先级动态调整")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "类比"),
            createTextVNode("：堵车时，与其修建新的高架桥（Worker，成本高），不如优化红绿灯配时（Fiber，渐进式改进）。")
          ]),
          createVNode("p", null, [
            createVNode("strong", null, "延伸阅读"),
            createTextVNode("：Dan Abramov 的博客文章 "),
            createVNode("a", {
              href: "https://reactjs.org/blog/2018/03/01/sneak-peek-beyond-react-16.html",
              target: "_blank",
              rel: "noreferrer"
            }, "《Beyond React 16》"),
            createTextVNode(" 详细讨论了这个设计决策。")
          ])
        ];
      }
    }),
    _: 1
  }, _parent));
  _push(`<h2 id="标记复习" tabindex="-1">标记复习 <a class="header-anchor" href="#标记复习" aria-label="Permalink to &quot;标记复习&quot;">&amp;ZeroWidthSpace;</a></h2><p>如果你觉得这份文档值得定期回顾，可以点击下方按钮标记：</p> &lt;BookmarkReview /&gt;<hr><h2 id="使用说明" tabindex="-1">使用说明 <a class="header-anchor" href="#使用说明" aria-label="Permalink to &quot;使用说明&quot;">&amp;ZeroWidthSpace;</a></h2><p>本文档演示了以下记忆优化功能：</p><ol><li><p><strong>自定义容器</strong>（5 种）</p><ul><li><code>::: concept</code> - 核心概念（蓝色）</li><li><code>::: warning</code> - 警告陷阱（橙红色）</li><li><code>::: practice</code> - 实践案例（绿色）</li><li><code>::: tip</code> - 提示技巧（青色）</li><li><code>::: recall</code> - 自测回忆（紫色）</li></ul></li><li><p><strong>交互组件</strong></p><ul><li><code>&lt;RecallBlock&gt;</code> - 可展开的自测问题</li><li><code>&lt;BookmarkReview&gt;</code> - 页面书签功能</li></ul></li></ol><p>详细使用方法见 <a href="/max-effort/.vitepress/memory-system-guide.html">记忆系统使用指南</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("memory-system-demo.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const memorySystemDemo = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  memorySystemDemo as default
};
