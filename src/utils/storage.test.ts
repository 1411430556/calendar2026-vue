import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readStorageJSON, writeStorageJSON, removeStorage } from './storage'

// 内存版 localStorage 桩（node 测试环境无真实 localStorage）
class MemStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string) {
    if (this.throwOnSet) throw new Error('QuotaExceededError')
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
  throwOnSet = false
}

let mem: MemStorage
beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
})

describe('writeStorageJSON / readStorageJSON 往返', () => {
  it('对象可序列化后原样读回', () => {
    writeStorageJSON('k', { a: 1, b: ['x', 'y'] })
    expect(readStorageJSON<{ a: number }>('k')).toEqual({ a: 1, b: ['x', 'y'] })
  })

  it('键不存在时返回 null', () => {
    expect(readStorageJSON('missing')).toBeNull()
  })

  it('脏 JSON 返回 null 并顺手清除该键', () => {
    mem.setItem('dirty', '{不是合法json')
    expect(readStorageJSON('dirty')).toBeNull()
    expect(mem.getItem('dirty')).toBeNull()
  })

  it('setItem 抛错（配额 / 隐私模式）时不向上抛出', () => {
    mem.throwOnSet = true
    expect(() => writeStorageJSON('k', { a: 1 })).not.toThrow()
  })
})

describe('removeStorage', () => {
  it('删除已存在的键', () => {
    writeStorageJSON('k', 1)
    removeStorage('k')
    expect(readStorageJSON('k')).toBeNull()
  })

  it('删除不存在的键不报错', () => {
    expect(() => removeStorage('nope')).not.toThrow()
  })
})
