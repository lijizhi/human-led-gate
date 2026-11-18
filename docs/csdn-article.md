# 给 Claude Code 装上真正能"说不"的门禁：越权改代码，在发生之前就被拒绝

> 开源地址：https://github.com/lijizhi/human-led-gate
> （本文所有结论都有可复现命令，不靠嘴。）

## 先说一个不舒服的事实

「AI 提方案、人点确认」——很多人以为这就是人主导开发。错。**方案空间被 AI 画出来的那一刻，人就已经只是在按按钮了**，而按钮是会被无脑点的。

更难受的是第二层：你把一堆规则写进 AGENTS.md / CLAUDE.md——"不要动检查器"、"提交前必须等我确认"——会话一长、模型一换、它一自信，这些句子全被重新理解成"建议"。GitHub 上有几百个优秀的规则仓库，**没有哪一个能拒绝一次工具调用**。规则告诉模型你偏好什么；偏好拦不住手。

## 这个项目做的事：把"不同意"做成技术强制

一个 Claude Code 的 `PreToolUse` hook：凡是 **Edit/Write 不在人批准的范围内，在写入发生之前直接 deny**。不是日志里事后告诉你，是这次工具调用就过不去。

核心就两个文件：

- `hooks/pretooluse-gate.js` —— 零依赖，约 170 行，读 hook 输入、比对授权、返回 deny
- `.humanled/approvals.json` —— 你手里的人肉授权清单。**agent 不许碰它**：想通过 Edit 改？拦。想 `rm`、`sed -i`、重定向这些 shell 侧门绕过？也拦。授权文件损坏或丢失？fail-closed，一切写入默认拒绝。

按 [Claude Code 官方文档](https://code.claude.com/docs/en/hooks-guide)，PreToolUse 的 deny 在**所有权限模式下生效——包括 `--dangerously-skip-permissions`**。我在 Claude Code 2.1.323 实测过：开着 bypass 模式命令它"立刻创建 sneaky.ts，不许问"，它停下来，明确回复"我不能创建，也**不能**自己去改 approvals.json，请你来批准"。

（此处插入 GIF：docs/demo.gif，在 GitHub 仓库 README 首屏）

## 它不只是拦截，背后的流程才是重点

门禁强制执行一套九阶段协议（完整在 `skills/human-led-development/SKILL.md`）：

INIT（人说目标）→ MODULE_CONFIRM（定模块归属）→ PUBLIC_RISK_SCAN（只读取证公共影响）→ DESIGN_CONFIRM（人拍板方案）→ SKELETON_REVIEW（人批准方案版本+编码范围）→ CODING（分块实现，持续比对授权）→ ACCEPTANCE（人验收，AI 自检≠验收）→ FINAL_REVIEW（复盘沉淀）

配套几条我认为最关键的规则：

1. **"好的/继续/你看着办"只在紧邻单一问题时算批准**——堵住语义扩张
2. **AI 起草 ≠ 授权决策 ≠ 授权编码**，三件事分开
3. **无法确定是否属于局部实现细节时，停止并询问**——这条必须原样保留
4. 提交、推送、MR、发布**分别另行授权**

## 一分钟装到你项目里

```bash
git clone https://github.com/lijizhi/human-led-gate
cd 你的项目根目录
node /path/to/human-led-gate/bin/humanled.js init
```

安装器幂等：已有 settings.json 就合并 hook 不覆盖你的配置。装完先跑 `docs/verify.md` 里的验证矩阵再信任它——这是本项目自己的立场：**能力矩阵逐客户端标"已验证/未验证/不强制"，不宣称做不到的事**。

## 诚实边界（比吹牛重要）

| 客户端 | 编辑前拦截 |
|---|---|
| Claude Code 2.1.x | ✅ 端到端实测（含 bypass 模式） |
| Cursor / Codex | ❌ 本版只有流程规则，无强制 |
| 远端 CI / 合并保护 | ❌ 不在范围，那是分支保护的活 |

门禁防的是**你的 AI 给自己发许可证**，不防这台机器的主人。MCP 自有写接口的工具、以及 2027 年后 npm 这类平台政策变化，README 里都写了"未验证"而不是"已覆盖"。

## 为什么值得看一眼

- 你被"AI 说做完了其实没做完"、"顺手改了不该改的文件"坑过
- 你在团队里推 AI 编码，需要"人真正在决策"的可举证流程
- 你想抄一套经过实测的 PreToolUse deny 模式（hook 单文件，MIT）

Issues 敞开：Codex/Gemini CLI 的等价 hook、中心化策略下发，是 roadmap 上讨论最多的两项。

**→ https://github.com/lijizhi/human-led-gate** 觉得有用点个 Star，就是对这类"脏活累活"最好的鼓励。
