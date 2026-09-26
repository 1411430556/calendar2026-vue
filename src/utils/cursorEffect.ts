// 零依赖鼠标粒子特效：移动时沿途散落粒子、点击时向外爆裂一圈、
// 且有一圈粒子持续环绕光标。载体为全屏 fixed canvas（pointer-events: none），
// 粒子颜色取自站点中国风主题色

const PALETTE = ['#BE3A2B', '#D15444', '#B98F3E', '#CBA456', '#2F5D55', '#3A7369']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  color: string
}

// 环绕轨道粒子：绕轨道中心做圆周运动，半径按各自参数独立随机变化
interface OrbitDot {
  angle: number
  speed: number
  size: number
  color: string
  baseR: number // 该粒子自身的半径基准（在 ORBIT_RADIUS 上下随机偏移）
  rFreq: number // 半径变化频率（随机，各不相同）
  rPhase: number // 半径变化相位（随机）
  rAmp: number // 半径变化幅度（随机）
}

export function initCursorEffect(): () => void {
  // 尊重系统"减少动画"偏好，开启时完全不启用特效
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '9999',
  })
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!

  let dpr = 1
  let viewW = window.innerWidth
  let viewH = window.innerHeight
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    viewW = window.innerWidth
    viewH = window.innerHeight
    canvas.width = viewW * dpr
    canvas.height = viewH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()

  const particles: Particle[] = []
  const MAX = 300
  let raf = 0
  let lastTime = 0

  // ============ 环绕轨道粒子 ============
  const ORBIT_COUNT = 10
  const ORBIT_RADIUS = 26
  const orbit: OrbitDot[] = Array.from({ length: ORBIT_COUNT }, (_, i) => ({
    angle: (i / ORBIT_COUNT) * Math.PI * 2,
    // 相邻粒子转向相反、角速度略有差异，环绕更灵动
    speed: (1.6 + (i % 3) * 0.35) * (i % 2 === 0 ? 1 : -1),
    size: 1.8 + (i % 4) * 0.4,
    color: PALETTE[i % PALETTE.length],
    // 每个粒子的旋转半径独立随机：以 ORBIT_RADIUS 为中心 ±4px 取基准，
    // 再按 0.8~2.2 的随机频率、随机相位与 4~8px 的随机幅度平滑变化
    baseR: ORBIT_RADIUS - 4 + Math.random() * 8,
    rFreq: 0.8 + Math.random() * 1.4,
    rPhase: Math.random() * Math.PI * 2,
    rAmp: 4 + Math.random() * 4,
  }))
  let orbitX = -100
  let orbitY = -100
  let mouseX = -100
  let mouseY = -100
  let mouseSeen = false
  let orbitTime = 0

  function ensureLoop() {
    if (!raf) {
      lastTime = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }

  // 在 (x, y) 处生成 count 个粒子，初速 30 ~ spread px/s，带轻微向上偏置
  function spawn(x: number, y: number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      // 达到上限时直接丢弃（不再 shift 触发 O(n) 重排），新粒子视觉上几不可察
      if (particles.length >= MAX) break
      const angle = Math.random() * Math.PI * 2
      const speed = 30 + Math.random() * spread
      const maxLife = 0.45 + Math.random() * 0.5
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        size: 1.6 + Math.random() * 2.4,
        life: maxLife,
        maxLife,
        color: PALETTE[(Math.random() * PALETTE.length) | 0],
      })
    }
    // 无粒子时动画循环可能处于停止状态，生成后唤醒
    ensureLoop()
  }

  function tick(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 0.033)
    lastTime = now
    ctx.clearRect(0, 0, viewW, viewH)

    // 环绕轨道：中心朝光标缓动跟随，每个粒子的半径独立随机变化；鼠标出现后持续绘制
    if (mouseSeen) {
      orbitTime += dt
      orbitX += (mouseX - orbitX) * 0.2
      orbitY += (mouseY - orbitY) * 0.2
      for (const dot of orbit) {
        dot.angle += dot.speed * dt
        const r = dot.baseR + Math.sin(orbitTime * dot.rFreq + dot.rPhase) * dot.rAmp
        ctx.globalAlpha = 0.85
        ctx.fillStyle = dot.color
        ctx.beginPath()
        ctx.arc(orbitX + Math.cos(dot.angle) * r, orbitY + Math.sin(dot.angle) * r, dot.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.life -= dt
      if (p.life <= 0) {
        // swap-pop：把末尾元素移到当前位置再 pop，O(1) 移除，避免 splice 重排
        const last = particles.pop()
        if (i < particles.length && last) particles[i] = last
        continue
      }
      p.vy += 420 * dt // 重力
      p.vx *= 1 - 1.2 * dt // 空气阻力
      p.vy *= 1 - 0.6 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const t = p.life / p.maxLife
      ctx.globalAlpha = t
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // 轨道环绕需要循环永续运行，鼠标出现后不再自动停止
    raf = mouseSeen || particles.length ? requestAnimationFrame(tick) : 0
  }

  // 移动跟随：按移动距离节流（每约 14px 散落 1 个），仅响应鼠标
  let lastX = -1
  let lastY = -1
  let carry = 0
  function onMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    mouseX = e.clientX
    mouseY = e.clientY
    if (!mouseSeen) {
      // 首次移动：轨道中心直接吸附到光标，避免从屏幕外滑入
      mouseSeen = true
      orbitX = mouseX
      orbitY = mouseY
    }
    if (lastX < 0) {
      lastX = e.clientX
      lastY = e.clientY
      ensureLoop()
      return
    }
    carry += Math.hypot(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
    while (carry > 14) {
      carry -= 14
      spawn(e.clientX, e.clientY, 1, 60)
    }
  }

  function onClick(e: MouseEvent) {
    spawn(e.clientX, e.clientY, 16, 260)
  }

  // 标签页切到后台时暂停动画循环，切回时恢复（前台空闲时仍按设计持续环绕）
  let hidden = false
  function onVisibility() {
    hidden = document.hidden
    if (hidden) {
      cancelAnimationFrame(raf)
      raf = 0
    } else if (mouseSeen || particles.length) {
      ensureLoop()
    }
  }

  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('click', onClick, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('click', onClick)
    document.removeEventListener('visibilitychange', onVisibility)
    cancelAnimationFrame(raf)
    raf = 0
    canvas.remove()
  }
}
