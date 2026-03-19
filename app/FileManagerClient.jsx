'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCachedApi } from './_lib/use-cached-api'

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function toDurationSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function formatDuration(seconds) {
  const total = toDurationSeconds(seconds)
  if (!total) return '--'
  const sec = total % 60
  const minTotal = Math.floor(total / 60)
  const min = minTotal % 60
  const hour = Math.floor(minTotal / 60)
  const ss = String(sec).padStart(2, '0')
  const mm = String(min).padStart(2, '0')
  if (hour > 0) {
    return `${String(hour).padStart(2, '0')}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

function getDisplayTitle(file) {
  const title = String(file?.latestNoteTitle || '').trim()
  if (title) return title
  return String(file?.name || '').trim()
}

function getFileKey(file) {
  return String(file?.id || '').trim()
}

function isPlayableExt(ext) {
  const e = String(ext || '').toLowerCase()
  return e === '.mp3' || e === '.ogg' || e === '.webm'
}

function isMeetingJobRunning(job) {
  if (!job || typeof job !== 'object') return false
  const status = String(job.status || '').toLowerCase()
  return status === 'queued' || status === 'running'
}

function getMeetingJobStatus(job) {
  if (!job || typeof job !== 'object') return ''
  return String(job.status || '').toLowerCase()
}

function isMeetingJobTerminal(job) {
  const status = getMeetingJobStatus(job)
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function normalizeNoteViewUrl(rawUrl) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  const apiPrefix = '/api/meeting-notes/'
  if (value.startsWith(apiPrefix)) {
    const noteId = value.slice(apiPrefix.length).split('?')[0]
    if (noteId) return `/notes/${encodeURIComponent(noteId)}`
  }
  return value
}

function normalizeQuotaSnapshot(rawQuota) {
  if (!rawQuota || typeof rawQuota !== 'object') return null
  const limit = Number(rawQuota.limit)
  const usedCount = Number(rawQuota.usedCount)
  const remaining = Number(rawQuota.remaining)
  if (!Number.isFinite(limit) || !Number.isFinite(usedCount) || !Number.isFinite(remaining)) return null
  return {
    limit: Math.max(0, Math.floor(limit)),
    usedCount: Math.max(0, Math.floor(usedCount)),
    remaining: Math.max(0, Math.floor(remaining))
  }
}

function isSameQuotaSnapshot(a, b) {
  if (!a || !b) return false
  return (
    a.limit === b.limit &&
    a.usedCount === b.usedCount &&
    a.remaining === b.remaining
  )
}

export default function FileManagerClient({ origin, initialFiles, cacheUserId }) {
  const [files, setFiles] = useState(Array.isArray(initialFiles) ? initialFiles : [])
  const [activeTab, setActiveTab] = useState('recording')
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [busyMap, setBusyMap] = useState({})
  const [noteBusyMap, setNoteBusyMap] = useState({})
  const [noteCancelBusyMap, setNoteCancelBusyMap] = useState({})
  const [noteJobMap, setNoteJobMap] = useState({})
  const [noteErrorLog, setNoteErrorLog] = useState('')
  const [message, setMessage] = useState('')
  const [quotaSnapshot, setQuotaSnapshot] = useState(null)
  const [player, setPlayer] = useState({
    fileId: '',
    url: '',
    label: '',
    token: 0,
    playing: false,
    currentTime: 0,
    duration: 0,
    error: ''
  })
  const audioRef = useRef(null)
  const pollTimerRef = useRef(null)
  const pollInFlightRef = useRef(false)
  const pollingJobsRef = useRef(new Map())
  const autoOpenJobIdsRef = useRef(new Set())
  const lastPollingErrorRef = useRef('')
  const downloadFrameRef = useRef(null)
  const meetingPollIntervalMs = 2500
  const initialFilesPayload = useMemo(() => {
    if (!Array.isArray(initialFiles) || initialFiles.length === 0) return null
    return { success: true, files: initialFiles }
  }, [initialFiles])
  const filesApi = useCachedApi({
    apiPath: '/api/files',
    userId: cacheUserId,
    ttlMs: 45 * 1000,
    enabled: true,
    initialData: initialFilesPayload,
    successGuard: (payload) => !!(payload?.success && Array.isArray(payload?.files))
  })
  const quotaApi = useCachedApi({
    apiPath: '/api/user/quota/meeting-notes',
    userId: cacheUserId,
    ttlMs: 20 * 1000,
    enabled: true,
    initialData: null,
    successGuard: (payload) => !!payload?.success
  })
  const loading = Boolean(filesApi.isLoading || filesApi.isValidating)
  const quotaState = useMemo(() => {
    const snapshot = normalizeQuotaSnapshot(quotaSnapshot)
    if (snapshot) {
      return { loading: false, error: '', ...snapshot }
    }
    if (quotaApi.isLoading && !quotaApi.data) {
      return { loading: true, error: '', limit: 0, usedCount: 0, remaining: 0 }
    }
    if (quotaApi.error && !quotaApi.data) {
      return {
        loading: false,
        error: String(quotaApi.error?.message || quotaApi.error || '加载失败'),
        limit: 0,
        usedCount: 0,
        remaining: 0
      }
    }
    const data = quotaApi.data
    const limit = Number(data?.limit || 0)
    const usedCount = Number(data?.usedCount || 0)
    const remaining = Number(data?.remaining || 0)
    return {
      loading: Boolean(quotaApi.isLoading),
      error: quotaApi.error ? String(quotaApi.error?.message || quotaApi.error || '') : '',
      limit: Number.isFinite(limit) ? limit : 0,
      usedCount: Number.isFinite(usedCount) ? usedCount : 0,
      remaining: Number.isFinite(remaining) ? remaining : 0
    }
  }, [quotaApi.data, quotaApi.error, quotaApi.isLoading, quotaSnapshot])

  function navigateTo(url) {
    const target = String(url || '').trim()
    if (!target) return
    if (typeof window === 'undefined' || !window.location) return
    window.location.assign(target)
  }

  function triggerDownload(file) {
    const fileId = getFileKey(file)
    if (!fileId) {
      setMessage('下载失败: 文件标识无效')
      return
    }
    const fileName = String(file?.name || '').trim() || 'recording'
    const signedUrl = String(file?.downloadUrl || '').trim()
    const downloadUrl = signedUrl || `/api/files/${encodeURIComponent(fileId)}?download=1`
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        setMessage('下载失败: 浏览器环境不可用')
        return
      }
      if (downloadFrameRef.current && typeof downloadFrameRef.current.remove === 'function') {
        try {
          downloadFrameRef.current.remove()
        } catch {}
      }

      const frame = document.createElement('iframe')
      frame.title = `download-${fileName}`
      frame.style.display = 'none'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      frame.src = downloadUrl
      document.body.appendChild(frame)
      downloadFrameRef.current = frame

      window.setTimeout(() => {
        if (downloadFrameRef.current !== frame) return
        try {
          frame.remove()
        } catch {}
        downloadFrameRef.current = null
      }, 60_000)
    } catch (error) {
      setMessage(`下载失败: ${String(error?.message || error)}`)
    }
  }

  const grouped = useMemo(() => {
    const recording = []
    const opusArchive = []
    for (const item of files) {
      if (item && item.ext === '.opus') {
        opusArchive.push(item)
        continue
      }
      recording.push(item)
    }
    return { recording, opusArchive }
  }, [files])

  async function refreshFiles() {
    await filesApi.refresh()
  }

  useEffect(() => {
    const data = filesApi.data
    if (!data || data.success !== true || !Array.isArray(data.files)) return
    setFiles(data.files)
  }, [filesApi.data])

  useEffect(() => {
    setQuotaSnapshot(null)
  }, [cacheUserId])

  useEffect(() => {
    const snapshot = normalizeQuotaSnapshot(quotaApi.data)
    if (!snapshot) return
    setQuotaSnapshot(prev => (isSameQuotaSnapshot(prev, snapshot) ? prev : snapshot))
  }, [quotaApi.data])

  function setBusy(name, value) {
    setBusyMap(prev => ({ ...prev, [name]: value }))
  }

  function setNoteBusy(name, value) {
    setNoteBusyMap(prev => ({ ...prev, [name]: value }))
  }

  function setNoteCancelBusy(name, value) {
    setNoteCancelBusyMap(prev => ({ ...prev, [name]: value }))
  }

  function stopMeetingPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  function removePollingJob(fileId, expectedJobId = '') {
    const key = String(fileId || '')
    if (!key) return
    if (!pollingJobsRef.current.has(key)) return
    const currentJobId = String(pollingJobsRef.current.get(key) || '')
    if (expectedJobId && currentJobId && currentJobId !== String(expectedJobId)) return
    pollingJobsRef.current.delete(key)
    if (pollingJobsRef.current.size === 0) {
      stopMeetingPolling()
    }
  }

  function trackMeetingJob(fileId, job, options = null) {
    const key = String(fileId || '')
    if (!key || !job || typeof job !== 'object') return
    const jobId = String(job.id || '')
    setNoteJobMap(prev => ({ ...prev, [key]: job }))

    if (isMeetingJobRunning(job) && jobId) {
      pollingJobsRef.current.set(key, jobId)
      if (options?.autoOpenOnComplete === true) {
        autoOpenJobIdsRef.current.add(jobId)
      }
      startMeetingPolling()
      return
    }

    if (jobId) {
      autoOpenJobIdsRef.current.delete(jobId)
    }
    removePollingJob(key, jobId)
  }

  async function pollMeetingJobsOnce() {
    if (pollInFlightRef.current) return
    if (typeof document !== 'undefined' && document.hidden) return
    const entries = Array.from(pollingJobsRef.current.entries())
    if (entries.length === 0) {
      stopMeetingPolling()
      return
    }

    pollInFlightRef.current = true
    try {
      for (const [fileId, jobId] of entries) {
        const safeJobId = String(jobId || '')
        if (!safeJobId) {
          removePollingJob(fileId)
          continue
        }

        let statusRes = null
        let statusData = null
        try {
          statusRes = await fetch(`/api/meeting-notes/jobs/${encodeURIComponent(safeJobId)}`, { cache: 'no-store' })
          statusData = await statusRes.json().catch(() => null)
        } catch (error) {
          const errText = String(error?.message || error)
          if (lastPollingErrorRef.current !== errText) {
            lastPollingErrorRef.current = errText
            setMessage(`纪要状态查询失败: ${errText}`)
          }
          continue
        }

        if (!statusRes || !statusRes.ok || !statusData || !statusData.success || !statusData.job) {
          const errorText = String(
            statusData?.error ||
            (statusRes ? `HTTP ${statusRes.status}` : 'network error')
          )
          if (statusRes && statusRes.status === 404) {
            removePollingJob(fileId, safeJobId)
            setNoteJobMap(prev => ({
              ...prev,
              [fileId]: {
                id: safeJobId,
                status: 'failed',
                stage: 'error',
                error: 'job not found',
                result: null
              }
            }))
          }
          if (lastPollingErrorRef.current !== errorText) {
            lastPollingErrorRef.current = errorText
            setMessage(`纪要状态查询失败: ${errorText}`)
          }
          continue
        }

        const job = statusData.job
        lastPollingErrorRef.current = ''
        setNoteJobMap(prev => ({ ...prev, [fileId]: job }))

        if (isMeetingJobRunning(job)) {
          continue
        }

        removePollingJob(fileId, safeJobId)
        const finishedJobId = String(job.id || safeJobId)
        const shouldAutoOpen = autoOpenJobIdsRef.current.has(finishedJobId)
        autoOpenJobIdsRef.current.delete(finishedJobId)

        if (getMeetingJobStatus(job) === 'completed') {
          if (shouldAutoOpen) {
            setMessage('会议纪要已生成')
            const noteUrl = normalizeNoteViewUrl(String(job?.result?.noteUrl || ''))
            if (noteUrl) {
              if (/^https?:\/\//i.test(noteUrl)) {
                if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
                  window.location.assign(noteUrl)
                }
              } else {
                navigateTo(noteUrl)
              }
            }
          }
          continue
        }

        if (getMeetingJobStatus(job) === 'cancelled') {
          setMessage('纪要任务已取消')
          continue
        }

        if (getMeetingJobStatus(job) === 'failed') {
          const err = String(job.error || '纪要生成失败')
          setMessage(`纪要生成失败: ${err}`)
          setNoteErrorLog(err)
        }
      }
    } finally {
      pollInFlightRef.current = false
      if (pollingJobsRef.current.size === 0) {
        stopMeetingPolling()
      }
    }
  }

  function startMeetingPolling() {
    if (typeof window === 'undefined') return
    if (typeof document !== 'undefined' && document.hidden) return
    if (pollingJobsRef.current.size === 0) return
    if (pollTimerRef.current) return

    pollTimerRef.current = window.setInterval(() => {
      void pollMeetingJobsOnce()
    }, meetingPollIntervalMs)
    void pollMeetingJobsOnce()
  }

  async function deleteFile(file) {
    const fileId = getFileKey(file)
    const fileName = String(file?.name || '').trim()
    if (!fileId) return
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`确认删除文件: ${fileName} ?`)
      if (!ok) return
    }
    setBusy(fileId, true)
    setMessage('')
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (!res.ok || !data || data.success !== true) {
        throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`)
      }
      const deletedText = Array.isArray(data.deleted) ? data.deleted.join(', ') : fileName
      setMessage(`已删除: ${deletedText}`)
      if (String(player.fileId || '') === fileId) {
        stopCurrentPlayback()
      }
      removePollingJob(fileId)
      await refreshFiles()
    } catch (error) {
      setMessage(`删除失败: ${String(error.message || error)}`)
    } finally {
      setBusy(fileId, false)
    }
  }

  async function generateMeetingNote(file) {
    const fileId = getFileKey(file)
    if (!fileId) return
    setNoteBusy(fileId, true)
    setNoteErrorLog('')
    setMessage('')
    try {
      const createRes = await fetch('/api/meeting-notes/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recordingId: fileId })
      })
      const createData = await createRes.json().catch(() => null)
      if (!createRes.ok || !createData || !createData.success || !createData.job) {
        throw new Error((createData && createData.error) ? createData.error : `HTTP ${createRes.status}`)
      }
      const snapshot = normalizeQuotaSnapshot(createData?.quota)
      if (snapshot) {
        setQuotaSnapshot(prev => (isSameQuotaSnapshot(prev, snapshot) ? prev : snapshot))
      }
      trackMeetingJob(fileId, createData.job, { autoOpenOnComplete: true })
      if (isMeetingJobRunning(createData.job)) {
        setMessage('纪要任务已创建，正在后台生成')
      } else if (getMeetingJobStatus(createData.job) === 'completed') {
        setMessage('会议纪要已生成')
      }
    } catch (error) {
      const text = String(error && error.message ? error.message : error)
      setMessage(`纪要生成失败: ${text}`)
      setNoteErrorLog(text)
    } finally {
      setNoteBusy(fileId, false)
      void quotaApi.refresh()
    }
  }

  async function cancelMeetingNote(file, noteJob) {
    const fileId = getFileKey(file)
    const jobId = String(noteJob?.id || '')
    if (!fileId || !jobId) return
    setNoteCancelBusy(fileId, true)
    setMessage('')
    try {
      const res = await fetch(`/api/meeting-notes/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST'
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data?.job) {
        throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`)
      }
      trackMeetingJob(fileId, data.job)
      setNoteBusy(fileId, false)
      setMessage('已取消纪要生成，可重新发起')
      await refreshFiles()
    } catch (error) {
      setMessage(`取消失败: ${String(error?.message || error)}`)
    } finally {
      setNoteCancelBusy(fileId, false)
    }
  }

  function openMeetingNoteByUrl(noteUrl) {
    const normalizedUrl = normalizeNoteViewUrl(noteUrl)
    if (!normalizedUrl) {
      setMessage('纪要已完成，但未找到查看链接')
      return
    }
    if (/^https?:\/\//i.test(normalizedUrl)) {
      if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
        window.location.assign(normalizedUrl)
      }
      return
    }
    navigateTo(normalizedUrl)
  }

  async function convertToMp3(file) {
    const fileId = getFileKey(file)
    const fileName = String(file?.name || '').trim()
    if (!fileName || !fileId) return
    setBusy(fileId, true)
    setMessage('')
    try {
      const res = await fetch('/api/convert-mp3', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: fileName,
          overwrite: true
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.success !== true) {
        const errorText = data && data.error ? String(data.error) : `HTTP ${res.status}`
        throw new Error(errorText)
      }
      const outputName = data && data.filename ? data.filename : ''
      setMessage(outputName ? `转换完成: ${outputName}` : '转换完成')
      await refreshFiles()
    } catch (error) {
      const errorText = String(error && error.message ? error.message : error)
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(errorText)
      }
    } finally {
      setBusy(fileId, false)
    }
  }

  function togglePlay(file) {
    if (!file || !isPlayableExt(file.ext)) return
    const fileId = getFileKey(file)
    if (!fileId) return
    const url = String(file.streamUrl || file.downloadUrl || '').trim() || `/api/files/${encodeURIComponent(fileId)}`
    const label = String(file.name || '')
    const sameFile = String(player.fileId || '') === fileId
    const audioEl = audioRef.current

    if (sameFile && audioEl) {
      if (audioEl.paused) {
        const promise = audioEl.play()
        if (promise && typeof promise.catch === 'function') promise.catch(() => {})
        setPlayer(prev => ({ ...prev, playing: true, error: '' }))
      } else {
        audioEl.pause()
        setPlayer(prev => ({ ...prev, playing: false }))
      }
      return
    }

    if (!sameFile && audioEl && typeof audioEl.pause === 'function') {
      audioEl.pause()
    }

    setPlayer({
      fileId,
      url,
      label,
      token: Date.now(),
      playing: true,
      currentTime: 0,
      duration: toDurationSeconds(file.durationSec),
      error: ''
    })
  }

  function stopCurrentPlayback() {
    const audioEl = audioRef.current
    if (audioEl && typeof audioEl.pause === 'function') {
      try {
        audioEl.pause()
      } catch {}
    }
    setPlayer({
      fileId: '',
      url: '',
      label: '',
      token: Date.now(),
      playing: false,
      currentTime: 0,
      duration: 0,
      error: ''
    })
  }

  function seekCurrentPlayback(fileId, nextTimeRaw) {
    const currentFileId = String(player.fileId || '')
    if (!currentFileId || currentFileId !== String(fileId || '')) return
    const audioEl = audioRef.current
    if (!audioEl || typeof audioEl.currentTime !== 'number') return
    const maxDur = toDurationSeconds(player.duration) || toDurationSeconds(audioEl.duration)
    if (!maxDur) return
    const next = Number(nextTimeRaw)
    if (!Number.isFinite(next)) return
    const clamped = Math.max(0, Math.min(next, maxDur))
    audioEl.currentTime = clamped
    setPlayer(prev => ({ ...prev, currentTime: clamped }))
  }

  useEffect(() => {
    const fileIds = new Set()
    for (const file of files) {
      const fileId = getFileKey(file)
      if (!fileId) continue
      fileIds.add(fileId)
      const persistedNoteJob = file.latestMeetingJob && typeof file.latestMeetingJob === 'object'
        ? file.latestMeetingJob
        : null
      if (!persistedNoteJob || !persistedNoteJob.id) continue
      if (isMeetingJobRunning(persistedNoteJob)) {
        pollingJobsRef.current.set(fileId, String(persistedNoteJob.id))
      } else if (isMeetingJobTerminal(persistedNoteJob)) {
        removePollingJob(fileId, String(persistedNoteJob.id))
      }
    }

    for (const [fileId] of Array.from(pollingJobsRef.current.entries())) {
      if (!fileIds.has(fileId)) {
        removePollingJob(fileId)
      }
    }

    if (pollingJobsRef.current.size > 0) {
      startMeetingPolling()
    } else {
      stopMeetingPolling()
    }
  }, [files])

  useEffect(() => {
    function onVisibilityChange() {
      if (typeof document !== 'undefined' && document.hidden) {
        stopMeetingPolling()
        return
      }
      if (pollingJobsRef.current.size > 0) {
        startMeetingPolling()
        void pollMeetingJobsOnce()
      }
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    return () => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      stopMeetingPolling()
    }
  }, [])

  useEffect(() => {
    const fileId = String(player.fileId || '')
    const url = String(player.url || '')
    if (!fileId || !url) return
    const audioEl = audioRef.current
    if (!audioEl || typeof audioEl.play !== 'function') return
    const activeToken = Number(player.token || 0)

    function patchCurrentState(mutator) {
      setPlayer(prev => {
        if (
          String(prev.fileId || '') !== fileId ||
          String(prev.url || '') !== url ||
          Number(prev.token || 0) !== activeToken
        ) {
          return prev
        }
        return mutator(prev)
      })
    }

    const onLoadedMetadata = () => {
      const safeDuration = toDurationSeconds(audioEl.duration)
      if (!safeDuration) return
      patchCurrentState(prev => ({ ...prev, duration: safeDuration, error: '' }))
    }
    const onTimeUpdate = () => {
      const safeCurrent = Math.max(0, Number(audioEl.currentTime) || 0)
      const safeDuration = toDurationSeconds(audioEl.duration)
      patchCurrentState(prev => ({
        ...prev,
        currentTime: safeCurrent,
        duration: safeDuration || prev.duration,
        playing: !audioEl.paused
      }))
    }
    const onPlay = () => {
      patchCurrentState(prev => ({ ...prev, playing: true, error: '' }))
    }
    const onPause = () => {
      patchCurrentState(prev => ({ ...prev, playing: false }))
    }
    const onEnded = () => {
      patchCurrentState(prev => ({
        ...prev,
        fileId: '',
        url: '',
        label: '',
        token: Date.now(),
        playing: false,
        currentTime: 0,
        duration: 0,
        error: ''
      }))
    }
    const onError = () => {
      patchCurrentState(prev => ({ ...prev, playing: false, error: '音频加载失败' }))
    }

    audioEl.addEventListener('loadedmetadata', onLoadedMetadata)
    audioEl.addEventListener('timeupdate', onTimeUpdate)
    audioEl.addEventListener('play', onPlay)
    audioEl.addEventListener('pause', onPause)
    audioEl.addEventListener('ended', onEnded)
    audioEl.addEventListener('error', onError)

    const playPromise = audioEl.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        patchCurrentState(prev => ({ ...prev, playing: false }))
      })
    }

    return () => {
      audioEl.removeEventListener('loadedmetadata', onLoadedMetadata)
      audioEl.removeEventListener('timeupdate', onTimeUpdate)
      audioEl.removeEventListener('play', onPlay)
      audioEl.removeEventListener('pause', onPause)
      audioEl.removeEventListener('ended', onEnded)
      audioEl.removeEventListener('error', onError)
    }
  }, [player.fileId, player.url, player.token])

  useEffect(() => {
    return () => {
      if (!downloadFrameRef.current) return
      try {
        downloadFrameRef.current.remove()
      } catch {}
      downloadFrameRef.current = null
    }
  }, [])

  function renderActions(file, busy, noteBusy, noteCancelBusy, noteJob) {
    const fileId = getFileKey(file)
    const isOpus = file.ext === '.opus'
    const canGenerateNote = isPlayableExt(file.ext) || isOpus
    const inMemoryNoteUrl = noteJob && noteJob.result && noteJob.result.noteUrl ? String(noteJob.result.noteUrl) : ''
    const persistedNoteUrl = file && file.latestNoteUrl ? String(file.latestNoteUrl) : ''
    const noteViewUrl = normalizeNoteViewUrl(inMemoryNoteUrl || persistedNoteUrl)

    const secondaryMessages = []
    if (isOpus) {
      secondaryMessages.push('归档兜底文件（仅恢复使用）')
    }
    if (noteJob) {
      secondaryMessages.push(
        noteJob.status === 'completed'
          ? '纪要已完成'
          : noteJob.status === 'cancelled'
            ? '纪要已取消'
            : noteJob.status === 'failed'
              ? `失败: ${noteJob.error || '未知错误'}`
              : `处理中: ${noteJob.stage || noteJob.status}`
      )
    }

    return (
      <div style={actionBlockStyle} className="file-action-block">
        <div style={actionPrimaryRowStyle} className="file-action-primary-row">
        {isOpus ? (
          <>
            <button type="button" onClick={() => triggerDownload(file)} style={linkStyle} className="file-action-link">下载OPUS</button>
            <button
              style={actionBtnStyle}
              className="file-action-btn"
              onClick={() => convertToMp3(file)}
              disabled={busy}
            >
              {busy ? '转换中...' : '转换到MP3'}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => triggerDownload(file)} style={linkStyle} className="file-action-link">下载</button>
        )}
        {canGenerateNote && (
          <button
            style={noteBtnStyle}
            className="file-action-btn"
            onClick={() => generateMeetingNote(file)}
            disabled={noteBusy || noteCancelBusy}
          >
            {noteBusy ? '纪要生成中...' : '生成音频纪要'}
          </button>
        )}
        {canGenerateNote && isMeetingJobRunning(noteJob) && (
          <button
            style={cancelNoteBtnStyle}
            className="file-action-btn"
            onClick={() => cancelMeetingNote(file, noteJob)}
            disabled={noteCancelBusy}
          >
            {noteCancelBusy ? '取消中...' : '取消生成纪要'}
          </button>
        )}
        {canGenerateNote && noteViewUrl && (
          <button
            style={noteBtnStyle}
            className="file-action-btn"
            onClick={() => openMeetingNoteByUrl(noteViewUrl)}
          >
            查看纪要
          </button>
        )}
        <button
          style={deleteBtnStyle}
          className="file-delete-btn"
          onClick={() => deleteFile(file)}
          disabled={busy}
        >
          删除
        </button>
        </div>
        {secondaryMessages.length > 0 && (
          <div style={statusRowStyle} className="file-status-row">
            {secondaryMessages.map((text, index) => (
              <span key={`${fileId}__status_${index}`} style={statusBadgeStyle}>
                {text}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const list = activeTab === 'opus_archive' ? grouped.opusArchive : grouped.recording
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize))
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages))
  const pageStart = (safeCurrentPage - 1) * pageSize
  const pageEnd = pageStart + pageSize
  const pagedList = list.slice(pageStart, pageEnd)
  const quotaValueText = quotaState.loading
    ? '加载中...'
    : quotaState.error
      ? '加载失败'
      : String(Math.max(0, quotaState.remaining))
  const syncNotice = filesApi.cacheMessage || quotaApi.cacheMessage || ''

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, pageSize])

  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage)
    }
  }, [currentPage, safeCurrentPage])

  useEffect(() => {
    const playingFileId = String(player.fileId || '')
    if (!playingFileId) return
    const existsInCurrentPage = pagedList.some(item => String(getFileKey(item) || '') === playingFileId)
    if (!existsInCurrentPage) {
      stopCurrentPlayback()
    }
  }, [pagedList, player.fileId])

  return (
    <>
      <div className="file-toolbar" style={{ marginBottom: 14, color: '#35575d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div>共 {files.length} 个文件</div>
          <div style={quotaUnifiedPillStyle}>
            <span style={quotaUnifiedLabelStyle}>👑 会议纪要次数：</span>
            <strong style={quotaUnifiedValueStyle}>{quotaValueText}</strong>
          </div>
        </div>
        <button onClick={refreshFiles} style={refreshBtnStyle} className="file-refresh-btn" disabled={loading}>
          {loading ? '刷新中...' : '刷新列表'}
        </button>
      </div>
      {syncNotice && (
        <div style={syncHintStyle}>{syncNotice}</div>
      )}

      <div className="file-tab-row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveTab('recording')}
          style={activeTab === 'recording' ? tabActiveStyle : tabStyle}
          className="file-tab-btn"
        >
          录音文件 ({grouped.recording.length})
        </button>
        <button
          onClick={() => setActiveTab('opus_archive')}
          style={activeTab === 'opus_archive' ? tabActiveStyle : tabStyle}
          className="file-tab-btn"
        >
          OPUS归档 ({grouped.opusArchive.length})
        </button>
      </div>
      <audio
        key={`${player.url}#${player.token}`}
        ref={audioRef}
        preload="metadata"
        src={player.url || undefined}
        style={{ display: 'none' }}
      />

      {message && (
        <div style={messageStyle}>{message}</div>
      )}
      {noteErrorLog && (
        <div style={errorLogCardStyle}>
          <div style={errorLogTitleStyle}>纪要生成错误日志</div>
          <pre style={errorLogPreStyle}>{noteErrorLog}</pre>
        </div>
      )}

      {list.length === 0 ? (
        <div style={emptyStyle}>
          当前 Tab 暂无文件
        </div>
      ) : (
        <div className="responsive-table-wrap" style={tableWrapStyle}>
          <table style={tableStyle} className="file-table">
            <thead className="file-table-head">
              <tr style={{ background: '#fafafa' }}>
                <th style={headerStyle}>播放</th>
                <th style={headerStyle}>标题</th>
                <th style={headerStyle}>时长</th>
                <th style={headerStyle}>大小</th>
                <th style={headerStyle}>上传时间</th>
                <th style={headerStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedList.map((file) => {
                const fileId = getFileKey(file)
                if (!fileId) return null
                const busy = !!busyMap[fileId]
                const inMemoryNoteJob = noteJobMap[fileId] || null
                const persistedNoteJob = file && file.latestMeetingJob && typeof file.latestMeetingJob === 'object'
                  ? file.latestMeetingJob
                  : null
                const noteJob = inMemoryNoteJob || persistedNoteJob
                const noteCancelBusy = !!noteCancelBusyMap[fileId]
                const noteBusy = !!noteBusyMap[fileId] || noteCancelBusy || isMeetingJobRunning(noteJob)
                const canPlay = isPlayableExt(file.ext)
                const isCurrentFile = String(player.fileId || '') === fileId
                const rowDuration = toDurationSeconds(file.durationSec)
                const panelDuration = toDurationSeconds(player.duration) || rowDuration
                const panelCurrent = isCurrentFile ? Math.max(0, Number(player.currentTime) || 0) : 0
                const maxSeek = panelDuration > 0 ? panelDuration : 1
                const isPlayingCurrent = isCurrentFile && player.playing
                const playIconSrc = isPlayingCurrent ? '/icons/zanting.svg' : '/icons/bofang.svg'
                const playLabel = isPlayingCurrent ? '暂停' : '播放'

                const progressRow = isCurrentFile ? (
                  <tr key={`${fileId}__progress`} className="file-row-progress" style={{ borderBottom: '1px solid #eee' }}>
                    <td colSpan={6} style={progressRowCellStyle} className="file-progress-cell">
                      <div style={progressPanelStyle} className="file-progress-panel">
                        <div style={progressPanelInnerStyle}>
                          {canPlay ? (
                            <button
                              style={playBtnStyle}
                              className="file-action-btn"
                              onClick={() => togglePlay(file)}
                              aria-label={playLabel}
                              title={playLabel}
                            >
                              <img src={playIconSrc} alt={playLabel} style={playIconStyle} />
                            </button>
                          ) : (
                            <span style={nonPlayableHintStyle}>-</span>
                          )}
                          <div style={progressPanelContentStyle}>
                            <div style={progressMetaRowStyle} className="file-progress-meta">
                              <span style={progressTimeTextStyle} className="file-progress-time">
                                {formatDuration(panelCurrent)} / {formatDuration(panelDuration)}
                              </span>
                              <span style={progressStatusTextStyle} className="file-progress-status">
                                {player.error ? player.error : (player.playing ? '播放中' : '已暂停')}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={maxSeek}
                              step={1}
                              value={Math.max(0, Math.min(panelCurrent, maxSeek))}
                              onChange={(event) => {
                                seekCurrentPlayback(fileId, event.target.value)
                              }}
                              style={progressRangeStyle}
                              className="file-progress-range"
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null

                const mainRow = (
                  <tr
                    key={`${fileId}__main`}
                    className={`file-row-main${isCurrentFile ? ' file-row-main-current' : ''}`}
                    style={{ borderBottom: '1px solid #eee' }}
                  >
                    <td style={playCellStyle} className="file-cell file-cell-play" data-label="播放">
                      {!isCurrentFile && canPlay ? (
                        <button
                          style={playBtnStyle}
                          className="file-action-btn"
                          onClick={() => togglePlay(file)}
                          aria-label={playLabel}
                          title={playLabel}
                        >
                          <img src={playIconSrc} alt={playLabel} style={playIconStyle} />
                        </button>
                      ) : (
                        <span style={nonPlayableHintStyle}>-</span>
                      )}
                    </td>
                    <td style={fileNameCellStyle} className="file-cell file-cell-title" data-label="标题">
                      <div style={fileTitleStyle}>{getDisplayTitle(file)}</div>
                      {String(file.latestNoteTitle || '').trim() && (
                        <div style={fileNameSubtleStyle}>{file.name}</div>
                      )}
                    </td>
                    <td style={durationCellStyle} className="file-cell file-cell-duration" data-label="时长">{formatDuration(rowDuration)}</td>
                    <td style={cellStyle} className="file-cell file-cell-size" data-label="大小">{file.sizeFormatted}</td>
                    <td style={cellStyle} className="file-cell file-cell-created" data-label="上传时间">{formatDate(file.createdAt)}</td>
                    <td style={cellStyle} className="file-cell file-cell-actions" data-label="操作">
                      <div style={desktopActionsWrapStyle} className="file-actions">
                        {renderActions(file, busy, noteBusy, noteCancelBusy, noteJob)}
                      </div>
                    </td>
                  </tr>
                )

                return progressRow ? [progressRow, mainRow] : [mainRow]
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={paginationToolbarStyle}>
        <div style={paginationInfoStyle}>
          当前显示 {list.length === 0 ? 0 : pageStart + 1}-{Math.min(pageEnd, list.length)} / {list.length}
        </div>
        <div style={paginationControlsStyle}>
          <label style={pageSizeLabelStyle} htmlFor="file-page-size-select">每页</label>
          <select
            id="file-page-size-select"
            value={pageSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next) || next <= 0) return
              setPageSize(next)
            }}
            style={pageSizeSelectStyle}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button
            type="button"
            style={pageBtnStyle}
            className="file-tab-btn"
            disabled={safeCurrentPage <= 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          >
            上一页
          </button>
          <span style={pageNumberStyle}>第 {safeCurrentPage} / {totalPages} 页</span>
          <button
            type="button"
            style={pageBtnStyle}
            className="file-tab-btn"
            disabled={safeCurrentPage >= totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
          >
            下一页
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18, color: '#60797f', fontSize: 12 }}>
        当前服务地址: {origin}
      </div>
    </>
  )
}

const actionBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  width: '100%'
}

const actionPrimaryRowStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  width: '100%'
}

const statusRowStyle = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6
}

const tableStyle = {
  width: '100%',
  minWidth: 760,
  borderCollapse: 'collapse',
  background: 'rgba(255,255,255,0.82)',
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 10px 24px rgba(28, 52, 58, 0.09)',
  border: '1px solid rgba(35, 74, 79, 0.11)'
}

const tableWrapStyle = {
  width: '100%',
  overflowX: 'auto',
  borderRadius: 14
}

const headerStyle = {
  padding: '12px 14px',
  textAlign: 'left',
  fontSize: 11,
  color: '#4c6b70',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
}

const cellStyle = {
  padding: '12px 14px',
  fontSize: 14,
  color: '#223c42'
}

const fileNameCellStyle = {
  ...cellStyle,
  maxWidth: 320,
  wordBreak: 'break-all'
}

const playCellStyle = {
  ...cellStyle,
  width: 92,
  minWidth: 92,
  paddingTop: 10,
  paddingBottom: 10
}

const durationCellStyle = {
  ...cellStyle,
  width: 88,
  minWidth: 88,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums'
}

const fileTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: '#1e3940',
  lineHeight: 1.4
}

