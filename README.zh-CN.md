# Codex Mobile Web App

[English](README.md) | 中文

这是一个自托管 Web 控制台，用来从手机、平板或桌面浏览器控制本机已经登录的
Codex runtime。

浏览器只是远程 UI。Mac 或 Linux 主机负责保存 Codex 凭据、启动 Codex
runtime、读写本地项目文件、执行 shell 命令，以及保存应用状态。公网访问、
tunnel、反向代理不属于本仓库范围。

> 让 Codex 直接安装：
> `帮我安装 https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`

## 功能概览

- 密码保护的单主机 Codex Web 控制台。
- 适合手机安装的 PWA，按设备持久保存浏览器 session。
- project-first workspace：桌面端是项目栏、session 列表、chat 三栏；移动端是
  项目 drawer。
- Codex turn 实时流：assistant delta、最终回答、命令批次、文件改动批次、
  approval 请求和 runtime 报错。
- 多用户/RBAC facade：项目授权、admin 管理、observer mode、只读分享链接。
- turn 文件和图片附件。后端在本机保存文件，并把安全 local path 交给 Codex。
- 已鉴权 reports 列表和报告查看器，以及仓库自带的 `codex-mobile-report`
  skill。
- macOS launchd 和 Linux systemd 服务脚本。
- English / 简体中文 UI 语言设置，以及 admin/单用户可管理的站点标题。

## 仓库结构

```text
packages/codex-native-api   可复用 Codex app-server 集成层
packages/codex-web          HTTP API、auth、runtime bridge 和 Web UI
scripts/install             面向 AI 的安装脚本
scripts/service             launchd 服务脚本
skills/codex-mobile-report  配套报告 skill
docs/superpowers/specs      设计文档
docs/superpowers/plans      实现计划
docs/rendering              本地 Markdown/report 渲染验证材料
```

本仓库从 `CodexBridge-main` 拆分出来。

## 环境要求

- Node.js `>=24`
- npm
- 已安装本机 Codex CLI
- 本机 Codex 登录态位于 `~/.codex/auth.json` 或 `CODEX_HOME/auth.json`

## 快速开始

安装依赖：

```bash
npm install
```

设置 Web 密码：

```bash
npm run codex-web -- auth set-password
```

启动 Web 服务：

```bash
npm run serve
```

默认监听 `0.0.0.0:43210`，同一局域网内的手机可以访问。打开输出的本机 URL
或局域网 URL，用刚设置的密码登录。

运行检查：

```bash
npm run typecheck
npm test
```

## AI 安装入口

如果你希望让 Codex 或其他 coding agent 安装这个项目，请使用根目录的
[install.md](install.md)。它适用于 GitHub blob 链接和本地 checkout。

约定的 agent 行为：

- 如果用户发来 GitHub `README.md` 或 `install.md` blob 链接，先还原仓库根
  目录，再执行 `install.md`。
- 如果用户在本地 checkout 里说“帮我安装这个项目”，先定位仓库根目录，再执行
  `install.md`。
- macOS 上先询问 Web 密码，以及是否安装 launchd 开机自启动。
- Windows 上停止安装，并说明当前仓库没有 Windows 安装器。

macOS 自动安装流使用：

```text
install.md
scripts/install/install-codex-web-macos.sh
```

安装脚本会处理依赖安装、密码设置、服务启动、可选 launchd 自启动，以及安装仓库
自带的 report skill。

## 配置

运行时状态保存在仓库外。

默认路径：

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/logs/
~/.codex-web/reports/
~/.codex-web/report-index.json
~/.codex-web/uploads/
```

`~/.codex-web/auth.json` 只保存加盐密码哈希和哈希后的 session token。浏览器只
保存不透明 session token。不要把 `CODEX_WEB_PASSWORD` 写入 `service.env`。

非交互首次启动支持一次性环境变量：

```bash
CODEX_WEB_PASSWORD='choose-a-strong-password' npm run serve
```

生成的 service env 默认类似：

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/you/path/to/codex-mobile-web-app
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
```

如需修改监听地址、端口、默认工作目录或 Codex 可执行文件，编辑
`~/.config/codex-web/service.env`。如果只允许本机访问：

