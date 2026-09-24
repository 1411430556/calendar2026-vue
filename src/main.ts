import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// naive-ui 组件均在 App.vue 中按需具名导入，无需全量注册，便于 tree-shaking
createApp(App).mount('#app')

// PWA 离线缓存：仅生产环境注册，开发模式避免缓存干扰 HMR
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}
