import { requireAdminAuth } from '../../../_lib/admin-auth'
import { runChat } from '../../../_lib/llm-client'
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
  const model = String(body?.model || '')
  const prompt = String(body?.prompt || '请回复: 连接测试成功')
  const provider = findProvider(auth.config, providerId)
  if (!provider) {
    return Response.json(
      { success: false, error: 'provider not found' },
      { status: 404 }
    )
  }
  try {
    const response = await runChat(provider, {
      model,
      temperature: 0.1,
      maxTokens: 128,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
    return Response.json({
      success: true,
      text: response.text
    })
  } catch (error) {
    await logRuntimeError('llm.test.failed', {
      providerId,
      providerName: provider?.name || '',
      baseUrl: provider?.baseUrl || '',
      model: model || provider?.selectedModel || '',
      error: String(error?.message || error),
      stack: error?.stack ? String(error.stack) : ''
    })
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
