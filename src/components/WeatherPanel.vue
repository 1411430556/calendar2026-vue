<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NIcon, NSkeleton } from 'naive-ui'
import { Close, Refresh, Moon, Sunny } from '@vicons/ionicons5'
import { useSidePanel } from '../composables/useSidePanel'
import { useWeatherData, type WeatherDay, type WeatherHour, type WeatherIndexItem } from '../composables/useWeather'
import { beijingNow } from '../utils/beijing'
import { pad2 } from '../utils/format'

// 数据状态机需先于浮窗初始化：onOpen: ensure 在创建 options 时即读取引用
const { data, loading, refreshing, error, softError, ensure, load } = useWeatherData()

// ============ 浮窗开合（互斥避让 / 外部点击关闭 / 滚轮锁定 / 移动端背景锁） ============
const { open, panelRef, openPanel, closePanel, onAfterLeave, drag } = useSidePanel({
  mutexClass: 'weather-open',
  listSelector: '.wt-list',
  onOpen: ensure,
})

// ============ 展示派生数据 ============
// "202610022255" → "22:55"；"20261002220000" → "22:00"
function hm(s: string) {
  return s.length >= 12 ? `${s.slice(8, 10)}:${s.slice(10, 12)}` : ''
}
const updatedLabel = computed(() => {
  const t = data.value?.observe.update_time
  return t ? `更新于 ${hm(t)}` : ''
})

// 城市 "四川, 成都" → 头部副行展示为「四川 · 成都」
const cityFull = computed(() => (data.value?.city ?? '').replace(/,\s*/g, ' · '))

const today = computed(() => data.value?.forecast_24h?.[0])

// 逐小时：对象键 "0".."23" 转有序数组（首项为当前小时）
const hours = computed<WeatherHour[]>(() => {
  const h = data.value?.forecast_1h
  if (!h) return []
  return Object.entries(h)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v)
})

const days = computed<WeatherDay[]>(() => data.value?.forecast_24h ?? [])

// 逐小时项的日期标签：预报跨夜（48 小时），用「今天 / 明天 / m/d」标明每项所属北京日期
const bjDayKey = (d: Date) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
const todayKey = computed(() => bjDayKey(beijingNow()))
const tomorrowKey = computed(() => bjDayKey(beijingNow(Date.now() + 24 * 3600_000)))
// update_time 为 "yyyyMMddHHmm(ss)" 北京时串，前 8 位即北京日期
function hourDateLabel(t: string) {
  const d = t.slice(0, 8)
  if (d === todayKey.value) return '今天'
  if (d === tomorrowKey.value) return '明天'
  return `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`
}

// 8 天温度区间条：以全周期最低/最高温为标尺定位每天色块
const tempScale = computed(() => {
  const ds = days.value
  if (!ds.length) return { min: 0, range: 1 }
  const lo = Math.min(...ds.map((d) => Number(d.min_degree)))
  const hi = Math.max(...ds.map((d) => Number(d.max_degree)))
  return { min: lo, range: hi - lo || 1 }
})
function barStyle(d: WeatherDay) {
  const lo = Number(d.min_degree)
  const hi = Number(d.max_degree)
  const { min, range } = tempScale.value
  return {
    left: `${((lo - min) / range) * 100}%`,
    width: `${Math.max(((hi - lo) / range) * 100, 10)}%`,
  }
}

const WD = '日一二三四五六'
function weekLabel(t: string, i: number) {
  if (i === 0) return '今天'
  if (i === 1) return '明天'
  // 接口时间为北京时间（UTC+8）日期串，固定 +08:00 解析避免访客本地时区错位
  return '周' + WD[new Date(`${t}T00:00:00+08:00`).getUTCDay()]
}
const mdLabel = (t: string) => `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`

// 生活指数：按关注度挑选 8 项，缺失（部分地区不返回）自动跳过
const INDEX_KEYS = ['clothes', 'umbrella', 'ultraviolet', 'carwash', 'cold', 'sports', 'drying', 'comfort']
const indexes = computed<WeatherIndexItem[]>(() => {
  const idx = data.value?.index
  if (!idx) return []
  return INDEX_KEYS.map((k) => idx[k]).filter((x): x is WeatherIndexItem => !!x?.name)
})

