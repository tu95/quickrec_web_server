import { requireAdminAuth } from '../../_lib/admin-auth'
import { readConfig, writeConfig } from '../../_lib/config-store'
import { validateOssConfig } from '../../../../lib/aliyun-validators'

export async function GET(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  const config = await readConfig()
  return Response.json({ success: true, config })
}

export async function PUT(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
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
  const nextPayload = payload
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
    const saved = await writeConfig(nextPayload)
    return Response.json({ success: true, config: saved })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
