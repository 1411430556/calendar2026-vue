// 相见拾光（shwgij）开放 API 公共请求层。
// 三个业务组件（每日一言 / 历史上的今天 / 百度热搜）共用：
// 密钥注入、查询参数编码、超时控制、响应码归一化、错误信息中文化与串行限速。

/** 默认请求超时（毫秒）：弱网挂起时及时进入错误态，而非永久骨架屏 */
const DEFAULT_TIMEOUT_MS = 10_000

/** 同一账号 API 密钥，来自 .env.local（不入库）；VITE_ 前缀变量会打包进前端产物 */
export const API_KEY = import.meta.env.VITE_HISTORY_API_KEY ?? ''

/**
 * 拼装带密钥的完整请求地址。
 * @param url 完整接口地址（https:// 开头）
 * @param params 额外查询参数，自动做 URL 编码
 */
export function buildApiUrl(url: string, params: Record<string, string> = {}): string {
  const u = new URL(url)
  u.searchParams.set('key', API_KEY)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/** 带超时的 JSON 请求；超时时 fetch 以 AbortError 拒绝 */
export async function fetchJson<T = unknown>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  return (await res.json()) as T
}

/** 接口统一响应包裹（实际返回还可能带 typeName / content / updateTime 等业务字段） */
export interface ApiEnvelope {
  code?: number
  msg?: string
  data?: unknown
}

/**
 * 校验业务状态码并取出 data。
 * 文档约定成功码为 200，实测部分接口（如百度热搜）返回 201，两者都按成功处理；
 * 失败时抛出服务端 msg，缺省 msg 时抛出通用提示。
 */
export function unwrapData<T = unknown>(json: ApiEnvelope): T {
  if (json.code !== 200 && json.code !== 201) throw new Error(json.msg || '接口返回异常')
  return json.data as T
}

/** 将请求异常归一化为面向用户的中文提示（超时 → 网络提示，Error → 其 message） */
export function toErrorMessage(e: unknown, fallback = '加载失败，请稍后重试'): string {
  if (e instanceof DOMException && e.name === 'AbortError') return '请求超时，网络可能不稳定，请稍后重试'
  if (e instanceof Error) return e.message
  return fallback
}

/**
 * 创建串行限速器：排队执行异步任务，保证相邻任务实际开始时间间隔 ≥ minGapMs。
 * 单个任务失败不中断队列。用于百度热搜接口 1 QPS 限制——
 * 实测请求过快时服务端会错返"上一个榜单"的数据。
 */
export function createRateLimiter(minGapMs: number) {
  let lastAt = 0
  let chain: Promise<unknown> = Promise.resolve()
  return function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const gap = minGapMs - (Date.now() - lastAt)
      if (gap > 0) await new Promise((r) => setTimeout(r, gap))
      lastAt = Date.now()
      return fn()
    })
    // 吞掉 rejection，避免一次失败污染整条链；具体错误仍由 run 自身向调用方传播
    chain = run.catch(() => {})
    return run
  }
}
