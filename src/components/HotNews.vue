<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NIcon, NSkeleton, NTabPane, NTabs } from 'naive-ui'
import { Close, Refresh } from '@vicons/ionicons5'
import { useSidePanel } from '../composables/useSidePanel'
import { useHotNewsData, type HotItem } from '../composables/useHotNews'
import { changeMeta, firstOf, formatHot } from '../utils/format'

// ============ 浮窗开合（互斥避让 / 外部点击关闭 / 滚轮锁定 / 移动端背景锁） ============
// startSession / stopSession 在下方声明：仅作为回调传入，浮窗开合时才执行
const { open, panelRef, isNarrow, openPanel, closePanel, onAfterLeave } = useSidePanel({
  mutexClass: 'hotnews-open',
  listSelector: '.hw-list',
  onOpen: startSession,
  onClose: stopSession,
  onCleanup: () => document.removeEventListener('visibilitychange', onVisibility),
})

// ============ 榜单数据状态机（缓存 / 限速 / 重试 / 预取 / 定时刷新） ============
const {
  TABS,
  activeTab,
  items,
  loading,
  error,
  refreshing,
  softError,
  currentLabel,
  timeLabel,
  loadTab,
  peekCached,
  prefetchRest,
  startAuto,
  stopAuto,
  onVisibility,
} = useHotNewsData(open)

// 首次打开浮窗：首榜沿用淡入+上移（hw-swap）与条目逐条入场；之后切榜才走双层平移
const firstRendered = ref(false)
// 打开浮窗重置阶段：抑制 activeTab watch 的切榜舞台动画，首榜数据由 watch(items) 直接铺设
let suppressStage = false

function startSession() {
  // 每次打开都重置舞台与手势状态（动画进行中关闭浮窗的边界情况也要清干净）
  window.clearTimeout(slideTimer)
  window.clearTimeout(settleTimer)
  suppressStage = true
  firstRendered.value = false
  leaveRows.value = null
  previewRows.value = null
  gesture.value = null
  stageRows.value = []
  stageKey.value = ''
  // 每次打开默认「热搜」榜
  activeTab.value = TABS[0].key
  void loadTab(activeTab.value).finally(() => {
    suppressStage = false
  })
  // 后台预取其余全部榜单，预取完成后切换任何标签都是即时渲染
  void prefetchRest(activeTab.value)
  document.addEventListener('visibilitychange', onVisibility)
  startAuto()
}
function stopSession() {
  document.removeEventListener('visibilitychange', onVisibility)
  window.clearTimeout(slideTimer)
  window.clearTimeout(settleTimer)
  stopAuto()
}

// ============ 切换榜单时列表回到顶部 ============
// 各榜单共用同一个 .hw-list 滚动容器，切榜只替换内部列表，滚动位置不会自动复位。
// 切榜开始瞬间立即归零（双层平移在顶部进行，高度差不可见）；
// 未命中缓存走骨架屏时，由 @after-leave 在旧内容离场间隙兜底归零
const listEl = ref<HTMLElement | null>(null)
let pendingScrollReset = false
function onSwapAfterLeave() {
  if (!pendingScrollReset) return
  pendingScrollReset = false
  listEl.value?.scrollTo(0, 0)
}

// ============ 切榜双层平移舞台 ============
// out-in 单容器过渡必然是"旧内容消失 → 空白 → 新内容出现"；要做到连贯的轮播式滑动，
// 切榜瞬间必须同时存在两层：离开层（旧榜快照，绝对定位覆盖）与进入层（新榜，在文档流中
// 撑开滚动高度）。点击 tab：两层用 CSS 关键帧做 0.3s 反向平移；
// 触摸拖拽：拖拽中两层实时跟手，抬手提交时从手指当前位置无缝续滑（不重播关键帧）。
// 仅当新旧两榜都有可渲染数据（已预取、命中缓存同步渲染）时启用；
// 新榜未缓存（loading）或异常时退化为骨架屏/错误态淡入
const stageRows = ref<HotItem[]>([])
const stageKey = ref('')
const leaveRows = ref<HotItem[] | null>(null)
// 拖拽中相邻榜单的预览层（与离开层结构相同，仅在跟手/回弹期间存在）
const previewRows = ref<HotItem[] | null>(null)
// 每次切榜自增：强制进入层 ol 重新挂载以重播滑入动画
const animNonce = ref(0)
// 舞台动画模式：点击切榜走 CSS 关键帧（key-l/key-r）；手势提交走命令式续滑（gesture）
const animMode = ref<'' | 'key-l' | 'key-r' | 'gesture'>('')
const enterEl = ref<HTMLElement | null>(null)
const leaveEl = ref<HTMLElement | null>(null)
const previewEl = ref<HTMLElement | null>(null)
let slideTimer: number | undefined
// 回弹（settleBack / bounceBack）收尾定时器：与 slideTimer 分开，便于起手时分别清理
let settleTimer: number | undefined

