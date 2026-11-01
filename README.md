# dsh-early-stop-guard

DSH（DeepSeek Harness）插件：当模型只叙述「接下来要做什么」而没有真的发出工具调用时，把同一个回合继续推进一步，避免任务做到一半就被判定完成。

## 问题

DSH 的 agent loop 用一条极简规则判定回合结束：

```js
const toolCalls = message.content.filter(block => block.type === 'tool-call')
if (toolCalls.length === 0) return { kind: 'completed' }
```

也就是说，只要某一步产出的是纯文本、没有工具调用，整个回合就以 `completed` 收尾。模型写一句「平台层 17 项测试全绿。接下来改 environment.ts……先读全文取准确行文。」然后停下，在这条规则下与「任务真的做完了」完全等价——回合关闭，剩下的 11 条待办不会再被推进。

这个插件只针对这一种失败模式：**末步纯文本 + 本回合更早有过工具调用 + 这段文本在承诺尚未执行的工作**。

## 怎么工作

```
agent/turn-stopping（回合仍开着）
  ├─ 读本回合自己的 session 日志 → 逐步事实（哪一步调了哪些工具、末步正文）
  ├─ 上一次 steer 是否换来了真工具调用？没有 → 本回合不再续跑
  ├─ 闸门：末步无工具调用 + 更早有过工具调用 + 正文非空
  ├─ 每回合续跑预算
  ├─ 启发式分类（wait / ask / forward / done / gray）
  ├─ 必要时问裁判链 → 三题概率
  └─ 判定 continue 时 agent.steer(提示消息) → 同一回合再跑一步
```

`agent.steer()` 把消息塞进 agent 的收件箱，回合机重读收件箱：有 steer 就再跑一步，没有才关闭回合。因此这里**不新开回合、不伪造用户消息、不给模型换上下文**，只是不让「叙述了下一步」被当作完成。

### 判定顺序（承重设计）

裁判回答三个概率：`narrates`（在承诺未完成的工作）、`asks_user`（在等人确认）、`waiting`（在等外部结果）。判定严格按 **waiting → asks_user → narrates**：

| 用例 | 期望 | narrates | asks_user | waiting |
|---|---|---|---|---|
| 「接下来改 environment.ts……先读全文取准确行文」 | 继续 | **0.946** | 0.022 | 0.024 |
| 「全部完成，已提交 3a4f2b1」 | 结束 | 0.018 | 0.023 | 0.018 |
| 「是直接改，还是先克隆一份？」 | 结束 | 0.536 | **0.961** | 0.047 |
| 「后台 job-7f2a 跑起来了，等它出结果」 | 结束 | 0.645 | 0.046 | **0.971** |
| 「现在改 deployment.ts 的路径校验。」 | 继续 | 0.874 | 0.037 | 0.019 |

后两行的 `narrates` 也在阈值之上（0.536 / 0.645）。如果先看 `narrates`，「在等你确认」「在等 CI」都会被判成继续——这正是必须把 waiting / asks_user 排在前面、且数值比较留在代码里的原因。

### 为什么不直接用普通 LLM 裁判

决策模型一次请求同时回答三个校准概率，单次约 1.2–1.4 秒、约 700 input token，比让会话模型读一遍摘要再输出 JSON 更便宜、更稳定，也更容易解释（日志里存的是概率，不是「true」）。裁判链仍然支持普通 LLM 托底。

## 安装

```bash
# 从 npm（发布后）
dsh plugin --profile web add dsh-early-stop-guard

# 本地目录开发调试
dsh plugin --profile <profile> add link:C:/Code/JS/dsh-early-stop-guard
```

安装后设置页出现 **设置 → 插件 → 早停守卫**。

## 设置页

三个面板，都在同一个标签页里：

- **策略**：总开关、每回合最多续跑次数、判定模式、三个概率阈值、注入给模型的话。改动即时保存。
- **裁判供应商链**：按顺序尝试，先成功者生效。每行可改 kind / 协议 / Base URL / 模型 / 环境变量名，可上下移动、可删除、可禁用；底部有「新增供应商」「新增 OpenAI 兼容决策模型」「新增 LLM 托底」三个按钮。
- **试判 + 判定记录**：粘贴一段正文立刻看判定结果与三题概率（新增供应商后用它验证，不用等真回合翻车）；下方是每条判定记录，含时间、动作、原因、回合、三题概率、耗时、尾部正文，可刷新与清空。

### 密钥为什么不进设置

DSH 的设置 wire 会把 `role: secret` 字段抹掉，所以「用整体覆盖的方式保存一个含密钥的数组」会把密钥删掉。本插件因此**只存环境变量名**（`apiKeyEnv`），密钥放进程环境或 `.env`：

```bash
BAMBOONODE_API_KEY=...      # 默认决策模型
OPENAI_API_KEY=...          # 自建 OpenAI 兼容决策模型时
```

## 配置

