<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NIcon, NTabPane, NTabs } from 'naive-ui'
import { Close, Refresh } from '@vicons/ionicons5'

// ============ 类型定义 ============
interface HotItem {
  ranking: number | string
  hotScore: string
  hotTag: string
  hotTagImg: string | string[]
  desc: string
  hotChange: string
  url: string | string[]
  word: string
}
interface CacheEntry {
  // 本地抓取时间：缓存新鲜度判定依据
  ts: number
  // 服务端榜单更新时间（可信时存在）：仅用于展示
  serverTs?: number
  list: HotItem[]
}

const API_URL = 'https://api.shwgij.com/api/news/baidu_news'
// 与「历史上的今天」同一账号密钥，来自 .env.local（不入库）
const API_KEY = import.meta.env.VITE_HISTORY_API_KEY ?? ''

// 榜单配置：tab 参数取值依据接口文档
const TABS = [
  { key: 'realtime', label: '热搜' },
  { key: 'livelihood', label: '民生' },
  { key: 'finance', label: '财经' },
  { key: 'phrase', label: '热梗' },
  { key: 'novel', label: '小说' },
  { key: 'movie', label: '电影' },
  { key: 'teleplay', label: '电视剧' },
  { key: 'car', label: '汽车' },
  { key: 'game', label: '游戏' },
] as const

// 缓存时效：新鲜期内不重复请求；本地缓存超过保留期后清除
const FRESH_MS = 10 * 60_000
const STALE_MS = 30 * 60_000
// 浮窗打开期间每 5 分钟静默刷新当前榜单
const AUTO_MS = 5 * 60_000

// ============ 状态 ============
const open = ref(false)
const activeTab = ref<string>(TABS[0].key)
const items = ref<HotItem[]>([])
const loading = ref(false)
const error = ref('')
const refreshing = ref(false)
const lastUpdated = ref(0)
const softError = ref('')

// 内存缓存：同一标签页内切换榜单零请求
const memCache = new Map<string, CacheEntry>()
let autoTimer: number | undefined
let softTimer: number | undefined
const panelRef = ref<HTMLElement | null>(null)

