# SDK Changesets

Changesets 管理公共包 `@bsgames/dev-container-sdk` 的版本和 CHANGELOG。
宿主与内部包保持 private，不更新版本或创建发布 tag。

修改 SDK 后，在仓库根目录创建 changeset：

```powershell
node --run changeset
node --run changeset -- status
```

也可以直接指定包、版本类型和说明：

```powershell
node --run changeset -- add --patch @bsgames/dev-container-sdk --message "Describe the SDK fix"
```

纯宿主 UI 或发布工具配置修改不需要 SDK 版本变更。
如果变更检查要求 changeset，但本次无需发布，使用 `node --run changeset -- add --empty`。

准备发布时通过 Changesets 更新版本和 CHANGELOG：

```powershell
node --run check
node --run version
```

检查生成的版本变更，将其纳入发布 PR。发布 PR 合并后由发布工作流运行
`node --run release`，只向官方 npm 发布公共 SDK。SDK 的 prepublishOnly 会先构建 ESM 和声明文件。
GitHub 的 release.yml 在 main 更新时创建或更新版本 PR；版本 PR 合并后通过 npm 可信发布发布 SDK，无需保存 npm token。

SDK 初始版本为 `0.0.1-alpha.1`。当前处于 alpha 预发布模式，后续版本使用 alpha 编号并发布到 npm 的 alpha 标签。准备稳定版时，先运行 `node --run changeset -- pre exit`，再通过版本 PR 更新版本。
Changesets 不自动提交。完整用法见 https://changesets.dev/guide/getting-started 。
