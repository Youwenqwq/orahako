import { fetchStateless, headerSingle } from "@/lib/cookie"

/**
 * 森空鸟图片共享加载器（模块级单例）：
 * - 以规范化 URL 为键去重：在途请求与已加载对象 URL 全局复用。
 * - 懒加载任务限流并发（组件仅在进入视口附近后入队，天然可见优先）；
 *   交互内的大图查看器走 eager 路径，不占用列表缩略图的并发额度。
 * - 对象 URL 缓存按字节设上限，淘汰时只释放无组件引用的条目；
 *   无消费者的未发起请求直接丢弃（如切换频道后残留的旧任务）。
 * - 失败不缓存：resolve(null)，组件再次挂载时可重试。
 */

interface ImageEntry {
  url: string
  promise: Promise<string | null>
  resolve: (objectUrl: string | null) => void
  objectUrl: string | null
  bytes: number
  /** 引用计数：组件挂载 acquire、卸载 release。 */
  refs: number
  /** 已离开队列、请求已发起。 */
  started: boolean
  /** 无消费者后取消（尚未发起请求的任务直接丢弃）。 */
  cancelled: boolean
}

export type SkbirdImageEntry = ImageEntry

/** 懒加载并发上限：最多同时发起 3 个缩略图/头像请求。 */
const MAX_CONCURRENT_FETCHES = 3
/** 对象 URL 缓存字节上限，超出后按最旧优先淘汰无引用条目。 */
const MAX_CACHE_BYTES = 24 * 1024 * 1024

const entries = new Map<string, ImageEntry>()
const queue: ImageEntry[] = []
let activeFetches = 0
let cacheBytes = 0

function dropEntry(entry: ImageEntry) {
  entries.delete(entry.url)
}

function sweep() {
  for (const entry of entries.values()) {
    if (cacheBytes <= MAX_CACHE_BYTES) break
    if (entry.refs > 0) continue
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl)
      cacheBytes -= entry.bytes
      entry.objectUrl = null
      entry.bytes = 0
    }
    dropEntry(entry)
  }
}

async function runFetch(entry: ImageEntry) {
  try {
    const res = await fetchStateless({
      method: "GET",
      url: entry.url,
      redirect: "manual",
      // CapacitorHttp 的二进制响应类型是 arraybuffer，原生桥接返回 base64
      // 字符串，再由 cookie.ts 的 arrayBuffer() 统一解码。
      responseType: "arraybuffer",
    })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const type = headerSingle(res.headers, "content-type") ?? "image/jpeg"
    const blob = new Blob([await res.arrayBuffer()], { type })
    if (entry.cancelled) return
    entry.objectUrl = URL.createObjectURL(blob)
    entry.bytes = blob.size
    cacheBytes += blob.size
  } catch {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl)
      entry.objectUrl = null
      entry.bytes = 0
    }
  } finally {
    entry.resolve(entry.objectUrl)
    sweep()
  }
}

function pump() {
  while (activeFetches < MAX_CONCURRENT_FETCHES && queue.length > 0) {
    const entry = queue.shift()!
    if (entry.cancelled || entry.refs <= 0) {
      // 消费者已全部离开（如切换频道）：未发起的请求直接丢弃。
      if (!entry.objectUrl) dropEntry(entry)
      continue
    }
    entry.started = true
    activeFetches++
    void runFetch(entry).finally(() => {
      activeFetches--
      pump()
    })
  }
}

/** 获取（或创建）URL 对应的共享加载任务，并计入一次引用。 */
export function acquireSkbirdImage(url: string): SkbirdImageEntry {
  let entry = entries.get(url)
  if (!entry) {
    let resolve!: (objectUrl: string | null) => void
    const promise = new Promise<string | null>((r) => (resolve = r))
    entry = {
      url,
      promise,
      resolve,
      objectUrl: null,
      bytes: 0,
      refs: 0,
      started: false,
      cancelled: false,
    }
    entries.set(url, entry)
    queue.push(entry)
    pump()
  }
  entry.refs++
  return entry
}

/** 释放一次引用；无消费者且未发起的请求被丢弃，缓存超限时触发淘汰。 */
export function releaseSkbirdImage(entry: SkbirdImageEntry) {
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs > 0) return
  if (!entry.started) {
    entry.cancelled = true
    dropEntry(entry)
    return
  }
  sweep()
}
