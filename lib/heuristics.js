/**
 * Deterministic evidence gates and the decision rules built on them.
 *
 * The guard has one expensive resource: a model call on the turn-stopping path,
 * which would otherwise add latency to every ordinary reply. So the cheap
 * regexes run first and are allowed to *end* a turn on their own, while the one
 * failure mode this plugin exists for — a narration of pending work — is
 * confirmed by the decision model.
 *
 * @module dsh-early-stop-guard/heuristics
 */

/** Trailing text that says the turn is parked on something external. */
const WAIT_RE = new RegExp([
  '等待', '等在', '等它', '等结果', '等完成', '等这个', '等那个', '轮询',
  '正在(跑|运行|执行|构建|下载|安装|编译|部署)',
  '跑起来了', '已(在后台|启动|派发)', '后台(任务|作业|命令|进程|job)',
  'waiting (?:for|on)', 'wait (?:for|until)', 'running in (?:the )?background',
  '(?:job|build|task) [\\w-]+ (?:is |has been )?(?:running|started)',
  'still (?:running|building|downloading)',
].join('|'), 'i')

/** Trailing text that hands control back to the human. */
const ASK_RE = new RegExp([
  '[?？]\\s*$',
  '[吗么][。！!]?\\s*$',
  '是否需要', '要不要', '是否要', '你希望', '请确认', '请选择', '需要我', '等你(确认|回复|决定)',
  'confirm', 'shall i', 'should i', 'do you want', 'which (?:one|option)', 'let me know',
].join('|'), 'i')

/** Trailing text that promises work the step list did not perform. */
const FORWARD_RE = new RegExp([
  '接下来', '下一步', '下面(?:我)?(?:要|来|将|去)', '随后', '紧接着', '然后(?:我)?(?:去|改|读|跑|再)',
  '先(?:读|看|改|去|跑|做|确认)', '我(?:先|来|将|会|要|这就|现在)',
  '现在(?:去|改|读|跑|执行|开始)', '马上', '开始(?:修改|实现|处理|编写)',
  'next[,\\s]', 'now i', 'let me', "i'll (?:now )?(?:check|look|read|update|fix|run|add|write|apply)",
  'first,? (?:i|let me)',
].join('|'), 'i')

/** Trailing text that reports finished work. */
const DONE_RE = new RegExp([
  '已完成', '完成了', '全部(?:通过|完成|就绪)', '测试(?:通过|全绿|成功)', '构建成功', '已提交',
  '提交为', '完毕', '收工', 'all tests? pass', 'everything (?:passes|works)', '\\bdone\\b', '\\bfinished\\b',
].join('|'), 'i')

/**
 * Decide whether a turn's shape is worth judging at all.
 *
 * Rejects the three shapes that can never be the failure mode this plugin
 * guards: no steps, a last step that already called a tool, and a turn that
 * never called a tool (a plain question answered in one step).
 *
 * @param summary - facts from `summarizeTurn`.
 * @returns whether the guard should look at the trailing text.
 */
export function precheck(summary) {
  const steps = summary?.steps ?? []
  if (steps.length === 0) return { pass: false, reason: 'no-steps' }
  const last = steps[steps.length - 1]
  if ((last?.tools?.length ?? 0) > 0) return { pass: false, reason: 'last-step-called-tool' }
  const earlierTools = steps.slice(0, -1).some(step => (step?.tools?.length ?? 0) > 0)
  if (!earlierTools) return { pass: false, reason: 'no-tool-in-turn' }
  const text = summary.text?.trim() ?? ''
  if (!text) return { pass: true, reason: 'empty-text', empty: true }
  return { pass: true, reason: 'narration' }
}

/**
 * Classify the trailing text into the shape the decision rules branch on.
 *
 * Order is deliberate and mirrors the probabilities the decision model
 * produces: a message that waits or asks also scores high on narration, so
 * waiting and asking are matched first.
 *
 * @param text - trailing assistant text of the turn.
 * @returns one of `wait`, `ask`, `forward`, `done`, `gray`.
 */
export function classifyText(text) {
  const value = typeof text === 'string' ? text : ''
  if (WAIT_RE.test(value)) return 'wait'
  if (ASK_RE.test(value)) return 'ask'
  if (FORWARD_RE.test(value)) return 'forward'
  if (DONE_RE.test(value)) return 'done'
  return 'gray'
}

/**
 * First-pass decision, made without any network call.
 *
 * @param kind - shape from {@link classifyText}.
 * @param mode - `dm.mode`: `auto`, `always`, or `off`.
 * @param empty - whether the trailing step carried no text at all.
 * @returns `{ act, reason }` where `act` is `continue`, `stop`, or `ask`.
 */
export function heuristicAction(kind, mode, empty = false) {
  // A step that produced no text at all still silently ended the turn; there is
  // nothing to judge, and one more step is the cheapest way to find out.
  if (empty) return { act: 'continue', reason: 'empty-text' }
  if (mode === 'off') {
    return kind === 'forward'
      ? { act: 'continue', reason: 'forward-intent(no-dm)' }
      : { act: 'stop', reason: `${kind}(no-dm)` }
  }
  if (kind === 'forward') return { act: 'ask', reason: 'forward-intent' }
  if (kind === 'gray' && mode === 'always') return { act: 'ask', reason: 'gray-band' }
  return { act: 'stop', reason: kind }
}

/**
 * Apply a decision model's three probabilities.
 *
 * The order is the whole point of the guard: `waiting` and `asks_user` win over
 * `narrates`, because a message that asks or waits also narrates pending work.
 *
 * @param verdict - `{ narrates, asksUser, waiting }` probabilities in `[0,1]`.
 * @param policy - resolved `dm` config.
 * @param fallbackKind - heuristic shape, used to name the reason.
 * @returns `{ act, reason }`.
 */
export function verdictAction(verdict, policy, fallbackKind = 'gray') {
  const waiting = Number(verdict?.waiting)
  const asksUser = Number(verdict?.asksUser)
  const narrates = Number(verdict?.narrates)
  if (Number.isFinite(waiting) && waiting >= policy.waitThreshold) {
    return { act: 'stop', reason: 'wait-external' }
  }
  if (Number.isFinite(asksUser) && asksUser >= policy.askThreshold) {
    return { act: 'stop', reason: 'needs-user' }
  }
  if (Number.isFinite(narrates) && narrates >= policy.threshold) {
    return { act: 'continue', reason: 'narrated' }
  }
  if (fallbackKind === 'forward') return { act: 'stop', reason: 'forward-denied' }
  return { act: 'stop', reason: 'not-narrated' }
}
