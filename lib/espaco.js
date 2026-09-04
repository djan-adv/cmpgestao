// Quanto o escritório já ocupa no disco — e se ainda cabe o que ele quer subir.
//
// `escritorios.limite_gb` existia desde a fundação multi-inquilino, com o
// comentário dizendo que "cobrar por GB só faz sentido se o sistema souber
// medir e travar". Medir ele sabia (o censo da tela de documentos); travar,
// não. O teto valia por confiança — e no teste de 30 dias, com 1 GB, confiança
// não segura: basta um cliente subir a íntegra de uns poucos processos.
//
// O disco do VPS é o gargalo real do produto: é finito, é compartilhado por
// todos os escritórios e já derrubou o sistema uma vez (ops/INCIDENTE-2026-08-02).
// Por isso o teto se aplica ANTES da gravação, não depois.

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { raizDocs, ESCRITORIO_RAIZ } from '../app/api/_lib/inquilino.js'

const GB = 1073741824

// Somar a árvore inteira a cada pedaço de upload seria caro: um arquivo grande
// sobe em muitos pedaços, e o censo custa uma leitura por arquivo. Então o
// censo vale por um tempo curto, e o que foi gravado desde ele é somado por
// fora. Errar para MAIS (contar bytes que talvez já estivessem lá) é o lado
// seguro: no máximo o cliente bate no teto um pouco antes.
const VALIDADE_MS = 30000
const cache = new Map()   // escritorio_id -> { bytes, quando, desde }

function somar(dir, prof) {
  if ((prof || 0) > 8) return 0
  let total = 0
  let itens
  try { itens = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return 0 }
  for (const d of itens) {
    const full = path.join(dir, d.name)
    if (d.isDirectory()) total += somar(full, (prof || 0) + 1)
    else { try { total += fs.statSync(full).size } catch (e) {} }
  }
  return total
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// Teto do escritório em bytes. null = sem teto (a raiz e quem contratou assim).
export async function limiteDoEscritorio(esc, sb) {
  if (!esc || esc === ESCRITORIO_RAIZ) return null
  try {
    const cli = sb || admin()
    const { data } = await cli.from('escritorios').select('limite_gb').eq('id', esc).maybeSingle()
    const gb = data && data.limite_gb
    if (gb == null || !(Number(gb) > 0)) return null
    return Math.round(Number(gb) * GB)
  } catch (e) {
    // Não sabendo o teto, o sistema NÃO bloqueia. Uma falha de leitura do
    // cadastro não pode impedir um escritório de guardar documento — o custo
    // do erro para o lado do bloqueio é maior do que o de alguns megabytes.
    return null
  }
}

// Quanto já está ocupado, com o censo em cache curto.
export function ocupadoAgora(esc) {
  const c = cache.get(esc)
  if (c && Date.now() - c.quando < VALIDADE_MS) return c.bytes + c.desde
  const bytes = somar(raizDocs(esc), 0)
  cache.set(esc, { bytes, quando: Date.now(), desde: 0 })
  return bytes
}

// Registra o que acabou de ser gravado, para os pedaços seguintes do mesmo
// upload já contarem sem refazer o censo.
export function contabilizar(esc, bytes) {
  const c = cache.get(esc)
  if (c) c.desde += Number(bytes) || 0
}

// A pergunta que as rotas fazem: cabe mais `bytes` para este escritório?
// Devolve { cabe:true } ou { cabe:false, erro: '<frase para a tela>' }.
export async function cabeMais(esc, bytes, sb) {
  const limite = await limiteDoEscritorio(esc, sb)
  if (limite == null) return { cabe: true, limite: null }
  const usado = ocupadoAgora(esc)
  if (usado + (Number(bytes) || 0) <= limite) {
    return { cabe: true, limite, usado, restante: limite - usado }
  }
  const gb = (n) => (n / GB).toFixed(2).replace('.', ',')
  return {
    cabe: false, limite, usado, restante: Math.max(0, limite - usado),
    erro: 'O espaço do plano acabou: ' + gb(usado) + ' GB de ' + gb(limite) + ' GB em uso. ' +
          'Nada foi apagado — ao contratar um plano maior, o espaço aumenta e os arquivos continuam onde estão.',
  }
}
