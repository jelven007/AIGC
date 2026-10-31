# 开发指南

类型：tutorial。读者：新加入的开发者与维护者。责任：开发维护者。核验：2026-11-01。来源：package.json、pnpm-lock.yaml、Vite配置、infra/development/compose.yaml、scripts/dev_environment.py。工具链或路径变更时复核；干净检出无法按步骤启动/构建即过期。

## 固定开发入口与环境矩阵

| 环境 | 启动与身份 | 用途 |
| --- | --- | --- |
| 开发5173 | python3 scripts/dev_environment.py run；Node22.23.4/pnpm10.34.5固定镜像与依赖卷 | 真实开发后端、源码热更新 |
| 隔离UI5197 | pnpm test:browser；vite.config.ui-tests.mjs、Playwright1.60.0、内存后端 | 可复现布局、草稿和交互门禁 |
| 本地自托管 | scripts/self_hosted.py；源码外state、linux/arm64镜像 | 独立压缩前端/Edge与原数据升级接受 |
| ECS | 同一前端/Edge，linux/amd64镜像 | 正式HTTPS与容量配置接受 |

在仓库根执行：

```sh
python3 scripts/dev_environment.py check
python3 scripts/dev_environment.py run
python3 scripts/dev_environment.py status
python3 scripts/dev_environment.py restart
python3 scripts/dev_environment.py stop
```

开发脚本验证公开配置和后端Auth，命名卷隔离Linux依赖与宿主。配置变更后再次run以重新应用环境；单纯restart旧容器不会刷新变量。使用TRAE Run入口时复用相同脚本。

宿主安装匹配工具链时：

```sh
node --version
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
pnpm dev
```

公开配置是URL/anon或publishable key及正式条款/隐私URL；支持服务端用户名登录时设置VITE_USERNAME_LOGIN=true，只表达能力，不包含身份值。service_role、模型/支付/Worker/主密钥只进入服务端受控配置。

## 修改入口

前端在apps/web/src，@/映射到此目录；页面按业务域，API/lib/types不反向依赖UI。媒体在services/media-worker，工具在services/mcp，基础设施在infra。Node/Deno只共享显式纯契约，不从服务端导入执行能力。数据库变更加新迁移，不能改已应用SQL。

统一标题、操作区、控件与提醒遵循[页面规范](UI_STANDARDS.md)。脚本草稿校验原账号/版本与有效内容，通知走浮层；旧异步结果不得在账号切换后写入。模型接口16槽与第三方集成4槽独立展示，保留服务端只读权限。

## 验证与提交

```sh
pnpm check:structure
pnpm typecheck
pnpm lint
pnpm build
pnpm test:release
pnpm test:browser
python3 scripts/check_sensitive_content.py
```

Node22轻量镜像没有Python，混合测试分配给相应运行环境。PG测试使用隔离Docker数据库；媒体和MCP按锁构建并运行真实处理。完整门禁和本轮证据见[测试计划](../testing/TEST_PLAN.md)。

修改功能时同步PRD/API/测试与专项文档；提交前审阅暂存差异，基于清理后的远端主线保留并行更新，不强推。测试只使用隔离夹具，真实初始化凭据来自源码外0600文件。不得跳过Git钩子或把密钥/生产日志纳入提交。

发布从固定提交构建一次，分别验证开发、本地部署、ECS真实页面及载荷/原数据；构建通过不能代替运行接受。关联：[目录](PROJECT_STRUCTURE.md)、[接口](API_AND_DATA.md)、[版本](../releases/VERSION_MANAGEMENT.md)。
