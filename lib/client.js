/**
 * skill-use — Client half。
 *
 * 结构与样式**逐项对齐官方 `@deepseek-ai/dsh-client-ui-jobs`**
 * （即用户截图里的「1 个后台任务」下拉框），因为那是同一位置的
 * 官方实现，复用它的一致性最高。
 *
 * 从官方源码抄来的四条硬性做法：
 *  1. **样式注入 document.head**，用 `<style data-plugin-css>` 去重，
 *     而不是渲染在组件树里 —— 组件内联 <style> 在 portal 场景下会漏。
 *  2. **trigger 极简**：无背景、无边框、`color: label-tertiary`，
 *     仅在 hover/focus 时变 `label-secondary`；`min-height:28px`、
 *     `font-size:12px`、`gap:3px`、`padding:3px 2px`。
 *  3. **菜单 `createPortal` 到 `document.body`**，`position:fixed`、
 *     `z-index:100`、宽度 500px、`box-shadow: var(--dsw-elevation-prominent)`。
 *     这是 header 里唯一能逃出 `backdrop-filter` 包含块的方案。
 *  4. 定位常量：`VIEWPORT_MARGIN=12`、`MENU_GAP=5`，未定位前用
 *     `visibility:hidden` 先量尺寸再摆放。
 * @module skill-use/client
 */

