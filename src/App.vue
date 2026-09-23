<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NConfigProvider,
  NGlobalStyle,
  NCard,
  NTag,
  NStatistic,
  NButton,
  NDivider,
  NGrid,
  NGi,
} from 'naive-ui'
import { CAL, HOLIDAYS, type DayInfo } from './data/calendar2026'
import { initCursorEffect } from './cursorEffect'
import HistoryToday from './HistoryToday.vue'
import DailyQuote from './DailyQuote.vue'

// ============ 中国风主题令牌（对齐 naive-ui） ============
const themeOverrides = {
  common: {
    primaryColor: '#BE3A2B',
    primaryColorHover: '#D15444',
    primaryColorPressed: '#A02E20',
    primaryColorSuppl: '#BE3A2B',
    infoColor: '#2F5D55',
    infoColorHover: '#3A7369',
    warningColor: '#B98F3E',
    warningColorHover: '#CBA456',
    bodyColor: '#F3EDE0',
    cardColor: '#FFFCF5',
    modalColor: '#FFFCF5',
    popoverColor: '#FFFCF5',
    textColorBase: '#241F19',
    textColor1: '#241F19',
    textColor2: '#4A4238',
    textColor3: '#7A6F60',
    textColorDisabled: '#B3A998',
    borderColor: '#E0D6C4',
    dividerColor: '#E0D6C4',
    actionColor: '#FBF7EE',
    borderRadius: '14px',
    borderRadiusSmall: '9px',
    fontFamily: '"Noto Sans SC", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontWeight: '400',
    fontWeightStrong: '700',
    lineHeight: '1.6',
  },
  Card: {
    color: '#FFFCF5',
    colorEmbedded: '#FBF7EE',
    borderColor: '#E0D6C4',
    borderRadius: '14px',
    paddingMedium: '20px 20px 18px',
  },
  Tag: {
    borderRadius: '8px',
  },
  Button: {
    borderRadiusMedium: '999px',
    colorPrimary: '#BE3A2B',
    colorPrimaryHover: '#D15444',
    colorPrimaryPressed: '#A02E20',
  },
  Divider: {
    color: '#E0D6C4',
  },
  Statistic: {
    labelTextColor: '#7A6F60',
    valueTextColor: '#241F19',
  },
}

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

// 响应式列数：监听窗口宽度动态计算（naive-ui 未导出 useBreakpoint）
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
function onResize() {
  screenWidth.value = window.innerWidth
}
const statCols = computed(() => (screenWidth.value < 600 ? 2 : 4))
const holCols = computed(() => {
  if (screenWidth.value < 600) return 1
  if (screenWidth.value < 900) return 2
  return 4
})
const calCols = computed(() => {
  if (screenWidth.value < 600) return 1
  if (screenWidth.value < 900) return 2
  return 3
})

// 滚动联动（scrollspy）：可见月份集合 + 点击优先 + 平滑滚动期间加锁防抖动
const visible = new Set<number>()
let clicked: number | null = null
let lockUntil = 0

function onNavClick(m: number) {
  clicked = m
  activeMonth.value = m
  lockUntil = Date.now() + 900
  // 按钮替代了原 <a href="#mN"> 锚点，需手动滚动。用 offsetTop（布局位置）计算落点，
  // 避免月卡入场动画的 translateY 变换在滚动期间被移除导致 scrollIntoView 落点偏差
  const el = document.getElementById('m' + m)
  if (!el) return
  const navH = document.getElementById('monthnav')?.offsetHeight ?? 0
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: el.offsetTop - navH - 8, behavior: reduce ? 'auto' : 'smooth' })
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
let disposeCursor: (() => void) | null = null

