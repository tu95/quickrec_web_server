import { sendPasswordResetEmail } from '../../_lib/user-auth'
import { buildAuthSecurityBlockResponse } from '../../_lib/auth-security'
import { normalizeAuthApiError } from '../../_lib/auth-error-map'
import { buildPublicUrl } from '../../_lib/public-origin'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim()
    if (!email) {
      return Response.json(
        { success: false, error: '邮箱不能为空' },
        { status: 400 }
      )
    }
    const blocked = await buildAuthSecurityBlockResponse({
      request,
      body,
      scene: 'forgotPassword',
      email
    })
    if (blocked) return blocked
    await sendPasswordResetEmail(email, buildPublicUrl('/login?mode=reset'))
    return Response.json({
      success: true,
      message: '重置密码邮件已发送，请检查邮箱'
    })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'forgotPassword')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
