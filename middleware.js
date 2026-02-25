import { NextResponse } from 'next/server'

export function middleware(request) {
  const method = String(request.method || '').toUpperCase()
  const hasNextActionHeader = !!request.headers.get('next-action')
  const pathname = request.nextUrl.pathname || '/'
  const isApiRoute = pathname.startsWith('/api/')
  const isStaticAsset = pathname.startsWith('/_next/') || pathname === '/favicon.ico'
  const siteSession = request.cookies.get('zr_site_session')?.value || ''
  const isLoginPage = pathname === '/login'
  const protectedApiPrefixes = [
    '/api/admin/',
    '/api/files',
    '/api/meeting-notes',
    '/api/convert-mp3'
  ]
  const isProtectedApi = protectedApiPrefixes.some(prefix => pathname.startsWith(prefix))

  // 该项目未使用 Server Actions。拦截来自旧构建的陈旧 action 请求，避免页面直接抛错。
  if (method === 'POST' && hasNextActionHeader && !isApiRoute && !isStaticAsset) {
    const url = request.nextUrl.clone()
    return NextResponse.redirect(url, 303)
  }

  if (isStaticAsset) {
    return NextResponse.next()
  }

  if (isApiRoute && isProtectedApi && !siteSession) {
    return NextResponse.json(
      { success: false, error: '未登录，请先访问 /login' },
      { status: 401 }
    )
  }

  if (!isApiRoute && !isLoginPage && !siteSession) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    const nextPath = `${pathname}${request.nextUrl.search || ''}`
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl)
  }

  if (!isApiRoute && isLoginPage && siteSession) {
    const next = request.nextUrl.searchParams.get('next') || '/'
    const targetUrl = new URL(next.startsWith('/') ? next : '/', request.url)
    return NextResponse.redirect(targetUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/:path*'],
}
