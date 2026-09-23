<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface HistoryItem {
  ranking: number
  year: string
  title: string
  type: string
  desc: string
  link: string | string[]
}

const API_URL = 'https://api.shwgij.com/api/today/onthisday'
// 密钥来自 .env.local（不入库），VITE_ 前缀变量会打包进产物
const API_KEY = import.meta.env.VITE_HISTORY_API_KEY ?? ''

const TYPE_MAP: Record<string, { seal: string; color: string; tint: string }> = {
  birth: { seal: '诞', color: 'var(--teal)', tint: 'var(--teal-tint)' },
  death: { seal: '逝', color: 'var(--ink-3)', tint: '#efe9dc' },
  event: { seal: '事', color: 'var(--red)', tint: 'var(--red-tint)' },
  festival: { seal: '节', color: 'var(--gold)', tint: 'var(--gold-tint)' },
}
const typeOf = (t: string) => TYPE_MAP[t] ?? TYPE_MAP.event

const pad = (n: number) => String(n).padStart(2, '0')
// API 按北京时间返回"今天"，统一换算成 UTC+8 再取日期，避免访客时区导致缓存键与内容错位
function beijingNow() {
  return new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60_000)
}
const bj = beijingNow()
const dateLabel = `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日`
const weekLabel = `星期${'日一二三四五六'[bj.getUTCDay()]}`
const cacheKey = `historyToday:${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`

const open = ref(false)
const loading = ref(false)
const error = ref('')
const items = ref<HistoryItem[]>([])
let loaded = false

async function load(force = false) {
  if (!force) {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        items.value = JSON.parse(cached)
        loaded = true
        return
      } catch {
        localStorage.removeItem(cacheKey)
      }
    }
  }
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`${API_URL}?key=${encodeURIComponent(API_KEY)}`)
    const json = await res.json()
    if (json.code !== 200 && json.code !== 201) throw new Error(json.msg || '接口返回异常')
    items.value = json.data ?? []
    localStorage.setItem(cacheKey, JSON.stringify(items.value))
    loaded = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function openPanel() {
  open.value = true
  if (!loaded && !loading.value) load()
}

const panelRef = ref<HTMLElement | null>(null)
// 滚轮锁定在浮窗内：非列表区域一律拦截；列表滚到边界时也拦截，防止链动到整页
function onPanelWheel(e: WheelEvent) {
  const list = e.target instanceof Element ? e.target.closest('.ht-list') : null
  if (!list) {
    e.preventDefault()
    return
  }
  const atTop = list.scrollTop <= 0
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1
  if ((e.deltaY <= 0 && atTop) || (e.deltaY >= 0 && atBottom)) e.preventDefault()
}
watch(open, async (v) => {
  if (!v) {
    document.removeEventListener('pointerdown', onDocPointerDown)
    return
  }
  await nextTick()
  panelRef.value?.addEventListener('wheel', onPanelWheel, { passive: false })
  document.addEventListener('pointerdown', onDocPointerDown)
})

// 点击浮窗外部任意区域关闭（pointerdown 同时覆盖鼠标/触摸/笔；浮窗内部点击不触发）
function onDocPointerDown(e: PointerEvent) {
  const panel = panelRef.value
  if (panel && e.target instanceof Node && !panel.contains(e.target)) open.value = false
}
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})

const yearLabel = (y: string) => {
  const n = Number(y)
  return Number.isNaN(n) ? y : n < 0 ? `公元前${-n}年` : `${n}年`
}
const linkOf = (link: HistoryItem['link']) => (Array.isArray(link) ? link[0] : link) || ''
const cleanDesc = (s: string) => s.replace(/【相见拾光】/g, '').trim()
</script>

