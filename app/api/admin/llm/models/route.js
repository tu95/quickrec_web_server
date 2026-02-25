import { requireAdminAuth } from '../../../_lib/admin-auth'
import { fetchModels } from '../../../_lib/llm-client'
import { logRuntimeError } from '../../../_lib/runtime-log'

function findProvider(config, providerId) {
  const list = Array.isArray(config?.llm?.providers) ? config.llm.providers : []
  return list.find(item => String(item?.id || '') === String(providerId || ''))
}

export async function POST(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status }
    )
  }
  const body = await request.json().catch(() => null)
  const providerId = String(body?.providerId || '')
  const provider = findProvider(auth.config, providerId)
  if (!provider) {
    return Response.json(
      { success: false, error: 'provider not found' },
      { status: 404 }
    )
  }
  try {
    const models = await fetchModels(provider)
    return Response.json({
      success: true,
      providerId,
      models
    })
  } catch (error) {
    await logRuntimeError('llm.models.fetch_failed', {
      providerId,
      providerName: provider?.name || '',
      baseUrl: provider?.baseUrl || '',
      error: String(error?.message || error),
      stack: error?.stack ? String(error.stack) : ''
    })
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
