export const metadata = {
  title: 'Chat da Equipe',
  description: 'Chat interno da equipe — funciona no navegador e no celular',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