`Config` 由 schemastery 定义，设置页从 schema 自动生成；手改 `cordis.patch.yml` 也会被 `resolveConfig` 收敛回合法区间。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关掉不判定、不注入、不写日志 |
| `maxContinuations` | `3` | 每回合最多续跑次数 |
| `maxSteps` | `8` | 描述给裁判的尾部步数 |
| `maxTailChars` | `1200` | 描述给裁判的尾部正文字符数 |
| `steerText` | 见 `lib/config.js` | 注入给模型的话，包含三条合法收尾条件 |
| `dm.mode` | `auto` | `auto` 只在叙述型/灰区问裁判；`always` 灰区也问；`off` 只用启发式 |
| `dm.threshold` | `0.5` | `narrates` 达到则继续 |
| `dm.askThreshold` | `0.4` | `asks_user` 达到则结束 |
| `dm.waitThreshold` | `0.5` | `waiting` 达到则结束 |
| `dm.timeoutMs` | `12000` | 单次裁判请求上限（决策模型冷启动会慢，实测 0.45–3.7s） |
| `dm.stateChars` | `4000` | 发给裁判的 state 字符串上限 |
| `providers` | BambooNode + 当前会话 LLM | 裁判链，数组顺序即优先级 |
| `breaker.failures` | `3` | 连续失败几次后熔断 |
| `breaker.cooldownMs` | `600000` | 熔断多久 |
| `logs.enabled` | `true` | 是否落盘 |
| `logs.maxRecords` | `300` | 内存中保留的记录数 |
| `logs.path` | 空 | 空表示 `~/.dsh/early-stop-guard/events.jsonl` |
| `debug` | `false` | 每个 hook 评估都打日志（含 skip） |

### 供应商

```jsonc
{
  "id": "bamboonode",
  "label": "BambooNode System One",
  "kind": "decision",          // decision = HTTP 决策模型；llm = 复用聊天模型
  "protocol": "systemone",     // systemone | openai
  "baseUrl": "https://api.bamboonode.dev/v1",
  "model": "startlux-decision-27b-autothink",
  "apiKeyEnv": "BAMBOONODE_API_KEY"
}
```

`kind: "llm"` 的供应商走 DSH 自己的 `ctx.llm.stream`：`llmProvider` / `llmModel` 留空表示用**当前会话正在跑的模型**，填了就固定到那个路由。这就是链尾的托底。

一个供应商连续失败 `breaker.failures` 次后进入冷却，冷却期内不再发请求——一个挂掉的端点只花一次超时，而不是每个回合各花一次。

## 日志

默认 `~/.dsh/early-stop-guard/events.jsonl`，一行一条：

```jsonc
{"id":7,"ts":1760000000000,"sessionId":"session-…","turn":3,
 "act":"continue","reason":"narrated","kind":"forward","steps":4,
 "text":"接下来改 environment.ts…","userRequest":"把平台层跑通",
 "verdict":{"narrates":0.946,"asksUser":0.022,"waiting":0.024},
 "provider":"bamboonode","latencyMs":1240}
```

`act` 取值：`continue`（续跑了）、`stop`（放行，回合正常结束）、`skip`（形状不对，`debug` 时才记）。`reason` 取值：`narrated`、`wait-external`、`needs-user`、`done`、`wait`、`ask`、`gray`、`not-narrated`、`forward-denied`、`forward(no-judge)`、`budget-exhausted`、`steer-produced-no-tool-call`、`empty-text`、`last-step-called-tool`、`no-tool-in-turn`、`no-steps`。

## HTTP 接口

设置页读的四个路由（`ctx.connection.fetch.register`，headless profile 无 Connection 服务时自动不注册）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/early-stop-guard/status` | 生效配置、供应商、熔断状态、日志位置 |
| GET | `/api/early-stop-guard/logs?limit=100` | 判定记录，最新在前 |
| POST | `/api/early-stop-guard/logs/clear` | 清空 |
| POST | `/api/early-stop-guard/test` | 用一条正文跑一次真实裁判链 |

## 边界

这个插件**只**处理「正常结束但半途」这一种情况，刻意不做下面这些：

- 不处理 `error` / `interrupted` / `max-tokens` 结束的回合（那是重试/恢复类插件的地盘）。
- 不跨回合续跑：steer 只延长当前回合。
- 不判断「任务是否真的完成」：那是完成度门禁类插件（跑测试、查证据）的活。
- 裁判不可达时**不放行叙述**：宁可结束也不在没证据的情况下续跑。
- 一次 steer 若没换来任何工具调用，本回合立刻收手，不再烧预算。

链尾用当前会话 LLM 托底时，裁判调用与 agent 共用同一份额度，请按需开关。

## 开发

```bash
pnpm install
pnpm test        # node:test，77 个用例
```

目录：

```
lib/config.js     Config schema、默认供应商、resolveConfig 收敛
lib/events.js     从 session 事件流重建本回合逐步事实
lib/heuristics.js precheck / classifyText / heuristicAction / verdictAction
lib/summary.js    给裁判的摘要与 state，超长取两端
lib/providers.js  决策模型与 LLM 两种裁判、熔断、按序尝试
lib/decide.js     整条判定链（可单测，无宿主依赖）
lib/logs.js       内存环形 + JSONL 追加
lib/index.js      钩子与 HTTP 路由接线
lib/client.js     设置页（浏览器半）
```

## 许可

MIT
