# Contributing to Wengu (温故)

感谢你对温故的关注与支持！欢迎通过 Issue 反馈问题、提出建议，或通过 Pull Request 参与改进。

## 提交 Issue 与 PR 前

1. 请先阅读 [README.md](README.md) 与 [docs/product.md](docs/product.md)，了解温故的产品定位与非目标（例如：客户端不内置大模型调用、不兼容 Anki 插件生态、不接入 AnkiWeb 同步）。
2. 较大的改动建议先开 Issue 讨论方案再动手。
3. 提交 PR 前请确保在本地通过基本校验：
   ```sh
   corepack pnpm typecheck
   corepack pnpm --filter @wengu/core test
   corepack pnpm --filter @wengu/anki test
   corepack pnpm --filter @wengu/web test
   ```

## 贡献者许可协议（CLA / Contributor License Agreement）

温故的核心代码以 **GNU AGPL-3.0** 协议开源。同时，项目维护者（版权所有者）计划基于本仓库核心代码发布并维护面向移动平台（如 iOS App Store、Google Play）的官方商业客户端及可选托管服务，以支持项目长期可持续发展。

因此，当你向本仓库提交 Pull Request 或其他代码/文档贡献时，即表示你同意以下条款：

1. **原创与授权资格**：你确认所提交的贡献是你的原创作品，或你已拥有充分权利在以下条款下提交该贡献。
2. **保留署名与版权**：你仍保留对你所提交贡献的著作权。
3. **授予双重许可权利**：除根据本仓库的 AGPL-3.0 协议向公众授权外，你同时授予温故项目维护者（Kaixiang Li / wengu-app）一项永久的、全球性的、非排他的、免费的、不可撤销的版权与专利许可，允许其使用、修改、分发并将你的贡献以其他许可协议（包括用于官方闭源/商业移动客户端或其他商业分发渠道）进行再许可。

> **English Summary (Contributor License Agreement)**
>
> By submitting a Pull Request or any other contribution to this repository, you confirm that you have the right to submit it and you grant the Wengu project maintainer (Kaixiang Li / wengu-app) a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright and patent license to use, modify, distribute, and relicense your contribution under alternative licenses (including proprietary/commercial licenses for official mobile apps and optional hosted services), in addition to the repository's GNU AGPL-3.0 license. You retain copyright to your own contributions.

如果你对上述条款有疑问，欢迎在提交前先通过 Issue 联系维护者。

## 品牌与商标说明

本仓库的开源协议仅适用于源代码，不授予“温故”、“Wengu”名称及应用图标（Logo）的商标使用权。基于本仓库代码进行二次分发时，请使用不同的应用名称与图标，以免与官方版本混淆。
