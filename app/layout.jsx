// Marca por instância (white-label): a instância de venda define NEXT_PUBLIC_BRAND_NAME
// no .env.local dela; sem nada definido, tudo continua CMP.
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'CMPGestão'
const EH_CMP = BRAND_NAME === 'CMPGestão'

export const metadata = {
  title: BRAND_NAME,
  description: 'Gestão jurídica — processos, andamentos e diligências.',
  // ícone do escritório nos atalhos do celular e na aba do navegador
  // (vale para todas as páginas Next: CMP.sign — /assinar, /assinatura, /painel etc.)
  icons: EH_CMP ? {
    icon: '/favicon-cmp.png',
    apple: '/apple-touch-icon.png',
  } : undefined,
  appleWebApp: { title: EH_CMP ? 'CMP.sign' : BRAND_NAME },
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
