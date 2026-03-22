<template>
  <div class="recall-block" :class="{ 'is-revealed': isRevealed }">
    <div class="recall-header">
      <div class="recall-icon">🧠</div>
      <h4 class="recall-title">{{ title || '自测回忆' }}</h4>
    </div>
    <div class="recall-question">
      <slot name="question"></slot>
    </div>
    <button
      v-if="!isRevealed"
      class="recall-reveal-btn"
      @click="reveal"
      aria-label="显示答案"
    >
      点击查看答案 →
    </button>
    <div v-show="isRevealed" class="recall-answer">
      <div class="answer-label">参考答案：</div>
      <slot name="answer"></slot>
      <button class="recall-reset-btn" @click="reset" aria-label="重新隐藏">
        重新测试
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  title?: string
}>()

const isRevealed = ref(false)

const reveal = () => {
  isRevealed.value = true
}

const reset = () => {
  isRevealed.value = false
}
</script>

<style scoped>
.recall-block {
  margin: 2rem 0;
  padding: 1.5rem;
  background-color: var(--memory-recall-bg);
  border: 2px solid var(--memory-recall-border);
  border-radius: 8px;
  transition: all 0.3s ease;
}

.recall-block.is-revealed {
  border-color: var(--memory-practice-border);
  background-color: var(--memory-practice-bg);
}

.recall-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.recall-icon {
  font-size: 1.5rem;
  line-height: 1;
}

.recall-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--memory-recall-heading);
}

.recall-block.is-revealed .recall-title {
  color: var(--memory-practice-heading);
}

.recall-question {
  margin-bottom: 1rem;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  color: var(--memory-recall-text);
  font-size: 1rem;
  line-height: 1.6;
}

.dark .recall-question {
  background-color: rgba(0, 0, 0, 0.2);
}

.recall-reveal-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.625rem 1.25rem;
  background-color: var(--memory-recall-border);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.recall-reveal-btn:hover {
  background-color: var(--memory-recall-heading);
  transform: translateX(4px);
}

.recall-answer {
  margin-top: 1rem;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
  border-left: 4px solid var(--memory-practice-border);
  animation: fadeIn 0.3s ease;
}

.dark .recall-answer {
  background-color: rgba(0, 0, 0, 0.3);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.answer-label {
  font-weight: 600;
  color: var(--memory-practice-heading);
  margin-bottom: 0.5rem;
  font-size: 0.9375rem;
}

.recall-reset-btn {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background-color: transparent;
  color: var(--memory-recall-border);
  border: 1px solid var(--memory-recall-border);
  border-radius: 4px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.recall-reset-btn:hover {
  background-color: var(--memory-recall-border);
  color: white;
}

/* Accessibility */
@media (prefers-reduced-motion: reduce) {
  .recall-block,
  .recall-reveal-btn,
  .recall-answer {
    transition: none;
    animation: none;
  }
}
</style>
