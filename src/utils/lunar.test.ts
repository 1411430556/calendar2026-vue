import { describe, it, expect } from 'vitest'
import { toApiDate14, solarLabel, buildSummary, buildSections, type LunarProData } from './lunar'

// 与接口实测返回同构的样例（2026-01-01 08:00:00，已按需精简空值字段）
const SAMPLE: LunarProData = {
  Solar: '2026年1月1日',
  Week: '星期四',
  IsLeapYear: false,
  MonthDayCount: 31,
  DaysInYear: 1,
  YearDayCount: 365,
  WeekInMonth: 1,
  WeekInYear: 1,
  HalfYear: 1,
  Quarter: 1,
  Constellation: '摩羯座',
  Festivals: '元旦节',
  JulianDay: 2461041.8333333335,
  LunarYear: '二〇二五年',
  Lunar: '冬月十三',
  LunarMonthDayCount: 30,
  LunarYearDayCount: 384,
  IsLeapMonth: false,
  FoDate: '二五六九年冬月十三日',
  DaoDate: '四七二二年冬月十三日',
  ThisYear: '蛇年',
  GanZhiYear: '乙巳年',
  GanZhiMonth: '戊子月',
  GanZhiDay: '乙亥日',
  GanZhiHour: '庚辰时',
  WuXingYear: '木火',
  WuXingMonth: '土水',
  WuXingDay: '木水',
  WuXingHour: '金土',
  NaYinYear: '覆灯火',
  NaYinMonth: '霹雳火',
  NaYinDay: '山头火',
  NaYinHour: '白蜡金',
  ShiShenYear: '伤官 正官 正财',
  ShiShenMonth: '偏印',
  ShiShenDay: '正印 劫财',
  ShiShenHour: '正财 比肩 偏印',
  QiYunMan: '出生8年4个月10天后起运',
  QiYunWoman: '出生1年5个月10天后起运',
  PengZuBaiJi: '乙不栽植千株不长 亥不嫁娶不利新郎',
  JieQi1: '冬至 第12天',
  JieQi2: '距离 小寒 还有4天',
  PrevJieQi: '冬至 2025-12-21 23:03:02',
  NextJieQi: '小寒 2026-01-05 16:23:07',
  YueXiang: '渐盈凸',
  ShuJiu: '二九第3天',
  XiShen: '乾=西北',
  CaiShen: '艮=东北',
  FuShen: '坤=西南',
  YangGuiShen: '坤=西南',
  YinGuiShen: '坎=正北',
  TaiShenDay: '碓磨床 外西南',
  TaiShenMonth: '占灶炉',
  TaiSuiYear: '乙巳 巽=东南',
  TaiSuiMonth: '戊子 坤=西南',
  TaiSuiDay: '乙亥 巽=东南',
  ChongDay: '猪日冲(己巳)蛇',
  ShaDay: '西',
  ChongHour: '龙时冲(甲戌)狗',
  ShaHour: '南',
  JiShenDay: '四相 王日',
  XiongShaDay: '游祸 血支 重日 朱雀',
  YiDay: '入宅 移徙 出行',
  JiDay: '嫁娶 开市 安床',
  YiHour: '作灶 祭祀 祈福',
  JiHour: '修造 动土',
  LuDay: '卯命互禄 壬命进禄',
  WuHou: '水泉动 冬至 三候',
  LiuYao: '大安',
  QiZheng: '木',
  SiShou: '朱雀',
  XiuLuck: '南 井 木 犴 吉',
  XiuSong: '井星造作旺蚕田，金榜题名第一光',
  ZaoMaTou: '三鼠偷粮 草子三分',
  SanYuan: '下元',
  JiuYun: '九运',
  ZhiXing: '闭',
  TianShen: '朱雀 黑道 凶',
  JiuXingYear: '二黒土天璇 => 二黒土 坤(西南) 天璇',
  WeiYu_s: '努力不会白费，成功终将到来。',
  WeiYu_l: '每个人都有自己独特的价值和才能。',
}

