import './globals.css'
import HomeAuthActions from './home-auth-actions'

export const metadata = {
  title: '录音文件管理',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="global-top-nav-wrap">
          <div className="global-top-nav">
            <HomeAuthActions />
          </div>
        </div>
        {children}
      </body>
    </html>
  )
}
