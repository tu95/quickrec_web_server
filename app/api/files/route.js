import { promises as fs } from 'fs'
import { extname, join } from 'path'

const UPLOAD_DIR = join(process.cwd(), 'uploads')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

function getFileCategory(name) {
  const lower = String(name || '').toLowerCase()
  if (lower.startsWith('api_test_')) return 'test'
  if (lower.endsWith('.txt') || lower.endsWith('.json') || lower.endsWith('.log')) return 'test'
  return 'recording'
}

function getBaseName(name) {
  const ext = extname(name)
  if (!ext) return name
  return name.slice(0, -ext.length)
}

export async function GET() {
  try {
    await ensureUploadDir()
    const files = await fs.readdir(UPLOAD_DIR)
    const visibleFiles = files.filter(name => !name.startsWith('.'))
    const lowerNameMap = new Map()
    for (const fileName of visibleFiles) {
      lowerNameMap.set(String(fileName).toLowerCase(), fileName)
    }

    const fileList = await Promise.all(
      visibleFiles
        .map(async (name) => {
          const stat = await fs.stat(join(UPLOAD_DIR, name))
          const ext = extname(name).toLowerCase()
          const baseName = getBaseName(name)

          const pairedWavName = lowerNameMap.get(`${baseName}.wav`.toLowerCase())
          const pairedOpusName = lowerNameMap.get(`${baseName}.opus`.toLowerCase())
          const hasWav = ext === '.opus' && !!pairedWavName
          const hasSourceOpus = ext === '.wav' && !!pairedOpusName
          return {
            name,
            ext,
            size: stat.size,
            sizeFormatted: formatSize(stat.size),
            createdAt: stat.birthtime.getTime(),
            category: getFileCategory(name),
            isTest: getFileCategory(name) === 'test',
            hasWav,
            wavName: hasWav ? pairedWavName : '',
            canConvertToWav: ext === '.opus',
            hasSourceOpus,
            sourceOpusName: hasSourceOpus ? pairedOpusName : '',
            isOpusLocked: ext === '.opus'
          }
        })
    )

    const compactedFileList = fileList.filter(Boolean)
    compactedFileList.sort((a, b) => b.createdAt - a.createdAt)

    return Response.json({
      success: true,
      count: compactedFileList.length,
      files: compactedFileList,
    }, { headers: CORS_HEADERS })
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  })
}
