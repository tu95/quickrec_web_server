import { requireUserAuth } from '../../../_lib/user-auth'
import {
  getMeetingNotesQuotaStatus
} from '../../../_lib/usage-quota-store'

export async function GET(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  try {
    const user = auth.user || null
    const quota = await getMeetingNotesQuotaStatus(String(user?.id || ''))
    return Response.json({
      success: true,
      limit: quota.limit,
      usedCount: quota.usedCount,
      remaining: quota.remaining,
      allowed: quota.allowed,
      message: quota.message
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 503 }
    )
  }
}
