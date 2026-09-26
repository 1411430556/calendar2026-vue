// naive-ui 主题令牌覆盖：与 styles.css 的 :root 设计令牌对齐。
// 独立成模块避免页面组件被大段纯配置占据；naive-ui 组件字号是独立 px 体系，
// 不随 html 的 rem 基准缩放，需在此按 112.5% 基准显式设置。

export const themeOverrides = {
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
    fontFamily: `'阿里妈妈东方大楷 Regular', system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`,
    // 默认 14/12/15/16，按 112.5% 同步提升
    fontSize: '16px',
    fontSizeMedium: '16px',
    fontSizeSmall: '16px',
    fontSizeTiny: '13.5px',
    fontSizeLarge: '17px',
    fontSizeHuge: '18px',
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