const fileNameSubtleStyle = {
  marginTop: 4,
  fontSize: 12,
  color: '#6c8388',
  lineHeight: 1.35,
  wordBreak: 'break-all',
  fontWeight: 500
}

const linkStyle = {
  color: '#245a67',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 14px',
  minHeight: 44,
  width: 142,
  borderRadius: 999,
  border: '1px solid rgba(23, 88, 97, 0.35)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3fbfd 100%)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1.2
}

const disabledHintStyle = {
  marginRight: 8,
  fontSize: 12,
  color: '#8d8f92',
  background: '#f3f3f1',
  border: '1px dashed #d2d2ce',
  borderRadius: 999,
  padding: '7px 10px'
}

const actionBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(23, 88, 97, 0.35)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3fbfd 100%)',
  color: '#1f6674',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  width: 142,
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1.2
}

const playBtnStyle = {
  fontSize: 12,
  border: '1px solid rgba(23, 88, 97, 0.35)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3fbfd 100%)',
  color: '#1f6674',
  borderRadius: 999,
  padding: 0,
  width: 36,
  height: 36,
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const playIconStyle = {
  width: 18,
  height: 18,
  display: 'block'
}

const nonPlayableHintStyle = {
  fontSize: 12,
  color: '#9aa9ad'
}

const deleteBtnStyle = {
  fontSize: 13,
  border: '1px solid #f3adad',
  background: 'linear-gradient(180deg, #fff6f5 0%, #ffe9e7 100%)',
  color: '#ad3232',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  width: 142,
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1.2
}

const noteBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(88, 84, 201, 0.34)',
  background: 'linear-gradient(135deg, rgba(126, 214, 255, 0.25), rgba(255, 188, 138, 0.26))',
  color: '#2f436f',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  width: 142,
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1.2
}

const cancelNoteBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(177, 115, 15, 0.38)',
  background: 'linear-gradient(180deg, #fff8ea 0%, #ffefcd 100%)',
  color: '#845008',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  width: 142,
  cursor: 'pointer',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1.2
}

const statusBadgeStyle = {
  fontSize: 12,
  color: '#3a5660',
  border: '1px solid rgba(45, 94, 103, 0.2)',
  background: 'rgba(255,255,255,0.8)',
  borderRadius: 999,
  padding: '7px 10px',
  maxWidth: 'calc(100% - 2px)',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  lineHeight: 1.45
}

const quotaUnifiedPillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  width: 'fit-content',
  minHeight: 38,
  borderRadius: 999,
  border: '1px solid rgba(40, 123, 191, 0.38)',
  background: 'linear-gradient(135deg, rgba(120, 209, 255, 0.28), rgba(93, 119, 232, 0.2))',
  padding: '6px 14px',
  boxShadow: '0 6px 14px rgba(34, 80, 132, 0.18)'
}

const quotaUnifiedLabelStyle = {
  fontSize: 16,
  color: '#27506f',
  fontWeight: 700,
  letterSpacing: '0.01em',
  lineHeight: 1.1
}

const quotaUnifiedValueStyle = {
  fontSize: 24,
  lineHeight: 1,
  color: '#164768',
  fontWeight: 800
}

