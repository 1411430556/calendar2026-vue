import { nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance, type Ref } from 'vue'

// 右侧浮窗（历史上的今天 / 百度热搜）共用的开合机制：
// - 打开时在 <html> 挂互斥 class（两个侧签据此同步隐藏），移动端锁定背景滚动
// - 点击浮窗外部关闭；滚轮锁定在面板内部列表，到边界不链动整页
// - 关闭时只解监听 / 解锁，互斥 class 需等离场动画结束（onAfterLeave）才摘除，
//   保证两个侧签同时开始回归过渡
// - 可选：移动端头部下拉关闭手势（返回触摸处理函数，由模板按需绑定）

/** 移动端抽屉断点，与各组件 CSS 中 @media (max-width: 600px) 保持一致 */
const NARROW_QUERY = '(max-width: 600px)'

export interface SidePanelOptions {
  /** 打开期间挂到 <html> 上的互斥 class（如 history-open / hotnews-open） */
  mutexClass: string
  /** 面板内可滚动列表的选择器，滚轮锁定据此判断是否到达边界 */
  listSelector: string
  /** 打开动画首帧就绪后执行（加载数据、启动定时器等） */
  onOpen?: () => void
  /** 关闭时执行（停止定时器等）；互斥 class 不在此刻摘除 */
  onClose?: () => void
  /** 组件卸载时的额外清理 */
  onCleanup?: () => void
}

export interface SidePanelDrag {
  onDragStart: (e: TouchEvent) => void
  onDragMove: (e: TouchEvent) => void
  onDragEnd: (e: TouchEvent) => void
}

export function useSidePanel(options: SidePanelOptions) {
  const { mutexClass, listSelector } = options
  const open: Ref<boolean> = ref(false)
  const panelRef = ref<HTMLElement | null>(null)

  const isNarrow = () => window.matchMedia(NARROW_QUERY).matches

  function openPanel() {
    open.value = true
  }
  function closePanel() {
    open.value = false
  }

  // 面板离场动画结束后才摘除互斥标记：两个侧签同时开始回归过渡
  function onAfterLeave() {
    if (!open.value) document.documentElement.classList.remove(mutexClass)
  }

  // 点击浮窗外部任意区域关闭（pointerdown 同时覆盖鼠标 / 触摸 / 笔）
  function onDocPointerDown(e: PointerEvent) {
    if (panelRef.value && e.target instanceof Node && !panelRef.value.contains(e.target)) closePanel()
  }

  // 滚轮锁定在浮窗内：非列表区域一律拦截；列表滚到边界时也拦截，防止链动整页
  function onPanelWheel(e: WheelEvent) {
    const list = e.target instanceof Element ? e.target.closest(listSelector) : null
    if (!list) {
      e.preventDefault()
      return
    }
    const atTop = list.scrollTop <= 0
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1
    if ((e.deltaY <= 0 && atTop) || (e.deltaY >= 0 && atBottom)) e.preventDefault()
  }

  // ============ 移动端下拉关闭手势（仅触摸头部区域时生效，不影响列表滚动） ============
  let dragging = false
  let dragStartY = 0

  function onDragStart(e: TouchEvent) {
    if (!isNarrow() || !(e.target instanceof Element) || !e.target.closest('.side-panel-head')) return
    dragging = true
    dragStartY = e.touches[0].clientY
  }

  function onDragMove(e: TouchEvent) {
    if (!dragging || !panelRef.value) return
    // 只响应向下拖动；关闭 CSS 过渡使面板严格跟随手指
    const dy = Math.max(0, e.touches[0].clientY - dragStartY)
    panelRef.value.style.transition = 'none'
    panelRef.value.style.transform = `translateY(${dy}px)`
  }

  function onDragEnd(e: TouchEvent) {
    if (!dragging) return
    dragging = false
    const panel = panelRef.value
    if (!panel) return
    const dy = Math.max(0, e.changedTouches[0].clientY - dragStartY)
    if (dy > 90) {
      // 超过阈值：先定格在手位置，两帧后交还离场动画类，从当前位置继续滑到底部，避免瞬跳
      panel.style.transition = ''
      panel.style.transform = `translateY(${dy}px)`
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.transform = ''
        })
      })
      open.value = false
    } else {
      // 未达阈值：移除内联样式，由 CSS 过渡回弹归位
      panel.style.transition = ''
      panel.style.transform = ''
    }
  }

  watch(open, async (v) => {
    if (!v) {
      document.removeEventListener('pointerdown', onDocPointerDown)
      // 注意：互斥 class 不在此处摘除，需等面板离场动画结束（onAfterLeave），
      // 否则本侧签会比另一个侧签提前恢复，两者回归不同步
      document.body.style.overflow = ''
      options.onClose?.()
      return
    }
    // 打开期间隐藏两个侧签（全局 CSS 依据此标记处理，两个浮窗同步隐藏）
    document.documentElement.classList.add(mutexClass)
    // 数据加载 / 定时器启动与面板渲染无关，先于 nextTick 触发，
    // 保持与原组件"openPanel 中同步发起请求"一致的时序
    options.onOpen?.()
    // 移动端底部抽屉：锁定背景页面滚动，避免列表滚到边界时链动整页
    if (isNarrow()) document.body.style.overflow = 'hidden'
    await nextTick()
    const panel = panelRef.value
    if (panel) {
      // 清掉上次下拉手势可能残留的内联变换，保证入场动画从 CSS 起点开始
      panel.style.transform = ''
      panel.style.transition = ''
      panel.addEventListener('wheel', onPanelWheel, { passive: false })
    }
    document.addEventListener('pointerdown', onDocPointerDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocPointerDown)
    document.documentElement.classList.remove(mutexClass)
    document.body.style.overflow = ''
    options.onCleanup?.()
  })

  const drag: SidePanelDrag = { onDragStart, onDragMove, onDragEnd }

  // 模板使用 :ref="panelRef" 的函数式绑定：挂载时收到元素，卸载时收到 null（自动清空）
  function panelRefBinder(el: Element | ComponentPublicInstance | null) {
    panelRef.value = el instanceof HTMLElement ? el : null
  }

  return {
    open,
    panelRef: panelRefBinder,
    isNarrow,
    openPanel,
    closePanel,
    onAfterLeave,
    drag,
  }
}
