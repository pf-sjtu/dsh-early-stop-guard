/**
 * Configuration schema and normalization for the early-stop guard.
 *
 * Every field carries its own default so the generated Settings page can render
 * from the schema alone; {@link resolveConfig} re-checks the values a running
 * turn reads, because a hand-edited `cordis.patch.yml` can bypass validation.
 *
 * @module dsh-early-stop-guard/config
 */

import z from '@deepseek-ai/schemastery'

/**
 * Steer message injected when the guard decides a turn stopped mid-task.
 *
 * It names the failure mode explicitly and keeps an escape hatch for the three
 * legitimate ways to end a turn, so a model that really is finished is not
 * trapped in a continuation loop.
 */
export const DEFAULT_STEER_TEXT = [
  '你描述了接下来的动作，但没有发出工具调用，回合因此被判定为已结束。',
  '如果任务还没完成：请立刻为刚才描述的那个动作发出工具调用，不要只叙述。',
  '如果你在等我确认、在等一个外部结果，或者任务确实已经做完，忽略本条即可。',
].join('\n')

/**
 * The three predicates the decision model answers, in the order the guard
 * evaluates them.
 *
 * Order is load-bearing: a message that waits or asks also scores high on
 * `narrates` (measured 0.65 and 0.54), so waiting and asking must be ruled out
 * before narration is allowed to continue the turn.
 */
export const QUESTIONS = [
  {
    id: 'narrates',
    instructions:
      'The trailing assistant message announces or plans an action that it still intends to perform '
      + '(reading a file, editing code, running a command, searching), meaning the task is not finished yet. '
      + 'Answer with the probability that the message promises pending work rather than reporting finished work.',
  },
  {
    id: 'asks_user',
    instructions:
      'The trailing assistant message asks the human a question, requests a decision, approval, or missing '
      + 'information, or otherwise hands control back to the human. '
      + 'Answer with the probability that this is a turn waiting on the human.',
  },
  {
    id: 'waiting',
    instructions:
      'The trailing assistant message says it is waiting for an external result it does not control yet: '
      + 'a background job or command, a subagent, a download, a build, a timer, another process. '
      + 'Answer with the probability that this is a turn parked on something external.',
  },
]

/** Providers mounted by default: a free decision model, then the session LLM. */
export const DEFAULT_PROVIDERS = [
  {
    id: 'bamboonode',
    label: 'BambooNode System One',
    kind: 'decision',
    protocol: 'systemone',
    baseUrl: 'https://api.bamboonode.dev/v1',
    model: 'startlux-decision-27b-autothink',
    apiKeyEnv: 'BAMBOONODE_API_KEY',
    llmProvider: '',
    llmModel: '',
    // Decision models warm up slowly: 0.45s on a hot path, 3.7s measured live, and cold
    // starts go past 6s, so a tight budget loses the verdict entirely.
    timeoutMs: 20000,
    enabled: true,
  },
  {
    id: 'session-llm',
    label: '当前会话 LLM',
    kind: 'llm',
    protocol: 'systemone',
    baseUrl: '',
    model: '',
    apiKeyEnv: '',
    llmProvider: '',
    llmModel: '',
    timeoutMs: 20000,
    enabled: true,
  },
]

