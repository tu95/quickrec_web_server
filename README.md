# 录音文件上传服务器 (Next.js)

简单的 Next.js 服务器，用于接收 Zepp App 上传的录音文件。

## 快速开始

```bash
cd server
npm install
npm run dev
```

服务器默认监听 `3000` 端口（例如 `http://你的IP:3000`）。  
如果你做了反向代理/公网映射，请在 Zepp 端填写你的实际公网地址与端口。

## API

### POST /api/upload

上传文件。使用 `multipart/form-data` 格式，字段名为 `file`。
当上传的是 `.opus` 时，服务端会自动转换为同名 `.wav`，响应中的 `url` 默认优先返回 `.wav` 地址。

**响应示例：**
```json
{
  "success": true,
  "filename": "recording_1234567890.opus",
  "size": 102456,
  "url": "http://your-domain-or-ip[:port]/api/files/recording_1234567890.opus"
}
```

### GET /api/upload

健康检查。

### POST /api/upload-test

专用测试上传接口（JSON），用于客户端快速验证“上传链路是否可用”。  
支持字段：`fileName`、`text`、`data`（base64）。

### POST /api/upload-chunk

分片上传接口（JSON）。服务端会按顺序拼接 chunk 并生成最终音频文件。
当最终文件为 `.opus` 时，服务端会自动转换为同名 `.wav`，响应中的 `url` 默认优先返回 `.wav` 地址。

### POST /api/convert-wav

将手表录制的 `.opus` 文件转为 `.wav`。请求体示例：

```json
{
  "name": "20260212_16-47-14.opus"
}
```

注意：该接口依赖 Node 库 `opusscript` 与 `wav`。  
首次部署请在 `server` 目录执行：

```bash
npm i opusscript wav
```

### GET /api/files

获取上传文件列表（包含 `category`，可用于区分 `recording` 与 `test`）。

### GET /api/files/{name}

下载或在线播放指定文件。

### DELETE /api/files/{name}

删除指定文件。删除 `.opus` 时会同时尝试删除同名 `.wav`（并兼容删除历史同名 `.mp3`）。

## 配置

修改 `app/api/upload/route.js` 中的以下常量：

- `UPLOAD_DIR`: 文件保存路径
- `maxFilesSize`: 最大文件大小（默认 50MB）
