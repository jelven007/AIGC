# v1.1.0 干净检出验收脚本修正

类型：reference。读者：测试、开发与发布维护者。责任：测试维护者。核验：2026-11-01。来源：两个固定提交的GitHub Actions日志、隔离工作树及实际测试结果。本记录固定本次问题和修正；后续流水线结果按实际运行ID另记。

固定构建7f6b996的两次云端检查发现验收脚本问题。前端/API与Edge均通过；首次浏览器全部通过，标签触发的浏览器重复应用提示断言失败。问题未改变任务、字幕、资金或已部署载荷。

| 问题 | 证据与原因 | 修正 |
| --- | --- | --- |
| 密钥互通临时目录缺失 | media-and-mcp的keyring_interop在全新检出报ENOENT；本地旧目录此前已存在 | 测试自己创建.volcengine-build，再创建0600夹具并通过stdin送入禁网备份镜像 |
| 重复字幕的瞬时提示断言 | 标签流程等待“原任务字幕已应用”超时；提醒可在任务刷新时清除 | 等待应用按钮恢复可用，断言任务数、保存次数与完整字幕轨道不变，验证没有重复副作用 |
| 夹具预加载路径 | HTML使用相对tests/ui地址，Vite应用根为apps/web，预加载误查应用根外路径 | 仅隔离配置将两个命名夹具模块转为受控/@fs地址，再进行HTML预处理 |

修正提交ca3a66ea09719df161658e15317510b62274d091，仅涉及tests/keyring_interop.mjs、tests/browser_edit_analysis.mjs及vite.config.ui-tests.mjs。git diff确认apps/web、services、supabase、infra和生产scripts没有变动；v1.1.0构建标签、源码摘要与两环境载荷保持。

验证：无临时目录的独立工作树复现同一ENOENT，修正后真实Edge/Python双向AES-GCM通过（v2、legacy、Unicode AAD和篡改拒绝）。11组隔离浏览器门禁通过；最后的预加载调整后单独复验模型/平台两个夹具通过，重启后没有新路径错误。隔离Vite使用固定Node22容器，本机浏览器驱动使用宿主Node24/Playwright；最终云端使用项目固定Node22。

旧失败记录：[首次主线](https://github.com/jelven007/AIGC/actions/runs/41248165564)、[标签流程](https://github.com/jelven007/AIGC/actions/runs/41249175473)。修正已非强制推送主线，新的云端完整结果从[Actions](https://github.com/jelven007/AIGC/actions?query=branch%3Amaster)独立读回并记录到本次最终报告。旧失败不会被重写为成功，最新主线通过也不冒充旧标签流程结果。
