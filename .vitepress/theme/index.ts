import DefaultTheme from 'vitepress/theme'
import MermaidDiagram from './components/MermaidDiagram.vue'
import './style.css'

export default {
  ...DefaultTheme,
  enhanceApp({ app }: { app: import('vue').App }) {
    app.component('MermaidDiagram', MermaidDiagram)
  },
}
