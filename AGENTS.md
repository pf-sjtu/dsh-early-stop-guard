# AGENTS.md — dsh-early-stop-guard

面向在本仓库动手的开发者/代理。人类向的说明在 `README.md`，这里只写「改代码前必须知道的约束」。

## 这个仓库解决什么

DSH 的 agent loop 在「某一步产出纯文本且没有 tool-call」时立刻把回合判为 `completed`（`@deepseek-ai/dsh-agent-loop` 的 `assessTurn`）。模型写一句「接下来改 X」然后停下，回合关闭，任务停在半途。

本插件挂 `agent/turn-stopping`（回合还开着时唯一可用的钩子），读本回合自己的事件流，判断末步是不是「承诺了未执行的工作」，是则 `agent.steer()` 注入一条提示，让同一回合再跑一步。

## 架构（一个回合的判定链）

```
ctx.on('agent/turn-stopping')
  → readEvents(agent.session)            lib/events.js   事件流快照（snapshotEvents() ?? events）
  → summarizeTurn(events, turn, maxSteps) lib/events.js   逐步事实 + 末步正文 + 人类请求
  → decideTurn({...})                    lib/decide.js   整条判定链，纯函数式，可单测
      ├ pendingProbe 校验上一次 steer 是否换来真工具调用
      ├ precheck                          形状闸门（无步 / 末步有工具 / 本回合无工具）
      ├ 预算                              maxContinuations
      ├ classifyText + heuristicAction     lib/heuristics.js  正则形状 → continue / stop / ask
      ├ askChain → verdictAction           lib/providers.js + lib/heuristics.js  三题概率 → 判定
      └ record                            日志记录
  → act === 'continue' ? agent.steer(createUserMessage(...)) : 放行
```

## 不可违反的不变量

1. **判定顺序 waiting → asks_user → narrates。** 实测：在等外部结果的消息 `narrates=0.645`，在等人确认的 `narrates=0.536`，都在 0.5 阈值之上。先看 `narrates` 会把「等你确认」判成继续。见 `lib/heuristics.js` 的 `verdictAction` 与 `test/heuristics.test.js`。
2. **数值比较留在代码里。** 决策模型（System One）会把 `above 0.5` 读成 `>= 0.5`，阈值必须由 `verdictAction` 比较，不能写进 prompt。
3. **裁判不可达时不放行叙述。** `askChain` 返回 `verdict: null` 时退回 `stop`（reason `xxx(no-judge)`），不在没证据时续跑。
4. **一次 steer 没换来工具调用就收手。** `pendingProbe` 记录 steer 时的事件长度，下个 turn-stopping 用 `sawToolCallSince` 校验；没换来则本回合 `exhausted`。
5. **续跑只延长当前回合。** 只用 `agent.steer()`；不新建回合、不伪造 `user/message`、不改 agent 的模型或上下文。
6. **密钥不进设置。** DSH 的设置 wire 会抹掉 `role: secret` 字段，整体覆盖数组会删掉密钥；因此供应商只存 `apiKeyEnv`（环境变量名），密钥走进程环境。见 `lib/config.js` 的 `ProviderConfig.apiKeyEnv` 注释。
7. **配置一律经 `resolveConfig` 收敛。** 手改 `cordis.patch.yml` 能绕过 schemastery 校验，钩子里只读 `resolveConfig()` 的结果。
8. **钩子路径上不得抛错。** 判定链任何异常都只影响本回合的续跑，不能让 turn-stopping 失败（那会卡住用户的回合）。新增分支要放进 `decideTurn`，由它返回 `stop`，不要在 `index.js` 里扔。

## 模块职责

| 文件 | 职责 | 依赖宿主 |
|---|---|---|
| `lib/config.js` | Config schema、默认供应商、`resolveConfig` 收敛、`QUESTIONS` 三题定义 | 仅 schemastery |
| `lib/events.js` | 事件流读取与 `summarizeTurn`/`sawToolCallSince` | 无 |
| `lib/heuristics.js` | `precheck`/`classifyText`/`heuristicAction`/`verdictAction` | 无 |
| `lib/summary.js` | `clipTail`/`renderSummary`/`renderState` | 无 |
| `lib/providers.js` | System One、OpenAI 兼容、宿主 LLM 三种裁判，熔断，按序尝试 | `ctx.llm`（仅 llm 供应商，动态 import） |
| `lib/decide.js` | 整条判定链，返回 `{ act, record, exhausted, nextUsed }` | 无（`ctx` 透传） |
| `lib/logs.js` | 内存环形 + JSONL 追加 | node:fs |
| `lib/index.js` | 钩子接线、HTTP 路由（`/api/early-stop-guard/*`） | cordis、`ctx.connection` |
| `lib/client.js` | 设置页浏览器半（`window.__ModuleLoader__`） | 浏览器 |

改判定逻辑 → 只动 `lib/decide.js` / `lib/heuristics.js`；改接线 → `lib/index.js`；不要把判定写回钩子里。

## 宿主 API 依赖（升级 dsh 先核对这几处）

- `agent/turn-stopping`：`ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => …)`；在此 `agent.steer(msg)` 会多跑一步，不 steer 则回合关闭。
- `agent.steer(message)`：返回 `void`。
- `createUserMessage({ content, source })`：来自 `@deepseek-ai/dsh-llm`；`source: { kind: 'plugin', plugin: name }`。
- `ctx.llm.stream({ provider, model, system, messages, maxTokens, temperature, signal })` + `BlockAssembler`：`llm` 类裁判用。
- 设置页：`Config`（schemastery）由宿主自动生成表单；浏览器半用 `ctx.configForms.get(<entry id>)` 取 `ConfigForm`（`getSnapshot/subscribe/set`），往 `settings.plugins.tab` 注册标签页。
- HTTP：`ctx.connection.fetch.register({ path, methods, fetch })`，headless profile 无该服务，必须 `ctx.inject(['connection'], …)` 包起来。

## 测试

```bash
pnpm test          # node --test，59 个用例
```

- 单测覆盖：`heuristics`（闸门/分类/判定矩阵）、`events`（重建事实、窗口、锚定请求）、`summary`（截断、标签）、`config`（默认值/收敛/供应商过滤）、`providers`（答案归一化、JSON 提取、熔断）、`logs`（环形、JSONL、hydrate、clear）、`decide`（整链，含 stub fetch 校验 System One 线格式）。
- 新增判定分支必须同时补 `test/decide.test.js` 的用例；改动阈值/顺序必须更新 `test/heuristics.test.js` 里的校准数值。
- 真实链路验证在隔离 profile 做：`dsh plugin --profile <name> add link:C:/Code/JS/dsh-early-stop-guard`，不要在别人正在用的 web profile 上试。

## 发布

- 包名固定 `dsh-early-stop-guard`，`dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh.client.platform = web`。
- `peerDependencies` 的 `@deepseek-ai/dsh-*` 必须与目标 dsh 运行时版本对齐（版本不符会被 `dsh plugin add` 拒绝安装）。
- `files` 白名单必须包含 `lib/*` 全部模块与 `cordis.patch.yml`；新增模块记得加进去。
- 仓库内禁止出现任何密钥：只保留 `apiKeyEnv` 名称，示例见 `README.md`。
