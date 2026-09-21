<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CAL, HOLIDAYS, type DayInfo } from './data/calendar2026'

const WNAMES = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
const MNAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const MEN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MONTH_HOL: Record<number, string> = { 1: '元旦', 2: '春节', 4: '清明', 5: '劳动节', 6: '端午', 9: '中秋', 10: '国庆' }
const WDOW = '日一二三四五六'.split('')

const DAY_MAP = new Map<string, DayInfo>(CAL.map((d) => [d.date, d]))
const pad = (n: number) => String(n).padStart(2, '0')

// 年份从数据首条推导，干支 / 生肖 / 中文数字年均由年份派生，避免硬编码
const YEAR = Number(CAL[0].date.slice(0, 4))
const GAN = '甲乙丙丁戊己庚辛壬癸'
const ZHI = '子丑寅卯辰巳午未申酉戌亥'
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪'
const CN_DIGITS = '〇一二三四五六七八九'
const GANZHI = GAN[(YEAR - 4) % 10] + ZHI[(YEAR - 4) % 12]
const ZODIAC_CHAR = ZODIAC[(YEAR - 4) % 12]
const YEAR_CN = String(YEAR)
  .split('')
  .map((c) => CN_DIGITS[Number(c)])
  .join('')

// 春节正月初一作为撕历卡兜底展示日（数据内定位，不写死日期）
const springFestival = CAL.find((d) => d.fest === '春节' && d.lunar === '正月')!

interface MonthBlock {
  m: number
  lead: number
  days: DayInfo[]
}