// 手势提交瞬间携带的起点信息：watch 中据此把两层定位在手指位置，再过渡到终态
interface GestureCommit {
  dx0: number
  width: number
  fromRows: HotItem[]
}
let pendingCommit: GestureCommit | null = null

// 数据层 watch（useHotNewsData 内）先注册先执行，故本 watch 触发时 items/loading
// 已是目标榜状态：命中内存/localStorage 缓存时 items 已同步替换，未命中则 loading=true
watch(activeTab, (next, prev) => {
  if (suppressStage) return // 打开浮窗时重置为首榜，不产生切榜动画
  const iNext = TABS.findIndex((t) => t.key === next)
  const iPrev = TABS.findIndex((t) => t.key === prev)
  const dir: 1 | -1 = iNext >= 0 && iPrev >= 0 && iNext < iPrev ? -1 : 1
  firstRendered.value = true

  if (loading.value || items.value.length === 0) {
    // 新榜无现成内容：中断可能进行中的滑动，交给骨架屏/错误态分支
    window.clearTimeout(slideTimer)
    window.clearTimeout(settleTimer)
    pendingCommit = null
    animMode.value = ''
    leaveRows.value = null
    previewRows.value = null
    gesture.value = null
    pendingScrollReset = true
    return
  }

  // 双层滑动：以拖拽前（或点击前）舞台内容为离场快照，新榜数据即刻铺到进入层
  listEl.value?.scrollTo(0, 0)
  const fromRows = pendingCommit?.fromRows ?? (stageKey.value === prev ? stageRows.value : [])
  leaveRows.value = fromRows.length ? fromRows : null
  stageRows.value = items.value
  stageKey.value = next
  animNonce.value++

  const commit = pendingCommit
  pendingCommit = null
  if (commit) {
    animMode.value = 'gesture'
    // 进入层与离开层将在渲染后挂载：先把两者定位在手指抬起瞬间的视觉位置，
    // 下一帧再加 transition 滑向终态（enter→0，leave→对侧屏外），保证无跳变
    requestAnimationFrame(() => {
      const enter = enterEl.value
      const leave = leaveEl.value
      if (!enter) return
      enter.style.transition = 'none'
      enter.style.transform = `translateX(${commit.dx0 + dir * commit.width}px)`
      if (leave) {
        leave.style.transition = 'none'
        leave.style.transform = `translateX(${commit.dx0}px)`
      }
      requestAnimationFrame(() => {
        enter.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)'
        enter.style.transform = ''
        if (leave) {
          leave.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)'
          leave.style.transform = `translateX(${-dir * commit.width}px)`
        }
      })
    })
    window.clearTimeout(slideTimer)
    slideTimer = window.setTimeout(finishSlide, 300)
  } else {
    animMode.value = dir === 1 ? 'key-l' : 'key-r'
    window.clearTimeout(slideTimer)
    // 与 CSS 关键帧时长（0.3s）对齐，结束后移除离场层，舞台回到单层
    slideTimer = window.setTimeout(finishSlide, 320)
  }
})

function finishSlide() {
  leaveRows.value = null
  previewRows.value = null
  animMode.value = ''
  if (enterEl.value) {
    enterEl.value.style.transition = ''
    enterEl.value.style.transform = ''
  }
}

// 拖拽中两层实时跟手（内联样式驱动、无过渡，手指动多少内容走多少）：
// 当前层随手指位移；相邻榜预览层始终紧贴当前层对侧边缘（100% 为自身宽度，与当前层等宽）
const enterStyle = computed(() => {
  const g = gesture.value
  if (!g) return undefined
  return { transition: 'none', transform: `translateX(${g.dx}px)` }
})
const previewStyle = computed(() => {
  const g = gesture.value
  if (!g) return undefined
  return {
    transition: 'none',
    transform: `translateX(calc(${g.dx}px + ${g.dir * 100}%))`,
  }
})
// 点击切榜才挂关键帧类（--l/--r）；拖拽中与手势续滑期间均无类，避免关键帧与内联变换打架
const stageClass = computed(() => {
  if (animMode.value === 'key-l') return 'hw-stage--l'
  if (animMode.value === 'key-r') return 'hw-stage--r'
  return ''
})

// 同榜静默刷新（定时自动刷新等）：直接更新舞台内容，不产生任何切换动画
watch(items, (v) => {
  // 滑动 / 拖拽提交 / 跟手进行中所需数据已由 activeTab watch 显式铺设或保持快照，避免静默刷新搅场
  if (leaveRows.value || pendingCommit || gesture.value) return
  if (!loading.value && v.length) {
    stageRows.value = v
    stageKey.value = activeTab.value
  }
})

