/**
 * skill-use — Host half.
 *
 * 注册 skill 审计接口。扫描本机全部 skill 来源目录，统计当前会话里
 * `skill` 工具的真实调用，并把每次调用归因到它来自哪个工具。
 *
 * ⚠ webserver 的两个约束（实测，改代码前必读）：
 *  1. `exact` 路由以 **path** 为唯一键，不区分 method —— 同一路径只能
 *     注册一次，GET/POST 必须在 handler 内部派发。
 *  2. `webServer.register()` 返回的 disposer **不会**把路由从表里摘除；
 *     插件禁用/卸载后旧 handler 仍在，重复注册同路径会报
 *     `duplicate exact route`，且只有重启进程才能清空。
 * 因此已发布的路径名不要再改。
 * @module skill-use
 */
import { buildState } from './state.js'

/** 浏览器可见的 API 前缀。 */
export const SKILL_USE_API = '/api/skill-use'

/** 接口路径表。已发布路径不要重命名（见文件头约束 2）。 */
export const SKILL_USE_ROUTES = {
  snapshot: `${SKILL_USE_API}/snapshot`,
  settings: `${SKILL_USE_API}/settings`,
}

/** 配置默认值；与 cordis.patch.yml 对齐。 */
export const defaultConfig = {
  mode: 'floating',
  refreshMs: 1500,
  sections: {
    /** 顶部汇总：调用数 / 已发现 / 来源数 */
    summary: true,
    /** 已使用的 skill 明细（含来源） */
    usage: true,
    /** 已发现但未使用的 skill */
    idle: true,
    /** 按来源分组统计 */
    sources: true,
    /** MCP server / 工具的使用与注册情况 */
    mcp: true,
    /** 统计窗口 */
    window: true,
  },
}

/** 允许的展示形态。 */
const MODES = ['floating', 'pinned', 'pill']

/**
 * 一个按 HTTP method 分派的 JSON 路由。
 * method 必须在 handler 内部派发 —— 见文件头约束 1。
 */
function jsonRoute(path, handlers) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      const method = req.method ?? 'GET'
      const run = handlers[method]
      if (!run) {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      Promise.resolve()
        .then(() => run(req))
        .then(
          (value) => sendJson(res, 200, value),
          (error) => sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
    },
  }
}

/** 有上限的 JSON body 读取；空 body 视为 {}。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** 统一的 JSON 响应。 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * 插件入口。
 * @param ctx - Host 上下文
 * @param config - 行配置
 */
export function apply(ctx, config) {
  // 只取本版本认识的分区键，避免上一版残留的旧键流进来
  const pickSections = (source) => {
    const out = { ...defaultConfig.sections }
    if (!source || typeof source !== 'object') return out
    for (const [key, value] of Object.entries(source)) {
      if (key in defaultConfig.sections && typeof value === 'boolean') out[key] = value
    }
    return out
  }

  const base = {
    mode: config?.mode ?? defaultConfig.mode,
    refreshMs: config?.refreshMs ?? defaultConfig.refreshMs,
    sections: pickSections(config?.sections),
  }

  // 运行时覆盖层：设置页写入的值优先于 patch 配置，立即生效且不重载插件。
  const overrides = { sections: {} }
  const current = () => ({
    mode: overrides.mode ?? base.mode,
    refreshMs: overrides.refreshMs ?? base.refreshMs,
    sections: { ...base.sections, ...pickSections(overrides.sections) },
  })

  const webServer = ctx.get('webServer')
  if (!webServer) {
    ctx.logger?.('skill-use: webServer 不可用，插件不注册路由')
    return
  }

  ctx.effect(() => {
    const disposers = []

    // 审计快照
    disposers.push(webServer.register(jsonRoute(SKILL_USE_ROUTES.snapshot, {
      GET: async (req) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.searchParams.get('session') ?? undefined
        return buildState(ctx, sessionId, current())
      },
    })))

    // 设置：GET 读、POST 写
    disposers.push(webServer.register(jsonRoute(SKILL_USE_ROUTES.settings, {
      GET: async () => current(),
      POST: async (req) => {
        const body = await readBody(req)
        const record = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
        if (typeof record.mode === 'string' && MODES.includes(record.mode)) {
          overrides.mode = record.mode
        }
        if (typeof record.refreshMs === 'number' && record.refreshMs >= 200 && record.refreshMs <= 60000) {
          overrides.refreshMs = record.refreshMs
        }
        if (record.sections && typeof record.sections === 'object' && !Array.isArray(record.sections)) {
          const next = { ...overrides.sections }
          for (const [key, value] of Object.entries(record.sections)) {
            if (key in defaultConfig.sections && typeof value === 'boolean') next[key] = value
          }
          overrides.sections = next
        }
        return { ok: true, config: current() }
      },
    })))

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 卸载时忽略；见文件头约束 2，路由本身不会被摘除
        }
      }
    }
  }, 'skill-use: routes')
}

/** 所有 Host 服务按 optional 读取（`ctx.get(name)`），因此无硬依赖。 */
export const inject = []
