/**
 * skill-use — Host half：skill 与 MCP 的发现与使用审计。
 *
 * 三件事：
 *  1. **skill 发现**：DSH 原生 `ctx.skills.list()` 只报当前 session 可见的
 *     skill，用户实际安装的远不止这些（分布在 ~/.agents、~/.claude、
 *     ~/.qoder 等各家 AI 工具的 skills 目录里）。这里直接扫盘全部找出来，
 *     并标注每个 skill 来自哪个工具。
 *  2. **skill 审计**：从会话事件里统计 `skill` 工具的真实调用，配对
 *     tool/result 得到成败与耗时，并把调用归因到来源。
 *  3. **MCP 审计**：识别 MCP 工具调用（资源工具 + 命名约定 + 注册表），
 *     按 server 归因，统计调用次数、方法明细与成败。
 *
 * 只读：不写 session 事件、不改 system prompt、不修改任何 skill / MCP 配置。
 * @module skill-use/state
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 区块可用性三态。 */
export const OK = 'ok'
export const EMPTY = 'empty'
export const UNAVAILABLE = 'unavailable'

/**
 * 已知的 MCP 资源工具名（来自 `@deepseek-ai/dsh-mcp-resources`）。
 * 这三个由 MCP 服务统一注册，参数里带 `server`，可精确归因到某个 server。
 */
const MCP_RESOURCE_TOOLS = new Set([
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
])

/**
 * 判断一个工具名是否来自 MCP。
 * DSH 里 MCP 工具没有统一前缀，因此分三层识别：
 *   1. 内置 MCP 资源工具（精确集合）
 *   2. 约定式前缀 `mcp__<server>__<tool>` / `mcp_<server>_<tool>`
 *   3. 注册表里已知的 MCP 工具名（由调用方传入）
 * @param {string} name
 * @param {Set<string>|undefined} knownMcp
 */
export function classifyMcp(name, knownMcp) {
  if (MCP_RESOURCE_TOOLS.has(name)) {
    return { isMcp: true, server: undefined, resource: true }
  }
  const doubleUnderscore = /^mcp__(.+?)__(.+)$/.exec(name)
  if (doubleUnderscore) {
    return { isMcp: true, server: doubleUnderscore[1], tool: doubleUnderscore[2] }
  }
  const singleUnderscore = /^mcp_([a-z0-9-]+)_(.+)$/i.exec(name)
  if (singleUnderscore) {
    return { isMcp: true, server: singleUnderscore[1], tool: singleUnderscore[2] }
  }
  if (knownMcp && knownMcp.has(name)) return { isMcp: true, server: undefined, tool: name }
  return { isMcp: false }
}

/** 解析 home 下的路径，支持环境变量覆盖。 */
function home(envKey, fallback) {
  const override = process.env[envKey]
  if (typeof override === 'string' && override !== '') return override
  return join(homedir(), fallback)
}

/**
 * skill 来源目录表。
 *
 * 与 @michengai/dsh-skills-manager 的 EXTERNAL_SOURCE_ORDER 对齐：
 * 各家 AI 编码工具都把 skills 放在自己的配置目录下，格式统一为
 * `<dir>/skills/<skill-name>/SKILL.md`（带 YAML frontmatter）。
 *
 * `env` 允许用户覆盖根目录，与 skills-manager 的环境变量约定一致。
 * `native` 表示 DSH 自己会加载的来源（其余只做展示与审计）。
 */
