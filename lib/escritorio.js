// De qual escritório é isto — UMA fonte só.
//
// Até aqui, 25 arquivos repetiam `const ESCRITORIO_CMP = '908f77fc-…'`. Enquanto
// o sistema atendia um escritório só, funcionava. Para a primeira versão autônoma
// (um escritório de testes rodando na mesma raiz, sem ver nem tocar nos dados da
// CMP) isso vira defeito: qualquer rota esquecida grava no escritório errado.
//
// Regra: nenhuma rota escreve o uuid na mão. Ou importa ESCRITORIO_PADRAO daqui
// (o escritório da instalação), ou — melhor — pergunta de quem é o pedido com
// escritorioDoRequest(request), que devolve o escritório do usuário logado.
//
// O padrão vem do ambiente (ESCRITORIO_ID). Uma instalação de teste em outra VPS
// muda uma variável e roda sozinha, sem tocar em código.
import { createClient } from '@supabase/supabase-js'

export const ESCRITORIO_PADRAO =
  String(process.env.ESCRITORIO_ID || '908f77fc-19f5-4d86-9576-f5590af09e0a').trim()

/* nome antigo, mantido para os imports que já existiam */
export const ESCRITORIO_CMP = ESCRITORIO_PADRAO

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// cache curto: uma ficha de processo dispara várias rotas seguidas e todas
// perguntariam a mesma coisa ao banco.
const cache = new Map()
const VIDA_MS = 60000

/** o escritório de um usuário já autenticado (objeto user do Supabase) */
export async function escritorioDoUsuario(user) {
  const id = user && user.id
  if (!id) return ESCRITORIO_PADRAO
  const agora = Date.now()
  const guardado = cache.get(id)
  if (guardado && agora - guardado.quando < VIDA_MS) return guardado.esc
  let esc = ESCRITORIO_PADRAO
  try {
    const { data } = await admin().from('usuarios').select('escritorio_id').eq('id', id).maybeSingle()
    if (data && data.escritorio_id) esc = data.escritorio_id
  } catch (e) {}
  cache.set(id, { esc, quando: agora })
  return esc
}

/** o usuário do JWT (header Authorization, ?jwt= ou ?token=), ou null */
export async function usuarioDoRequest(request) {
  let jwt = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    try {
      const sp = new URL(request.url).searchParams
      jwt = sp.get('jwt') || sp.get('token') || ''
    } catch (e) {}
  }
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

/** o escritório de quem está pedindo — cai no padrão quando não há login (robôs) */
export async function escritorioDoRequest(request) {
  const user = await usuarioDoRequest(request)
  return escritorioDoUsuario(user)
}

/**
 * A pasta de documentos do escritório dentro da raiz do disco.
 * O escritório padrão continua em /opt/cmpdocs (nada se move, nada quebra);
 * os demais ficam em /opt/cmpdocs/_esc/<uuid>.
 */
export function pastaDoEscritorio(raiz, esc) {
  const base = String(raiz || '').replace(/\/+$/, '')
  const id = String(esc || '').trim()
  if (!id || id === ESCRITORIO_PADRAO || !RE_UUID.test(id)) return base
  return base + '/_esc/' + id.toLowerCase()
}
