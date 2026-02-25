import {
  buildSiteSessionCookie,
  createSiteToken,
  getSitePassword
} from '../../_lib/admin-auth'
import { readConfig } from '../../_lib/config-store'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  const inputPassword = String(body?.password || body?.key || '')
  const config = await readConfig()
  const expectedPassword = await getSitePassword(config)

  if (!inputPassword || inputPassword !== expectedPassword) {
    return Response.json(
      { success: false, error: '密码错误' },
      { status: 401 }
    )
  }

  const token = createSiteToken(expectedPassword)
  return Response.json(
    { success: true },
    {
      headers: {
        'Set-Cookie': buildSiteSessionCookie(token)
      }
    }
  )
}

