import { describe, it, expect } from 'vitest'
import { pad2, firstOf, formatHot, changeMeta, yearLabel } from './format'

describe('pad2 数字补零', () => {
  it('一位数补零，两位数不变', () => {
    expect(pad2(1)).toBe('01')
    expect(pad2(9)).toBe('09')
    expect(pad2(12)).toBe('12')
  })
})

describe('firstOf 多态字段取首值', () => {
  it('字符串原样返回', () => {
    expect(firstOf('abc')).toBe('abc')
  })
  it('数组取第一个', () => {
    expect(firstOf(['a', 'b'])).toBe('a')
  })
  it('空数组 / null / undefined / 空串归一为空字符串', () => {
    expect(firstOf([])).toBe('')
    expect(firstOf(null)).toBe('')
    expect(firstOf(undefined)).toBe('')
    expect(firstOf('')).toBe('')
  })
})

describe('formatHot 热度缩写', () => {
  it('空值与非数字返回空字符串', () => {
    expect(formatHot('')).toBe('')
    expect(formatHot('abc')).toBe('')
  })
  it('不足一万原样显示', () => {
    expect(formatHot('999')).toBe('999')
    expect(formatHot('9999')).toBe('9999')
  })
  it('万级保留一位小数并去掉 .0', () => {
    expect(formatHot('10000')).toBe('1万')
    expect(formatHot('20000')).toBe('2万')
    expect(formatHot('4960920')).toBe('496.1万')
  })
  it('亿级保留一位小数并去掉 .0', () => {
    expect(formatHot('100000000')).toBe('1亿')
    expect(formatHot('125000000')).toBe('1.3亿')
  })
})

describe('changeMeta 排名升降容错映射', () => {
  it('up / rise 映射为上升', () => {
    expect(changeMeta('up')).toEqual({ text: '↑', cls: 'hw-change--up' })
    expect(changeMeta('RISE')).toEqual({ text: '↑', cls: 'hw-change--up' })
  })
  it('down / fall 映射为下降', () => {
    expect(changeMeta('down')).toEqual({ text: '↓', cls: 'hw-change--down' })
  })
  it('new 映射为新上榜', () => {
    expect(changeMeta('new')).toEqual({ text: '新', cls: 'hw-change--new' })
  })
  it('未知 / 空值不展示标记', () => {
    expect(changeMeta('same')).toEqual({ text: '', cls: '' })
    expect(changeMeta('')).toEqual({ text: '', cls: '' })
  })
})

describe('yearLabel 年份展示', () => {
  it('公元年份加"年"后缀', () => {
    expect(yearLabel('2026')).toBe('2026年')
  })
  it('负数年份展示为公元前', () => {
    expect(yearLabel('-221')).toBe('公元前221年')
  })
  it('非数字内容原样返回', () => {
    expect(yearLabel('远古')).toBe('远古')
  })
})
