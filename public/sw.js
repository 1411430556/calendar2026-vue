/* 2026 日历 Service Worker：纯静态 GitHub Pages 托管的离线缓存 */
const CACHE = 'calendar2026-v1'

// 预缓存应用外壳（相对路径基于 sw.js 所在目录解析，兼容子路径部署）
const PRECACHE = ['./', './index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 跨域请求（数据 API 等）不拦截，永远走网络
  if (url.origin !== self.location.origin) return

  // 页面导航：network-first，离线时回退缓存中的应用外壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    )
    return
  }

  // 同源静态资源（js/css/图片/字体分片）：cache-first，未命中时拉取并入库
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy))
          }
          return res
        })
    )
  )
})
