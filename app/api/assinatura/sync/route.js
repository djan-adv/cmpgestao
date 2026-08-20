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
import { gerarMinuta, prazoUteis } from '../../peticao/core.js'

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

/* ===== Procuração re-diagramada em A4 (pedido do dono, 20/08/2026) =====
   O PDF salvo pelo celular do cliente saía como foto em coluna estreita. Para a
   pasta do processo vai SEMPRE esta versão de leitura, gerada no servidor a
   partir dos dados do banco — o original do assinador permanece arquivado. */
const OUTORGADO_TXT = [
  ['Djan Henrique Mendonça do Nascimento', true],
  [', brasileiro, casado, advogado, inscrito na OAB/PB n. 5.219-A, e os integrantes da sociedade ', false],
  ['CRISPIM, MENDONÇA E PINHEIRO ADVOGADOS', true],
  [', registrada na Ordem dos Advogados do Brasil, seccional da Paraíba sob o número OAB/PB 2200042, e no CNPJ 45.487.942/0001-84, com sede na Rua Abelardo da Silva Guimarães Barreto, 51, sala 604-C edf. Alliance Plaza Business, CEP 58046-110, Altiplano Cabo Branco, João Pessoa/PB, e-mail: djan.adv@gmail.com.', false],
]
const MODELOS_CLAUSULAS = { trabalhista: { e: 30, g: true }, previdenciario: { e: 30, g: true }, civel20: { e: 20, g: false }, civel20g: { e: 20, g: true }, civel30: { e: 30, g: false }, civel30g: { e: 30, g: true }, defesa: { e: null, g: false }, defesag: { e: null, g: true }, defesa10: { e: 10, g: false }, defesa10g: { e: 10, g: true } }
const PCT_EXT = { 10: 'dez por cento', 20: 'vinte por cento', 25: 'vinte e cinco por cento', 30: 'trinta por cento' }
const MESES_BR = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
// pdf-lib usa WinAnsi na Helvetica: troca o que não codifica para não explodir
function winAnsi(s) { return String(s || '').replace(/[""]/g, '"').replace(/['']/g, "'").replace(/[–—]/g, '-').replace(/[^\x09\x0A\x20-\x7E -ÿ]/g, ' ') }

