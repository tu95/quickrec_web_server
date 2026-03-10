# 配置池改造记录（2026-03-09）

## 目标

- 系统默认服务改为“管理员共享配置池”。
- 普通用户支持“个人配置池”，可保存多条、切换生效项、删除。
- 运行时统一规则：
  - 优先使用用户当前激活配置
  - 无激活配置时回退到系统默认配置

## 数据库

- 在 `web_server/supabase/schema.sql` 新增：
  - `public.recorder_system_config_profiles`
  - `public.recorder_user_config_profiles`
- 新增索引与约束：
  - 系统配置同一时刻仅允许一条 `is_default=true`
  - 单个用户同一时刻仅允许一条 `is_active=true`
- 为 `public.recorder_user_config_profiles` 增加 RLS：
  - 用户只能读写删自己的 profile

## 后端

- `app/api/_lib/config-store.js`
  - 配置读取切换为 profiles 模型
  - 新增系统配置池和用户配置池的增删改查
  - `readConfigForUser(userId)` 改为运行时统一入口
  - 保留对旧 `recorder_user_configs` 的迁移式兼容
- 新增管理员接口：
  - `GET/POST /api/admin/config-profiles`
  - `PUT/DELETE /api/admin/config-profiles/[id]`
  - `POST /api/admin/config-profiles/[id]/activate`
- 新增用户接口：
  - `GET/POST /api/user/config-profiles`
  - `PUT/DELETE /api/user/config-profiles/[id]`
  - `POST /api/user/config-profiles/[id]/activate`
  - `POST /api/user/config-profiles/activate-default`
- 兼容旧接口：
  - `GET/PUT /api/admin/config` 现在读写系统默认 profile
- `app/api/admin/llm/models/route.js`
  - 支持直接测试当前编辑中的 provider
- `app/api/admin/llm/test/route.js`
  - 支持直接测试当前编辑中的 provider

## 前端

- 新增 `app/config-editor-form.jsx`
  - 抽出可复用的配置编辑表单
- 新增 `app/config-profiles-manager.jsx`
  - 统一实现 profile 列表、切换、保存、删除
- `app/settings/settings-client.jsx`
  - 改为系统配置池管理器
- `app/account/page.js`
  - 增加“我的服务配置”区域
  - 普通用户可新增空白配置、保存到 Supabase、切换当前生效项

## 交互规则

- 管理员 `/settings`
  - 仅管理员可访问
  - 可维护多条系统服务配置
  - 单选当前默认系统配置
- 普通用户 `/account`
  - 可维护多条个人服务配置
  - 单选当前激活配置
  - 可一键回退到系统默认服务
- 用户编辑个人配置时：
  - 不暴露系统默认 secret
  - 避免保存时把系统密钥误写入用户 profile

## 验证

- `npm run build` 通过
- 后续仍需在 Supabase 执行最新 `web_server/supabase/schema.sql`
- 新功能依赖新表创建完成后才能真正联通

## 追加修复（LLM 测试与日志）

- `app/api/_lib/runtime-log.js`
  - `ERROR` 级别除了写入 `logs/runtime.log`，也同步输出到控制台
  - 便于直接在 `npm run dev` 日志里看到具体错误
- `app/api/admin/llm/models/route.js`
  - 测试模型列表前，先把前端传回的脱敏 provider 与服务端现有配置做 secret merge
- `app/api/admin/llm/test/route.js`
  - 测试模型连通性前，同样做 secret merge
- `app/config-editor-form.jsx`
  - 获取模型列表、测试连通性时始终传当前 provider，由后端恢复被脱敏的 secret
  - 修复“页面看起来已配置，但测试接口提示 apiKey 未配置”的问题

## 追加优化（服务配置页 UI）

- `app/service-config/page.js`
  - 去掉窄版 `pair-shell` 外壳
  - 改成与 `/settings` 同级的后台页面壳和说明文案
- `app/config-profiles-manager.jsx`
  - 个人服务配置页改为后台双栏布局
  - 左侧固定配置列表，右侧显示配置详情
  - 系统默认设置在普通用户页可见，但只读不可改
  - 用户配置仍支持新增、切换、保存、删除
- `app/config-editor-form.jsx`
  - 只读模式改为整表单 `fieldset disabled`
  - 避免“看起来可编辑但实际不会保存”的假交互
