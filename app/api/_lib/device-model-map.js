const DEVICE_SOURCE_MODEL_MAP = {
  '224': 'Amazfit GTS 3',
  '225': 'Amazfit GTS 3',
  '226': 'Amazfit GTR 3',
  '227': 'Amazfit GTR 3',
  '229': 'Amazfit GTR 3 Pro',
  '230': 'Amazfit GTR 3 Pro',
  '242': 'Amazfit GTR 3 Pro',
  '246': 'Amazfit GTS 4 mini',
  '247': 'Amazfit GTS 4 mini',
  '250': 'Amazfit GTR Mini',
  '251': 'Amazfit GTR Mini',
  '252': 'Amazfit Band 7',
  '253': 'Amazfit Band 7',
  '254': 'Amazfit Band 7',
  '414': 'Amazfit Falcon',
  '415': 'Amazfit Falcon',
  '418': 'Amazfit T-Rex 2',
  '419': 'Amazfit T-Rex 2',
  '6553856': 'Amazfit T-Rex Ultra',
  '6553857': 'Amazfit T-Rex Ultra',
  '7864577': 'Amazfit GTR 4',
  '7930112': 'Amazfit GTR 4',
  '7930113': 'Amazfit GTR 4',
  '7995648': 'Amazfit GTS 4',
  '7995649': 'Amazfit GTS 4',
  '8126720': 'Amazfit Cheetah Pro',
  '8126721': 'Amazfit Cheetah Pro',
  '8192256': 'Amazfit Cheetah (Round)',
  '8192257': 'Amazfit Cheetah (Round)',
  '8257793': 'Amazfit Cheetah (Square)',
  '8323328': 'Amazfit Active',
  '8323329': 'Amazfit Active',
  '8388864': 'Amazfit Active Edge',
  '8388865': 'Amazfit Active Edge',
  '8454400': 'Amazfit Bip 5',
  '8454401': 'Amazfit Bip 5',
  '8519936': 'Amazfit Balance',
  '8519937': 'Amazfit Balance',
  '8519939': 'Amazfit Balance',
  '8716544': 'Amazfit T-Rex 3',
  '8716545': 'Amazfit T-Rex 3',
  '8716547': 'Amazfit T-Rex 3',
  '8782081': 'Amazfit Bip 5 Unity',
  '8782088': 'Amazfit Bip 5 Unity',
  '8782089': 'Amazfit Bip 5 Unity',
  '8913152': 'Amazfit Active 2 (Round)',
  '8913153': 'Amazfit Active 2 (Round)',
  '8913155': 'Amazfit Active 2 (Round)',
  '8913159': 'Amazfit Active 2 (Round)',
  '9568512': 'Amazfit Balance 2',
  '9568513': 'Amazfit Balance 2',
  '9568515': 'Amazfit Balance 2',
  '9765120': 'Amazfit Bip 6',
  '9765121': 'Amazfit Bip 6',
  '10092800': 'Amazfit Active 2 (Round)',
  '10092801': 'Amazfit Active 2 (Round)',
  '10092803': 'Amazfit Active 2 (Round)',
  '10092807': 'Amazfit Active 2 (Round)',
  '10158337': 'Amazfit Bip 6',
  '10223872': 'Amazfit Active 2 (Square)',
  '10223873': 'Amazfit Active 2 (Square)',
  '10223875': 'Amazfit Active 2 (Square)',
  '10551552': 'Amazfit T-Rex 3 Pro (48mm)',
  '10551553': 'Amazfit T-Rex 3 Pro (48mm)',
  '10551555': 'Amazfit T-Rex 3 Pro (48mm)',
  '10682624': 'Amazfit T-Rex 3 Pro (44mm)',
  '10682625': 'Amazfit T-Rex 3 Pro (44mm)',
  '10682627': 'Amazfit T-Rex 3 Pro (44mm)',
  '10813697': 'Amazfit Active Max',
  '10813699': 'Amazfit Active Max',
  '6095106': 'Amazfit GTR 3 Pro'
}

function normalizeDeviceSource(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const match = text.match(/\d+/)
  if (!match) return ''
  const asNum = Number(match[0])
  if (!Number.isFinite(asNum) || asNum < 0) return ''
  return String(Math.floor(asNum))
}

export function extractDeviceSourceFromDeviceId(deviceId) {
  const text = String(deviceId || '').trim()
  if (!text) return ''
  const match = text.match(/^dev3_(\d+)(?:_|$)/i)
  if (!match) return ''
  return normalizeDeviceSource(match[1])
}

export function resolveDeviceModel(input) {
  const source = input && typeof input === 'object' ? input : {}
  const primarySource = normalizeDeviceSource(source.deviceSource)
  const fallbackSource = extractDeviceSourceFromDeviceId(source.deviceId)
  const finalSource = primarySource || fallbackSource
  if (!finalSource) return ''
  return String(DEVICE_SOURCE_MODEL_MAP[finalSource] || '')
}

