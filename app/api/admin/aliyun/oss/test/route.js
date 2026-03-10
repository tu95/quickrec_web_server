import OSS from 'ali-oss'
import { requireAdminAuth } from '../../../../_lib/admin-auth'
import { getSystemConfigProfileById, mergeConfigWithSecretPreserve } from '../../../../_lib/config-store'
import { logRuntimeError } from '../../../../_lib/runtime-log'
import { validateOssConfig } from '../../../../../../lib/aliyun-validators'

export const runtime = 'nodejs'

function pickAliyunConfig(body, baseConfig) {
  if (body?.aliyun && typeof body.aliyun === 'object') {
    return mergeConfigWithSecretPreserve(baseConfig, { aliyun: body.aliyun }).aliyun || {}
  }
  return baseConfig?.aliyun || {}
}

export async function POST(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const profileId = String(body?.profileId || '').trim()
  const baseConfig = profileId
    ? (await getSystemConfigProfileById(profileId, auth.user?.id)).config
    : auth.config
  const aliyun = pickAliyunConfig(body, baseConfig)
  const oss = aliyun?.oss || {}
  const validation = validateOssConfig(oss)
  if (!validation.valid) {
    return Response.json(
      {
        success: false,
        error: 'OSS 配置校验失败',
        fields: validation.errors
      },
      { status: 400 }
    )
  }

  try {
    const normalizedOss = validation.normalized
    const region = normalizedOss.region
    const bucket = normalizedOss.bucket
    const accessKeyId = normalizedOss.accessKeyId
    const accessKeySecret = normalizedOss.accessKeySecret
    const endpoint = normalizedOss.endpoint

    const client = new OSS({
      region,
      bucket,
      endpoint: endpoint || undefined,
      accessKeyId,
      accessKeySecret,
      secure: true
    })

    const result = await client.list({ 'max-keys': 1 })
    const objectCount = Array.isArray(result?.objects) ? result.objects.length : 0
    return Response.json({
      success: true,
      message: `OSS 连通成功，bucket=${bucket}，示例对象数=${objectCount}`,
      detail: {
        bucket,
        region,
        endpoint: endpoint || '',
        objectCount
      }
    })
  } catch (error) {
    await logRuntimeError('aliyun.oss.test.failed', {
      error: String(error?.message || error),
      stack: error?.stack ? String(error.stack) : '',
      profileId,
      region: String(validation.normalized?.region || ''),
      bucket: String(validation.normalized?.bucket || ''),
      endpoint: String(validation.normalized?.endpoint || '')
    })
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
