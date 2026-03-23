/**
 * VitePress Markdown-it 插件：ASCII Art → SVG 图表渲染
 *
 * 处理策略（按优先级）：
 * 1. 预渲染 SVG（hash 匹配） → 使用 <img> 引用
 * 2. 自动生成内联 SVG → 将 ASCII Art 渲染为图形化 SVG
 *
 * 哈希算法：MD5（仅用于文件命名，非安全用途）
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

const PUBLIC_DIAGRAMS_DIR = path.resolve(__dirname, '../../public/diagrams')
const BASE_PATH = '/max-effort/'

/* ------------------------------------------------------------------ */
/*  ASCII Art 检测                                                     */
/* ------------------------------------------------------------------ */

const BOX_DRAWING_RE = /[─│┌┐└┘├┤┬┴┼╭╮╰╯┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬]/g
const UNICODE_ARROW_RE = /[→←↓↑►▶◄◀▷▽△▲▼⟶⟵➜➤]/g
const ASCII_ARROW_RE = /[-=]{2,}(?:>|►|▶)|(?:<|◄|◀)[-=]{2,}|──▶|──►/g
const TREE_BRANCH_RE = /[├└│]──/g

function isAsciiArt(content: string): boolean {
  const boxCount = (content.match(BOX_DRAWING_RE) || []).length
  const unicodeArrowCount = (content.match(UNICODE_ARROW_RE) || []).length
  const asciiArrowCount = (content.match(ASCII_ARROW_RE) || []).length
  const treeCount = (content.match(TREE_BRANCH_RE) || []).length

  return (
    boxCount >= 4 ||
    unicodeArrowCount >= 2 ||
    asciiArrowCount >= 2 ||
    treeCount >= 3 ||
    (boxCount >= 2 && (unicodeArrowCount >= 1 || asciiArrowCount >= 1))
  )
}

/* ------------------------------------------------------------------ */
/*  MD5 哈希计算                                                       */
/* ------------------------------------------------------------------ */

function computeHash(content: string): string {
  return crypto.createHash('md5').update(content.trim()).digest('hex')
}

/* ------------------------------------------------------------------ */
/*  ASCII Art → 内联 SVG                                               */
/* ------------------------------------------------------------------ */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 将 {{ }} 转义为 HTML 实体，防止 Vue 模板插值
 */
function escapeVueBraces(s: string): string {
  return s.replace(/\{\{/g, '&#123;&#123;').replace(/\}\}/g, '&#125;&#125;')
}

function asciiToInlineSvg(content: string): string {
  const lines = content.replace(/\t/g, '    ').split('\n')
  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  const maxLen = Math.max(...lines.map((l) => l.length), 1)

  const FONT_SIZE = 14
  const LINE_HEIGHT = 20
  const CHAR_WIDTH = 8.4
  const PADDING_X = 20
  const PADDING_Y = 16
  const width = Math.ceil(maxLen * CHAR_WIDTH + PADDING_X * 2)
  const height = Math.ceil(lines.length * LINE_HEIGHT + PADDING_Y * 2)

  const textElements = lines
    .map((line, i) => {
      if (line.trim() === '') return ''
      const y = PADDING_Y + (i + 1) * LINE_HEIGHT - 4
      // Use xml:space="preserve" to keep leading spaces
      return `<text x="${PADDING_X}" y="${y}" class="d-txt" xml:space="preserve">${escapeXml(line)}</text>`
    })
    .filter(Boolean)
    .join('\n    ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="diagram" class="ascii-diagram-svg">
    <rect width="100%" height="100%" rx="8" class="d-bg"/>
    ${textElements}
  </svg>`
}

/* ------------------------------------------------------------------ */
/*  Markdown-it 插件入口                                               */
/* ------------------------------------------------------------------ */

export function svgDiagramPlugin(md: MarkdownIt): void {
  const originalFence =
    md.renderer.rules.fence ||
    function (
      tokens: Token[],
      idx: number,
      options: MarkdownIt.Options,
      env: unknown,
      self: { renderToken: (tokens: Token[], idx: number, options: MarkdownIt.Options) => string }
    ) {
      return self.renderToken(tokens, idx, options)
    }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const lang = token.info.trim().toLowerCase()

    // Only process unlabeled code blocks or those marked as text/txt
    // Do NOT touch language-specific blocks (js, python, mermaid, etc.)
    if (lang && lang !== 'text' && lang !== 'txt') {
      return originalFence(tokens, idx, options, env, self)
    }

    const content = token.content
    if (!isAsciiArt(content)) {
      return originalFence(tokens, idx, options, env, self)
    }

    // Compute hash for pre-rendered SVG lookup
    const hash = computeHash(content)

    // Check for pre-rendered SVG file
    const svgFilePath = path.join(PUBLIC_DIAGRAMS_DIR, `${hash}.svg`)
    if (fs.existsSync(svgFilePath)) {
      const imgHtml = `<div class="ascii-diagram-container"><img src="${BASE_PATH}diagrams/${hash}.svg" alt="diagram" class="ascii-diagram-img" loading="lazy" /></div>`
      return escapeVueBraces(imgHtml)
    }

    // Auto-generate inline SVG from ASCII art
    const svg = asciiToInlineSvg(content)
    return escapeVueBraces(
      `<div class="ascii-diagram-container">${svg}</div>`
    )
  }
}
