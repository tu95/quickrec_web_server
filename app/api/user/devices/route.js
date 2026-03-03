import { listUserDevices } from '../../_lib/recorder-multiuser-store'
import { requireUserAuth } from '../../_lib/user-auth'
import { getSupabaseConfigError } from '../../_lib/supabase-client'
import { resolveDeviceModel } from '../../_lib/device-model-map'

export async function GET(request) {
  const configError = getSupabaseConfigError()
  if (configError) {
    return Response.json(
      { success: false, error: configError },
      { status: 500 }
    )
  }

  const auth = await requireUserAuth(request)
  if (!auth.ok) {
    return Response.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  try {
    const rows = await listUserDevices(auth.user.id)
    const devices = rows.map(item => ({
      id: String(item?.device?.id || ''),
      deviceId: String(item?.device?.device_identity || ''),
      identitySource: String(item?.device?.identity_source || ''),
      deviceSource: String(item?.device?.device_source || ''),
      deviceModel: resolveDeviceModel({
        deviceSource: item?.device?.device_source,
        deviceId: item?.device?.device_identity
      }),
      status: String(item?.status || ''),
      boundAt: String(item?.bound_at || '')
    }))
    return Response.json({
      success: true,
      count: devices.length,
      devices
    })
  } catch (error) {
    return Response.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    )
  }
}
