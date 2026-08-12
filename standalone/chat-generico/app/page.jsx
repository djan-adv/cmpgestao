import { redirect } from 'next/navigation'

// a raiz do site leva direto para o chat
export default function Home() {
  redirect('/chat')
}
