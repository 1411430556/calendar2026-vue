# 2026 丙午马年 · 全年节假日日历

> 公历 · 农历 · 二十四节气 · 法定节假日调休，一页尽览。

一个纯静态的单页日历应用，以宣纸中国风呈现 **2026 丙午马年** 全年 365 天的公历、农历、节气、传统节日与国务院办公厅法定节假日放假调休安排。

---

## ✨ 功能特性

- **全年日历网格** — 12 个月逐月展示，每格含公历日期、农历 / 节气 / 节日，红底放假、黄底补班、青底周末。
- **法定节假日一览** — 7 大节日的放假区间、天数及调休补班说明，数据依据国办发明电〔2025〕7 号。
- **今日撕历卡** — 仿台历撕页设计，动态展示当日星期、日期、农历、节日及放假 / 补班 / 工作日印章。
- **月份导航 + 滚动联动** — 顶部 sticky 月份导航，滚动时自动高亮当前可见月份，点击平滑跳转。
- **入场动画** — 基于 `IntersectionObserver` 的滚动渐入，自动适配 `prefers-reduced-motion`。
- **年份动态推导** — 年份、干支、生肖、中文数字年均从日历数据首条派生，更换数据文件即可适配其它年份，无需改代码。

---

## 🛠 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Vue 3.5（`<script setup>` + Composition API） |
| 语言 | TypeScript（strict 模式） |
| 构建 | Vite 7 + `@vitejs/plugin-vue` |
| 类型检查 | `vue-tsc` |
| 字体 | Noto Serif SC / Noto Sans SC / 马善政（Google Fonts） |

> 零运行时依赖：无路由、无状态库、无 UI 组件库，全部样式与逻辑手写。

---

## 📂 项目结构

```
calendar2026-vue/
├── index.html              # 入口 HTML（SEO meta + Google Fonts）
├── vite.config.ts          # Vite 配置（仅挂载 vue 插件）
├── tsconfig.json           # TS 配置（strict + noUnusedLocals）
├── package.json
└── src/
    ├── main.ts             # 应用入口：createApp(App).mount('#app')
    ├── App.vue             # 唯一组件：全部逻辑 + 模板
    ├── styles.css          # 全部样式（CSS 变量主题，全局）
    ├── vite-env.d.ts
    └── data/
        └── calendar2026.ts # 全量日历数据（唯一数据源）
```

---

## 🚀 快速开始

环境要求：Node.js `>= 20`（见 `package.json` 的 `engines`）。

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

---

## 📊 数据说明

所有日历数据集中在 [`src/data/calendar2026.ts`](src/data/calendar2026.ts)，为预生成的硬编码数组，包含 365 条 `DayInfo` 记录与 7 条 `HolidayMeta` 节假日元数据。

### DayInfo 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | string | ISO 日期，如 `2026-01-01` |
| `m` / `d` | number | 公历月 / 日 |
| `wd` | number | 星期，**0=周一 … 6=周日**（Python `weekday` 约定，非 JS 约定） |
| `lunar` | string | 农历短文本（初一显示月份名，其余显示日名） |
| `full` | string | 完整农历（如 `八月初十`），撕历卡专用 |
| `fest` | string \| null | 节气 / 节日，显示优先级高于 `lunar` |
| `hol` | string \| null | 法定假日名（非空即放假） |
| `ban` | boolean | 是否调休补班日 |

> ⚠️ `wd` 为周一制（0=周一），新增或修改数据时请勿按 JS `getDay()`（周日=0）填写，否则整月错位。

### 数据来源

- 法定节假日：国务院办公厅《关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7 号）
- 农历：`lunardate` 推算并经锚点校验
- 节气：太阳黄经天文计算（东八区定日）

---

## 🎨 设计与实现要点

### 主题配色（CSS 变量）

在 [`src/styles.css`](src/styles.css) 顶部定义，全局统一：

- `--paper` 宣纸底 · `--ink` 墨色 · `--red` 中国红 · `--gold` 描金 · `--teal` 青绿

### 今日高亮逻辑

```
todayKey = 访问当天 ∈ 数据覆盖年份 且 DAY_MAP 中存在该日期 ? 该日期 : ""
撕历卡 sc = DAY_MAP.get(todayKey) ?? 春节正月初一（数据内定位）
```

非数据覆盖年份访问时，撕历卡回落展示春节样例页，避免空白。

### 干支 / 生肖 / 年份动态化

年份由数据首条推导，干支与生肖由年份数学计算：

```
YEAR     = Number(CAL[0].date.slice(0, 4))
GANZHI   = 天干[(YEAR-4) % 10] + 地支[(YEAR-4) % 12]
ZODIAC   = 生肖[(YEAR-4) % 12]
```

因此更换数据文件为其它年份时，页面年份、干支、生肖、中文数字年均会自动更新。

---

## 🔧 自定义与扩展

### 更换为其它年份

1. 替换 `src/data/calendar2026.ts`（可重命名为对应年份，同时更新 `App.vue` 中的 import 路径）。
2. 确保新数据的 `date` 字段首条为目标年份 1 月 1 日。
3. 页面年份、干支、生肖、今日高亮会自动跟随，无需修改 `App.vue`。

### 调整节假日数据

直接编辑 `calendar2026.ts` 中对应日期的 `hol` / `ban` 字段，以及 `HOLIDAYS` 数组的卡片元数据。

### 修改配色

编辑 [`src/styles.css`](src/styles.css) 顶部 `:root` 中的 CSS 变量即可全局换色。

---

## 📄 License

仅供学习与参考。节假日安排最终以国务院办公厅正式通知为准。