async function pdfProcuracaoA4({ d, s0, evtAssinado, selfieBuf }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold)
  const obl = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const AZUL = rgb(0.059, 0.165, 0.29), TINTA = rgb(0.11, 0.15, 0.2), CINZA = rgb(0.36, 0.4, 0.45)
  const W = 595.28, H = 841.89, M = 62, UTIL = W - M * 2, TAM = 10.5, ALT = 15.5

  let logo = null
  try { logo = await pdf.embedPng(fs.readFileSync(path.join(process.cwd(), 'public', 'logo_cmp_full.png'))) } catch (e) {}

  const dd = (s0.dados && typeof s0.dados === 'object') ? s0.dados : {}
  const fem = /a$/i.test(String(dd.nacionalidade || ''))
  const oa = fem ? 'a' : 'o(a)'
  const qualif = [dd.nacionalidade || 'brasileiro(a)', dd.estadocivil, dd.profissao].filter(Boolean).join(', ')
  const cfg = MODELOS_CLAUSULAS[d.modelo] || { e: null, g: false }
  const ehDefesa = d.modelo === 'defesa' || d.modelo === 'defesag'
  const quandoBR = s0.assinado_em ? new Date(new Date(s0.assinado_em).getTime() - 3 * 3600000) : new Date(Date.now() - 3 * 3600000)
  const dataExt = quandoBR.getUTCDate() + ' de ' + MESES_BR[quandoBR.getUTCMonth()] + ' de ' + quandoBR.getUTCFullYear()
  const horaExt = String(quandoBR.getUTCHours()).padStart(2, '0') + ':' + String(quandoBR.getUTCMinutes()).padStart(2, '0')

  const pars = []
  pars.push([['Outorgante: ' + (s0.nome || ''), true], [', ' + qualif + ', inscrit' + oa + ' no CPF de nº ', false], [s0.cpf || '—', true],
    [(dd.rg ? ' e RG ' + dd.rg : '') + (dd.endereco ? ', residente e domiciliad' + oa + ' na ' + dd.endereco : '') + (s0.email ? ', com e-mail: ' + s0.email : '') + (s0.telefone ? ' e contato: ' + s0.telefone : '') + '.', false]])
  pars.push([['Outorgado: ', true]].concat(OUTORGADO_TXT))
  pars.push([['Poderes: ', true], ['o(a) outorgante nomeia e constitui seu bastante procurador o(a) outorgado(a), conferindo-lhe a cláusula ', false], ['ad judicia et extra', true],
    [', para o foro em geral, ' + (d.finalidade ? 'em especial para ' : ''), false]].concat(d.finalidade ? [[String(d.finalidade), true], [', ', false]] : [])
    .concat([['podendo propor, acompanhar e contestar ações em qualquer juízo, instância ou tribunal, bem como representá-lo(a) perante repartições públicas e privadas, com poderes especiais para ', false], ['transigir, negociar', true],
      [', firmar acordos, desistir, renunciar, substabelecer com ou sem reserva', false]])
    .concat(ehDefesa ? [['.', false]] : [[', receber e dar quitação, ', false], ['levantar e receber alvarás judiciais', true], [', e ', false], ['requerer ao juízo o pagamento direto ao(à) outorgado(a), mediante destaque ou retenção sobre os valores devidos ao(à) outorgante, dos honorários advocatícios que lhe forem devidos', true], ['.', false]]))
  if (cfg.e !== null) pars.push([['Cláusula Contratual', true], [' - pelos serviços prestados o outorgado receberá a título de honorários o percentual de ', false], [cfg.e + '% (' + (PCT_EXT[cfg.e] || '') + ')', true], [' do valor obtido com a ação, podendo requerer ao juízo da causa que lhe pague diretamente os valores destacados do montante principal.', false]])
  if (cfg.g) pars.push([['Da Gratuidade da Justiça', true], [' - o(a) outorgante declara não dispor de condições de arcar com custas e despesas processuais sem prejuízo do próprio sustento, requerendo os benefícios da gratuidade da justiça, na forma do art. 98 do CPC.', false]])
  pars.push([['Outorgada de forma livre e consciente, por assinatura eletrônica, nos termos da Lei nº 14.063/2020 e da MP nº 2.200-2/2001.', false]])

  const pg = pdf.addPage([W, H])
  let y = H - 46
  if (logo) { const lw = 132, lh = lw * (logo.height / logo.width); pg.drawImage(logo, { x: (W - lw) / 2, y: y - lh, width: lw, height: lh }); y -= lh + 22 } else y -= 16
  const tit = 'PROCURAÇÃO'
  pg.drawText(winAnsi(tit), { x: (W - neg.widthOfTextAtSize(tit, 14)) / 2, y, size: 14, font: neg, color: AZUL })
  y -= 26

  // parágrafo justificado com trechos em negrito: quebra por palavras medindo cada fonte
  for (const par of pars) {
    const words = []
    for (const [t, b] of par) for (const w of winAnsi(t).split(/\s+/)) if (w) words.push({ w, b })
    let linha = [], larg = 0
    const flush = (ultima) => {
      if (!linha.length) return
      const esp = reg.widthOfTextAtSize(' ', TAM)
      let x = M
      const sobra = UTIL - larg, gaps = linha.length - 1
      const extra = (!ultima && gaps > 0 && sobra > 0 && sobra < UTIL * 0.35) ? sobra / gaps : 0
      for (const it of linha) {
        const f = it.b ? neg : reg
        pg.drawText(it.w, { x, y, size: TAM, font: f, color: it.b ? AZUL : TINTA })
        x += f.widthOfTextAtSize(it.w, TAM) + esp + extra
      }
      y -= ALT
    }
    for (const it of words) {
      const f = it.b ? neg : reg
      const lw = f.widthOfTextAtSize(it.w, TAM)
      const esp = reg.widthOfTextAtSize(' ', TAM)
      if (larg + (linha.length ? esp : 0) + lw > UTIL) { flush(false); linha = []; larg = 0 }
      larg += (linha.length ? esp : 0) + lw
      linha.push(it)
    }
    flush(true)
    y -= 6
  }

  y -= 4
  const dataLinha = 'João Pessoa/PB, ' + dataExt + '.'
  pg.drawText(winAnsi(dataLinha), { x: (W - reg.widthOfTextAtSize(winAnsi(dataLinha), TAM)) / 2, y, size: TAM, font: reg, color: TINTA })
  y -= 52

  // bloco de assinatura
  const nomeA = winAnsi(s0.nome || '')
  pg.drawText(nomeA, { x: (W - obl.widthOfTextAtSize(nomeA, 24)) / 2, y, size: 24, font: obl, color: TINTA })
  y -= 12
  pg.drawLine({ start: { x: W / 2 - 130, y }, end: { x: W / 2 + 130, y }, thickness: 1, color: TINTA })
  y -= 15
  pg.drawText(nomeA, { x: (W - neg.widthOfTextAtSize(nomeA, TAM)) / 2, y, size: TAM, font: neg, color: AZUL })
  y -= 14
  const cpfL = 'CPF ' + (s0.cpf || '—')
  pg.drawText(winAnsi(cpfL), { x: (W - reg.widthOfTextAtSize(winAnsi(cpfL), 9.5)) / 2, y, size: 9.5, font: reg, color: TINTA })
  y -= 13
  const metaL = winAnsi('Assinado eletronicamente em ' + quandoBR.getUTCDate() + '/' + String(quandoBR.getUTCMonth() + 1).padStart(2, '0') + '/' + quandoBR.getUTCFullYear() + ', ' + horaExt + ' (Brasília)' + (s0.ip ? ' · IP ' + s0.ip : ''))
  pg.drawText(metaL, { x: (W - reg.widthOfTextAtSize(metaL, 8)) / 2, y, size: 8, font: reg, color: CINZA })
  const rod = winAnsi('Crispim, Mendonça e Pinheiro Advogados · 0800 591 7259 · contato@cmpadvogados.com.br')
  pg.drawText(rod, { x: (W - reg.widthOfTextAtSize(rod, 7.5)) / 2, y: 34, size: 7.5, font: reg, color: CINZA })

  // página 2 — trilha de auditoria
  const p2 = pdf.addPage([W, H])
  let y2 = H - 46
  if (logo) { const lw = 110, lh = lw * (logo.height / logo.width); p2.drawImage(logo, { x: (W - lw) / 2, y: y2 - lh, width: lw, height: lh }); y2 -= lh + 24 }
  const t2 = 'TRILHA DE AUDITORIA'
  p2.drawText(t2, { x: (W - neg.widthOfTextAtSize(t2, 12.5)) / 2, y: y2, size: 12.5, font: neg, color: AZUL })
  y2 -= 30
  const linhas2 = [
    ['Signatário(a)', (s0.nome || '') + ' - CPF ' + (s0.cpf || '—')],
    ['Documento', (d.titulo || 'Procuração') + (d.processo ? ' · caso/processo ' + d.processo : '') + ' · id ' + d.id],
    ['Método', 'Assinatura eletrônica' + (evtAssinado && /\(([^)]+)\)/.test(evtAssinado.detalhe || '') ? ' - ' + (evtAssinado.detalhe.match(/\(([^)]+)\)/) || [])[1] : '')],
    ['Fatores', 'E-mail informado (' + (s0.email || '—') + ')' + (s0.ip ? ' · IP ' + s0.ip : '') + (s0.telefone ? ' · contato terminado em ••••' + String(s0.telefone).replace(/\D/g, '').slice(-4) : '')],
    ['Data e hora', quandoBR.getUTCDate() + '/' + String(quandoBR.getUTCMonth() + 1).padStart(2, '0') + '/' + quandoBR.getUTCFullYear() + ', ' + horaExt + ' (horário de Brasília)'],
    ['Identificador', (evtAssinado && evtAssinado.id) ? evtAssinado.id + ' (evento de assinatura)' : d.id],
    ['Fundamento', 'Lei nº 14.063/2020 e MP nº 2.200-2/2001'],
  ]
  if (s0.selfie_em) {
    const se = new Date(new Date(s0.selfie_em).getTime() - 3 * 3600000)
    linhas2.push(['Selfie', 'recebida em ' + se.getUTCDate() + '/' + String(se.getUTCMonth() + 1).padStart(2, '0') + '/' + se.getUTCFullYear() + ' às ' + String(se.getUTCHours()).padStart(2, '0') + ':' + String(se.getUTCMinutes()).padStart(2, '0') + ' (abaixo — uso interno do escritório)'])
  }
  for (const [k, v] of linhas2) {
    p2.drawText(winAnsi(k), { x: M, y: y2, size: 9.5, font: neg, color: CINZA })
    // valor com quebra simples
    let resto = winAnsi(v)
    while (resto.length) {
      let corte = resto
      while (reg.widthOfTextAtSize(corte, 10) > UTIL - 130 && corte.includes(' ')) corte = corte.slice(0, corte.lastIndexOf(' '))
      if (reg.widthOfTextAtSize(corte, 10) > UTIL - 130) corte = corte.slice(0, 60)
      p2.drawText(corte, { x: M + 130, y: y2, size: 10, font: reg, color: TINTA })
      resto = resto.slice(corte.length).trim()
      y2 -= 16
    }
    y2 -= 6
  }
  y2 -= 8
  // selfie de confirmação — imagem só nesta via interna
  if (selfieBuf && selfieBuf.length) {
    try {
      let img = null
      try { img = await pdf.embedJpg(selfieBuf) } catch (e1) { img = await pdf.embedPng(selfieBuf) }
      const iw = 120, ih = iw * (img.height / img.width)
      y2 -= 6
      p2.drawText('Selfie de confirmação (uso interno do escritório):', { x: M, y: y2, size: 9.5, font: neg, color: CINZA })
      y2 -= ih + 8
      p2.drawImage(img, { x: M, y: y2, width: iw, height: ih })
      y2 -= 14
    } catch (e) { /* selfie ilegível não derruba a via */ }
  }
  const selo = winAnsi('Via de leitura re-diagramada pelo sistema. O registro original da assinatura — com evento, IP, agente de navegação e demais metadados — permanece guardado na plataforma de assinaturas do CMP Advogados e prevalece para conferência.')
  let restoS = selo
  while (restoS.length) {
    let corte = restoS
    while (reg.widthOfTextAtSize(corte, 9) > UTIL && corte.includes(' ')) corte = corte.slice(0, corte.lastIndexOf(' '))
    p2.drawText(corte, { x: M, y: y2, size: 9, font: reg, color: CINZA })
    restoS = restoS.slice(corte.length).trim()
    y2 -= 13
  }
  return Buffer.from(await pdf.save())
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('rodar') === null) return Response.json({ info: 'Sync assinador → fichas. Use ?rodar=1 (cron).' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ ok: false, erro: 'falta service key' }, { status: 500 })

  const cmp = cmpAdmin()
  let sign
  try { sign = await signAdmin(cmp) } catch (e) { return Response.json({ ok: false, erro: String((e && e.message) || e) }, { status: 502 }) }

  const SEL_DOC = 'id, titulo, tipo, modelo, finalidade, processo, status, sync_cmp_em, signatarios(nome, cpf, email, telefone, ip, dados, status, assinado_em, selfie_path, selfie_em)'
  const { data: docs, error } = await sign.from('documentos')
    .select(SEL_DOC)
    .is('sync_cmp_em', null).eq('status', 'assinado').limit(10)
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })
  // selfie que chegou DEPOIS do sync: re-gera a via A4 na pasta (com a selfie)
  try {
    const { data: reproc } = await sign.from('documentos').select(SEL_DOC)
      .not('sync_cmp_em', 'is', null).eq('status', 'assinado').eq('tipo', 'procuracao')
      .order('sync_cmp_em', { ascending: false }).limit(30)
    for (const d2 of (reproc || [])) {
      const s2 = (d2.signatarios || [])[0]
      if (s2 && s2.selfie_em && new Date(s2.selfie_em) > new Date(d2.sync_cmp_em)) docs.push(d2)
    }
  } catch (e) { /* re-processo é extra; nunca trava o sync normal */ }

  const resultados = []
  for (const d of (docs || [])) {
    try {
      const dig = String(d.processo || '').replace(/\D/g, '')
      // acha o processo no CMP (quando há vínculo): número exato ou por dígitos
      let row = null
      const SEL = 'id, numero, cliente_nome, oponente, observacoes, contatos_livres, contatos_partes, escritorio_id, peca_pendente, rascunho_gerado_em'
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
      // procuração de modelo: a pasta recebe a VERSÃO A4 re-diagramada (o PDF do
      // celular saía como foto estreita); se a geração falhar, vai o original
      if (d.tipo === 'procuracao' && sigs.length) {
        try {
          const { data: evt } = await sign.from('eventos_auditoria').select('id,detalhe')
            .eq('documento_id', d.id).eq('tipo', 'assinado').order('criado_em', { ascending: false }).limit(1)
          // selfie de confirmação (quando o cliente enviou): entra SÓ nesta via
          // interna do escritório — a cópia do cliente nunca a carrega
          let selfieBuf = null
          if (sigs[0].selfie_path) {
            const ds = await sign.storage.from('assinaturas').download(sigs[0].selfie_path)
            if (!ds.error && ds.data) selfieBuf = Buffer.from(await ds.data.arrayBuffer())
          }
          const bonito = await pdfProcuracaoA4({ d, s0: sigs[0], evtAssinado: (evt && evt[0]) || null, selfieBuf })
          if (bonito && bonito.length > 2000) pdfBuf = bonito
        } catch (e) { console.warn('pdf A4 da procuração:', (e && e.message) || e) }
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
        // re-processo (selfie que chegou depois) SOBRESCREVE a via; só o 1º sync
        // desvia o nome quando já existe arquivo homônimo de OUTRO documento
        if (!d.sync_cmp_em && fs.existsSync(path.join(dir, pdfNome))) pdfNome = base + ' - ' + d.id.slice(0, 8) + '.pdf'
        fs.writeFileSync(path.join(dir, pdfNome), pdfBuf)
        salvoEm = 'Documentos do processo' + (dest.dir ? ' > ' + dest.dir : '') + ' ("' + pdfNome + '")'
      }
      const reprocesso = !!d.sync_cmp_em   // só re-gerando a via (selfie chegou depois)
      if (row) {
        const texto = reprocesso
          ? '[Assinatura] Selfie de confirmação recebida de ' + (quem || 'signatário') + ' — via da procuração atualizada na pasta.'
          : '[Assinatura] ' + (d.titulo || 'Documento') + ' ASSINADO' + (quem ? ' por ' + quem : '') +
            (salvoEm ? ' — cópia salva em ' + salvoEm + '.' : ' — cópia disponível no painel de Assinaturas.')
        await cmp.from('andamentos').insert({ processo_id: row.id, data: new Date().toISOString().slice(0, 10), texto, fonte: 'manual' })
      }

      // ===== caso novo, procuração assinada -> já lança pro Estagiário Virtual
      // redigir o rascunho e cria a tarefa de revisão (pedido do dono, 20/08/2026).
      // Só na primeira sincronização (nunca na re-sincronização de selfie), só se
      // o caso pediu uma peça ao ser criado, e só uma vez por caso (idempotente
      // por rascunho_gerado_em). Nunca protocola nada — é sempre rascunho pra
      // revisão de Rita/Djan, com alerta se não for revisado em 2 dias úteis
      // (ver /api/cron/minutas-atrasadas). =====
      if (row && d.tipo === 'procuracao' && !reprocesso && row.peca_pendente && !row.rascunho_gerado_em) {
        try {
          const prazo = prazoUteis(2)
          const instrucao = 'Elaborar ' + row.peca_pendente + ' para ' + (row.cliente_nome || 'o(a) cliente') +
            (row.oponente ? (' em face de ' + row.oponente) : '') +
            (row.observacoes ? ('.\n\nContexto do atendimento (anotado no Comercial): ' + row.observacoes) : '') +
            '.\n\nA procuração já foi assinada eletronicamente e está na pasta do caso — os demais documentos anexados também estão na pasta.'
          const rm = await gerarMinuta(cmp, {
            numero: row.numero, instrucao, autor: 'robo', rotina: 'minuta_caso_novo', maxFiles: 6,
            tarefaTitulo: 'Revisar rascunho: ' + row.peca_pendente + ' — ' + (row.cliente_nome || ''),
            prazoEm: prazo, resp: 'Maria Rita', origemTarefa: 'minuta_caso_novo',
          })
          if (!rm.erro) {
            await cmp.from('processos').update({ rascunho_gerado_em: new Date().toISOString() }).eq('id', row.id)
            try {
              await enviarEmailCore({
                para: 'mariaritahenriq@gmail.com', cc: 'djan.adv@gmail.com',
                assunto: '📝 Rascunho pronto para revisão — ' + row.peca_pendente + ' — ' + (row.cliente_nome || ''),
                corpo: 'O cliente assinou a procuração e o Estagiário Virtual já redigiu o rascunho de ' + row.peca_pendente + ' para ' + (row.cliente_nome || '') + '.\n\n' +
                  'Está salvo em Word na pasta do caso (' + row.numero + '), com o Relatório de Teses no histórico.\n\n' +
                  'Prazo para revisar: ' + prazo.split('-').reverse().join('/') + ' — se não for revisado até lá, o Jader também é avisado.\n\n' +
                  'Painel: https://gestao.cmpadvogados.com.br/sistema.html',
                numero: dig || '', dedup: true,
              })
            } catch (eEm) {}
          } else {
            console.warn('rascunho automático (caso novo) falhou:', rm.erro)
          }
        } catch (eM) { console.warn('rascunho automático (caso novo):', (eM && eM.message) || eM) }
      }

      // e-mail de confirmação ao escritório (sempre que algo é assinado)
      let emailOk = false
      try {
        const quando = (sigs[0] && sigs[0].assinado_em) ? new Date(sigs[0].assinado_em).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : ''
        const corpo = (reprocesso ? 'Selfie de confirmação recebida — a via da procuração na pasta foi atualizada com ela.\n\n' : 'Documento assinado no assinador do CMPGestão.\n\n') +
          'Documento: ' + (d.titulo || '(sem título)') + '\n' +
          (quem ? ('Assinado por: ' + quem + '\n') : '') +
          (quando ? ('Quando: ' + quando + '\n') : '') +
          (d.processo ? ('Processo/caso: ' + d.processo + '\n') : 'Sem processo vinculado.\n') +
          (salvoEm ? ('Cópia salva na ficha do processo, em ' + salvoEm + '.\n') : 'Cópia disponível no painel de Assinaturas.\n') +
          '\nPainel: https://gestao.cmpadvogados.com.br/assinatura/painel'
        const env = await enviarEmailCore({
          para: EMAIL_ESCRITORIO,
          cc: 'djan.adv@gmail.com',   // confirmação também direto pro Djan (pedido 20/08/2026)
          assunto: (reprocesso ? '📸 Selfie recebida: ' : '✍ Assinado: ') + (d.titulo || 'documento') + (quem ? ' — ' + quem.split(';')[0] : ''),
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
