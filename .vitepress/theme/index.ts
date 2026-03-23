import DefaultTheme from 'vitepress/theme'
import MermaidDiagram from './components/MermaidDiagram.vue'
import DiagramBlock from './components/DiagramBlock.vue'
import './style.css'

export default {
  ...DefaultTheme,
  enhanceApp({ app }: { app: import('vue').App }) {
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('DiagramBlock', DiagramBlock)
  },
}
