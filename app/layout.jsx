// O título fica NEUTRO por padrão. Este layout vale para todas as páginas,
// inclusive a porta comum do produto, onde o nome de um escritório específico
// não pode aparecer — quem entra por lá pode ser de qualquer escritório.
// Quem sabe de quem é o endereço é a tela de login (e o sistema, depois do
// login): as duas ajustam o título no navegador com o nome certo.
export const metadata = {
  title: 'Gestão',
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
  appleWebApp: { title: 'Gestão' },
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
