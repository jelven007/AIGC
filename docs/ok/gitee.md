# Git远端与文档交付

更新：2026-10-21。当前仓库origin为原作者xiaoye66/shoproai，用户远端aigcp为jelven007/aigcp，github为jelven007/AIGC；实际地址/分支以git remote -v与git status为准，不用远端名称推断已完成同步。

修改后先审阅差异与范围，本地中文提交；确认远端归属与内容再推送。存在并行开发时显式暂存本轮文件，不使用git add .混入未完成源码/Secrets。凭据/本地部署文件受Git忽略，但仍核对跟踪列表。

只读状态命令：git status --short --branch、git log -5 --oneline、git remote -v。远端更新用git ls-remote aigcp；远端为空或尚未推送，不宣称本地提交已经同步。当前master跟踪origin/master，不直接用裸git push把变更发给原作者。

本轮只读确认aigcp/master位于ce90bfe，尚未包含本轮文档提交；不据此推断github分支相同。后续同步指定用户远端和本地分支，不采用旧教程的双pushurl自动写两个仓库。

仅在获授权后向用户远端明确推送本地分支；本轮文档更新采用本地提交并确认远端状态。Git提交规范见 [AGENTS](../../AGENTS.md)，文档入口见 [README](../README.md)。
