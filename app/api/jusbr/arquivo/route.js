// jus.br / PDPJ — servir um arquivo já baixado (visualizar/baixar no sistema).
//   GET /api/jusbr/arquivo?id=<uuid>[&dl=1]   (Authorization: Bearer <jwt> OU ?jwt=)
// Devolve o PDF guardado (jusbr_arquivos). Aceita o JWT no header ou na query
// (a query é útil para abrir o PDF direto numa nova aba / <embed>).

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { tipoRealDoArquivo, pdfDeTexto } from '../lib.js'
import { escritorioDoUsuario, semEscritorio } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const dl = searchParams.get('dl')
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || searchParams.get('jwt') || ''
  if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
  if (!jwt) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await auth.auth.getUser(jwt)
  if (!(u && u.data && u.data.user)) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const sb = admin()
  // O arquivo é entregue pelo id. Sem amarrar ao escritório de quem pede, um
  // usuário logado de OUTRO escritório baixaria peça de processo alheio só
  // adivinhando o id — por isso o escritório entra no filtro, não como enfeite.
  const esc = await escritorioDoUsuario(u.data.user.id, sb)
  if (!esc) return semEscritorio()
  const { data } = await sb.from('jusbr_arquivos').select('doc_nome,doc_tipo,conteudo_b64,caminho_disco').eq('escritorio_id', esc).eq('id', id).maybeSingle()
  if (!data) return Response.json({ erro: 'arquivo não encontrado (pode ter expirado)' }, { status: 404 })

  // depois da faxina o conteúdo mora no disco do VPS e o banco guarda só o
  // caminho; arquivos ainda não migrados continuam vindo do conteudo_b64.
  let buf = null
  if (data.conteudo_b64) buf = Buffer.from(data.conteudo_b64, 'base64')
  else if (data.caminho_disco) { try { buf = fs.readFileSync(data.caminho_disco) } catch (e) { buf = null } }
  if (!buf || !buf.length) return Response.json({ erro: 'arquivo não encontrado (pode ter expirado)' }, { status: 404 })
  // O rótulo guardado não é confiável: o PDPJ manda TEXTO puro dizendo que é PDF,
  // e o navegador responde "Falha ao carregar o documento PDF". Vale o conteúdo.
  let tipo = tipoRealDoArquivo(buf, data.doc_tipo, data.doc_nome)
  // texto puro rotulado como PDF: entregamos um PDF de verdade, montado na hora —
  // é o que o advogado espera abrir/imprimir, sem precisar rebaixar o arquivo.
  if (tipo === 'text/plain' && String(data.doc_tipo || '').indexOf('pdf') > -1) {
    try {
      buf = await pdfDeTexto(buf.toString('utf8'), data.doc_nome)
      tipo = 'application/pdf'
    } catch (e) { tipo = 'text/plain; charset=utf-8' }
  }
  const ext = tipo.indexOf('html') > -1 ? '.html' : (tipo.indexOf('pdf') > -1 ? '.pdf' : (tipo.indexOf('text/plain') > -1 ? '.txt' : ''))
  const nome = (data.doc_nome || 'documento').replace(/[^\w.\- ]+/g, '_')
  const nomeFinal = /\.\w+$/.test(nome) ? nome : (nome + ext)
  // HTML do jus.br (expediente/decisão): tira o <script> (que travava em "Carregando")
  // e as <img> quebradas (logo/spinner), e aponta o <base> para o PDPJ. Assim o TEXTO
  // da intimação/decisão aparece limpo, sem quadro quebrado. Só ao visualizar (inline).
  if (!dl && tipo.indexOf('html') > -1) {
    try {
      let h = buf.toString('utf8')
      h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<img\b[^>]*>/gi, '')
      if (!/<base\b/i.test(h)) h = h.replace(/<head([^>]*)>/i, '<head$1><base href="https://portaldeservicos.pdpj.jus.br/">')
      buf = Buffer.from(h, 'utf8')
    } catch (e) {}
  }
  const disp = (dl ? 'attachment' : 'inline') + '; filename="' + nomeFinal + '"'
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': disp,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