export const SKILL_SOURCES = [
  // DSH 自身
  { key: 'dsh', label: 'DSH', native: true, path: () => join(home('DSH_HOME', '.dsh'), 'skills') },
  { key: 'agents', label: 'Agent', native: true, path: () => join(home('AGENTS_HOME', '.agents'), 'skills') },

  // 其它 AI 编码工具
  { key: 'codex', label: 'Codex', path: () => join(home('DSH_CODEX_HOME', '.codex'), 'skills') },
  { key: 'claude', label: 'Claude Code', path: () => join(home('DSH_CLAUDE_HOME', '.claude'), 'skills') },
  { key: 'gemini', label: 'Gemini', path: () => join(home('DSH_GEMINI_HOME', '.gemini'), 'skills') },
  { key: 'opencode', label: 'OpenCode', path: () => join(home('DSH_OPENCODE_HOME', '.config/opencode'), 'skills') },
  { key: 'cursor', label: 'Cursor', path: () => join(home('DSH_CURSOR_HOME', '.cursor'), 'skills') },
  { key: 'copilot', label: 'Copilot', path: () => join(home('DSH_COPILOT_HOME', '.copilot'), 'skills') },
  { key: 'windsurf', label: 'Windsurf', path: () => join(home('DSH_WINDSURF_HOME', '.codeium/windsurf'), 'skills') },
  { key: 'windsurf-user', label: 'Windsurf (user)', path: () => join(home('DSH_WINDSURF_USER_HOME', '.windsurf'), 'skills') },
  { key: 'trae', label: 'Trae', path: () => join(home('DSH_TRAE_HOME', '.trae'), 'skills') },
  { key: 'trae-cn', label: 'Trae CN', path: () => join(home('DSH_TRAE_CN_HOME', '.trae-cn'), 'skills') },
  { key: 'openclaw', label: 'OpenClaw', path: () => join(home('DSH_OPENCLAW_HOME', '.openclaw'), 'skills') },
  { key: 'clawdbot', label: 'ClawdBot', path: () => join(home('DSH_CLAWDBOT_HOME', '.clawdbot'), 'skills') },
  { key: 'roo', label: 'Roo', path: () => join(home('DSH_ROO_HOME', '.roo'), 'skills') },
  { key: 'codebuddy', label: 'CodeBuddy', path: () => join(home('DSH_CODEBUDDY_HOME', '.codebuddy'), 'skills') },
  { key: 'workbuddy', label: 'WorkBuddy', path: () => join(home('DSH_WORKBUDDY_HOME', '.workbuddy'), 'skills') },
  { key: 'qoder', label: 'Qoder', path: () => join(home('DSH_QODER_HOME', '.qoder'), 'skills') },
  { key: 'qoder-cn', label: 'Qoder CN', path: () => join(home('DSH_QODER_CN_HOME', '.qoder-cn'), 'skills') },
  { key: 'lingma', label: 'Lingma', path: () => join(home('DSH_LINGMA_HOME', '.lingma'), 'skills') },
]

/** 单个目录最多扫多少个条目，防止异常目录拖垮渲染。 */
const MAX_ENTRIES = 500

/** 解析 SKILL.md 的 YAML frontmatter（只取需要的几个字段）。 */
function parseFrontmatter(text) {
  const out = { name: '', description: '', license: '', version: '' }
  if (!text.startsWith('---')) return out
  const end = text.indexOf('\n---', 3)
  if (end < 0) return out
  const block = text.slice(3, end)
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key === 'name' && out.name === '') out.name = value
    else if (key === 'description' && out.description === '') out.description = value
    else if (key === 'license' && out.license === '') out.license = value
    else if (key === 'version' && out.version === '') out.version = value
  }
  return out
}

/** 安全 stat。 */
async function statOrNull(path) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/** 安全 readdir。 */
async function readdirOrNull(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return null
  }
}

/** 只读文件开头若干字节：frontmatter 一定在开头。 */
async function readHead(path, limit = 8 * 1024) {
  try {
    const raw = await readFile(path, 'utf8')
    return raw.slice(0, limit)
  } catch {
    return ''
  }
}

/**
 * 扫描一个来源目录。
 * 兼容两种布局：
 *   - `<root>/<name>/SKILL.md`   目录型（主流）
 *   - `<root>/<name>.md`          单文件型
 * @returns skill 数组；目录不存在返回空数组
 */
async function scanSourceDir(root, source) {
  const info = await statOrNull(root)
  if (!info || !info.isDirectory()) return []
  const entries = await readdirOrNull(root)
  if (!entries) return []

  const found = []
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)

    if (entry.isDirectory()) {
      const docPath = join(full, 'SKILL.md')
      const docStat = await statOrNull(docPath)
      if (!docStat || !docStat.isFile()) continue
      const meta = parseFrontmatter(await readHead(docPath))
      found.push({
        name: meta.name || entry.name,
        dirName: entry.name,
        description: meta.description,
        license: meta.license,
        version: meta.version,
        source: source.key,
        sourceLabel: source.label,
        native: source.native === true,
        path: full,
        kind: 'directory',
      })
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'skill.md') {
      const meta = parseFrontmatter(await readHead(full))
      const fallbackName = entry.name.slice(0, -3)
      found.push({
        name: meta.name || fallbackName,
        dirName: fallbackName,
        description: meta.description,
        license: meta.license,
        version: meta.version,
        source: source.key,
        sourceLabel: source.label,
        native: source.native === true,
        path: full,
        kind: 'file',
      })
    }
  }
  return found
}