<template>
  <!-- 收起态：右侧竖排签 -->
  <button class="ht-tab" :class="{ 'ht-tab--hide': open }" @click="openPanel" aria-label="查看历史上的今天">
    历史上的今天
  </button>

  <!-- 展开态：浮窗面板 -->
  <Transition name="ht">
    <div v-if="open" ref="panelRef" class="ht-panel" role="dialog" aria-label="历史上的今天">
      <header class="ht-head">
        <span class="ht-wm" aria-hidden="true">史</span>
        <div>
          <div class="ht-kicker">ON THIS DAY</div>
          <h3 class="ht-title">历史上的今天</h3>
          <div class="ht-date">
            <span class="ht-date-seal">{{ dateLabel }}</span>
            {{ weekLabel }}
          </div>
        </div>
      </header>

      <div class="ht-list">
        <template v-if="loading">
          <div v-for="i in 6" :key="i" class="ht-skeleton">
            <span class="ht-skel ht-skel--year"></span>
            <span class="ht-skel ht-skel--dot"></span>
            <span class="ht-skel-wrap">
              <span class="ht-skel ht-skel--title"></span>
              <span class="ht-skel ht-skel--desc"></span>
            </span>
          </div>
        </template>

        <div v-else-if="error" class="ht-error">
          <div class="ht-error-icon">!</div>
          <p>{{ error }}</p>
          <button class="ht-retry" @click="load(true)">重新加载</button>
        </div>

        <div v-else-if="items.length === 0" class="ht-empty">今日暂无历史记录</div>

        <ol v-else class="ht-timeline">
          <li v-for="(it, i) in items" :key="it.ranking" class="ht-item" :style="{ '--i': i }">
            <span class="ht-year">{{ yearLabel(it.year) }}</span>
            <span class="ht-dot" :style="{ '--dot-c': typeOf(it.type).color, '--dot-t': typeOf(it.type).tint }"></span>
            <div class="ht-body">
              <component
                :is="linkOf(it.link) ? 'a' : 'span'"
                class="ht-item-title"
                :href="linkOf(it.link) || undefined"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="ht-seal" :style="{ background: typeOf(it.type).tint, color: typeOf(it.type).color }">
                  {{ typeOf(it.type).seal }}
                </span>
                {{ it.title }}
              </component>
              <p v-if="it.desc" class="ht-desc">{{ cleanDesc(it.desc) }}</p>
            </div>
          </li>
        </ol>
      </div>

      <footer class="ht-foot">数据来源 · 相见拾光 API · 仅供参考</footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ============ 收起态竖排签 ============ */
.ht-tab {
  position: fixed;
  right: 0;
  top: 50%;
  z-index: 70;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  letter-spacing: 0.42em;
  padding: 20px 11px;
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  /* 回归动画延迟 450ms：等面板离场动画播完后再淡入上移归位，避免突兀闪现 */
  transition: padding 0.3s ease, opacity 0.4s ease-out 450ms,
    transform 0.4s ease-out 450ms, visibility 0s linear 450ms;
}
.ht-tab:hover {
  padding-right: 18px;
}
.ht-tab--hide {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  /* 隐藏时下沉 10px，回归时上移归位形成入场动画；隐藏立即生效，与面板入场同步 */
  transform: translateY(calc(-50% + 10px));
  transition: padding 0.3s ease, opacity 0.3s ease, transform 0.3s ease, visibility 0s;
}

/* ============ 浮窗面板 ============ */
.ht-panel {
  position: fixed;
  right: clamp(8px, 2vw, 24px);
  top: 50%;
  z-index: 71;
  transform: translateY(-50%);
  width: min(384px, 92vw);
  max-height: min(76vh, 680px);
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  overscroll-behavior: contain;
}
/* 装裱式内描金细框 */
.ht-panel::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(185, 143, 62, 0.4);
  border-radius: 10px;
  pointer-events: none;
}
/* 离场与入场共用同一过渡：容器淡出时子内容随之同步衰减，文字与容器起止完全一致 */
.ht-enter-active,
.ht-leave-active {
  transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.ht-enter-from,
.ht-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(60px) scale(0.97);
}

/* ============ 头部 ============ */
.ht-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 14px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border-bottom: 1px solid var(--line);
}
/* 「史」字水印 */
.ht-wm {
  position: absolute;
  right: 44px;
  top: 50%;
  transform: translateY(-46%) rotate(10deg);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 78px;
  font-weight: 900;
  line-height: 1;
  color: rgba(190, 58, 43, 0.07);
  pointer-events: none;
  user-select: none;
}
.ht-kicker {
  font-size: 0.66rem;
  letter-spacing: 0.3em;
  color: var(--gold);
  font-weight: 600;
}
.ht-title {
  font-size: 1.22rem;
  font-weight: 900;
  color: var(--ink);
  margin-top: 2px;
}
.ht-date {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--ink-3);
}
.ht-date-seal {
  display: inline-block;
  font-family: 'Noto Serif SC', Georgia, serif;
  background: var(--card);
  border: 1.5px solid var(--red);
  color: var(--red);
  font-weight: 700;
  font-size: 0.76rem;
  padding: 1px 8px;
  border-radius: 7px;
  transform: rotate(-3deg);
  box-shadow: 1px 1px 0 rgba(190, 58, 43, 0.22);
}
/* ============ 时间线列表 ============ */
.ht-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 20px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.ht-list::-webkit-scrollbar {
  width: 5px;
}
.ht-list::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}

