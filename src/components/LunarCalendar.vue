<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NDatePicker, NIcon, NSkeleton } from 'naive-ui'
import { Close, Refresh } from '@vicons/ionicons5'
import { buildSections, buildSummary, solarLabel } from '../utils/lunar'
import { useSidePanel } from '../composables/useSidePanel'
import { useLunarData, beijingWallTs } from '../composables/useLunarData'

const { selectedTs, data, loading, error, stamp, load, onPick, goNow } = useLunarData()

// 浮窗开合 / 互斥避让 / 外部点击关闭 / 滚轮锁定 / 移动端下拉手势均由公共 composable 承担；
// 日期面板被 naive-ui teleport 到 <body>（不在面板 DOM 内），点击其内部通过
// outsideIgnoreSelector 豁免，避免选日期时浮窗被外部点击误关
const { open, panelRef, openPanel, closePanel, onAfterLeave, drag } = useSidePanel({
  mutexClass: 'lunar-open',
  listSelector: '.ln-list',
  outsideIgnoreSelector: '.n-date-panel',
  onOpen: () => {
    // 每次打开回到当前时刻，手动选择的日期不跨开合保留
    selectedTs.value = beijingWallTs()
    void load(selectedTs.value)
  },
})

// ============ 内容切换后滚动区回顶 ============
// 重选日期/时刻（onPick / goNow）会以新 stamp 重播 ln-swap 过渡；
// 各时刻内容共用同一个 .ln-list 滚动容器，位置不会自动复位。
// 在旧内容离场结束（after-leave）、新内容插入前的间隙归零，
// 避免淡出中的旧内容出现可见的位置跳变
const listEl = ref<HTMLElement | null>(null)
function onSwapAfterLeave() {
  listEl.value?.scrollTo(0, 0)
}

const summary = computed(() => (data.value ? buildSummary(data.value) : null))
const sections = computed(() => (data.value ? buildSections(data.value) : []))
// 头部日期印章优先用接口返回（含星期），数据未就绪时回落展示当前所选日期
const headDate = computed(() => summary.value?.solar || solarLabel(selectedTs.value))
const headWeek = computed(() => summary.value?.week ?? '')
</script>

