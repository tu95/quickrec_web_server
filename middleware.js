import { NextResponse } from 'next/server'

export function middleware(request) {
  const method = String(request.method || '').toUpperCase()
  const hasNextActionHeader = !!request.headers.get('next-action')
  const pathname = request.nextUrl.pathname || '/'
  const isApiRoute = pathname.startsWith('/api/')
  const isStaticAsset = pathname.startsWith('/_next/') || pathname === '/favicon.ico'

  // 该项目未使用 Server Actions。拦截来自旧构建的陈旧 action 请求，避免页面直接抛错。
  if (method === 'POST' && hasNextActionHeader && !isApiRoute && !isStaticAsset) {
    const url = request.nextUrl.clone()
    return NextResponse.redirect(url, 303)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/:path*'],
}
