// 农历阴历黄历 Pro（相见拾光）数据模型与展示层纯函数。
// 接口约定：date 参数传 14 位日期时间（yyyyMMddHHmmss）；节日 / 数九 / 三伏等时节性
// 字段可能为空，为空时不展示（文档原文"将会自动隐藏此类空值"）。

import { pad2 } from './format'

/** 接口返回体：字段可能缺省或为空串 / 0，全部按可选处理 */
export interface LunarProData {
  // ---- 公历 ----
  Solar?: string
  Week?: string
  IsLeapYear?: boolean
  MonthDayCount?: number
  DaysInYear?: number
  YearDayCount?: number
  WeekInMonth?: number
  WeekInYear?: number
  HalfYear?: number
  Quarter?: number
  Constellation?: string
  Festivals?: string
  OtherFestivals?: string
  JulianDay?: number
  // ---- 农历 ----
  LunarYear?: string
  Lunar?: string
  LunarMonthDayCount?: number
  LunarYearDayCount?: number
  IsLeapMonth?: boolean
  FoDate?: string
  DaoDate?: string
  ThisYear?: string
  Lunar_Festivals?: string
  Lunar_OtherFestivals?: string
  // ---- 四柱：干支 / 五行 / 纳音 / 十神 ----
  GanZhiYear?: string
  GanZhiMonth?: string
  GanZhiDay?: string
  GanZhiHour?: string
  WuXingYear?: string
  WuXingMonth?: string
  WuXingDay?: string
  WuXingHour?: string
  NaYinYear?: string
  NaYinMonth?: string
  NaYinDay?: string
  NaYinHour?: string
  ShiShenYear?: string
  ShiShenMonth?: string
  ShiShenDay?: string
  ShiShenHour?: string
  // ---- 八字命理 ----
  QiYunMan?: string
  QiYunWoman?: string
  PengZuBaiJi?: string
  LuDay?: string
  // ---- 节气物候 ----
  JieQi1?: string
  JieQi2?: string
  PrevJieQi?: string
  NextJieQi?: string
  YueXiang?: string
  ShuJiu?: string
  SanFu?: string
  WuHou?: string
  // ---- 宜忌 ----
  YiDay?: string
  JiDay?: string
  YiHour?: string
  JiHour?: string
  JiShenDay?: string
  XiongShaDay?: string
  // ---- 神煞方位 ----
  XiShen?: string
  CaiShen?: string
  FuShen?: string
  YangGuiShen?: string
  YinGuiShen?: string
  TaiShenDay?: string
  TaiShenMonth?: string
  TaiSuiYear?: string
  TaiSuiMonth?: string
  TaiSuiDay?: string
  ChongDay?: string
  ShaDay?: string
  ChongHour?: string
  ShaHour?: string
  // ---- 星宿值神 ----
  ZhiXing?: string
  TianShen?: string
  LiuYao?: string
  QiZheng?: string
  SiShou?: string
  XiuLuck?: string
  XiuSong?: string
  ZaoMaTou?: string
  SanYuan?: string
  JiuYun?: string
  JiuXingYear?: string
  JiuXingMonth?: string
  JiuXingDay?: string
  JiuXingHour?: string
  // ---- 每日一言 ----
  WeiYu_s?: string
  WeiYu_l?: string
}

/** 行模型：value 主文本；sub 次要说明（如九星详解）；tags 拆词成签（宜 / 忌）；tone 配色 */
export interface LunarRow {
  label: string
  value: string
  sub?: string
  tags?: string[]
  full?: boolean
  tone?: 'yi' | 'ji'
}

export interface LunarRowsSection {
  kind: 'rows'
  key: string
  title: string
  seal: string
  rows: LunarRow[]
}

export interface LunarPillarsSection {
  kind: 'pillars'
  key: string
  title: string
  seal: string
  heads: string[]
  lines: { label: string; cells: string[] }[]
}

export type LunarSection = LunarRowsSection | LunarPillarsSection

/** 主卡摘要 */
export interface LunarSummary {
  solar: string
  week: string
  constellation: string
  lunar: string
  lunarYear: string
  ganZhiYear: string
  thisYear: string
  chips: string[]
}

