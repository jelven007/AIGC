# 历史 Git 交付说明

2026-11-01 勘误：旧源仓库远端说明已退出当前交付流程。当前源码仓库是 `aigc`；工作区外层另一个 Git 仓库不是应用发布仓库。

应用当前用户远端包括 `github`（GitHub AIGC）及用户 Gitee 仓库，实际状态通过 `git remote -v` 和 `git branch -vv` 核对。仅获明确提交/推送指令后逐项审阅、暂存和执行，不混入并行开发、Secrets 或私有运行材料。

本文属于归档，不是当前发布指南。现行规范见 [AGENTS](../../../AGENTS.md)、[版本管理](../../releases/VERSION_MANAGEMENT.md) 和 [源内容清理记录](../../releases/SOURCE_CLEANUP_20261101.md)。