const tabStyle = {
  border: '1px solid rgba(39, 74, 80, 0.18)',
  background: 'rgba(255,255,255,0.72)',
  color: '#25464d',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer'
}

const tabActiveStyle = {
  ...tabStyle,
  border: '1px solid rgba(9, 107, 103, 0.5)',
  background: 'linear-gradient(135deg, rgba(8, 142, 135, 0.19), rgba(246, 178, 84, 0.2))',
  color: '#194f55',
  boxShadow: '0 4px 12px rgba(30, 79, 83, 0.12)'
}

const paginationToolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 10,
  padding: '8px 2px'
}

const paginationInfoStyle = {
  fontSize: 12,
  color: '#4f6f76'
}

const paginationControlsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap'
}

const pageSizeLabelStyle = {
  fontSize: 12,
  color: '#48656c',
  fontWeight: 600
}

const pageSizeSelectStyle = {
  minHeight: 34,
  borderRadius: 10,
  border: '1px solid rgba(39, 74, 80, 0.24)',
  background: 'rgba(255,255,255,0.9)',
  color: '#25464d',
  padding: '6px 10px',
  fontSize: 13,
  fontWeight: 600
}

const pageBtnStyle = {
  ...tabStyle,
  minHeight: 34,
  padding: '6px 10px',
  fontSize: 12
}

