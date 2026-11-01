/**
 * Browser half: the guard earns a Settings tab of its own under Plugins.
 *
 * The page has three jobs, and all three exist because the host half's decisions
 * are otherwise invisible:
 *  - show and edit the judge chain (add a provider, reorder, disable);
 *  - show every decision the guard made, with the probabilities behind it;
 *  - let one string be judged on demand, so a new provider can be verified
 *    without waiting for a turn to end badly.
 *
 * @module dsh-early-stop-guard/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-early-stop-guard',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this page. */
    const NS = 'earlyStopGuard'
    /** Profile entry id; also the config-forms namespace. */
    const DOMAIN = 'early-stop-guard'
    /** Browser-relative base of the host route surface. */
    const ROUTE = 'api/early-stop-guard'

    const zh = {
      tab: '早停守卫',
      title: '早停守卫',
      intro: '回合因「只叙述下一步、没有调用工具」而结束时，这里决定是否把同一个回合继续推进一步。',
      master: '总开关',
      masterHint: '关闭后不判定、不注入、不写日志。',
      policy: '策略',
      maxContinuations: '每回合最多续跑次数',
      mode: '判定模型模式',
      modeAuto: 'auto：叙述型才问模型',
      modeAlways: 'always：叙述与灰区都问',
      modeOff: 'off：只用启发式规则',
      thresholds: '概率阈值',
      narrate: '叙述阈值（达到则继续）',
      ask: '提问阈值（达到则结束）',
      wait: '等待阈值（达到则结束）',
      steer: '注入给模型的话',
      chain: '裁判供应商链（自上而下，先成功者生效）',
      chainHint: '决策模型返回三题概率；LLM 供应商回退到会话模型或固定路由。',
      addProvider: '新增供应商',
      addOpenai: '新增 OpenAI 兼容决策模型',
      addLlm: '新增 LLM 托底',
      remove: '删除',
      up: '上移',
      down: '下移',
      enabled: '启用',
      kind: '类型',
      protocol: '协议',
      baseUrl: 'Base URL',
      model: '模型',
      apiKeyEnv: 'API Key 环境变量',
      llmProvider: 'LLM provider',
      llmModel: 'LLM model',
      keyPresent: '环境变量已设置',
      keyMissing: '环境变量未设置',
      key: 'API Key',
      keyHint: '密钥存在 ~/.dsh/early-stop-guard/secrets.json，不经过设置页，也不会回显。',
      keyPlaceholder: '粘贴密钥后点保存',
      saveKey: '保存密钥',
      clearKey: '清除密钥',
      keySaved: '已保存（本地文件）',
      keyFromEnv: '来自环境变量',
      keyNone: '未设置密钥',
      keySavedOk: '已保存',
      keyClearedOk: '已清除',
      logs: '判定记录',
      logsHint: '每一行是一次回合收尾时的判定。续跑为 continue，其余为结束。',
      refresh: '刷新',
      clear: '清空',
      empty: '暂无记录',
      time: '时间',
      act: '判定',
      reason: '原因',
      turn: '回合',
      latency: '耗时',
      text: '尾部正文',
      test: '试判一条',
      testPlaceholder: '粘贴一段「叙述了下一步」的正文，看这里怎么判。',
      runTest: '试判',
      testing: '判定中…',
      result: '结果',
      noForm: '设置表单尚未就绪',
      readOnly: '当前不可写',
      saveHint: '改动即时保存。',
      error: '请求失败',
      verdict: '概率',
    }

    const en = {
      tab: 'Early stop',
      title: 'Early-stop guard',
      intro: 'When a turn ends because the model narrated its next step without calling a tool, this decides whether to keep it open.',
      master: 'Master switch',
      masterHint: 'When off, nothing is judged, injected, or logged.',
      policy: 'Policy',
      maxContinuations: 'Continuations per turn',
      mode: 'Judge mode',
      modeAuto: 'auto: ask the chain on narration only',
      modeAlways: 'always: ask on narration and gray band',
      modeOff: 'off: heuristics only',
      thresholds: 'Probability thresholds',
      narrate: 'narration (continue above)',
      ask: 'question (stop above)',
      wait: 'waiting (stop above)',
      steer: 'Steer message',
      chain: 'Judge chain (top to bottom, first answer wins)',
      chainHint: 'Decision models answer three probabilities; LLM providers fall back to the session route.',
      addProvider: 'Add provider',
      addOpenai: 'Add OpenAI-compatible decision model',
      addLlm: 'Add LLM fallback',
      remove: 'Remove',
      up: 'Up',
      down: 'Down',
      enabled: 'Enabled',
      kind: 'Kind',
      protocol: 'Protocol',
      baseUrl: 'Base URL',
      model: 'Model',
      apiKeyEnv: 'API key env var',
      llmProvider: 'LLM provider',
      llmModel: 'LLM model',
      keyPresent: 'env var is set',
      keyMissing: 'env var is missing',
      key: 'API key',
      keyHint: 'Keys live in ~/.dsh/early-stop-guard/secrets.json, never in settings, and are never echoed.',
      keyPlaceholder: 'Paste a key, then save',
      saveKey: 'Save key',
      clearKey: 'Clear key',
      keySaved: 'saved locally',
      keyFromEnv: 'from the environment',
      keyNone: 'no key yet',
      keySavedOk: 'saved',
      keyClearedOk: 'cleared',
      logs: 'Decisions',
      logsHint: 'One row per turn-stopping evaluation. `continue` re-opened the turn.',
      refresh: 'Refresh',
      clear: 'Clear',
      empty: 'No records yet',
      time: 'Time',
      act: 'Act',
      reason: 'Reason',
      turn: 'Turn',
      latency: 'Latency',
      text: 'Trailing text',
      test: 'Judge one string',
      testPlaceholder: 'Paste a "next I will…" message and see what the chain decides.',
      runTest: 'Judge',
      testing: 'Judging…',
      result: 'Result',
      noForm: 'Settings form is not ready',
      readOnly: 'read-only',
      saveHint: 'Changes save immediately.',
      error: 'Request failed',
      verdict: 'probabilities',
    }

    /** Inject the page stylesheet once, keyed by plugin id. */
    function installStyles() {
      const existing = document.querySelector('style[data-plugin-css="dsh-early-stop-guard"]')
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-early-stop-guard'
      style.textContent = `
.esg-root { display: flex; flex-direction: column; gap: 18px; font-size: 13px; }
.esg-section { border: 1px solid rgba(128,128,128,0.22); border-radius: 10px; padding: 14px 16px; }
.esg-section > h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.esg-hint { margin: 0 0 12px; opacity: 0.62; font-size: 12px; line-height: 1.5; }
.esg-row { display: flex; align-items: center; gap: 10px; }
.esg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px 14px; }
.esg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.esg-field > span { font-size: 12px; opacity: 0.7; }
.esg-field input, .esg-field select, .esg-field textarea {
  font: inherit; color: inherit; padding: 5px 8px; border-radius: 6px;
  border: 1px solid rgba(128,128,128,0.32); background: transparent; min-width: 0;
}
.esg-field input[type=checkbox] { width: auto; }
.esg-field textarea { min-height: 62px; resize: vertical; }
.esg-chain { display: flex; flex-direction: column; gap: 10px; }
.esg-card { border: 1px solid rgba(128,128,128,0.18); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.esg-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.esg-card-head strong { font-weight: 600; }
.esg-tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.32); opacity: 0.8; }
.esg-tag.ok { border-color: #4c9a52; }
.esg-tag.warn { border-color: #b98a2a; }
.esg-btn { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.36); background: transparent; color: inherit; cursor: pointer; }
.esg-btn:hover { border-color: rgba(128,128,128,0.6); }
.esg-btn[disabled] { opacity: 0.45; cursor: default; }
.esg-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.esg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.esg-table th, .esg-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(128,128,128,0.14); vertical-align: top; }
.esg-table th { font-weight: 600; opacity: 0.7; white-space: nowrap; }
.esg-table td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.esg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.esg-err { color: #c2433d; font-size: 12px; }
.esg-pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
`
      document.head.appendChild(style)
      return () => {
        style.remove()
      }
    }

    /** Fetch JSON from the host route surface, surfacing HTTP failures. */
    async function requestJson(path, init) {
      const response = await fetch(`${ROUTE}/${path}`, {
        credentials: 'include',
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${detail.slice(0, 160)}`)
      }
      return response.json()
    }

    /** Subscribe to one config form's snapshot. */
    function useFormSnapshot(form) {
      const [snapshot, setSnapshot] = React.useState(() => {
        try {
          return form?.getSnapshot?.() ?? { status: 'loading' }
        } catch (error) {
          return { status: 'unavailable', error: String(error) }
        }
      })
      React.useEffect(() => {
        if (!form?.subscribe) return undefined
        const sync = () => {
          try {
            setSnapshot(form.getSnapshot())
          } catch {
            setSnapshot({ status: 'unavailable' })
          }
        }
        sync()
        return form.subscribe(sync)
      }, [form])
      return snapshot
    }

    /** One labelled field wrapper. */
    function Field(props) {
      return h('label', { className: 'esg-field' },
        h('span', null, props.label),
        props.children)
    }

    /** A number input that commits on change. */
    function NumberInput(props) {
      return h('input', {
        type: 'number',
        value: props.value ?? 0,
        min: props.min,
        max: props.max,
        step: props.step ?? 1,
        disabled: props.disabled,
        onChange: event => props.onChange(Number(event.target.value)),
      })
    }

    /** The provider chain editor. */
    /**
     * Save or clear one provider's API key.
     *
     * The key never enters the settings form: it is posted straight to the host
     * and written to a 0600 file, so an array edit cannot drop it.
     */
    function KeyEditor(props) {
      const { provider, status, t } = props
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)

      const call = async (path, body) => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await requestJson(path, { method: 'POST', body: JSON.stringify(body) })
          setNotice(result?.hasApiKey ? t('keySavedOk') : t('keyClearedOk'))
          setDraft('')
          props.onChange?.(provider.id, Boolean(result?.hasApiKey))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const source = status?.apiKeySource
      const badge = source === 'settings' ? t('keySaved') : source === 'env' ? t('keyFromEnv') : t('keyNone')

      return h('div', { className: 'esg-key' },
        h(Field, { label: t('key') },
          h('div', { style: { display: 'flex', gap: '6px' } },
            h('input', {
              type: 'password',
              value: draft,
              placeholder: t('keyPlaceholder'),
              autoComplete: 'off',
              onChange: event => setDraft(event.target.value),
            }),
            h('button', {
              className: 'esg-btn',
              disabled: busy || !draft.trim(),
              onClick: () => call('secret', { id: provider.id, apiKey: draft }),
            }, t('saveKey')),
            h('button', {
              className: 'esg-btn',
              disabled: busy || source !== 'settings',
              onClick: () => call('secret/clear', { id: provider.id }),
            }, t('clearKey')))),
        h('p', { className: 'esg-hint' },
          h('span', { className: `esg-tag ${source ? 'ok' : ''}` }, badge),
          status?.apiKeyEnv ? ` · ${status.apiKeyEnv}` : '',
          ' · ',
          t('keyHint')),
        error ? h('p', { className: 'esg-err' }, `${t('error')}: ${error}`) : null,
        notice ? h('p', { className: 'esg-hint' }, notice) : null)
    }

    function ChainEditor(props) {
      const { providers, writable, onChange, t } = props
      const list = Array.isArray(providers) ? providers : []
      const commit = next => onChange(next)
      const patch = (index, changes) => {
        const next = list.map((entry, position) => (position === index ? { ...entry, ...changes } : entry))
        commit(next)
      }
      const move = (index, delta) => {
        const target = index + delta
        if (target < 0 || target >= list.length) return
        const next = list.slice()
        const [entry] = next.splice(index, 1)
        next.splice(target, 0, entry)
        commit(next)
      }
      const remove = index => commit(list.filter((_entry, position) => position !== index))
      const blank = {
        id: `provider-${list.length + 1}`,
        label: '',
        kind: 'decision',
        protocol: 'systemone',
        baseUrl: '',
        model: '',
        apiKeyEnv: '',
        llmProvider: '',
        llmModel: '',
        timeoutMs: 6000,
        enabled: true,
      }
      return h('div', { className: 'esg-section' },
        h('h3', null, t('chain')),
        h('p', { className: 'esg-hint' }, t('chainHint')),
        h('div', { className: 'esg-chain' },
          list.length === 0
            ? h('p', { className: 'esg-hint' }, t('empty'))
            : list.map((provider, index) => h('div', { className: 'esg-card', key: `${provider.id || index}-${index}` },
              h('div', { className: 'esg-card-head' },
                h('strong', null, provider.label || provider.id || `#${index + 1}`),
                h('span', { className: 'esg-tag' }, provider.kind === 'llm' ? 'llm' : provider.protocol),
                provider.apiKeyEnv
                  ? h('span', { className: 'esg-tag' }, `${provider.apiKeyEnv}`)
                  : null,
                h('span', { className: 'esg-actions', style: { marginLeft: 'auto' } },
                  h('button', {
                    className: 'esg-btn', disabled: !writable || index === 0,
                    onClick: () => move(index, -1), title: t('up'),
                  }, '↑'),
                  h('button', {
                    className: 'esg-btn', disabled: !writable || index === list.length - 1,
                    onClick: () => move(index, 1), title: t('down'),
                  }, '↓'),
                  h('button', {
                    className: 'esg-btn', disabled: !writable,
                    onClick: () => remove(index), title: t('remove'),
                  }, '✕'))),
              h('div', { className: 'esg-grid' },
                h(Field, { label: t('enabled') },
                  h('input', {
                    type: 'checkbox', checked: provider.enabled !== false, disabled: !writable,
                    onChange: event => patch(index, { enabled: event.target.checked }),
                  })),
                h(Field, { label: 'id' },
                  h('input', {
                    value: provider.id ?? '', disabled: !writable,
                    onChange: event => patch(index, { id: event.target.value }),
                  })),
                h(Field, { label: t('kind') },
                  h('select', {
                    value: provider.kind ?? 'decision', disabled: !writable,
                    onChange: event => patch(index, { kind: event.target.value }),
                  },
                  h('option', { value: 'decision' }, 'decision'),
                  h('option', { value: 'llm' }, 'llm'))),
                provider.kind === 'llm'
                  ? h(Field, { label: t('llmProvider') },
                    h('input', {
                      value: provider.llmProvider ?? '', disabled: !writable,
                      placeholder: '(session route)',
                      onChange: event => patch(index, { llmProvider: event.target.value }),
                    }))
                  : h(Field, { label: t('protocol') },
                    h('select', {
                      value: provider.protocol ?? 'systemone', disabled: !writable,
                      onChange: event => patch(index, { protocol: event.target.value }),
                    },
                    h('option', { value: 'systemone' }, 'systemone'),
                    h('option', { value: 'openai' }, 'openai'))),
                provider.kind === 'llm'
                  ? h(Field, { label: t('llmModel') },
                    h('input', {
                      value: provider.llmModel ?? '', disabled: !writable,
                      placeholder: '(session route)',
                      onChange: event => patch(index, { llmModel: event.target.value }),
                    }))
                  : h(Field, { label: t('model') },
                    h('input', {
                      value: provider.model ?? '', disabled: !writable,
                      onChange: event => patch(index, { model: event.target.value }),
                    })),
                provider.kind === 'llm'
                  ? null
                  : h(Field, { label: t('baseUrl') },
                    h('input', {
                      value: provider.baseUrl ?? '', disabled: !writable,
                      placeholder: 'https://api.example.com/v1',
                      onChange: event => patch(index, { baseUrl: event.target.value }),
                    })),
                provider.kind === 'llm'
                  ? null
                  : h(Field, { label: t('apiKeyEnv') },
                    h('input', {
                      value: provider.apiKeyEnv ?? '', disabled: !writable,
                      placeholder: 'OPENAI_API_KEY',
                      onChange: event => patch(index, { apiKeyEnv: event.target.value }),
                    })),
                h(Field, { label: t('timeoutMs') },
                  h(NumberInput, {
                    value: provider.timeoutMs ?? 6000, min: 500, step: 500, disabled: !writable,
                    onChange: value => patch(index, { timeoutMs: value }),
                  })),
                provider.kind === 'llm'
                  ? null
                  : h(KeyEditor, {
                    provider,
                    status: props.keyStatus?.[provider.id],
                    t,
                    onChange: props.onKeyChange,
                  }))),
          )),
        h('div', { className: 'esg-actions', style: { marginTop: '12px' } },
          h('button', {
            className: 'esg-btn', disabled: !writable,
            onClick: () => commit([...list, { ...blank, id: `provider-${list.length + 1}` }]),
          }, t('addProvider')),
          h('button', {
            className: 'esg-btn', disabled: !writable,
            onClick: () => commit([...list, {
              ...blank,
              id: `openai-${list.length + 1}`,
              label: 'OpenAI 兼容决策模型',
              protocol: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              model: '',
              apiKeyEnv: 'OPENAI_API_KEY',
            }]),
          }, t('addOpenai')),
          h('button', {
            className: 'esg-btn', disabled: !writable,
            onClick: () => commit([...list, {
              ...blank,
              id: `llm-${list.length + 1}`,
              label: 'LLM 托底',
              kind: 'llm',
              apiKeyEnv: '',
            }]),
          }, t('addLlm'))))
    }

    /** The decision log table. */
    function LogsPanel(props) {
      const { t } = props
      const [rows, setRows] = React.useState([])
      const [state, setState] = React.useState({ loading: true, error: null, path: '' })

      const load = React.useCallback(async () => {
        setState(previous => ({ ...previous, loading: true, error: null }))
        try {
          const body = await requestJson('logs?limit=200')
          setRows(body.records ?? [])
          setState({ loading: false, error: null, path: body.path ?? '' })
        } catch (error) {
          setState({ loading: false, error: String(error?.message ?? error), path: '' })
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const clear = async () => {
        try {
          await requestJson('logs/clear', { method: 'POST', body: '{}' })
          await load()
        } catch (error) {
          setState(previous => ({ ...previous, error: String(error?.message ?? error) }))
        }
      }

      const formatTime = ts => {
        if (!ts) return ''
        const date = new Date(ts)
        const pad = value => String(value).padStart(2, '0')
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      }

      return h('div', { className: 'esg-section' },
        h('h3', null, t('logs')),
        h('p', { className: 'esg-hint' }, state.path ? `${t('logsHint')} ${state.path}` : t('logsHint')),
        h('div', { className: 'esg-actions', style: { marginBottom: '10px' } },
          h('button', { className: 'esg-btn', onClick: load, disabled: state.loading }, t('refresh')),
          h('button', { className: 'esg-btn', onClick: clear, disabled: state.loading }, t('clear')),
          state.error ? h('span', { className: 'esg-err' }, `${t('error')}: ${state.error}`) : null),
        rows.length === 0
          ? h('p', { className: 'esg-hint' }, state.loading ? '…' : t('empty'))
          : h('table', { className: 'esg-table' },
            h('thead', null, h('tr', null,
              h('th', null, t('time')),
              h('th', null, t('act')),
              h('th', null, t('reason')),
              h('th', null, t('turn')),
              h('th', null, t('verdict')),
              h('th', null, t('latency')),
              h('th', null, t('text')))),
            h('tbody', null, rows.map(row => h('tr', { key: row.id },
              h('td', { className: 'num esg-mono' }, formatTime(row.ts)),
              h('td', null, h('span', { className: `esg-tag ${row.act === 'continue' ? 'ok' : ''}` }, row.act ?? '')),
              h('td', { className: 'esg-mono' }, row.reason ?? ''),
              h('td', { className: 'num' }, row.turn ?? ''),
              h('td', { className: 'num esg-mono' },
                row.verdict
                  ? `n=${row.verdict.narrates ?? '-'} a=${row.verdict.asksUser ?? '-'} w=${row.verdict.waiting ?? '-'}`
                  : ''),
              h('td', { className: 'num' }, row.latencyMs ? `${row.latencyMs}ms` : ''),
              h('td', null, h('div', { className: 'esg-ellipsis', title: row.text ?? '' }, row.text ?? '')))))))
    }

    /** The on-demand judge box. */
    function TestPanel(props) {
      const { t } = props
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)

      const run = async () => {
        if (!text.trim() || busy) return
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const body = await requestJson('test', { method: 'POST', body: JSON.stringify({ text }) })
          setResult(body)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'esg-section' },
        h('h3', null, t('test')),
        h('p', { className: 'esg-hint' }, t('testPlaceholder')),
        h('textarea', {
          className: 'esg-field',
          style: { width: '100%', minHeight: '72px' },
          value: text,
          onChange: event => setText(event.target.value),
          placeholder: '接下来改 environment.ts 与 deployment.ts。先读全文取准确行文。',
        }),
        h('div', { className: 'esg-actions', style: { marginTop: '8px' } },
          h('button', { className: 'esg-btn', onClick: run, disabled: busy || !text.trim() },
            busy ? t('testing') : t('runTest')),
          error ? h('span', { className: 'esg-err' }, `${t('error')}: ${error}`) : null),
        result
          ? h('div', { style: { marginTop: '10px' } },
            h('pre', { className: 'esg-pre' }, JSON.stringify({
              kind: result.kind,
              action: result.action,
              provider: result.provider,
              latencyMs: result.latencyMs,
              verdict: result.verdict,
              attempts: result.attempts,
            }, null, 2)))
          : null)
    }

    /** The settings tab body. */
    function GuardTab(props) {
      const { form, t } = props
      const snapshot = useFormSnapshot(form)
      const value = (snapshot?.value ?? {})
      const writable = snapshot?.writable !== false && snapshot?.status === 'ready'
      const dm = value.dm ?? {}
      const policy = {
        mode: dm.mode ?? 'auto',
        threshold: dm.threshold ?? 0.5,
        askThreshold: dm.askThreshold ?? 0.4,
        waitThreshold: dm.waitThreshold ?? 0.5,
      }
      // Which provider already holds a key, and where it came from.
      const [keyStatus, setKeyStatus] = React.useState({})

      const loadKeyStatus = React.useCallback(async () => {
        try {
          const body = await requestJson('status')
          const next = {}
          for (const provider of body?.providers ?? []) next[provider.id] = provider
          setKeyStatus(next)
        } catch {
          // The tab still works without the status route; badges stay empty.
        }
      }, [])

      React.useEffect(() => {
        if (form) loadKeyStatus()
      }, [form, loadKeyStatus])

      const onKeyChange = (id, hasApiKey) => {
        setKeyStatus(previous => ({
          ...previous,
          [id]: { ...(previous[id] ?? { id }), hasApiKey, apiKeySource: hasApiKey ? 'settings' : null },
        }))
      }

      if (!form) return h('div', { className: 'esg-root esg-hint' }, t('noForm'))

      const set = (field, next) => {
        try {
          form.set(field, next)
        } catch (error) {
          props.onError?.(String(error))
        }
      }

      return h('div', { className: 'esg-root' },
        h('div', { className: 'esg-section' },
          h('h3', null, t('title')),
          h('p', { className: 'esg-hint' }, t('intro')),
          h('div', { className: 'esg-grid' },
            h(Field, { label: t('master') },
              h('input', {
                type: 'checkbox',
                checked: value.enabled !== false,
                disabled: !writable,
                onChange: event => set('enabled', event.target.checked),
              })),
            h(Field, { label: t('maxContinuations') },
              h(NumberInput, {
                value: value.maxContinuations ?? 3, min: 0, max: 20, disabled: !writable,
                onChange: next => set('maxContinuations', next),
              })),
            h(Field, { label: t('mode') },
              h('select', {
                value: policy.mode, disabled: !writable,
                onChange: event => set('dm', { ...dm, mode: event.target.value }),
              },
              h('option', { value: 'auto' }, t('modeAuto')),
              h('option', { value: 'always' }, t('modeAlways')),
              h('option', { value: 'off' }, t('modeOff')))),
            h(Field, { label: t('narrate') },
              h(NumberInput, {
                value: policy.threshold, min: 0, max: 1, step: 0.05, disabled: !writable,
                onChange: next => set('dm', { ...dm, threshold: next }),
              })),
            h(Field, { label: t('ask') },
              h(NumberInput, {
                value: policy.askThreshold, min: 0, max: 1, step: 0.05, disabled: !writable,
                onChange: next => set('dm', { ...dm, askThreshold: next }),
              })),
            h(Field, { label: t('wait') },
              h(NumberInput, {
                value: policy.waitThreshold, min: 0, max: 1, step: 0.05, disabled: !writable,
                onChange: next => set('dm', { ...dm, waitThreshold: next }),
              }))),
          h('div', { style: { marginTop: '12px' } },
            h(Field, { label: t('steer') },
              h('textarea', {
                value: value.steerText ?? '',
                disabled: !writable,
                onChange: event => set('steerText', event.target.value),
              }))),
          h('p', { className: 'esg-hint', style: { marginTop: '8px' } },
            writable ? t('saveHint') : `${t('readOnly')} (${snapshot?.status ?? 'unknown'})`)),
        h(ChainEditor, {
          providers: value.providers,
          writable,
          t,
          keyStatus,
          onKeyChange,
          onChange: next => set('providers', next),
        }),
        h(TestPanel, { t }),
        h(LogsPanel, { t }))
    }

    /** Register the tab under Plugins and keep it with the settings section. */
    function apply(ctx) {
      ctx.effect(() => installStyles(), 'early-stop-guard: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'early-stop-guard: dictionaries')
      const t = ctx.locale.bind(NS)
      let form
      try {
        form = ctx.configForms.get(DOMAIN)
      } catch (error) {
        ctx.logger?.warn?.(`[early-stop-guard] config form unavailable: ${error}`)
      }
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: DOMAIN,
        order: 90,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ form, t }),
      }, GuardTab))
    }

    return {
      apply,
      inject: ['slots', 'locale', 'configForms'],
    }
  },
})
