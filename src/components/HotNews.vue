<script setup lang="ts">
import { ref, watch } from 'vue'
import { NIcon, NSkeleton, NTabPane, NTabs } from 'naive-ui'
import { Close, Refresh } from '@vicons/ionicons5'
import { useSidePanel } from '../composables/useSidePanel'
import { useHotNewsData, type HotItem } from '../composables/useHotNews'
import { changeMeta, firstOf, formatHot } from '../utils/format'

// ============ 浮窗开合（互斥避让 / 外部点击关闭 / 滚轮锁定 / 移动端背景锁） ============
// startSession / stopSession 在下方声明：仅作为回调传入，浮窗开合时才执行
const { open, panelRef, openPanel, closePanel, onAfterLeave } = useSidePanel({
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
  prefetchRest,
  startAuto,
  stopAuto,
  onVisibility,
} = useHotNewsData(open)

function startSession() {
  void loadTab(activeTab.value)
  // 后台预取其余全部榜单，预取完成后切换任何标签都是即时渲染
  void prefetchRest(activeTab.value)
  document.addEventListener('visibilitychange', onVisibility)
  startAuto()
}
function stopSession() {
  document.removeEventListener('visibilitychange', onVisibility)
  stopAuto()
}

// ============ 切换榜单时列表回到顶部 ============
// 各榜单共用同一个 .hw-list 滚动容器，切榜只替换内部列表，滚动位置不会自动复位。
// 在旧榜单离场动画结束（@after-leave）、新内容尚未插入的间隙归零，
// 避免淡出中的旧内容出现可见的位置跳变。仅标签切换置位，手动刷新保持原有滚动位置
const listEl = ref<HTMLElement | null>(null)
let pendingScrollReset = false
watch(activeTab, () => {
  pendingScrollReset = true
})
function onSwapAfterLeave() {
  if (!pendingScrollReset) return
  pendingScrollReset = false
  listEl.value?.scrollTo(0, 0)
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
          <button
            class="hw-icon-btn"
            :class="{ 'is-spin': refreshing }"
            title="刷新榜单"
            aria-label="刷新榜单"
            @click="loadTab(activeTab, { force: true })"
          >
            <n-icon :size="16"><Refresh /></n-icon>
          </button>
          <button class="hw-icon-btn" title="关闭" aria-label="关闭浮窗" @click="closePanel">
            <n-icon :size="17"><Close /></n-icon>
          </button>
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

      <div class="hw-list" ref="listEl">
        <Transition name="hw-swap" mode="out-in" @after-leave="onSwapAfterLeave">
          <!-- 骨架屏：n-skeleton 实现；行数超满 + 容器溢出隐藏，保证铺满整个列表区 -->
          <div v-if="loading" :key="`loading-${activeTab}`" class="hw-skeletons">
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
          <div v-else-if="error && items.length === 0" :key="`error-${activeTab}`" class="hw-error">
            <div class="hw-error-icon">!</div>
            <p>{{ error }}</p>
            <button class="hw-retry" @click="loadTab(activeTab, { force: true })">重新加载</button>
          </div>

          <!-- 空态 -->
          <div v-else-if="items.length === 0" key="empty" class="hw-error">当前榜单暂无数据</div>

          <!-- 榜单列表：key 含榜单名，切换时重播入场动画；静默刷新不换 key、无动画打扰 -->
          <ol v-else :key="`list-${activeTab}`" class="hw-items" :aria-label="`百度${currentLabel}榜`">
            <li
              v-for="(it, i) in items"
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
  right: env(safe-area-inset-right, 0px);
  top: 75%;
  z-index: 70;
  transform: translateY(-50%);
  padding: 18px 11px;
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
  writing-mode: vertical-rl;
  letter-spacing: 0.42em;
  font-size: 0.875rem;
  font-weight: 700;
}
@media (hover: hover) and (pointer: fine) {
  .hw-tab:hover {
    padding-right: 18px;
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
.hw-icon-btn {
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .hw-icon-btn:hover {
    background: var(--red-tint);
    color: var(--red);
  }
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
  overscroll-behavior: contain;
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
.hw-retry {
  margin-top: 12px;
  padding: 6px 18px;
  border: 1px solid var(--red);
  border-radius: 999px;
  background: transparent;
  color: var(--red);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}
@media (hover: hover) and (pointer: fine) {
  .hw-retry:hover {
    background: var(--red);
    color: #fff;
  }
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
.hw-retry:focus-visible,
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
