// Quem é o escritório desta requisição.
//
// O sistema nasceu para um escritório só, e o id da CMP ficou escrito à mão em
// 26 arquivos (`const ESCRITORIO_CMP = '908f77fc-...'`). Enquanto havia um
// inquilino só isso era inofensivo. Com um segundo escritório dentro do mesmo
// banco vira vazamento: o cliente novo faz login, pede um documento, e a rota
// procura no escritório da CMP — usando, no caso do jus.br, a sessão e o
// certificado da CMP.
//
// A regra passa a ser: quem tem usuário logado descobre o escritório PELO
// USUÁRIO. Robô e cron não têm usuário; esses continuam na raiz enquanto a
// fase 2 (robôs por inquilino) não chega, e isso está marcado caso a caso.

import { createClient } from '@supabase/supabase-js'

// A raiz é o escritório do dono do sistema (a CMP). Fica em variável de
// ambiente para que uma instalação nova não herde o id da CMP; o valor de
// fábrica mantém a instalação atual funcionando sem mexer no .env.local.
// Aceita os dois nomes de variável: ESCRITORIO_ID nasceu numa primeira versão
// desta mesma mudança, feita em paralelo, e pode já estar configurada no
// servidor. Trocar o nome sem aviso derrubaria a instalação que a usa.
export const ESCRITORIO_RAIZ = String(
  process.env.ESCRITORIO_RAIZ_ID || process.env.ESCRITORIO_ID ||
  '908f77fc-19f5-4d86-9576-f5590af09e0a',
).trim()

// O Next põe em cache as requisições `fetch` feitas dentro de rotas, e o
// supabase-js consulta por fetch. Foi assim que o robô do diário passou a rodar
// para uma lista de escritórios CONGELADA: ele varria os dois escritórios que
// existiam quando a lista foi cacheada e simplesmente não enxergava o cliente
// cadastrado depois — sem erro nenhum, o que é o pior tipo de defeito. Aqui a
// consulta é sempre fresca, para todos os robôs de uma vez.
function semCache(url, opcoes) {
  return fetch(url, { ...opcoes, cache: 'no-store' })
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: semCache },
  })
}

// usuário logado a partir do "Authorization: Bearer <jwt>" — null se não houver
export async function usuarioDoRequest(request) {
  const auth = (request && request.headers && request.headers.get('authorization')) || ''
  const jwt = auth.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data } = await sb.auth.getUser(jwt)
    return (data && data.user) || null
  } catch (e) { return null }
}

// escritório de um usuário já identificado
export async function escritorioDoUsuario(userId, sb) {
  if (!userId) return null
  const cli = sb || admin()
  try {
    const { data } = await cli.from('usuarios').select('escritorio_id').eq('id', userId).maybeSingle()
    return (data && data.escritorio_id) || null
  } catch (e) { return null }
}

// O caminho normal das rotas que atendem alguém logado.
// Devolve { user, escritorio } — escritorio é null quando não há login válido.
// Nunca cai na raiz por conta própria: cair na raiz calado é exatamente o bug
// que esta função existe para impedir. Quem quiser esse comportamento pede.
export async function inquilinoDoRequest(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return { user: null, escritorio: null }
  const escritorio = await escritorioDoUsuario(user.id)
  return { user, escritorio }
}

// resposta padrão quando a rota precisa de um escritório e não achou nenhum
export function semEscritorio() {
  return Response.json(
    { erro: 'Sem escritório: faça login novamente. Se persistir, o seu usuário está sem escritório vinculado.' },
    { status: 403 },
  )
}

// Onde ficam os documentos deste escritório no disco do VPS.
//
// O acervo do dono está em /opt/cmpdocs desde o começo, com dezenas de GB — não
// vale mover isso para ganhar um nível de pasta. A raiz continua onde está e
// cada inquilino novo ganha uma árvore IRMÃ, nunca uma subpasta: a tela de
// documentos lista o conteúdo da raiz, então uma pasta de inquilino embaixo
// dela apareceria para o dono como se fosse acervo dele. É o mesmo arranjo que
// a Inove já usa (/opt/cmpdocs-inove).
// Sem separar, dois escritórios com o mesmo número de processo (e número se
// repete entre tribunais) escreveriam na mesma pasta.
export function raizDocs(esc) {
  const base = process.env.DOCS_ROOT || '/opt/cmpdocs'
  if (!esc || esc === ESCRITORIO_RAIZ) return base
  return base + '-inq/' + esc
}

// A pasta de UM processo. Existe para não haver duas maneiras de montar este
// caminho no sistema: número de processo se repete entre tribunais, e bastou um
// módulo montar `/opt/cmpdocs/<numero>` por conta própria para dois escritórios
// gravarem na mesma pasta. Quem precisa do caminho pede aqui.
export function pastaProcesso(esc, numero) {
  return raizDocs(esc) + '/' + String(numero || '').replace(/\D/g, '')
}

