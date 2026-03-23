import type MarkdownIt from 'markdown-it'

/**
 * Advanced ASCII Diagram Converter
 * Converts ASCII art diagrams to Mermaid or SVG based on content analysis
 */

const BOX_DRAWING_CHARS = /[┌┐└┘├┤│─┬┴┼╔╗╚╝║═╠╣╦╩╬]/g
const ARROW_CHARS = /[→←↑↓⇒⇐⇑⇓]/g
const TREE_CHARS = /[├└│]/g

interface DiagramType {
  type: 'tree' | 'flow' | 'sequence' | 'graph' | 'unknown'
  confidence: number
}

function analyzeDiagramType(content: string): DiagramType {
  const lines = content.trim().split('\n')

  // Tree structure detection
  const treePattern = /^[\s]*[├└│]/
  const treeLines = lines.filter(l => treePattern.test(l)).length
  if (treeLines >= 3 && treeLines / lines.length > 0.4) {
    return { type: 'tree', confidence: 0.9 }
  }

  // Flow diagram detection (arrows with text)
  const flowPattern = /\s*[→←]\s*/
  const flowLines = lines.filter(l => flowPattern.test(l)).length
  if (flowLines >= 2) {
    return { type: 'flow', confidence: 0.85 }
  }

  // Sequence diagram detection (vertical flow with boxes)
  const hasBoxes = (content.match(BOX_DRAWING_CHARS) || []).length > 10
  const hasVerticalFlow = /[│║]/.test(content)
  if (hasBoxes && hasVerticalFlow) {
    return { type: 'sequence', confidence: 0.7 }
  }

  // Graph detection (complex connections)
  const hasArrows = (content.match(ARROW_CHARS) || []).length > 3
  if (hasBoxes && hasArrows) {
    return { type: 'graph', confidence: 0.8 }
  }

  return { type: 'unknown', confidence: 0.0 }
}

function convertTreeToMermaid(content: string): string {
  const lines = content.trim().split('\n')
  let mermaid = 'graph TD\n'
  const nodeMap = new Map<string, string>()
  let nodeId = 0

  // Parse tree structure
  const stack: Array<{ level: number; id: string; label: string }> = []

  for (const line of lines) {
    // Detect tree characters and indentation
    const match = line.match(/^(\s*)[├└│─]*\s*(.+?)(?:\s*—\s*(.+))?$/)
    if (!match) continue

    const [, indent, label, desc] = match
    const level = indent.length
    const cleanLabel = label.trim().replace(/[─├└│]/g, '').trim()
    if (!cleanLabel) continue

    const id = `n${nodeId++}`
    const fullLabel = desc ? `${cleanLabel}: ${desc}` : cleanLabel
    nodeMap.set(cleanLabel, id)

    // Find parent
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1]
      mermaid += `    ${parent.id}["${parent.label}"] --> ${id}["${fullLabel}"]\n`
    }

    stack.push({ level, id, label: fullLabel })
  }

  return mermaid
}

function convertFlowToMermaid(content: string): string {
  const lines = content.trim().split('\n')
  let mermaid = 'flowchart LR\n'
  const nodeMap = new Map<string, string>()
  let nodeId = 0

  for (const line of lines) {
    // Parse flow: A → B or A ──> B
    const arrowMatch = line.match(/(.+?)\s*[─→]+\s*(.+?)(?:\s*[─→]+\s*(.+))?/)
    if (!arrowMatch) continue

    const parts = arrowMatch.slice(1).filter(p => p && p.trim())

    for (let i = 0; i < parts.length; i++) {
      const current = parts[i].trim()
      if (!nodeMap.has(current)) {
        nodeMap.set(current, `n${nodeId++}`)
      }

      if (i < parts.length - 1) {
        const next = parts[i + 1].trim()
        if (!nodeMap.has(next)) {
          nodeMap.set(next, `n${nodeId++}`)
        }
        mermaid += `    ${nodeMap.get(current)}["${current}"] --> ${nodeMap.get(next)}["${next}"]\n`
      }
    }
  }

  return mermaid
}

