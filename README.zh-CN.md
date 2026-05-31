# Codex Mobile Web App

[English](README.md) | 中文

这是一个自托管的移动端 Web 控制台，用来从手机控制本机已经登录的
Codex runtime。

手机只是远程 UI。Mac 或 Linux 主机负责保存 Codex 登录态、启动 Codex
runtime、读写本地项目文件、执行 shell 命令，以及保存应用状态。公网访问、
tunnel、反向代理不属于本仓库范围。

> 让 Codex 直接安装：
> `帮我安装 https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`

## 当前状态

本仓库从 `CodexBridge-main` 拆分出来。

已导入的 Codex 集成层：

```text
packages/codex-native-api
```

移动端 Web 服务：

```text
packages/codex-web
```

项目设计文档：

```text
docs/superpowers/specs/2026-05-17-codex-mobile-web-app-design.md
docs/superpowers/specs/2026-05-19-codex-mobile-reports-design.md
docs/superpowers/specs/2026-05-29-codex-web-workspace-redesign-design.md
docs/superpowers/specs/2026-05-30-codex-web-attachments-design.md
```

最近的实现计划：

```text
docs/superpowers/plans/2026-05-29-codex-web-workspace-redesign.md
docs/superpowers/plans/2026-05-30-codex-web-attachments.md
```

视觉参考：

```text
docs/assets/codex-web-reference.jpg
```

## AI 安装入口

如果你希望让 Codex 或其他 agent 直接安装这个项目，请使用仓库根目录的
[`install.md`](install.md)。它是 GitHub blob 链接和本地项目两种场景下的
统一 AI 安装入口。

约定的 agent 行为：

- 用户可以直接在 Codex 对话里说：
  `帮我安装 https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`
- 也可以直接说：
  `帮我安装这个项目`
- 如果用户发来 GitHub 的 `README.md` 或 `install.md` blob 链接，先还原仓库
  根目录，再执行 `install.md`。
- 如果用户在本地 checkout 里说“帮我安装这个项目”，先定位仓库根目录，再执行
  `install.md`。
- macOS 自动安装流需要先询问密码，以及是否安装为 launchd 开机自启动服务。
- Windows 直接停止自动安装，并说明当前仓库没有提供 Windows 安装器。

## 环境要求

- Node.js `>=24`
- npm
- 已安装本机 Codex CLI
- 本机 Codex 登录态位于 `~/.codex/auth.json` 或 `CODEX_HOME/auth.json`

## 安装依赖

```bash
npm install
```

检查两个 workspace：

```bash
npm run typecheck
npm test
```

## macOS 自动安装

给 AI 使用的安装入口：

```text
install.md
scripts/install/install-codex-web-macos.sh
```

这个脚本会处理依赖安装、密码设置、服务启动，以及可选的 launchd 自启动安装。
面向 AI 的完整流程说明写在 [`install.md`](install.md)。

典型的 Codex 对话安装流程：

1. 用户说：`帮我安装 https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`
2. Codex 自动还原仓库根目录并读取 `install.md`
3. Codex 继续问两个问题：
   密码是什么
   要不要安装 launchd 开机自启动
4. Codex 在 macOS 上执行安装脚本
5. Codex 安装仓库自带的 `codex-mobile-report` skill
6. Codex 告诉用户该打开哪个 URL，以及怎样加到手机主屏幕

安装完成后的使用方式：

1. 打开安装脚本打印出来的本机 URL 或局域网 URL
2. 用安装时设置的密码登录
3. 按 PWA 方式添加到手机主屏幕
4. 后续在 Codex 对话里按需要求生成手机可读报告

## 安装报告 Skill

本仓库包含 reports 配套 skill：

```text
skills/codex-mobile-report
```

安装到本机 Codex skills 目录：

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

如果要持续开发这个 skill，建议使用软链接，这样仓库内修改会直接生效：

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

该 skill 会把手机可读的 Markdown 报告或自包含 HTML 报告写入：

```text
~/.codex-web/reports/
```

Codex Web 会通过已鉴权 API 暴露这些报告，并在移动端应用内打开报告链接。

常见用法示例：

```text
请用 codex-mobile-report 给我生成手机可读报告
```

## Codex Web 配置

Web 服务位于 `packages/codex-web`。默认监听 `0.0.0.0:43210`，这样同一局域网
内的手机可以访问主机；所有运行时状态都保存在仓库外。

默认路径：

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/logs/
~/.codex-web/reports/
~/.codex-web/report-index.json
~/.codex-web/uploads/
```

`~/.codex-web/auth.json` 只保存加盐密码哈希和哈希后的 session token。浏览器
只保存不透明 session token。不要把 `CODEX_WEB_PASSWORD` 写入 `service.env`。

首次设置密码：

```bash
npm run codex-web -- auth set-password
```

非交互自动化也支持一次性环境变量。不要把真实密码写进会提交的脚本、env
文件或共享 shell 历史：

```bash
CODEX_WEB_PASSWORD='choose-a-strong-password' npm run codex-web -- auth set-password
```

也可以在首次启动服务时完成初始化：

```bash
CODEX_WEB_PASSWORD='choose-a-strong-password' npm run serve
```

密码配置完成后启动 Web 服务：

```bash
npm run serve
```

如果还没有配置密码，并且启动服务时没有提供 `CODEX_WEB_PASSWORD`，应用会展示
setup-required 页面，直到你执行上面的密码设置命令。

生成的 `~/.config/codex-web/service.env` 默认类似：

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/you/path/to/codex-mobile-web-app
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
```

