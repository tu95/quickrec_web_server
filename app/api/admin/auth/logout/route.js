import { buildClearUserSessionCookies } from '../../../_lib/user-auth'

export async function POST() {
  const headers = new Headers()
  for (const cookie of buildClearUserSessionCookies()) {
    headers.append('Set-Cookie', cookie)
  }
  return Response.json(
    { success: true },
    { headers }
  )
}
