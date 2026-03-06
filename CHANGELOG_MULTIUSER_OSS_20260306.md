# 多用户隔离 + OSS 化改动记录（2026-03-06）

## 目标
- 文件访问主键从 `fileName` 切换为 `recordingId`。
- 文件列表、纪要任务、删除下载统一按 `user_id` 强隔离。
- 文件下载/播放走 OSS URL（优先签名 URL），不再依赖本地目录扫描。
- 手表上传会话按用户维度隔离，并在上传成功后清理本地临时/成品文件。

## 代码改动

### 1) OSS 与录音元数据能力
- `app/api/_lib/oss-storage.js`
  - 新增 `signOssObjectUrl`（按 objectKey 生成签名 URL）
  - 新增 `deleteOssObject`
- `app/api/_lib/recorder-multiuser-store.js`
  - 新增/完善：
    - `listUserRecordings`
    - `getUserRecordingById`
    - `findLatestUserRecordingByFileName`
    - `deleteUserRecordingById`
  - 增加 UUID 校验，避免非法 `recordingId` 直接打到 DB 报错

### 2) 文件 API（用户隔离 + OSS 访问）
- `app/api/files/route.js`
  - 列表数据来源改为 `recorder_recordings`（按当前登录用户）
  - 不再将本地 `uploads` 作为用户可见主数据源
  - 返回字段增加 `id/downloadUrl/streamUrl/signedUrl/ossUrl/durationSec`
  - 纪要 metadata/job 读取按 `userId` 过滤，避免跨用户串数据
- `app/api/files/[name]/route.js`
  - 路由参数作为 `recordingId` 使用
  - `GET`：校验归属后 302 到 OSS 签名 URL
  - `DELETE`：先删 OSS 对象，再删 DB 元数据；本地仅做 legacy 清理

### 3) 会议纪要任务（按 recordingId）
- `app/api/meeting-notes/jobs/route.js`
  - 支持 `recordingId` 入参（优先）
  - 错误码细化（录音不存在 -> 404，参数错误 -> 400）
- `app/api/meeting-notes/jobs/[id]/cancel/route.js`
  - 取消任务传入当前 `userId` 做归属校验
- `app/api/_lib/meeting-notes.js`
  - `createMeetingJob/runMeetingJob` 走录音元数据（OSS）而非本地文件路径
  - 写入/返回 `recordingId`
  - 修复 `existsFile` 缺失
  - 访问控制默认拒绝（无 owner 或无 requester 均拒绝）

### 4) 前端文件管理页（recordingId 全链路）
- `app/FileManagerClient.jsx`
  - busy/轮询/纪要状态 map 键统一改为 `file.id`
  - 删除、创建纪要、取消纪要统一使用 `recordingId`
  - 下载链接优先使用后端返回的 OSS URL（鼠标悬浮可见 OSS）
  - 播放优先用 `streamUrl`，回退 `/api/files/{recordingId}`
  - 当前播放态用 `fileId` 判断，避免同名文件冲突

### 5) 手表上传链路并发安全与本地清理
- `app/api/watch/upload-chunk/route.js`
  - 上传会话 key 改为 `userId:uploadId`，避免跨用户 `uploadId` 碰撞
  - `.part` 文件名改为 sessionKey 安全格式
  - 异步上传成功后删除本地成品文件（以及转换前源文件）
  - 异步任务快照增加 `recordingId`

## 本次接口测试结果（本地 3000）

### 构建检查
- `npm run build`：通过（两次）

### 未登录态冒烟
- `GET /api/files` -> `401`
- `POST /api/meeting-notes/jobs` -> `401`
- `POST /api/watch/upload-chunk`（空 payload）-> `400`（参数校验）

### 登录态冒烟（临时 Supabase 用户）
- 创建临时用户 -> 成功
- `POST /api/user-auth/login` -> `200`
- `GET /api/files` -> `200`，返回 `{"success":true,"count":0,"files":[]}`
- `POST /api/meeting-notes/jobs`（无效 recordingId）-> `404`（已不再泄露 DB UUID 语法错误）
- 删除临时用户 -> `200`

## 后续修复（纪要页面 404）

- `app/notes/[id]/page.jsx`
  - 页面改为通过受保护 API `/api/meeting-notes/{id}?format=json` 读取纪要。
  - 服务端透传 cookie；未登录时跳转 `/login?next=/notes/{id}`。
  - 避免页面直接调用 `getMeetingNote(noteId)` 时缺少 `userId` 导致误判 404。
- `app/api/_lib/meeting-notes.js`
  - `getMeetingNote` 增加旧数据回填逻辑：当 metadata 缺少 `userId` 时，尝试从 jobs 数据回填 owner 后写回 metadata。

## 后续修复（配置存储改为 Supabase 单路径）

- `app/api/_lib/config-store.js`
  - 配置读取不再依赖本地 `config.json`，统一以 Supabase `recorder_user_configs` 为主。
  - `readConfigForUser` 每次查询 Supabase；用户无记录时自动写入默认配置行并返回。
  - 表缺失时，读取/保存均统一报错：`缺少 recorder_user_configs 表，请先在 Supabase 执行 web_server/supabase/schema.sql`。
  - `writeConfig`（无 userId 的本地写入接口）已停用，避免绕过 Supabase。

## 兼容性说明
- 旧接口路径仍是 `/api/files/[name]`，但参数语义已切为 `recordingId`。
- 旧的本地文件名直链不再是主路径；文件访问应使用列表返回的 `downloadUrl/streamUrl` 或 `recordingId` 路由。
