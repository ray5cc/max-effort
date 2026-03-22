<template>
  <div class="bookmark-review">
    <button
      class="bookmark-btn"
      :class="{ 'is-bookmarked': isBookmarked }"
      @click="toggleBookmark"
      :aria-label="isBookmarked ? '取消标记复习' : '标记为待复习'"
      :title="isBookmarked ? '取消标记复习' : '标记为待复习'"
    >
      <span class="bookmark-icon">{{ isBookmarked ? '⭐' : '☆' }}</span>
      <span class="bookmark-text">
        {{ isBookmarked ? '已标记复习' : '标记复习' }}
      </span>
    </button>

    <Transition name="toast">
      <div v-if="showToast" class="bookmark-toast">
        {{ toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useData, useRoute } from 'vitepress'

const { page } = useData()
const route = useRoute()

const isBookmarked = ref(false)
const showToast = ref(false)
const toastMessage = ref('')

const STORAGE_KEY = 'max-effort-bookmarks'

// Get current page path
const currentPath = computed(() => route.path)

// Load bookmarks from localStorage
const loadBookmarks = (): Set<string> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

// Save bookmarks to localStorage
const saveBookmarks = (bookmarks: Set<string>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...bookmarks]))
  } catch (error) {
    console.warn('Failed to save bookmarks:', error)
  }
}

// Check if current page is bookmarked
const checkBookmark = () => {
  const bookmarks = loadBookmarks()
  isBookmarked.value = bookmarks.has(currentPath.value)
}

// Toggle bookmark status
const toggleBookmark = () => {
  const bookmarks = loadBookmarks()

  if (isBookmarked.value) {
    bookmarks.delete(currentPath.value)
    toastMessage.value = '已取消标记'
  } else {
    bookmarks.add(currentPath.value)
    toastMessage.value = '已添加到复习列表'
  }

  saveBookmarks(bookmarks)
  isBookmarked.value = !isBookmarked.value

  // Show toast notification
  showToast.value = true
  setTimeout(() => {
    showToast.value = false
  }, 2000)
}

// Check bookmark status on mount and route change
onMounted(() => {
  checkBookmark()
})

// Re-check when route changes
import { watch } from 'vue'
watch(() => route.path, checkBookmark)
</script>

<style scoped>
.bookmark-review {
  position: relative;
  margin: 2rem 0;
  display: flex;
  justify-content: flex-end;
}

.bookmark-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background-color: transparent;
  color: var(--bookmark-inactive);
  border: 1.5px solid var(--bookmark-inactive);
  border-radius: 6px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s ease;
}

.bookmark-btn:hover {
  border-color: var(--bookmark-hover);
  color: var(--bookmark-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.bookmark-btn.is-bookmarked {
  background-color: var(--bookmark-active);
  border-color: var(--bookmark-active);
  color: white;
}

.bookmark-btn.is-bookmarked:hover {
  background-color: var(--bookmark-hover);
  border-color: var(--bookmark-hover);
}

.bookmark-icon {
  font-size: 1.125rem;
  line-height: 1;
  transition: transform 0.2s ease;
}

.bookmark-btn:hover .bookmark-icon {
  transform: scale(1.2);
}

.bookmark-text {
  font-size: 0.875rem;
}

/* Toast notification */
.bookmark-toast {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  padding: 0.75rem 1.25rem;
  background-color: var(--vp-c-brand-1);
  color: white;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 0.9375rem;
  font-weight: 500;
  z-index: 9999;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(1rem);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-1rem);
}

/* Accessibility */
@media (prefers-reduced-motion: reduce) {
  .bookmark-btn,
  .bookmark-icon,
  .bookmark-toast,
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
    transform: none;
  }
}

/* Mobile responsiveness */
@media (max-width: 640px) {
  .bookmark-toast {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    text-align: center;
  }
}
</style>
