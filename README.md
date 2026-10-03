# Dev Container

独立 Electron 游戏开发宿主。每个进程承载一个目标游戏目录，提供多客户端分屏预览、按游戏管理的账号身份。技术栈沿用 RoboTimes：pnpm workspace、TypeScript、Electron 42.6.0、electron-vite、Vue、Vuetify、Dockview 和 electron-builder。

## 启动

在 workspace 根目录执行：

~~~powershell
pnpm install
pnpm build
pnpm start --game U:\Repos\Bluesquall\RoboTimes
pnpm dev --game U:\Repos\Bluesquall\RoboTimes
pnpm typecheck
node --run lint
node --run lint:fix
node --run check
pnpm test
node --run pack:win
node --run dist:win
~~~

也可以从目标游戏目录运行 Windows 包：

~~~powershell
& 'path\Dev Container.exe' --game 'path\game'
~~~

`pnpm start probe --game 'path\game'`（Windows 包使用 `Dev Container.exe probe --game 'path\game'`）查询该目录是否已有实例。stdout 为 `{"running":true/false}`；退出码 0 表示正在运行，1 表示没有实例，2 表示查询失败（stderr 含原因）。查询不读取游戏配置，不打开或唤起窗口。

不传 --game 时采用进程当前目录。一个目标目录只能运行一个实例；其他目标目录可以独立运行。启动器不会启动游戏服务器或编辑器，预览服务须自行启动。

Windows 输出位于 packages/dev-container/.deploy/dist/，目录包为 win-unpacked，ZIP 包由 dist:win 生成。

本地 launcher 使用仓库安装的 Electron 直接运行 packages/dev-container 的开发构建，不依赖 Windows 打包产物。修改代码后执行 node --run build 更新开发构建；日常验证不需要 pack:win 或 dist:win。

## 游戏配置

游戏配置入口是目标游戏目录下的 dev-container.config.yaml，见 [完整示例](examples/dev-container.config.yaml)。缺失或校验失败时，窗口显示配置文件的绝对路径和具体错误。

- game.id 是稳定的数据隔离标识，game.title 为显示名称。
- client 整段可省略。client.dir 默认配置文件所在目录（相对路径也以此为基准，支持绝对路径）；client.subpath 默认为空，使用 Vortex 原生预览 `/`，例如 `super-preview` 使用 `/super-preview`。subpath 只接受路径，不接受完整 URL、查询参数或 fragment。
- launch.schema 仅接受外置 JSON 文件路径，相对路径以 YAML 所在目录为基准，支持绝对路径；省略 launch 表示没有启动参数。JSON 使用 draft-07 的平铺对象子集，根支持 $schema/type/properties/required/additionalProperties；$schema 可省略，指定时为 http://json-schema.org/draft-07/schema#，additionalProperties 必须为 false。字段支持 string/number/integer/boolean，以及 enum/default/x-default-env/title/description/minimum/maximum/minLength/maxLength。拒绝嵌套对象和不支持的关键字，无效默认值也会报错。
- schema 字段名直接成为 URL 参数名，例如 --fullFlow 或 scene；表单显示 title。字段默认值来自 JSON 的 default 或 x-default-env；表单显示默认值叠加手动覆盖，状态只保存手动覆盖和明确取消的选填字段，不把默认值固化。旧参数状态与新 schema 不兼容时显示校验原因，点击“恢复默认”只重置启动参数，不改名或改动用户绑定。取消选填字段后省略该 URL 参数，false 和 0 会保留。通过客户端标题栏的设置按钮打开启动配置，参数修改后点击“保存并重启”应用。

Vortex 内部扩展从 `<客户端目录>/temp/editor-session.json` 读取 schemaVersion、server.port 和 editor.pid，校验编辑器仍在运行，再检查预览可访问。每次新建、刷新或切换用户都重新读取；已有客户端不会自动重启，端口不写回 YAML，也不保存为下次启动的地址来源。session 缺失、损坏、端口无效、编辑器已退出或预览不可达时，客户端显示具体路径与错误，可在修正后重试，用户管理与偏好设置继续可用。

app 启动时固定读取目标游戏目录（dev-container.config.yaml 所在目录）的 .env 和 .env.local，后者覆盖前者；文件可不存在。不读取进程已有环境变量，不搜索 client.dir 或 schema 所在目录，不向 process.env 注入任何值，也不加载 mode 文件。文件使用 Node 的 .env 语法，值为字符串，不做 $变量插值。

字段通过 x-default-env 指定默认值来源，不能同时声明 default。string 保留解析后的字符串；boolean 仅接受 true/false；number/integer 转换后必须为有限数值，再通过字段的整数、范围、枚举和长度约束。绑定变量缺失或无效时，诊断包含配置/schema 路径、字段及变量名；不会静默使用固定值。未绑定的 env 内容不会发送给预览游戏。

