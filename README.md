# skill-use — Skill 与 MCP 使用审计

[![DSH](https://img.shields.io/badge/DSH-plugin-3ecf8e)](https://github.com/topics/dsh-plugin)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![npm](https://img.shields.io/npm/v/@yizitiguan/skill-use)](https://www.npmjs.com/package/@yizitiguan/skill-use)

DSH 插件。回答三个原生 UI 回答不了的问题：

1. **我到底装了多少 skill？它们来自哪个工具？**
2. **这次任务真正调用了哪些 skill，成功还是失败？**
3. **MCP 有哪些 server / 工具，被调用了多少次？**

入口在**对话顶部状态栏**（与子智能体、团队看板、任务列表同一排），
点击展开面板。

---

## 安装

要求 DSH `>= 0.1.5-rc.1`。本插件**无构建步骤**，纯 ESM + 浏览器端纯 JS，
克隆下来即可用。

### 方式一：npm（最快）

```bash
dsh plugin --profile <你的 profile> add @yizitiguan/skill-use
```

### 方式二：从 GitHub 本地链接

克隆后用 `link:` 方式装进 profile：

```bash
git clone https://github.com/yizitiguan/skill-use.git
dsh plugin --profile <你的 profile> add link:<克隆下来的绝对路径>
```

或者在 DSH 里用插件管理器：

```
plugin_manager install_bundle <克隆下来的 skill-use 目录绝对路径>
```

### 方式三：手动写进 profile

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: skill-use
      name: '@yizitiguan/skill-use'
```

同时确保包已在 profile 的 `node_modules` 里（`pnpm add link:<目录>` 或从 npm 装）。

安装完成后**刷新页面**，顶部状态栏会出现 `Skill · 已用/已发现` 按钮。

> ⚠ 开发注意：`lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 `id`
> **必须等于 package.json 的包名**。装载器按包名分配模块 id，不一致会导致
> factory 注册不上 —— 表现为插槽 `active: true` 但界面完全不渲染。
> 插槽注册用的 `id: 'skill-use'` 是另一个东西（cell key），不受此约束。

---

## 面板内容

```
┌─ Skill 使用 ─────────────────────────────── ✕ ┐
│ SKILL 使用                      1 次 · 1 个   │
│  ● cordis-plugin-development  [内置]  ×1 成功  │
│                          ▓▓▓▓▓▓▓▓  4ms        │
├───────────────────────────────────────────────┤
│ 来源分布                      1 个来源         │
│  ● Agent  [DSH 加载]  45 个 · 已用 0  ▓▓▓▓▓▓  │
├───────────────────────────────────────────────┤
│ MCP 使用                                       │
│  当前 profile 未配置 MCP server。配置后会显示    │
│  调用次数、方法与成功率。                        │
├───────────────────────────────────────────────┤
│ ▸ 未使用的 Skill 45 · 禁用 1                   │
├───────────────────────────────────────────────┤
│ 发现 45 个  已用 1 个  调用 1 次                │
└───────────────────────────────────────────────┘
```

| 区块 | 内容 |
|---|---|
| Skill 使用 | 每个被调用 skill 的次数、成败、平均耗时、来源标签 |
| 来源分布 | 按工具来源统计数量与使用情况，标出 DSH 会加载的来源 |
| **MCP 使用** | MCP server 调用次数、方法明细、已注册 MCP 工具 |
| 未使用的 Skill | 可折叠；标出被 skills-manager 禁用的项 |
| 统计窗口 | 事件数与时间跨度 |

每个 skill 带**来源标签**：
- `[Claude Code]` / `[Agent]` / … → 磁盘上的来源目录
- `[内置]` → 磁盘上找不到，说明是插件 / preset 自带 skill

---

## MCP 是怎么识别的

DSH 里 MCP 工具**没有统一前缀**，所以分三层识别（`lib/state.js` 的 `classifyMcp`）：

1. **内置资源工具**（精确集合，来自 `@deepseek-ai/dsh-mcp-resources`）：
   `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource`
   —— 参数带 `server` 字段，可精确归因
2. **约定前缀**：`mcp__<server>__<tool>` 或 `mcp_<server>_<tool>`
3. **注册表匹配**：`ctx.tools.schemas()` 里识别出的 MCP 工具名

server 名优先取调用参数里的 `server`，否则取工具名前缀。
调用了但注册表里没有的 server 会进 `stale`，便于排查已卸载的配置。

> ⚠ **本机的实际状态是没有配置任何 MCP server**，所以面板显示
> 「当前 profile 未配置 MCP server」。这是如实反映，不是渲染失败。
> 统计链路（`auditUsage` 的 MCP 分支）已实现，配置 server 后自动生效，
> 但**这条路径未在真实 MCP server 上验证过**。

---

## 为什么要扫盘

DSH 原生 `ctx.skills.list()` 只报当前 session 可见的 skill —— 本机上只有 **8 个**。

而用户实际安装了 **45 个**，全在 `~/.agents/skills/` 里。
各家 AI 编码工具（Claude Code、Codex、Cursor、Qoder、Trae、Lingma…）
都把 skills 放在自己的配置目录下，格式统一为：

```
<tool-home>/skills/<skill-name>/SKILL.md   ← 带 YAML frontmatter
```

所以本插件**直接扫盘**，而不是依赖原生服务。

### 支持的来源（20 类）

与 [`@michengai/dsh-skills-manager`](https://github.com/MichengAI/dsh-skills-manager)
的 `EXTERNAL_SOURCE_ORDER` 对齐：

| 来源 | 路径 | DSH 加载 |
|---|---|---|
| DSH | `~/.dsh/skills` | ✅ |
| Agent | `~/.agents/skills` | ✅ |
| Codex | `~/.codex/skills` | |
| Claude Code | `~/.claude/skills` | |
| Gemini | `~/.gemini/skills` | |
| OpenCode | `~/.config/opencode/skills` | |
| Cursor | `~/.cursor/skills` | |
| Copilot | `~/.copilot/skills` | |
| Windsurf | `~/.codeium/windsurf/skills` | |
| Windsurf (user) | `~/.windsurf/skills` | |
| Trae / Trae CN | `~/.trae/skills`、`~/.trae-cn/skills` | |
| OpenClaw | `~/.openclaw/skills` | |
| ClawdBot | `~/.clawdbot/skills` | |
| Roo | `~/.roo/skills` | |
| CodeBuddy | `~/.codebuddy/skills` | |
| WorkBuddy | `~/.workbuddy/skills` | |
| Qoder / Qoder CN | `~/.qoder/skills`、`~/.qoder-cn/skills` | |
| Lingma | `~/.lingma/skills` | |

每类都支持环境变量覆盖（如 `DSH_CLAUDE_HOME`），与 skills-manager 约定一致。

---

## 数据怎么来的

### 调用统计

```
tool/call    name=skill  args={"name":"cordis-plugin-development"}
tool/result  message.toolCallId → 配对回该次调用，读 error / isError
```

- 调用次数、成功 / 失败、本轮平均耗时
- 失败时记录 `error.reason`
- 用 `tool/call` 的参数名去来源索引里查，得到**来源归因**

### 来源归因

1. 扫盘得到 `name → { source, sourceLabel }` 索引
2. 同名 skill 出现在多个来源时，优先取 `native`（DSH 实际会加载的那个）
3. 查不到 → 标记为 `builtin`（插件 / preset 内置）

---

## 主题与美化

面板只使用 `--dsw-*` 令牌上色。这是 DSH 给插件作者的规范，
也是 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)
**自动把玻璃质感传给第三方插件**的机制：

> 它自己的 `docs/COEXISTENCE.md` 写明：「按宿主规范上色的第三方插件会**继承**我们的玻璃 ——
> DSH 给插件作者的规范是用 `--dsw-alias-*` 设计令牌上色，而这些令牌在玻璃生效时
> 被改写成玻璃配方 ⇒ 任何按规范写的插件都会自动带上玻璃质感。」

所以正确做法是**只消费令牌、不自己造模糊**。用到的令牌：

```
--dsw-alias-bg-base / bg-layer-1 / bg-layer-2 / bg-layer-3 / bg-overlay
--dsw-alias-border-l1 / border-l2
--dsw-alias-label-primary / label-secondary / label-tertiary
--dsw-alias-brand-primary
--dsw-alias-state-success-primary / state-error-primary / state-idle-primary
--dsw-specific-sidebar-fill
```

### 玻璃配方：复刻 wallpaper-engine 的「可读性地板 + 玻璃色」

菜单的底色**不是自己调出来的不透明度**，而是直接搬它的公式
（`src/styles-base.js` 里所有玻璃表面都用这一条）：

```css
color-mix(in srgb,
  var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
  color-mix(in srgb,
    var(--we-surface-tint-light) calc(var(--we-glass-alpha) * 100%),
    transparent))
```

原理是**两层叠加**：

| 层 | 作用 | 取值 |
|---|---|---|
| 地板 `--we-readability-floor` | 不透明底，保证文字任何情况下可读 | 浅色 0.45 / 深色 0.59 |
| 釉色 `--we-glass-alpha` | 按透明度叠一层玻璃色，提供通透感 | 0.10 – 0.25 |

为什么必须有地板：只调 alpha 不够。深色主题下釉色是**白色**，
叠在最亮的壁纸像素上会让白字对比度掉到 1.00:1，彻底看不见。
地板权重固定、任何滑杆都压不低，所以 `有效覆盖 = 地板 + a·(1−地板) ≥ 地板`。

本插件消费这四个变量（`--we-readability-base` / `--we-readability-floor` /
`--we-surface-tint-light|dark` / `--we-glass-alpha`），**存在就用宿主的值**，
不存在就用同公式的兜底值。所以在设置里拉动「玻璃透明度」时，
这个菜单会跟着一起变，而不是各调各的。

### 四个必须避开的坑

**1. 弹层必须 `createPortal` 到 `document.body`。**
官方 `@deepseek-ai/dsh-client-ui-jobs`（就是「1 个后台任务」那个下拉框）
就是这么做的。header 的祖先链上有 `backdrop-filter`，它会让
`position: fixed` 后代**以它为包含块** —— 弹层被压在 header 尺寸里，
宽度撑不开、内容竖排换行。

**2. 菜单自己加 `backdrop-filter` 是安全的。**
坑 1 说的是**祖先**加模糊会劫持后代的包含块；菜单本身是最外层
`fixed` 元素、没有后代要定位，自己加 blur 不产生这个问题。

**3. 底色不能用 `--dsw-alias-bg-base` 或 `bg-layer-1`。**
- `bg-base` 在壁纸开启时被设成 `transparent`（它要让壁纸透出来）
- `bg-layer-1` 在玻璃配方下是半透明 `color-mix`

它们单独或叠加都挡不住底层文字 —— 这就是「完全透明、字叠字」的成因。

**4. 数值要跟宿主同源，不要自己拍。**
曾经的 `rgba(30,30,36,.94)` 是 94% 不透明，把模糊整个盖死，
观感是**一块死灰板**。仿官方视觉必须仿**配方**，不是仿一个看着像的颜色。

### 令牌名必须真实存在

早期版本用了 `--dsw-alias-bg-elevated`、`--dsw-alias-text-primary` 这类
**不存在的名字**，`var()` 全部落到兜底值 ⇒ 面板不跟随主题。
真实清单见 [`TOKEN-CONTRACT.md`](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/TOKEN-CONTRACT.md)
（自动生成、有守卫对账）。注意 `Theme.listTokens` 只暴露 14 个常用令牌，
而实际契约里共有 **59 个**。

---

## 设置

**设置 → Skill 使用**：

| 项 | 说明 |
|---|---|
| 刷新间隔 | 1.5 / 2 / 5 / 10 秒 |
| 汇总 / Skill 使用 / 未使用 / 来源分布 / 统计窗口 | 逐区块开关，立即生效 |

也可以改 profile 的 `cordis.patch.yml`：

```yaml
- id: skill-use
  config:
    refreshMs: 2000
    sections:
      usage: true
      idle: true
      sources: true
```

---

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/skill-use/snapshot?session=<id>` | 审计快照 |
| GET | `/api/skill-use/settings` | 读配置 |
| POST | `/api/skill-use/settings` | 写配置（局部合并） |

---

## 已验证（真实数据）

```json
{
  "skillCalls": 1,
  "skillsUsed": 1,
  "skillsDiscovered": 45,
  "skillsVisible": 8,
  "sourcesWithSkills": 1,
  "builtinUsed": 1,
  "skillsDisabled": 1,
  "managerInstalled": true
}
```

来源分布：`Agent`（`~/.agents/skills`）45 个、`native: true`、禁用 1 个。

使用明细：`cordis-plugin-development` ×1、成功、**内置**。
（DSH 原生服务只看到 8 个，这个不在其中——印证了扫盘的必要性。）

被禁用项：`ask-matt` —— 来自读取 skills-manager 的 `state.json`，
不是猜的。

---

## 与 skills-manager 的分工

读了 [`@michengai/dsh-skills-manager`](https://github.com/MichengAI/dsh-skills-manager)
的源码，它负责**管理**（安装 / 启用 / 禁用 / 分类），状态存在
`~/.dsh/skills-manager/state.json`。

本插件负责**观察**：只读那份 state，把 `disabledSkills` 反映到面板上，
**不修改它**。两者可以同时装，职责不重叠。

它的策略优先级（本插件按同样规则判定）：

```
enabledSkills 名单  >  disabledSkills 名单  >  sources 来源开关
```

---

## 踩过的坑

### 1. webserver 路由不可注销

- `exact` 路由以 **path** 为唯一键，**不区分 method** →
  GET/POST 必须同一个 handler 内派发，否则 `duplicate exact route`
- `register()` 返回的 disposer **不摘除路由**，禁用 / 卸载后旧 handler 仍在，
  **只有重启进程能清空**

因此路径一经发布不要改名。本插件用 `/api/skill-use/*`，与旧的
`/api/task-monitor/*` 完全隔离。

### 2. `home()` 漏参数

`qoder-cn` 那行曾写成 `home('DSH_QODER_CN_HOME')` 少了 fallback，
`join(undefined, 'skills')` 直接抛 `ERR_INVALID_ARG_TYPE`。
已修。

### 3. 内置 skill 不在 list() 里

见上文。这也是为什么必须扫盘 + 用 `builtin` 标记。

### 4. 弹层别自己加 backdrop-filter

见上文主题一节。会让 `position: fixed` 的弹层整块错位。

---

## 目录结构

```
skill-use/
├── package.json
├── cordis.patch.yml
├── icon.svg
├── locale/{zh,en}.json
└── lib/
    ├── index.js      Host 入口：注册 /api/skill-use/*
    ├── state.js      扫盘发现 + 事件审计
    └── client.js     顶部状态栏入口 + 面板 + 设置页
```

---

## 未完成

- 没有做 skill 的启用 / 禁用（那属于 skills-manager 的职责，本插件只观察）。
- 跨会话审计（当前只统计当前会话）。
- Skill 正文加载的 token 成本（会话事件里没有该字段）。
