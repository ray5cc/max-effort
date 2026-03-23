<template>
  <div class="mermaid-diagram-wrapper">
    <div v-if="rendered" class="mermaid-diagram" v-html="svg" />
    <pre v-else class="mermaid-fallback"><code>{{ decodedCode }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{
  /** Base64-encoded Mermaid diagram source */
  code: string
}>()

const svg = ref('')
const rendered = ref(false)

// Monotonically increasing counter for unique diagram IDs (avoids Math.random() collisions)
let diagramCounter = 0

const decodedCode = computed(() => {
  try {
    return atob(props.code)
  } catch (e) {
    console.warn('[MermaidDiagram] base64 decode failed, using raw code prop:', e)
    return props.code
  }
})

onMounted(async () => {
  if (typeof window === 'undefined') return
  try {
    const { default: mermaid } = await import('mermaid')
    const isDark =
      document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    })

    const id = `mermaid-diagram-${++diagramCounter}`
    const { svg: result } = await mermaid.render(id, decodedCode.value)
    svg.value = result
    rendered.value = true
  } catch (e) {
    console.error('[MermaidDiagram] render error:', e)
  }
})
</script>

<style scoped>
.mermaid-diagram-wrapper {
  margin: 1.5rem 0;
  text-align: center;
}

.mermaid-diagram :deep(svg) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

.mermaid-fallback {
  text-align: left;
  background: var(--vp-code-block-bg);
  border-radius: 8px;
  padding: 1rem 1.5rem;
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.6;
}
</style>