<template>
  <!-- 收起态：右侧竖排签（位于「历史上的今天」上方）。
       显隐由全局 html.lunar-open / html.history-open / html.hotnews-open 统一控制，保证各侧签同步 -->
  <button class="ln-tab" aria-label="查看农历黄历" @click="openPanel">农历黄历</button>

  <!-- 遮罩：仅移动端显示，点击关闭 -->
  <Transition name="ln-mask">
    <div v-if="open" class="ln-mask" aria-hidden="true" @click="closePanel"></div>
  </Transition>

  <!-- 展开态：桌面为右侧浮窗，移动端（≤600px）为底部抽屉，头部区域可下拉关闭 -->
  <Transition name="ln" @after-leave="onAfterLeave">
    <div
      v-if="open"
      :ref="panelRef"
      class="ln-panel"
      role="dialog"
      aria-label="农历黄历"
      @touchstart.passive="drag.onDragStart"
      @touchmove.passive="drag.onDragMove"
      @touchend="drag.onDragEnd"
      @touchcancel="drag.onDragEnd"
    >
      <header class="ln-head side-panel-head">
        <span class="ln-wm" aria-hidden="true">历</span>
        <div class="ln-head-info">
          <div class="ln-kicker">LUNAR CALENDAR PRO</div>
          <h3 class="ln-title">农历黄历</h3>
          <div class="ln-date">
            <span class="ln-date-seal">{{ headDate }}</span>
            {{ headWeek }}
          </div>
        </div>
        <div class="ln-actions">
          <n-button class="ln-icon-btn" quaternary circle size="small" title="回到此刻" aria-label="回到此刻并刷新" @click="goNow">
            <template #icon>
              <n-icon :size="16"><Refresh /></n-icon>
            </template>
          </n-button>
          <n-button class="ln-icon-btn" quaternary circle size="small" title="关闭" aria-label="关闭浮窗" @click="closePanel">
            <template #icon>
              <n-icon :size="17"><Close /></n-icon>
            </template>
          </n-button>
        </div>
      </header>

      <!-- 日期时间选择：精确到秒，确认后查询对应时刻的黄历 -->
      <div class="ln-picker-row">
        <n-date-picker
          class="ln-picker"
          :value="selectedTs"
          type="datetime"
          format="yyyy-MM-dd HH:mm:ss"
          :clearable="false"
          :first-day-of-week="6"
          size="small"
          @update:value="onPick"
        />
      </div>

      <div class="ln-list" ref="listEl">
        <Transition name="ln-swap" mode="out-in" @after-leave="onSwapAfterLeave">
          <!-- 骨架屏 -->
          <div v-if="loading" key="loading" class="ln-skel">
            <n-skeleton class="ln-skel-hero" :sharp="false" />
            <div v-for="i in 4" :key="i" class="ln-skel-sec">
              <n-skeleton text style="width: 26%" />
              <n-skeleton text style="width: 94%" />
              <n-skeleton text style="width: 86%" />
            </div>
          </div>

          <!-- 错误态 -->
          <div v-else-if="error" key="error" class="ln-error">
            <div class="ln-error-icon">!</div>
            <p>{{ error }}</p>
            <n-button class="retry-btn" round ghost color="#BE3A2B" @click="load(selectedTs, true)">重新加载</n-button>
          </div>

          <!-- 空态 -->
          <div v-else-if="!data" key="empty" class="ln-error">该时刻暂无黄历数据</div>

          <!-- 数据态：key 为请求时刻，切换日期后整体重播入场动画 -->
          <div v-else :key="stamp" class="ln-body">
            <!-- 主卡：农历大字 + 公历行 + 干支生肖 + 时节签 -->
            <div class="ln-hero">
              <div class="ln-hero-solar">
                {{ summary!.solar }} · {{ summary!.week
                }}<template v-if="summary!.constellation"> · {{ summary!.constellation }}</template>
              </div>
              <div class="ln-hero-lunar">{{ summary!.lunar }}</div>
              <div class="ln-hero-gz">
                {{ [summary!.lunarYear, summary!.ganZhiYear, summary!.thisYear].filter(Boolean).join(' · ') }}
              </div>
              <div v-if="summary!.chips.length" class="ln-hero-chips">
                <span v-for="c in summary!.chips" :key="c" class="ln-chip">{{ c }}</span>
              </div>
            </div>

            <!-- 分区 -->
            <section
              v-for="(sec, i) in sections"
              :key="sec.key"
              class="ln-sec"
              :style="{ '--i': Math.min(i + 1, 12) }"
            >
              <header class="ln-sec-head">
                <span class="ln-sec-seal">{{ sec.seal }}</span>
                <span class="ln-sec-title">{{ sec.title }}</span>
                <span class="ln-sec-line" aria-hidden="true"></span>
              </header>

              <!-- 四柱：年/月/日/时 × 干支/五行/纳音/十神 -->
              <div v-if="sec.kind === 'pillars'" class="ln-pillars">
                <span class="ln-pc ln-ph" aria-hidden="true"></span>
                <span v-for="h in sec.heads" :key="h" class="ln-pc ln-ph">{{ h }}</span>
                <template v-for="line in sec.lines" :key="line.label">
                  <span class="ln-pc ln-pl">{{ line.label }}</span>
                  <span v-for="(c, ci) in line.cells" :key="ci" class="ln-pc ln-pv">{{ c || '—' }}</span>
                </template>
              </div>

              <!-- 普通定义行 -->
              <div v-else class="ln-rows">
                <div
                  v-for="r in sec.rows"
                  :key="r.label"
                  class="ln-row"
                  :class="{ 'ln-row--full': r.full || !!r.tags || !!r.sub }"
                >
                  <span class="ln-rl">{{ r.label }}</span>
                  <span v-if="r.tags" class="ln-tags">
                    <span
                      v-for="t in r.tags"
                      :key="t"
                      class="ln-tag"
                      :class="r.tone === 'ji' ? 'ln-tag--ji' : 'ln-tag--yi'"
                    >
                      {{ t }}
                    </span>
                  </span>
                  <span v-else class="ln-rv">
                    {{ r.value }}
                    <span v-if="r.sub" class="ln-rsub">{{ r.sub }}</span>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </Transition>
      </div>

      <footer class="ln-foot">数据来源 · 相见拾光 API · 农历阴历黄历 Pro · 仅供参考</footer>
    </div>
  </Transition>
</template>

