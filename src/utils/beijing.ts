// 北京时间（UTC+8）换算工具。
//
// 接口按北京时间返回"今天"的数据，因此需要在任意访客时区下都能求出正确的北京日期，
// 避免缓存键与展示日期错位。
//
// 原理：北京时间恒等于 UTC + 8 小时。在绝对时间戳上加 8 小时（480 分钟）后，
// 读取该 Date 的 UTC 分量（getUTCFullYear / getUTCMonth / getUTCDate / getUTCDay），
// 得到的就是北京时间的年/月/日/星期，与访客本地时区完全无关。
//
// 注意：不能混入 new Date().getTimezoneOffset()——那会把访客本地时区偏差带进来，
// 导致非 UTC 时区（如北京 UTC+8）在每天 0:00–8:00 算出前一天的日期。

const BEIJING_OFFSET_MIN = 480 // UTC+8

export function beijingNow(now: number = Date.now()): Date {
  return new Date(now + BEIJING_OFFSET_MIN * 60_000)
}
