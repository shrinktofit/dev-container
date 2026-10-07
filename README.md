# Dev Container

用于游戏开发的桌面工作台。在同一个窗口中运行多个客户端，切换测试账号，调整启动参数并打开 DevTools。

- 多客户端分屏，支持 webview 和 iframe。
- 为每个客户端绑定独立的测试用户。
- 连接 Vortex 预览服务，自动获取当前预览端口。

## 快速开始

先启动目标游戏的 Vortex 编辑器与预览服务，在游戏根目录添加 `dev-container.config.yaml`：

```yaml
version: 1
game:
  id: my-game
  title: My Game
client:
  dir: client
  subpath: super-preview
```

从源码运行：

```sh
pnpm install
node --run build
pnpm start /path/to/game
```

Windows 目录包可直接启动：

```powershell
.\dev-container.exe .
```

`dev-container.exe .` 打开当前目录，`dev-container.exe probe .` 查询该目录是否已有实例。目标目录必须显式传入。

通过顶部“客户端”菜单添加客户端，在标题栏切换用户、刷新或调整启动设置。应用偏好设置位于产品图标菜单中。

## 配置

`game.id` 是稳定的游戏标识，`game.title` 是显示名称。

`client.dir` 指向 Vortex 项目目录，默认使用配置所在目录。`client.subpath` 默认空，访问原生预览；`super-preview` 访问 `/super-preview`。预览端口由 Vortex 提供，无需配置。

需要启动参数时，在 YAML 中添加：

```yaml
launch:
  schema: launch-params.schema.json
```

Schema 声明字段类型、标题和默认值，应用据此生成表单，字段名直接作为 URL 参数名。支持字符串、数字、布尔值和枚举；参考 [配置示例](examples/dev-container.config.yaml) 与 [参数示例](examples/launch-params.schema.json)。

使用 `x-default-env` 可从游戏根目录的 `.env` 或 `.env.local` 读取字段默认值，后者优先。修改环境文件后需重启应用。参考 [.env 示例](examples/.env.example)。

本地用户和应用状态保存在游戏目录的 `.dev-container` 中，建议加入 `.gitignore`：

```gitignore
.dev-container
```

## 游戏接入

安装 [`@bsgames/dev-container-sdk`](https://www.npmjs.com/package/@bsgames/dev-container-sdk)，通过账号 API 获取客户端绑定的用户 ID：

```ts
import { account, isAvailable } from '@bsgames/dev-container-sdk';

if (isAvailable()) {
  const user = await account.login();
  console.log(user.id);
}
```

## 开发

`pnpm dev /path/to/game` 启动开发模式；`node --run check` 运行构建、类型检查、lint 和测试。

`node --run pack:win` 生成 Windows 目录包，`node --run dist:win` 生成 ZIP，输出位于 `packages/dev-container/.deploy/dist`。SDK 发布流程见 [发布指南](.changeset/README.md)。