/**
 * 扫描全部来源。
 * 同名 skill 在多个来源出现时全部保留（用 source 区分），
 * 同时标记 duplicated，便于发现"同一个 skill 装了多份"。
 */
export async function discoverSkills() {
  const all = []
  const bySource = []

  for (const source of SKILL_SOURCES) {
    const found = await scanSourceDir(source.path(), source)
    if (found.length > 0) {
      all.push(...found)
      bySource.push({
        key: source.key,
        label: source.label,
        count: found.length,
        native: source.native === true,
      })
    }
  }

  // 同名检测
  const nameCount = new Map()
  for (const skill of all) nameCount.set(skill.name, (nameCount.get(skill.name) ?? 0) + 1)
  for (const skill of all) {
    if ((nameCount.get(skill.name) ?? 1) > 1) skill.duplicated = true
  }

  return { skills: all, bySource }
}

/** 安全 JSON.parse。 */
function parseArgs(raw) {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * 读取 @michengai/dsh-skills-manager 的启用/禁用策略。
 *
 * 它在 `<DSH_HOME>/skills-manager/state.json` 维护：
 *   { sources: { <key>: boolean }, disabledSkills: { <key>: string[] },
 *     enabledSkills: { <key>: string[] } }
 *
 * 本插件只**读取**这份策略用于展示，不修改它（管理职责属于 skills-manager）。
 * 文件不存在时返回 undefined，表示未安装该插件。
 */
async function readManagerPolicy() {
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const statePath = join(dshHome, 'skills-manager', 'state.json')
  const info = await statOrNull(statePath)
  if (!info || !info.isFile()) return undefined
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      sources: parsed?.sources && typeof parsed.sources === 'object' ? parsed.sources : {},
      disabledSkills: parsed?.disabledSkills && typeof parsed.disabledSkills === 'object'
        ? parsed.disabledSkills
        : {},
      enabledSkills: parsed?.enabledSkills && typeof parsed.enabledSkills === 'object'
        ? parsed.enabledSkills
        : {},
    }
  } catch {
    return undefined
  }
}

/**
 * 判定一个 skill 在 skills-manager 策略下的生效状态。
 * 与 skills-manager 的 effectiveSkillPolicy 保持同样的优先级：
 *   enabled 名单 > disabled 名单 > 来源开关
 * @returns true 启用 / false 禁用 / undefined 未表态（视为启用）
 */
function managerOverride(policy, sourceKey, name) {
  if (!policy) return undefined
  const enabled = policy.enabledSkills[sourceKey]
  if (Array.isArray(enabled) && enabled.includes(name)) return true
  const disabled = policy.disabledSkills[sourceKey]
  if (Array.isArray(disabled) && disabled.includes(name)) return false
  if (policy.sources[sourceKey] === false) return false
  return undefined
}

/** 毫秒转人类可读。 */
function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h' + (m % 60) + 'm'
}

/**
 * 从会话事件里统计 skill 与 MCP 的使用。
 * `tool/call` 记发起，`tool/result` 用 `message.toolCallId` 配对结局。
 *
 * @param {Array} events - 会话事件
 * @param {Set<string>} [knownMcp] - 注册表识别出的 MCP 工具名
 */
