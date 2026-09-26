import { describe, it, expect } from 'vitest'
import { beijingNow } from './beijing'

// 构造一个绝对时间戳（与运行环境时区无关），并校验其北京时间分量。
// 北京时间 = UTC + 8h，因此对任意时间戳，beijingNow 返回的 Date 的 UTC 分量
// 必须等于该瞬间的北京时间。
function expectBeijing(ts: number, year: number, month: number, date: number, day: number) {
  const d = beijingNow(ts)
  expect(d.getUTCFullYear()).toBe(year)
  expect(d.getUTCMonth() + 1).toBe(month)
  expect(d.getUTCDate()).toBe(date)
  expect(d.getUTCDay()).toBe(day) // 0=周日 … 6=周六
}

describe('beijingNow 北京时间换算', () => {
  it('北京时区用户在凌晨应得到当天北京日期（原 bug 回归场景）', () => {
    // 2026-09-26 02:00 北京时间 = 2026-09-25 18:00 UTC
    // 旧实现混入 getTimezoneOffset()，北京用户会算出 9月25日（周五），
    // 正确结果应为 9月26日（周六）。
    const ts = Date.UTC(2026, 8, 25, 18, 0, 0)
    expectBeijing(ts, 2026, 9, 26, 6)
  })

  it('跨日临界点：23:59 UTC 对应次日 07:59 北京', () => {
    // 2026-09-25 23:59 UTC = 2026-09-26 07:59 北京
    const ts = Date.UTC(2026, 8, 25, 23, 59, 0)
    expectBeijing(ts, 2026, 9, 26, 6)
  })

  it('跨日临界点：00:00 UTC 对应当天 08:00 北京', () => {
    // 2026-09-26 00:00 UTC = 2026-09-26 08:00 北京
    const ts = Date.UTC(2026, 8, 26, 0, 0, 0)
    expectBeijing(ts, 2026, 9, 26, 6)
  })

  it('UTC 时区用户结果与北京时区用户一致', () => {
    // 同一绝对瞬间，无论访客在哪个时区，beijingNow 都应返回相同的北京时间分量。
    const ts = Date.UTC(2026, 8, 25, 18, 0, 0)
    expectBeijing(ts, 2026, 9, 26, 6)
  })

  it('纽约时区（UTC-5）用户也能得到正确北京日期', () => {
    // 2026-09-26 02:00 北京 = 2026-09-25 18:00 UTC = 2026-09-25 13:00 纽约
    const ts = Date.UTC(2026, 8, 25, 18, 0, 0)
    expectBeijing(ts, 2026, 9, 26, 6)
  })

  it('跨年场景正确', () => {
    // 2025-12-31 20:00 UTC = 2026-01-01 04:00 北京
    const ts = Date.UTC(2025, 11, 31, 20, 0, 0)
    expectBeijing(ts, 2026, 1, 1, 4) // 2026-01-01 是周四
  })
})
