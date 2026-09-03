import './globals.css'
import Providers from './providers'

export const metadata = { title: 'Admin — Casino' }
export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