onMounted(() => {
  // 页面标题跟随数据年份动态更新（index.html 中的 2026 仅作初始占位）
  document.title = `${YEAR} ${GANZHI}${ZODIAC_CHAR}年 · 全年节假日日历（含农历·节气·调休）`
  window.addEventListener('resize', onResize)
  disposeCursor = initCursorEffect()
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
      if (Date.now() < lockUntil) return
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
  disposeCursor?.()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-global-style />
    <div class="page">
      <!-- ============ HERO ============ -->
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
              <n-tag v-for="t in ['放假调休 33 天', '补班 6 天', '节气 24', '法定节日 7']" :key="t" round size="small" :bordered="false">
                {{ t }}
              </n-tag>
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

      <!-- ============ MONTH NAV ============ -->
      <nav class="monthnav" id="monthnav">
        <div class="wrap">
          <div class="monthnav-inner">
            <n-button
              v-for="{ m } in months"
              :key="m"
              :type="activeMonth === m ? 'primary' : 'default'"
              :ghost="activeMonth !== m"
              size="small"
              @click="onNavClick(m)"
            >
              {{ m }}月
              <n-tag v-if="MONTH_HOL[m]" size="tiny" round :bordered="false" style="margin-left:6px;background:#B98F3E;color:#fff">
                {{ MONTH_HOL[m] }}
              </n-tag>
            </n-button>
          </div>
        </div>
      </nav>

      <!-- ============ 每日一言 ============ -->
      <DailyQuote />

      <!-- ============ OVERVIEW ============ -->
      <section id="overview" class="wrap">
        <div class="sec-head">
          <span class="kicker">Official Holiday Arrangement</span>
          <h2>法定节假日一览</h2>
        </div>
        <p class="sec-desc">依据《国务院办公厅关于 {{ YEAR }} 年部分节假日安排的通知》（国办发明电〔2025〕7 号）。全年放假调休共 33 天，其中 6 个周末需要补班。</p>
        <n-divider style="margin: 20px 0 0" />

        <n-grid :cols="statCols" :x-gap="14" :y-gap="14" style="margin: 26px 0 34px">
          <n-gi>
            <div class="stat-card">
              <n-statistic label="放假调休总天数" :value="33" :value-style="{ color: '#BE3A2B', fontFamily: 'Noto Serif SC, serif', fontWeight: 900 }" />
            </div>
          </n-gi>
          <n-gi>
            <div class="stat-card">
              <n-statistic label="周末补班天数" :value="6" :value-style="{ color: '#B98F3E', fontFamily: 'Noto Serif SC, serif', fontWeight: 900 }" />
            </div>
          </n-gi>
          <n-gi>
            <div class="stat-card">
              <n-statistic label="二十四节气" :value="24" :value-style="{ color: '#2F5D55', fontFamily: 'Noto Serif SC, serif', fontWeight: 900 }" />
            </div>
          </n-gi>
          <n-gi>
            <div class="stat-card">
              <n-statistic :label="`${GANZHI}${ZODIAC_CHAR}年 · 天`" :value="365" :value-style="{ color: '#4A4238', fontFamily: 'Noto Serif SC, serif', fontWeight: 900 }" />
            </div>
          </n-gi>
        </n-grid>

        <n-grid :cols="holCols" :x-gap="16" :y-gap="16">
          <n-gi v-for="h in HOLIDAYS" :key="h.name">
            <n-card class="hol-card" :bordered="true" hoverable>
              <div class="hol-name">
                {{ h.name }}
                <n-tag size="small" round type="error" :bordered="false" style="margin-left:8px">{{ h.days }}</n-tag>
              </div>
              <div class="hol-range">{{ h.range }}</div>
              <div class="hol-sub">{{ h.sub }}</div>
              <n-tag
                :type="h.hasMakeup ? 'warning' : 'success'"
                size="small"
                round
                :bordered="false"
                style="margin-top:12px"
              >
                {{ h.hasMakeup ? '↻ ' : '✓ ' }}{{ h.makeup }}
              </n-tag>
            </n-card>
          </n-gi>
        </n-grid>
      </section>

      <!-- ============ LEGEND ============ -->
      <section id="legend" class="wrap">
        <div class="sec-head">
          <span class="kicker">Legend</span>
          <h2>图例说明</h2>
        </div>
        <n-divider style="margin: 20px 0 0" />
        <div class="legend">
          <h3>标记</h3>
          <div class="lg"><n-tag size="small" round :bordered="false" style="background:#F6E2DC;color:#BE3A2B">休</n-tag> 法定节假日（放假）</div>
          <div class="lg"><n-tag size="small" round :bordered="false" style="background:#F6EBD2;color:#B98F3E">班</n-tag> 调休补班日（周末上班）</div>
          <div class="lg"><span class="dot"></span> 周六 / 周日</div>
          <div class="lg"><n-tag size="small" round :bordered="false" style="background:#EFF3F0;color:#2F5D55">青</n-tag> 节气 · 农历 · 传统节日</div>
        </div>
      </section>

      <!-- ============ CALENDAR ============ -->
      <section id="calendar" class="wrap">
        <div class="sec-head">
          <span class="kicker">Full Year Calendar</span>
          <h2>{{ YEAR }} 逐月日历</h2>
        </div>
        <p class="sec-desc">每格上为公历日期，下为农历 / 节气 / 节日。红底为放假，黄底为补班，点击月份导航可快速跳转。今日已用青色描边标出。</p>
        <n-divider style="margin: 20px 0 0" />

        <n-grid :cols="calCols" :x-gap="20" :y-gap="20" style="margin-top:26px">
          <n-gi v-for="{ m, lead, days } in months" :key="m">
            <div class="month" :id="'m' + m" :data-m="m">
              <div class="month-head">
                <div>
                  <div class="mname">{{ MNAMES[m - 1] }}</div>
                </div>
                <div style="text-align: right">
                  <div class="mnum">{{ MEN[m - 1] }}</div>
                  <n-tag v-if="MONTH_HOL[m]" size="tiny" round :bordered="false" style="margin-top:4px;background:#F6E2DC;color:#BE3A2B">
                    {{ MONTH_HOL[m] }}
                  </n-tag>
                  <span v-else class="month-badge-placeholder">·</span>
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
                <!-- 补齐尾部空格，确保每月固定 6 行（42 格），卡片高度一致 -->
                <div v-for="b in 42 - lead - days.length" :key="'e' + b" class="cell blank"></div>
              </div>
            </div>
          </n-gi>
        </n-grid>
      </section>

      <!-- ============ 历史上的今天浮窗 ============ -->
      <HistoryToday />

      <!-- ============ FOOTER ============ -->
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
    </div>
  </n-config-provider>
</template>