const currentLabel = computed(() => TABS.find((t) => t.key === activeTab.value)?.label ?? '热搜')
const timeLabel = computed(() => {
  if (!lastUpdated.value) return ''
  const d = new Date(lastUpdated.value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} 更新`
})

// ============ 请求限速队列 ============
// 接口 QPS 限制为 1 秒 1 次；实测请求间隔不足时服务端会错返"上一个榜单"内容。
// 对策：全局串行队列保证间隔 ≥1.1s，并在响应中校验 data.typeName 是否与请求一致
let lastReqAt = 0
let reqChain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = reqChain.then(async () => {
    const gap = 1100 - (Date.now() - lastReqAt)
    if (gap > 0) await new Promise((r) => setTimeout(r, gap))
    lastReqAt = Date.now()
    return fn()
  })
  reqChain = run.catch(() => {})
  return run
}
async function requestRaw(tab: string) {
  // 10 秒超时：弱网挂起时进入错误/软错误态，而非永久骨架屏
  const res = await fetch(
    `${API_URL}?key=${encodeURIComponent(API_KEY)}&tab=${encodeURIComponent(tab)}`,
    { signal: AbortSignal.timeout(10000) },
  )
  return res.json()
}

// ============ 本地缓存（localStorage，跨会话 stale-while-revalidate） ============
// v3：旧版把服务端 updateTime 当作抓取时间，游戏榜脏时间戳会导致缓存永久过期，升级版本键废弃旧结构
const storageKey = (tab: string) => `hotNews:v3:${tab}`

// 服务端 updateTime 清洗：只接受近 30 天内、且不超前（允许 5 分钟时钟偏差）的时间。
// 实测部分榜单（如游戏）会返回 2023 年的脏时间戳，直接使用会让缓存永久过期、展示时间错误
function resolveServerTs(updateTime: unknown): number | undefined {
  const n = Number(updateTime)
  if (!n) return undefined
  const ms = n * 1000
  const now = Date.now()
  if (ms > now + 5 * 60_000) return undefined
  if (ms < now - 30 * 24 * 60 * 60_000) return undefined
  return ms
}
function readStorage(tab: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(storageKey(tab))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (!Array.isArray(entry.list) || Date.now() - entry.ts > STALE_MS) {
      localStorage.removeItem(storageKey(tab))
      return null
    }
    return entry
  } catch {
    localStorage.removeItem(storageKey(tab))
    return null
  }
}
function writeStorage(tab: string, entry: CacheEntry) {
  try {
    localStorage.setItem(storageKey(tab), JSON.stringify(entry))
  } catch {
    // 配额超限（隐私模式等）：忽略，内存缓存仍然生效
  }
}

// ============ 数据加载 ============
async function loadTab(tab: string, opts: { force?: boolean } = {}) {
  const { force = false } = opts
  if (!force) {
    // 1. 内存缓存命中且新鲜：直接使用
    const mem = memCache.get(tab)
    if (mem && Date.now() - mem.ts < FRESH_MS) {
      applyEntry(tab, mem)
      return
    }
    // 2. 本地缓存：先展示，新鲜则直接返回，过期则后台静默刷新
    const cached = readStorage(tab)
    if (cached) {
      applyEntry(tab, cached)
      if (Date.now() - cached.ts < FRESH_MS) return
      void ensureFetched(tab, true)
      return
    }
  }
  // 3. 无可用缓存或手动强制：进入显式加载态
  loading.value = true
  refreshing.value = true
  error.value = ''
  await ensureFetched(tab, false)
}

// ============ 请求去重与全量预取 ============
// 同一榜单的请求全局复用：预取进行中用户切到该榜单时，等待同一个请求即可，不重复发起
const inflight = new Map<string, Promise<void>>()
function ensureFetched(tab: string, silent: boolean): Promise<void> {
  const existing = inflight.get(tab)
  if (existing) return existing
  const p = fetchList(tab, silent).finally(() => inflight.delete(tab))
  inflight.set(tab, p)
  return p
}

// 首次打开浮窗：后台串行预取当前榜单之外的全部榜单（限速队列保证 QPS），
// 用户后续切换任意榜单时数据已在内存缓存中，直接渲染、零等待
async function prefetchRest(current: string) {
  for (const t of TABS) {
    if (t.key === current) continue
    const mem = memCache.get(t.key)
    if (mem && Date.now() - mem.ts < FRESH_MS) continue
    const cached = readStorage(t.key)
    if (cached) {
      applyEntry(t.key, cached)
      if (Date.now() - cached.ts < FRESH_MS) continue
    }
    try {
      await ensureFetched(t.key, true)
    } catch {
      // 单个榜单预取失败不影响其余榜单；用户切到该榜单时会显式重试
    }
  }
}

function applyEntry(tab: string, entry: CacheEntry) {
  memCache.set(tab, entry)
  if (activeTab.value !== tab) return
  items.value = entry.list
  // 展示优先用服务端榜单更新时间，不可信时回退到本地抓取时间
  lastUpdated.value = entry.serverTs ?? entry.ts
  loading.value = false
  error.value = ''
}

async function fetchList(tab: string, silent: boolean) {
  if (!silent) refreshing.value = true
  try {
    // 最多 3 次：typeName 不符（被限流错返）时退避重试
    let json: { code?: number; msg?: string; data?: unknown }
    let rawData: unknown
    let valid = false
    for (let attempt = 0; attempt < 3; attempt++) {
      json = await serialized(() => requestRaw(tab))
      // 接口成功状态码实际为 201（文档示例为 200），两者都按成功处理
      if (json.code !== 200 && json.code !== 201) throw new Error(json.msg || '接口返回异常')
      rawData = json.data
      // 兼容文档示例（data 为数组）与实际返回（data 为对象、列表在 content）
      const dataObj = (rawData ?? {}) as { typeName?: string; content?: unknown }
      if (
        !Array.isArray(rawData) &&
        dataObj.typeName &&
        dataObj.typeName !== tab
      ) {
        await new Promise((r) => setTimeout(r, 1200))
        continue
      }
      valid = true
      break
    }
    if (!valid) throw new Error('服务繁忙，榜单数据暂时不可用，请稍后重试')
    const list: HotItem[] = Array.isArray(rawData)
      ? rawData
      : Array.isArray((rawData as { content?: unknown })?.content)
        ? ((rawData as { content: HotItem[] }).content)
        : []
    // data.updateTime 为榜单更新时间（秒级 Unix 时间戳）；
    // 抓取时间恒取本地时间用于缓存判定，服务端时间经清洗后仅用于展示
    const updateTime = (rawData as { updateTime?: number })?.updateTime
    const entry: CacheEntry = { ts: Date.now(), serverTs: resolveServerTs(updateTime), list }
    memCache.set(tab, entry)
    writeStorage(tab, entry)
    if (activeTab.value === tab) {
      items.value = entry.list
      lastUpdated.value = entry.serverTs ?? entry.ts
      error.value = ''
      softError.value = ''
    }
  } catch (e) {
    if (activeTab.value !== tab) return
    const msg =
      e instanceof DOMException && e.name === 'AbortError'
        ? '请求超时，网络可能不稳定，请稍后重试'
        : e instanceof Error
          ? e.message
          : '加载失败，请稍后重试'
    // 已有榜单数据时保留旧数据，仅在底部给出软提示；无数据才展示整页错误态
    if (items.value.length === 0) error.value = msg
    else {
      softError.value = '刷新失败，将稍后自动重试'
      window.clearTimeout(softTimer)
      softTimer = window.setTimeout(() => (softError.value = ''), 8000)
    }
  } finally {
    if (activeTab.value === tab) {
      loading.value = false
      refreshing.value = false
    }
  }
}

// 切换榜单：加载数据
watch(activeTab, (tab) => {
  if (open.value) void loadTab(tab)
})

// ============ 浮窗开关 ============
function openPanel() {
  open.value = true
  void loadTab(activeTab.value)
  // 后台预取其余全部榜单，预取完成后切换任何标签都是即时渲染
  void prefetchRest(activeTab.value)
}
function closePanel() {
  open.value = false
}

// 面板离场动画结束后才摘除全局互斥标记：两个侧签同时开始回归过渡
function onAfterLeave() {
  if (!open.value) document.documentElement.classList.remove('hotnews-open')
}

// ============ 定时刷新（页面隐藏时暂停，可见时按需恢复） ============
function startAuto() {
  stopAuto()
  autoTimer = window.setInterval(() => {
    if (document.hidden) return
    void ensureFetched(activeTab.value, true)
  }, AUTO_MS)
}
function stopAuto() {
  if (autoTimer !== undefined) {
    window.clearInterval(autoTimer)
    autoTimer = undefined
  }
}
function onVisibility() {
  if (!open.value) return
  if (document.hidden) {
    stopAuto()
    return
  }
  const mem = memCache.get(activeTab.value)
  if (!mem || Date.now() - mem.ts >= FRESH_MS) void ensureFetched(activeTab.value, true)
  startAuto()
}

// ============ 点击外部关闭 ============
function onDocPointerDown(e: PointerEvent) {
  if (panelRef.value && e.target instanceof Node && !panelRef.value.contains(e.target)) closePanel()
}

// 滚轮锁定在浮窗内：列表滚到边界时拦截，防止链动整页
function onPanelWheel(e: WheelEvent) {
  const list = e.target instanceof Element ? e.target.closest('.hw-list') : null
  if (!list) {
    e.preventDefault()
    return
  }
  const atTop = list.scrollTop <= 0
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1
  if ((e.deltaY <= 0 && atTop) || (e.deltaY >= 0 && atBottom)) e.preventDefault()
}
const isNarrow = () => window.matchMedia('(max-width: 600px)').matches

watch(open, async (v) => {
  if (!v) {
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.removeEventListener('visibilitychange', onVisibility)
    // 注意：hotnews-open 不在此处摘除，需等面板离场动画结束（onAfterLeave），
    // 否则本侧签会比「历史上的今天」提前恢复，两者回归不同步
    document.body.style.overflow = ''
    stopAuto()
    return
  }
  // 打开期间隐藏两个侧签（全局 CSS 依据此标记处理，与「历史上的今天」同步隐藏）
  document.documentElement.classList.add('hotnews-open')
  if (isNarrow()) document.body.style.overflow = 'hidden'
  await nextTick()
  panelRef.value?.addEventListener('wheel', onPanelWheel, { passive: false })
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('visibilitychange', onVisibility)
  startAuto()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('visibilitychange', onVisibility)
  document.documentElement.classList.remove('hotnews-open')
  document.body.style.overflow = ''
  stopAuto()
  window.clearTimeout(softTimer)
})

// ============ 展示辅助 ============
const firstOf = (v: string | string[]) => (Array.isArray(v) ? v[0] : v) || ''
const itemLink = (it: HotItem) => firstOf(it.url)
const tagImgOf = (v: string | string[]) => firstOf(v)

const isTop = (it: HotItem) => typeof it.ranking === 'string'
function rankClass(it: HotItem) {
  if (isTop(it)) return 'hw-rank--top'
  const r = Number(it.ranking)
  if (r === 1) return 'hw-rank--1'
  if (r === 2) return 'hw-rank--2'
  if (r === 3) return 'hw-rank--3'
  return ''
}
const rankLabel = (it: HotItem) => (isTop(it) ? '顶' : String(it.ranking))

// 热度格式化：4960920 → 496.1万
function formatHot(v: string) {
  const n = Number(v)
  if (!n) return ''
  const trim = (x: number) => String(x).replace(/\.0$/, '')
  if (n >= 1e8) return `${trim(Number((n / 1e8).toFixed(1)))}亿`
  if (n >= 1e4) return `${trim(Number((n / 1e4).toFixed(1)))}万`
  return String(n)
}

// 排名升降：接口可能出现 up/down/same/new，做容错映射
function changeMeta(v: string): { text: string; cls: string } {
  const s = String(v ?? '').toLowerCase()
  if (s === 'up' || s === 'rise') return { text: '↑', cls: 'hw-change--up' }
  if (s === 'down' || s === 'fall') return { text: '↓', cls: 'hw-change--down' }
  if (s === 'new') return { text: '新', cls: 'hw-change--new' }
  return { text: '', cls: '' }
}
</script>

<template>
  <!-- 收起态：桌面为右侧竖排签（位于「历史上的今天」下方），移动端为左下角胶囊按钮。
       显隐由全局 html.hotnews-open / html.history-open 统一控制，保证两侧签同步 -->
  <button class="hw-tab" aria-label="查看百度热搜" @click="openPanel">
    <span class="hw-tab-text">百度热搜</span>
  </button>

  <!-- 遮罩：仅移动端显示，点击关闭 -->
  <Transition name="hw-mask">
    <div v-if="open" class="hw-mask" aria-hidden="true" @click="closePanel"></div>
  </Transition>

  <!-- 展开态：桌面为右侧浮窗，移动端（≤600px）为底部抽屉 -->
  <Transition name="hw" @after-leave="onAfterLeave">
    <div v-if="open" ref="panelRef" class="hw-panel" role="dialog" aria-label="百度热搜新闻榜">
      <header class="hw-head">
        <div class="hw-head-info">
          <div class="hw-kicker">BAIDU HOT SEARCH</div>
          <h3 class="hw-title">百度热搜</h3>
        </div>
        <div class="hw-actions">
          <span v-if="timeLabel" class="hw-updated">
            <i class="hw-live-dot" aria-hidden="true"></i>{{ timeLabel }}
          </span>
          <button
            class="hw-icon-btn"
            :class="{ 'is-spin': refreshing }"
            title="刷新榜单"
            aria-label="刷新榜单"
            @click="loadTab(activeTab, { force: true })"
          >
            <n-icon :size="16"><Refresh /></n-icon>
          </button>
          <button class="hw-icon-btn" title="关闭" aria-label="关闭浮窗" @click="closePanel">
            <n-icon :size="17"><Close /></n-icon>
          </button>
        </div>
      </header>

      <!-- 榜单切换；仅用其标签栏，列表区域由下方自定义渲染。
           标签栏向右出血至面板边缘外，后续标签被硬裁剪露出部分文字，直观提示还有更多榜单 -->
      <div class="hw-tabs-wrap">
        <n-tabs
          v-model:value="activeTab"
          class="hw-tabs"
          size="small"
          trigger="click"
          :pane-wrapper-style="{ display: 'none' }"
        >
          <n-tab-pane v-for="t in TABS" :key="t.key" :name="t.key">
            <template #tab>{{ t.label }}</template>
          </n-tab-pane>
        </n-tabs>
      </div>

      <div class="hw-list">
        <Transition name="hw-swap" mode="out-in">
          <!-- 骨架屏 -->
          <div v-if="loading" :key="`loading-${activeTab}`" class="hw-skeletons">
            <div v-for="i in 7" :key="i" class="hw-skel-row">
              <span class="hw-skel hw-skel--rank"></span>
              <span class="hw-skel-wrap">
                <span class="hw-skel hw-skel--word"></span>
                <span class="hw-skel hw-skel--desc"></span>
              </span>
              <span class="hw-skel hw-skel--score"></span>
            </div>
          </div>

          <!-- 错误态（无缓存数据时） -->
          <div v-else-if="error && items.length === 0" :key="`error-${activeTab}`" class="hw-error">
            <div class="hw-error-icon">!</div>
            <p>{{ error }}</p>
            <button class="hw-retry" @click="loadTab(activeTab, { force: true })">重新加载</button>
          </div>

          <!-- 空态 -->
          <div v-else-if="items.length === 0" key="empty" class="hw-error">当前榜单暂无数据</div>

          <!-- 榜单列表：key 含榜单名，切换时重播入场动画；静默刷新不换 key、无动画打扰 -->
          <ol v-else :key="`list-${activeTab}`" class="hw-items" :aria-label="`百度${currentLabel}榜`">
            <li
              v-for="(it, i) in items"
              :key="String(it.ranking) + it.word"
              class="hw-item"
              :style="{ '--i': Math.min(i, 12) }"
            >
              <component
                :is="itemLink(it) ? 'a' : 'div'"
                class="hw-row"
                :href="itemLink(it) || undefined"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="hw-rank" :class="rankClass(it)">{{ rankLabel(it) }}</span>
                <span class="hw-main">
                  <span class="hw-word">
                    {{ it.word }}
                    <img
                      v-if="tagImgOf(it.hotTagImg)"
                      :src="tagImgOf(it.hotTagImg)"
                      class="hw-tagimg"
                      alt=""
                      loading="lazy"
                    >
                  </span>
                  <span v-if="it.desc" class="hw-desc">{{ it.desc }}</span>
                </span>
                <span class="hw-meta">
                  <span v-if="formatHot(it.hotScore)" class="hw-score">{{ formatHot(it.hotScore) }}</span>
                  <span
                    v-if="changeMeta(it.hotChange).text"
                    class="hw-change"
                    :class="changeMeta(it.hotChange).cls"
                  >
                    {{ changeMeta(it.hotChange).text }}
                  </span>
                </span>
              </component>
            </li>
          </ol>
        </Transition>
      </div>

      <footer class="hw-foot">
        <span v-if="softError" class="hw-soft-error">{{ softError }}</span>
        <span v-else>数据来源 · 百度热搜 · 相见拾光 API · 仅供参考</span>
      </footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ============ 收起态竖排签 ============ */
.hw-tab {
  position: fixed;
  right: env(safe-area-inset-right, 0px);
  top: 75%;
  z-index: 70;
  transform: translateY(-50%);
  padding: 18px 11px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  color: #fff;
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  /* 回归延迟 450ms：等浮窗离场播完再淡入，避免突兀闪现；
     隐藏态样式由全局 styles.css 的互斥避让规则统一提供（与 .ht-tab 同步） */
  transition: padding 0.3s ease, opacity 0.4s ease-out 450ms,
    transform 0.4s ease-out 450ms, visibility 0s linear 450ms;
}
.hw-tab-text {
  writing-mode: vertical-rl;
  letter-spacing: 0.42em;
  font-size: 0.875rem;
  font-weight: 700;
}
@media (hover: hover) and (pointer: fine) {
  .hw-tab:hover {
    padding-right: 18px;
  }
}
/* ============ 浮窗面板 ============ */
.hw-panel {
  position: fixed;
  right: max(clamp(8px, 2vw, 24px), env(safe-area-inset-right, 0px));
  top: 50%;
  z-index: 71;
  transform: translateY(-50%);
  width: min(384px, 92vw);
  /* 高度恒定：骨架屏 / 列表 / 错误态下面板长度始终一致，避免先短后长 */
  height: min(78vh, 700px);
  /* dvh 跟随 iOS 动态工具栏，避免地址栏收缩时高度跳动 */
  height: min(78dvh, 700px);
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
.hw-panel::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(185, 143, 62, 0.4);
  border-radius: 10px;
  pointer-events: none;
}
.hw-enter-active,
.hw-leave-active {
  transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.hw-enter-from,
.hw-leave-to {
  opacity: 0;
  /* 不使用 scale：缩放会让面板视觉上先小后大，只做横向位移 + 透明，高度始终恒定 */
  transform: translateY(-50%) translateX(60px);
}

/* ============ 头部 ============ */
.hw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px 12px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border-bottom: 1px solid var(--line);
}
.hw-kicker {
  font-size: 0.66rem;
  letter-spacing: 0.3em;
  color: var(--gold);
  font-weight: 600;
}
.hw-title {
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--ink);
  margin-top: 2px;
}
.hw-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hw-updated {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.7rem;
  color: var(--ink-3);
}
.hw-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--red);
  animation: hw-pulse 1.8s ease-in-out infinite;
}
@keyframes hw-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
.hw-icon-btn {
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .hw-icon-btn:hover {
    background: var(--red-tint);
    color: var(--red);
  }
}
.hw-icon-btn.is-spin :deep(svg) {
  animation: hw-spin 0.9s linear infinite;
}
@keyframes hw-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ============ Tabs ============ */
.hw-tabs-wrap {
  flex: none;
}
.hw-tabs {
  /* 左侧内边距收窄 + 标签内边距收窄，使整体标签排布左移：
     第 5 个标签「小说」被面板右缘硬裁剪时，「小」字完整露出并带出「说」字边缘，
     直观提示后方还有更多榜单 */
  padding: 0 0 0 8px;
  border-bottom: 1px solid var(--line);
}
.hw-tabs :deep(.n-tabs-tab) {
  font-size: 0.84rem;
  font-weight: 700;
  padding: 8px 10px;
}
.hw-tabs :deep(.n-tabs-bar) {
  height: 2.5px;
  border-radius: 999px;
}

/* ============ 榜单列表 ============ */
.hw-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 7px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.hw-list::-webkit-scrollbar {
  width: 5px;
}
.hw-list::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}
.hw-items {
  list-style: none;
}
.hw-item {
  opacity: 0;
  animation: hw-item-in 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i) * 32ms);
}
/* 淡入 + 轻微上移入场 */
@keyframes hw-item-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.hw-row {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 10px;
  text-decoration: none;
  transition: background 0.25s ease, transform 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .hw-row:hover {
    background: var(--paper-2);
    transform: translateX(2px);
  }
  .hw-row:hover .hw-word {
    color: var(--red);
  }
  .hw-row:hover .hw-rank {
    transform: scale(1.12);
  }
}
.hw-rank {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--paper-2);
  color: var(--ink-3);
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.78rem;
  font-weight: 700;
  transition: transform 0.25s ease;
}
.hw-rank--1 {
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  color: #fff;
}
.hw-rank--2 {
  background: linear-gradient(165deg, #dd8040 0%, #c3612a 100%);
  color: #fff;
}
.hw-rank--3 {
  background: linear-gradient(165deg, var(--gold) 0%, #9d762d 100%);
  color: #fff;
}
.hw-rank--top {
  background: var(--red-deep);
  color: #fff;
  font-size: 0.7rem;
}
.hw-main {
  min-width: 0;
}
.hw-word {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--ink-2);
  line-height: 1.45;
  transition: color 0.25s ease;
}
.hw-tagimg {
  flex: none;
  height: 16px;
  width: auto;
}
.hw-desc {
  display: block;
  margin-top: 1px;
  font-size: 0.73rem;
  color: var(--ink-3);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hw-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.hw-score {
  font-size: 0.72rem;
  color: var(--ink-3);
  white-space: nowrap;
}
.hw-change {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
}
.hw-change--up {
  color: var(--red);
}
.hw-change--down {
  color: var(--teal);
}
.hw-change--new {
  color: var(--gold);
}

/* ============ 状态切换过渡（骨架 ↔ 列表、榜单切换） ============ */
.hw-swap-enter-active {
  transition: opacity 0.35s ease-out, transform 0.35s ease-out;
}
.hw-swap-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.hw-swap-leave-active {
  transition: opacity 0.18s ease;
}
.hw-swap-leave-to {
  opacity: 0;
}

/* ============ 骨架屏 ============ */
.hw-skel-row {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px;
}
.hw-skel {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--gold-tint) 25%, var(--paper-2) 50%, var(--gold-tint) 75%);
  background-size: 200% 100%;
  animation: hw-shimmer 1.4s ease infinite;
}
@keyframes hw-shimmer {
  to {
    background-position: -200% 0;
  }
}
.hw-skel--rank {
  width: 24px;
  height: 24px;
  border-radius: 7px;
}
.hw-skel-wrap {
  min-width: 0;
}
.hw-skel--word {
  height: 13px;
  width: 72%;
}
.hw-skel--desc {
  height: 10px;
  width: 92%;
  margin-top: 7px;
}
.hw-skel--score {
  width: 38px;
  height: 11px;
}

/* ============ 错误态 ============ */
.hw-error {
  text-align: center;
  padding: 42px 10px;
  color: var(--ink-3);
  font-size: 0.88rem;
}
.hw-error-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--red-tint);
  color: var(--red);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 40px;
}
.hw-retry {
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
@media (hover: hover) and (pointer: fine) {
  .hw-retry:hover {
    background: var(--red);
    color: #fff;
  }
}

/* ============ 底部 ============ */
.hw-foot {
  flex: none;
  padding: 7px 16px 10px;
  border-top: 1px solid var(--line);
  background: var(--paper-2);
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.hw-soft-error {
  color: var(--red);
  letter-spacing: 0.04em;
}

/* 键盘焦点可见性 */
.hw-tab:focus-visible,
.hw-icon-btn:focus-visible,
.hw-retry:focus-visible,
a.hw-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* ============ 遮罩（桌面隐藏，移动端显示） ============ */
.hw-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: none;
  background: rgba(20, 15, 8, 0.5);
}
.hw-mask-enter-active,
.hw-mask-leave-active {
  transition: opacity 0.4s ease;
}
.hw-mask-enter-from,
.hw-mask-leave-to {
  opacity: 0;
}

/* ============ 移动端（≤600px）：竖排签 → 左下胶囊，浮窗 → 底部抽屉 ============ */
@media (max-width: 600px) {
  .hw-mask {
    display: block;
  }
  .hw-tab {
    top: auto;
    right: auto;
    left: max(14px, env(safe-area-inset-left, 0px));
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    transform: none;
    padding: 9px 17px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    box-shadow: var(--shadow);
  }
  .hw-tab-text {
    writing-mode: horizontal-tb;
    letter-spacing: 0.14em;
    font-size: 0.8rem;
  }
  .hw-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    /* 高度恒定：与桌面态一致，任何状态下抽屉长度不变 */
    height: 82vh;
    height: 82dvh;
    border-radius: 18px 18px 0 0;
    transform: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  /* 抽屉从底部滑入/滑出（覆盖桌面态横向位移关键帧） */
  .hw-enter-from,
  .hw-leave-to {
    transform: translateY(100%);
  }
}
</style>
