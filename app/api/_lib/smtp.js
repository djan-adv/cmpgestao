// A conta de envio de um escritório.
//
// Enquanto o sistema era de uma casa só, o SMTP vinha de variável de ambiente.
// Com escritórios clientes, isso faria o e-mail deles sair do endereço do
// fornecedor — para o cliente ou a vara do escritório, em nome de quem não
// autorizou. Cada escritório usa a própria conta; a raiz continua com a do
// ambiente, que é a dela.
//
// A senha é credencial de terceiro: viaja e fica cifrada no banco (pgcrypto),
// e só é decifrada aqui, no servidor, na hora de enviar.

import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// A mesma chave que já cifra a sessão do jus.br. Reaproveitada de propósito:
// duas chaves separadas significariam dois lugares para esquecer de configurar,
// e a consequência de esquecer é o envio parar sem explicação.
export function chaveCifra() {
  return process.env.JUSBR_ENC_KEY || process.env.SMTP_ENC_KEY || ''
}

// Devolve { host, port, user, pass, fromNome } ou { erro }.
export async function contaDeEnvio(esc, ehRaiz) {
  if (ehRaiz) {
    const host = process.env.SMTP_HOST
    const port = parseInt(process.env.SMTP_PORT || '465', 10)
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    if (!host || !user || !pass) return { erro: 'SMTP não configurado no servidor (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).' }
    return { host, port, user, pass, fromNome: process.env.SMTP_FROM_NAME || '' }
  }
  if (!esc) return { erro: 'Sem escritório.' }
  const key = chaveCifra()
  if (!key) return { erro: 'Servidor sem chave de cifragem — não consigo ler a senha guardada.' }
  const { data, error } = await admin().rpc('smtp_get', { p_esc: esc, p_key: key })
  if (error) return { erro: 'Não consegui ler a conta de envio: ' + error.message }
  const c = Array.isArray(data) ? data[0] : data
  if (!c || !c.host || !c.usuario || !c.senha) {
    return { erro: 'Este escritório ainda não cadastrou a conta de e-mail. Abra o cadastro do escritório e informe servidor, usuário e senha.' }
  }
  return { host: c.host, port: c.porta || 465, user: c.usuario, pass: c.senha, fromNome: c.remetente_nome || '' }
}
