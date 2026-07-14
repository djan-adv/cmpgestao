// Petição automática (MINUTA) — o Claude redige na hora a peça pedida, com base no
// histórico do processo (andamentos) e nos documentos do processo (/opt/cmpdocs).
// Salva a minuta como Word (.doc) anexado ao histórico (bucket 'capturas' + tabela
// anexos), registra o lançamento na data do pedido e cria uma tarefa para D+1
// ("protocolar/corrigir"). É SEMPRE um rascunho para revisão — nunca protocola.
//
//   POST /api/peticao  (Authorization: Bearer <jwt>)  { numero, instrucao }

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ROOT = '/opt/cmpdocs'
const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const MAX_FILES = 6
const MAX_DOC_BYTES = 24 * 1024 * 1024 // orçamento total de PDFs enviados à IA

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// coleta PDFs da pasta do processo (recursivo), pulando Lixeira e a pasta de minutas
function coletaPdfs(dir, arr) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const d of ents) {
    if (d.name === 'Lixeira' || d.name === '.meta.json' || d.name === 'Minutas (para revisão)') continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) coletaPdfs(full, arr)
    else if (/\.pdf$/i.test(d.name)) { try { const st = fs.statSync(full); arr.push({ full, nome: d.name, size: st.size, mtime: st.mtimeMs }) } catch (e) {} }
  }
}

