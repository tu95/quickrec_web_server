import { requireAdminAuth } from '../../_lib/admin-auth'
import {
  activateSystemConfigProfile,
  listSystemConfigProfiles,
  mergeConfigWithSecretPreserve,
  sanitizeConfigForClient,
  updateSystemConfigProfile
} from '../../_lib/config-store'
import { validateOssConfig } from '../../../../lib/aliyun-validators'

export async function GET(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  try {
    const profiles = await listSystemConfigProfiles(auth.user?.id)
    const target = profiles.find(item => item.isDefault) || profiles[0] || null
    return Response.json({
      success: true,
      config: sanitizeConfigForClient(target?.config || auth.config || {}),
      role: auth.role || 'admin',
      readOnly: auth.readOnly === true
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}

export async function PUT(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  if (auth.readOnly) {
    return Response.json(
      { success: false, error: '只读账号无权修改设置' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const payload = body && typeof body === 'object' ? (body.config || body) : null
  if (!payload || typeof payload !== 'object') {
    return Response.json(
      { success: false, error: 'invalid config payload' },
      { status: 400 }
    )
  }
  const currentConfig = auth.config || {}
  const nextPayload = mergeConfigWithSecretPreserve(currentConfig, payload)
  const ossValidation = validateOssConfig(nextPayload?.aliyun?.oss || {})
  if (!ossValidation.valid) {
    return Response.json(
      {
        success: false,
        error: '对象存储配置校验失败',
        fields: ossValidation.errors
      },
      { status: 400 }
    )
  }

  nextPayload.aliyun = {
    ...(nextPayload.aliyun || {}),
    oss: {
      ...(nextPayload.aliyun?.oss || {}),
      ...ossValidation.normalized
    }
  }

  try {
    const profiles = await listSystemConfigProfiles(auth.user?.id)
    const target = profiles.find(item => item.isDefault) || profiles[0] || null
    if (!target?.id) {
      throw new Error('系统默认配置不存在')
    }
    const saved = await updateSystemConfigProfile(target.id, nextPayload, auth.user?.id, target.name)
    await activateSystemConfigProfile(target.id, auth.user?.id)
    return Response.json({ success: true, config: sanitizeConfigForClient(saved.config) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
