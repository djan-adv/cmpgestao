// Robô: procuração/contrato ASSINADO no assinador → volta sozinho para a ficha
// do processo no CMPGestão (andamento no histórico + PDF na pasta de Documentos).
//
//   GET /api/assinatura/sync?rodar=1   (chamado pelo /api/cron/tick)
//
// Só sincroniza documentos com `processo` preenchido (vínculo criado pela ficha)
// e status 'assinado' ainda sem sync_cmp_em. Roda no próprio VPS: grava o PDF
// direto em /opt/cmpdocs/<chave>/Procurações e assinaturas/.

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore } from '../../enviar-email/enviar.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ROOT = '/opt/cmpdocs'
const EMAIL_ESCRITORIO = process.env.EMAIL_CONFIRMACAO_ASSINATURA || 'contato@cmpadvogados.com.br'
// destino nos Documentos do processo:
//  - procuração: ARQUIVO na raiz, numerado "2 Procuração - ..." (sem subpasta)
//  - contrato: dentro da pasta "Contrato de honorários"
//  - demais: arquivo na raiz com o próprio título
// o "✓" no nome do arquivo indica que o documento está ASSINADO
function destinoDoc(d) {
  const t = String((d && d.titulo) || '')
  // pedido do dono (20/08/2026): "Procuração assinada - <nome do cliente>.pdf"
  if (d.tipo === 'procuracao' || /procura/i.test(t)) return { dir: '', nomeFixo: 'Procuração assinada ✓' }
  if (/contrat/i.test(t)) return { dir: 'Contrato de honorários', nomeFixo: '' }
  return { dir: '', nomeFixo: '' }
}
function nomeArq(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) }
const SIGN_URL = process.env.NEXT_PUBLIC_SIGN_SUPABASE_URL || 'https://fjboytucivmdykkfpdhs.supabase.co'
const SIGN_KEY = process.env.NEXT_PUBLIC_SIGN_SUPABASE_ANON_KEY || 'sb_publishable_9K2-GBTRb7ZYd5dkjPoeZA_kPPNElex'

function cmpAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// admin do assinador: chave secreta OU conta de serviço (credencial no app_secrets do CMP).
// A chave secreta é TESTADA antes de valer: em 20/08/2026 ela estava expirada no
// servidor ("JWT expired") e o sync inteiro parava — agora cai pra conta de serviço.
async function signAdmin(cmp) {
  if (process.env.SIGN_SUPABASE_SERVICE_ROLE_KEY) {
    const c = createClient(SIGN_URL, process.env.SIGN_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const teste = await c.from('documentos').select('id', { head: true, count: 'exact' }).limit(1)
    if (!teste.error) return c
    console.warn('assinatura/sync: chave secreta inválida (' + teste.error.message + ') — usando a conta de serviço')
  }
  const { data } = await cmp.from('app_secrets').select('valor').eq('chave', 'sign_service_account').maybeSingle()
  const cred = data && data.valor
  if (!cred || !cred.email || !cred.senha) throw new Error('sem credencial do assinador (app_secrets)')
  const c = createClient(SIGN_URL, SIGN_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const r = await c.auth.signInWithPassword({ email: cred.email, password: cred.senha })
  if (r.error) throw new Error('login conta de serviço: ' + r.error.message)
  return c
}
/* ===== Ficha se corrige sozinha com o que o cliente preencheu ao assinar =====
   (pedido do dono, 20/08/2026): nome completo, CPF, e-mail e telefone entram na
   ficha e no cadastro de Contatos — que é de onde o boleto puxa os dados.
   NADA é apagado: e-mail/telefone novos se SOMAM aos já cadastrados. */
function _mesclaContatos(atual, novos) {
  const parts = String(atual || '').split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean)
  const chaves = new Set(parts.map(p => /@/.test(p) ? p.toLowerCase() : p.replace(/\D/g, '')))
  for (const n of (novos || [])) {
    if (!n) continue
    const k = /@/.test(n) ? String(n).toLowerCase() : String(n).replace(/\D/g, '')
    if (!k || chaves.has(k)) continue
    chaves.add(k); parts.push(String(n).trim())
  }
  return parts.join(', ')
}
async function atualizarFichaAssinada(cmp, row, sigs) {
  try {
    const s0 = sigs[0] || {}
    const upd = {}
    const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const nomeSig = String(s0.nome || '').replace(/\s+/g, ' ').trim()
    const nomeAtu = String(row.cliente_nome || '').trim()
    // nome: completa "Bruno" → "Bruno Alencar Silva Lima" (mesmo primeiro nome);
    // nunca troca por um nome que não casa com o que está na ficha
    if (nomeSig && (!nomeAtu || (nomeSig.length > nomeAtu.length && norm(nomeSig).indexOf(norm(nomeAtu.split(/\s+/)[0])) === 0))) upd.cliente_nome = nomeSig
    const novos = sigs.flatMap(s => [s.email, s.telefone]).filter(Boolean)
    const mescla = _mesclaContatos(row.contatos_livres, novos)
    if (mescla && mescla !== String(row.contatos_livres || '').trim()) upd.contatos_livres = mescla
    const cpfDig = String(s0.cpf || '').replace(/\D/g, '')
    if (cpfDig.length === 11 || cpfDig.length === 14) {
      const cp = (row.contatos_partes && typeof row.contatos_partes === 'object') ? { ...row.contatos_partes } : {}
      const chaveNome = upd.cliente_nome || nomeAtu || nomeSig
      if (chaveNome && !cp[chaveNome]) { cp[chaveNome] = cpfDig; upd.contatos_partes = cp }
    }
    if (Object.keys(upd).length) await cmp.from('processos').update(upd).eq('id', row.id)
    // cadastro de Contatos (fonte do boleto: nome, CPF, e-mail)
    for (const s of sigs) {
      const nome = String(s.nome || '').replace(/\s+/g, ' ').trim()
      if (!nome) continue
      const cpfS = String(s.cpf || '').replace(/\D/g, '') || null
      const { data: ja } = await cmp.from('contatos').select('id,cpf_cnpj,email,telefone').eq('escritorio_id', row.escritorio_id).ilike('nome', nome).limit(1)
      if (ja && ja.length) {
        const c = ja[0], u2 = {}
        if (cpfS && !c.cpf_cnpj) u2.cpf_cnpj = cpfS
        if (s.email && !c.email) u2.email = s.email
        if (s.telefone && !c.telefone) u2.telefone = s.telefone
        if (Object.keys(u2).length) await cmp.from('contatos').update(u2).eq('id', c.id)
      } else {
        await cmp.from('contatos').insert({ escritorio_id: row.escritorio_id, nome, tipo: 'cliente', cpf_cnpj: cpfS, email: s.email || null, telefone: s.telefone || null })
      }
    }
  } catch (e) { console.warn('ficha pós-assinatura:', (e && e.message) || e) /* enriquecer nunca derruba o sync */ }
}

function slug(s) { return String(s || 'documento').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 80) }

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('rodar') === null) return Response.json({ info: 'Sync assinador → fichas. Use ?rodar=1 (cron).' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ ok: false, erro: 'falta service key' }, { status: 500 })

  const cmp = cmpAdmin()
  let sign
  try { sign = await signAdmin(cmp) } catch (e) { return Response.json({ ok: false, erro: String((e && e.message) || e) }, { status: 502 }) }

  const { data: docs, error } = await sign.from('documentos')
    .select('id, titulo, tipo, processo, status, sync_cmp_em, signatarios(nome, cpf, email, status, assinado_em)')
    .is('sync_cmp_em', null).eq('status', 'assinado').limit(10)
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })

  const resultados = []
  for (const d of (docs || [])) {
    try {
      const dig = String(d.processo || '').replace(/\D/g, '')
      // acha o processo no CMP (quando há vínculo): número exato ou por dígitos
      let row = null
      const SEL = 'id, numero, cliente_nome, contatos_livres, contatos_partes, escritorio_id'
      if (d.processo) {
        let q = await cmp.from('processos').select(SEL).eq('numero', d.processo).limit(1)
        row = q.data && q.data[0]
        if (!row && dig) { q = await cmp.from('processos').select(SEL).eq('numero_digitos', dig).limit(1); row = q.data && q.data[0] }
        if (!row && dig) { q = await cmp.from('processos').select(SEL).ilike('numero', '%' + d.processo + '%').limit(1); row = q.data && q.data[0] }
      }

      const sigs = (d.signatarios || []).filter(s => s.status === 'assinado')
      if (row && sigs.length) await atualizarFichaAssinada(cmp, row, sigs)
      const quem = sigs.map(s => (s.nome || s.email || '') + (s.cpf ? ' (CPF ' + s.cpf + ')' : '')).filter(Boolean).join('; ')
      const dest = destinoDoc(d)

      // baixa o PDF assinado (procuração: <id>.pdf · avulso: <id>/assinado.pdf)
      let pdfBuf = null, ehOriginal = false
      const tenta = d.tipo === 'upload' ? [d.id + '/assinado.pdf', d.id + '/original.pdf'] : [d.id + '.pdf']
      for (const pth of tenta) {
        const dl = await sign.storage.from('documentos').download(pth)
        if (!dl.error && dl.data) { pdfBuf = Buffer.from(await dl.data.arrayBuffer()); ehOriginal = pth.endsWith('original.pdf'); break }
      }

      let salvoEm = '', pdfNome = ''
      if (row && pdfBuf) {
        const chave = dig || ('caso-' + String(row.id).replace(/[^a-zA-Z0-9-]/g, ''))
        const dir = path.join(ROOT, chave, dest.dir)
        fs.mkdirSync(dir, { recursive: true })
        // "✓" no nome = assinado. Procuração sai "Procuração assinada ✓ - Nome do
        // Cliente.pdf" (pedido do dono); os demais mantêm o título + ✓.
        const quem1 = nomeArq((sigs[0] && (sigs[0].nome || sigs[0].email)) || '')
        const base = dest.nomeFixo ? (dest.nomeFixo + (quem1 ? (' - ' + quem1) : '')) : (slug(d.titulo) + ' ✓' + (ehOriginal ? ' (original)' : ''))
        pdfNome = base + '.pdf'
        if (fs.existsSync(path.join(dir, pdfNome))) pdfNome = base + ' - ' + d.id.slice(0, 8) + '.pdf'
        fs.writeFileSync(path.join(dir, pdfNome), pdfBuf)
        salvoEm = 'Documentos do processo' + (dest.dir ? ' > ' + dest.dir : '') + ' ("' + pdfNome + '")'
      }
      if (row) {
        const texto = '[Assinatura] ' + (d.titulo || 'Documento') + ' ASSINADO' + (quem ? ' por ' + quem : '') +
          (salvoEm ? ' — cópia salva em ' + salvoEm + '.' : ' — cópia disponível no painel de Assinaturas.')
        await cmp.from('andamentos').insert({ processo_id: row.id, data: new Date().toISOString().slice(0, 10), texto, fonte: 'manual' })
      }

      // e-mail de confirmação ao escritório (sempre que algo é assinado)
      let emailOk = false
      try {
        const quando = (sigs[0] && sigs[0].assinado_em) ? new Date(sigs[0].assinado_em).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : ''
        const corpo = 'Documento assinado no assinador do CMPGestão.\n\n' +
          'Documento: ' + (d.titulo || '(sem título)') + '\n' +
          (quem ? ('Assinado por: ' + quem + '\n') : '') +
          (quando ? ('Quando: ' + quando + '\n') : '') +
          (d.processo ? ('Processo/caso: ' + d.processo + '\n') : 'Sem processo vinculado.\n') +
          (salvoEm ? ('Cópia salva na ficha do processo, em ' + salvoEm + '.\n') : 'Cópia disponível no painel de Assinaturas.\n') +
          '\nPainel: https://gestao.cmpadvogados.com.br/assinatura/painel'
        const env = await enviarEmailCore({
          para: EMAIL_ESCRITORIO,
          assunto: '✍ Assinado: ' + (d.titulo || 'documento') + (quem ? ' — ' + quem.split(';')[0] : ''),
          corpo, numero: dig || '', dedup: true
        })
        emailOk = !!(env && env.ok)
      } catch (e) {}

      await sign.from('documentos').update({ sync_cmp_em: new Date().toISOString() }).eq('id', d.id)
      resultados.push({ id: d.id, processo: d.processo || null, ficha: !!row, pdf: !!pdfBuf, pasta: PASTA, email: emailOk })
    } catch (e) {
      resultados.push({ id: d.id, ok: false, erro: String((e && e.message) || e) })
    }
  }
  return Response.json({ ok: true, processados: resultados.length, resultados })
}