如需修改监听地址、端口、默认工作目录或 Codex 可执行文件路径，编辑
`~/.config/codex-web/service.env`。如果只允许本机访问：

```env
CODEX_WEB_HOST=127.0.0.1
```

## Runtime 状态和报错

message 输入框上方的状态表示 runtime 状态，不只是请求 spinner。它会同时根据
实时 turn 事件和刷新后的 session history 校准，所以无论一直停留在 session
页、从外部切回，还是从 session 列表重新进入，都应该保持准确。活跃 turn 显示
为绿色 `Running`；成功结束显示 `Done`；`interrupted`、`cancelled`、`aborted`
这类非成功终止显示 `Stopped`。

会阻断 turn 的 provider/runtime 报错，例如 `401`、`403`、`429` 或 provider
返回 unexpected status，会作为红色 system 消息展示在对话时间线里。这些消息
属于对话内容的一部分，刷新或重新进入 session 后仍会恢复。前端只展示关键
runtime 报错信息，避免把本机文件路径或 stack trace 暴露到界面上。

如果 Codex Web 服务在某个 turn 运行中被重启，Codex 可能会把该 turn 标为
`interrupted`，并且没有 error payload。这时前端会显示 `Stopped`，不会显示红色
报错，因为这是服务生命周期打断，不是 provider/runtime 返回的错误。

## Workspace UI

Codex Web 现在使用 project-first workspace：

- 桌面端是三栏布局：项目栏、按项目过滤后的 session 列表、当前 chat 或新建
  session 工作区。
- 移动端保留 session 列表和 chat 的单列流程，项目入口放在侧滑 drawer 里。
- `All Sessions` 始终可用；选中项目后，先按项目过滤 session，再应用
  `Favorites` 或 `Recents` 视图。
- 托管项目和旧的单用户 session 都会归入同一套项目栏。
- Settings 里可以配置浏览器标题；该标题保存在浏览器本地，并用于 PWA 和
  drawer 品牌展示。

## Attachments

消息输入框支持给下一次 Codex turn 附加文件和图片。上传接口需要鉴权。

项目目录可写时，文件保存到：

```text
<project-cwd>/uploads/<user-id>/
```

如果项目目录不可写，会回退到：

```text
~/.codex-web/uploads/projects/<project-key>/<user-id>/
```

上传响应会返回实际 `localPath`。后端在启动 turn 前会校验附件路径必须位于允许的
upload roots 内。图片会作为 local image 传给 Codex；其他文件会以本机路径形式写
入 turn prompt，方便 Codex 在主机上读取。

上传限制：

```text
32 MiB request body
25 MiB per file
```

## macOS 安装

安装用户级 LaunchAgent：

```bash
scripts/service/install-codex-web-launchd-user.sh
```

该脚本会写入 `~/Library/LaunchAgents/com.ganxing.codex-web.plist`，必要时创建
`~/.config/codex-web/service.env`，使用仓库根目录作为工作目录，并把日志写到
`~/.codex-web/logs/`。

服务管理脚本：

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user-detached.sh
scripts/service/logs-codex-web-launchd-user.sh
```

当需要从 Codex 控制中的运行时里重启 Codex Web 自身时，使用 detached 重启脚本。
它会把 launchd 重启动作放到当前 runtime 进程之外执行，这样当前后端连接被打断
后，重启动作仍能继续完成。

LaunchAgent 使用 `/bin/zsh -lc` 加载 `~/.config/codex-web/service.env`，然后运行：

```bash
npm run serve --workspace packages/codex-web
```

## Linux 安装

Linux 上建议使用用户级 `systemd` 服务运行 Codex Web。

创建服务环境文件：

```bash
mkdir -p ~/.config/codex-web ~/.codex-web/logs
cat > ~/.config/codex-web/service.env <<EOF
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=$(pwd)
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
EOF
chmod 600 ~/.config/codex-web/service.env
```

创建用户服务：

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/codex-web.service <<EOF
[Unit]
Description=Codex Web mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=%h/.config/codex-web/service.env
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
```

启用并启动服务：

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-web.service
systemctl --user status codex-web.service
```

如果你的发行版支持 lingering，并希望用户退出登录后服务仍能启动：

```bash
loginctl enable-linger "$USER"
```

查看日志：

```bash
journalctl --user -u codex-web.service -f
```

如果 Linux 防火墙阻止局域网访问，放行 TCP `43210` 端口，或在
`~/.config/codex-web/service.env` 中修改 `CODEX_WEB_PORT`。

## 作为 PWA 安装到手机

服务启动后，先用手机浏览器打开 Codex Web，并在该设备上完成一次登录。

iPhone / iPad：

1. 用 Safari 打开应用。
2. 点击 `分享`。
3. 点击 `添加到主屏幕`。
4. 从主屏幕图标启动应用。

Android：

1. 用 Chrome 打开应用。
2. 打开浏览器菜单。
3. 点击 `Install app` 或 `Add to Home screen`。
4. 从桌面或应用启动器打开安装后的快捷方式。

更完整的手机安装说明见 [`docs/pwa-setup.md`](docs/pwa-setup.md)。

## 产品方向

第一版目标是单用户移动端 PWA：

- 密码保护访问
- 浏览器 session token 持久化
- Codex turn 实时流
- project-first 桌面 workspace 和移动端项目 drawer
- turn 文件和图片附件
- 命令和文件改动批次卡片
- approval 控制
- 模型和 reasoning 控制
- reports 列表和已鉴权报告查看器
- macOS launchd 与 Linux systemd 启动方案

tunnel 和反向代理配置不属于本仓库范围。