const pageNumberStyle = {
  fontSize: 12,
  color: '#31555e',
  fontWeight: 600,
  padding: '0 2px'
}

const emptyStyle = {
  textAlign: 'center',
  padding: 60,
  color: '#6f8488',
  background: 'rgba(255,255,255,0.62)',
  borderRadius: 14,
  border: '1px solid rgba(35, 71, 77, 0.12)'
}

const progressMetaRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 0
}

const progressStatusTextStyle = {
  fontSize: 12,
  color: '#31555e',
  fontWeight: 600
}

const progressTimeTextStyle = {
  fontSize: 12,
  color: '#51717a',
  fontVariantNumeric: 'tabular-nums'
}

const progressRangeStyle = {
  width: '100%',
  marginTop: 0
}

const progressRowCellStyle = {
  padding: '8px 14px 8px 14px',
  background: 'rgba(250, 252, 253, 0.94)'
}

const progressPanelStyle = {
  border: '1px solid rgba(34, 92, 102, 0.16)',
  borderRadius: 12,
  padding: '10px 12px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f4fafb 100%)'
}

const progressPanelInnerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0
}

const progressPanelContentStyle = {
  flex: 1,
  minWidth: 0,
  display: 'grid',
  gap: 6
}

const messageStyle = {
  background: 'linear-gradient(180deg, #fffdf5 0%, #fff7db 100%)',
  border: '1px solid #f0d889',
  borderRadius: 12,
  padding: 10,
  marginBottom: 12,
  color: '#866020',
  fontSize: 13
}

const syncHintStyle = {
  marginBottom: 10,
  borderRadius: 10,
  border: '1px solid rgba(219, 183, 110, 0.45)',
  background: 'linear-gradient(180deg, rgba(255, 248, 225, 0.9) 0%, rgba(255, 242, 201, 0.9) 100%)',
  color: '#7f5f20',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600
}

const errorLogCardStyle = {
  width: '100%',
  background: 'linear-gradient(180deg, #fff5f5 0%, #ffecec 100%)',
  border: '1px solid #efb4b4',
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
  color: '#7e2b2b',
  boxSizing: 'border-box'
}

const errorLogTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 8
}

const errorLogPreStyle = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 260,
  overflowY: 'auto'
}

const refreshBtnStyle = {
  fontSize: 13,
  border: '1px solid rgba(22, 83, 89, 0.27)',
  background: 'linear-gradient(180deg, #ffffff 0%, #eef7f9 100%)',
  borderRadius: 999,
  padding: '10px 14px',
  minHeight: 44,
  cursor: 'pointer',
  color: '#244f57',
  fontWeight: 700
}

const desktopActionsWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8
}
