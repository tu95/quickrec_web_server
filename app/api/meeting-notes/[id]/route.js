import { getMeetingNote } from '../../_lib/meeting-notes'
import { requireSiteAuth } from '../../_lib/admin-auth'

export async function GET(request, { params }) {
  const auth = await requireSiteAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  const id = String(params?.id || '')
  if (!id) {
    return Response.json(
      { success: false, error: 'invalid note id' },
      { status: 400 }
    )
  }
  try {
    const note = await getMeetingNote(id)
    if (!note) {
      return Response.json(
        { success: false, error: 'note not found' },
        { status: 404 }
      )
    }
    const format = String(new URL(request.url).searchParams.get('format') || '').toLowerCase()
    if (format === 'json') {
      return Response.json({
        success: true,
        note
      })
    }
    return new Response(note.markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8'
      }
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
