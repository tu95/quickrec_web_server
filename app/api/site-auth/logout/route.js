import { buildClearSiteSessionCookie } from '../../_lib/admin-auth'

export async function POST() {
  return Response.json(
    { success: true },
    {
      headers: {
        'Set-Cookie': buildClearSiteSessionCookie()
      }
    }
  )
}

