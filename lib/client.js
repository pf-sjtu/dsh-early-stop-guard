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
      chain: '裁判供应商链',
      chainHint: '自上而下，先成功者生效。决策模型返回三题概率；LLM 供应商回退到会话模型或固定路由。',
      orphanKeys: '已保存的密钥找不到对应供应商（改过 id？）：',
      addProvider: '新增供应商',
      addOpenai: '新增 OpenAI 兼容决策模型',
      addDecisions: '新增 OpenAI Decisions（gpt-6-luna）',
      addLlm: '新增 LLM 托底',
      labelOpenai: 'OpenAI 兼容决策模型',
      labelDecisions: 'OpenAI Decisions（gpt-6-luna）',
      labelLlm: 'LLM 托底',
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
      timeoutMs: '超时（毫秒）',
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
      logsPath: '日志文件',
      refresh: '刷新',
      clear: '清空',
      empty: '暂无记录',
      time: '时间',
      act: '判定',
      reason: '原因',
      turn: '回合',
      latency: '耗时',
      text: '尾部正文',
      details: '详情',
      attempts: '供应商尝试',
      noAttempts: '没有记录供应商尝试',
      test: '试判一条',
      testPlaceholder: '粘贴一段「叙述了下一步」的正文，看这里怎么判。',
      runTest: '试判',
      testing: '判定中…',
      result: '结果',
      raw: '原始返回',
      noForm: '设置表单尚未就绪',
      readOnly: '当前不可写',
      saveHint: '改动即时保存。',
      error: '请求失败',
      verdict: '概率',
      noJudge: '无裁判',
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
      chain: 'Judge chain',
      chainHint: 'Top to bottom, first answer wins. Decision models answer three probabilities; LLM providers fall back to the session route.',
      orphanKeys: 'Saved keys with no matching provider (renamed an id?):',
      addProvider: 'Add provider',
      addOpenai: 'Add OpenAI-compatible decision model',
      addDecisions: 'Add OpenAI Decisions (gpt-6-luna)',
      addLlm: 'Add LLM fallback',
      labelOpenai: 'OpenAI-compatible decision model',
      labelDecisions: 'OpenAI Decisions (gpt-6-luna)',
      labelLlm: 'LLM fallback',
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
      timeoutMs: 'Timeout (ms)',
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
      logsPath: 'Log file',
      refresh: 'Refresh',
      clear: 'Clear',
      empty: 'No records yet',
      time: 'Time',
      act: 'Act',
      reason: 'Reason',
      turn: 'Turn',
      latency: 'Latency',
      text: 'Trailing text',
      details: 'Details',
      attempts: 'Provider attempts',
      noAttempts: 'No provider attempt was recorded',
      test: 'Judge one string',
      testPlaceholder: 'Paste a "next I will…" message and see what the chain decides.',
      runTest: 'Judge',
      testing: 'Judging…',
      result: 'Result',
      raw: 'Raw response',
      noForm: 'Settings form is not ready',
      readOnly: 'read-only',
      saveHint: 'Changes save immediately.',
      error: 'Request failed',
      verdict: 'probabilities',
      noJudge: 'no judge',
    }

    /**
     * Inject the page stylesheet once, keyed by plugin id.
     *
     * Everything is expressed with `currentColor` and low-alpha greys so the page
     * follows the host theme instead of fighting it.
     */
    function installStyles() {
      const existing = document.querySelector('style[data-plugin-css="dsh-early-stop-guard"]')
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-early-stop-guard'
      style.textContent = `
.esg-root { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 1.5; }
.esg-section { border: 1px solid rgba(128,128,128,0.22); border-radius: 10px; overflow: hidden; }
.esg-section-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 9px 14px; border-bottom: 1px solid rgba(128,128,128,0.16); background: rgba(128,128,128,0.055);
}
.esg-section-head > h3 { margin: 0; font-size: 13px; font-weight: 600; }
.esg-section-head .esg-spacer { flex: 1 1 auto; }
.esg-section-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 14px; }
.esg-sub { margin: 0; font-size: 11.5px; opacity: 0.62; }
.esg-note { margin: 0; font-size: 11.5px; opacity: 0.55; }
.esg-note.esg-mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.esg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 14px; }
.esg-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.esg-field > span { font-size: 11px; letter-spacing: 0.01em; opacity: 0.6; }
.esg-control {
  font: inherit; font-size: 12.5px; color: inherit; background: transparent; box-sizing: border-box;
  border: 1px solid rgba(128,128,128,0.3); border-radius: 7px; padding: 6px 9px; width: 100%; min-width: 0;
}
.esg-control:focus { outline: none; border-color: rgba(120,160,255,0.7); box-shadow: 0 0 0 2px rgba(120,160,255,0.15); }
.esg-control[disabled] { opacity: 0.5; }
textarea.esg-control { min-height: 62px; resize: vertical; line-height: 1.55; }
.esg-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; opacity: 0.9; }
.esg-btn {
  font: inherit; font-size: 12px; height: 28px; padding: 0 10px; border-radius: 7px;
  border: 1px solid rgba(128,128,128,0.32); background: transparent; color: inherit;
  cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.esg-btn:hover:not([disabled]) { border-color: rgba(128,128,128,0.6); background: rgba(128,128,128,0.09); }
.esg-btn[disabled] { opacity: 0.4; cursor: default; }
.esg-btn.icon { width: 28px; padding: 0; }
.esg-btn.primary { border-color: rgba(94,140,255,0.6); }
.esg-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.esg-chip {
  display: inline-flex; align-items: center; height: 19px; padding: 0 7px; border-radius: 999px;
  border: 1px solid rgba(128,128,128,0.3); font-size: 11px; line-height: 1; white-space: nowrap;
}
.esg-chip.ok { border-color: rgba(76,154,82,0.65); }
.esg-chip.warn { border-color: rgba(185,138,42,0.7); }
.esg-chip.bad { border-color: rgba(194,67,61,0.7); }
.esg-chip.mute { border-color: transparent; background: rgba(128,128,128,0.15); }
.esg-chain { display: flex; flex-direction: column; gap: 10px; }
.esg-provider { border: 1px solid rgba(128,128,128,0.18); border-radius: 9px; overflow: hidden; }
.esg-provider-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: rgba(128,128,128,0.05); border-bottom: 1px solid rgba(128,128,128,0.14);
}
.esg-provider-head > strong { font-size: 12.5px; font-weight: 600; }
.esg-provider-head .esg-actions { margin-left: auto; }
.esg-provider-body { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
.esg-provider.is-off .esg-provider-body { opacity: 0.6; }
.esg-key-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.esg-key-row .esg-control { flex: 1 1 200px; }
.esg-banner { margin: 0; font-size: 11.5px; padding: 7px 10px; border-radius: 7px; border: 1px solid rgba(128,128,128,0.25); }
.esg-warn { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11.5px; padding: 7px 10px; border-radius: 7px; border: 1px solid rgba(234,179,8,0.55); }
.esg-banner.err { border-color: rgba(194,67,61,0.55); }
.esg-banner.ok { border-color: rgba(76,154,82,0.55); }
.esg-log { display: flex; flex-direction: column; border-top: 1px solid rgba(128,128,128,0.14); }
.esg-log-head {
  display: grid; grid-template-columns: 10px 116px 62px 1fr 128px; gap: 10px; align-items: center;
  padding: 7px 14px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.45;
}
.esg-log-head > span:last-child { text-align: right; }
.esg-log-item { border-bottom: 1px solid rgba(128,128,128,0.11); }
.esg-log-item:last-child { border-bottom: none; }
.esg-log-row {
  display: grid; grid-template-columns: 10px 116px 62px 1fr 128px; gap: 10px; align-items: center;
  width: 100%; text-align: left; box-sizing: border-box; min-height: 34px; padding: 7px 14px;
  font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer;
}
.esg-log-row:hover { background: rgba(128,128,128,0.06); }
.esg-log-row .esg-chip { justify-self: start; max-width: 100%; overflow: hidden; }
.esg-log-when { font-size: 11.5px; font-variant-numeric: tabular-nums; opacity: 0.72; white-space: nowrap; }
.esg-log-reason { font-size: 11.5px; opacity: 0.78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.esg-log-metrics { display: flex; align-items: center; justify-content: flex-end; gap: 10px; font-size: 11.5px; font-variant-numeric: tabular-nums; opacity: 0.72; white-space: nowrap; }
.esg-log-caret { font-size: 10px; opacity: 0.5; width: 10px; text-align: center; }
.esg-log-sub { display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: center; padding: 0 14px 9px; }
.esg-log-text { flex: 1 1 auto; min-width: 0; font-size: 11.5px; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.esg-log-detail { display: flex; flex-direction: column; gap: 8px; padding: 2px 14px 12px; }
.esg-log-detail pre {
  margin: 0; padding: 9px 11px; border-radius: 8px; background: rgba(128,128,128,0.09);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto;
}
.esg-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11.5px; margin: 0; }
.esg-kv > dt { opacity: 0.55; margin: 0; }
.esg-kv > dd { margin: 0; overflow: hidden; text-overflow: ellipsis; }
.esg-probs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
.esg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.esg-result { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid rgba(128,128,128,0.2); border-radius: 9px; }
.esg-attempts { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; }
.esg-attempt { display: flex; gap: 8px; align-items: baseline; }
.esg-attempt > b { font-weight: 600; flex: 0 0 auto; }
.esg-attempt > span { opacity: 0.62; overflow: hidden; text-overflow: ellipsis; }
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

    /** A single-line text input bound to the form. */
    function TextInput(props) {
      return h('input', {
        className: 'esg-control',
        value: props.value ?? '',
        placeholder: props.placeholder,
        disabled: props.disabled,
        onChange: event => props.onChange(event.target.value),
      })
    }

    /** A number input that commits on change. */
    function NumberInput(props) {
      return h('input', {
        className: 'esg-control',
        type: 'number',
        value: props.value ?? 0,
        min: props.min,
        max: props.max,
        step: props.step ?? 1,
        disabled: props.disabled,
        onChange: event => props.onChange(Number(event.target.value)),
      })
    }

    /** One small rounded label. */
    function Chip(props) {
      const tone = props.tone ? ` ${props.tone}` : ''
      const mono = props.mono ? ' esg-mono' : ''
      return h('span', { className: `esg-chip${tone}${mono}`, title: props.title }, props.children)
    }

    /** Two decimals is the resolution a threshold ever needed. */
    function formatProbability(value) {
      if (typeof value !== 'number' || Number.isNaN(value)) return '-'
      return value.toFixed(2)
    }

    /** The three class probabilities, compact enough for one row. */
    function Probabilities(props) {
      const verdict = props.verdict
      if (!verdict) {
        // No judge ran: the rule path alone decided, so keep the column width.
        return h('span', { className: 'esg-probs' },
          h(Chip, { tone: 'mute', mono: true }, props.t ? props.t('noJudge') : 'no judge'))
      }
      return h('span', { className: 'esg-probs' },
        h(Chip, { mono: true, title: 'narrates' }, `n ${formatProbability(verdict.narrates)}`),
        h(Chip, { mono: true, title: 'asksUser' }, `a ${formatProbability(verdict.asksUser)}`),
        h(Chip, { mono: true, title: 'waiting' }, `w ${formatProbability(verdict.waiting)}`))
    }

    /** Provider attempts of one decision, oldest first. */
    function Attempts(props) {
      const attempts = Array.isArray(props.attempts) ? props.attempts : []
      if (attempts.length === 0) return h('p', { className: 'esg-note' }, props.t('noAttempts'))
      return h('div', { className: 'esg-attempts' },
        attempts.map((attempt, index) => h('div', { className: 'esg-attempt', key: index },
          h('b', { className: 'esg-mono' }, attempt?.id ?? '?'),
          h('span', null, attempt?.error ? String(attempt.error) : 'ok'))))
    }

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

      return h('div', { className: 'esg-field' },
        h('span', null, t('key')),
        h('div', { className: 'esg-key-row' },
          h('input', {
            className: 'esg-control',
            type: 'password',
            value: draft,
            placeholder: t('keyPlaceholder'),
            autoComplete: 'off',
            disabled: props.disabled,
            onChange: event => setDraft(event.target.value),
          }),
          h('button', {
            className: 'esg-btn primary',
            disabled: busy || !draft.trim(),
            onClick: () => call('secret', { id: provider.id, apiKey: draft }),
          }, t('saveKey')),
          h('button', {
            className: 'esg-btn',
            disabled: busy || source !== 'settings',
            onClick: () => call('secret/clear', { id: provider.id }),
          }, t('clearKey'))),
        h('p', { className: 'esg-note' },
          h(Chip, { tone: source ? 'ok' : '' }, badge),
          status?.apiKeyEnv ? ` ${status.apiKeyEnv}` : '',
          ` · ${t('keyHint')}`),
        error ? h('p', { className: 'esg-banner err' }, `${t('error')}: ${error}`) : null,
        notice ? h('p', { className: 'esg-banner ok' }, notice) : null)
    }

    /** The provider chain editor. */
    function ChainEditor(props) {
      const { providers, writable, onChange, t } = props
      const list = Array.isArray(providers) ? providers : []
      const commit = next => onChange(next)
      const patch = (index, changes) => {
        commit(list.map((entry, position) => (position === index ? { ...entry, ...changes } : entry)))
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
        timeoutMs: 20000,
        enabled: true,
      }

      return h('div', { className: 'esg-section' },
        h('div', { className: 'esg-section-head' },
          h('h3', null, t('chain')),
          h('span', { className: 'esg-chip mute esg-mono' }, `${list.length}`),
          h('span', { className: 'esg-spacer' })),
        h('div', { className: 'esg-section-body' },
          h('p', { className: 'esg-sub' }, t('chainHint')),
          h('div', { className: 'esg-chain' },
            list.length === 0
              ? h('p', { className: 'esg-note' }, t('empty'))
              : list.map((provider, index) => {
                const isLlm = provider.kind === 'llm'
                const off = provider.enabled === false
                return h('div', {
                  className: `esg-provider${off ? ' is-off' : ''}`,
                  key: `${provider.id || index}-${index}`,
                },
                h('div', { className: 'esg-provider-head' },
                  h('span', { className: 'esg-chip mute esg-mono' }, `${index + 1}`),
                  h('strong', null, provider.label || provider.id || `#${index + 1}`),
                  h(Chip, { mono: true }, isLlm ? 'llm' : (provider.protocol ?? 'systemone')),
                  off ? h(Chip, { tone: 'warn' }, t('master')) : null,
                  h('span', { className: 'esg-actions' },
                    h('button', {
                      className: 'esg-btn icon', disabled: !writable || index === 0,
                      onClick: () => move(index, -1), title: t('up'), 'aria-label': t('up'),
                    }, '↑'),
                    h('button', {
                      className: 'esg-btn icon', disabled: !writable || index === list.length - 1,
                      onClick: () => move(index, 1), title: t('down'), 'aria-label': t('down'),
                    }, '↓'),
                    h('button', {
                      className: 'esg-btn icon', disabled: !writable,
                      onClick: () => remove(index), title: t('remove'), 'aria-label': t('remove'),
                    }, '✕'))),
                h('div', { className: 'esg-provider-body' },
                  h('div', { className: 'esg-grid' },
                    h(Field, { label: t('enabled') },
                      h('span', { className: 'esg-switch' },
                        h('input', {
                          type: 'checkbox', checked: !off, disabled: !writable,
                          onChange: event => patch(index, { enabled: event.target.checked }),
                        }))),
                    h(Field, { label: 'id' },
                      h(TextInput, {
                        value: provider.id, disabled: !writable,
                        onChange: next => patch(index, { id: next }),
                      })),
                    h(Field, { label: t('kind') },
                      h('select', {
                        className: 'esg-control', value: provider.kind ?? 'decision', disabled: !writable,
                        onChange: event => patch(index, { kind: event.target.value }),
                      },
                      h('option', { value: 'decision' }, 'decision'),
                      h('option', { value: 'llm' }, 'llm'))),
                    isLlm
                      ? h(Field, { label: t('llmProvider') },
                        h(TextInput, {
                          value: provider.llmProvider, placeholder: '(session route)', disabled: !writable,
                          onChange: next => patch(index, { llmProvider: next }),
                        }))
                      : h(Field, { label: t('protocol') },
                        h('select', {
                          className: 'esg-control', value: provider.protocol ?? 'systemone', disabled: !writable,
                          onChange: event => patch(index, { protocol: event.target.value }),
                        },
                        h('option', { value: 'systemone' }, 'systemone'),
                        h('option', { value: 'decisions' }, 'decisions'),
                        h('option', { value: 'openai' }, 'openai'))),
                    isLlm
                      ? h(Field, { label: t('llmModel') },
                        h(TextInput, {
                          value: provider.llmModel, placeholder: '(session route)', disabled: !writable,
                          onChange: next => patch(index, { llmModel: next }),
                        }))
                      : h(Field, { label: t('model') },
                        h(TextInput, {
                          value: provider.model, disabled: !writable,
                          onChange: next => patch(index, { model: next }),
                        })),
                    isLlm
                      ? null
                      : h(Field, { label: t('baseUrl') },
                        h(TextInput, {
                          value: provider.baseUrl, placeholder: 'https://api.example.com/v1', disabled: !writable,
                          onChange: next => patch(index, { baseUrl: next }),
                        })),
                    isLlm
                      ? null
                      : h(Field, { label: t('apiKeyEnv') },
                        h(TextInput, {
                          value: provider.apiKeyEnv, placeholder: 'OPENAI_API_KEY', disabled: !writable,
                          onChange: next => patch(index, { apiKeyEnv: next }),
                        })),
                    h(Field, { label: t('timeoutMs') },
                      h(NumberInput, {
                        value: provider.timeoutMs ?? 20000, min: 500, step: 500, disabled: !writable,
                        onChange: next => patch(index, { timeoutMs: next }),
                      }))),
                  isLlm
                    ? null
                    : h(KeyEditor, {
                      provider,
                      status: props.keyStatus?.[provider.id],
                      disabled: !writable,
                      t,
                      onChange: props.onKeyChange,
                    })))
              })),
          props.orphanKeys?.length
            ? h('p', { className: 'esg-warn' },
              h('span', null, t('orphanKeys')),
              h('code', { className: 'esg-mono' }, props.orphanKeys.join(', ')))
            : null,
          h('div', { className: 'esg-actions' },
            h('button', {
              className: 'esg-btn primary', disabled: !writable,
              onClick: () => commit([...list, { ...blank, id: `provider-${list.length + 1}` }]),
            }, `+ ${t('addProvider')}`),
            h('button', {
              className: 'esg-btn', disabled: !writable,
              onClick: () => commit([...list, {
                ...blank,
                id: `openai-${list.length + 1}`,
                label: t('labelOpenai'),
                protocol: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                apiKeyEnv: 'OPENAI_API_KEY',
              }]),
            }, t('addOpenai')),
            h('button', {
              className: 'esg-btn', disabled: !writable,
              onClick: () => commit([...list, {
                ...blank,
                id: `openai-decisions-${list.length + 1}`,
                label: t('labelDecisions'),
                protocol: 'decisions',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-6-luna',
                apiKeyEnv: 'OPENAI_API_KEY',
              }]),
            }, t('addDecisions')),
            h('button', {
              className: 'esg-btn', disabled: !writable,
              onClick: () => commit([...list, {
                ...blank,
                id: `llm-${list.length + 1}`,
                label: t('labelLlm'),
                kind: 'llm',
                apiKeyEnv: '',
              }]),
            }, t('addLlm')))))
    }

    /** The decision log: one compact row per judgement, expanding into details. */
    function LogsPanel(props) {
      const { t } = props
      const [rows, setRows] = React.useState([])
      const [state, setState] = React.useState({ loading: true, error: null, path: '' })
      const [open, setOpen] = React.useState(null)

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
          setOpen(null)
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
        h('div', { className: 'esg-section-head' },
          h('h3', null, t('logs')),
          h('span', { className: 'esg-chip mute esg-mono' }, `${rows.length}`),
          h('span', { className: 'esg-spacer' }),
          h('button', {
            className: 'esg-btn', onClick: load, disabled: state.loading,
          }, state.loading ? '…' : t('refresh')),
          h('button', {
            className: 'esg-btn', onClick: clear, disabled: state.loading || rows.length === 0,
          }, t('clear'))),
        h('div', { className: 'esg-section-body' },
          h('p', { className: 'esg-sub' }, t('logsHint')),
          state.path
            ? h('p', { className: 'esg-note esg-mono', title: state.path }, `${t('logsPath')}: ${state.path}`)
            : null,
          state.error ? h('p', { className: 'esg-banner err' }, `${t('error')}: ${state.error}`) : null,
          rows.length === 0
            ? h('p', { className: 'esg-note' }, state.loading ? '…' : t('empty'))
            : h('div', { className: 'esg-log' },
              h('div', { className: 'esg-log-head' },
                h('span', null, ''),
                h('span', null, t('time')),
                h('span', null, t('act')),
                h('span', null, t('reason')),
                h('span', null, t('turn'))),
              rows.map((row, index) => {
              const id = row.id ?? index
              const expanded = open === id
              const preview = String(row.text ?? '').replace(/\s+/g, ' ').trim()
              return h('div', { className: 'esg-log-item', key: id },
                h('button', {
                  className: 'esg-log-row',
                  type: 'button',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: () => setOpen(expanded ? null : id),
                },
                h('span', { className: 'esg-log-caret' }, expanded ? '▾' : '▸'),
                h('span', { className: 'esg-log-when' }, formatTime(row.ts)),
                h(Chip, { tone: row.act === 'continue' ? 'ok' : '' }, row.act ?? '-'),
                h('span', { className: 'esg-log-reason esg-mono', title: row.reason ?? '' }, row.reason ?? ''),
                h('span', { className: 'esg-log-metrics' },
                  h('span', null, `${t('turn')} ${row.turn ?? '-'}`),
                  row.latencyMs ? h('span', null, `${row.latencyMs}ms`) : null)),
                h('div', { className: 'esg-log-sub' },
                  h(Probabilities, { verdict: row.verdict, t }),
                  h('span', { className: 'esg-log-text', title: preview }, preview)),
                expanded
                  ? h('div', { className: 'esg-log-detail' },
                    h('dl', { className: 'esg-kv' },
                      h('dt', null, 'provider'),
                      h('dd', { className: 'esg-mono' }, row.provider ?? '-'),
                      h('dt', null, 'kind'),
                      h('dd', { className: 'esg-mono' }, row.kind ?? '-'),
                      h('dt', null, t('verdict')),
                      h('dd', { className: 'esg-mono' },
                        row.verdict
                          ? `n ${formatProbability(row.verdict.narrates)} · a ${formatProbability(row.verdict.asksUser)} · w ${formatProbability(row.verdict.waiting)}`
                          : '-')),
                    h('span', { className: 'esg-note' }, t('attempts')),
                    h(Attempts, { attempts: row.attempts, t }),
                    preview
                      ? h('pre', null, String(row.text ?? '').trim())
                      : h('p', { className: 'esg-note' }, '—'))
                  : null)
            }))))
    }

    /** The on-demand judge box. */
    function TestPanel(props) {
      const { t } = props
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [raw, setRaw] = React.useState(false)

      const run = async () => {
        if (!text.trim() || busy) return
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          setResult(await requestJson('test', { method: 'POST', body: JSON.stringify({ text }) }))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const payload = result
        ? {
          kind: result.kind,
          action: result.action,
          provider: result.provider,
          latencyMs: result.latencyMs,
          verdict: result.verdict,
          attempts: result.attempts,
        }
        : null

      return h('div', { className: 'esg-section' },
        h('div', { className: 'esg-section-head' },
          h('h3', null, t('test')),
          h('span', { className: 'esg-spacer' })),
        h('div', { className: 'esg-section-body' },
          h('p', { className: 'esg-sub' }, t('testPlaceholder')),
          h('textarea', {
            className: 'esg-control esg-mono',
            value: text,
            rows: 3,
            onChange: event => setText(event.target.value),
            placeholder: '接下来改 environment.ts 与 deployment.ts。先读全文取准确行文。',
          }),
          h('div', { className: 'esg-actions' },
            h('button', {
              className: 'esg-btn primary', onClick: run, disabled: busy || !text.trim(),
            }, busy ? t('testing') : t('runTest')),
            error ? h('span', { className: 'esg-banner err' }, `${t('error')}: ${error}`) : null),
          payload
            ? h('div', { className: 'esg-result' },
              h('div', { className: 'esg-actions' },
                h(Chip, { tone: payload.action === 'continue' ? 'ok' : '' }, `${payload.action ?? '-'}`),
                h(Chip, { mono: true }, payload.kind ?? '-'),
                h(Chip, { mono: true }, payload.provider ?? 'no provider'),
                payload.latencyMs ? h(Chip, { mono: true }, `${payload.latencyMs}ms`) : null,
                h('span', { className: 'esg-spacer' }),
                h('button', {
                  className: 'esg-btn', onClick: () => setRaw(!raw),
                }, t('raw'))),
              h(Probabilities, { verdict: payload.verdict }),
              h('span', { className: 'esg-note' }, t('attempts')),
              h(Attempts, { attempts: payload.attempts, t }),
              raw ? h('pre', null, JSON.stringify(payload, null, 2)) : null)
            : null))
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
      const [orphanKeys, setOrphanKeys] = React.useState([])

      const loadKeyStatus = React.useCallback(async () => {
        try {
          const body = await requestJson('status')
          const next = {}
          for (const provider of body?.providers ?? []) next[provider.id] = provider
          setKeyStatus(next)
          setOrphanKeys(Array.isArray(body?.orphanKeys) ? body.orphanKeys : [])
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
        // Saving or clearing a key moves it in or out of the orphan list.
        loadKeyStatus()
      }

      if (!form) return h('div', { className: 'esg-root esg-note' }, t('noForm'))

      const set = (field, next) => {
        try {
          form.set(field, next)
        } catch (error) {
          props.onError?.(String(error))
        }
      }

      return h('div', { className: 'esg-root' },
        h('div', { className: 'esg-section' },
          h('div', { className: 'esg-section-head' },
            h('h3', null, t('title')),
            h('span', { className: 'esg-spacer' }),
            h('label', { className: 'esg-switch', title: t('masterHint') },
              h('input', {
                type: 'checkbox',
                checked: value.enabled !== false,
                disabled: !writable,
                onChange: event => set('enabled', event.target.checked),
              }),
              `${t('master')}`)),
          h('div', { className: 'esg-section-body' },
            h('p', { className: 'esg-sub' }, t('intro')),
            h('div', { className: 'esg-grid' },
              h(Field, { label: t('maxContinuations') },
                h(NumberInput, {
                  value: value.maxContinuations ?? 3, min: 0, max: 20, disabled: !writable,
                  onChange: next => set('maxContinuations', next),
                })),
              h(Field, { label: t('mode') },
                h('select', {
                  className: 'esg-control', value: policy.mode, disabled: !writable,
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
            h(Field, { label: t('steer') },
              h('textarea', {
                className: 'esg-control',
                value: value.steerText ?? '',
                disabled: !writable,
                onChange: event => set('steerText', event.target.value),
              })),
            h('p', { className: 'esg-note' },
              writable ? t('saveHint') : `${t('readOnly')} (${snapshot?.status ?? 'unknown'})`))),
        h(ChainEditor, {
          providers: value.providers,
          writable,
          t,
          keyStatus,
          orphanKeys,
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