// Quem assina um envio: o id do escritório, ou `null` quando é a raiz.
//
// A conta de e-mail da raiz é a do ambiente e o resto do sistema a identifica
// por `null` (ver contaDeEnvio). Passar o id da raiz faz o sistema procurar uma
// conta cadastrada que não existe — e o e-mail não sai. Como os robôs e crons
// leem o escritório de uma LINHA (que sempre traz o id, inclusive o da raiz),
// esta função faz a tradução num lugar só.
export async function remetenteDoEscritorio(escId) {
  if (!escId || escId === ESCRITORIO_RAIZ) return null
  try {
    const { data } = await admin().from('escritorios').select('raiz').eq('id', escId).maybeSingle()
    if (data && data.raiz === true) return null
  } catch (e) {}
  return escId
}

// O e-mail de contato do escritório (cadastro do escritório → dados.email).
// É para onde vão os avisos internos DELE — confirmação de assinatura, por
// exemplo. Sem isso, esses avisos caíam todos na caixa da casa, levando junto o
// nome do cliente de quem não é cliente dela.
export async function emailDoEscritorio(escId) {
  if (!escId) return ''
  try {
    const { data } = await admin().from('escritorios').select('dados').eq('id', escId).maybeSingle()
    const e = data && data.dados && data.dados.email
    return (e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim())) ? String(e).trim() : ''
  } catch (e) { return '' }
}

// ---------------------------------------------------------------------------
// Canais que saem para FORA (e-mail, WhatsApp, protocolo, assinatura).
//
// As credenciais desses canais são do dono do sistema: o SMTP é a caixa dele, o
// número de WhatsApp é o dele, o certificado do jus.br é o dele. Enquanto um
// escritório cliente não tiver as PRÓPRIAS credenciais, um clique no botão
// "enviar" faria sair, do endereço do fornecedor, um e-mail para o cliente ou
// para a vara de outro escritório. Não é vazamento de dado — é pior: é um ato
// praticado em nome de quem não autorizou.
//
// Por isso o canal externo é o único item que NÃO vem liberado de fábrica. Os
// demais módulos ficam todos ligados (modulos nulo = tudo liberado); os canais
// só abrem quando alguém liga explicitamente, depois de configurar credencial
// própria. Mesma decisão que já valeu para a Inove: envio desligado.
export async function canalLiberado(esc, canal) {
  if (!esc) return { ok: false, erro: 'Sem escritório.' }
  const sb = admin()
  const { data } = await sb.from('escritorios').select('raiz,ativo,modulos,nome').eq('id', esc).maybeSingle()
  if (!data) return { ok: false, erro: 'Escritório não encontrado.' }
  if (data.ativo === false) return { ok: false, erro: 'Este escritório está com o acesso suspenso.' }
  if (data.raiz === true) return { ok: true, raiz: true }
  const mod = data.modulos || {}
  if (mod[canal] === true) return { ok: true, raiz: false }
  return {
    ok: false,
    erro: 'O envio por ' + (canal === 'email' ? 'e-mail' : canal) + ' ainda não está configurado para este escritório. ' +
          'Ele será liberado quando a conta de envio própria do escritório for cadastrada — até lá, nada sai daqui em nome de terceiros.',
  }
}

export function bloqueioDeCanal(res) {
  return Response.json({ erro: res.erro, canal_bloqueado: true }, { status: 403 })
}

// ---------------------------------------------------------------------------
// Robôs e cron não têm usuário logado — não existe "escritório de quem pediu".
// Antes disso, todos rodavam com o id do escritório dono escrito no código, o
// que num sistema vendido significa: o robô do cliente varre o acervo do
// fornecedor, e o cliente paga por uma varredura que não é dele.
//
// A regra passa a ser: o robô roda UMA VEZ POR ESCRITÓRIO ATIVO. Alguns robôs
// não têm sentido por inquilino (os que usam conta bancária, número de
// WhatsApp ou produto de captação do dono) — esses seguem só na raiz, e isso
// está dito em cada um deles, não subentendido.
export async function escritoriosAtivos(filtro) {
  const sb = admin()
  const { data } = await sb.from('escritorios').select('id,nome,raiz,oabs,modulos').eq('ativo', true)
  let lista = data || []
  // com sessão do jus.br: só faz sentido varrer tribunal para quem tem
  // certificado sincronizado. Os demais nem entram na fila.
  if (filtro === 'jusbr') {
    const { data: ses } = await sb.from('jusbr_sessao').select('escritorio_id')
    const comSessao = new Set((ses || []).map(r => r.escritorio_id))
    lista = lista.filter(e => comSessao.has(e.id))
  }
  // varredura do diário: só quem cadastrou OAB
  if (filtro === 'oab') lista = lista.filter(e => Array.isArray(e.oabs) && e.oabs.length > 0)
  return lista
}
