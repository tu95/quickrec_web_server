import { createClient } from '@supabase/supabase-js'

let cachedAnonClient = null
let cachedServiceClient = null

function readEnv(name) {
  return String(process.env[name] || '').trim()
}

export function getSupabaseUrl() {
  return readEnv('SUPABASE_URL') || readEnv('NEXT_PUBLIC_SUPABASE_URL')
}

export function getSupabaseAnonKey() {
  return (
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  )
}

export function getSupabaseServiceRoleKey() {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY')
}

export function getSupabaseAnonConfigError() {
  if (!getSupabaseUrl()) return '缺少 SUPABASE_URL'
  if (!getSupabaseAnonKey()) return '缺少 SUPABASE_ANON_KEY'
  return ''
}

export function getSupabaseServiceConfigError() {
  if (!getSupabaseUrl()) return '缺少 SUPABASE_URL'
  if (!getSupabaseServiceRoleKey()) return '缺少 SUPABASE_SERVICE_ROLE_KEY'
  return ''
}

// Backward compatibility: existing business APIs currently expect service role.
export function getSupabaseConfigError() {
  return getSupabaseServiceConfigError()
}

export function createSupabaseAnonClient() {
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!url || !anonKey) {
    throw new Error('Supabase 匿名客户端未配置（SUPABASE_URL / SUPABASE_ANON_KEY）')
  }
  if (cachedAnonClient) return cachedAnonClient
  cachedAnonClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
  return cachedAnonClient
}

export function createSupabaseServiceClient() {
  const url = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase Service 客户端未配置（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）')
  }
  if (cachedServiceClient) return cachedServiceClient
  cachedServiceClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
  return cachedServiceClient
}
