import {
  buildSiteSessionCookie,
  createSiteToken,
  getSitePassword
} from '../../../_lib/admin-auth'
import { readConfig } from '../../../_lib/config-store'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  const inputKey = String(body?.key || '')
  const config = await readConfig()
  const expectedKey = await getSitePassword(config)
  if (!inputKey || inputKey !== expectedKey) {
    return Response.json(
      { success: false, error: '密钥错误' },
      { status: 401 }
    )
  }

  const token = createSiteToken(expectedKey)
  return Response.json(
    { success: true },
    {
      headers: {
        'Set-Cookie': buildSiteSessionCookie(token)
      }
    }
  )
}
