# 已知过期 / 已知未验证

本文件不是 `verify.md` 的一部分。它列出**已知与当前代码不匹配**的能力声明，以及
**明确知道但没做**的事。目的是让 `node scripts/verify-freshness.js --strict` 的失败
可解释：每一条红灯都能在这里找到编号和理由，而不是靠口头记忆。

规则：

- 该修的修，修完删除对应条目，不要留着当免责声明。
- 条目必须写清「谁在什么条件下能解除」，否则等于永久豁免。
- 本文件不提供任何授权，不影响门禁判定。

## STALE-1 · Layer 4 的 native deny 结论未在 37537e9 之后重跑

- **状态**：结论大概率仍成立，但没在当前代码上复测。
- **为什么**：Layer 4 量的是 Claude Code 原生 `permissions.deny` 的行为，不依赖本仓
  hook；但 `bashGuard` 在 37537e9 被重写，脚本按规则判定过期是正确的。
- **解除条件**：按 `docs/verify.md` Layer 4 三条 prompt 在 2.1.x 上重跑一遍，
  确认「native deny 在 bypass 下生效、但 agent 能改掉 settings.json 绕开」，
  然后把该 block 的 `verified:at` 更新到重跑时的提交号。
- **风险**：低。即使发生变化，也只影响 README FAQ 里的一句话表述，不影响门禁行为。

## UNVERIFIED-1 · 插件路线的 `claude plugin update` 是否能推 hook 变更

- **状态**：未验证。
- **为什么**：`plugin.json` 带 `version`，按官方行为推测需要 bump 版本号才会更新；
  但没有实测「不 bump 就 update 会怎样」。
- **解除条件**：发一版只改 hook 不 bump version 的测试 tag，跑 `claude plugin update`
  看是否拉取；或在发布流程里固定「改 hook 必 bump version」并把这句写进 CONTRIBUTING。
- **风险**：中。若真的不更新，已装用户会一直跑旧 hook —— 而这正是 v0.2.1 修安全漏洞时
  最怕的情况。

## UNVERIFIED-2 · 端到端在 CI 里从未真正跑过（且不打算由本仓提供密钥）

- **状态**：本机跑过多次（2.1.323 / 2.1.327），CI 从未跑过。
- **为什么**：`e2e.yml` 需要 `ANTHROPIC_API_KEY` secret，本仓**有意不配**。
- **为什么不配**（决定，不是待办）：这是开源项目，密钥是使用者自己的成本，维护者没有
  义务为本仓配置者的使用付费。任何 clone 本仓的人都能用**自己的**密钥跑同一条工作流。
- **当前行为**：`schedule` 触发且没有 key → **跳过并给 notice**（不失败）；
  `workflow_dispatch` 手动触发且没有 key → **失败**（说明你打算跑但没配好）。
  二者区别的理由：定时任务没人请求，每周发一封无法处理的失败邮件只会让人把通知静音，
  而静音后的通道比没有通道更糟——它看起来像有覆盖，实际什么也没送。
- **谁能解除**：任何 fork 本仓并配上自己密钥的人。配好后手动触发一次 `e2e`，三条断言变绿。
  本仓的这条记录因此**永久保留**，不是欠账。
- **风险**：中。`gate.yml` 的绿勾只覆盖协议层，任何人都可能把绿勾读成「端到端过了」——
  所以 `gate.yml` 里那个 job 名字直接写「end-to-end is NOT covered here」，
  README 的 CI 说明段也写了同一句话。

## KNOWN-LIMIT-1 · shell guard 仍有 4 条实测绕过

见 `docs/verify.md` 的棘轮表。用 `KNOWN_GAP_COUNT` 锁定，只许降不许升。
解除条件：修掉一条就把计数下调，直到表为空。
