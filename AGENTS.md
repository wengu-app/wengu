# AGENTS.md

## Landing page 部署（Cloudflare Pages）

`apps/landing` 是 https://wengu.dev 的静态 landing page，部署在 Cloudflare Pages 项目 `wengu` 上。

- `public/`：静态文件（`index.html`、`styles.css`、`viz.js` 交互可视化、`waitlist.js`），只有这个目录会被上传。
- `functions/api/waitlist.js`：`POST /api/waitlist`，接收 `{"email": "..."}`，写入 KV。
- `wrangler.toml`：项目配置，KV 绑定名 `WAITLIST`（命名空间 `wengu-waitlist`，id `a80385bd096e4a00b153c701a5be3dde`）。
- `.env`：`CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，已被 git 忽略，不要提交，也不要放进 `public/`。

需要全局安装 wrangler：`npm i -g --allow-scripts=esbuild,workerd wrangler`。

以下命令都在 `apps/landing` 下执行，先加载凭据：

```sh
set -a; . ./.env; set +a
```

部署：

```sh
wrangler pages deploy --branch main
```

查看 waitlist 邮箱（每个邮箱一个键 `email:<地址>`）：

```sh
wrangler kv key list --namespace-id a80385bd096e4a00b153c701a5be3dde --remote
```

本地预览：`python3 -m http.server -d public`（不含 `/api/waitlist`；要连函数一起跑用 `wrangler pages dev`）。

域名：wengu.dev 是 zone 根记录 `CNAME @ → wengu.pages.dev`（已代理），已作为自定义域名挂在 Pages 项目上。

Token 需要的权限：账户级 Pages Write、Workers KV Storage Write；区域级（wengu.dev）DNS Write。

## 杂志风原型部署（Cloudflare Pages）

`apps/prototype/magazine` 是 M2 界面重设计的杂志风可交互原型，部署在 Cloudflare Pages 项目 `wengu-magazine` 上，地址 https://magazine.wengu.dev。数据全是写死的，还没有移植进 `apps/web`。

- `public/index.html`：整个原型（单文件，内联 CSS 和 JS），加了 `noindex`。
- `public/fonts/oppo-sans-subset.woff2`：OPPO Sans 4.0 的子集，只含页面用到的字。
- `scripts/subset-font.cjs`：页面加了新文字后重新生成子集，否则新字会回退到系统字体。
- `wrangler.toml`：项目名 `wengu-magazine`，没有函数和 KV。

凭据和 landing 共用 `apps/landing/.env`。以下命令都在 `apps/prototype/magazine` 下执行：

```sh
set -a; . ../../landing/.env; set +a
wrangler pages deploy --branch main
```

重新生成字体子集（完整字体约 22MB，不要提交；`subset-font` 装在临时目录，不进 lockfile）：

```sh
npm i --prefix /tmp/subset-font subset-font@2
NODE_PATH=/tmp/subset-font/node_modules node scripts/subset-font.cjs <OPPO Sans 4.0 的 .ttf 路径>
```

域名：`CNAME magazine → wengu-magazine.pages.dev`（已代理），已作为自定义域名挂在项目上。

本地预览：`python3 -m http.server -d public`（字体用相对路径加载，直接双击打开 HTML 也能看）。

## 游戏风原型部署（Cloudflare Pages）

`apps/prototype/game` 是游戏风界面（参考多邻国的视觉、内容按 Anki 桌面应用）的可交互原型，`apps/web` 的界面按它改过，部署在 Cloudflare Pages 项目 `wengu-game` 上，地址 https://game.wengu.dev。复习、添加、编辑、暂停都会真的改变状态，数据存在访问者浏览器的 localStorage 里（键 `wengu-game-v1`），首次打开时用模拟的复习历史生成演示数据。

- `public/index.html`：页面和样式；`public/app.js`：全部逻辑和演示卡片内容；加了 `noindex`。
- `public/scheduler.js`：由 `packages/core/src/engine/scheduler.ts` 打包而来（全局变量 `WenguScheduler`），排期和应用一致。改了排期代码后在仓库根目录运行 `apps/prototype/game/scripts/build-scheduler.sh` 重新生成。`src/anki-shim.ts` 和 `src/empty.ts` 用来避免把 `.apkg` 读写和 sql.js 打进包。
- `public/fonts/oppo-sans-subset.woff2`：OPPO Sans 子集，取 `index.html` 和 `app.js` 用到的字；加了新文字后运行 `scripts/subset-font.cjs`（用法同上一节）。
- 右上角"跳到明天"把演示时间往后拨一天；设置里可以调目标记住率、每天新卡数和重置数据。

凭据和 landing 共用。wrangler 4.163 默认会把 Pages 命令转给 Workers 并失败，要加 `--force` 走 Pages：

```sh
cd apps/prototype/game
set -a; . ../../landing/.env; set +a
wrangler pages deploy --branch main --commit-dirty=true --force
```

域名：`CNAME game → wengu-game.pages.dev`（已代理），已作为自定义域名挂在项目上。本地预览要用 `python3 -m http.server -d public`（直接打开文件时字体会被浏览器拦截）。

## 给后续 agent 的工作须知

项目现状以根目录 `README.md` 的"当前开发状态"为准，改了状态要同步更新那一节。**不要在 README 里记录 GitHub issue 的状态**（issue 状态直接去 GitHub 查看）。

**项目仍在早期开发阶段，尚未正式发布，不需要考虑后向兼容**（保持实现干净直接，不要为了旧开发版本保留回退分支或兼容层）。

### UI 修改与截图对比

- **每次修改 UI，都需要先截取修改前的界面截图，改完后再截取相同状态下的修改后截图，并在回复中提供前后对比图。**

### 验证命令（提交前都要跑）

```sh
corepack pnpm typecheck
corepack pnpm --filter @wengu/core test          # 另有 test:browser（含崩溃恢复）
corepack pnpm --filter @wengu/anki test
corepack pnpm --filter @wengu/web test
(cd apps/web && corepack pnpm exec vite build && corepack pnpm exec playwright test --workers=1)
(cd apps/desktop && WENGU_TEST_NO_SANDBOX=1 corepack pnpm test)
```

- 本机是 4 核 8G。**性能测量必须串行、在空闲时跑**（先看 `uptime`）；多个 agent 并行跑测试会把负载顶到 15 以上，延迟数字不可信。
- 不要为了通过而改延迟阈值（100 毫秒）、样本数或卡组规模。
- Linux 上的 Electron 测试需要 `WENGU_TEST_NO_SANDBOX=1`。

### 桌面打包

- macOS、Windows 包只能由 GitHub Actions 构建：`gh workflow run desktop.yml --ref main`（手动触发）。
- macOS 按 arm64 和 x64 **分开打包，不要打 universal**。
- macOS CI 使用 Developer ID Application 签名；签名凭据由 MAC_CSC_LINK 和 MAC_CSC_KEY_PASSWORD 提供。本地无证书时临时签名。
- 公证只在 macOS CI 打包时启用，用 App Store Connect API 团队密钥（Wengu CI Notarization），凭据是 Secrets `APPLE_API_KEY_BASE64`（.p8 的 base64）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。工作流把密钥解码到 `$RUNNER_TEMP` 下权限 600 的 .p8，以绝对路径传给 `APPLE_API_KEY`，并设 `WENGU_NOTARIZE=1`；`scripts/package.mjs` 据此加 `-c.mac.notarize=true`（`electron-builder.yml` 里保持 `notarize: false`，本地打包不公证）。electron-builder 在做 dmg 和 zip 之前公证并 staple Wengu.app。步骤结束或失败都会删除密钥。
- 只签名不公证的包，用户下载后打开会看到"Apple 无法验证……是否包含恶意软件"。工作流里的"Verify notarization of distributables"会解开两个架构的 dmg 和 zip，对其中的 Wengu.app 跑 `xcrun stapler validate` 和 `spctl --assess --type execute --verbose=4`，要求出现 `source=Notarized Developer ID`；它失败说明包不能分发，不要绕过。
- 不要在 `extendInfo` 里覆盖 `CFBundleName`：Electron 按它找 `<名称> Helper.app`，改了会启动即崩溃。
- 修改 Electron Fuses 后必须重新签名（`resetAdHocDarwinSignature`），否则 Apple 芯片上启动即被系统终止。
- 工作流里的"Verify signature and launch"会真实启动应用；它失败说明包不可用，不要绕过。

### 桌面发版和应用内更新

已安装的应用从 `https://github.com/wengu-app/downloads/releases/latest/download/` 读取 `latest.yml`、`latest-mac.yml`、`latest-linux.yml`，地址在打包时写进包里（CI 变量 `WENGU_UPDATE_URL`，`scripts/package.mjs` 有同样的默认值）。0.1.1 是第一个带更新功能的版本，更早的版本要手动装一次。