~~~json
"--serverPort": {
  "type": "integer",
  "title": "服务器端口",
  "minimum": 1,
  "maximum": 65535,
  "x-default-env": "GAME_SERVER_PORT"
}
~~~

例如在游戏根目录的 .env 写入 GAME_SERVER_PORT=12166。完整示例包含 [.env.example](examples/.env.example)，复制为目标目录的 .env 后使用。修改 env 后重启 app 生效，已有客户端不自动重启。显式参数覆盖优先于默认值；“恢复默认”清除覆盖，让客户端重新使用本次启动读取的默认值。旧状态中的已保存参数仍按覆盖值处理，不自动猜测或迁移，可手动恢复默认。

不搜索其他目录、不使用固定预览端口，不读取 home 工作区、旧 config.yaml 或 --ext.* 参数。

## 状态与管理

所有持久化状态位于目标目录的 .dev-container/。建议在游戏仓库的 .gitignore 添加：

~~~gitignore
.dev-container
~~~

该目录包含 preference.json、users.json、window-layout.json、debug-session.json、electron/ 运行数据。用户 ID 为稳定 UUID；首次启动创建 Client 1。用户按目标目录管理；名称仅用于宿主识别账号，不作为游戏昵称。

主窗口隐藏系统标题栏，顶部菜单栏兼作可拖动标题栏，右侧保留与主题配色一致的原生最小化、最大化和关闭按钮。原生按钮不依赖页面点击事件；菜单仍可点击，标题栏内容预留原生按钮区域。正常关闭保存宿主状态后销毁窗口；页面卡死时原生关闭仍可使用。

顶部客户端菜单通过“添加客户端”对话框选择绑定用户、填写客户端名称及启动参数，启动参数默认折叠，可在绑定用户旁新建并自动选中用户，确认前校验参数，取消不创建客户端；左侧图标栏切换客户端和用户管理。D/C 图标菜单中的“偏好设置”进入右侧现有页面。偏好设置在右侧内容区编辑，支持保存和放弃修改；已有 settings.json 会在首次读取时校验并原样改名为 preference.json。偏好设置保存预览模式（默认 webview）、启动布局（默认恢复上次布局）和是否保存布局（默认开启），保存后下次启动生效。窗口位置、尺寸和最大化状态单独持久化；新客户端默认静音，之后记住每个客户端的选择。客户端使用紧凑标题栏，提供用户切换、刷新、静音、视口适配、启动配置、DevTools 和独立关闭按钮。配置对话框使用紧凑表单，支持字段说明、枚举、范围提示和可选值开关。每个客户端可绑定用户、刷新和编辑启动参数。webview 使用独立 DevTools 与静音；iframe 使用宿主 DevTools 和窗口级静音。用户切换重建客户端，并绑定对应用户的浏览器 session 与 origin。

用户管理提供搜索、新建和改名，用户 ID 只读并可复制，显示绑定客户端。名称和首字母标记只用于宿主界面；SDK 用户仅包含只读 id。宿主不提供头像编辑、平台存储 API 或存储管理页面。

Electron 运行数据目录由宿主定义：

~~~text
.dev-container/electron/
  session-data/
    Partitions/
      dev-container/               # 宿主窗口与 iframe
      client-<gameUserHash>/        # webview 用户 session
    ...                            # Electron 默认 session 的 Chromium 文件
  user-data/
  logs/
  crash-dumps/
  temp/
~~~

ready 前通过 `app.setPath('sessionData', ...)` 设置统一根目录；宿主使用 `persist:dev-container`，webview 使用由游戏 ID 和用户 UUID 确定的分区。预览代理使用固定的 `dev-container-client://<标识>/<subpath>` 地址，将已登记客户端的请求转发到 Vortex 实际端口。session 和代理继续作为预览运行环境的一部分。

远程调试默认关闭；launcher 的普通启动不传端口，调试启动传 --remote-debugging-port=0，宿主发现实际端口后记录到 debug-session.json。没有客户端时也记录当前进程，普通启动的端口和地址为 null，不复用历史端口。已运行的实例需关闭后重新选择启动模式。手动打开内置 DevTools 不需要远程端口：webview 打开自己的 DevTools，iframe 打开宿主 DevTools。

debug-session.json 记录当前进程、客户端 URL/用户绑定/调试地址；它是调试信息，不用于发现游戏配置。

## 游戏 SDK

公共包位于 packages/dev-container-sdk，包名 @bsgames/dev-container-sdk，版本 0.0.1-alpha.1。private:false、publishConfig.access:public，发布目录仅包含 lib ESM 和声明文件。本次只构建，不发布。

~~~ts
import { account, isAvailable } from '@bsgames/dev-container-sdk';

if (isAvailable()) {
  const user = await account.login();
  console.log(user.id, await account.getUser());
  await account.logout();
}
~~~