// ============ 移动端触摸手势：拖拽实时跟手 + 抬手续滑/回弹 ============
// 触摸起点记录；方向锁在首次明显移动时确定为水平或垂直，水平手势才参与切榜，
// 避免上下滚动列表时误触切换
interface DragGesture {
  dx: number // 当前水平位移（已钳制不越起点；边界时已乘阻尼，左滑为负）
  dir: 1 | -1 // 1：左滑看下一榜；-1：右滑看上一榜（首次越过方向锁即固定）
}
const gesture = ref<DragGesture | null>(null)
let touchX = 0
let touchY = 0
let touchT = 0
let swipeAxis: '' | 'x' | 'y' = ''
let dragMeta:
  | {
      fromRows: HotItem[]
      toKey: string
      toRows: HotItem[] | null
      width: number
      edge: boolean
      dir: 1 | -1
    }
  | null = null

function onSwipeStart(e: TouchEvent) {
  const t = e.touches[0]
  touchX = t.clientX
  touchY = t.clientY
  touchT = Date.now()
  swipeAxis = ''
  dragMeta = null
  // 新手势接管：若上一次切榜 / 回弹尚未收尾，立即清掉残留层与定时器（进入层终态就是
  // 归位，提前摘掉离场/预览层无视觉跳变），避免旧预览层在新手势里张冠李戴
  window.clearTimeout(slideTimer)
  window.clearTimeout(settleTimer)
  if (leaveRows.value || previewRows.value || animMode.value) {
    leaveRows.value = null
    previewRows.value = null
    animMode.value = ''
  }
  gesture.value = null
  if (enterEl.value) {
    enterEl.value.style.transition = ''
    enterEl.value.style.transform = ''
  }
}

function onSwipeMove(e: TouchEvent) {
  const t = e.touches[0]
  const rawDx = t.clientX - touchX
  const dy = t.clientY - touchY
  // 超过 10px 才判定主方向，过滤手指微抖
  if (!swipeAxis && (Math.abs(rawDx) > 10 || Math.abs(dy) > 10)) {
    swipeAxis = Math.abs(rawDx) > Math.abs(dy) ? 'x' : 'y'
  }
  if (swipeAxis !== 'x') return

  // 仅窄屏（移动端）启用实时跟手；其他设备仍按抬手判定切换
  if (!isNarrow()) return

  const idx = TABS.findIndex((x) => x.key === activeTab.value)
  if (!dragMeta) {
    // 首次进入水平拖拽：确定并锁定方向、读取相邻榜缓存（零延迟，供预览层即时渲染）
    const dir: 1 | -1 = rawDx < 0 ? 1 : -1
    const toIdx = idx + (dir === 1 ? 1 : -1)
    const width = enterEl.value?.offsetWidth || listEl.value?.clientWidth || 320
    const fromRows = stageRows.value.slice()
    const atBound = dir === 1 ? idx >= TABS.length - 1 : idx <= 0
    const toTab = toIdx >= 0 && toIdx < TABS.length ? TABS[toIdx].key : ''
    const toRows = !atBound && toTab ? peekCached(toTab) : null
    dragMeta = { fromRows, toKey: toTab, toRows, width, edge: atBound || !toRows, dir }
  }

  // 位移不越过起点反方向（手指回拖超过起点时停在 0，避免预览层突然跳到另一侧）
  let dx = rawDx
  if (dragMeta.dir === 1) dx = Math.min(dx, 0)
  else dx = Math.max(dx, 0)
  // 边界（含相邻榜未缓存）施加 0.28 阻尼，提示"拖不动了"
  if (dragMeta.edge) dx *= 0.28
  gesture.value = { dx, dir: dragMeta.dir }
  // 相邻榜有缓存时露出预览层（数据在拖拽期间不变，赋值一次即可）
  if (dragMeta.toRows && !previewRows.value) previewRows.value = dragMeta.toRows
}

