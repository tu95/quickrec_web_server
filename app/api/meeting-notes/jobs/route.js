import {
  createMeetingJob,
  getRequestOrigin,
  resolveRecordingForMeetingJob
} from '../../_lib/meeting-notes'
import { requireSiteAuth } from '../../_lib/admin-auth'
import {
  consumeMeetingNotesQuota,
  refundMeetingNotesQuota
} from '../../_lib/usage-quota-store'

const QUOTA_EXCEEDED_CODE = 'MEETING_NOTES_QUOTA_EXCEEDED'

// 这个接口主要是创建会议纪要任务，并在失败时回退额度。
export async function POST(request) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  const body = await request.json().catch(() => null)
  const recordingId = String(body?.recordingId || '').trim()
  const fileName = String(body?.fileName || body?.name || '').trim()
  if (!recordingId && !fileName) {
    return Response.json(
      { success: false, error: 'recordingId or fileName is required' },
      { status: 400 }
    )
  }

  const userId = String(auth.user?.id || '')
  let resolvedRecording = null
  try {
    resolvedRecording = await resolveRecordingForMeetingJob(userId, {
      recordingId,
      fileName
    })
  } catch (error) {
    const text = String(error?.message || error)
    const status = text.includes('录音不存在或无权限')
      ? 404
      : (text.includes('recordingId') || text.includes('录音参数无效') || text.includes('录音信息无效'))
        ? 400
        : 500
    return Response.json(
      { success: false, error: text },
      { status }
    )
  }

  let consumedQuota = null
  let shouldRefundQuota = false
  try {
    const quota = await consumeMeetingNotesQuota(userId)
    if (!quota.allowed) {
      return Response.json(
        {
          success: false,
          error: quota.message,
          code: QUOTA_EXCEEDED_CODE,
          limit: quota.limit,
          usedCount: quota.usedCount,
          remaining: quota.remaining
        },
        { status: 403 }
      )
    }
    consumedQuota = quota
    shouldRefundQuota = true
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 503 }
    )
  }

  try {
    const job = await createMeetingJob({
      recordingId,
      fileName,
      origin: getRequestOrigin(request),
      providerId: String(body?.providerId || ''),
      model: String(body?.model || ''),
      promptId: String(body?.promptId || ''),
      userId,
      resolvedRecording
    })
    shouldRefundQuota = false
    return Response.json({
      success: true,
      job,
      quota: consumedQuota
        ? {
            limit: consumedQuota.limit,
            usedCount: consumedQuota.usedCount,
            remaining: consumedQuota.remaining,
            allowed: consumedQuota.allowed,
            message: consumedQuota.message
          }
        : null
    })
  } catch (error) {
    if (shouldRefundQuota) {
      try {
        await refundMeetingNotesQuota(userId)
      } catch (refundError) {
        console.error('[meeting-notes] refund quota failed', String(refundError?.message || refundError))
      }
    }
    const text = String(error?.message || error)
    const status = text.includes('录音不存在或无权限')
      ? 404
      : (text.includes('recordingId') || text.includes('录音参数无效') || text.includes('录音信息无效'))
        ? 400
        : 500
    return Response.json(
      { success: false, error: text },
      { status }
    )
  }
}
