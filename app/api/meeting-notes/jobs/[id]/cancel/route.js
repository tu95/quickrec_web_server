import { cancelMeetingJob } from '../../../../_lib/meeting-notes'
import { requireSiteAuth } from '../../../../_lib/admin-auth'

export async function POST(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }

  const routeParams = await params
  const id = String(routeParams?.id || '')
  if (!id) {
    return Response.json(
      { success: false, error: 'invalid job id' },
      { status: 400 }
    )
  }

  const job = await cancelMeetingJob(id, String(auth.user?.id || ''))
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
