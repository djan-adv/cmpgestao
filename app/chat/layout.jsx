export const metadata = {
  title: 'Chat CMPGestão',
  description: 'Chat interno do escritório — acesso pelo celular',
  // no iPhone o alarme só funciona com o site instalado na tela de início, e é
  // por aqui que a equipe instala: o atalho precisa se chamar Chat, não o nome
  // do assinador
  appleWebApp: { title: 'CMP Chat', capable: true },
}

export default function ChatLayout({ children }) {
  return children
}
