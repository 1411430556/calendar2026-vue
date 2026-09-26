// 展示层纯函数集合：数字补零、多态字段取值、热度缩写、排名升降映射、年份展示。
// 全部为无副作用纯函数，便于单元测试与跨组件复用。

/** 数字补零：1 → "01"，12 → "12" */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 接口的链接 / 图片字段可能是字符串或字符串数组（也可能缺失），
 * 统一取第一个值；无有效值时返回空字符串。
 */
export const firstOf = (v: string | string[] | null | undefined): string =>
  (Array.isArray(v) ? v[0] : v) || ''

/**
 * 热度数值缩写：4960920 → "496.1万"，125000000 → "1.3亿"；
 * 保留一位小数并去掉 ".0"；无法解析为数字时返回空字符串。
 */
export function formatHot(v: string): string {
  const n = Number(v)
  if (!n) return ''
  const trim = (x: number) => String(x).replace(/\.0$/, '')
  if (n >= 1e8) return `${trim(Number((n / 1e8).toFixed(1)))}亿`
  if (n >= 1e4) return `${trim(Number((n / 1e4).toFixed(1)))}万`
  return String(n)
}

/** 排名升降标记：接口可能出现 up/rise、down/fall、new 等取值，做容错映射 */
export function changeMeta(v: string): { text: string; cls: string } {
  const s = String(v ?? '').toLowerCase()
  if (s === 'up' || s === 'rise') return { text: '↑', cls: 'hw-change--up' }
  if (s === 'down' || s === 'fall') return { text: '↓', cls: 'hw-change--down' }
  if (s === 'new') return { text: '新', cls: 'hw-change--new' }
  return { text: '', cls: '' }
}

/** 年份展示：负数 → "公元前x年"；无法解析为数字时原样返回 */
export function yearLabel(y: string): string {
  const n = Number(y)
  if (Number.isNaN(n)) return y
  return n < 0 ? `公元前${-n}年` : `${n}年`
}
