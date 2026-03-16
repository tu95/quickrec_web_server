import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { requireSiteAuth } from '../../../../_lib/admin-auth'
import { getUserConfigProfileById, mergeConfigWithSecretPreserve } from '../../../../_lib/config-store'
import { logRuntimeError } from '../../../../_lib/runtime-log'
import { validateOssConfig } from '../../../../../../lib/aliyun-validators'

export const runtime = 'nodejs'

function pickAliyunConfig(body, baseConfig) {
  if (body?.aliyun && typeof body.aliyun === 'object') {
    return mergeConfigWithSecretPreserve(baseConfig, { aliyun: body.aliyun }).aliyun || {}
  }
  return baseConfig?.aliyun || {}
}

function createClient(normalized) {
  return new S3Client({
    region: normalized.region || 'auto',
    endpoint: `https://${normalized.endpoint}`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: normalized.accessKeyId,
      secretAccessKey: normalized.accessKeySecret
    }
  })
}

export async function POST(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const profileId = String(body?.profileId || '').trim()
  const baseConfig = profileId
    ? (await getUserConfigProfileById(auth.user?.id, profileId)).config
    : auth.config
  const aliyun = pickAliyunConfig(body, baseConfig)
  const oss = aliyun?.oss || {}
  const validation = validateOssConfig(oss)
  if (!validation.valid) {
    return Response.json(
      {
        success: false,
        error: '对象存储配置校验失败',
        fields: validation.errors
      },
      { status: 400 }
    )
  }

  try {
    const normalizedOss = validation.normalized
    const client = createClient(normalizedOss)
    const result = await client.send(new ListObjectsV2Command({
      Bucket: normalizedOss.bucket,
      MaxKeys: 1
    }))
    const objectCount = Array.isArray(result?.Contents) ? result.Contents.length : 0
    return Response.json({
      success: true,
      message: `对象存储连通成功，bucket=${normalizedOss.bucket}，示例对象数=${objectCount}`,
      detail: {
        bucket: normalizedOss.bucket,
        region: normalizedOss.region,
        endpoint: normalizedOss.endpoint || '',
        objectCount
      }
    })
  } catch (error) {
    await logRuntimeError('user.aliyun.oss.test.failed', {
      userId: String(auth.user?.id || ''),
      profileId,
      error: String(error?.message || error),
      stack: error?.stack ? String(error.stack) : '',
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
