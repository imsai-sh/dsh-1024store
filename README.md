# DSH 1024Store

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（`dsh`）生态的开源插件市场：[deepseek1024.com](https://deepseek1024.com/) 网站与 Worker、把市场装进 `dsh` 本体的内嵌 Store 插件、上报安装统计的包装 CLI，以及一套免费的公开查询 API——全部在本仓库。

> The open-source plugin marketplace for the DeepSeek Harness ecosystem: the
> [deepseek1024.com](https://deepseek1024.com/) site + Cloudflare Worker, the in-`dsh`
> 1024 Store plugin, the install-tracking wrapper CLI, and a free public query API.

[![DSH 1024Store 插件市场首页](https://raw.githubusercontent.com/imsai-sh/awesome-deepseek-harness-plugins/assets/homepage.zh.png)](https://deepseek1024.com/)

[在线网站](https://deepseek1024.com/) · [API 文档](web/docs/api.md) · [npm 包 dsh1024](https://www.npmjs.com/package/dsh1024) · [插件目录仓库](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) · [提交插件](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md)

[![GitHub Stars](https://img.shields.io/github/stars/imsai-sh/dsh-1024store?style=social)](https://github.com/imsai-sh/dsh-1024store/stargazers)

## 快速开始

把插件市场装进 DeepSeek Harness 本体（重启后「设置」出现 **1024 Store** 入口，可搜索、筛选、安装、卸载）：

```bash
dsh plugin --profile web add dsh1024@latest
```

或使用包装 CLI 安装任意已发布 npm 包的插件，并把匿名安装结果计入[排行榜](https://deepseek1024.com/)：

```bash
npm install -g dsh1024   # 一次性
dsh1024 plugin --profile web add <npm-package>
```

免费查询 API（匿名每天 50 次；GitHub 登录创建 API Key 后每天 500 次）：

```bash
curl 'https://api.deepseek1024.com/v1/plugins/search?q=memory'
```

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `web/` | 部署单元：React 站点 + `dsh-store` Worker（目录 UI、社区、公开 API）、D1 迁移、测试、API 契约与文档。`cd web && npm run deploy` 即可发布（`predeploy` 自动先构建） |
| `plugin/` | 发布到 npm 的 `dsh1024` 包：包装 CLI + DSH 内嵌市场插件 |

插件目录本身——awesome 清单、插件收录 PR 与 README 生成——在姊妹仓库 [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)。**提交插件请去那边**，本仓库只接受网站 / CLI 的 issue 与 PR。

## 参与进来

这个项目由社区维护，下面每一种参与都真的有用：

- **点个 Star** — [Star 本仓库](https://github.com/imsai-sh/dsh-1024store/stargazers)是成本最低、帮助最大的支持，能让更多 DeepSeek Harness 用户发现这个插件市场（[目录仓库](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/stargazers)也值得一个）。
- **提 Issue** — 网站、API、内嵌 Store 或 CLI 的 bug 与新功能想法，欢迎[提 Issue](https://github.com/imsai-sh/dsh-1024store/issues/new)。
- **发 PR** — 改进网站、Worker、市场插件或 CLI，直接发 [Pull Request](https://github.com/imsai-sh/dsh-1024store/pulls)；动 API 相关代码前先读 [CONTRIBUTING.md](CONTRIBUTING.md)（v1 契约冻结，路由要登记进 `web/contracts/`）。
- **提交插件** — 想让自己的插件上架，去[目录仓库按指引提交](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md)，新增条目通过静态审查后自动合并、自动上架。
- **Fork 自建** — 想要完全属于自己的插件市场，[Fork 本仓库](https://github.com/imsai-sh/dsh-1024store/fork)后按[部署文档](web/docs/deployment.md)配置即可，MIT 协议，随便改。

## 本地开发

需要 Node.js 22+：

```bash
npm ci
npm run dev            # web 前端 + Worker 的 vite 开发服务
npm run typecheck
npm test               # plugin 包测试 + web 全套 vitest
npm run build
```

改动 API 相关代码时先读 [AGENTS.md](AGENTS.md)（冻结的 v1 契约、三域名边界、部署纪律）与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 部署与环境

- **生产**（`dsh-store`，deepseek1024.com 三域名）：合并进 `main` 即由 Workers Builds 自动构建部署；带 D1 迁移的变更必须**先迁移后合并**——纪律与应急手动通道见 [web/docs/deployment.md](web/docs/deployment.md)
- **UAT**（`dsh-1024store-uat`）：绑定 `uat` 分支、同一套构建，仅多一个 `CLOUDFLARE_ENV=uat` 构建变量；与生产共享 D1/KV 数据面，先推 `uat` 验证、再合 `main` 上线
- 安装统计的口径、隐私边界与 npm 发布流程见 [web/docs/install-analytics.md](web/docs/install-analytics.md)

## 社区

<div align="center">
  <strong>DSH插件社区</strong><br><br>
  <img src="web/public/wechat-group.jpg" alt="DSH插件社区微信二维码" width="280">
</div>

## License

MIT — see [LICENSE](LICENSE).
