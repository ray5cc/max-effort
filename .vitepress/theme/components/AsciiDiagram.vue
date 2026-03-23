<template>
  <div class="ascii-diagram">
    <pre><code>{{ content }}</code></pre>
  </div>
</template>

<script setup>
defineProps({
  content: {
    type: String,
    required: true
  }
})
</script>

<style scoped>
.ascii-diagram {
  background: var(--vp-code-block-bg);
  border-radius: 8px;
  padding: 20px;
  margin: 16px 0;
  overflow-x: auto;
}

.ascii-diagram pre {
  margin: 0;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
}

.ascii-diagram code {
  background: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
}

/* Enhance visibility of box-drawing characters */
.ascii-diagram pre {
  font-feature-settings: "liga" 0;
  font-variant-ligatures: none;
}
</style>
