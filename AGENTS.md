# AGENTS.md

## Landing page 部署（Cloudflare Pages）

`apps/landing` 是 https://wengu.dev 的静态 landing page，部署在 Cloudflare Pages 项目 `wengu` 上。

- `public/`：静态文件（`index.html`、`styles.css`、`waitlist.js`），只有这个目录会被上传。
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