// 日出日落：取今天（北京时间 yyyymmdd）对应项，兜底偏移 0
const rise = computed(() => {
  const r = data.value?.rise
  if (!r) return null
  const bj = beijingNow()
  const key = `${bj.getUTCFullYear()}${pad2(bj.getUTCMonth() + 1)}${pad2(bj.getUTCDate())}`
  return Object.values(r).find((x) => x.time === key) ?? r['0'] ?? null
})

// AQI 等级 → 配色（1 优 / 2 良 / 3 轻度 / 4 中度 / 5 重度 / 6 严重）
function aqiCls(level: number) {
  return `wt-aqi--${Math.min(Math.max(level, 1), 6)}`
}

// 预警级别 → 颜色类（红 / 橙 / 黄 / 蓝）
function alarmCls(level: string) {
  if (level.includes('红')) return 'wt-alarm--red'
  if (level.includes('橙')) return 'wt-alarm--orange'
  if (level.includes('黄')) return 'wt-alarm--yellow'
  return 'wt-alarm--blue'
}

// 预警发布时间：接口为 "yyyyMMddHHmmss" 数字串时转成 "MM-DD HH:mm"，其他格式原样展示
function fmtAlarmTime(t: string) {
  return /^\d{12,}$/.test(t) ? `${t.slice(4, 6)}-${t.slice(6, 8)} ${hm(t)}` : t
}
</script>