<style scoped>
/* ============ 收起态竖排签（位于「历史上的今天」上方） ============ */
.ln-tab {
  position: fixed;
  /* 刘海机横屏时避让右侧灵动岛/圆角；上下排列：最上方（间距 8px，步进 49px） */
  right: env(safe-area-inset-right, 0px);
  top: calc(50% - 49px);
  z-index: 70;
  transform: translateY(-50%);
  padding: 10px 14px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.875rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(165deg, var(--red) 0%, var(--red-deep) 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  /* 回归动画延迟 450ms：等面板离场动画播完后再淡入上移归位，避免突兀闪现；
     隐藏态样式由全局 styles.css 的互斥避让规则统一提供（与 .ht-tab / .hw-tab 同步） */
  transition: padding 0.3s ease, opacity 0.4s ease-out 450ms,
    transform 0.4s ease-out 450ms, visibility 0s linear 450ms;
}
@media (hover: hover) and (pointer: fine) {
  .ln-tab:hover {
    padding-right: 18px;
  }
}
/* 窄屏：缩小按钮与字号 */
@media (max-width: 600px) {
  .ln-tab {
    padding: 8px 10px;
    font-size: 0.8rem;
  }
}

/* ============ 浮窗面板 ============ */
.ln-panel {
  position: fixed;
  /* 右侧间距取视觉留白与刘海安全区两者中的较大值 */
  right: max(clamp(8px, 2vw, 24px), env(safe-area-inset-right, 0px));
  top: 50%;
  z-index: 71;
  transform: translateY(-50%);
  width: min(384px, 92vw);
  /* 高度恒定：骨架屏 / 数据 / 错误态下面板长度始终一致，避免先短后长 */
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
  /* 移动端抽屉下拉未达阈值时，靠此过渡回弹归位（入场/离场过渡由 .ln-enter/leave-active 覆盖） */
  transition: transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* 装裱式内描金细框 */
.ln-panel::after {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(185, 143, 62, 0.4);
  border-radius: 10px;
  pointer-events: none;
}
/* 离场与入场共用同一过渡：容器淡出时子内容随之同步衰减，文字与容器起止完全一致 */
.ln-enter-active,
.ln-leave-active {
  transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.ln-enter-from,
.ln-leave-to {
  opacity: 0;
  /* 不使用 scale：缩放会让面板视觉上先小后大，只做横向位移 + 透明，高度始终恒定 */
  transform: translateY(-50%) translateX(60px);
}

/* ============ 头部 ============ */
.ln-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 18px 20px 14px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border-bottom: 1px solid var(--line);
}
/* 「历」字水印 */
.ln-wm {
  position: absolute;
  right: 84px;
  top: 50%;
  transform: translateY(-46%) rotate(10deg);
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 78px;
  font-weight: 900;
  line-height: 1;
  color: rgba(190, 58, 43, 0.07);
  pointer-events: none;
  user-select: none;
}
.ln-head-info {
  min-width: 0;
}
.ln-kicker {
  font-size: 0.66rem;
  letter-spacing: 0.3em;
  color: var(--gold);
  font-weight: 600;
}
.ln-title {
  font-size: 1.22rem;
  font-weight: 900;
  color: var(--ink);
  margin-top: 2px;
}
.ln-date {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--ink-3);
}
.ln-date-seal {
  display: inline-block;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  background: var(--card);
  border: 1.5px solid var(--red);
  color: var(--red);
  font-weight: 700;
  font-size: 0.76rem;
  padding: 1px 8px;
  border-radius: 7px;
  /* transform: rotate(-3deg); */
  box-shadow: 1px 1px 0 rgba(190, 58, 43, 0.22);
  white-space: nowrap;
}
.ln-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
/* naive 主题变量以内联样式注入组件根节点，覆盖需 !important */
.ln-icon-btn.n-button {
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

/* ============ 日期时间选择行 ============ */
.ln-picker-row {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}
.ln-picker {
  flex: 1;
  min-width: 0;
}

/* ============ 内容列表 ============ */
.ln-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 18px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.ln-list::-webkit-scrollbar {
  width: 5px;
}
.ln-list::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
}

/* ---- 主卡 ---- */
.ln-hero {
  text-align: center;
  padding: 14px 12px 12px;
  background: linear-gradient(180deg, var(--paper-2) 0%, var(--card) 100%);
  border: 1px solid var(--line);
  border-radius: 12px;
  opacity: 0;
  animation: ln-in 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.ln-hero-solar {
  font-size: 0.8rem;
  color: var(--ink-3);
  letter-spacing: 0.06em;
}
.ln-hero-lunar {
  margin-top: 4px;
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 2.1rem;
  font-weight: 900;
  line-height: 1.25;
  color: var(--red);
}
.ln-hero-gz {
  margin-top: 2px;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--gold);
}
.ln-hero-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 9px;
}
.ln-chip {
  font-size: 0.72rem;
  line-height: 1.5;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--gold-tint);
  color: var(--gold);
  border: 1px solid rgba(185, 143, 62, 0.35);
}

