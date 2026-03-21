import { defineConfig } from 'vitepress'
import type MarkdownIt from 'markdown-it'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/* ------------------------------------------------------------------ */
/*  自动生成侧边栏                                                     */
/* ------------------------------------------------------------------ */

function generateSidebar(rootDir: string) {
  const absPath = path.join(ROOT, rootDir)
  if (!fs.existsSync(absPath)) return []

  const categories = fs
    .readdirSync(absPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+-/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  return categories.map((cat) => {
    const catPath = path.join(absPath, cat.name)
    const files = fs
      .readdirSync(catPath, { withFileTypes: true })
      .filter(
        (f) =>
          f.isFile() && f.name.endsWith('.md') && f.name !== 'README.md'
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      text: cat.name.replace(/^\d+-/, ''),
      link: `/${rootDir}/${cat.name}/`,
      collapsed: true,
      items: files.map((f) => ({
        text: f.name.replace(/^\d+-/, '').replace(/\.md$/, ''),
        link: `/${rootDir}/${cat.name}/${f.name}`,
      })),
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Markdown-it 插件：                                                  */
/*  1. 转义非标准 HTML 标签（避免 Vue 编译 "missing end tag" 报错）       */
/*  2. 转义 {{ }} 双花括号（避免 Vue 将其当作模板插值）                    */
/* ------------------------------------------------------------------ */

const STANDARD_HTML_TAGS = new Set([
  'a','abbr','address','area','article','aside','audio',
  'b','base','bdi','bdo','blockquote','body','br','button',
  'canvas','caption','cite','code','col','colgroup',
  'data','datalist','dd','del','details','dfn','dialog','div','dl','dt',
  'em','embed',
  'fieldset','figcaption','figure','footer','form',
  'h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html',
  'i','iframe','img','input','ins',
  'kbd','label','legend','li','link',
  'main','map','mark','menu','meta','meter',
  'nav','noscript',
  'object','ol','optgroup','option','output',
  'p','param','picture','pre','progress',
  'q','rp','rt','ruby',
  's','samp','script','search','section','select','slot','small',
  'source','span','strong','style','sub','summary','sup',
  'table','tbody','td','template','textarea','tfoot','th','thead',
  'time','title','tr','track',
  'u','ul',
  'var','video','wbr',
])

function escapeNonStandardTag(html: string): string {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g,
    (match, tag) => {
      if (STANDARD_HTML_TAGS.has(tag.toLowerCase())) return match
      return match.replace(/</g, '&lt;')
    },
  )
}

function escapeBraces(s: string): string {
  return s.replace(/\{\{/g, '&#123;&#123;').replace(/\}\}/g, '&#125;&#125;')
}

function safeContentPlugin(md: MarkdownIt) {
  // 1) inline HTML 全部转义（如 <data>、<context> 等）
  //    block-level HTML（<details>/<summary>）不受影响，因为它们是 html_block 类型
  md.renderer.rules.html_inline = (tokens, idx) => {
    return tokens[idx].content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  // 2) 文本中的 {{ }} 转义（代码块不受影响，因为 fence/code_block 有自己的渲染器）
  const defaultTextRender = md.renderer.rules.text
  md.renderer.rules.text = (tokens, idx, options, env, self) => {
    const content = tokens[idx].content
    const escaped = md.utils.escapeHtml(content)
    return escapeBraces(escaped)
  }

  // 3) html_block 中的 {{ }} 也需要转义（保留标准 HTML 标签不变）
  md.renderer.rules.html_block = (tokens, idx) => {
    return escapeBraces(tokens[idx].content)
  }
}

/* ------------------------------------------------------------------ */
/*  VitePress 配置                                                     */
/* ------------------------------------------------------------------ */

export default defineConfig({
  title: 'Max Effort',
  description: 'AI Agent 全栈开发知识库',
  lang: 'zh-CN',
  base: '/max-effort/',
  ignoreDeadLinks: true,

  rewrites: {
    ':a/README.md': ':a/index.md',
    ':a/:b/README.md': ':a/:b/index.md',
  },

  srcExclude: [
    'CHANGELOG/**',
    '.agent-docs/**',
    '_Sidebar.md',
    '_Footer.md',
    'Home.md',
    'AGENTS.md',
    'CLAUDE.md',
    'llms.txt',
    'node_modules/**',
  ],

  markdown: {
    config: (md) => {
      md.use(safeContentPlugin)
    },
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '技术资料', link: '/01-技术资料/' },
      { text: '面试指南', link: '/02-面试指南/' },
    ],

    sidebar: {
      '/01-技术资料/': [
        {
          text: '技术资料',
          items: generateSidebar('01-技术资料'),
        },
      ],
      '/02-面试指南/': [
        {
          text: '面试指南',
          items: generateSidebar('02-面试指南'),
        },
      ],
    },

    outline: {
      level: [2, 3],
      label: '目录',
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ray5cc/max-effort' },
    ],

    editLink: {
      pattern: 'https://github.com/ray5cc/max-effort/edit/main/:path',
      text: '在 GitHub 上编辑此页',
    },

    lastUpdated: {
      text: '最后更新',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },
  },
})
