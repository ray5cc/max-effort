<template>
  <div class="diagram-block-wrapper">
    <pre class="diagram-block-content"><code v-html="highlighted" /></pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** Base64-encoded ASCII art diagram source */
  code: string
}>()

const decodedCode = computed(() => {
  try {
    return atob(props.code)
  } catch {
    return props.code
  }
})

/** Colorize box-drawing characters for visual clarity */
const highlighted = computed(() => {
  const text = decodedCode.value
  // Escape HTML entities first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Highlight box-drawing chars and arrows with color spans
  return escaped
    .replace(/([\u2500-\u257F]+)/g, '<span class="db-box">$1</span>')
    .replace(/(─+|═+)/g, '<span class="db-line">$1</span>')
    .replace(/(▶|◀|▲|▼|→|←|↑|↓|⇒|⇐|⟶|⟵|▸|◂)/g, '<span class="db-arrow">$1</span>')
    .replace(/(──►|──▶|◄──|◀──|──▷|◁──)/g, '<span class="db-arrow">$1</span>')
})
</script>

<style scoped>
.diagram-block-wrapper {
  margin: 1.5rem 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-code-block-bg);
}

.diagram-block-content {
  margin: 0;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  font-family: 'Courier New', 'Consolas', 'Liberation Mono', monospace;
  font-size: 0.82em;
  line-height: 1.55;
  white-space: pre;
  tab-size: 4;
  background: transparent;
  border: none;
  border-radius: 0;
}

.diagram-block-content code {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
  padding: 0;
  border-radius: 0;
  color: var(--vp-c-text-1);
}

/* Box drawing chars */
:deep(.db-box) {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

/* Arrow chars */
:deep(.db-arrow) {
  color: var(--vp-c-warning-1, #e8a317);
  font-weight: 700;
}

/* Horizontal lines that are part of boxes */
:deep(.db-line) {
  color: var(--vp-c-brand-1);
}

/* Mobile: ensure diagram scrolls properly */
@media (max-width: 640px) {
  .diagram-block-content {
    font-size: 0.72em;
    padding: 0.75rem 1rem;
  }
}
</style>