function convertSequenceToMermaid(content: string): string {
  const lines = content.trim().split('\n')
  let mermaid = 'sequenceDiagram\n'

  // Extract participants and interactions
  const participants = new Set<string>()
  const interactions: Array<{ from: string; to: string; msg: string }> = []

  for (const line of lines) {
    // Look for patterns like: A ──> B or A │ B
    const match = line.match(/(\w+)\s*[─→│]+\s*(\w+)(?:\s*[：:]\s*(.+))?/)
    if (match) {
      const [, from, to, msg] = match
      participants.add(from)
      participants.add(to)
      interactions.push({ from, to, msg: msg || '' })
    }
  }

  // Add participants
  participants.forEach(p => {
    mermaid += `    participant ${p}\n`
  })

  // Add interactions
  interactions.forEach(({ from, to, msg }) => {
    mermaid += `    ${from}->>${to}: ${msg}\n`
  })

  return mermaid
}

function convertGraphToMermaid(content: string): string {
  const lines = content.trim().split('\n')
  let mermaid = 'graph TD\n'
  const nodes = new Set<string>()
  const edges: Array<{ from: string; to: string }> = []

  // Extract nodes and connections
  for (const line of lines) {
    // Simple node detection
    const nodeMatch = line.match(/[┌└├][─]+\s*(.+?)\s*[┐┘┤─]/g)
    if (nodeMatch) {
      nodeMatch.forEach(n => {
        const label = n.replace(/[┌└├┐┘┤─]/g, '').trim()
        if (label) nodes.add(label)
      })
    }

    // Connection detection
    const connMatch = line.match(/(\w+)\s*[→↓]\s*(\w+)/)
    if (connMatch) {
      edges.push({ from: connMatch[1], to: connMatch[2] })
    }
  }

  // Generate mermaid
  const nodeMap = new Map<string, string>()
  let nodeId = 0
  nodes.forEach(label => {
    const id = `n${nodeId++}`
    nodeMap.set(label, id)
    mermaid += `    ${id}["${label}"]\n`
  })

  edges.forEach(({ from, to }) => {
    const fromId = nodeMap.get(from) || from
    const toId = nodeMap.get(to) || to
    mermaid += `    ${fromId} --> ${toId}\n`
  })

  return mermaid
}

function convertToMermaid(content: string, type: DiagramType): string {
  try {
    switch (type.type) {
      case 'tree':
        return convertTreeToMermaid(content)
      case 'flow':
        return convertFlowToMermaid(content)
      case 'sequence':
        return convertSequenceToMermaid(content)
      case 'graph':
        return convertGraphToMermaid(content)
      default:
        return ''
    }
  } catch (e) {
    console.error('Mermaid conversion failed:', e)
    return ''
  }
}

function isAsciiDiagram(content: string): boolean {
  const boxDrawingCount = (content.match(BOX_DRAWING_CHARS) || []).length
  const arrowCount = (content.match(ARROW_CHARS) || []).length
  const treeCount = (content.match(TREE_CHARS) || []).length

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
    token.content = content

    // Only process unlabeled code blocks or blocks labeled as 'text' or 'ascii'
    if ((!lang || lang === 'text' || lang === 'plaintext' || lang === 'ascii') &&
        isAsciiDiagram(content)) {

      // Analyze and convert to Mermaid if possible
      const diagramType = analyzeDiagramType(content)

      if (diagramType.confidence >= 0.7) {
        const mermaidCode = convertToMermaid(content, diagramType)

        if (mermaidCode && mermaidCode.trim().split('\n').length > 2) {
          // Successfully converted to Mermaid - render as mermaid code block
          const mermaidToken = Object.assign({}, token)
          mermaidToken.info = 'mermaid'
          mermaidToken.content = mermaidCode

          const mermaidHtml = fence([mermaidToken], 0, options, env, self)

          return `<div class="mermaid-diagram-container" data-original-type="${diagramType.type}">
  ${mermaidHtml}
</div>
<details class="ascii-original">
  <summary>查看原始 ASCII 图表</summary>
  <pre class="ascii-diagram"><code>${md.utils.escapeHtml(content)}</code></pre>
</details>
`
        }
      }

      // Fallback to enhanced ASCII display
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