function minutaDoc(proc, texto) {
  const paras = String(texto || '').split(/\n{2,}/).map(function (p) {
    return '<p style="text-align:justify;margin:0 0 10pt">' + escHtml(p).replace(/\n/g, '<br>') + '</p>'
  }).join('\n')
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
    '<head><meta charset="utf-8"><title>Minuta</title>' +
    '<style>body{font-family:\'Times New Roman\',serif;font-size:12pt;line-height:1.5;margin:2.5cm}</style></head><body>' +
    paras +
    '<p style="color:#888;font-size:9pt;margin-top:24pt">— Minuta gerada por IA para REVISÃO do advogado (não protocolar sem conferência). Processo ' + escHtml(proc.numero || '') + '.</p>' +
    '</body></html>'
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ erro: 'IA não configurada no servidor (falta ANTHROPIC_API_KEY).' }, { status: 501 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta SUPABASE_SERVICE_ROLE_KEY no servidor.' }, { status: 500 })

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').trim()
  const dig = numero.replace(/\D/g, '')
  const instrucao = String(body.instrucao || '').trim()
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })
  if (!instrucao) return Response.json({ erro: 'descreva o que a petição deve fazer' }, { status: 400 })

  const sb = admin()
  let proc = null
  {
    const r = await sb.from('processos').select('id,numero,cliente_nome,oponente,classe,assunto,orgao').eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
    proc = r.data || null
    if (!proc) { const r2 = await sb.from('processos').select('id,numero,cliente_nome,oponente,classe,assunto,orgao').eq('escritorio_id', ESCRITORIO_CMP).ilike('numero', '%' + dig + '%').maybeSingle(); proc = r2.data || null }
  }
  if (!proc) return Response.json({ erro: 'processo não encontrado no sistema' }, { status: 404 })

  // histórico recente
  const { data: ands } = await sb.from('andamentos').select('data,texto').eq('processo_id', proc.id).order('data', { ascending: false }).limit(40)
  const histTxt = (ands || []).map(a => (a.data || '') + ': ' + String(a.texto || '').replace(/\s+/g, ' ').slice(0, 700)).join('\n')

  // documentos (PDFs) mais recentes da pasta do processo (inclui _OUTRA_PARTE)
  const arr = []
  coletaPdfs(path.join(ROOT, dig), arr)
  arr.sort((a, b) => b.mtime - a.mtime)
  const content = []
  let bytes = 0, usados = 0
  const nomesUsados = []
  for (const f of arr) {
    if (usados >= MAX_FILES) break
    if (bytes + f.size > MAX_DOC_BYTES) continue
    try {
      const buf = fs.readFileSync(f.full)
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
      bytes += f.size; usados++; nomesUsados.push(f.nome)
    } catch (e) {}
  }

  const instr =
    'Você é assistente jurídico do escritório de advocacia Crispim, Mendonça e Pinheiro (CMP). ' +
    'Redija uma MINUTA (rascunho para revisão do advogado) da peça solicitada, com base EXCLUSIVA no histórico e nos documentos anexados. ' +
    'NÃO invente fatos, provas, datas, valores, nomes ou jurisprudência que não estejam nos autos. Se faltar informação essencial, escreva [VERIFICAR: ...] no ponto.\n\n' +
    'Processo nº ' + (proc.numero || '') + ' — Cliente: ' + (proc.cliente_nome || '') + ' — Parte contrária: ' + (proc.oponente || '') + ' — Classe/Assunto: ' + ((proc.classe || '') + ' ' + (proc.assunto || '')).trim() + ' — Órgão: ' + (proc.orgao || '') + '.\n\n' +
    'PEDIDO DO ADVOGADO: ' + instrucao + '\n\n' +
    'HISTÓRICO RECENTE (mais novo primeiro):\n' + (histTxt || '(sem histórico)') + '\n\n' +
    (usados ? ('Foram anexados ' + usados + ' documento(s) do processo (PDF): ' + nomesUsados.join('; ') + '.\n\n') : 'Nenhum PDF foi localizado na pasta do processo — redija com base no histórico e sinalize [VERIFICAR] onde faltar documento.\n\n') +
    'Escreva a PEÇA COMPLETA, em português jurídico formal, pronta para revisão, no formato de petição: endereçamento ao juízo/órgão, nome da peça, breve referência aos autos, DOS FATOS, DO DIREITO (com fundamentos), DOS PEDIDOS, e fecho com local, data e "Nestes termos, pede deferimento." seguido de "Advogado(a) — OAB". Comece direto pela peça, sem comentários fora dela.'
  content.push({ type: 'text', text: instr })

  let data
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 8000, messages: [{ role: 'user', content }] }),
    })
    data = await r.json()
    if (!r.ok) return Response.json({ erro: 'IA: ' + ((data && data.error && data.error.message) || r.status) }, { status: 502 })
  } catch (e) { return Response.json({ erro: 'IA indisponível: ' + (e.message || e) }, { status: 502 }) }

  let texto = ''
  try { texto = (data.content || []).map(c => c.text || '').join('\n').trim() } catch (e) {}
  if (!texto) return Response.json({ erro: 'a IA não retornou a minuta' }, { status: 502 })

  const hoje = new Date().toISOString().slice(0, 10)
  const slug = ('minuta_' + instrucao).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 48)
  const fileName = (slug || 'minuta') + '_' + hoje + '.doc'

  // 1) lançamento no histórico (na data do pedido)
  const corpo = '[MINUTA] ' + instrucao + ' (rascunho Claude para revisão, ' + hoje.split('-').reverse().join('/') + ')'
  const { data: a } = await sb.from('andamentos').insert({ processo_id: proc.id, data: hoje, texto: corpo, fonte: 'minuta' }).select('id').single()
  const andId = a && a.id

  // 2) Word (.doc) anexado ao histórico (bucket 'capturas' + anexos)
  const buf = Buffer.from(minutaDoc(proc, texto), 'utf8')
  const pathCap = ESCRITORIO_CMP + '/' + dig + '/' + crypto.randomUUID() + '_' + fileName
  let anexoId = null
  try {
    const up = await sb.storage.from('capturas').upload(pathCap, buf, { contentType: 'application/msword', upsert: false })
    if (!up.error) {
      const ia = await sb.from('anexos').insert({ escritorio_id: ESCRITORIO_CMP, processo_numero: proc.numero, andamento_id: andId, origem: 'minuta', nome: fileName, tipo: 'application/msword', tamanho: buf.length, path: pathCap, criado_por: String(user.email || 'user') }).select('id').single()
      anexoId = ia.data && ia.data.id
    }
  } catch (e) {}

  // 3) tarefa D+1: protocolar/corrigir a minuta (se não protocolar hoje, alerta amanhã)
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  try {
    await sb.from('kanban_tarefas').insert({
      escritorio_id: ESCRITORIO_CMP, titulo: 'Protocolar/corrigir minuta: ' + instrucao.slice(0, 90),
      cliente: proc.cliente_nome || '—', numero: proc.numero, coluna: 'distribuir',
      data: amanha, prazo: amanha, tipo: 'prazo', origem: 'minuta',
    })
  } catch (e) {}

  return Response.json({ ok: true, andamento_id: andId, anexo_id: anexoId, arquivo: fileName, docs_usados: nomesUsados, tarefa_para: amanha, preview: texto.slice(0, 500) })
}
