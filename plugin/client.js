/**
 * Client half of dsh-close-to-quit: one row in Settings > General.
 *
 * The General section only stacks rows and passes the owner no props, so this row draws its
 * own label, value and write path. The preference is not a Host settings entry — it belongs
 * to the Electron shell — so it is read and written through this bundle's Host route.
 *
 * The row is explicit about the restart: the shell reads its settings document once per
 * process, so a flip here changes the file and the next launch obeys it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-close-to-quit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Route owned by this bundle's Host half. */
    const BASE = '/dsh-close-to-quit'
    /** Header the Host half requires; a cross-site form cannot set it. */
    const CLIENT_HEADER = 'x-dsh-close-to-quit'

    const NS = 'close-to-quit'

    const zh = {
      title: '关闭窗口按钮',
      description: '点窗口右上角的 × 时：最小化到托盘继续在后台跑，或直接退出应用。',
      quitLabel: '退出应用',
      restart: '已保存，重启 DeepSeek Harness 后生效。',
      needsRestart: '设置已保存，但当前运行的还是旧版外壳。重启 DeepSeek Harness 后这一项才会真正生效。',
      unavailable: '当前会话不是桌面端启动的，这一项只在桌面端有效。',
      readFailed: '读不到设置文件，暂时按“最小化到托盘”显示。',
      writeFailed: '保存失败，设置没有改动。',
    }
    const en = {
      title: 'Window close button',
      description: 'What the \u00d7 button does: hide to the tray and keep running, or quit the app.',
      quitLabel: 'Quit the app',
      restart: 'Saved. Restart DeepSeek Harness to apply.',
      needsRestart: 'Saved, but the running shell is still the old build. Restart DeepSeek Harness for this to take effect.',
      unavailable: 'This session was not started by the desktop app; this setting only applies there.',
      readFailed: 'Could not read the settings file; showing Hide to tray for now.',
      writeFailed: 'Could not save; the setting was not changed.',
    }

    // The row mirrors the shipped General row: same divider, spacing and type ramp.
    const ROW = {
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '24px',
      padding: '16px 0',
    }
    const TITLE = { fontSize: '14px', lineHeight: '20px' }
    const DESC = {
      color: 'var(--dsw-alias-label-secondary)',
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
    }
    const NOTE = {
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-state-success-primary)',
    }
    const ERROR = {
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-state-error-primary)',
    }
    const HINT = {
      marginTop: '4px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary)',
    }

    /**
     * A switch drawn here rather than imported: the shipped switch lives in the browser
     * primitives table, and a settings row is not worth a dependency on it.
     */
    function Switch(props) {
      const on = props.checked === true
      const disabled = props.disabled === true
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': props.label,
          disabled,
          onClick: () => {
            if (!disabled) props.onChange(!on)
          },
          style: {
            flex: 'none',
            position: 'relative',
            width: '36px',
            height: '20px',
            padding: 0,
            border: 'none',
            borderRadius: '10px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            background: on
              ? 'var(--dsw-alias-brand-primary)'
              : 'var(--dsw-alias-border-l3)',
            transition: 'background 160ms ease',
          },
        },
        h('span', {
          'aria-hidden': true,
          style: {
            position: 'absolute',
            top: '2px',
            left: on ? '18px' : '2px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: 'var(--dsw-alias-bg-layer-1)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            transition: 'left 160ms ease',
          },
        }),
      )
    }

    /** The General row: switch off = hide to tray, switch on = quit the app. */
    function CloseButtonRow(props) {
      const t = props.t
      // undefined until the first read settles, so the switch never shows a guess.
      const [action, setAction] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [readFailed, setReadFailed] = React.useState(false)
      const [writeFailed, setWriteFailed] = React.useState(false)
      // 'patched' | 'shell' | 'standalone' | undefined while the first read is in flight.
      const [desktop, setDesktop] = React.useState(undefined)

      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const response = await fetch(`${BASE}/state`, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { [CLIENT_HEADER]: '1' },
            })
            const data = await response.json()
            if (!live) return
            if (response.ok !== true || data?.ok !== true) throw new Error('state')
            setAction(data.action === 'quit' ? 'quit' : 'tray')
            setDesktop(data.desktop === 'patched' || data.desktop === 'shell' ? data.desktop : 'standalone')
            setReadFailed(data.restorable === false)
          } catch {
            if (!live) return
            setAction('tray')
            setReadFailed(true)
          }
        })()
        return () => {
          live = false
        }
      }, [])

      const flip = React.useCallback(
        async (nextQuit) => {
          const next = nextQuit ? 'quit' : 'tray'
          const previous = action
          setAction(next)
          setBusy(true)
          setNotice(null)
          setWriteFailed(false)
          try {
            const response = await fetch(`${BASE}/set`, {
              method: 'POST',
              cache: 'no-store',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                [CLIENT_HEADER]: '1',
              },
              body: JSON.stringify({ action: next }),
            })
            const data = await response.json()
            if (response.ok !== true || data?.ok !== true) throw new Error('set')
            if (data.desktop === 'patched' || data.desktop === 'shell') setDesktop(data.desktop)
            // A shell whose build predates the patch stores the value but cannot act on it yet.
            setNotice(t(data.desktop === 'shell' ? 'needsRestart' : 'restart'))
          } catch {
            setAction(previous)
            setWriteFailed(true)
          } finally {
            setBusy(false)
          }
        },
        [action, t],
      )

      const quit = action === 'quit'
      const standalone = desktop === 'standalone'
      const notes = []
      if (writeFailed) notes.push(h('div', { key: 'w', role: 'alert', style: ERROR }, t('writeFailed')))
      if (readFailed) notes.push(h('div', { key: 'r', style: ERROR }, t('readFailed')))
      if (notice !== null) notes.push(h('div', { key: 'n', role: 'status', style: NOTE }, notice))
      if (standalone) notes.push(h('div', { key: 'd', style: HINT }, t('unavailable')))

      return h(
        'div',
        { style: ROW },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: TITLE }, t('title')),
          h('div', { style: DESC }, t('description')),
          notes,
        ),
        h(Switch, {
          checked: quit,
          disabled: busy || action === undefined || standalone,
          label: t('quitLabel'),
          onChange: flip,
        }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-close-to-quit: dictionaries')
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'close-to-quit',
              order: 18,
              locale: NS,
            },
            CloseButtonRow,
          ),
        )
      },
    }
  },
})
