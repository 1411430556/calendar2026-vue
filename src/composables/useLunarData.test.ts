import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLunarData } from './useLunarData'

// useLunarData 内部依赖全局 fetch 与 localStorage；测试中分别桩为可控的
// 延迟 Promise 与内存存储，以复现「缓存命中与进行中请求的竞态」。

class MemStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// 构造一个 yyyyMMddHHmmss 时间戳（toApiDate14 按本地分量取位）
const tsAt = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 8, 0, 0).getTime()

const DAY_A = tsAt(2026, 1, 1)
const DAY_B = tsAt(2026, 2, 1)

const dataA = { Solar: '2026年1月1日', Week: '星期四' }
const dataB = { Solar: '2026年2月1日', Week: '星期日' }

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useLunarData 缓存命中与进行中请求的竞态', () => {
  it('缓存命中后，进行中的旧请求响应不得覆盖已展示的缓存数据', async () => {
    // 预置：日期 B 已有本地缓存
    localStorage.setItem('lunarPro:20260201080000', JSON.stringify(dataB))

    // A 的请求用延迟 Promise 控制，模拟慢网
    const aFetch = deferred<{ json: () => Promise<unknown> }>()
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('20260101')) return aFetch.promise
      return Promise.resolve({ json: async () => ({ code: 200, data: {} }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { data, stamp, load } = useLunarData()

    // 1. 加载日期 A：无缓存，发起请求（进行中）
    void load(DAY_A)
    // 让出微任务，使 limiter 内的 await 执行到 fetch 调用
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(data.value).toBeNull()

    // 2. 在 A 的响应返回前，加载日期 B：命中缓存，应立即展示 B
    await load(DAY_B)
    expect(data.value).toEqual(dataB)
    expect(stamp.value).toBe('20260201080000')

    // 3. A 的慢响应终于返回
    aFetch.resolve({ json: async () => ({ code: 200, data: dataA }) })
    // 等待 fetch 链路上的所有微任务排空
    await new Promise((r) => setTimeout(r, 0))

    // 4. 断言：B 的缓存数据仍然展示，未被 A 的响应覆盖
    expect(data.value).toEqual(dataB)
    expect(stamp.value).toBe('20260201080000')
  })

  it('无缓存路径正常：请求返回后展示对应数据', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ code: 200, data: dataA }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { data, stamp, load } = useLunarData()

    await load(DAY_A)

    expect(data.value).toEqual(dataA)
    expect(stamp.value).toBe('20260101080000')
  })

  it('force=true 跳过缓存并使旧请求失效', async () => {
    // 预置 A 的缓存
    localStorage.setItem('lunarPro:20260101080000', JSON.stringify({ Solar: 'stale' }))

    const fetchMock = vi.fn(async () => ({ json: async () => ({ code: 200, data: dataA }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { data, load } = useLunarData()

    await load(DAY_A, true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(data.value).toEqual(dataA)
  })
})
