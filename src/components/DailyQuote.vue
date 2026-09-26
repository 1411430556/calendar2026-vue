<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface Quote {
  content: string
  from: string
}

// 每次一言（shwgij 随机诗词接口）：每次请求随机返回，刷新即换
const API_URL = 'https://api.shwgij.com/api/randtext/get'
// 密钥来自 .env.local（不入库），VITE_ 前缀变量会打包进产物；type=4 精选诗词、m=0
const API_KEY = import.meta.env.VITE_HISTORY_API_KEY ?? ''
// 请求失败时展示的预设兜底文案
const FALLBACK: Quote = { content: '路漫漫其修远兮，吾将上下而求索', from: '屈原 · 离骚' }

const quote = ref<Quote | null>(null)

// 接口返回 JSON，text 格式为"诗句。——朝代・作者《出处》"，按最后一个 —— 拆分正文与出处
function parsePayload(json: { data?: { text?: string } }): Quote | null {
  const text = json?.data?.text?.trim() ?? ''
  if (!text) return null
  const idx = text.lastIndexOf('——')
  return idx === -1
    ? { content: text, from: '' }
    : { content: text.slice(0, idx).trim(), from: text.slice(idx + 2).trim() }
}

async function load() {
  try {
    // 8 秒超时：弱网挂起时及时回退预设文案，避免骨架屏永久停留
    const res = await fetch(`${API_URL}?key=${encodeURIComponent(API_KEY)}&type=4&m=0`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(String(res.status))
    const parsed = parsePayload(await res.json())
    if (!parsed || !parsed.content) throw new Error('empty')
    quote.value = parsed
  } catch {
    // 静默回退到预设文案，不打断页面
    quote.value = FALLBACK
  }
}

onMounted(load)
</script>

<template>
  <div class="dq wrap">
    <div class="dq-card">
      <span class="dq-seal" aria-hidden="true">言</span>
      <Transition name="dq" mode="out-in">
        <span v-if="!quote" key="skel" class="dq-skel" aria-live="polite">每日一言加载中</span>
        <blockquote v-else key="quote" class="dq-body">
          <p class="dq-text">{{ quote.content }}</p>
          <cite v-if="quote.from" class="dq-from">—— {{ quote.from }}</cite>
        </blockquote>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.dq {
  padding: 22px 0 0;
}
.dq-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  box-shadow: var(--shadow);
  padding: 16px 22px;
  overflow: hidden;
}
.dq-card::after {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(185, 143, 62, 0.28);
  border-radius: calc(var(--r) - 4px);
  pointer-events: none;
}
.dq-seal {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  color: #fff;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-weight: 700;
  font-size: 1.125rem;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(142, 42, 30, 0.25);
  transform: rotate(-4deg);
}
.dq-body {
  margin: 0;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.dq-text {
  margin: 0;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 1.06rem;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.dq-text::before {
  content: '「';
  color: var(--gold);
  font-weight: 700;
  margin-right: 2px;
}
.dq-text::after {
  content: '」';
  color: var(--gold);
  font-weight: 700;
  margin-left: 2px;
}
.dq-from {
  color: var(--ink-3);
  font-size: 0.86rem;
  font-style: normal;
  white-space: nowrap;
}
.dq-skel {
  color: var(--ink-3);
  font-size: 0.95rem;
  letter-spacing: 0.14em;
  animation: dq-pulse 1.6s ease-in-out infinite;
}
@keyframes dq-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 0.8;
  }
}
/* 加载占位 → 正文：占位快速淡出，正文淡入 + 轻微上移归位 */
.dq-enter-active {
  transition: opacity 0.4s ease-out, transform 0.4s ease-out;
}
.dq-leave-active {
  transition: opacity 0.15s ease;
}
.dq-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.dq-leave-to {
  opacity: 0;
}
@media (max-width: 600px) {
  .dq-card {
    padding: 14px 16px;
    gap: 12px;
  }
  .dq-seal {
    width: 34px;
    height: 34px;
    font-size: 1rem;
  }
  .dq-text {
    font-size: 0.98rem;
  }
  .dq-from {
    white-space: normal;
  }
}
</style>
