# Changelog

本文件记录 skill-use 的重要变更。

## [0.1.0] — 2026-10-18

首个可用版本。

### 功能

- **顶部状态栏入口**：与子智能体 / 团队看板 / 任务列表同一排，点击展开面板，
  显示 `Skill · 已用/已发现`。
- **Skill 发现**：直接扫盘 20 类来源（DSH、Agent、Claude Code、Codex、Cursor、
  Qoder、Trae、Lingma、Windsurf…），而不仅依赖 `ctx.skills.list()`
  （后者在本机只报 8 个，实际装了 45 个）。
- **Skill 使用审计**：配对 `tool/call` 与 `tool/result`，得到调用次数、
  成功/失败、平均耗时，并按盘上索引把调用归因到来源；
  盘上找不到的标记为「内置」（插件 / preset 自带）。
- **MCP 使用审计**：三层识别（内置资源工具 / `mcp__server__tool` 前缀 /
  工具注册表），按 server 归因，统计调用次数、方法明细与成败。
- **来源分布**：按工具来源统计数量与使用情况，标出 DSH 会加载的来源。
- **未使用 / 禁用**：读取 `@michengai/dsh-skills-manager` 的
  `state.json`，区分「装了没用」与「被禁用」。
- **设置页**：刷新间隔 + 逐区块开关，写入立即生效。

### UI

- 结构、类名、定位、关闭语义**逐项对齐官方 `@deepseek-ai/dsh-client-ui-jobs`**
  （对话顶部的「1 个后台任务」下拉框）。
- 菜单 `createPortal` 到 `document.body`，避开 header 祖先的
  `backdrop-filter` 包含块。
- 玻璃配方复刻 `dsh-wallpaper-engine` 的「可读性地板 + 玻璃色」两层模型，
  消费其 `--we-readability-*` / `--we-surface-tint-*` / `--we-glass-alpha`
  变量，因此跟随宿主的玻璃透明度滑杆。

### 已知限制

- MCP 统计链路已实现，但**未在真实 MCP server 上验证**（本机未配置）。
- 只统计当前会话，未做跨会话聚合。
- Skill 正文加载的 token 成本不可得（会话事件里没有该字段）。
- `webServer.register()` 的路由 disposer 不释放路由，只有重启进程能清空，
  因此 API 路径一经发布不要改名。