- `app/globals.css`
  - 增加服务配置双栏布局的窄屏响应式规则
  - 手机端自动切成上下布局，避免横向溢出

## 追加调整（配置表单文案与默认 Provider 输入）

- `app/config-profiles-manager.jsx`
  - `新增空白配置` 改为 `新增自定义配置`
  - 新建成功提示同步改为 `已新增自定义配置`
- `app/config-editor-form.jsx`
  - `默认 Provider` 从下拉选择改为手动输入
  - `默认 Model` 继续保持手动输入

## 追加恢复（用户服务配置测试按钮）

- `app/service-config/page.js`
  - 普通用户服务配置页重新开启测试能力
- `app/config-profiles-manager.jsx`
  - 给配置编辑器传入 `testApiScope`
- `app/config-editor-form.jsx`
  - 测试接口按 `admin/user` 作用域切换
- 新增用户测试接口：
  - `app/api/user/llm/models/route.js`
  - `app/api/user/llm/test/route.js`
  - `app/api/user/aliyun/oss/test/route.js`
  - `app/api/user/aliyun/asr/test/route.js`
  - 普通用户现在可以测试自己正在编辑的配置
  - 系统默认配置仍然只读且不提供测试入口

## 追加修复（测试时按当前编辑 Profile 恢复 Secret）

- `app/api/_lib/config-store.js`
  - 新增按 `profileId` 读取单条系统配置/个人配置的方法
- `app/config-profiles-manager.jsx`
  - 编辑器现在会收到当前选中的 `profileId`
- `app/config-editor-form.jsx`
  - 测试请求现在会携带 `profileId/profileScope`
- 管理员与用户的 LLM/OSS/ASR 测试接口
  - 不再以全局生效配置作为 secret merge 基准
  - 改为按当前正在编辑的那条 profile 恢复脱敏 secret
  - 修复“页面已加载出密钥但测试仍提示 AccessKey 为空 / Api key invalid”的问题

## 追加优化（顶部导航交互）

- `app/home-auth-actions.jsx`
  - 顶部导航改为“主导航 + 工具操作”双分组
  - 使用 `Link + usePathname` 即时激活，不再依赖 `window.popstate`
  - 将 `退出登录` 从主导航中分离到工具区
- `app/globals.css`
  - 顶部导航从单行弱高亮改为胶囊式强高亮
  - 桌面端采用两区布局，移动端自动分两行并保持可横向滑动
  - 提升当前页面辨识度与误触容错

## 追加调整（AI服务配置与偏好设置拆分）

- `app/home-auth-actions.jsx`
  - 顶部导航文案 `服务配置` 改为 `AI服务配置`
  - 新增 `偏好设置` tab，并放在 `获取安装包` 与 `账户` 之间
- `app/service-config/page.js`
  - 页面定位改为系统 AI 服务配置只读展示
- `app/service-config/system-ai-config-client.jsx`
  - 新增系统默认 AI 配置只读客户端组件
  - 从 `/api/user/config-profiles` 读取 `systemDefaultProfile` 展示
- `app/preferences/page.js`
  - 新增偏好设置页，承接用户配置管理能力（新增/编辑/删除/切换/测试）

## 追加回滚（导航最小改动收敛）

- 根据最新需求收敛为最小改动：
  - 顶部 tab 文案 `服务配置` 改为 `AI服务配置`
  - 导航位置调整为 `获取安装包` 与 `账户` 之间
- 回滚本轮误扩展：
  - 删除 `app/preferences/page.js`
  - 删除 `app/service-config/system-ai-config-client.jsx`
  - `app/service-config/page.js` 恢复为用户配置管理页

## 追加调整（移除左侧用户配置分组）

- `app/config-profiles-manager.jsx`
  - 删除左侧服务分组里的 `用户配置(⚡)` 入口
  - 删除该分组对应的摘要文案分支
  - 默认只读提示补充 `Prompt` 分组文案

## 追加调整（隐藏服务配置页标题块）

- `app/config-profiles-manager.jsx`
  - 新增 `hideHeader` 参数，支持按页面隐藏顶部标题说明区
- `app/service-config/page.js`
  - 启用 `hideHeader={true}`，删除“我的用户配置 + 说明文案”这段头部元素
