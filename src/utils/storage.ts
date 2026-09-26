// localStorage 的安全 JSON 读写封装。
// 解析失败（脏数据）时自动剔除对应键；写入失败（隐私模式 / 配额超限）静默忽略，
// 由调用方决定是否回退到内存缓存，避免存储异常打断页面逻辑。

/** 读取并反序列化 JSON；键不存在或解析失败时返回 null（失败会顺手清除脏键） */
export function readStorageJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    removeStorage(key)
    return null
  }
}

/** 序列化写入；任何异常（配额超限、隐私模式等）均静默吞掉 */
export function writeStorageJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 忽略：内存缓存仍然生效
  }
}

/** 删除键；异常静默（如浏览器禁用存储） */
export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 忽略
  }
}
