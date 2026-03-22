import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import RecallBlock from './components/RecallBlock.vue'
import BookmarkReview from './components/BookmarkReview.vue'
import './style.css'
import './memory-colors.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Register global components
    app.component('RecallBlock', RecallBlock)
    app.component('BookmarkReview', BookmarkReview)
  },
} satisfies Theme