/** One provider in the judge chain. Array order is priority order. */
export const ProviderConfig = z.object({
  /** Stable identity used by the log and the circuit breaker. */
  id: z.string().default(''),
  /** Human label shown in the Settings page. */
  label: z.string().default(''),
  /** `decision` calls an HTTP decision model; `llm` reuses a chat model. */
  kind: z.union([z.const('decision'), z.const('llm')]).default('decision'),
  /**
   * Wire protocol for `decision` providers.
   *
   * `systemone` posts to `/systemone`, `decisions` to `/decisions` (OpenAI's
   * Decisions API, `gpt-6-luna` only), and `openai` to `/chat/completions` with
   * the three questions in the prompt.
   */
  protocol: z.union([
    z.const('systemone'),
    z.const('openai'),
    z.const('decisions'),
  ]).default('systemone'),
  /** Base URL, including the API version segment when the vendor needs one. */
  baseUrl: z.string().default(''),
  /** Model id sent to the provider. */
  model: z.string().default(''),
  /**
   * Environment variable holding the API key. Keys never enter the settings
   * file: the settings wire strips `role: secret` fields, so a key stored here
   * would be erased by the next form save.
   */
  apiKeyEnv: z.string().default(''),
  /** Route provider for `kind: llm`; empty means "the current session route". */
  llmProvider: z.string().default(''),
  /** Route model for `kind: llm`; empty means "the current session route". */
  llmModel: z.string().default(''),
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: z.number().step(500).min(500).default(20000),
  /** Whether this provider takes part in the chain. */
  enabled: z.boolean().default(true),
})

/**
 * Guard policy.
 *
 * Every editable node is marked `volatile`: the Settings page only renders
 * fields the Host can apply without remounting the plugin, and a schema with no
 * volatile node is dropped from `describe()` entirely — which shows up as a
 * permanently read-only form. Volatile nodes reach `apply()` as references
 * (`{ get() }`), so {@link resolveConfig} dereferences them first.
 */
export const Config = z.object({
  /** Kill switch: `false` disables the guard without unmounting the plugin. */
  enabled: z.boolean().default(true).volatile(),
  /** Continuations allowed per turn before the guard gives up on that turn. */
  maxContinuations: z.number().step(1).min(0).default(3).volatile(),
  /** Trailing steps described to the judge. */
  maxSteps: z.number().step(1).min(1).default(8).volatile(),
  /** Trailing assistant text characters kept for the judge. */
  maxTailChars: z.number().step(100).min(200).default(1200).volatile(),
  /** Message injected to keep an unfinished turn open. */
  steerText: z.string().default(DEFAULT_STEER_TEXT).volatile(),
  dm: z.object({
    /** `auto` asks the chain on narrative/gray turns; `always` also on done. */
    mode: z.union([z.const('auto'), z.const('always'), z.const('off')]).default('auto'),
    /** Probability above which `narrates` continues the turn. */
    threshold: z.number().step(0.05).min(0).max(1).default(0.5),
    /** Probability above which `asks_user` ends the turn. */
    askThreshold: z.number().step(0.05).min(0).max(1).default(0.4),
    /** Probability above which `waiting` ends the turn. */
    waitThreshold: z.number().step(0.05).min(0).max(1).default(0.5),
    /** Per-provider ceiling, applied when a provider sets no timeout. */
    timeoutMs: z.number().step(500).min(500).default(12000),
    /** Hard cap on the state string sent to a provider. */
    stateChars: z.number().step(100).min(500).default(4000),
  }).volatile(),
  /** Judge chain, highest priority first. */
  providers: z.array(ProviderConfig).default(DEFAULT_PROVIDERS).volatile(),
  breaker: z.object({
    /** Consecutive failures that open a provider's circuit. */
    failures: z.number().step(1).min(0).default(3),
    /** How long an open circuit stays open. */
    cooldownMs: z.number().step(1000).min(1000).default(600000),
  }).volatile(),
  logs: z.object({
    /** Whether decisions are appended to the JSONL file and served to the UI. */
    enabled: z.boolean().default(true),
    /** Records kept in memory for the Settings page. */
    maxRecords: z.number().step(50).min(50).default(300),
    /** JSONL path; empty means `<dsh home>/early-stop-guard/events.jsonl`. */
    path: z.string().default(''),
  }).volatile(),
  /** Emit a log line for every hook evaluation. */
  debug: z.boolean().default(false).volatile(),
})

/** Key cosmokit uses to mark a parsed config node as a live reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Dereference volatile config nodes.
 *
 * A `volatile()` schema node arrives as `{ get() }` rather than a plain value,
 * and the Settings page rewrites that cell in place when a field is edited, so
 * every read has to dereference instead of caching the parsed shape.
 * @param value - any parsed config node.
 * @returns the same data with volatile references replaced by their contents.
 */