export function auditUsage(events, knownMcp) {
  const skillUsage = new Map() // name -> 记录
  const mcpServers = new Map() // server -> { calls, ok, failed, methods:Map, lastAt }
  const mcpTools = new Map() // tool name -> { calls, ok, failed, server, lastAt }
  const pending = new Map() // callId -> { kind, name, server, startedAt }
  const toolUsage = new Map() // 所有工具的使用次数（含 skill / MCP）

  let firstAt = 0
  let lastAt = 0

  for (const event of events) {
    if (firstAt === 0) firstAt = event.time
    lastAt = event.time

    if (event.type === 'tool/call') {
      const callId = event.data?.callId ?? ''
      const name = event.data?.name ?? ''
      if (name === '') continue
      toolUsage.set(name, (toolUsage.get(name) ?? 0) + 1)

      // ── skill ──
      if (name === 'skill') {
        const args = parseArgs(event.data?.arguments)
        const skillName = typeof args?.name === 'string' && args.name !== '' ? args.name : '(unknown)'
        const record = skillUsage.get(skillName) ?? {
          name: skillName, calls: 0, ok: 0, failed: 0, lastAt: 0, lastError: '', totalMs: 0,
        }
        record.calls += 1
        record.lastAt = event.time
        skillUsage.set(skillName, record)
        pending.set(callId, { kind: 'skill', name: skillName, startedAt: event.time })
        continue
      }

      // ── MCP ──
      const mcp = classifyMcp(name, knownMcp)
      if (mcp.isMcp) {
        const args = parseArgs(event.data?.arguments)
        const server = (typeof args?.server === 'string' && args.server !== '')
          ? args.server
          : (mcp.server ?? '(未标注)')
        const method = mcp.resource ? name : (mcp.tool ?? name)

        const serverRecord = mcpServers.get(server) ?? {
          name: server, calls: 0, ok: 0, failed: 0, lastAt: 0, methods: new Map(),
        }
        serverRecord.calls += 1
        serverRecord.lastAt = event.time
        serverRecord.methods.set(method, (serverRecord.methods.get(method) ?? 0) + 1)
        mcpServers.set(server, serverRecord)

        const toolRecord = mcpTools.get(name) ?? {
          name, server, calls: 0, ok: 0, failed: 0, lastAt: 0,
        }
        toolRecord.calls += 1
        toolRecord.lastAt = event.time
        mcpTools.set(name, toolRecord)

        pending.set(callId, { kind: 'mcp', name, server, startedAt: event.time })
      }
      continue
    }

    if (event.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId ?? ''
      const info = pending.get(callId)
      if (!info) continue
      pending.delete(callId)
      const failed = Boolean(event.data?.error) || event.data?.message?.isError === true

      if (info.kind === 'skill') {
        const record = skillUsage.get(info.name)
        if (!record) continue
        if (failed) {
          record.failed += 1
          record.lastError = event.data?.error?.reason ?? event.data?.error?.name ?? 'failed'
        } else {
          record.ok += 1
        }
        record.totalMs += event.time - info.startedAt
        continue
      }

      if (info.kind === 'mcp') {
        const serverRecord = mcpServers.get(info.server)
        if (serverRecord) {
          if (failed) serverRecord.failed += 1
          else serverRecord.ok += 1
        }
        const toolRecord = mcpTools.get(info.name)
        if (toolRecord) {
          if (failed) toolRecord.failed += 1
          else toolRecord.ok += 1
        }
      }
    }
  }

  return {
    firstAt,
    lastAt,
    skills: [...skillUsage.values()]
      .map((record) => ({
        ...record,
        avgMs: record.calls > 0 ? Math.round(record.totalMs / record.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls || b.lastAt - a.lastAt),
    mcpServers: [...mcpServers.values()]
      .map((server) => ({
        ...server,
        methods: [...server.methods.entries()]
          .map(([name, calls]) => ({ name, calls }))
          .sort((a, b) => b.calls - a.calls),
      }))
      .sort((a, b) => b.calls - a.calls || b.lastAt - a.lastAt),
    mcpTools: [...mcpTools.values()].sort((a, b) => b.calls - a.calls),
    toolUsage,
  }
}

/**
 * 构建快照。
 * @param ctx - Host 上下文
 * @param sessionId - 当前会话
 * @param config - 插件配置
 */
export async function buildState(ctx, sessionId, config) {
  const sessions = ctx.get('sessions')
  const session = sessionId ? sessions?.get?.(sessionId) : undefined
  const events = session ? session.snapshotEvents() : []

  const { skills, bySource } = await discoverSkills()

  // ---- MCP：从工具注册表识别（回答"有哪些 MCP 工具已注册"）----
  const mcpRegistered = []
  const tools = ctx.get('tools')
  if (tools) {
    try {
      const schemas = tools.schemas?.() ?? []
      for (const schema of schemas) {
        const mcp = classifyMcp(schema.name, undefined)
        if (mcp.isMcp) {
          mcpRegistered.push({
            name: schema.name,
            server: mcp.server ?? undefined,
            resource: mcp.resource === true,
            description: (schema.description ?? '').slice(0, 200),
          })
        }
      }
    } catch {
      // 工具注册表不可用时忽略
    }
  }
  const knownMcp = new Set(mcpRegistered.map((tool) => tool.name))

  const audit = auditUsage(events, knownMcp)

  // ---- DSH 当前会话可见的 skill（原生服务视角）----
  // 注意：list() 只报文件系统 provider 的，插件内置 skill 不在其中。
  const visible = new Set()
  const skillService = ctx.get('skills')
  if (skillService) {
    try {
      const list = await skillService.list({ cwd: session?.header?.cwd })
      for (const entry of list ?? []) visible.add(entry.name)
    } catch {
      // 服务不可用时忽略
    }
  }

  // ---- name -> 来源 索引：优先 native 来源 ----
  const byName = new Map()
  for (const skill of skills) {
    const current = byName.get(skill.name)
    if (!current) {
      byName.set(skill.name, skill)
    } else if (skill.native && !current.native) {
      byName.set(skill.name, skill)
    }
  }

  // ---- 使用记录补来源 ----
  const used = audit.skills.map((record) => {
    const hit = byName.get(record.name)
    return {
      ...record,
      source: hit?.source ?? '',
      sourceLabel: hit?.sourceLabel ?? '',
      // 盘上找不到 = 插件内置 / preset 内置 skill
      location: hit ? 'disk' : 'builtin',
      visibleInDsh: visible.has(record.name),
    }
  })

  const usedNames = new Set(used.map((record) => record.name))
  const policy = await readManagerPolicy()

  // 每个 skill 的生效状态：被 skills-manager 禁用的要单独标出来，
  // 否则"未使用"会误导（它根本没被启用，而不是装了却没用）。
  const withPolicy = (skill) => {
    const override = managerOverride(policy, skill.source, skill.dirName ?? skill.name)
    return {
      ...skill,
      disabled: override === false,
    }
  }

  const idle = skills
    .filter((skill) => !usedNames.has(skill.name))
    .map((skill) => {
      const enriched = withPolicy(skill)
      return {
        name: skill.name,
        description: skill.description,
        source: skill.source,
        sourceLabel: skill.sourceLabel,
        native: skill.native,
        duplicated: skill.duplicated === true,
        disabled: enriched.disabled,
      }
    })

  // ---- 按来源汇总 ----
  const sourceStats = bySource.map((source) => {
    const usedHere = used.filter((record) => record.source === source.key).length
    const disabledHere = skills.filter(
      (skill) => skill.source === source.key && managerOverride(policy, skill.source, skill.dirName ?? skill.name) === false,
    ).length
    const sourceEnabled = policy ? policy.sources[source.key] !== false : true
    return {
      ...source,
      used: usedHere,
      idle: Math.max(0, source.count - usedHere),
      disabled: disabledHere,
      enabled: sourceEnabled,
    }
  })

  const state = {
    at: Date.now(),
    sessionId: sessionId ?? null,
    status: session ? OK : UNAVAILABLE,
    summary: {
      skillCalls: used.reduce((sum, record) => sum + record.calls, 0),
      skillsUsed: used.length,
      skillsDiscovered: skills.length,
      skillsVisible: visible.size,
      sourcesWithSkills: bySource.length,
      builtinUsed: used.filter((record) => record.location === 'builtin').length,
      skillsDisabled: idle.filter((skill) => skill.disabled).length,
      managerInstalled: policy !== undefined,
      // MCP
      mcpCalls: audit.mcpServers.reduce((sum, server) => sum + server.calls, 0),
      mcpServersUsed: audit.mcpServers.length,
      mcpToolsRegistered: mcpRegistered.length,
    },
    usage: { state: used.length > 0 ? OK : EMPTY, items: used },
    idle: {
      state: idle.length > 0 ? OK : EMPTY,
      items: idle.slice(0, 150),
      total: idle.length,
    },
    sources: { state: sourceStats.length > 0 ? OK : EMPTY, items: sourceStats },
    // MCP：被调用过就有内容；未配置则是 empty（如实反映，不是错误）
    mcp: {
      state: (audit.mcpServers.length > 0 || mcpRegistered.length > 0) ? OK : EMPTY,
      servers: audit.mcpServers,
      tools: mcpRegistered,
      // 用了但注册表里没有的 server（例如已卸载），单独标出便于排查
      stale: audit.mcpServers
        .filter((server) => !mcpRegistered.some((tool) => tool.server === server.name))
        .map((server) => server.name),
    },
    window: {
      events: events.length,
      from: audit.firstAt,
      to: audit.lastAt,
      duration: duration(audit.lastAt - audit.firstAt),
    },
  }

  // 按配置裁剪
  const enabled = config?.sections ?? {}
  if (enabled.usage === false) delete state.usage
  if (enabled.idle === false) delete state.idle
  if (enabled.sources === false) delete state.sources
  if (enabled.mcp === false) delete state.mcp
  if (enabled.window === false) delete state.window
  state.mode = config?.mode ?? 'floating'
  return state
}