<template>
  <!-- 收起态：右侧竖排签，四个浮窗中位于最上方（步进 49px：天气 -98 / 农历 -49 / 历史 0 / 热搜 +49） -->
  <button class="wt-tab" aria-label="查看当地天气" @click="openPanel">
    <span class="wt-tab-text">实时天气</span>
  </button>

  <!-- 遮罩：仅移动端显示，点击关闭 -->
  <Transition name="wt-mask">
    <div v-if="open" class="wt-mask" aria-hidden="true" @click="closePanel"></div>
  </Transition>

  <!-- 展开态：桌面为右侧浮窗，移动端（≤600px）为底部抽屉，头部可下拉关闭 -->
  <Transition name="wt" @after-leave="onAfterLeave">
    <div
      v-if="open"
      :ref="panelRef"
      class="wt-panel"
      role="dialog"
      aria-label="当地天气"
      @touchstart.passive="drag.onDragStart"
      @touchmove.passive="drag.onDragMove"
      @touchend="drag.onDragEnd"
      @touchcancel="drag.onDragEnd"
    >
      <header class="wt-head side-panel-head">
        <div class="wt-head-info">
          <div class="wt-kicker">TENCENT WEATHER</div>
          <h3 class="wt-title">实时天气</h3>
          <div v-if="data" class="wt-sub">{{ cityFull }} · {{ updatedLabel }}</div>
        </div>
        <div class="wt-actions">
          <n-button
            class="wt-icon-btn"
            :class="{ 'is-spin': refreshing }"
            quaternary
            circle
            size="small"
            title="刷新天气"
            aria-label="刷新天气"
            @click="load()"
          >
            <template #icon>
              <n-icon :size="16"><Refresh /></n-icon>
            </template>
          </n-button>
          <n-button class="wt-icon-btn" quaternary circle size="small" title="关闭" aria-label="关闭浮窗" @click="closePanel">
            <template #icon>
              <n-icon :size="17"><Close /></n-icon>
            </template>
          </n-button>
        </div>
      </header>

      <div class="wt-list">
        <!-- ============ 骨架屏 ============ -->
        <div v-if="loading" class="wt-skeletons">
          <div class="wt-skel-now">
            <div class="wt-skel-left">
              <n-skeleton text style="width:96px;height:58px" />
              <n-skeleton text style="width:120px;margin-top:10px" />
              <n-skeleton text style="width:180px;margin-top:8px" />
            </div>
            <n-skeleton class="wt-skel-icon" :sharp="false" />
          </div>
          <n-skeleton v-for="i in 6" :key="i" class="wt-skel-row" text />
        </div>

        <!-- ============ 错误态 ============ -->
        <div v-else-if="error" class="wt-error">
          <div class="wt-error-icon">!</div>
          <p>{{ error }}</p>
          <n-button class="retry-btn" round ghost color="#BE3A2B" @click="load()">重新加载</n-button>
        </div>

        <template v-else-if="data">
          <!-- ============ 当前实况 ============ -->
          <section class="wt-sec wt-now" :style="{ '--i': 0 }">
            <div class="wt-now-left">
              <div class="wt-temp">
                {{ data.observe.degree }}<span class="wt-temp-unit">°</span>
              </div>
              <div class="wt-now-line1">
                <span class="wt-now-weather">{{ data.observe.weather }}</span>
                <span v-if="today" class="wt-now-range">{{ today.min_degree }}° ~ {{ today.max_degree }}°</span>
                <span v-if="data.air" class="wt-aqi" :class="aqiCls(data.air.aqi_level)">
                  {{ data.air.aqi }} {{ data.air.aqi_name }}
                </span>
              </div>
              <div class="wt-now-line2">
                <span>{{ data.observe.wind_direction_name }} {{ data.observe.wind_power }}级</span>
                <span>湿度 {{ data.observe.humidity }}%</span>
                <span v-if="Number(data.observe.precipitation) > 0">降水 {{ data.observe.precipitation }}mm</span>
                <span>气压 {{ data.observe.pressure }}hPa</span>
              </div>
            </div>
            <img
              v-if="data.observe.weather_url"
              :src="data.observe.weather_url"
              class="wt-now-icon"
              alt=""
              aria-hidden="true"
              referrerpolicy="no-referrer"
            >
          </section>

          <!-- ============ 气象预警 ============ -->
          <section
            v-for="(al, ai) in data.alarm"
            :key="ai"
            class="wt-sec wt-alarm"
            :class="alarmCls(al.level_name)"
            :style="{ '--i': 1 }"
          >
            <div class="wt-alarm-head">
              <span class="wt-alarm-badge">{{ al.type_name }}{{ al.level_name }}预警</span>
              <span class="wt-alarm-time">{{ fmtAlarmTime(al.update_time) }}</span>
            </div>
            <p class="wt-alarm-detail">{{ al.detail }}</p>
          </section>

          <!-- ============ 逐 24 小时 ============ -->
          <section v-if="hours.length" class="wt-sec" :style="{ '--i': 2 }">
            <div class="wt-sec-title">逐小时预报</div>
            <div class="wt-hours">
              <div v-for="(h, i) in hours" :key="i" class="wt-hour" :style="{ '--i': Math.min(i, 12) }">
                <span class="wt-hour-time">{{ i === 0 ? '现在' : `${Number(h.update_time.slice(8, 10))}时` }}</span>
                <span class="wt-hour-date">{{ hourDateLabel(h.update_time) }}</span>
                <img v-if="h.weather_url" :src="h.weather_url" class="wt-hour-icon" alt="" referrerpolicy="no-referrer">
                <span class="wt-hour-degree">{{ h.degree }}°</span>
                <span class="wt-hour-wind">{{ h.wind_direction }}</span>
              </div>
            </div>
          </section>

          <!-- ============ 日出日落 / 限行 ============ -->
          <section v-if="rise || data.limit" class="wt-sec wt-meta-row" :style="{ '--i': 3 }">
            <div v-if="rise" class="wt-meta-item wt-meta-rise">
              <div class="wt-rise-row">
                <n-icon class="wt-rise-ico wt-rise-ico--sun" :size="13"><Sunny /></n-icon>
                <span class="wt-meta-label">日出</span>
                <span class="wt-meta-value">{{ rise.sunrise }}</span>
              </div>
              <div class="wt-rise-row">
                <n-icon class="wt-rise-ico wt-rise-ico--moon" :size="13"><Moon /></n-icon>
                <span class="wt-meta-label">日落</span>
                <span class="wt-meta-value">{{ rise.sunset }}</span>
              </div>
            </div>
            <div v-if="data.limit" class="wt-meta-item wt-meta-limit">
              <span class="wt-meta-label">机动车限行</span>
              <span class="wt-meta-value">{{ data.limit.tail_number }}</span>
            </div>
          </section>

          <!-- ============ 未来 8 天 ============ -->
          <section v-if="days.length" class="wt-sec" :style="{ '--i': 4 }">
            <div class="wt-sec-title">未来 {{ days.length }} 天</div>
            <ol class="wt-days">
              <li v-for="(d, i) in days" :key="d.time" class="wt-day" :style="{ '--i': Math.min(i, 8) }">
                <span class="wt-day-week">{{ weekLabel(d.time, i) }}</span>
                <span class="wt-day-date">{{ mdLabel(d.time) }}</span>
                <img v-if="d.day_weather_url" :src="d.day_weather_url" class="wt-day-icon" alt="" referrerpolicy="no-referrer">
                <span class="wt-day-weather">{{ d.day_weather }}</span>
                <span class="wt-day-bar-wrap">
                  <span class="wt-day-bar" :style="barStyle(d)"></span>
                </span>
                <span class="wt-day-temp">{{ d.min_degree }}° / {{ d.max_degree }}°</span>
              </li>
            </ol>
          </section>

          <!-- ============ 生活指数 ============ -->
          <section v-if="indexes.length" class="wt-sec" :style="{ '--i': 5 }">
            <div class="wt-sec-title">生活指数</div>
            <div class="wt-index">
              <div
                v-for="(ix, i) in indexes"
                :key="ix.name"
                class="wt-index-item"
                :style="{ '--i': i }"
                :title="ix.detail"
              >
                <span class="wt-index-name">{{ ix.name }}</span>
                <span class="wt-index-info">{{ ix.info }}</span>
              </div>
            </div>
          </section>
        </template>
      </div>

      <footer class="wt-foot">
        <span v-if="softError" class="wt-soft-error">{{ softError }}（展示的是缓存天气）</span>
        <span v-else>数据来源 · 腾讯天气 · 相见拾光 API · 按访问者 IP 定位 · 仅供参考</span>
      </footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ============ 收起态竖排签 ============ */
