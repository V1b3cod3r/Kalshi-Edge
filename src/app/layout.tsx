import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Kalshi Edge — AI Prediction Market Trading',
  description: 'AI-powered prediction market trading analysis tool. Analyze Kalshi markets with Claude, manage macro views, and optimize position sizing with Kelly Criterion.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ backgroundColor: '#0a0a0f' }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
