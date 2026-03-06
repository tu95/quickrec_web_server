import { createMeetingJob, getRequestOrigin } from '../../_lib/meeting-notes'
import { requireSiteAuth } from '../../_lib/admin-auth'

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
  try {
    const job = await createMeetingJob({
      recordingId,
      fileName,
      origin: getRequestOrigin(request),
      providerId: String(body?.providerId || ''),
      model: String(body?.model || ''),
      promptId: String(body?.promptId || ''),
      userId: String(auth.user?.id || '')
    })
    return Response.json({
      success: true,
      job
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
}