.wt-tab {
  position: fixed;
  /* 四签最上方：50% - 98px（与 ln/ht/hw 共同以 49px 步进纵向排列） */
  right: env(safe-area-inset-right, 0px);
  top: calc(50% - 98px);
  z-index: 70;
  transform: translateY(-50%);
  padding: 10px 14px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  color: #fff;
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  /* 与其他三个侧签统一：等面板离场播完后延迟回归 */
  transition: padding 0.3s ease, opacity 0.4s ease-out 450ms,
    transform 0.4s ease-out 450ms, visibility 0s linear 450ms;
}
.wt-tab-text {
  font-size: 0.875rem;
  font-weight: 700;
}
@media (hover: hover) and (pointer: fine) {
  .wt-tab:hover {
    padding-right: 18px;
  }
}
@media (max-width: 600px) {
  .wt-tab {
    padding: 8px 10px;
    font-size: 0.8rem;
  }
}

/* ============ 浮窗面板（固定高度，与热搜浮窗一致） ============ */
.wt-panel {
  position: fixed;
  right: max(clamp(8px, 2vw, 24px), env(safe-area-inset-right, 0px));
  top: 50%;
  z-index: 71;
  transform: translateY(-50%);
  width: min(384px, 92vw);
  height: min(78vh, 700px);
  height: min(78dvh, 700px);
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  overscroll-behavior: contain;
  transition: transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.wt-panel::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(185, 143, 62, 0.4);
  border-radius: 10px;
  pointer-events: none;
}
.wt-enter-active,
.wt-leave-active {
  transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.wt-enter-from,
.wt-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(60px);
}

/* ============ 头部 ============ */
.wt-head {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 15px 18px 12px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border-bottom: 1px solid var(--line);
}
.wt-kicker {
  font-size: 0.66rem;
  letter-spacing: 0.26em;
  color: var(--gold);
  font-weight: 600;
}
.wt-title {
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--ink);
  margin-top: 2px;
}
.wt-sub {
  margin-top: 3px;
  font-size: 0.72rem;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 230px;
}
.wt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.wt-icon-btn.n-button {
  --n-height: 29px !important;
  --n-width: 29px !important;
  --n-padding: 0 !important;
  --n-border-radius: 50% !important;
  --n-color: transparent !important;
  --n-color-hover: var(--red-tint) !important;
  --n-color-focus: var(--red-tint) !important;
  --n-color-pressed: var(--red-tint) !important;
  --n-text-color: var(--ink-2) !important;
  --n-text-color-hover: var(--red) !important;
  --n-text-color-focus: var(--red) !important;
  --n-text-color-pressed: var(--red) !important;
}
.wt-icon-btn.is-spin :deep(svg) {
  animation: wt-spin 0.9s linear infinite;
}
@keyframes wt-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ============ 内容区 ============ */
.wt-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 12px 14px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.wt-list::-webkit-scrollbar {
  width: 5px;
}
.wt-list::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}

