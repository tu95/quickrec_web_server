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
  const fileName = String(body?.fileName || body?.name || '')
  if (!fileName) {
    return Response.json(
      { success: false, error: 'fileName is required' },
      { status: 400 }
    )
  }
  try {
    const job = await createMeetingJob({
      fileName,
      origin: getRequestOrigin(request),
      providerId: String(body?.providerId || ''),
      model: String(body?.model || ''),
      promptId: String(body?.promptId || '')
    })
    return Response.json({
      success: true,
      job
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
