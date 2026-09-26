import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApiUrl, fetchJson, unwrapData, toErrorMessage, createRateLimiter, API_KEY } from './api'

describe('buildApiUrl 查询参数拼装', () => {
  it('自动注入密钥参数', () => {
    const u = new URL(buildApiUrl('https://api.example.com/x'))
    expect(u.searchParams.get('key')).toBe(API_KEY)
  })

  it('附加参数并做 URL 编码', () => {
    const u = new URL(buildApiUrl('https://api.example.com/x', { tab: '热 搜', type: '4' }))
    expect(u.searchParams.get('tab')).toBe('热 搜')
    expect(u.searchParams.get('type')).toBe('4')
  })
})

describe('fetchJson 超时 JSON 请求', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('成功时返回解析后的 JSON，并传入超时 signal', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ code: 201, data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const json = await fetchJson('https://api.example.com/x')
    expect(json).toEqual({ code: 201, data: [] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/x',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('fetch 拒绝时异常原样向上传播', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    await expect(fetchJson('https://api.example.com/x')).rejects.toThrow('network down')
  })
})

describe('unwrapData 状态码归一化', () => {
  it('200 与 201 都按成功处理并返回 data', () => {
    expect(unwrapData({ code: 200, data: { a: 1 } })).toEqual({ a: 1 })
    expect(unwrapData<number[]>({ code: 201, data: [1, 2] })).toEqual([1, 2])
  })

  it('失败码抛出服务端 msg', () => {
    expect(() => unwrapData({ code: 500, msg: '服务炸了' })).toThrow('服务炸了')
  })

  it('失败码且无 msg 时抛出通用提示', () => {
    expect(() => unwrapData({ code: 403 })).toThrow('接口返回异常')
  })
})

describe('toErrorMessage 异常中文化', () => {
  it('AbortError 映射为超时提示', () => {
    expect(toErrorMessage(new DOMException('timeout', 'AbortError'))).toBe('请求超时，网络可能不稳定，请稍后重试')
  })

  it('普通 Error 取其 message', () => {
    expect(toErrorMessage(new Error('服务繁忙'))).toBe('服务繁忙')
  })

  it('未知异常使用兜底文案', () => {
    expect(toErrorMessage('字符串异常')).toBe('加载失败，请稍后重试')
    expect(toErrorMessage(null, '自定义兜底')).toBe('自定义兜底')
  })
})

describe('createRateLimiter 串行限速', () => {
  it('相邻任务实际开始间隔不小于设定值', async () => {
    const serialized = createRateLimiter(30)
    const starts: number[] = []
    const task = () => serialized(async () => starts.push(Date.now()))
    const begin = Date.now()
    await Promise.all([task(), task(), task()])
    expect(starts).toHaveLength(3)
    // 首个任务立即执行；后续两个各自等待约 30ms（留 5ms 调度容差）
    expect(starts[0] - begin).toBeLessThan(20)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(25)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(25)
  })

  it('单个任务失败不中断后续任务', async () => {
    const serialized = createRateLimiter(1)
    const results = await Promise.allSettled([
      serialized(async () => {
        throw new Error('boom')
      }),
      serialized(async () => 'ok'),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    if (results[1].status === 'fulfilled') expect(results[1].value).toBe('ok')
  })
})
