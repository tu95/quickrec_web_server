import { requireAdminAuth } from '../../../../_lib/admin-auth'
import {
  DASHSCOPE_ASR_DEFAULT_TEST_FILE_URL,
  extractAsrTaskStatus,
  queryDashscopeAsrTask,
  submitDashscopeAsrTask
} from '../../../../_lib/aliyun-test'
import { logRuntimeError } from '../../../../_lib/runtime-log'

function pickAliyunConfig(body, authConfig) {
  if (body?.aliyun && typeof body.aliyun === 'object') return body.aliyun
  return authConfig?.aliyun || {}
}

export async function POST(request) {
  const auth = await requireAdminAuth(request)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const aliyun = pickAliyunConfig(body, auth.config)
  const asr = aliyun?.asr || {}

  try {
    const baseUrl = String(asr?.baseUrl || '').trim()
    const apiKey = String(asr?.apiKey || '').trim()
    const model = String(asr?.model || '').trim()
    const submitPath = String(asr?.submitPath || '').trim()
    const queryPathTemplate = String(asr?.queryPathTemplate || '').trim()
    const languageHints = Array.isArray(asr?.languageHints)
      ? asr.languageHints.map(item => String(item || '').trim()).filter(Boolean)
      : []
    const requestExtraParams = asr?.requestExtraParams && typeof asr.requestExtraParams === 'object'
      ? asr.requestExtraParams
      : {}
    const diarizationEnabled = asr?.diarizationEnabled !== false
    const speakerCount = Number(asr?.speakerCount)
    const testFileUrl = String(asr?.testFileUrl || DASHSCOPE_ASR_DEFAULT_TEST_FILE_URL).trim()

    const submitResult = await submitDashscopeAsrTask({
      baseUrl,
      submitPath,
      apiKey,
      model,
      fileUrls: [testFileUrl],
      languageHints,
      requestExtraParams,
      diarizationEnabled,
      speakerCount
    })
    const queryPayload = await queryDashscopeAsrTask({
      baseUrl,
      queryPathTemplate,
      apiKey,
      taskId: submitResult.taskId
    })
    const detail = extractAsrTaskStatus(queryPayload)
    const failedSubtask = detail.failedSubtask
    if (failedSubtask) {
      const code = String(failedSubtask?.code || '')
      const message = String(failedSubtask?.message || '')
      const errorText = [code, message].filter(Boolean).join(' ')
      throw new Error(`ASR 子任务失败: ${errorText || '未知错误'}`)
    }

    return Response.json({
      success: true,
      message: `ASR 连通成功，task_id=${submitResult.taskId}，当前状态=${detail.taskStatus || 'UNKNOWN'}`,
      detail: {
        baseUrl,
        model,
        submitPath,
        queryPathTemplate,
        taskId: submitResult.taskId,
        taskStatus: detail.taskStatus || 'UNKNOWN',
        transcriptionUrl: detail.transcriptionUrl || '',
        failedSubtask: null,
        diarizationEnabled
      }
    })
  } catch (error) {
    await logRuntimeError('aliyun.asr.test.failed', {
      error: String(error?.message || error),
      stack: error?.stack ? String(error.stack) : '',
      baseUrl: String(asr?.baseUrl || ''),
      model: String(asr?.model || '')
    })
    return Response.json(
      { success: false, error: `ASR 测试失败: ${String(error?.message || error)}` },
      { status: 500 }
    )
  }
}