function onSwipeEnd(e: TouchEvent) {
  const axis = swipeAxis
  swipeAxis = ''
  const t = e.changedTouches[0]
  const rawDx = t.clientX - touchX
  const dt = Date.now() - touchT

  // 非跟手手势（宽屏触摸，或未形成水平拖拽）：沿用抬手判定
  if (!dragMeta) {
    if (axis !== 'x') return
    const width = listEl.value?.clientWidth ?? 320
    const isFlick = dt < 500 && Math.abs(rawDx) > 40
    const isLongDrag = Math.abs(rawDx) > width * 0.25
    if (!isFlick && !isLongDrag) return
    const idx = TABS.findIndex((x) => x.key === activeTab.value)
    if (rawDx < 0 && idx >= 0 && idx < TABS.length - 1) activeTab.value = TABS[idx + 1].key
    else if (rawDx > 0 && idx > 0) activeTab.value = TABS[idx - 1].key
    return
  }

  const meta = dragMeta
  dragMeta = null
  const g = gesture.value
  gesture.value = null
  const dx = g?.dx ?? 0
  // 快速轻扫（500ms 内、沿锁定方向位移超 40px）或拖动超过宽度 1/4，二者满足其一即提交
  const flickDist = meta.dir === 1 ? -rawDx : rawDx
  const isFlick = dt < 500 && flickDist > 40
  const isLongDrag = Math.abs(dx) > meta.width * 0.25

  if ((isFlick || isLongDrag) && !meta.edge && meta.toRows) {
    // 提交：两层从手指位置无缝续滑，舞台铺设交给 activeTab watch（pendingCommit 携带起点）
    pendingCommit = { dx0: dx, width: meta.width, fromRows: meta.fromRows }
    previewRows.value = null
    activeTab.value = meta.toKey
  } else if (meta.toRows) {
    // 回弹：当前层与预览层从当前位置平滑归位
    settleBack(dx, meta.dir)
  } else {
    // 边界阻尼回弹：只有当前层
    bounceBack(dx)
  }
}

// 拖拽被系统取消（touchcancel）：等同未达阈值回弹
function onSwipeCancel() {
  swipeAxis = ''
  const meta = dragMeta
  dragMeta = null
  const g = gesture.value
  gesture.value = null
  if (!meta) return
  if (meta.toRows) settleBack(g?.dx ?? 0, meta.dir)
  else bounceBack(g?.dx ?? 0)
}

// 注意：gesture 置空后，Vue 对 :style 的补丁会在微任务中摘除 transform/transition，
// 同步写入的命令式样式会被这次补丁清掉。因此统一在 rAF（补丁之后、首帧绘制之前）
// 先以 transition:none 锁回手指位置，双 rAF 再加过渡滑向终态，全程无跳变一帧
function settleBack(dx: number, dir: 1 | -1) {
  requestAnimationFrame(() => {
    const enter = enterEl.value
    const preview = previewEl.value
    if (enter) {
      enter.style.transition = 'none'
      enter.style.transform = `translateX(${dx}px)`
    }
    if (preview) {
      preview.style.transition = 'none'
      preview.style.transform = `translateX(calc(${dx}px + ${dir * 100}%))`
    }
    requestAnimationFrame(() => {
      if (enterEl.value) {
        enterEl.value.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)'
        enterEl.value.style.transform = ''
      }
      if (previewEl.value) {
        previewEl.value.style.transition = 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)'
        previewEl.value.style.transform = `translateX(${dir * 100}%)`
      }
    })
  })
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    previewRows.value = null
    if (enterEl.value) enterEl.value.style.transition = ''
  }, 300)
}

// 边界阻尼回弹：仅当前层，时程稍短
function bounceBack(dx: number) {
  const enter = enterEl.value
  if (!enter) return
  requestAnimationFrame(() => {
    enter.style.transition = 'none'
    enter.style.transform = `translateX(${dx}px)`
    requestAnimationFrame(() => {
      enter.style.transition = 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)'
      enter.style.transform = ''
    })
  })
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    if (enterEl.value) enterEl.value.style.transition = ''
  }, 280)
}

// ============ 展示辅助 ============
const itemLink = (it: HotItem) => firstOf(it.url)
const tagImgOf = (v: string | string[]) => firstOf(v)

const isTop = (it: HotItem) => typeof it.ranking === 'string'
function rankClass(it: HotItem) {
  if (isTop(it)) return 'hw-rank--top'
  const r = Number(it.ranking)
  if (r === 1) return 'hw-rank--1'
  if (r === 2) return 'hw-rank--2'
  if (r === 3) return 'hw-rank--3'
  return ''
}
const rankLabel = (it: HotItem) => (isTop(it) ? '顶' : String(it.ranking))
</script>

