// API do módulo de ASSINATURA de documentos (assinador — ex djan.app.br/link).
//
// O assinador vive num projeto Supabase SEPARADO do banco do CMPGestão. As RPCs
// de admin de lá (admin_listar_documentos etc.) só aceitam o login daquele projeto;
// para o time usar o painel com o MESMO login do CMPGestão, esta rota valida a
// sessão do CMP e opera o banco do assinador com a chave secreta, no servidor.
//
//   POST /api/assinatura   (header Authorization: Bearer <jwt do CMPGestão>)
//   body: { acao, ... }
//     acao = 'listar'  -> todos os documentos com signatários (painel)
//     acao = 'detalhe' -> { doc_id } documento + signatários + trilha de auditoria
//     acao = 'criar'   -> { titulo, tipo, modelo, arquivo_path, signatarios:[{nome,email}] }
//                         cria documento + signatários e devolve os tokens dos links
//     acao = 'email'   -> { sig_id, email } corrige o e-mail de um signatário pendente
//     acao = 'excluir' -> { doc_id } apaga documento, assinaturas e trilha (e arquivos)
//     acao = 'signed'  -> { bucket, path } URL temporária p/ baixar PDF/assinatura
//
// As TELAS PÚBLICAS de assinatura (/assinar, /assinar-doc) NÃO passam por aqui:
// falam direto com o banco do assinador por token, como no site antigo.
//
// Segurança:
//  - exige usuário autenticado no CMPGestão (qualquer conta do escritório);
//  - a chave secreta do assinador (SIGN_SUPABASE_SERVICE_ROLE_KEY) fica só no servidor.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CMP_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const CMP_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SIGN_URL = process.env.NEXT_PUBLIC_SIGN_SUPABASE_URL || 'https://fjboytucivmdykkfpdhs.supabase.co'
const SIGN_SERVICE = process.env.SIGN_SUPABASE_SERVICE_ROLE_KEY

const BUCKETS = ['documentos', 'assinaturas']

function admin() {
  return createClient(SIGN_URL, SIGN_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function usuarioCMP(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(CMP_URL, CMP_ANON)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch { return Response.json({ erro: 'corpo inválido' }, { status: 400 }) }

  const user = await usuarioCMP(request)
  if (!user) return Response.json({ erro: 'Faça login no CMPGestão para usar o módulo de assinaturas.' }, { status: 401 })
  if (!SIGN_SERVICE) {
    return Response.json({ erro: 'Falta configurar SIGN_SUPABASE_SERVICE_ROLE_KEY no servidor (chave secreta do projeto do assinador).' }, { status: 500 })
  }

  const sb = admin()
  const acao = body.acao

  try {
    if (acao === 'listar') {
      const { data, error } = await sb.from('documentos')
        .select('*, signatarios(*)')
        .order('criado_em', { ascending: false })
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, documentos: data || [] })
    }

    if (acao === 'detalhe') {
      if (!body.doc_id) return Response.json({ erro: 'doc_id obrigatório' }, { status: 400 })
      const d = await sb.from('documentos').select('*').eq('id', body.doc_id).single()
      if (d.error) throw new Error(d.error.message)
      const s = await sb.from('signatarios').select('*').eq('documento_id', body.doc_id).order('ordem', { ascending: true })
      const e = await sb.from('eventos_auditoria').select('*').eq('documento_id', body.doc_id).order('criado_em', { ascending: true })
      return Response.json({ ok: true, documento: d.data, signatarios: s.data || [], eventos: e.data || [] })
    }

    if (acao === 'criar') {
      const titulo = String(body.titulo || '').trim()
      const tipo = body.tipo === 'upload' ? 'upload' : 'procuracao'
      const signatarios = Array.isArray(body.signatarios) ? body.signatarios.filter(s => s && (s.email || s.nome)) : []
      if (!titulo) return Response.json({ erro: 'Informe o título.' }, { status: 400 })
      if (tipo === 'upload' && !body.arquivo_path) return Response.json({ erro: 'Documento avulso sem arquivo.' }, { status: 400 })
      if (!signatarios.length) signatarios.push({ nome: null, email: null })
      if (signatarios.length > 30) return Response.json({ erro: 'Máximo de 30 signatários.' }, { status: 400 })

      const docId = body.doc_id || randomUUID()
      const e1 = (await sb.from('documentos').insert({
        id: docId,
        titulo,
        tipo,
        modelo: body.modelo || null,
        arquivo_path: body.arquivo_path || null,
        status: 'enviado',
      })).error
      if (e1) throw new Error(e1.message)

      const rows = signatarios.map((s, idx) => ({
        documento_id: docId,
        nome: (s.nome || '').trim() || null,
        email: (s.email || '').trim() || '',
        ordem: idx + 1,
        token: randomUUID(),
        status: 'pendente',
      }))
      const ins = await sb.from('signatarios').insert(rows).select('id,nome,email,token,ordem')
      if (ins.error) { await sb.from('documentos').delete().eq('id', docId); throw new Error(ins.error.message) }

      await sb.from('eventos_auditoria').insert({
        documento_id: docId,
        tipo: 'criado',
        detalhe: (tipo === 'procuracao'
          ? 'Link de assinatura gerado para ' + (rows[0].email || rows[0].nome || 'cliente')
          : 'Documento avulso enviado (' + rows.length + ' signatário(s))') +
          ' — pelo CMPGestão (' + (user.email || 'usuário') + ')' +
          (body.processo ? ' · processo ' + String(body.processo).slice(0, 40) : ''),
      })
      return Response.json({ ok: true, doc_id: docId, signatarios: ins.data || [] })
    }

    if (acao === 'email') {
      if (!body.sig_id || !/.+@.+\..+/.test(String(body.email || ''))) return Response.json({ erro: 'Dados inválidos.' }, { status: 400 })
      const { error } = await sb.from('signatarios').update({ email: String(body.email).trim() }).eq('id', body.sig_id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    if (acao === 'excluir') {
      if (!body.doc_id) return Response.json({ erro: 'doc_id obrigatório' }, { status: 400 })
      // limpa os arquivos do storage (best-effort, como no painel antigo)
      try {
        const sigs = await sb.from('signatarios').select('assinatura_path').eq('documento_id', body.doc_id)
        const paths = (sigs.data || []).map(s => s.assinatura_path).filter(Boolean)
        if (paths.length) await sb.storage.from('assinaturas').remove(paths)
        await sb.storage.from('documentos').remove([body.doc_id + '.pdf', body.doc_id + '/original.pdf', body.doc_id + '/assinado.pdf'])
      } catch { /* segue mesmo se a limpeza falhar */ }
      const { error } = await sb.from('documentos').delete().eq('id', body.doc_id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    if (acao === 'signed') {
      if (!BUCKETS.includes(body.bucket) || !body.path) return Response.json({ erro: 'Pedido inválido.' }, { status: 400 })
      const { data, error } = await sb.storage.from(body.bucket).createSignedUrl(String(body.path), 600)
      if (error) return Response.json({ erro: error.message }, { status: 404 })
      return Response.json({ ok: true, url: data.signedUrl })
    }

    return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
  } catch (e) {
    return Response.json({ erro: String((e && e.message) || e) }, { status: 500 })
  }
}
