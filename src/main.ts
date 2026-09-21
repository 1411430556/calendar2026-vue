import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// naive-ui 组件均在 App.vue 中按需具名导入，无需全量注册，便于 tree-shaking
createApp(App).mount('#app')