/* 分区：统一淡入 + 轻微上移入场（逐区延迟，封顶避免长时间等待） */
/* 必须显式 padding: 0：全局 section { padding: clamp(40px,6vw,72px) 0 } 会穿透 scoped 样式，
   未重置的分区上下会多出 40~72px 死空白（与 LunarCalendar 的 .ln-sec 同理） */
.wt-sec {
  padding: 0;
  opacity: 0;
  animation: wt-sec-in 0.45s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 70ms);
}
@keyframes wt-sec-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.wt-sec-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--ink-3);
  margin: 14px 2px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wt-sec-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.wt-sec:first-child .wt-sec-title {
  margin-top: 4px;
}

/* ============ 当前实况 ============ */
.wt-now {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(140deg, var(--paper-2) 0%, var(--card) 70%);
  border: 1px solid var(--line);
  overflow: hidden;
}
.wt-temp {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 3.2rem;
  font-weight: 900;
  line-height: 1;
  color: var(--ink);
}
.wt-temp-unit {
  font-size: 1.6rem;
  margin-left: 2px;
}
.wt-now-line1 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.wt-now-weather {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ink-2);
}
.wt-now-range {
  font-size: 0.78rem;
  color: var(--ink-3);
}
.wt-aqi {
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  padding: 2px 9px;
  border-radius: 999px;
}
.wt-aqi--1 { background: var(--teal); }
.wt-aqi--2 { background: #9d762d; }
.wt-aqi--3 { background: #c3612a; }
.wt-aqi--4 { background: var(--red); }
.wt-aqi--5 { background: #7a3b8f; }
.wt-aqi--6 { background: #6b2418; }
.wt-now-line2 {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
  font-size: 0.74rem;
  color: var(--ink-3);
}
.wt-now-icon {
  flex: none;
  width: 96px;
  height: 96px;
  object-fit: contain;
  filter: drop-shadow(0 6px 10px rgba(74, 66, 56, 0.18));
}

/* ============ 气象预警 ============ */
.wt-alarm {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border-left: 4px solid;
  background: var(--card);
}
.wt-alarm--red { border-color: var(--red); background: var(--red-tint); }
.wt-alarm--orange { border-color: #c3612a; background: #f8ece2; }
.wt-alarm--yellow { border-color: var(--gold); background: var(--gold-tint); }
.wt-alarm--blue { border-color: #3a6fbe; background: #e8eef8; }
.wt-alarm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wt-alarm-badge {
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--red-deep);
}
.wt-alarm--orange .wt-alarm-badge { color: #b3541f; }
.wt-alarm--yellow .wt-alarm-badge { color: #8a671f; }
.wt-alarm--blue .wt-alarm-badge { color: #2f5ea0; }
.wt-alarm-time {
  font-size: 0.68rem;
  color: var(--ink-3);
  flex: none;
}
.wt-alarm-detail {
  margin-top: 5px;
  font-size: 0.76rem;
  line-height: 1.6;
  color: var(--ink-2);
}

/* ============ 24 小时横向滚动 ============ */
.wt-hours {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding: 2px 2px 6px;
  scrollbar-width: thin;
}
.wt-hours::-webkit-scrollbar {
  height: 4px;
}
.wt-hours::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}
.wt-hour {
  flex: none;
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 0;
  border-radius: 10px;
  opacity: 0;
  animation: wt-item-in 0.4s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 28ms + 120ms);
}
@keyframes wt-item-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.wt-hour-time {
  font-size: 0.72rem;
  color: var(--ink-3);
}
.wt-hour:first-child .wt-hour-time {
  color: var(--red);
  font-weight: 700;
}
/* 日期标签：标明每个小时项所属日期，跨夜预报一眼可辨 */
.wt-hour-date {
  font-size: 0.6rem;
  line-height: 1.15;
  color: var(--ink-3);
  opacity: 0.8;
  white-space: nowrap;
}
.wt-hour:first-child .wt-hour-date {
  color: var(--red);
  opacity: 1;
}
.wt-hour-icon {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.wt-hour-degree {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--ink-2);
}
.wt-hour-wind {
  font-size: 0.62rem;
  color: var(--ink-3);
  white-space: nowrap;
}

/* ============ 日出日落 / 限行 ============ */
.wt-meta-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.wt-meta-item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  font-size: 0.76rem;
}
.wt-meta-label {
  color: var(--ink-3);
  white-space: nowrap;
}
.wt-meta-value {
  font-weight: 700;
  color: var(--ink-2);
  white-space: nowrap;
}
/* 日出日落卡片：日出 / 日落各占一行，图标对齐标签、时间贴右 */
.wt-meta-rise {
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 5px;
}
.wt-rise-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wt-rise-row .wt-meta-value {
  margin-left: auto;
}
.wt-rise-ico--sun {
  color: #c98a2b;
  flex: none;
}
.wt-rise-ico--moon {
  color: #6b7e92;
  flex: none;
}
/* 超窄屏（<380px）两卡并排会拥挤，改为上下堆叠 */
@media (max-width: 380px) {
  .wt-meta-row {
    flex-direction: column;
    gap: 8px;
  }
}

/* ============ 未来 8 天 ============ */
.wt-days {
  list-style: none;
}
.wt-day {
  display: grid;
  grid-template-columns: 40px 42px 26px 52px 1fr 76px;
  align-items: center;
  gap: 8px;
  padding: 7px 4px;
  border-bottom: 1px dashed var(--line);
  opacity: 0;
  animation: wt-item-in 0.4s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 45ms + 150ms);
}
.wt-day:last-child {
  border-bottom: none;
}
.wt-day-week {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink-2);
}
.wt-day:first-child .wt-day-week {
  color: var(--red);
}
.wt-day-date {
  font-size: 0.7rem;
  color: var(--ink-3);
}
.wt-day-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.wt-day-weather {
  font-size: 0.74rem;
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wt-day-bar-wrap {
  position: relative;
  height: 5px;
  border-radius: 999px;
  background: var(--paper-2);
}
.wt-day-bar {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #e0a64b, var(--red));
}
.wt-day-temp {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink-2);
  text-align: right;
  white-space: nowrap;
}

/* ============ 生活指数 ============ */
.wt-index {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.wt-index-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 10px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  text-align: center;
  cursor: default;
  opacity: 0;
  animation: wt-item-in 0.4s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 40ms + 200ms);
  transition: transform 0.25s ease, border-color 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .wt-index-item:hover {
    transform: translateY(-2px);
    border-color: var(--gold);
  }
}
.wt-index-name {
  font-size: 0.7rem;
  color: var(--ink-3);
}
.wt-index-info {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ink-2);
}

/* ============ 骨架屏 / 错误 ============ */
.wt-skeletons {
  padding: 4px 2px;
}
.wt-skel-now {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line);
}
.wt-skel-icon {
  width: 96px;
  height: 96px;
  border-radius: 16px;
}
.wt-skel-row {
  height: 30px !important;
  margin-top: 12px;
}
.wt-error {
  text-align: center;
  padding: 42px 10px;
  color: var(--ink-3);
  font-size: 0.88rem;
}
.wt-error-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--red-tint);
  color: var(--red);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 40px;
}
.retry-btn.n-button {
  margin-top: 12px;
}

