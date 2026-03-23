import type MarkdownIt from 'markdown-it'

/**
 * VitePress plugin to enhance ASCII art diagrams
 * Automatically wraps ASCII art code blocks in a visual container
 */

const BOX_DRAWING_CHARS = /[┌┐└┘├┤│─┬┴┼╔╗╚╝║═╠╣╦╩╬]/g
const ARROW_CHARS = /[→←↑↓⇒⇐⇑⇓]/g
const TREE_CHARS = /[├└│]/g

function isAsciiDiagram(content: string): boolean {
  const boxDrawingCount = (content.match(BOX_DRAWING_CHARS) || []).length
  const arrowCount = (content.match(ARROW_CHARS) || []).length
  const treeCount = (content.match(TREE_CHARS) || []).length

  // Heuristic: likely ASCII art if it has enough special chars
  return boxDrawingCount >= 3 || treeCount >= 3 || arrowCount >= 2
}

export function asciiDiagramPlugin(md: MarkdownIt) {
  const fence = md.renderer.rules.fence!

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    let content = token.content
    const lang = token.info.trim()

    // Escape {{ }} in ALL fence blocks to prevent Vue template errors
    content = content.replace(/\{\{/g, '&#123;&#123;').replace(/\}\}/g, '&#125;&#125;')

    // Update token content with escaped version
    token.content = content

    // Only process unlabeled code blocks or blocks labeled as 'text' or 'ascii'
    if ((!lang || lang === 'text' || lang === 'plaintext' || lang === 'ascii') &&
        isAsciiDiagram(content)) {
      // Wrap in a special container for visual rendering
      const escapedContent = md.utils.escapeHtml(content)
      return `<div class="ascii-diagram-container">
  <pre class="ascii-diagram"><code>${escapedContent}</code></pre>
</div>
`
    }

    // Use default renderer for other code blocks
    return fence(tokens, idx, options, env, self)
  }
}
