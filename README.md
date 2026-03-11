# 录音文件上传服务器 (Next.js)

简单的 Next.js 服务器，用于接收 Zepp App 上传的录音文件。

## 用法
### 1. 首次安装

```bash
cd web_server
npm install
```

### 1.1 环境变量（含 Supabase Auth）

```bash
cp .env.example .env.local
```

至少要填写以下变量后再启动：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`（或 `SUPABASE_PUBLISHABLE_KEY`）
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_PUBLIC_ORIGIN`（本地开发请固定为 `http://localhost:3000`）

建议同时配置以下安全变量（本地默认值）：
- `TRUST_PROXY=false`
- `TRUST_PROXY_CIDRS=`（留空）
- `COOKIE_SECURE=false`（本地 http 必须为 false）
- `USER_SESSION_TTL_SEC=86400`（登录态默认 24h）
- `SUPABASE_AUTH_TIMEOUT_MS=3200`（Auth 请求超时）
- `SUPABASE_AUTH_RETRY_MAX=2`（Auth 网络失败重试次数）
- `SUPABASE_AUTH_RETRY_DELAY_MS=180`（Auth 重试间隔毫秒）
- `ADMIN_SETTINGS_TOKEN=`（可选，设置后管理设置页改为私有路径 `/settings/<token>`，公开 `/settings` 返回 404）

配对码默认有效期为 `1小时`（`PAIR_CODE_TTL_SEC=3600`），可按需在 `.env.local` 调整。
也支持别名变量 `PAIR_TTL_SECONDS=3600`（优先生效）。
配对失败保护默认值：
- `PAIR_MAX_FAILS=30`
- `PAIR_LOCK_SECONDS=180`

手机到服务端分片上传支持批量模式，默认每次请求 `1024KB`：
- `WATCH_UPLOAD_BATCH_MAX_BYTES=1048576`
- `WATCH_UPLOAD_BATCH_MAX_CHUNKS=16`

管理员设置页私有路径示例（推荐开启）：

```bash
ADMIN_SETTINGS_TOKEN=your_random_token
# 访问路径：
# http://localhost:3000/settings/your_random_token
```

邮箱注册/找回由 **Supabase Auth** 完成。  
如果你要用 Brevo 提升邮件频率，请在 Supabase 控制台配置 **Auth -> SMTP -> Enable custom SMTP**：
- Host: `smtp-relay.brevo.com`
- Port: `587`
- Username: `BREVO_SMTP_LOGIN`
- Password: `BREVO_SMTP_KEY`
- Sender: `BREVO_SMTP_SENDER_EMAIL` / `BREVO_SMTP_SENDER_NAME`

说明：`BREVO_*` 变量是便于团队统一记录配置，不会被 `web_server` 直接读取发信。

### 2. 开发模式（前台）

```bash
npm run dev
```
服务器默认监听 `3000` 端口（例如 `http://你的IP:3000`）。  
如果你做了反向代理/公网映射，请在 Zepp 端填写你的实际公网地址与端口。

若开发时出现 `Invalid hook call` / `Cannot read properties of null (reading 'useContext')`：

```bash
npm run clean
npm run dev
```

并确认：
- `APP_PUBLIC_ORIGIN=http://localhost:3000`
- 浏览器使用同一域名访问（避免在 `localhost` 和 `127.0.0.1` 间来回切换）

### 3. 生产模式（后台 + 崩溃诊断）

```bash
npm run build
npm run start:bg
```

说明：
- 不做保活自动重启，服务崩溃后会退出。
- 会记录退出码/信号，便于定位崩溃原因。
- 如有 Node 致命错误，会额外生成诊断报告 `logs/node-report.*.json`。

### 4. 查看日志与崩溃原因

```bash
# Next 服务日志（stdout/stderr，先回看最近 200 行再持续跟踪）
npm run logs:start

# 诊断日志（退出码/退出信号，如 SIGKILL，先回看最近 200 行再持续跟踪）
npm run logs:supervisor
```

如果只想一次性看最近错误，不跟踪：

```bash
tail -n 300 logs/start.log
tail -n 100 logs/supervisor.log
```

### 5. 停止后台服务

```bash
npm run stop:bg
```

### 6. 机型预览安装二维码（本地生成 + React 页面展示）

