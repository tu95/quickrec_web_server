import { normalizeAuthApiError } from '../../_lib/auth-error-map'
import {
  loginWithPassword,
  requireUserAuth,
  updatePasswordWithAccessToken
} from '../../_lib/user-auth'

export async function POST(request) {
  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const oldPassword = String(body?.oldPassword || '')
    const newPassword = String(body?.newPassword || '')
    const confirmPassword = String(body?.confirmPassword || '')
    const email = String(auth.user?.email || '').trim()

    if (!oldPassword || !newPassword || !confirmPassword) {
      return Response.json(
        { success: false, error: '请完整填写旧密码和两次新密码' },
        { status: 400 }
      )
    }
    if (!email) {
      return Response.json(
        { success: false, error: '当前账号缺少邮箱信息，暂不支持改密' },
        { status: 400 }
      )
    }
    if (newPassword.length < 6) {
      return Response.json(
        { success: false, error: '新密码至少 6 位' },
        { status: 400 }
      )
    }
    if (newPassword !== confirmPassword) {
      return Response.json(
        { success: false, error: '两次新密码不一致' },
        { status: 400 }
      )
    }
    if (oldPassword === newPassword) {
      return Response.json(
        { success: false, error: '新密码不能与旧密码相同' },
        { status: 400 }
      )
    }

    try {
      await loginWithPassword(email, oldPassword)
    } catch {
      return Response.json(
        { success: false, error: '旧密码不正确' },
        { status: 401 }
      )
    }

    await updatePasswordWithAccessToken(auth.accessToken, newPassword)
    return Response.json({ success: true })
  } catch (error) {
    const normalized = normalizeAuthApiError(error?.message || error, 'changePassword')
    return Response.json(
      { success: false, error: normalized.error },
      { status: normalized.status }
    )
  }
}
