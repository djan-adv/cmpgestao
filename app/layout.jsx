export const metadata = {
  title: 'CMPGestão',
  description: 'Gestão jurídica — processos, andamentos e diligências.',
  // ícone do escritório nos atalhos do celular e na aba do navegador
  // (vale para todas as páginas Next: CMP.sign — /assinar, /assinatura, /painel etc.)
  icons: {
    icon: '/favicon-cmp.png',
    apple: '/apple-touch-icon.png',
  },
  // Nome sugerido ao "Adicionar à Tela de Início" no iPhone. Era 'CMP.sign' —
  // nome do assinador — e aparecia até para quem estava instalando o gestão ou o
  // chat, que é o caso de quem precisa do alarme.
  appleWebApp: { title: 'CMPGestão' },
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