<template>
  <!-- 收起态：桌面与移动端均为右侧竖排签（位于「历史上的今天」下方）。
       显隐由全局 html.hotnews-open / html.history-open 统一控制，保证两侧签同步 -->
  <button class="hw-tab" aria-label="查看百度热搜" @click="openPanel">
    <span class="hw-tab-text">百度热搜</span>
  </button>

  <!-- 遮罩：仅移动端显示，点击关闭 -->
  <Transition name="hw-mask">
    <div v-if="open" class="hw-mask" aria-hidden="true" @click="closePanel"></div>
  </Transition>

  <!-- 展开态：桌面为右侧浮窗，移动端（≤600px）为底部抽屉 -->
  <Transition name="hw" @after-leave="onAfterLeave">
    <div v-if="open" :ref="panelRef" class="hw-panel" role="dialog" aria-label="百度热搜新闻榜">
      <header class="hw-head">
        <div class="hw-head-info">
          <div class="hw-kicker">BAIDU HOT SEARCH</div>
          <h3 class="hw-title">百度热搜</h3>
        </div>
        <div class="hw-actions">
          <span v-if="timeLabel" class="hw-updated">
            <i class="hw-live-dot" aria-hidden="true"></i>{{ timeLabel }}
          </span>
          <n-button
            class="hw-icon-btn"
            :class="{ 'is-spin': refreshing }"
            quaternary
            circle
            size="small"
            title="刷新榜单"
            aria-label="刷新榜单"
            @click="loadTab(activeTab, { force: true })"
          >
            <template #icon>
              <n-icon :size="16"><Refresh /></n-icon>
            </template>
          </n-button>
          <n-button class="hw-icon-btn" quaternary circle size="small" title="关闭" aria-label="关闭浮窗" @click="closePanel">
            <template #icon>
              <n-icon :size="17"><Close /></n-icon>
            </template>
          </n-button>
        </div>
      </header>

      <!-- 榜单切换；仅用其标签栏，列表区域由下方自定义渲染。
           标签栏向右出血至面板边缘外，后续标签被硬裁剪露出部分文字，直观提示还有更多榜单 -->
      <div class="hw-tabs-wrap">
        <n-tabs
          v-model:value="activeTab"
          class="hw-tabs"
          size="small"
          trigger="click"
          :pane-wrapper-style="{ display: 'none' }"
        >
          <n-tab-pane v-for="t in TABS" :key="t.key" :name="t.key">
            <template #tab>{{ t.label }}</template>
          </n-tab-pane>
        </n-tabs>
      </div>

      <div
        class="hw-list"
        ref="listEl"
        @touchstart.passive="onSwipeStart"
        @touchmove.passive="onSwipeMove"
        @touchend="onSwipeEnd"
        @touchcancel="onSwipeCancel"
      >
        <Transition name="hw-swap" mode="out-in" @after-leave="onSwapAfterLeave">
          <!-- 骨架屏：n-skeleton 实现；行数超满 + 容器溢出隐藏，保证铺满整个列表区。
               滑动舞台一旦有数据即承载列表，切到未缓存榜单时才回落到骨架屏 -->
          <div v-if="loading && stageRows.length === 0" :key="`loading-${activeTab}`" class="hw-skeletons">
            <div v-for="i in 12" :key="i" class="hw-skel-row">
              <n-skeleton class="hw-skel-rank" :sharp="false" />
              <span class="hw-skel-wrap">
                <n-skeleton text style="width: 72%" />
                <n-skeleton text style="width: 92%" />
              </span>
              <n-skeleton class="hw-skel-score" :sharp="false" />
            </div>
          </div>

          <!-- 错误态（无缓存数据时） -->
          <div v-else-if="error && stageRows.length === 0" :key="`error-${activeTab}`" class="hw-error">
            <div class="hw-error-icon">!</div>
            <p>{{ error }}</p>
            <n-button class="retry-btn" round ghost color="#BE3A2B" @click="loadTab(activeTab, { force: true })">重新加载</n-button>
          </div>

          <!-- 空态 -->
          <div v-else-if="stageRows.length === 0" key="empty" class="hw-error">当前榜单暂无数据</div>

          <!-- 榜单列表双层舞台（key 恒定：切榜在舞台内部完成，不经过外层 Transition，
               因此没有任何淡入淡出；首次挂载时条目逐条入场，切榜时纯横向平移）。
               离开层 / 预览层 / 进入层行结构必须保持一致，修改行结构时三处同步 -->
          <div v-else key="stage" class="hw-stage" :class="stageClass">
            <!-- 离开层：旧榜快照，绝对定位覆盖，自起始位向侧方滑出 -->
            <ol v-if="leaveRows" ref="leaveEl" class="hw-items hw-layer hw-layer--leave hw-items--plain" aria-hidden="true">
              <li v-for="it in leaveRows" :key="String(it.ranking) + it.word" class="hw-item">
                <component
                  :is="itemLink(it) ? 'a' : 'div'"
                  class="hw-row"
                  :href="itemLink(it) || undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  tabindex="-1"
                >
                  <span class="hw-rank" :class="rankClass(it)">{{ rankLabel(it) }}</span>
                  <span class="hw-main">
                    <span class="hw-word">
                      {{ it.word }}
                      <img
                        v-if="tagImgOf(it.hotTagImg)"
                        :src="tagImgOf(it.hotTagImg)"
                        class="hw-tagimg"
                        alt=""
                        loading="lazy"
                      >
                    </span>
                    <span v-if="it.desc" class="hw-desc">{{ it.desc }}</span>
                  </span>
                  <span class="hw-meta">
                    <span v-if="formatHot(it.hotScore)" class="hw-score">{{ formatHot(it.hotScore) }}</span>
                    <span
                      v-if="changeMeta(it.hotChange).text"
                      class="hw-change"
                      :class="changeMeta(it.hotChange).cls"
                    >
                      {{ changeMeta(it.hotChange).text }}
                    </span>
                  </span>
                </component>
              </li>
            </ol>

            <!-- 进入层：当前榜数据，文档流内撑开滚动高度，自对侧滑入；
                 key 随榜单+nonce 变化以在每次切榜时重播滑入动画；
                 拖拽期间 transform 由内联 enterStyle 实时驱动，无过渡、完全跟手 -->
            <ol
              :key="`${stageKey}-${animNonce}`"
              ref="enterEl"
              class="hw-items hw-layer hw-layer--enter"
              :class="{ 'hw-items--plain': firstRendered }"
              :style="enterStyle"
              :aria-label="`百度${currentLabel}榜`"
            >
              <li
                v-for="(it, i) in stageRows"
                :key="String(it.ranking) + it.word"
                class="hw-item"
                :style="{ '--i': Math.min(i, 12) }"
              >
                <component
                  :is="itemLink(it) ? 'a' : 'div'"
                  class="hw-row"
                  :href="itemLink(it) || undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="hw-rank" :class="rankClass(it)">{{ rankLabel(it) }}</span>
                  <span class="hw-main">
                    <span class="hw-word">
                      {{ it.word }}
                      <img
                        v-if="tagImgOf(it.hotTagImg)"
                        :src="tagImgOf(it.hotTagImg)"
                        class="hw-tagimg"
                        alt=""
                        loading="lazy"
                      >
                    </span>
                    <span v-if="it.desc" class="hw-desc">{{ it.desc }}</span>
                  </span>
                  <span class="hw-meta">
                    <span v-if="formatHot(it.hotScore)" class="hw-score">{{ formatHot(it.hotScore) }}</span>
                    <span
                      v-if="changeMeta(it.hotChange).text"
                      class="hw-change"
                      :class="changeMeta(it.hotChange).cls"
                    >
                      {{ changeMeta(it.hotChange).text }}
                    </span>
                  </span>
                </component>
              </li>
            </ol>

            <!-- 拖拽预览层：相邻榜缓存内容，仅移动端跟手/回弹期间存在，绝对定位贴在对侧屏外。
                 位置由 previewStyle 实时驱动（当前层位移 + 自身一整宽），与当前层边缘始终贴合 -->
            <ol
              v-if="previewRows"
              ref="previewEl"
              class="hw-items hw-layer hw-layer--preview hw-items--plain"
              :style="previewStyle"
              aria-hidden="true"
            >
              <li v-for="it in previewRows" :key="String(it.ranking) + it.word" class="hw-item">
                <component
                  :is="itemLink(it) ? 'a' : 'div'"
                  class="hw-row"
                  :href="itemLink(it) || undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  tabindex="-1"
                >
                  <span class="hw-rank" :class="rankClass(it)">{{ rankLabel(it) }}</span>
                  <span class="hw-main">
                    <span class="hw-word">
                      {{ it.word }}
                      <img
                        v-if="tagImgOf(it.hotTagImg)"
                        :src="tagImgOf(it.hotTagImg)"
                        class="hw-tagimg"
                        alt=""
                        loading="lazy"
                      >
                    </span>
                    <span v-if="it.desc" class="hw-desc">{{ it.desc }}</span>
                  </span>
                  <span class="hw-meta">
                    <span v-if="formatHot(it.hotScore)" class="hw-score">{{ formatHot(it.hotScore) }}</span>
                    <span
                      v-if="changeMeta(it.hotChange).text"
                      class="hw-change"
                      :class="changeMeta(it.hotChange).cls"
                    >
                      {{ changeMeta(it.hotChange).text }}
                    </span>
                  </span>
                </component>
              </li>
            </ol>
          </div>
        </Transition>
      </div>

      <footer class="hw-foot">
        <span v-if="softError" class="hw-soft-error">{{ softError }}</span>
        <span v-else>数据来源 · 百度热搜 · 相见拾光 API · 仅供参考</span>
      </footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ============ 收起态竖排签 ============ */
