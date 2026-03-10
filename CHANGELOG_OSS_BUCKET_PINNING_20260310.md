# OSS Bucket Pinning 变更记录（2026-03-10）

## 背景

切换 OSS bucket 后，历史录音在列表中仍可见，但播放/下载可能失败。根因是历史记录只保存 `oss_key`，读取时默认使用“当前配置 bucket”，导致跨 bucket 访问错位。

## 本次目标

1. 每条录音记录固化上传时的 bucket。
2. 读取/删除/纪要 ASR 链路按“记录所属 bucket”访问对象。
3. 对历史数据保持兼容（`oss_bucket` 为空时继续使用当前配置 bucket）。

## 数据库改动

文件：`supabase/schema.sql`

- `public.recorder_recordings` 新增字段：
  - `oss_bucket text not null default ''`
- 为兼容已存在表，额外增加：
  - `alter table public.recorder_recordings add column if not exists oss_bucket text not null default '';`

## 代码改动

### 1) 上传写入录音元数据时记录 bucket

- `app/api/_lib/recorder-multiuser-store.js`
  - `insertRecordingMetadata` 写入 `oss_bucket`。
- `app/api/_lib/upload-ingest.js`
  - Web 上传入库时传入 `ossBucket: uploaded.bucket`。
- `app/api/watch/upload-chunk/route.js`
  - 手表链路异步入库时传入 `ossBucket: uploaded.bucket`。

### 2) OSS 访问支持 bucket 覆盖

- `app/api/_lib/oss-storage.js`
  - 新增内部 helper：`withBucketOverride(config, bucketOverride)`。
  - `signOssObjectUrl` 支持 `options.ossBucket`。
  - `getOssObject` 支持 `options.ossBucket`。
  - `deleteOssObject` 支持 `options.ossBucket`。

### 3) 读取/删除/纪要按记录 bucket 访问

- `app/api/files/route.js`
  - 生成签名 URL 时传入 `record.oss_bucket`。
  - 列表返回字段增加 `ossBucket`（便于排查）。
- `app/api/files/[name]/route.js`
  - GET 下载读取对象时传入 `ossBucket`。
  - DELETE 删除对象时传入 `ossBucket`。
- `app/api/_lib/meeting-notes.js`
  - 生成 ASR 音频签名 URL 时传入 `recording.oss_bucket`。

## 兼容策略

- 历史记录 `oss_bucket=''` 时，不会中断：仍使用当前配置 bucket。
- 新上传记录会写入真实 bucket，可跨配置切换稳定访问。

## 建议执行的历史回填 SQL（可选）

> 建议先备份后执行。若你确认历史数据都在当前 bucket，可一次性回填。

```sql
update public.recorder_recordings
set oss_bucket = 'quickrec-cn'
where coalesce(oss_bucket, '') = '';
```

若历史上确实存在多 bucket，建议按时间段或 key 前缀分批回填，避免误填。

## 验证步骤

1. 在 bucket A 上传文件，确认 `recorder_recordings.oss_bucket = A`。
2. 切换配置到 bucket B。
3. 访问历史文件（bucket A）应仍可播放/下载/删除。
4. 新上传文件应落在 bucket B，且可正常访问。

## 风险与回滚

- 风险：若误回填 `oss_bucket`，会导致对应文件访问失败。
- 回滚：将错误记录的 `oss_bucket` 修正为真实 bucket；代码可继续兼容空值读取。
