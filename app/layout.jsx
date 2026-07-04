export const metadata = {
  title: 'CMPGestão',
  description: 'Gestão jurídica — processos, andamentos e diligências.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, Barlow, Arial, sans-serif', background: '#f3f4f6', color: '#1e293b' }}>
        {children}
      </body>
    </html>
  )
}
