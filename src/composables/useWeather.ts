import { ref } from 'vue'
import { buildApiUrl, fetchJson, toErrorMessage, unwrapData } from '../utils/api'
import { readStorageJSON, writeStorageJSON } from '../utils/storage'

// 相见拾光「根据IP获取腾讯天气」接口（https://api.shwgij.com/doc/11）：
// 不传 ip 时服务端按访客公网 IP 自动定位，固定 m=1（返回实况 / 24 小时 / 未来 8 天 /
// 生活指数 / 预警 / 日出日落等全量数据）。成功码为 201，包裹字段为小写 code/msg/data，
// 与其他接口一致，直接复用公共请求层的 unwrapData

const API_URL = 'https://api.shwgij.com/api/tianqi/tianqi'
const STORAGE_KEY = 'weather:v1'
/** 缓存新鲜期 30 分钟：天气随时间变化，过期后打开浮窗静默刷新，不闪骨架屏 */
const FRESH_MS = 30 * 60 * 1000

/** 接口原始响应包裹（code 200 / 201 均为成功，201 时 data 为天气数据体） */
interface WeatherEnvelope {
  code?: number
  msg?: string
  data?: WeatherData
}

/** 实时观测 */
export interface WeatherObserve {
  degree: string
  humidity: string
  precipitation: string
  pressure: string
  update_time: string
  weather: string
  weather_code: string
  weather_short: string
  wind_direction: string
  wind_power: string
  wind_direction_name: string
  weather_url?: string
}

/** 空气质量 */
export interface WeatherAir {
  aqi: number
  aqi_level: number
  aqi_name: string
  'pm2.5'?: string
  update_time?: string
}

/** 逐小时预报（键为相对小时偏移 "0".."23"） */
export interface WeatherHour {
  degree: string
  update_time: string
  weather: string
  weather_short: string
  wind_direction: string
  wind_power: string
  weather_url?: string
}

/** 逐日预报（未来 8 天，首日为今天） */
export interface WeatherDay {
  time: string
  day_weather: string
  day_weather_code: string
  day_weather_url?: string
  night_weather: string
  night_weather_code?: string
  night_weather_url?: string
  day_wind_direction: string
  day_wind_power: string
  min_degree: string
  max_degree: string
  aqi?: number
  aqi_name?: string
}

/** 生活指数（穿衣 / 雨伞 / 紫外线等 22 项，部分地区可能缺失） */
export interface WeatherIndexItem {
  name: string
  info: string
  detail: string
  url?: string
}

/** 气象预警 */
export interface WeatherAlarm {
  type_name: string
  level_name: string
  detail: string
  update_time: string
}

/** 日出日落（键为天偏移 "0".."14"） */
export interface WeatherRise {
  sunrise: string
  sunset: string
  time: string
}

export interface WeatherData {
  city: string
  observe: WeatherObserve
  air?: WeatherAir
  forecast_1h?: Record<string, WeatherHour>
  forecast_24h?: WeatherDay[]
  index?: Record<string, WeatherIndexItem>
  alarm?: WeatherAlarm[]
  rise?: Record<string, WeatherRise>
  limit?: { tail_number: string; time: string }
}

interface CachedWeather {
  at: number
  data: WeatherData
}

/**
 * 天气数据状态机。数据加载后缓存在内存，浮窗反复开合都秒开；
 * 缓存超 30 分钟后再次打开浮窗会后台静默刷新（不闪骨架屏）
 */
export function useWeatherData() {
  const data = ref<WeatherData | null>(null)
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref('')
  /** 静默刷新失败时的弱提示（不替换已展示的缓存内容） */
  const softError = ref('')
  let loaded = false
  let inflight: Promise<void> | null = null

  /** 打开浮窗：先上缓存，缓存过期则后台静默刷新；从未加载过才进骨架屏 */
  function ensure() {
    if (!loaded) {
      const cached = readStorageJSON<CachedWeather>(STORAGE_KEY)
      if (cached?.data) {
        data.value = cached.data
        loaded = true
        if (Date.now() - cached.at > FRESH_MS) void load({ silent: true })
        return
      }
      void load()
      return
    }
    // 已加载：数据在屏时若缓存已过期也静默刷新一次（切换网络 / 跨城 IP 变化）
    const cached = readStorageJSON<CachedWeather>(STORAGE_KEY)
    if (cached && Date.now() - cached.at > FRESH_MS) void load({ silent: true })
  }

  async function load(opts: { silent?: boolean } = {}) {
    if (inflight) return inflight
    const silent = !!opts.silent
    const task = (async () => {
      if (silent) refreshing.value = true
      else loading.value = true
      error.value = ''
      softError.value = ''
      try {
        const json = await fetchJson<WeatherEnvelope>(buildApiUrl(API_URL, { m: '1' }), 10_000)
        // 公共层已兼容成功码 200 / 201（实测该账号返回 201）
        const payload = unwrapData<WeatherData>(json)
        if (!payload?.observe) throw new Error('未获取到当前位置的天气数据')
        data.value = payload
        loaded = true
        writeStorageJSON(STORAGE_KEY, { at: Date.now(), data: payload } satisfies CachedWeather)
      } catch (e) {
        if (silent) softError.value = toErrorMessage(e)
        else error.value = toErrorMessage(e)
      } finally {
        loading.value = false
        refreshing.value = false
        inflight = null
      }
    })()
    inflight = task
    return task
  }

  return { data, loading, refreshing, error, softError, ensure, load }
}