/* ---- 分区 ---- */
.ln-sec {
  margin-top: 16px;
  padding: 0;
  opacity: 0;
  animation: ln-in 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
  animation-delay: calc(var(--i) * 45ms);
}
/* 淡入 + 轻微上移入场 */
@keyframes ln-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ln-sec-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 7px;
}
.ln-sec-seal {
  flex: none;
  width: 18px;
  height: 18px;
  line-height: 17px;
  text-align: center;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--red);
  background: var(--red-tint);
  border: 1px solid currentColor;
  border-radius: 6px;
}
.ln-sec-title {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-size: 0.95rem;
  font-weight: 900;
  color: var(--ink-2);
}
.ln-sec-line {
  flex: 1;
  height: 1px;
  background: var(--line);
}

/* ---- 定义行 ---- */
.ln-row {
  display: flex;
  gap: 10px;
  padding: 2.5px 0;
  font-size: 0.82rem;
  line-height: 1.6;
}
.ln-rl {
  flex: none;
  width: 5.5em;
  font-size: 0.78rem;
  color: var(--ink-3);
  padding-top: 1px;
}
.ln-rv {
  flex: 1;
  min-width: 0;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.ln-rsub {
  display: block;
  margin-top: 1px;
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--ink-3);
}
/* 独占整行：标签列在上，内容换行铺开 */
.ln-row--full {
  flex-direction: column;
  gap: 2px;
}
.ln-row--full .ln-rl {
  width: auto;
}

/* ---- 宜忌标签 ---- */
.ln-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ln-tag {
  font-size: 0.72rem;
  line-height: 1.5;
  padding: 1px 8px;
  border-radius: 7px;
}
.ln-tag--yi {
  background: var(--teal-tint);
  color: var(--teal);
  border: 1px solid rgba(47, 93, 85, 0.3);
}
.ln-tag--ji {
  background: var(--red-tint);
  color: var(--red);
  border: 1px solid rgba(190, 58, 43, 0.3);
}

/* ---- 四柱表格 ---- */
.ln-pillars {
  display: grid;
  grid-template-columns: 2.8em repeat(4, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.ln-pc {
  background: var(--card);
  padding: 5px 2px;
  text-align: center;
  font-size: 0.76rem;
  line-height: 1.45;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.ln-ph {
  background: var(--paper-2);
  font-size: 0.7rem;
  color: var(--ink-3);
  font-weight: 700;
}
.ln-pl {
  background: var(--paper-2);
  font-size: 0.7rem;
  color: var(--ink-3);
  font-weight: 700;
  display: grid;
  place-items: center;
}
.ln-pv {
  font-family: '阿里妈妈东方大楷 Regular', Georgia, serif;
  font-weight: 700;
}

/* ---- 状态切换过渡（骨架 ↔ 数据、日期切换） ---- */
.ln-swap-enter-active {
  transition: opacity 0.35s ease-out, transform 0.35s ease-out;
}
.ln-swap-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.ln-swap-leave-active {
  transition: opacity 0.18s ease;
}
.ln-swap-leave-to {
  opacity: 0;
}

/* ============ 骨架屏（naive-ui NSkeleton） ============ */
.ln-skel-hero {
  height: 108px;
  border-radius: 12px;
}
.ln-skel-sec {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* ============ 错误 / 空态 ============ */
.ln-error {
  text-align: center;
  padding: 42px 10px;
  color: var(--ink-3);
  font-size: 0.88rem;
}
.ln-error-icon {
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
.ln-foot {
  flex: none;
  padding: 7px 16px 10px;
  border-top: 1px solid var(--line);
  background: var(--paper-2);
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}

/* 键盘焦点可见性 */
.ln-tab:focus-visible,
.ln-icon-btn:focus-visible,
.retry-btn:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* ============ 遮罩（桌面隐藏，移动端显示） ============ */
.ln-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: none;
  background: rgba(20, 15, 8, 0.5);
}
.ln-mask-enter-active,
.ln-mask-leave-active {
  transition: opacity 0.4s ease;
}
.ln-mask-enter-from,
.ln-mask-leave-to {
  opacity: 0;
}

/* ============ 移动端（≤600px）：右侧浮窗 → 底部抽屉 ============ */
@media (max-width: 600px) {
  .ln-mask {
    display: block;
  }
  .ln-panel {
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
  .ln-enter-from,
  .ln-leave-to {
    transform: translateY(100%);
  }
  /* 顶部拖拽把手（纯视觉，触摸事件由头部区域承接） */
  .ln-panel::before {
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
  .ln-head {
    padding-top: 21px;
    touch-action: pan-y;
  }
}
</style>
