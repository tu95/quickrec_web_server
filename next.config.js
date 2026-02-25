/** @type {import('next').NextConfig} */
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim()

const nextConfig = {
  // 将 dev / build-start 的产物目录隔离，避免 .next 被不同模式污染
  distDir: configuredDistDir || '.next',
  // 允许来自 Zepp App WebView 的跨域请求
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '*' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
