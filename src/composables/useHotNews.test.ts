import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveServerTs } from './useHotNews'

// resolveServerTs 是纯时间戳清洗函数（不触发 composable 的任何响应式逻辑），
// 固定 Date.now() 后可确定性地验证"脏时间戳"过滤规则。

const NOW = new Date('2026-09-26T12:00:00Z').getTime()

describe('resolveServerTs 服务端更新时间清洗', () => {
  afterEach(() => vi.restoreAllMocks())

  it('近 30 天内的秒级时间戳转换为毫秒', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const secs = Math.floor((NOW - 60_000) / 1000)
    expect(resolveServerTs(secs, NOW)).toBe(secs * 1000)
  })

  it('30 天前的时间戳判为脏数据返回 undefined（历史 bug：2023 年时间戳致缓存永久过期）', () => {
    const old = Math.floor(new Date('2023-01-01T00:00:00Z').getTime() / 1000)
    expect(resolveServerTs(old, NOW)).toBeUndefined()
  })

  it('超过 5 分钟时钟偏差的未来时间戳返回 undefined', () => {
    const future = Math.floor((NOW + 6 * 60_000) / 1000)
    expect(resolveServerTs(future, NOW)).toBeUndefined()
  })

  it('允许 5 分钟以内的轻微超前（时钟偏差容错）', () => {
    const nearFuture = Math.floor((NOW + 4 * 60_000) / 1000)
    expect(resolveServerTs(nearFuture, NOW)).toBe(nearFuture * 1000)
  })

  it('零值 / 非数字 / 空值返回 undefined', () => {
    expect(resolveServerTs(0, NOW)).toBeUndefined()
    expect(resolveServerTs('abc', NOW)).toBeUndefined()
    expect(resolveServerTs(undefined, NOW)).toBeUndefined()
    expect(resolveServerTs(null, NOW)).toBeUndefined()
  })

  it('恰好 30 天边界内的时间戳仍然有效', () => {
    const boundary = Math.floor((NOW - 30 * 24 * 60 * 60_000 + 60_000) / 1000)
    expect(resolveServerTs(boundary, NOW)).toBe(boundary * 1000)
  })
})
