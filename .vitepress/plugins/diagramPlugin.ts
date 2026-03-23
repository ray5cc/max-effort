/**
 * Markdown-it plugin: ASCII Diagram Enhancement
 *
 * Automatically detects code blocks containing box-drawing characters
 * or tree-branch patterns and renders them as colorized, graphical
 * diagram containers in VitePress.
 *
 * On GitHub, the original ASCII art in code fences renders normally (text).
 * In VitePress, the same content is displayed with colored borders, arrows,
 * and a styled container — providing a graphical presentation.
 */
import type MarkdownIt from 'markdown-it'

/* ---- detection patterns ---- */

const BOX_DRAWING_RE = /[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╬─│═║]/g
const COLORIZE_RE =
  /([┌┐└┘├┤┬┴┼╔╗╚╝╠╣╬─│═║])|([→←↑↓▶◀▲▼►◄▸◂▴▾⟶⟵⟹⟸])/g

/**
 * Detect tree branch patterns like "  /   \" used in tree diagrams.
 * Matches lines where / and \ appear as visual branch connectors
 * (surrounded by whitespace, not as part of paths or code).
 */
const TREE_BRANCH_SAME_LINE_RE = /^\s+[/\\]\s+[/\\]/gm

/**
 * Detect individual branch lines where / or \ is used as a tree connector.
 * The character must be preceded by whitespace and followed by whitespace or EOL,
 * which distinguishes branches from file paths like /usr/bin.
 */
const TREE_BRANCH_SINGLE_RE = /^\s+[/\\](?:\s|$)/gm

/**
 * Determine if a fence block looks like an ASCII diagram.
 * Only unlabeled / text-labelled code blocks are considered.
 */
function isDiagram(content: string, info: string): boolean {
  const lang = (info || '').trim().split(/\s+/)[0].toLowerCase()
  if (lang && lang !== 'text' && lang !== 'plaintext') return false

  // Method 1: Box-drawing characters (≥4)
  const boxMatches = content.match(BOX_DRAWING_RE)
  if (boxMatches && boxMatches.length >= 4) return true

  // Method 2: Tree branch patterns — both / and \ on the same line (≥2 lines)
  const sameLineMatches = content.match(TREE_BRANCH_SAME_LINE_RE)
  if (sameLineMatches && sameLineMatches.length >= 2) return true

  // Method 3: Individual branch lines — / or \ as tree connectors (≥3 lines)
  const singleMatches = content.match(TREE_BRANCH_SINGLE_RE)
  if (singleMatches && singleMatches.length >= 3) return true

  return false
}

/* ---- HTML helpers ---- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\{\{/g, '&#123;&#123;')
    .replace(/\}\}/g, '&#125;&#125;')
}

/**
 * Colorize box-drawing and arrow characters by wrapping them in spans.
 * Border chars → .dg-b   Arrow chars → .dg-a
 */
function colorize(escaped: string): string {
  return escaped.replace(COLORIZE_RE, (_match, border, arrow) => {
    if (border) return `<span class="dg-b">${border}</span>`
    if (arrow) return `<span class="dg-a">${arrow}</span>`
    return _match
  })
}

/* ---- plugin entry ---- */

export function diagramPlugin(md: MarkdownIt): void {
  const originalFence =
    md.renderer.rules.fence ||
    function (tokens: any, idx: number, options: any, _env: any, self: any) {
      return self.renderToken(tokens, idx, options)
    }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]

    if (isDiagram(token.content, token.info)) {
      const html = colorize(escapeHtml(token.content))
      return (
        '<div class="vp-diagram-container">' +
        '<pre class="vp-diagram"><code>' +
        html +
        '</code></pre>' +
        '</div>\n'
      )
    }

    return originalFence(tokens, idx, options, env, self)
  }
}