发一个新版本：

```sh
# 1. 升版本号（apps/desktop/package.json 的 version），提交并推送
gh workflow run desktop.yml --ref main          # 2. 三个平台一起打包
gh run watch <run-id> --exit-status
D=~/.cache/wengu-release/v<版本>                 # 3. 下载产物，放硬盘，/tmp 是内存盘放不下
gh run download <run-id> -D "$D"
gh release create v<版本> -R wengu-app/downloads --title "温故 <版本>" --notes "…" --latest $(find "$D" -type f | sort)
```

- 每个 CI 产物（安装包、mac 的 zip、`.blockmap`、三个 `latest*.yml`，共 15 个文件）都要传；漏了某个 `latest*.yml`，对应平台就收不到更新。
- Release 必须是正式版、标为 latest：预发布和草稿不会出现在 `releases/latest`。
- 产物文件名不能有空格：GitHub 会把附件名里的空格换成点，和 `latest*.yml` 里记的名字对不上。
- 发布后用 `curl -sL <更新地址>/latest-linux.yml | head -1` 确认版本号已变。
- 应用启动 15 秒后检查一次，之后每 6 小时一次，"帮助 → 检查更新…"立即检查。
- 本机验证（只能测 Linux）：本机没有 FUSE 2，AppImage 用 `APPIMAGE_EXTRACT_AND_RUN=1` 运行，再加 `DISPLAY=:1 --no-sandbox`；更新后重启的进程不会带上原来的命令行参数（包括 `--user-data-dir`），会用默认数据目录 `~/.config/Wengu`。

