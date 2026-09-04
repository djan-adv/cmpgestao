// Marca d'água nos documentos que o ESTAGIÁRIO abre — liga, desliga e mostra.
//
//   GET  /api/marca-dagua            -> { ligado, pode_mudar, exemplo_de }
//   GET  /api/marca-dagua?exemplo=1  -> PDF de exemplo, com o carimbo aplicado
//   POST /api/marca-dagua { ligado } -> liga/desliga (só coordenação)
//
// É OPCIONAL de propósito: escritório que trabalha com estagiário de confiança
// não precisa carimbar nada, e um sistema que carimba sozinho seria mais um
// atrito para explicar ao cliente. Quem decide é a coordenação do escritório.
//
// O exemplo existe porque a pergunta que o dono fez primeiro foi "como fica para
// o estagiário?". Descrever não responde: a página mostra a folha carimbada,
// com o nome de quem está olhando, do jeito exato que o estagiário vai ver.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'
import { CHAVE_CONFIG, marcarPdf, etiquetaDe } from '../../../lib/marcadagua.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 30

const PAPEIS_QUE_MANDAM = ['contratante', 'socio']

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

async function quem(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return { erro: 'não autenticado', status: 401 }
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return { semEsc: true }
  const sb = admin()
  const { data } = await sb.from('usuarios').select('nome,email,papel').eq('id', user.id).maybeSingle()
  return { user, esc, sb, perfil: data || {}, manda: PAPEIS_QUE_MANDAM.includes(String((data && data.papel) || '')) }
}

async function ligado(sb, esc) {
  const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', esc).eq('chave', CHAVE_CONFIG).maybeSingle()
  return /^(1|true|sim|on)$/i.test(String((data && data.valor) || '').trim())
}

/* A folha de exemplo: um pedaço de petição qualquer, só para o carimbo ter
   sobre o que cair. Nada de dado de processo real — a tela é de configuração,
   não de acervo. */
async function pdfDeExemplo() {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const fonte = await doc.embedFont(StandardFonts.TimesRoman)
  const negrito = await doc.embedFont(StandardFonts.TimesRomanBold)
  const pag = doc.addPage([595.28, 841.89])
  const T = rgb(0.06, 0.09, 0.13)
  pag.drawText('EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO', { x: 85, y: 762, size: 11.5, font: negrito, color: T })
  let y = 700
  const linhas = [
    'Fulano de Tal, já qualificado nos autos em epígrafe, vem, respeitosamente, à',
    'presença de Vossa Excelência, por seu advogado que esta subscreve, apresentar',
    'RÉPLICA à contestação, pelos fundamentos de fato e de direito a seguir expostos.',
    '',
    'Esta é uma folha de exemplo. O texto continua nítido e pode ser copiado',
    'normalmente — a marca d’água fica ao FUNDO e não é texto, então ela não',
    'entra no copiar e colar de quem estiver lendo.',
  ]
  for (const l of linhas) { if (l) pag.drawText(l, { x: 85, y, size: 11.5, font: fonte, color: T }); y -= 19 }
  return Buffer.from(await doc.save())
}

export async function GET(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })

  if (new URL(request.url).searchParams.get('exemplo') != null) {
    const base = await pdfDeExemplo()
    // o carimbo do exemplo leva o nome de quem pediu: é assim que o coordenador
    // vê o formato exato (nome, e-mail, data e hora) que sai para o estagiário
    const { data: e0 } = await q.sb.from('escritorios').select('teste_ate').eq('id', q.esc).maybeSingle()
    const buf = await marcarPdf(base, etiquetaDe(q.perfil, !!(e0 && e0.teste_ate)))
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="exemplo-marca-dagua.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  }

  // Durante o teste a marca vale para TODOS e não se desliga. Dizer isso aqui
  // evita o pior desfecho da tela: o contratante ver a chave "desligada",
  // concluir que os documentos saem limpos, e descobrir o contrário abrindo um
  // PDF na frente de um cliente.
  const { data: escr } = await q.sb.from('escritorios').select('teste_ate').eq('id', q.esc).maybeSingle()
  const emTeste = !!(escr && escr.teste_ate)

  return Response.json({
    ok: true,
    ligado: emTeste ? true : await ligado(q.sb, q.esc),
    pode_mudar: q.manda && !emTeste,
    forcado_teste: emTeste,
    exemplo_de: etiquetaDe(q.perfil, emTeste),
  })
}

export async function POST(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  if (!q.manda) return Response.json({ erro: 'Só a coordenação do escritório liga ou desliga a marca d’água.' }, { status: 403 })

  let b = {}
  try { b = await request.json() } catch (e) {}
  const valor = b.ligado === true || /^(1|true|sim|on)$/i.test(String(b.ligado || '')) ? '1' : '0'
  const { error } = await q.sb.from('produtividade_config').upsert(
    { escritorio_id: q.esc, chave: CHAVE_CONFIG, valor },
    { onConflict: 'escritorio_id,chave' })
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  return Response.json({ ok: true, ligado: valor === '1' })
}