.hw-tab {
  position: fixed;
  /* 上下排列：最下方（间距 8px，步进 49px） */
  right: env(safe-area-inset-right, 0px);
  top: calc(50% + 49px);
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
  /* 回归延迟 450ms：等浮窗离场播完再淡入，避免突兀闪现；
     隐藏态样式由全局 styles.css 的互斥避让规则统一提供（与 .ht-tab 同步） */
  transition: padding 0.3s ease, opacity 0.4s ease-out 450ms,
    transform 0.4s ease-out 450ms, visibility 0s linear 450ms;
}
.hw-tab-text {
  font-size: 0.875rem;
  font-weight: 700;
}
@media (hover: hover) and (pointer: fine) {
  .hw-tab:hover {
    padding-right: 18px;
  }
}
/* 窄屏：缩小按钮与字号 */
@media (max-width: 600px) {
  .hw-tab {
    padding: 8px 10px;
    font-size: 0.8rem;
  }
}
/* ============ 浮窗面板 ============ */
.hw-panel {
  position: fixed;
  right: max(clamp(8px, 2vw, 24px), env(safe-area-inset-right, 0px));
  top: 50%;
  z-index: 71;
  transform: translateY(-50%);
  width: min(384px, 92vw);
  /* 高度恒定：骨架屏 / 列表 / 错误态下面板长度始终一致，避免先短后长 */
  height: min(78vh, 700px);
  /* dvh 跟随 iOS 动态工具栏，避免地址栏收缩时高度跳动 */
  height: min(78dvh, 700px);
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  overscroll-behavior: contain;
}
/* 装裱式内描金细框 */
.hw-panel::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(185, 143, 62, 0.4);
  border-radius: 10px;
  pointer-events: none;
}
.hw-enter-active,
.hw-leave-active {
  transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.hw-enter-from,
.hw-leave-to {
  opacity: 0;
  /* 不使用 scale：缩放会让面板视觉上先小后大，只做横向位移 + 透明，高度始终恒定 */
  transform: translateY(-50%) translateX(60px);
}

/* ============ 头部 ============ */
.hw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px 12px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border-bottom: 1px solid var(--line);
}
.hw-kicker {
  font-size: 0.66rem;
  letter-spacing: 0.3em;
  color: var(--gold);
  font-weight: 600;
}
.hw-title {
  font-size: 1.15rem;
  font-weight: 900;
  color: var(--ink);
  margin-top: 2px;
}
.hw-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hw-updated {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.7rem;
  color: var(--ink-3);
}
.hw-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--red);
  animation: hw-pulse 1.8s ease-in-out infinite;
}
@keyframes hw-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
/* naive 主题变量以内联样式注入组件根节点，覆盖需 !important */
.hw-icon-btn.n-button {
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
.hw-icon-btn.is-spin :deep(svg) {
  animation: hw-spin 0.9s linear infinite;
}
@keyframes hw-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ============ Tabs ============ */
.hw-tabs-wrap {
  flex: none;
}
.hw-tabs {
  /* 左侧内边距收窄 + 标签内边距收窄，使整体标签排布左移：
     第 5 个标签「小说」被面板右缘硬裁剪时，「小」字完整露出并带出「说」字边缘，
     直观提示后方还有更多榜单 */
  padding: 0 0 0 8px;
  border-bottom: 1px solid var(--line);
}
.hw-tabs :deep(.n-tabs-tab) {
  font-size: 0.84rem;
  font-weight: 700;
  padding: 8px 10px;
}
.hw-tabs :deep(.n-tabs-bar) {
  height: 2.5px;
  border-radius: 999px;
}

/* ============ 榜单列表 ============ */
.hw-list {
  flex: 1;
  overflow-y: auto;
  /* 切榜平移时内容不产生横向滚动条（transform 本不触发布局溢出，hidden 为双保险） */
  overflow-x: hidden;
  overscroll-behavior: contain;
  /* 纵向滚动交给浏览器原生处理，横向手势交由滑动切榜逻辑（桌面无触摸不受影响） */
  touch-action: pan-y;
  padding: 7px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.hw-list::-webkit-scrollbar {
  width: 5px;
}
.hw-list::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}
.hw-items {
  list-style: none;
}
/* 非首次切榜：关闭条目逐条入场，整列表由外层 slide 过渡平移 */
.hw-items--plain .hw-item {
  opacity: 1;
  animation: none;
}
.hw-item {
  opacity: 0;
  animation: hw-item-in 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i) * 32ms);
}
/* 淡入 + 轻微上移入场 */
@keyframes hw-item-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.hw-row {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 10px;
  text-decoration: none;
  transition: background 0.25s ease, transform 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .hw-row:hover {
    background: var(--paper-2);
    transform: translateX(2px);
  }
  .hw-row:hover .hw-word {
    color: var(--red);
  }
  .hw-row:hover .hw-rank {
    transform: scale(1.12);
  }
}
.hw-rank {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--paper-2);
  color: var(--ink-3);
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.78rem;
  font-weight: 700;
  transition: transform 0.25s ease;
}
.hw-rank--1 {
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  color: #fff;
}
.hw-rank--2 {
  background: linear-gradient(165deg, #dd8040 0%, #c3612a 100%);
  color: #fff;
}
.hw-rank--3 {
  background: linear-gradient(165deg, var(--gold) 0%, #9d762d 100%);
  color: #fff;
}
.hw-rank--top {
  background: var(--red-deep);
  color: #fff;
  font-size: 0.7rem;
}
.hw-main {
  min-width: 0;
}
.hw-word {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--ink-2);
  line-height: 1.45;
  transition: color 0.25s ease;
}
.hw-tagimg {
  flex: none;
  height: 16px;
  width: auto;
}
.hw-desc {
  display: block;
  margin-top: 1px;
  font-size: 0.73rem;
  color: var(--ink-3);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hw-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.hw-score {
  font-size: 0.72rem;
  color: var(--ink-3);
  white-space: nowrap;
}
.hw-change {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
}
.hw-change--up {
  color: var(--red);
}
.hw-change--down {
  color: var(--teal);
}
.hw-change--new {
  color: var(--gold);
}

/* ============ 状态切换过渡（骨架 ↔ 列表、榜单切换） ============ */
.hw-swap-enter-active {
  transition: opacity 0.35s ease-out, transform 0.35s ease-out;
}
.hw-swap-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.hw-swap-leave-active {
  transition: opacity 0.18s ease;
}
.hw-swap-leave-to {
  opacity: 0;
}

/* ============ 切榜双层平移舞台 ============ */
/* 进入层（当前榜）在文档流内撑开滚动高度；离开层（旧榜快照）绝对定位覆盖其上。
   两层以相同的时长与缓动做方向相反的纯 translateX 动画，边缘始终贴合、全程不透明，
   从视觉上就是一整屏内容被横着推走，没有淡入淡出与中间空白 */
.hw-stage {
  position: relative;
}
/* 离开层与拖拽预览层均绝对定位覆盖在进入层之上（进入层在文档流内撑开高度），
   不响应触摸：拖拽手势全部由底层 .hw-list 接收 */
.hw-layer--leave,
.hw-layer--preview {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* 切到下一榜（--l）：旧层向左滑出，新层自右滑入 */
.hw-stage--l .hw-layer--leave {
  animation: hw-slide-out-l 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
.hw-stage--l .hw-layer--enter {
  animation: hw-slide-in-l 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes hw-slide-out-l {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
}
@keyframes hw-slide-in-l {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
/* 切到上一榜（--r）：方向镜像 */
.hw-stage--r .hw-layer--leave {
  animation: hw-slide-out-r 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
.hw-stage--r .hw-layer--enter {
  animation: hw-slide-in-r 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes hw-slide-out-r {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}
@keyframes hw-slide-in-r {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

/* ============ 骨架屏（naive-ui NSkeleton） ============ */
/* 行数给足 12 行（超出列表区高度），容器铺满并裁掉溢出部分，任何面板高度下都铺满 */
.hw-skeletons {
  height: 100%;
  overflow: hidden;
}
.hw-skel-row {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px;
}
.hw-skel-rank {
  width: 24px;
  height: 24px;
  border-radius: 7px;
}
.hw-skel-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hw-skel-score {
  width: 38px;
  height: 11px;
  border-radius: 6px;
}

/* ============ 错误态 ============ */
.hw-error {
  text-align: center;
  padding: 42px 10px;
  color: var(--ink-3);
  font-size: 0.88rem;
}
.hw-error-icon {
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
.hw-foot {
  flex: none;
  padding: 7px 16px 10px;
  border-top: 1px solid var(--line);
  background: var(--paper-2);
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.hw-soft-error {
  color: var(--red);
  letter-spacing: 0.04em;
}

/* 键盘焦点可见性 */
.hw-tab:focus-visible,
.hw-icon-btn:focus-visible,
.retry-btn:focus-visible,
a.hw-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* ============ 遮罩（桌面隐藏，移动端显示） ============ */
.hw-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: none;
  background: rgba(20, 15, 8, 0.5);
}
.hw-mask-enter-active,
.hw-mask-leave-active {
  transition: opacity 0.4s ease;
}
.hw-mask-enter-from,
.hw-mask-leave-to {
  opacity: 0;
}

/* ============ 移动端（≤600px）：入口保持右侧竖排签（与「历史上的今天」一致），浮窗 → 底部抽屉 ============ */
@media (max-width: 600px) {
  .hw-mask {
    display: block;
  }
  .hw-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    /* 高度恒定：与桌面态一致，任何状态下抽屉长度不变 */
    height: 82vh;
    height: 82dvh;
    border-radius: 18px 18px 0 0;
    transform: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  /* 抽屉从底部滑入/滑出（覆盖桌面态横向位移关键帧） */
  .hw-enter-from,
  .hw-leave-to {
    transform: translateY(100%);
  }
}
</style>
