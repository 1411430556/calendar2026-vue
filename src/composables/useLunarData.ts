import { ref } from 'vue'
import { beijingNow } from '../utils/beijing'
import { buildApiUrl, createRateLimiter, fetchJson, toErrorMessage, unwrapData, type ApiEnvelope } from '../utils/api'
import { toApiDate14, type LunarProData } from '../utils/lunar'
import { readStorageJSON, writeStorageJSON } from '../utils/storage'

// 农历黄历数据加载：localStorage 跨会话缓存 + 1 QPS 串行限速 + 序号兜底丢弃过期响应。
// 独立为 composable 以便对「缓存命中与进行中请求的竞态」做单元测试。

const API_URL = 'https://api.shwgij.com/api/lunars/lunarpro'

// 接口限制 1 秒 2 次：串行限速取 600ms 间隔，防止连续切换日期触发频控
const limiter = createRateLimiter(600)

/**
 * 取当前北京时间（UTC+8）的年月日时分秒，构造一个"本地墙钟读数 = 北京墙钟读数"的时间戳：
 * 选择器显示与接口语义（北京时间）保持一致，与访客本地时区无关（与 beijingNow 同理）
 */
export function beijingWallTs(now: number = Date.now()): number {
  const b = beijingNow(now)
  return new Date(
    b.getUTCFullYear(),
    b.getUTCMonth(),
    b.getUTCDate(),
    b.getUTCHours(),
    b.getUTCMinutes(),
    b.getUTCSeconds(),
  ).getTime()
}

export function useLunarData() {
  const selectedTs = ref(beijingWallTs())
  const data = ref<LunarProData | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** 当前已加载数据对应的 14 位请求参数，作为内容切换过渡的 key（时刻变则整体重播入场） */
  const stamp = ref('')

  let seq = 0
  function apply(d: LunarProData, key14: string) {
    data.value = d
    stamp.value = key14
  }

  async function load(ts: number, force = false) {
    const key14 = toApiDate14(ts)
    const cacheKey = `lunarPro:${key14}`
    if (!force) {
      // 同一时刻的历法数据不再变化，跨会话缓存直接渲染（脏 JSON 由存储层自动剔除）
      const cached = readStorageJSON<LunarProData>(cacheKey)
      if (cached) {
        // 递增序号：使任何进行中的旧请求被丢弃，避免其响应覆盖当前缓存数据
        // （修复：缓存命中路径此前未递增 seq，导致慢响应回写覆盖用户刚选中的日期）
        ++seq
        apply(cached, key14)
        return
      }
    }
    // 序号兜底：慢响应返回时若用户已改选新时刻，丢弃过期结果
    const my = ++seq
    loading.value = true
    error.value = ''
    try {
      // 10 秒超时：弱网挂起时进入错误态并展示"重新加载"，而非永久骨架屏
      const json = await limiter(() => fetchJson<ApiEnvelope>(buildApiUrl(API_URL, { date: key14 }), 10_000))
      if (my !== seq) return
      const d = unwrapData<LunarProData>(json)
      if (!d || typeof d !== 'object') throw new Error('接口返回异常')
      writeStorageJSON(cacheKey, d)
      apply(d, key14)
    } catch (e) {
      if (my !== seq) return
      error.value = toErrorMessage(e)
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function onPick(ts: number | null) {
    if (ts == null) return
    selectedTs.value = ts
    void load(ts)
  }

  /** 回到当前时刻并强制刷新（跳过缓存） */
  function goNow() {
    selectedTs.value = beijingWallTs()
    void load(selectedTs.value, true)
  }

  return {
    selectedTs,
    data,
    loading,
    error,
    stamp,
    load,
    onPick,
    goNow,
  }
}
