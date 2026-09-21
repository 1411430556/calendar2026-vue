import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { codeInspectorPlugin } from 'code-inspector-plugin'

export default defineConfig({
  // GitHub Pages 项目页部署在 /calendar2026-vue/ 子路径下：
  // Actions 中构建时启用子路径 base，本地开发与预览保持根路径
  base: process.env.GITHUB_ACTIONS ? '/calendar2026-vue/' : '/',
  plugins: [
    vue(),
    codeInspectorPlugin({
      bundler: 'vite',
      editor: 'trae',
    }),
  ],
})
