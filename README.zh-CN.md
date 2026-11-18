# 人主导门禁（human-led-gate）

[![gate](https://github.com/lijizhi/human-led-gate/actions/workflows/gate.yml/badge.svg)](https://github.com/lijizhi/human-led-gate/actions/workflows/gate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**给 AI 编码代理的编辑前权限门禁 —— 以及它所执行的协作流程。**

「AI 提方案、人点确认」不是人主导：方案空间被 AI 画出来的那一刻，人就已经只是在按按钮了。而按钮是会被无脑点的。

本仓库把人的决定做成**技术上强制**的东西：

- `hooks/pretooluse-gate.js` — Claude Code 的 `PreToolUse` hook，对批准范围之外的一切 Edit/Write **在发生之前直接 deny**。不是提示词里的礼貌提醒，是工具层的拒绝。
- `.humanled/approvals.json` — 人的授权清单。只有人能改：hook 会拦住代理改门禁自身的动作——Edit 拦，`rm`、重定向、`sed -i` 这些 shell 侧门也拦。
- `skills/human-led-development/` — 门禁背后的分阶段流程：INIT → MODULE_CONFIRM → PUBLIC_RISK_SCAN → DESIGN_CONFIRM → SKELETON_REVIEW → CODING → ACCEPTANCE → FINAL_REVIEW，每个断点都由人拍板。

### 安装方式一：Claude Code 插件（推荐）

本仓库本身就是插件市场，按名字安装，后续可原地升级：

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

然后在要被门禁保护的项目里放一份 `.humanled/approvals.json`（复制 `templates/approvals.json`）。这个文件就是人手里的授权清单，也是**不能盲装**的原因：**没有授权文件，门禁 fail-closed，拒绝一切写入。**装错仓库，那个仓库在文件补齐之前会拒绝所有编辑——这是设计生效，不是 bug。

### 安装方式二：不走插件系统（任意客户端，git 检出）

```bash
git clone https://github.com/lijizhi/human-led-gate
cd 你的项目根目录
node /path/to/human-led-gate/bin/humanled.js init
```

*（未发布 npm——有意为之。这里写 `npx` 就是假的，而本项目的全部可信度来自「只说真话」。）*

## 关键演示

![门禁在 bypass 模式下拒绝越权写入](docs/demo.gif)
*2026-11-13 真实运行记录的逐字回放渲染（Claude Code 2.1.323；复现命令见 [docs/verify.md](docs/verify.md)）。*

装好门禁、并且开着 `--dangerously-skip-permissions`（对，就是这个模式——按官方文档，PreToolUse 的 deny 在所有权限模式下都生效）之后，对 agent 说「创建 sneaky.ts，不许问」：

```
[human-led-gate] DENIED: "sneaky.ts" is not in any approved task scope.
...To grant: the human edits .humanled/approvals.json (the agent may not).
```

agent 当场停下、拒绝自己改授权文件、转人来批。已在 Claude Code 2.1.323（Windows）实测，命令与结果见 [`docs/verify.md`](docs/verify.md)。

## 和 AGENTS.md 规则集的区别

规则是上下文，上下文会失效：会话一长、模型一换、agent 一自信，「请不要修改检查器」就会被重新理解成建议。GitHub 上有几百个优秀的规则仓库，没有哪一个能*拒绝一次工具调用*。规则告诉模型你偏好什么；门禁让越界写入根本无法单方面发生。

## 能力矩阵——诚实，因为这正是本项目的立场

| 客户端 | 编辑前拦截 | 状态 |
|---|---|---|
| Claude Code 2.1.x | ✅ 端到端实测（含 bypass 模式） | 2026-11-13，见 `docs/verify.md` |
| Codex / Gemini CLI | ❌ 本版未提供等价 hook | 未强制，仅流程 |
| Cursor | ❌ rules 只是上下文 | 只装了指针，文件里写明了 |
| 远端 CI / 合并保护 | ❌ 不在范围内 | 那是分支保护该干的 |

门禁防的是**代理**，不是这台机器的主人。威胁模型就一句话：你的 AI 给自己发许可证。

## 许可

MIT