说明：
- 生成动作依赖本机 `zeus`，请在你有 Zepp 开发环境的电脑执行。
- 服务器不需要安装 `zeus`，只负责托管生成结果数据与二维码图片。
- 页面入口：`http://你的IP:3000/preview_package`（Next.js React 页面，首页也有“测试安装”按钮）。

先在项目根目录安装脚本依赖（只需一次）：

```bash
cd ..
npm install
```

在项目根目录执行批量生成：

```bash
npm run preview:packages
# 等价命令：
# node scripts/preview/generate-preview-packages.mjs
# 指定并发（默认 4，范围 1-8）：
# npm run preview:packages -- --concurrency 4
```

生成产物：
- `web_server/public/preview_package/preview-packages.json`（机型与安装链接索引）
- `web_server/public/preview_package/qrcodes/*.png`（二维码图片）
- `web_server/public/preview_package/logs/*.log`（每个 target 的原始构建日志）

仅初始化 `preview-packages.json` 骨架（不执行 zeus）：

```bash
node scripts/preview/generate-preview-packages.mjs --scaffold-only
```

target 说明：
- 脚本会自动做机型别名映射（如 `Active 2 (Round)` -> `Amazfit Active 2 (Round)`）。
- 若当前 `zeus` 版本不支持某机型，脚本会跳过并在 `preview-packages.json` 里写入失败原因与建议 target，不会卡在交互选择。
- 安装链接协议是 `zpkd1://...`（Zepp 安装协议），不是 `http(s)`。

## API

### POST /api/upload

上传文件。使用 `multipart/form-data` 格式，字段名为 `file`。
当上传的是 `.opus` 时，服务端会自动转换为同名 `.mp3`，并仅保留 `.mp3` 文件；响应中的 `url` 默认返回 `.mp3` 地址。
转码采用单线程队列执行，多任务会自动排队，避免并发打满机器。

**响应示例：**
```json
{
  "success": true,
  "filename": "recording_1234567890.mp3",
  "size": 38456,
  "url": "http://your-domain-or-ip[:port]/api/files/recording_1234567890.mp3"
}
```

### GET /api/upload

健康检查。

### POST /api/upload-test

专用测试上传接口（JSON），用于客户端快速验证“上传链路是否可用”。  
支持字段：`fileName`、`text`、`data`（base64）。

### POST /api/upload-chunk

分片上传接口（JSON）。服务端会按顺序拼接 chunk 并生成最终音频文件。
当最终文件为 `.opus` 时，服务端会自动转换为同名 `.mp3`，并仅保留 `.mp3` 文件；响应中的 `url` 默认返回 `.mp3` 地址。
转码采用单线程队列执行，多任务会自动排队，避免并发打满机器。

### POST /api/convert-mp3

将手表录制的 `.opus` 文件转为 `.mp3`（转换成功后会删除源 `.opus`）。请求体示例：

```json
{
  "name": "20260212_16-47-14.opus"
}
```

注意：该接口依赖 Node 库 `opusscript`，并要求系统安装 `ffmpeg`。  
首次部署请在 `web_server` 目录执行：

```bash
npm i opusscript
```

### POST /api/meeting-notes/jobs

创建会议纪要任务（JSON: `fileName`）。

### GET /api/meeting-notes/jobs/{id}

查询会议纪要任务状态。

### POST /api/meeting-notes/jobs/{id}/cancel

取消会议纪要任务。

### GET /api/meeting-notes/{id}

获取纪要 Markdown。

### GET /api/meeting-notes/{id}/asr

获取 ASR 原文存档。

### GET /api/files

获取上传文件列表（包含 `category`，可用于区分 `recording` 与 `test`）。

### GET /api/files/{name}

下载或在线播放指定文件。

### DELETE /api/files/{name}

删除指定文件。删除 `.opus` 或 `.mp3` 时会同时尝试删除同名对应文件。

## 配置

修改 `app/api/upload/route.js` 中的以下常量：

- `UPLOAD_DIR`: 文件保存路径
- `maxFilesSize`: 最大文件大小（默认 50MB）

<!-- TEST_USER_CREDENTIALS_START -->
## 普通用户测试账号（自动维护）

- 邮箱: `test@test.com`
- 密码: `t4E5V25iN1fzfZBBjC6DeAA!9`
- 权限: 普通用户（非管理员）
- 用途: 每次联调/回归时使用该账号从普通用户视角测试

> 如需重置：在 `web_server` 目录执行 `npm run ensure:test-user`。
<!-- TEST_USER_CREDENTIALS_END -->
