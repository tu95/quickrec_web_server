import {
  buildSiteSessionCookie,
  createSiteToken,
  getReadonlySitePassword,
  getSitePassword
} from '../../_lib/admin-auth'
import { readConfig } from '../../_lib/config-store'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  const inputPassword = String(body?.password || body?.key || '')
  const config = await readConfig()
  const expectedPassword = await getSitePassword(config)
  const readonlyPassword = await getReadonlySitePassword(config)

  if (!inputPassword) {
    return Response.json(
      { success: false, error: '密码错误' },
      { status: 401 }
    )
  }

  let role = ''
  let signKey = ''
  if (inputPassword === expectedPassword) {
    role = 'admin'
    signKey = expectedPassword
  } else if (inputPassword === readonlyPassword) {
    role = 'readonly'
    signKey = readonlyPassword
  } else {
    return Response.json(
      { success: false, error: '密码错误' },
      { status: 401 }
    )
  }

  const token = createSiteToken(signKey, role)
  return Response.json(
    { success: true, role, readOnly: role !== 'admin' },
    {
      headers: {
        'Set-Cookie': buildSiteSessionCookie(token)
      }
    }
  )
}