// 访问者当天若在数据覆盖年份内则高亮今日，否则回落展示春节样例页
const todayKey = (() => {
  const now = new Date()
  if (now.getFullYear() === YEAR) {
    const k = `${YEAR}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    if (DAY_MAP.has(k)) return k
  }
  return ''
})()

const sc = DAY_MAP.get(todayKey) ?? springFestival
const tearMonthLabel = todayKey ? '今天' : `${GANZHI}年${sc.full}`
const sealState = sc.hol
  ? { text: `${sc.hol} · 放假`, cls: 'tear-seal' }
  : sc.ban
    ? { text: '补班日 · 上班', cls: 'tear-seal work' }
    : sc.wd >= 5
      ? { text: '周末 · 休息', cls: 'tear-seal plain' }
      : { text: '工作日', cls: 'tear-seal plain' }

const months = computed<MonthBlock[]>(() => {
  const out: MonthBlock[] = []
  for (let m = 1; m <= 12; m++) {
    const days = CAL.filter((d) => d.m === m)
    out.push({ m, lead: (days[0].wd + 1) % 7, days })
  }
  return out
})

const activeMonth = ref(1)

// 滚动联动（scrollspy）：可见月份集合 + 点击优先 + 平滑滚动期间加锁防抖动
const visible = new Set<number>()
let clicked: number | null = null
let lockUntil = 0

function onNavClick(m: number) {
  clicked = m
  activeMonth.value = m
  lockUntil = Date.now() + 900
}

function cellClasses(d: DayInfo) {
  const cls: string[] = ['cell']
  if (d.hol) cls.push('rest')
  else if (d.ban) cls.push('work')
  if (d.wd >= 5 && !d.hol && !d.ban) cls.push('weekend')
  if (d.fest) cls.push('fest')
  if (d.date === todayKey) cls.push('today')
  return cls
}

function cellTitle(d: DayInfo) {
  const label = d.fest ?? d.lunar
  return `${d.date} · ${label}${d.hol ? ` · 放假(${d.hol})` : ''}${d.ban ? ' · 补班' : ''}`
}

let revealIO: IntersectionObserver | null = null
let spyIO: IntersectionObserver | null = null

onMounted(() => {
  // 页面标题跟随数据年份动态更新（index.html 中的 2026 仅作初始占位）
  document.title = `${YEAR} ${GANZHI}${ZODIAC_CHAR}年 · 全年节假日日历（含农历·节气·调休）`
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const revealTargets = document.querySelectorAll('.month, .hol-card')
  revealIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          revealIO?.unobserve(e.target)
        }
      })
    },
    { threshold: 0.12 },
  )
  if (reduce) {
    revealTargets.forEach((el) => el.classList.add('in'))
  } else {
    revealTargets.forEach((el) => revealIO?.observe(el))
  }

  spyIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        const m = Number((e.target as HTMLElement).dataset.m)
        if (e.isIntersecting) visible.add(m)
        else visible.delete(m)
      })
      if (Date.now() < lockUntil) return // 尊重点击跳转，避免滚动中抖动
      if (visible.size === 0) return
      activeMonth.value = clicked != null && visible.has(clicked) ? clicked : Math.min(...visible)
    },
    { rootMargin: '-64px 0px -66% 0px', threshold: 0 },
  )
  document.querySelectorAll('.month').forEach((el) => spyIO?.observe(el))
})

onUnmounted(() => {
  revealIO?.disconnect()
  spyIO?.disconnect()
})
</script>

<template>
  <header class="hero">
    <div class="wrap hero-inner">
      <div class="hero-left">
        <div class="eyebrow">Gregorian · Lunar · Holidays</div>
        <div class="year-row">
          <div class="year-big">{{ YEAR }}</div>
          <div class="year-side">
            <div class="ganzhi">{{ GANZHI }} {{ ZODIAC_CHAR }}年</div>
          </div>
        </div>
        <h1>全年节假日日历</h1>
        <p class="sub">一年 365 天尽在于此——公历、农历、二十四节气，以及国务院办公厅公布的法定节假日放假调休与补班安排，一目了然。</p>
        <div class="hero-tags">
          <span>放假调休 33 天</span>
          <span>补班 6 天</span>
          <span>节气 24</span>
          <span>法定节日 7</span>
        </div>
      </div>
      <div class="hero-right">
        <div class="tear" id="tearCard">
          <div class="tear-top">
            <span>今 日</span><span>{{ YEAR }}</span>
          </div>
          <div class="tear-dots"><i></i><i></i></div>
          <div class="tear-body">
            <div class="tear-week">{{ WNAMES[sc.wd] }}</div>
            <div class="tear-day">{{ sc.d }}</div>
            <div class="tear-month">{{ sc.m }} 月 · {{ tearMonthLabel }}</div>
            <div class="tear-lunar">农历 {{ sc.full }}</div>
            <div class="tear-fest">{{ sc.fest ?? '' }}</div>
            <div :class="sealState.cls">{{ sealState.text }}</div>
          </div>
        </div>
      </div>
    </div>
  </header>

  <nav class="monthnav" id="monthnav">
    <div class="wrap">
      <div class="monthnav-inner" style="display: flex; justify-content: center;">
        <a v-for="{ m } in months" :key="m" :href="'#m' + m" :data-m="m" :class="[activeMonth === m ? 'active' : '', MONTH_HOL[m] ? 'has-hol' : '']" @click="onNavClick(m)">{{ m }}月</a>
      </div>
    </div>
  </nav>

  <section id="overview" class="wrap">
    <div class="sec-head">
      <span class="kicker">Official Holiday Arrangement</span>
      <h2>法定节假日一览</h2>
    </div>
    <p class="sec-desc">依据《国务院办公厅关于 {{ YEAR }} 年部分节假日安排的通知》（国办发明电〔2025〕7 号）。全年放假调休共 33 天，其中 6 个周末需要补班。</p>
    <div class="rule"></div>
    <div class="stats">
      <div class="stat"><b>33</b><span>放假调休总天数</span></div>
      <div class="stat"><b>6</b><span>周末补班天数</span></div>
      <div class="stat"><b>24</b><span>二十四节气</span></div>
      <div class="stat">
        <b>365</b><span>{{ GANZHI }}{{ ZODIAC_CHAR }}年 · 天</span>
      </div>
    </div>
    <div class="hol-grid">
      <article v-for="h in HOLIDAYS" :key="h.name" class="hol-card" :data-seal="h.seal">
        <div class="hol-name">
          {{ h.name }}
          <span class="hol-days">{{ h.days }}</span>
        </div>
        <div class="hol-range">{{ h.range }}</div>
        <div class="hol-sub">{{ h.sub }}</div>
        <div :class="['hol-makeup', !h.hasMakeup ? 'none' : '']">{{ h.hasMakeup ? '↻ ' : '✓ ' }}{{ h.makeup }}</div>
      </article>
    </div>
  </section>

  <section id="legend" class="wrap">
    <div class="sec-head">
      <span class="kicker">Legend</span>
      <h2>图例说明</h2>
    </div>
    <div class="rule"></div>
    <div class="legend" style="margin-top: 22px">
      <h3>标记</h3>
      <div class="lg"><span class="chip rest">休</span> 法定节假日（放假）</div>
      <div class="lg"><span class="chip work">班</span> 调休补班日（周末上班）</div>
      <div class="lg"><span class="dot"></span> 周六 / 周日</div>
      <div class="lg"><span class="chip weekend">青</span> 节气 · 农历 · 传统节日</div>
    </div>
  </section>

  <section id="calendar" class="wrap">
    <div class="sec-head">
      <span class="kicker">Full Year Calendar</span>
      <h2>{{ YEAR }} 逐月日历</h2>
    </div>
    <p class="sec-desc">每格上为公历日期，下为农历 / 节气 / 节日。红底为放假，黄底为补班，点击月份导航可快速跳转。今日已用青色描边标出。</p>
    <div class="rule"></div>
    <div class="cal-grid" style="margin-top: 26px">
      <div v-for="{ m, lead, days } in months" :key="m" class="month" :id="'m' + m" :data-m="m" :style="{ scrollMarginTop: '62px' }">
        <div class="month-head">
          <div>
            <div class="mname">{{ MNAMES[m - 1] }}</div>
          </div>
          <div style="text-align: right">
            <div class="mnum">{{ MEN[m - 1] }}</div>
            <span v-if="MONTH_HOL[m]" class="month-badge">{{ MONTH_HOL[m] }}</span>
            <span v-else class="month-badge" style="visibility: hidden">·</span>
          </div>
        </div>
        <div class="wdow">
          <span v-for="(w, i) in WDOW" :key="w" :class="{ we: i === 0 || i === 6 }">{{ w }}</span>
        </div>
        <div class="days">
          <div v-for="b in lead" :key="'b' + b" class="cell blank"></div>
          <div v-for="d in days" :key="d.date" :class="cellClasses(d)" :title="cellTitle(d)">
            <span v-if="d.hol" class="seal">休</span>
            <span v-if="d.ban" class="seal">班</span>
            <span class="num">{{ d.d }}</span>
            <span class="lun">{{ d.fest ?? d.lunar }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <div class="foot-top">
        <div>
          <div class="foot-brand">{{ GANZHI }} · {{ YEAR_CN }}</div>
          <p class="foot-note" style="margin-top: 8px">
            本页为静态在线日历，农历与节气由天文算法计算，节假日安排取自官方通知。祝你
            <b>马到成功，岁岁安康</b>。
          </p>
        </div>
        <div class="foot-note">
          <b>数据来源</b>
          <br />
          国务院办公厅 · 国办发明电〔2025〕7 号
          <br />
          农历/节气：天文推算
        </div>
      </div>
      <div class="foot-src">© {{ YEAR }} 全年节假日日历 · 仅供参考，最终以国务院办公厅正式通知为准。</div>
    </div>
  </footer>
</template>
