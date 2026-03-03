import { requireAdminAuth } from '../../_lib/admin-auth'
import {
  mergeConfigWithSecretPreserve,
  sanitizeConfigForClient,
  writeConfigForUser
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
  return Response.json({
    success: true,
    config: sanitizeConfigForClient(auth.config),
    role: auth.role || 'admin',
    readOnly: auth.readOnly === true
  })
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
        error: 'OSS 配置校验失败',
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
    const userId = String(auth.user?.id || '').trim()
    const saved = await writeConfigForUser(userId, nextPayload)
    return Response.json({ success: true, config: sanitizeConfigForClient(saved) })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