describe('toApiDate14 接口日期参数', () => {
  it('格式化为 14 位 yyyyMMddHHmmss，单位数补零', () => {
    expect(toApiDate14(new Date(2026, 0, 1, 8, 14, 20).getTime())).toBe('20260101081420')
    expect(toApiDate14(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('20261231235959')
  })
})

describe('solarLabel 头部兜底日期', () => {
  it('输出中文短日期', () => {
    expect(solarLabel(new Date(2026, 0, 1, 8, 0, 0).getTime())).toBe('2026年1月1日')
  })
})

describe('buildSummary 主卡摘要', () => {
  it('提取主卡字段并按序合并时节签', () => {
    const s = buildSummary(SAMPLE)
    expect(s.lunar).toBe('冬月十三')
    expect(s.solar).toBe('2026年1月1日')
    expect(s.chips).toEqual(['元旦节', '冬至 第12天', '距离 小寒 还有4天', '二九第3天'])
  })
  it('时节性空值自动剔除', () => {
    const s = buildSummary({ ...SAMPLE, Festivals: '', JieQi1: '', ShuJiu: undefined })
    expect(s.chips).toEqual(['距离 小寒 还有4天'])
  })
})

describe('buildSections 全字段分区', () => {
  const secs = buildSections(SAMPLE)
  const keys = secs.map((s) => s.key)

  it('九大分区齐全且顺序固定', () => {
    expect(keys).toEqual(['solar', 'lunar', 'pillars', 'bazi', 'jieqi', 'yiji', 'fangwei', 'xingxiu', 'yiyan'])
  })

  it('布尔字段映射为 是 / 否', () => {
    const solar = secs.find((s) => s.key === 'solar')!
    if (solar.kind !== 'rows') throw new Error('solar 应为 rows 分区')
    expect(solar.rows.find((r) => r.label === '闰年')?.value).toBe('否')
  })

  it('数字字段带单位展示', () => {
    const solar = secs.find((s) => s.key === 'solar')!
    if (solar.kind !== 'rows') throw new Error('solar 应为 rows 分区')
    expect(solar.rows.find((r) => r.label === '全年天数')?.value).toBe('365 天')
    expect(solar.rows.find((r) => r.label === '儒略日')?.value).toBe('2461041.83')
  })

  it('空值字段整行隐藏（如三伏 / 其他节日缺省时不出现）', () => {
    const jieqi = secs.find((s) => s.key === 'jieqi')!
    if (jieqi.kind !== 'rows') throw new Error('jieqi 应为 rows 分区')
    expect(jieqi.rows.some((r) => r.label === '三伏')).toBe(false)
    expect(jieqi.rows.some((r) => r.label === '数九')).toBe(true)
  })

  it('宜忌按空格拆成标签并带配色', () => {
    const yiji = secs.find((s) => s.key === 'yiji')!
    if (yiji.kind !== 'rows') throw new Error('yiji 应为 rows 分区')
    const yi = yiji.rows.find((r) => r.label === '宜（日）')!
    expect(yi.tags).toEqual(['入宅', '移徙', '出行'])
    expect(yi.tone).toBe('yi')
    const ji = yiji.rows.find((r) => r.label === '忌（日）')!
    expect(ji.tone).toBe('ji')
  })

  it('四柱分区为表格：四行（干支/五行/纳音/十神）× 四柱', () => {
    const p = secs.find((s) => s.key === 'pillars')!
    if (p.kind !== 'pillars') throw new Error('pillars 应为表格分区')
    expect(p.heads).toEqual(['年柱', '月柱', '日柱', '时柱'])
    expect(p.lines.map((l) => l.label)).toEqual(['干支', '五行', '纳音', '十神'])
    expect(p.lines[0].cells).toEqual(['乙巳年', '戊子月', '乙亥日', '庚辰时'])
  })

  it('九星字段按 => 拆为主名 + 详解', () => {
    const xx = secs.find((s) => s.key === 'xingxiu')!
    if (xx.kind !== 'rows') throw new Error('xingxiu 应为 rows 分区')
    const jx = xx.rows.find((r) => r.label === '九星（年）')!
    expect(jx.value).toBe('二黒土天璇')
    expect(jx.sub).toBe('二黒土 坤(西南) 天璇')
  })

  it('空对象不产生任何分区', () => {
    expect(buildSections({})).toEqual([])
  })
})
