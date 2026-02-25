import { getMeetingJob } from '../../../_lib/meeting-notes'
import { requireSiteAuth } from '../../../_lib/admin-auth'

export async function GET(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  const id = String(params?.id || '')
  const job = await getMeetingJob(id)
  if (!job) {
    return Response.json(
      { success: false, error: 'job not found' },
      { status: 404 }
    )
  }
  return Response.json({
    success: true,
    job
  })
}