### 数据安全

- `packages/core/src/worker/buffered-journal-vfs.ts` 合并回滚日志写入以降低延迟，依赖 `synchronous = NORMAL` 和 `journal_mode = PERSIST`：日志在 xSync 前落盘。改这些 pragma 或这个文件前，先跑 `test:browser` 和 `apps/desktop/tests/review-kill.spec.ts`。
- 排期结果必须与 Anki 一致，核心测试里有对照记录，不能改期望值来通过。

### 本机 agent（MCP）

- 工具定义在 `apps/web/src/agent/tools.ts`（构建时由 `apps/desktop/scripts/build-mcp.mjs` 嵌入独立 Go 二进制 `wengu-mcp`），执行在 `apps/web/src/agent/run.ts`。加工具时两处都改，并更新 `apps/desktop/tests/agent.spec.ts` 里的工具列表。
- `wengu-mcp`（`apps/desktop/mcp/`）的 stdout 只能输出 MCP JSON-RPC 消息，不要往 stdout 打日志。

### 真实卡组对照

`corepack pnpm --filter @wengu/anki verify:real <绝对路径.apkg>`：用 Anki 官方库对照导入、渲染和导出往返。卡组放在 `packages/anki/.real-decks/`（已忽略，第三方内容不要提交）。

### 未完成

- M1 的连续两周自用验收（需要作者本人）。
- Intel 版 mac 和 Windows 包未在真机运行过。
- dmg 窗口里隐藏文件（`.background.tiff`、`.VolumeIcon.icns`）在开启"显示隐藏文件"时可见，待定是否移出可视区。
- 二十张卡的可视化对照实验尚未做。
- 协议写的是"计划采用 AGPL-3.0"，仓库里还没有 LICENSE 文件。
- `apps/prototype` 两个原型里的 OPPO Sans 子集取自第三方来源，随开源仓库分发前要换成 OPPO 官方下载的字体并确认授权。
