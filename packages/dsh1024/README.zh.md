# dsh1024

中文 | [English](README.md)

`dsh1024` 是 DeepSeek Harness 的 DSH 1024Store 包。一个 npm 包提供两个入口：

- **店内 1024 Store 插件** —— 把 [1024 Store](https://deepseek1024.com/)
  精选目录装进 DeepSeek Harness。安装后既可从设置左侧的 **1024 Store**
  直接进入，也可在 **设置 → 插件 → 1024 Store（插件数量）** 中打开。
- **可追踪安装 CLI** —— 官方 DeepSeek Harness 插件命令的轻量、可验证包装器。
  它安装目录插件，校验所选 DSH profile 确实包含该插件，并向 DSH 1024Store
  统计 API 上报一条匿名安装结果。

## 安装 CLI

一次性全局安装后，`dsh1024` 就能像官方 `dsh` 命令一样直接使用：

```sh
npm install -g dsh1024
```

不想安装也可以继续用 `npx dsh1024 …`。

## 安装店内插件

```sh
npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest
```

直接用官方 CLI 是同一条命令，只是换了个名字：

```sh
dsh plugin --profile web add dsh1024@latest
```

安装完成后重启 DeepSeek Harness。

店内插件现在是一个稳定的本地壳，内部嵌入
`https://deepseek1024.com/embed/store` 实时页面。目录展示、搜索和详情可以随主站
发布，不再要求每次更新 npm 包；标题栏、版本检查、一键自更新、安装桥和加载失败
降级页仍在本地，即使远程页面无法嵌入也能工作。

嵌入网页没有 Shell 权限。带版本号的 `MessageChannel` 桥只接受包含目录
`pluginId` 的 `install` 意图，以及一个不带参数的 `installed` 只读意图；不接受命令、
URL、路径或任意参数。本地后端会重新从可信 `/api/v1/registry` 查询该 ID，并自行生成
官方 DSH CLI 参数数组。“已安装”视图只会收到匹配到的目录 ID 和本来就公开的目录摘要，
不会收到本机依赖名、版本、spec 或路径。每次安装仍需本地确认，写接口仍要求同源 POST，
且所有插件操作共用同一个互斥锁。插件变更会在重启 DeepSeek Harness 后生效。

自身更新优先查询 deepseek1024.com 的 `/api/v1/self/update`，失败时依次回退 npm
registry 和仓库中的 package manifest。一键更新只会执行固定目标
`dsh plugin --profile <profile> add dsh1024@<版本>`，远程页面不能指定包名或版本。

店内插件有三个入口：侧边栏底部（带实时目录总数徽标，点击自开浮层）、设置页
左侧导航，以及设置 → 插件标签页。删掉任何一个都会让包的 preflight 失败。

目录会先用上一次的结果立刻渲染，然后在每次打开面板、以及窗口重新可见时静默
重新校验，新收录的插件不需要刷新按钮、也不会出现加载态就会自己出现。并发的
重新校验会合并成一次请求，失败时保持当前列表不变。

## CLI 用法

需要 Node.js 22 或更高版本。

`dsh1024 plugin ...` **就是** `dsh plugin ...`，只是换了个命令名。`plugin`
之后的所有参数原样转发给官方 CLI —— 不增、不删、不重排、不补默认值：

```sh
dsh1024 plugin --profile web add @scope/dsh-plugin
dsh plugin      --profile web add @scope/dsh-plugin
```

上面两行执行的是同一个官方操作。包装器只负责它之外的事：核对结果 profile，
并记录一条匿名安装结果。

因为不补任何默认值，所有选项的行为与官方文档完全一致：不写 `--profile`
就照原样转发，而不是被悄悄补上；`--`、ref 以及其他官方参数也都保持官方语义：

```sh
dsh1024 plugin --profile web add @scope/dsh-plugin@1.2.0
dsh1024 plugin --profile web add @scope/dsh-plugin -- \
  --ignore-scripts --reporter append-only --config.confirmModulesPurge=false
```

包装器会在不经过 shell 的情况下把第一条示例执行为：

```sh
npx --yes @deepseek-ai/dsh plugin --profile web add @scope/dsh-plugin@1.2.0
```

如果 PATH 上已经装有官方 `dsh`，包装器会直接复用该可执行文件，省掉 npx 每次
安装的解析开销；用 `DSH1024_DSH_PACKAGE` 钉版本时一律走 npx 形式。改变的只是
定位官方 CLI 的方式，参数、顺序、退出码与 stdio 完全不变。

参数不会进入遥测事件或本地 receipt。

### 什么会被计入

包装器只读取参数向量用于归因，绝不改写它。只有在向量无歧义、且目标能解析出
目录仓库时才计入；其余情况照常安装但不计数——宁可漏记，也不错记。

向量必须写明 profile（`--profile <name>` 或 `--profile=<name>`；官方没有 `-p`
简写）、使用安装类动词（`add`、`i`、`install`），并且装进该 profile 自己的依赖
（`-D`、`--save-dev`、`-O`、`--save-optional`、`--save-peer`、`-g`、`--global`
一律不计入）。

额外参数照常透传、行为与官方文档一致——写 `--reporter append-only` 之类不会
影响安装本身。它们只在一种情况下影响统计：当参数让安装目标不唯一时（一条命令
里出现两个仓库，或用了包装器不知道会带值的选项），该次安装不计入，而不是靠猜
去归因。

| 目标 | 归因为 | id 来源 |
| --- | --- | --- |
| `github:owner/repository`、`owner/repository`（可带 `#ref`、`.git`） | `owner/repository` | 参数本身 |
| `github:owner/repository#path:sub/dir`、`owner/repository/sub/dir` | `owner/repository/sub/dir` | 参数本身 |
| `dsh1024`、`dsh1024@<版本>` | 本目录仓库 | 固定 |
| 已发布的包名（可带版本 / tag / 范围） | 安装后清单里的仓库 | 安装成功后读 `node_modules/<包名>/package.json` 的 `repository` 字段 |
| 本地路径、`file:`、`link:`、`portal:`、URL、盘符、`~` | 一律不上报 | — |
| `gitlab:`、`bitbucket:`、`gist:`、`jsr:`、`workspace:`、`catalog:`、npm alias、完整 git URL | 不计入 | — |

包名反查只读一个本地文件——已安装包自己的 `repository` 字段，支持 npm 的字符串
与对象两种写法，且只接受 github.com 主机。monorepo 的 `directory` 会成为标识里的
子目录，同仓库的兄弟包各自独立计数。字段缺失、指向非 GitHub、声明的目录越出仓库，
或安装失败无从读取时，该次安装不计入。

本地路径与 `file:`/`link:`/`portal:` 是硬边界：文件系统路径永远不会进入安装
事件、本地 receipt 或重试队列。

## 匿名安装遥测

每次通过 CLI 或店内插件安装、卸载后，都会向同一个公共端点上报一条匿名结果
事件（店内插件为 `sourceChannel: dsh-1024store-plugin`），并复用存放在
`$DSH_HOME/.dsh-1024store/client.json` 的共享匿名身份。上报为
fire-and-forget，失败静默，可通过 `DO_NOT_TRACK=1`、`DSH1024_TELEMETRY=0`
（旧写法 `DSH_1024STORE_TELEMETRY=0` 永久兼容）或
`npx dsh1024 telemetry disable` 完全关闭（关闭时不会创建任何身份）。详见
[docs/install-analytics.md](https://github.com/imsai-sh/dsh1024-oss/blob/main/docs/install-analytics.md)。

遥测控制命令：

```sh
npx dsh1024 telemetry status
npx dsh1024 telemetry disable
npx dsh1024 telemetry enable
npx dsh1024 telemetry reset
```

## 本地目录缓存

DSH 插件会把最近一次通过校验的公开插件目录与嵌入版目录页保存到
`$DSH_HOME/.dsh-1024store/registry-cache.json` 和
`catalog-page-cache.json`。嵌入版会先展示本地页面，同时并行请求生产
API；新数据返回后无感替换页面并更新缓存。旧数据最多保留七天。这些
文件归 `dsh1024` 插件所有，不包含账号或安装密钥，停止 DSH 后可安全删除。

## 从旧包迁移

`dsh1024` 取代已弃用的 `@dsh-1024store/cli` 与 `dsh-1024store` 两个 npm 包。
把 `npx @dsh-1024store/cli ...` 换成 `npx dsh1024 ...`，把
`dsh plugin --profile web add dsh-1024store` 换成
`dsh plugin --profile web add dsh1024@latest` 即可；所有命令、选项与透传行为不变。
遥测偏好、匿名身份与本地 receipt 仍存放在 `$DSH_HOME/.dsh-1024store/`
下并原样复用，无需任何迁移步骤，也无需改环境变量名。

## 本地开发

在仓库根目录运行：

```sh
npm install
npm run market:test
```

把构建结果安装到隔离 profile：

```sh
DSH_HOME=/tmp/dsh-store-test dsh plugin --profile market-test add ./packages/dsh1024
DSH_HOME=/tmp/dsh-store-test dsh --profile market-test --port 14567
```

要把本地主站嵌进本地插件壳，可创建下面的 overlay 并在启动时传入（明文 HTTP
仅允许回环地址）：

```yaml
- id: dsh1024
  config:
    embedUrl: http://127.0.0.1:14568/embed/store?bridge=dsh1024-v1
```

```sh
DSH_HOME=/tmp/dsh-store-test dsh --profile market-test --patch ./local-store.yml --port 14567
```

在 `packages/dsh1024` 目录内：

```sh
npm test
npm run pack:check
```
