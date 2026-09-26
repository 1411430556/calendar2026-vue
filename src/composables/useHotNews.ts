import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { buildApiUrl, createRateLimiter, fetchJson, toErrorMessage, unwrapData, type ApiEnvelope } from '../utils/api'
import { pad2 } from '../utils/format'
import { readStorageJSON, removeStorage, writeStorageJSON } from '../utils/storage'

// 百度热搜新闻榜的数据状态机：多榜单内存缓存 + localStorage 跨会话 SWR、
// 1 QPS 串行限速、typeName 校验重试、请求去重、首开全量预取、定时静默刷新。
// UI 状态（loading / error / softError）也在此集中管理，浮窗组件只负责展示与交互。

export interface HotItem {
  ranking: number | string
  hotScore: string
  hotTag: string
  hotTagImg: string | string[]
  desc: string
  hotChange: string
  url: string | string[]
  word: string
}

export interface CacheEntry {
  /** 本地抓取时间：缓存新鲜度判定依据 */
  ts: number
  /** 服务端榜单更新时间（可信时存在）：仅用于展示 */
  serverTs?: number
  list: HotItem[]
}

// 榜单配置：tab 参数取值依据接口文档
export const TABS = [
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

const API_URL = 'https://api.shwgij.com/api/news/baidu_news'

// 缓存时效：新鲜期内不重复请求；本地缓存超过保留期后清除
const FRESH_MS = 10 * 60_000
const STALE_MS = 30 * 60_000
// 浮窗打开期间每 5 分钟静默刷新当前榜单
const AUTO_MS = 5 * 60_000
// typeName 校验失败（被限流错返）时的重试退避
const RETRY_GAP_MS = 1200
const FETCH_TIMEOUT_MS = 10_000

/**
 * 服务端 updateTime 清洗：只接受近 30 天内、且不超前（允许 5 分钟时钟偏差）的秒级时间戳。
 * 实测部分榜单（如游戏）会返回 2023 年的脏时间戳，直接使用会让缓存永久过期、展示时间错误。
 */
export function resolveServerTs(updateTime: unknown, now: number = Date.now()): number | undefined {
  const n = Number(updateTime)
  if (!n) return undefined
  const ms = n * 1000
  if (ms > now + 5 * 60_000) return undefined
  if (ms < now - 30 * 24 * 60 * 60_000) return undefined
  return ms
}

/**
 * @param open 浮窗开合状态；仅在浮窗打开时响应榜单切换与定时刷新
 */
export function useHotNewsData(open: Ref<boolean>) {
  const activeTab = ref<string>(TABS[0].key)
  const items = ref<HotItem[]>([])
  const loading = ref(false)
  const error = ref('')
  const refreshing = ref(false)
  const lastUpdated = ref(0)
  const softError = ref('')

  // 内存缓存：同一标签页内切换榜单零请求
  const memCache = new Map<string, CacheEntry>()
  // 请求去重：同一榜单的并发请求全局复用
  const inflight = new Map<string, Promise<void>>()
  let autoTimer: number | undefined
  let softTimer: number | undefined

  // 接口 QPS 限制为 1 秒 1 次，全局串行队列保证间隔 ≥1.1s
  const serialized = createRateLimiter(1100)

  const storageKey = (tab: string) => `hotNews:v3:${tab}`

  function readStorage(tab: string): CacheEntry | null {
    const entry = readStorageJSON<CacheEntry>(storageKey(tab))
    if (entry && (!Array.isArray(entry.list) || Date.now() - entry.ts > STALE_MS)) {
      removeStorage(storageKey(tab))
      return null
    }
    return entry
  }

  const writeStorageEntry = (tab: string, entry: CacheEntry) => writeStorageJSON(storageKey(tab), entry)

  const currentLabel = computed(() => TABS.find((t) => t.key === activeTab.value)?.label ?? '热搜')
  const timeLabel = computed(() => {
    if (!lastUpdated.value) return ''
    const d = new Date(lastUpdated.value)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())} 更新`
  })

  async function requestRaw(tab: string): Promise<ApiEnvelope> {
    return fetchJson<ApiEnvelope>(buildApiUrl(API_URL, { tab }), FETCH_TIMEOUT_MS)
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
      let rawData: unknown
      let valid = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const json = await serialized(() => requestRaw(tab))
        const data = unwrapData<unknown>(json)
        // 兼容文档示例（data 为数组）与实际返回（data 为对象、列表在 content）
        const dataObj = (data ?? {}) as { typeName?: string }
        if (!Array.isArray(data) && dataObj.typeName && dataObj.typeName !== tab) {
          await new Promise((r) => setTimeout(r, RETRY_GAP_MS))
          continue
        }
        rawData = data
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
      writeStorageEntry(tab, entry)
      if (activeTab.value === tab) {
        items.value = entry.list
        lastUpdated.value = entry.serverTs ?? entry.ts
        error.value = ''
        softError.value = ''
      }
    } catch (e) {
      if (activeTab.value !== tab) return
      const msg = toErrorMessage(e)
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

  // 切换榜单：浮窗打开时才加载
  watch(activeTab, (tab) => {
    if (open.value) void loadTab(tab)
  })

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

  onBeforeUnmount(() => {
    stopAuto()
    window.clearTimeout(softTimer)
  })

  return {
    TABS,
    activeTab,
    items,
    loading,
    error,
    refreshing,
    lastUpdated,
    softError,
    currentLabel,
    timeLabel,
    loadTab,
    prefetchRest,
    ensureFetched,
    startAuto,
    stopAuto,
    onVisibility,
  }
}