export function unwrap(value) {
  if (value === null || typeof value !== 'object') return value
  if (VOLATILE_WRITE in value) return unwrap(value.get())
  if (Array.isArray(value)) return value.map(unwrap)
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrap(entry)]))
}

/** Coerce anything to a finite number, falling back to `fallback`. */
function num(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Coerce anything to a string. */
function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/** Pick one of `allowed`, else `fallback`. */
function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/**
 * Normalize one provider entry, dropping entries that could never answer.
 * @param raw - candidate provider from settings.
 * @param index - position, used to synthesize a missing id.
 * @returns a fully populated provider, or `null` when it is unusable.
 */
export function normalizeProvider(raw, index) {
  if (raw == null || typeof raw !== 'object') return null
  const kind = oneOf(raw.kind, ['decision', 'llm'], 'decision')
  const provider = {
    id: str(raw.id).trim() || `${kind}-${index + 1}`,
    label: str(raw.label).trim(),
    kind,
    protocol: oneOf(raw.protocol, ['systemone', 'openai', 'decisions'], 'systemone'),
    baseUrl: str(raw.baseUrl).trim(),
    model: str(raw.model).trim(),
    apiKeyEnv: str(raw.apiKeyEnv).trim(),
    llmProvider: str(raw.llmProvider).trim(),
    llmModel: str(raw.llmModel).trim(),
    timeoutMs: Math.max(500, num(raw.timeoutMs, 20000)),
    enabled: raw.enabled !== false,
  }
  if (!provider.enabled) return null
  // A decision provider without a URL and model can never answer, and silently
  // skipping it later would look like a judge that always abstains.
  if (kind === 'decision' && (!provider.baseUrl || !provider.model)) return null
  return provider
}

/**
 * Resolve the live configuration a hook evaluation should read.
 * @param raw - plugin config as loaded (possibly hand-edited).
 * @returns policy with every field inside its documented range.
 */
export function resolveConfig(raw) {
  const source = raw && typeof raw === 'object' ? unwrap(raw) : {}
  const dm = source.dm && typeof source.dm === 'object' ? source.dm : {}
  const breaker = source.breaker && typeof source.breaker === 'object' ? source.breaker : {}
  const logs = source.logs && typeof source.logs === 'object' ? source.logs : {}
  const providerSource = Array.isArray(source.providers) && source.providers.length > 0
    ? source.providers
    : DEFAULT_PROVIDERS
  const providers = providerSource
    .map((entry, index) => normalizeProvider(entry, index))
    .filter(entry => entry !== null)
  return {
    enabled: source.enabled !== false,
    maxContinuations: Math.max(0, Math.trunc(num(source.maxContinuations, 3))),
    maxSteps: Math.max(1, Math.trunc(num(source.maxSteps, 8))),
    maxTailChars: Math.max(200, Math.trunc(num(source.maxTailChars, 1200))),
    steerText: str(source.steerText).trim() || DEFAULT_STEER_TEXT,
    dm: {
      mode: oneOf(dm.mode, ['auto', 'always', 'off'], 'auto'),
      threshold: Math.min(1, Math.max(0, num(dm.threshold, 0.5))),
      askThreshold: Math.min(1, Math.max(0, num(dm.askThreshold, 0.4))),
      waitThreshold: Math.min(1, Math.max(0, num(dm.waitThreshold, 0.5))),
      timeoutMs: Math.max(500, num(dm.timeoutMs, 12000)),
      stateChars: Math.max(500, Math.trunc(num(dm.stateChars, 4000))),
    },
    providers,
    breaker: {
      failures: Math.max(0, Math.trunc(num(breaker.failures, 3))),
      cooldownMs: Math.max(1000, num(breaker.cooldownMs, 600000)),
    },
    logs: {
      enabled: logs.enabled !== false,
      maxRecords: Math.max(50, Math.trunc(num(logs.maxRecords, 300))),
      path: str(logs.path).trim(),
    },
    debug: source.debug === true,
  }
}