/* ============ 底部 ============ */
.wt-foot {
  flex: none;
  padding: 7px 16px 10px;
  border-top: 1px solid var(--line);
  background: var(--paper-2);
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}
.wt-soft-error {
  color: var(--red);
}

/* 键盘焦点 */
.wt-tab:focus-visible,
.wt-icon-btn:focus-visible,
.retry-btn:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* ============ 遮罩 ============ */
.wt-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: none;
  background: rgba(20, 15, 8, 0.5);
}
.wt-mask-enter-active,
.wt-mask-leave-active {
  transition: opacity 0.4s ease;
}
.wt-mask-enter-from,
.wt-mask-leave-to {
  opacity: 0;
}

/* ============ 移动端（≤600px）：底部抽屉 ============ */
@media (max-width: 600px) {
  .wt-mask {
    display: block;
  }
  .wt-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 82vh;
    height: 82dvh;
    border-radius: 18px 18px 0 0;
    transform: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .wt-enter-from,
  .wt-leave-to {
    transform: translateY(100%);
  }
  .wt-panel::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 50%;
    z-index: 2;
    width: 38px;
    height: 4px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: var(--line-2);
    opacity: 0.8;
    pointer-events: none;
  }
  .wt-head {
    padding-top: 21px;
    touch-action: pan-y;
  }
}
</style>
