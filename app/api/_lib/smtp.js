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
  // Dizer "não cadastrou a conta" quando o que falta é só a SENHA manda o
  // escritório conferir servidor e usuário, que estão certos, e não olhar o
  // único campo que importa. O campo de senha vem em branco de propósito (para
  // não devolver a senha ao navegador), e é fácil salvar sem preencher.
  if (!c || !c.host || !c.usuario) {
    return { erro: 'Este escritório ainda não cadastrou a conta de e-mail. Abra o cadastro do escritório e informe servidor, usuário e senha.' }
  }
  if (!c.senha) {
    return { erro: 'Falta a SENHA da caixa ' + c.usuario + '. O servidor e o usuário já estão salvos — digite a senha no cadastro do escritório e salve de novo (o campo vem em branco por segurança, e salvar sem preenchê-lo mantém a senha anterior, que aqui ainda não existe).' }
  }
  return { host: c.host, port: c.porta || 465, user: c.usuario, pass: c.senha, fromNome: c.remetente_nome || '' }
}

// A conta de LEITURA (IMAP) do escritório.
//
// Ler a caixa é o outro lado do envio, e faltava: o robô lia sempre a caixa do
// dono do sistema. Num sistema vendido, isso é o escritório cliente nunca
// receber no histórico a resposta da vara dele — e, pior, um e-mail da caixa do
// fornecedor ter chance de encostar numa ficha que não é dele.
//
// O host de IMAP quase sempre é o do SMTP com "smtp." trocado por "imap.", e é
// isso que assumimos quando o escritório não informa nada. Quem tem provedor
// fora do padrão preenche o campo no cadastro.
export function imapDoSmtp(host) {
  return String(host || '').replace(/^smtp\./i, 'imap.')
}

export async function contaDeLeitura(esc, ehRaiz) {
  if (ehRaiz) {
    const host = process.env.IMAP_HOST || imapDoSmtp(process.env.SMTP_HOST || '') || 'imap.hostinger.com'
    const port = parseInt(process.env.IMAP_PORT || '993', 10)
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
    if (!host || !user || !pass) return { erro: 'IMAP não configurado no servidor (SMTP_USER/SMTP_PASS).' }
    return { host, port, user, pass }
  }
  const envio = await contaDeEnvio(esc, false)
  if (envio.erro) return envio
  const { data } = await admin().from('escritorio_smtp')
    .select('imap_host,imap_porta').eq('escritorio_id', esc).maybeSingle()
  const host = (data && data.imap_host) || imapDoSmtp(envio.host)
  const port = (data && data.imap_porta) || 993
  if (!host) return { erro: 'Sem servidor de leitura (IMAP) para este escritório.' }
  return { host, port, user: envio.user, pass: envio.pass }
}
