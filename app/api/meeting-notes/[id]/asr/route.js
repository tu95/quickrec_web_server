import { getMeetingNoteAsr } from '../../../_lib/meeting-notes'
import { requireSiteAuth } from '../../../_lib/admin-auth'

export async function GET(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }

  const id = String(params?.id || '').trim()
  if (!id) {
    return Response.json(
      { success: false, error: 'invalid note id' },
      { status: 400 }
    )
  }

  try {
    const asrArchive = await getMeetingNoteAsr(id, String(auth.user?.id || ''))
    if (!asrArchive) {
      return Response.json(
        { success: false, error: 'asr archive not found' },
        { status: 404 }
      )
    }

    const format = String(new URL(request.url).searchParams.get('format') || '').toLowerCase()
    if (format === 'text') {
      return new Response(String(asrArchive.transcript || ''), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      })
    }

    return Response.json({
      success: true,
      asr: asrArchive
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