安装后的 SDK 入口随游戏构建，不使用 import map。宿主在游戏脚本执行前注入账号对象；npm 入口只读取这个对象，不连接宿主或实现通信协议。游戏保持用 isAvailable() 判断环境，返回 true 后调用 account；宿主会话失败会明确拒绝账号操作，不降级为普通预览。

account.login/getUser/logout 为异步；登录使用宿主为该客户端绑定的用户，不弹出游戏内选择器。getUser 在未登录时返回 undefined；login 幂等。logout 退出账号；客户端的建立和释放由宿主管理，游戏没有 connect/close 步骤。

SDK 只提供账号身份，login/getUser 返回 `{ id }`。没有名称、头像或 storage 入口，也不 re-export Web Storage / IndexedDB。游戏自己的昵称和持久化由游戏负责。

webview 的专用 guest preload 在游戏脚本执行前完成宿主身份登记并注入完整 account API；iframe 在设置 src 前登记用户并安装父页面转发器，代理在游戏脚本前创建 MessageChannel 和 account API，消息排队至父页面接收通道后转发到主进程。账号 API 绑定宿主选择的用户。公共 SDK 只导出宿主注入的 account 对象和类型；无宿主时 account 为 undefined。通信协议属于私有 dev-container-api 包，SDK 不依赖 Vue、Electron 或内部扩展 API。

SDK 的类型从私有 `dev-container-api/sdk-runtime` 模块的实际返回值推导。构建使用 tsdown 将公开类型展开到单个 `lib/index.d.ts`，消费者无需安装宿主、内部包、Electron 或 Vue；npm JavaScript 仍只读取宿主注入对象。

## SDK 版本管理

Changesets 只管理公共 SDK 的版本和 CHANGELOG；宿主和内部包保持 private，不更新版本或创建发布 tag。
仓库根目录提供 `node --run changeset`、`node --run version` 和 `node --run release`。
SDK 发布地址固定为官方 npm，发布前由 prepublishOnly 构建 ESM 和声明文件。
后续采用发布 PR 合并后自动发布的流程；目前尚未配置 Git remote，因此只完成本地工具配置。
具体操作见 [.changeset/README.md](.changeset/README.md)。

## 内部结构与验证

保留 packages/dev-container、dev-container-api、dev-container-extension-client-simulator 和 workflow 的组织方式；宿主按 main/preload/renderer/shared/extensions 分层。Vortex 预览接入和 account 是编译期内部扩展，logs/room/monitor 保留占位面板。没有外部插件安装或动态加载。

pnpm test 检查公共 SDK 和真实 Electron app，两种视图覆盖只读 ID 登录/退出、刷新、用户切换、外置 schema 与字段名 URL 参数、偏好设置、宿主状态恢复和配置错误。浏览器测试使用共享 Playwright：默认 U:/AgentTools/playwright，可通过 DEV_CONTAINER_PLAYWRIGHT_ROOT 指向现有共享安装；不会给 workspace 安装 Playwright。DEV_CONTAINER_TEST_PACKAGED=1 启用 Windows 包启动检查。

第一版不包含游戏生命周期、广告、游客、旧状态迁移和存档导入导出。

## ESLint

沿用 RoboTimes 的 `@shrinktofit/eslint-config` recommended/conventions、类型感知 TypeScript 检查、Vue recommended 和 Node 规则。Electron 主进程、内部 main 扩展和 preload 按实际内置 Node 24.18 检查；工具脚本使用 Node 26 基线，renderer 和 SDK 使用浏览器环境。Cocos 导入限制、游戏资源例外和 Vortex CI 流程不适用于此仓库。

`node --run lint` 检查全仓 JS/TS/Vue，包含 `eslint.config.js`、构建脚本和测试，零 warning 才通过；`node --run lint:fix` 自动修复可修正项。`.vscode/settings.json` 配置保存时显式 ESLint 修复。编译产物、部署目录、运行状态和测试夹具会被忽略。

`node --run check` 依次执行构建、类型检查、全仓 lint 和测试，适合作为 CI 检查入口。与 RoboTimes 的变更文件检查一致，`lint:changed` 检查 `base...HEAD` 中新增、复制、修改或重命名的 JS/TS/Vue 文件，并拒绝 warning：

~~~powershell
node --run check
node --run lint:changed -- --base-ref origin/main
~~~

`--base-ref` 可以是本地或远程分支、提交。变更检查脚本为 `.ts`，使用 Node 直接运行，不修改或暂存文件。其 CLI 测试覆盖变更选择、带空格路径、错误与 warning 的退出码，以及删除文件和无效参数。

产品图标以 `packages/dev-container/build-resources/dev-container-icon.svg` 为原稿。修改原稿后，在 `packages/dev-container` 目录执行 `node --run build:icons`，重新生成窗口使用的 PNG 和 Windows 使用的多尺寸 ICO。标题栏菜单直接使用同一份 SVG。