/** 时间戳 → 接口 14 位日期时间参数（yyyyMMddHHmmss），按本地墙钟读数取位 */
export function toApiDate14(ts: number): string {
  const d = new Date(ts)
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/** 时间戳 → "2026年1月1日" 式短标签（数据未加载时头部兜底展示） */
export function solarLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const txt = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** 布尔 → 是 / 否 */
const yn = (v?: boolean): string => (v ? '是' : '否')

/** 空格分隔的词串 → 标签数组；空串返回 undefined（配合空值隐藏） */
function splitTags(v?: string): string[] | undefined {
  const t = txt(v).trim()
  return t ? t.split(/\s+/) : undefined
}

/** 九星字段 "二黒土天璇 => 二黒土 坤(西南) …" 拆为主名 + 详解 */
function splitArrow(v?: string): { value: string; sub?: string } {
  const t = txt(v).trim()
  const i = t.indexOf('=>')
  if (i < 0) return { value: t }
  return { value: t.slice(0, i).trim(), sub: t.slice(i + 2).trim() }
}

/** 构建一行；value 为空返回 null（时节性空值自动隐藏） */
function row(label: string, value: unknown, extra: Partial<LunarRow> = {}): LunarRow | null {
  const v = txt(value).trim()
  if (!v) return null
  return { label, value: v, ...extra }
}

/** 构建宜忌标签行：tags 为空返回 null */
function tagRow(label: string, value: string | undefined, tone: 'yi' | 'ji'): LunarRow | null {
  const tags = splitTags(value)
  if (!tags) return null
  return { label, value: tags.join(' '), tags, tone, full: true }
}

/** 九星行：主名 + 详解 */
function jxRow(label: string, value?: string): LunarRow | null {
  const t = txt(value).trim()
  if (!t) return null
  const { value: main, sub } = splitArrow(t)
  return { label, value: main, sub, full: true }
}

const dropNull = <T>(arr: (T | null)[]): T[] => arr.filter((x): x is T => x !== null)

/** 主卡摘要：农历大字 + 公历行 + 干支生肖行 + 时节签（空值自动剔除） */
export function buildSummary(d: LunarProData): LunarSummary {
  const chips = [
    d.Festivals,
    d.Lunar_Festivals,
    d.OtherFestivals,
    d.Lunar_OtherFestivals,
    d.JieQi1,
    d.JieQi2,
    d.ShuJiu,
    d.SanFu,
  ]
    .map((v) => txt(v).trim())
    .filter(Boolean)
  return {
    solar: txt(d.Solar),
    week: txt(d.Week),
    constellation: txt(d.Constellation),
    lunar: txt(d.Lunar),
    lunarYear: txt(d.LunarYear),
    ganZhiYear: txt(d.GanZhiYear),
    thisYear: txt(d.ThisYear),
    chips,
  }
}

/** 将全部返回字段按主题分区；空行剔除、空区整区隐藏 */
export function buildSections(d: LunarProData): LunarSection[] {
  const sections: LunarSection[] = []

  const solar: LunarRowsSection = {
    kind: 'rows',
    key: 'solar',
    title: '公历',
    seal: '历',
    rows: dropNull([
      row('星座', d.Constellation),
      row('其他节日', d.OtherFestivals),
      row('闰年', d.IsLeapYear === undefined ? '' : yn(d.IsLeapYear)),
      row('季度', d.Quarter ? `第 ${d.Quarter} 季度` : ''),
      row('半年', d.HalfYear ? (d.HalfYear === 1 ? '上半年' : d.HalfYear === 2 ? '下半年' : `第 ${d.HalfYear} 半年`) : ''),
      row('年内第几天', d.DaysInYear ? `第 ${d.DaysInYear} 天` : ''),
      row('全年天数', d.YearDayCount ? `${d.YearDayCount} 天` : ''),
      row('本月第几周', d.WeekInMonth ? `第 ${d.WeekInMonth} 周` : ''),
      row('全年第几周', d.WeekInYear ? `第 ${d.WeekInYear} 周` : ''),
      row('本月天数', d.MonthDayCount ? `${d.MonthDayCount} 天` : ''),
      row('儒略日', typeof d.JulianDay === 'number' ? d.JulianDay.toFixed(2) : d.JulianDay),
    ]),
  }

  const lunar: LunarRowsSection = {
    kind: 'rows',
    key: 'lunar',
    title: '农历',
    seal: '农',
    rows: dropNull([
      row('农历年', d.LunarYear),
      row('生肖', d.ThisYear),
      row('闰月', d.IsLeapMonth === undefined ? '' : yn(d.IsLeapMonth)),
      row('本月天数', d.LunarMonthDayCount ? `${d.LunarMonthDayCount} 天` : ''),
      row('全年天数', d.LunarYearDayCount ? `${d.LunarYearDayCount} 天` : ''),
      row('农历节日', d.Lunar_Festivals),
      row('其他节日', d.Lunar_OtherFestivals),
      row('佛历', d.FoDate),
      row('道历', d.DaoDate),
    ]),
  }

  const pillarLines = [
    { label: '干支', cells: [d.GanZhiYear, d.GanZhiMonth, d.GanZhiDay, d.GanZhiHour] },
    { label: '五行', cells: [d.WuXingYear, d.WuXingMonth, d.WuXingDay, d.WuXingHour] },
    { label: '纳音', cells: [d.NaYinYear, d.NaYinMonth, d.NaYinDay, d.NaYinHour] },
    { label: '十神', cells: [d.ShiShenYear, d.ShiShenMonth, d.ShiShenDay, d.ShiShenHour] },
  ]
    .map((l) => ({ label: l.label, cells: l.cells.map(txt) }))
    .filter((l) => l.cells.some(Boolean))
  const pillars: LunarPillarsSection = {
    kind: 'pillars',
    key: 'pillars',
    title: '四柱干支',
    seal: '柱',
    heads: ['年柱', '月柱', '日柱', '时柱'],
    lines: pillarLines,
  }

  const bazi: LunarRowsSection = {
    kind: 'rows',
    key: 'bazi',
    title: '八字命理',
    seal: '命',
    rows: dropNull([
      row('起运（男）', d.QiYunMan),
      row('起运（女）', d.QiYunWoman),
      row('彭祖百忌', d.PengZuBaiJi),
      row('禄神', d.LuDay),
    ]),
  }

  const jieqi: LunarRowsSection = {
    kind: 'rows',
    key: 'jieqi',
    title: '节气物候',
    seal: '气',
    rows: dropNull([
      row('当前节气', d.JieQi1),
      row('节气提示', d.JieQi2),
      row('上一节气', d.PrevJieQi),
      row('下一节气', d.NextJieQi),
      row('物候', d.WuHou),
      row('月相', d.YueXiang),
      row('数九', d.ShuJiu),
      row('三伏', d.SanFu),
    ]),
  }

  const yiji: LunarRowsSection = {
    kind: 'rows',
    key: 'yiji',
    title: '宜忌吉凶',
    seal: '忌',
    rows: dropNull([
      tagRow('宜（日）', d.YiDay, 'yi'),
      tagRow('忌（日）', d.JiDay, 'ji'),
      tagRow('宜（时）', d.YiHour, 'yi'),
      tagRow('忌（时）', d.JiHour, 'ji'),
      row('吉神宜趋', d.JiShenDay, { full: true }),
      row('凶煞宜忌', d.XiongShaDay, { full: true }),
    ]),
  }

  const fangwei: LunarRowsSection = {
    kind: 'rows',
    key: 'fangwei',
    title: '神煞方位',
    seal: '煞',
    rows: dropNull([
      row('喜神', d.XiShen),
      row('财神', d.CaiShen),
      row('福神', d.FuShen),
      row('阳贵神', d.YangGuiShen),
      row('阴贵神', d.YinGuiShen),
      row('胎神（日）', d.TaiShenDay),
      row('胎神（月）', d.TaiShenMonth),
      row('太岁（年）', d.TaiSuiYear),
      row('太岁（月）', d.TaiSuiMonth),
      row('太岁（日）', d.TaiSuiDay),
      row('冲（日）', d.ChongDay),
      row('煞（日）', d.ShaDay),
      row('冲（时）', d.ChongHour),
      row('煞（时）', d.ShaHour),
    ]),
  }

  const xingxiu: LunarRowsSection = {
    kind: 'rows',
    key: 'xingxiu',
    title: '星宿值神',
    seal: '宿',
    rows: dropNull([
      row('建除十二值星', d.ZhiXing),
      row('十二天神', d.TianShen),
      row('六曜', d.LiuYao),
      row('七政', d.QiZheng),
      row('四兽', d.SiShou),
      row('三元', d.SanYuan),
      row('九运', d.JiuYun),
      row('二十八星宿', d.XiuLuck),
      row('星宿歌诀', d.XiuSong, { full: true }),
      row('灶马头', d.ZaoMaTou, { full: true }),
      jxRow('九星（年）', d.JiuXingYear),
      jxRow('九星（月）', d.JiuXingMonth),
      jxRow('九星（日）', d.JiuXingDay),
      jxRow('九星（时）', d.JiuXingHour),
    ]),
  }

  const yiyan: LunarRowsSection = {
    kind: 'rows',
    key: 'yiyan',
    title: '每日一言',
    seal: '言',
    rows: dropNull([row('短句', d.WeiYu_s, { full: true }), row('长句', d.WeiYu_l, { full: true })]),
  }

  for (const sec of [solar, lunar, pillars, bazi, jieqi, yiji, fangwei, xingxiu, yiyan]) {
    if (sec.kind === 'pillars' ? sec.lines.length > 0 : sec.rows.length > 0) sections.push(sec)
  }
  return sections
}