window.__ModuleLoader__.load({
  id: '@yizitiguan/skill-use',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    // 官方 ui-jobs 就是用 require('react-dom') 的 createPortal 把菜单挂到
    // document.body 的；这里保持同样做法，但加一层兜底：
    // 万一模块表没有 react-dom，退化为就地渲染（至少不白屏）。
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      createPortal = typeof reactDom?.createPortal === 'function' ? reactDom.createPortal : null
    } catch {
      createPortal = null
    }

    /** 渲染到 body；无 portal 时就地渲染。 */
    function renderInto(node) {
      if (createPortal) return createPortal(node, document.body)
      return node
    }

    const API = '/api/skill-use/snapshot'
    const SETTINGS_API = '/api/skill-use/settings'

    // ---- 官方同款定位常量 ----
    const VIEWPORT_MARGIN = 12
    const MENU_GAP = 5
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    // ------------------------------------------------------------------
    // 样式：类名与尺寸对齐官方 JobListAction.module.css
    // ------------------------------------------------------------------
    const CSS = `
      .skt-trigger{border-radius:var(--dsw-radius-sm,6px);min-height:28px;
        color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;
        align-items:center;gap:3px;padding:3px 2px;font-size:12px;line-height:18px;
        display:inline-flex;font-family:inherit;white-space:nowrap}
      .skt-trigger:hover,.skt-trigger:focus-visible{color:var(--dsw-alias-label-secondary)}
      .skt-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .skt-triggerChevron{transition:transform .12s}
      .skt-triggerOpen .skt-triggerChevron{transform:rotate(180deg)}
      .skt-triggerDot{flex:none}
      .skt-count{margin:0 5px}

      .skt-menu{z-index:100;box-sizing:border-box;
        --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);
        --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
        width:520px;max-width:min(580px,calc(100vw - 32px));
        max-height:min(520px,calc(100vh - 140px));
        flex-direction:column;display:flex;position:fixed;overflow:hidden;
        border-radius:var(--dsw-radius-lg,10px);
        border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
        box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.52));
        color:var(--dsw-alias-label-primary);
        font-size:13px;font-family:inherit;text-align:left;
        /* ── 玻璃配方：复刻 dsh-wallpaper-engine 的「可读性地板 + 玻璃色」──────
           它设置 surfaces 的公式（src/styles-base.js）是：
             color-mix(in srgb,
               var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
               color-mix(in srgb,
                 var(--we-surface-tint-light) calc(var(--we-glass-alpha) * 100%),
                 transparent))
           即「一个不透明地板色」打底，再按玻璃透明度叠一层玻璃色。
           地板保证文字永远可读（浅色 .45 / 深色 .59），玻璃色提供质感。
           上一版用 94% 不透明实色，会把模糊整个盖死 —— 那正是"死灰板"的成因。 */
        --skt-floor: var(--we-readability-floor, 0.59);
        --skt-alpha: var(--we-glass-alpha, 0.18);
        --skt-base: var(--we-readability-base, #17171c);
        --skt-tint: var(--we-surface-tint-dark, #ffffff);
        /* 先给一个等效的半透明实色作兜底（不支持 color-mix 的浏览器用这条），
           再用 color-mix 覆盖成与 wallpaper-engine 同源的配方。 */
        background-color: rgba(24,24,29,.72);
        background-color: color-mix(in srgb,
          var(--skt-base) calc(var(--skt-floor) * 100%),
          color-mix(in srgb,
            var(--skt-tint) calc(var(--skt-alpha) * 100%),
            transparent) calc((1 - var(--skt-floor)) * 100%));
        -webkit-backdrop-filter:blur(22px) saturate(1.7);
        backdrop-filter:blur(22px) saturate(1.7)}
      /* 浅色主题换用浅底 + 浅色地板 */
      body:not([data-ds-dark-theme]) .skt-menu{
        --skt-floor: var(--we-readability-floor, 0.45);
        --skt-base: var(--we-readability-base, #f4f4f7);
        --skt-tint: var(--we-surface-tint-light, #ffffff);
        border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12));
        box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.18))}
      /* 没有 wallpaper-engine 时（那两个 --we-* 变量不存在），
         上面已用兜底值算出等价的半透明底，无需额外规则。 */
      .skt-body{flex-direction:column;gap:1px;min-height:0;margin:0;padding:4px;
        list-style:none;display:flex;overflow:auto}

      .skt-secHead{border-top:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));
        color:var(--dsw-alias-label-tertiary);justify-content:space-between;
        align-items:center;margin:4px 4px 1px;padding:4px 0 3px;
        font-size:11px;line-height:16px;display:flex}
      .skt-secHead:first-child{border-top:0;margin-top:0}
      .skt-secToggle{border-radius:var(--dsw-radius-sm,6px);
        color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;
        align-items:center;gap:3px;padding:2px 4px;font-size:11px;line-height:16px;
        display:inline-flex;font-family:inherit}
      .skt-secToggle:hover,.skt-secToggle:focus-visible{
        background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20));color:var(--dsw-alias-label-secondary)}
      .skt-secChevron{transition:transform .12s;transform:rotate(-90deg)}
      .skt-secChevronOpen{transform:none}

      .skt-item{flex-direction:column;display:flex}
      .skt-rowLine{align-items:stretch;gap:6px;display:flex}
      .skt-row{align-items:center;gap:8px;display:flex;min-width:0;flex:1;
        padding:5px 8px;border-radius:var(--dsw-radius-sm,6px);
        background:0 0;border:0;text-align:left;color:inherit;
        font-family:inherit;font-size:13px;cursor:default}
      .skt-rowInteractive{cursor:pointer}
      .skt-rowInteractive:hover,.skt-rowInteractive:focus-visible{
        background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20))}
      .skt-main{flex-direction:column;min-width:0;flex:1;display:flex;gap:1px}
      .skt-primary{display:flex;align-items:center;gap:6px;min-width:0}
      .skt-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        min-width:0;flex:1;font-size:13px;line-height:18px;
        color:var(--dsw-alias-label-primary)}
      .skt-secondary{display:flex;align-items:center;gap:6px;min-width:0;
        font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .skt-secondary>span{white-space:nowrap}
      .skt-secondary>span+span:before{content:"·";margin-right:6px;opacity:.6}
      .skt-dot{flex:none;width:6px;height:6px;border-radius:50%;
        background:var(--dsw-alias-state-idle-primary)}
      .skt-dot.ongoing{background:var(--dsw-alias-state-success-primary)}
      .skt-dot.warning{background:var(--dsw-alias-state-warn-primary)}
      .skt-dot.error{background:var(--dsw-alias-state-error-primary)}
      .skt-dot.done{background:var(--dsw-alias-brand-primary)}

      .skt-meter{flex:none;width:56px;height:4px;border-radius:2px;overflow:hidden;
        background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20))}
      .skt-meter>i{display:block;height:100%;border-radius:2px;
        background:var(--dsw-alias-brand-primary)}
      .skt-badge{flex:none;font-size:10.5px;line-height:16px;padding:0 5px;
        border-radius:4px;white-space:nowrap;
        background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20));
        color:var(--dsw-alias-label-tertiary)}
      .skt-badge.ok{color:var(--dsw-alias-state-success-primary)}
      .skt-badge.bad{color:var(--dsw-alias-state-error-primary)}
      .skt-badge.off{text-decoration:line-through;opacity:.75}
      .skt-badge.src{font-variant-numeric:tabular-nums}

      .skt-empty{padding:14px 10px;text-align:center;font-size:12px;
        color:var(--dsw-alias-label-tertiary)}
      .skt-note{margin:2px 8px 6px;font-size:11px;line-height:16px;
        color:var(--dsw-alias-label-tertiary)}
      .skt-foot{border-top:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.10));
        padding:6px 12px;font-size:11px;line-height:16px;
        color:var(--dsw-alias-label-tertiary);display:flex;gap:10px;
        background:rgba(255,255,255,.03)}
      body:not([data-ds-dark-theme]) .skt-foot{background:rgba(0,0,0,.03)}

      /* 设置页 */
      .skt-set{max-width:720px;padding:4px 0 40px;font-size:13px;
        color:var(--dsw-alias-label-primary)}
      .skt-set h2{margin:0 0 6px;font-size:18px;font-weight:600}
      .skt-setDesc{margin:0 0 22px;font-size:12px;line-height:1.6;
        color:var(--dsw-alias-label-tertiary)}
      .skt-group{margin:0 0 22px}
      .skt-group>h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.04em;
        text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
      .skt-setRow{display:flex;align-items:flex-start;gap:16px;padding:10px 12px;
        border-radius:8px;background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20));margin-bottom:6px}
      .skt-setLabel{flex:1;min-width:0}
      .skt-setLabel>b{display:block;font-size:13px;font-weight:500;margin-bottom:2px}
      .skt-setLabel>span{display:block;font-size:11.5px;line-height:1.5;
        color:var(--dsw-alias-label-tertiary)}
      .skt-switch{position:relative;width:36px;height:20px;border-radius:10px;flex:none;
        border:0;padding:0;cursor:pointer;margin-top:2px;transition:background .18s;
        background:var(--dsw-alias-fill-l1,rgba(128,128,140,.20))}
      .skt-switch[data-on="true"]{background:var(--dsw-alias-brand-primary)}
      .skt-switch::after{content:"";position:absolute;top:2px;left:2px;
        width:16px;height:16px;border-radius:50%;background:#fff;
        transition:transform .18s}
      .skt-switch[data-on="true"]::after{transform:translateX(16px)}
      .skt-select{background:var(--dsw-alias-bg-layer-2);color:inherit;
        border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:6px;
        padding:5px 8px;font-size:12px;min-width:132px;cursor:pointer;
        font-family:inherit}
      .skt-fail{margin-left:8px;font-size:11px;
        color:var(--dsw-alias-state-error-primary)}
    `

    /**
     * 一次性把样式注入 document.head（官方同款）：
     * 用 `data-plugin-css` 去重，卸载时由调用方移除。
     */
    function installStyles() {
      const tagId = 'skill-use/Panel.css'
      if (typeof document === 'undefined' || !document.head) return () => {}
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']')
      if (existing) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'skill-use'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        try { tag.remove() } catch { /* ignore */ }
      }
    }

    // ------------------------------------------------------------------
    // 锚定定位（移植官方 useAnchoredPosition 的语义）
    // ------------------------------------------------------------------

    /**
     * 计算弹出层位置：优先下方右对齐，放不下就翻到上方，
     * 并始终保留 VIEWPORT_MARGIN 的边距。
     */
    function useAnchoredPosition({ open, anchorRef, panelRef }) {
      const [position, setPosition] = useState(null)

      const place = useCallback(() => {
        const anchor = anchorRef.current
        if (!anchor) return
        const rect = anchor.getBoundingClientRect()
        const panel = panelRef.current
        const width = panel?.offsetWidth ?? 520
        const height = panel?.offsetHeight ?? 320

        // 水平：右对齐锚点，越界回拉
        let left = rect.right - width
        if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
        if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
          left = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
        }

        // 垂直：优先下方；放不下且上方更宽裕则翻上去
        const below = rect.bottom + MENU_GAP
        const above = rect.top - MENU_GAP - height
        let top = below
        if (below + height > window.innerHeight - VIEWPORT_MARGIN) {
          top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
        }

        setPosition({ left, top })
      }, [anchorRef, panelRef])

      useEffect(() => {
        if (!open) {
          setPosition(null)
          return
        }
        // 先量再摆：首帧用 MEASURE_STYLE 隐藏，量完尺寸再定位
        const frame = window.requestAnimationFrame(place)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.cancelAnimationFrame(frame)
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [open, place])

      return position
    }

    /** 外部点击关闭（官方同款语义）。 */
    function useDismissOnOutsidePointer(rootRef, panelRef, open, close) {
      useEffect(() => {
        if (!open) return
        const onDown = (event) => {
          if (rootRef.current?.contains(event.target)) return
          if (panelRef.current?.contains(event.target)) return
          close()
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [rootRef, panelRef, open, close])
    }

    // ------------------------------------------------------------------
    // 展示用小组件
    // ------------------------------------------------------------------

    /** 官方同款状态点。 */
    function StateDot(props) {
      return h('span', { className: 'skt-dot ' + (props.state ?? '') })
    }

    /** 官方同款下拉箭头（12px，open 时旋转 180°）。 */
    function Chevron(props) {
      return h('svg', {
        width: 12,
        height: 12,
        viewBox: '0 0 12 12',
        fill: 'none',
        className: props.className,
        'aria-hidden': true,
      }, h('path', {
        d: 'M2.5 4.5 6 8l3.5-3.5',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function SectionHeader(props) {
      return h('li', { className: 'skt-secHead' }, [
        h('span', { key: 'n' }, props.title),
        props.count ? h('span', { key: 'c' }, props.count) : null,
      ])
    }

    /** 通用一行：状态点 / 名称 / 副信息 / 右侧度量。 */
    function Row(props) {
      const cells = []
      if (props.dot) cells.push(h(StateDot, { key: 'd', state: props.dot }))
      const main = [
        h('div', { key: 'p', className: 'skt-primary' }, [
          h('span', { key: 'l', className: 'skt-label', title: props.title ?? props.name }, props.name),
          props.badge ? h('span', {
            key: 'b',
            className: 'skt-badge ' + (props.badgeClass ?? ''),
          }, props.badge) : null,
        ]),
      ]
      if (props.secondary && props.secondary.length > 0) {
        main.push(h('div', { key: 's', className: 'skt-secondary' },
          props.secondary.filter(Boolean).map((text, index) =>
            h('span', { key: 'i' + index }, text))))
      }
      cells.push(h('div', { key: 'm', className: 'skt-main' }, main))
      if (props.meter !== undefined) {
        cells.push(h('span', { key: 'meter', className: 'skt-meter' },
          h('i', { style: { width: Math.max(6, Math.round(props.meter * 100)) + '%' } })))
      }
      if (props.value !== undefined) {
        cells.push(h('span', { key: 'v', className: 'skt-badge src' }, String(props.value)))
      }
      return h('div', { className: 'skt-rowLine' },
        h('div', { className: 'skt-row' }, cells))
    }

    // ------------------------------------------------------------------
    // 面板
    // ------------------------------------------------------------------

    function PanelBody(props) {
      const { state, settledExpanded, onToggleSettled } = props

      if (!state) {
        return h('ul', { className: 'skt-body' },
          h('li', { className: 'skt-empty' }, '读取中…'))
      }

      const summary = state.summary ?? {}
      const used = state.usage?.items ?? []
      const sources = state.sources?.items ?? []
      const idle = state.idle?.items ?? []
      const idleTotal = state.idle?.total ?? 0
      const disabledCount = summary.skillsDisabled ?? 0
      const maxCalls = used.length > 0 ? Math.max(...used.map((item) => item.calls), 1) : 1
      const maxSource = sources.length > 0 ? Math.max(...sources.map((item) => item.count), 1) : 1
      const rows = []

      // ── 调用统计 ──
      if (state.usage) {
        rows.push(h(SectionHeader, {
          key: 'h-usage',
          title: 'Skill 使用',
          count: (summary.skillCalls ?? 0) + ' 次 · ' + used.length + ' 个',
        }))
        if (used.length === 0) {
          rows.push(h('li', { key: 'e-usage', className: 'skt-empty' }, '本次任务尚未调用任何 skill'))
        } else {
          for (const item of used) {
            rows.push(h('li', { key: 'u-' + item.name, className: 'skt-item' },
              h(Row, {
                dot: item.failed > 0 ? 'error' : 'done',
                name: item.name,
                title: item.lastError ? item.lastError : item.name,
                badge: item.location === 'builtin' ? '内置' : (item.sourceLabel || undefined),
                badgeClass: item.location === 'builtin' ? 'src' : 'src',
                secondary: [
                  '×' + item.calls,
                  item.failed > 0 ? item.failed + ' 失败' : '成功',
                  item.avgMs > 0 ? item.avgMs + 'ms' : null,
                ].filter(Boolean),
                meter: item.calls / maxCalls,
              })))
          }
        }
      }

      // ── 来源分布 ──
      if (state.sources && sources.length > 0) {
        rows.push(h(SectionHeader, {
          key: 'h-src',
          title: '来源分布',
          count: sources.length + ' 个来源',
        }))
        for (const item of sources) {
          rows.push(h('li', { key: 's-' + item.key, className: 'skt-item' },
            h(Row, {
              dot: item.enabled === false ? 'warning' : 'ongoing',
              name: item.label,
              title: item.native ? 'DSH 会加载该来源' : '该来源仅做统计',
              badge: item.native ? 'DSH 加载' : undefined,
              badgeClass: 'ok',
              secondary: [
                item.count + ' 个',
                item.used > 0 ? '已用 ' + item.used : null,
                item.disabled > 0 ? '禁用 ' + item.disabled : null,
              ].filter(Boolean),
              meter: item.count / maxSource,
            })))
        }
      }

      // ── MCP 使用 ──
      if (state.mcp) {
        const mcpServers = state.mcp.servers ?? []
        const mcpTools = state.mcp.tools ?? []
        rows.push(h(SectionHeader, {
          key: 'h-mcp',
          title: 'MCP 使用',
          count: mcpServers.length > 0
            ? mcpServers.length + ' 个 server · ' + (summary.mcpCalls ?? 0) + ' 次'
            : (mcpTools.length > 0 ? mcpTools.length + ' 个工具' : undefined),
        }))
        if (mcpServers.length === 0 && mcpTools.length === 0) {
          rows.push(h('li', { key: 'e-mcp', className: 'skt-note' },
            '当前 profile 未配置 MCP server。配置后这里会显示调用次数、方法与成功率。'))
        }
        for (const server of mcpServers) {
          const methodText = (server.methods ?? [])
            .slice(0, 4)
            .map((method) => method.name + ' ×' + method.calls)
            .join(' · ')
          rows.push(h('li', { key: 'm-' + server.name, className: 'skt-item' },
            h(Row, {
              dot: server.failed > 0 ? 'error' : 'ongoing',
              name: server.name,
              title: methodText || server.name,
              secondary: [
                '×' + server.calls,
                server.failed > 0 ? server.failed + ' 失败' : '成功',
                methodText || null,
              ].filter(Boolean),
            })))
        }
        // 已注册但未调用的 MCP 工具（精简一行，避免淹没面板）
        if (mcpTools.length > 0) {
          const names = mcpTools.slice(0, 6).map((tool) => tool.name)
          rows.push(h('li', { key: 'mcp-tools', className: 'skt-note' },
            '已注册 ' + mcpTools.length + ' 个 MCP 工具：' + names.join('、')
            + (mcpTools.length > names.length ? ' 等' : '')))
        }
      }

      // ── 未使用（可折叠，官方「已结束 N」同款）──
      if (state.idle && idle.length > 0) {
        rows.push(h('li', {
          key: 'h-idle',
          className: 'skt-secHead',
        }, [
          h('button', {
            key: 't',
            type: 'button',
            className: 'skt-secToggle',
            'aria-expanded': settledExpanded,
            onClick: onToggleSettled,
          }, [
            h(Chevron, {
              key: 'c',
              className: 'skt-secChevron' + (settledExpanded ? ' skt-secChevronOpen' : ''),
            }),
            h('span', { key: 'l' }, '未使用的 Skill ' + idleTotal
              + (disabledCount > 0 ? ' · 禁用 ' + disabledCount : '')),
          ]),
        ]))
        if (settledExpanded) {
          const visible = idle.slice(0, 20)
          for (const item of visible) {
            rows.push(h('li', { key: 'i-' + item.source + '-' + item.name, className: 'skt-item' },
              h(Row, {
                dot: item.disabled ? 'warning' : 'idle',
                name: item.name,
                title: item.description || item.name,
                badge: item.disabled ? '禁用' : (item.sourceLabel || undefined),
                badgeClass: item.disabled ? 'off' : 'src',
              })))
          }
          if (idleTotal > visible.length) {
            rows.push(h('li', {
              key: 'more',
              className: 'skt-note',
            }, '还有 ' + (idleTotal - visible.length) + ' 个未显示'))
          }
        }
      }

      return h('ul', { className: 'skt-body' }, rows)
    }

    /**
     * 入口按钮 + portal 菜单。
     * 结构、类名、定位、关闭语义全部对齐官方 ui-jobs。
     */
    function HeaderEntry(props) {
      const sessionId = props.sessionId
      const getSessionId = props.getSessionId
      const [open, setOpen] = useState(false)
      const [state, setState] = useState(null)
      const [settledExpanded, setSettledExpanded] = useState(false)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const menuRef = useRef(null)
      const intervalRef = useRef(0)

      const close = useCallback(() => setOpen(false), [])
      const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef: menuRef })
      useDismissOnOutsidePointer(rootRef, menuRef, open, close)

      // 轮询快照
      useEffect(() => {
        let alive = true
        const tick = () => {
          if (document.visibilityState !== 'visible') return
          let sid = sessionId
          if (sid === undefined && getSessionId) {
            try { sid = getSessionId() } catch { sid = undefined }
          }
          const url = sid === undefined ? API : API + '?session=' + encodeURIComponent(sid)
          fetch(url, { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((next) => { if (alive && next) setState(next) })
            .catch(() => {})
        }
        tick()
        intervalRef.current = window.setInterval(tick, 2000)
        const onVisible = () => { if (document.visibilityState === 'visible') tick() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          window.clearInterval(intervalRef.current)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [sessionId, getSessionId])

      // Escape 关闭并把焦点还给 trigger（官方同款）
      useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          close()
          triggerRef.current?.focus()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open, close])

      const summary = state?.summary ?? {}
      const calls = summary.skillCalls ?? 0
      const discovered = summary.skillsDiscovered ?? 0
      const usedCount = summary.skillsUsed ?? 0

      const countLabel = 'Skill \u00b7 ' + usedCount + '/' + discovered

      const trigger = h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'skt-trigger' + (open ? ' skt-triggerOpen' : ''),
        'aria-expanded': open,
        'aria-label': 'Skill 使用：已发现 ' + discovered + ' 个，本次调用 ' + calls + ' 次',
        onClick: () => setOpen((value) => !value),
      }, [
        calls > 0 ? h(StateDot, { key: 'd', state: 'ongoing' }) : null,
        h('span', { key: 'c', className: 'skt-count' }, countLabel),
        h(Chevron, { key: 'v', className: 'skt-triggerChevron' }),
      ])

      const menu = open ? renderInto(
        h('div', {
          ref: menuRef,
          className: 'skt-menu',
          style: position ?? MEASURE_STYLE,
          role: 'menu',
        }, [
          h(PanelBody, {
            key: 'body',
            state,
            settledExpanded,
            onToggleSettled: () => setSettledExpanded((value) => !value),
          }),
          h('div', { key: 'foot', className: 'skt-foot' }, [
            h('span', { key: 'a' }, '发现 ' + discovered + ' 个'),
            h('span', { key: 'b' }, '已用 ' + usedCount + ' 个'),
            h('span', { key: 'c' }, '调用 ' + calls + ' 次'),
            (summary.mcpCalls ?? 0) > 0
              ? h('span', { key: 'd' }, 'MCP ' + summary.mcpCalls + ' 次')
              : null,
          ].filter(Boolean)),
        ]),
      ) : null

      return h('div', { ref: rootRef }, [trigger, menu])
    }

    function readMainSession(sessions) {
      try {
        const snapshot = sessions?.list?.getSnapshot?.()
        const byId = snapshot?.byId
        if (!byId) return undefined
        for (const row of Object.values(byId)) {
          if (row && (row.retainedBy?.mainView ?? 0) > 0) return row.id
        }
      } catch {
        return undefined
      }
      return undefined
    }

    // ------------------------------------------------------------------
    // 设置页
    // ------------------------------------------------------------------

    const SECTION_LABELS = {
      summary: '汇总',
      usage: 'Skill 使用',
      idle: '未使用的 Skill',
      sources: '来源分布',
      mcp: 'MCP 使用',
      window: '统计窗口',
    }

    const SECTION_DESCS = {
      summary: '调用次数、发现总数与来源数量。',
      usage: '每个被调用 skill 的次数、成败、耗时与来源。',
      idle: '已发现但本次任务未使用的 skill。',
      sources: '按工具来源统计 skill 数量与使用情况。',
      mcp: 'MCP server 的调用次数、方法与已注册工具。',
      window: '统计覆盖的事件数与时间跨度。',
    }

    function Switch(props) {
      return h('button', {
        className: 'skt-switch',
        'data-on': String(props.on),
        role: 'switch',
        'aria-checked': props.on ? 'true' : 'false',
        'aria-label': props.label,
        onClick: () => props.onChange(!props.on),
      })
    }

    function SettingsSection() {
      const [config, setConfig] = useState(null)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        let alive = true
        fetch(SETTINGS_API)
          .then((response) => (response.ok ? response.json() : null))
          .then((value) => { if (alive && value) setConfig(value) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      const write = useCallback((patch) => {
        setConfig((prev) => {
          const next = { ...(prev ?? {}), ...patch }
          if (patch.sections) next.sections = { ...(prev?.sections ?? {}), ...patch.sections }
          return next
        })
        fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((response) => {
            setFailed(!response.ok)
            return response.ok ? response.json() : null
          })
          .then((value) => { if (value?.config) setConfig(value.config) })
          .catch(() => setFailed(true))
      }, [])

      if (!config) {
        return h('div', { className: 'skt-set' },
          h('div', { className: 'skt-setDesc' }, '读取中…'))
      }

      const sections = config.sections ?? {}
      const order = ['summary', 'usage', 'idle', 'sources', 'mcp', 'window']

      return h('div', { className: 'skt-set' }, [
        h('h2', { key: 'h' }, 'Skill 使用'),
        h('p', { key: 'd', className: 'skt-setDesc' },
          '监控 Skill 的真实调用，并标注每个 skill 来自哪个工具。'
          + '入口在对话顶部的状态栏按钮，点击展开。',
          failed ? h('span', { key: 'f', className: 'skt-fail' }, '保存失败') : null),

        h('div', { key: 'display', className: 'skt-group' }, [
          h('h3', { key: 'h' }, '刷新'),
          h('div', { key: 'r', className: 'skt-setRow' }, [
            h('div', { key: 'l', className: 'skt-setLabel' }, [
              h('b', { key: 'b' }, '刷新间隔'),
              h('span', { key: 's' }, '面板向宿主拉取快照的间隔。'),
            ]),
            h('select', {
              key: 'c',
              className: 'skt-select',
              value: String(config.refreshMs ?? 2000),
              onChange: (event) => write({ refreshMs: Number(event.target.value) }),
            }, [
              h('option', { key: 'a', value: '1500' }, '1.5 秒'),
              h('option', { key: 'b', value: '2000' }, '2 秒'),
              h('option', { key: 'c', value: '5000' }, '5 秒'),
              h('option', { key: 'd', value: '10000' }, '10 秒'),
            ]),
          ]),
        ]),

        h('div', { key: 'sections', className: 'skt-group' }, [
          h('h3', { key: 'h' }, '显示内容'),
          ...order.map((key) => h('div', { key, className: 'skt-setRow' }, [
            h('div', { key: 'l', className: 'skt-setLabel' }, [
              h('b', { key: 'b' }, SECTION_LABELS[key]),
              h('span', { key: 's' }, SECTION_DESCS[key]),
            ]),
            h(Switch, {
              key: 'sw',
              on: sections[key] !== false,
              label: SECTION_LABELS[key],
              onChange: (on) => {
                const next = {}
                next[key] = on
                write({ sections: next })
              },
            }),
          ])),
        ]),
      ])
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const sessions = ctx.get('sessions')
        const getSessionId = () => readMainSession(sessions)

        // 样式注入 document.head（官方同款），随这次 Client run 清理
        ctx.effect(() => installStyles(), 'skill-use: styles')

        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'skill-use',
          order: 30,
        }, (props) => h(HeaderEntry, { ...props, getSessionId })))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'skill-use',
          order: 60,
          label: 'Skill 使用',
        }, SettingsSection))
      },
    }
  },
})