.ht-timeline {
  list-style: none;
}
.ht-item {
  position: relative;
  display: grid;
  grid-template-columns: 56px 20px 1fr;
  padding-bottom: 16px;
  opacity: 0;
  animation: ht-in 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  animation-delay: calc(var(--i) * 70ms);
}
@keyframes ht-in {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
/* 时间线竖线 */
.ht-item::before {
  content: '';
  position: absolute;
  left: 65px;
  top: 14px;
  bottom: -2px;
  width: 2px;
  background: var(--line);
}
.ht-item:last-child::before {
  display: none;
}

.ht-year {
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-3);
  text-align: right;
  padding: 4px 8px 0 0;
  line-height: 1.5;
}
.ht-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin: 8px auto 0;
  background: var(--dot-c);
  box-shadow: 0 0 0 3px var(--dot-t);
  animation: ht-ping 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) backwards;
  animation-delay: calc(var(--i) * 70ms + 350ms);
  transition: transform 0.25s ease;
}
/* 节点入场波纹 */
@keyframes ht-ping {
  0% {
    box-shadow: 0 0 0 0 var(--dot-c);
    opacity: 0;
    transform: scale(0.4);
  }
  55% {
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 9px transparent;
    transform: scale(1.15);
  }
  100% {
    box-shadow: 0 0 0 3px var(--dot-t);
    opacity: 1;
    transform: scale(1);
  }
}
.ht-body {
  min-width: 0;
  transition: transform 0.3s ease;
}
.ht-item:hover .ht-body {
  transform: translateX(3px);
}
.ht-item:hover a.ht-item-title {
  color: var(--red);
}
.ht-item:hover .ht-dot {
  transform: scale(1.4);
}
.ht-item-title {
  display: block;
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--ink-2);
  line-height: 1.55;
  text-decoration: none;
  transition: color 0.25s ease;
}
a.ht-item-title:hover {
  color: var(--red);
}
.ht-seal {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  line-height: 17px;
  text-align: center;
  border: 1px solid currentColor;
  border-radius: 6px;
  margin-right: 6px;
  vertical-align: 2px;
}
.ht-desc {
  margin-top: 3px;
  font-size: 0.8rem;
  color: var(--ink-3);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ============ 骨架屏 / 错误 / 空态 ============ */
.ht-skeleton {
  display: grid;
  grid-template-columns: 56px 20px 1fr;
  padding-bottom: 18px;
}
.ht-skel {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--gold-tint) 25%, var(--paper-2) 50%, var(--gold-tint) 75%);
  background-size: 200% 100%;
  animation: ht-shimmer 1.4s ease infinite;
}
@keyframes ht-shimmer {
  to {
    background-position: -200% 0;
  }
}
.ht-skel--year {
  height: 12px;
  margin: 5px 10px 0 auto;
  width: 40px;
}
.ht-skel--dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin: 8px auto 0;
}
.ht-skel--title {
  height: 14px;
  width: 82%;
}
.ht-skel--desc {
  height: 11px;
  width: 95%;
  margin-top: 8px;
}
.ht-skel-wrap {
  display: block;
}

.ht-error,
.ht-empty {
  text-align: center;
  padding: 40px 10px;
  color: var(--ink-3);
  font-size: 0.88rem;
}
.ht-error-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--red-tint);
  color: var(--red);
  font-size: 20px;
  font-weight: 700;
  line-height: 40px;
}
.ht-retry {
  margin-top: 12px;
  padding: 6px 18px;
  border: 1px solid var(--red);
  border-radius: 999px;
  background: transparent;
  color: var(--red);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}
.ht-retry:hover {
  background: var(--red);
  color: #fff;
}

/* ============ 底部 ============ */
.ht-foot {
  /* 底部多留出 5px 金框双线区域，文字整体上移，在「顶边线↔金线」可见区间内视觉居中 */
  padding: 6px 20px 12px;
  border-top: 1px solid var(--line);
  background: var(--paper-2);
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  color: var(--ink-3);
}

/* 键盘焦点可见性 */
.ht-tab:focus-visible,
.ht-retry:focus-visible,
a.ht-item-title:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

@media (max-width: 600px) {
  .ht-panel {
    right: 4vw;
  }
}
</style>