```env
CODEX_WEB_HOST=127.0.0.1
```

## 附件

消息输入框可以为下一次 Codex turn 上传文件和图片。所有上传接口都需要鉴权。

项目目录可写时：

```text
<project-cwd>/uploads/<user-id>/
```

回退存储：

```text
~/.codex-web/uploads/projects/<project-key>/<user-id>/
```

后端会返回实际 `localPath`，并在启动 turn 前校验附件路径必须位于允许的 upload
roots 内。图片会作为 local image 传给 Codex；其他文件会以本机路径形式写入
turn prompt。

上传限制：

```text
32 MiB request body
25 MiB per file
```

## 报告 Skill

配套 skill 位于：

```text
skills/codex-mobile-report
```

安装到本机 Codex skills：

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

开发时建议使用软链接：

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

该 skill 会把手机可读 Markdown 或自包含 HTML 报告写入
`~/.codex-web/reports/`。Codex Web 会通过已鉴权 API 暴露这些报告，并在应用内
打开报告链接。

## Runtime 状态

输入框上方的状态表示 runtime 状态，不只是请求 spinner。它会根据实时 turn 事件
和刷新后的 session history 校准。

- 活跃 turn 显示 `Running`。
- 成功结束显示 `Done`。
- `interrupted`、`cancelled`、`aborted` 显示 `Stopped`。
- `401`、`403`、`429` 或 unexpected provider status 等 provider/runtime 报错
  会作为红色 system 消息展示在时间线中。

如果 Codex Web 服务在 turn 运行中重启，Codex 可能把该 turn 标为
`interrupted` 且没有 error payload。此时 UI 显示 `Stopped`，不显示红色报错，
因为这是服务生命周期打断。

## 服务安装

### macOS launchd

安装用户级 LaunchAgent：

```bash
scripts/service/install-codex-web-launchd-user.sh
```

服务管理脚本：

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user-detached.sh
scripts/service/logs-codex-web-launchd-user.sh
```

当需要从 Codex 控制中的运行时重启 Codex Web 自身时，使用 detached 重启脚本。

### Linux systemd

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

创建并启动用户服务：

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

systemctl --user daemon-reload
systemctl --user enable --now codex-web.service
systemctl --user status codex-web.service
```

查看日志：

```bash
journalctl --user -u codex-web.service -f
```

## 安装为 PWA

服务启动后，用手机浏览器打开 Codex Web，并在该设备上完成一次登录。

iPhone / iPad：用 Safari 打开，点 `分享`，再点 `添加到主屏幕`。

Android：用 Chrome 打开，打开浏览器菜单，再点 `Install app` 或
`Add to Home screen`。

更多说明见 [docs/pwa-setup.md](docs/pwa-setup.md)。

## 设计文档

当前设计和实现记录：

```text
docs/superpowers/specs/2026-05-17-codex-mobile-web-app-design.md
docs/superpowers/specs/2026-05-19-codex-mobile-reports-design.md
docs/superpowers/specs/2026-05-23-codex-web-desktop-workspace-design.md
docs/superpowers/specs/2026-05-27-codex-web-multi-user-rbac-design.md
docs/superpowers/specs/2026-05-28-role-project-new-session-design.md
docs/superpowers/specs/2026-05-29-codex-web-workspace-redesign-design.md
docs/superpowers/specs/2026-05-30-codex-web-attachments-design.md
docs/superpowers/specs/2026-06-01-session-card-first-message-design.md

docs/superpowers/plans/2026-05-17-codex-web-mvp.md
docs/superpowers/plans/2026-05-23-codex-web-desktop-workspace.md
docs/superpowers/plans/2026-05-27-codex-web-multi-user-rbac.md
docs/superpowers/plans/2026-05-28-role-project-new-session.md
docs/superpowers/plans/2026-05-29-codex-web-workspace-redesign.md
docs/superpowers/plans/2026-05-30-codex-web-attachments.md
docs/superpowers/plans/2026-06-01-session-card-first-message.md
docs/superpowers/plans/2026-06-01-timeline-error-ordering.md
```

视觉参考：

```text
docs/assets/codex-web-reference.jpg
```
