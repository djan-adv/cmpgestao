// Robô de MONITORAMENTO DE MARCAS no INPI (crontab). Fonte oficial e
// automatizável: a Revista da Propriedade Industrial (RPI) de Marcas, publicada
// semanalmente às terças em XML (zipado). O número do processo de marca tem 9
// dígitos e é o mesmo usado aqui.
//
//   GET /api/inpi/robo?tarefa=varrer            -> varre as RPIs novas, lança os
//        despachos novos no HISTÓRICO (andamentos) da pasta vinculada, avisa por
//        e-mail e SUSPENDE sozinho a marca quando cai despacho de encerramento.
//   GET /api/inpi/robo?tarefa=varrer&numero=NNN&debug=1  -> teste de uma marca só,
//        devolvendo o que foi extraído (sem gravar nada de novo se ?dry=1).
//
// Sem dependência nova: unzip próprio via zlib.inflateRawSync.

import zlib from 'zlib'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const RPI = 'https://revistas.inpi.gov.br'
const TIPO_MARCAS = 5
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const soDig = (s) => String(s || '').replace(/\D/g, '')
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
function escH(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function ddmmaaaa(d) { const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() }

function smtp() {
  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT || '465', 10), user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return { t: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), user }
}
async function enviar(to, assunto, html) {
  const s = smtp(); if (!s || !to) return false
  try { await s.t.sendMail({ from: '"Crispim, Mendonça e Pinheiro Advogados" <' + s.user + '>', to, subject: assunto, html }); return true } catch (e) { return false }
}

// ---- unzip mínimo: lê o diretório central do ZIP e devolve o 1º .xml inflado ----
function extrairXmlDoZip(buf) {
  // acha o End Of Central Directory (assinatura 0x06054b50), varrendo do fim
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP inválido (sem EOCD)')
  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const metodo = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commLen = buf.readUInt16LE(off + 32)
    const loOff = buf.readUInt32LE(off + 42)
    const nome = buf.toString('latin1', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + extraLen + commLen
    if (!/\.xml$/i.test(nome)) continue
    // cabeçalho local do arquivo
    if (buf.readUInt32LE(loOff) !== 0x04034b50) continue
    const lNameLen = buf.readUInt16LE(loOff + 26)
    const lExtraLen = buf.readUInt16LE(loOff + 28)
    const dataIni = loOff + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(dataIni, dataIni + compSize)
    return metodo === 0 ? comp : zlib.inflateRawSync(comp)
  }
  throw new Error('nenhum .xml no ZIP')
}

// ---- lista as RPIs de Marcas publicadas no período ----
async function listarRevistas(dias) {
  const ini = ddmmaaaa(new Date(Date.now() - dias * 86400000))
  const fim = ddmmaaaa(new Date(Date.now() + 2 * 86400000))
  const url = `${RPI}/rpi/busca/data?revista.dataInicial=${ini}&revista.dataFinal=${fim}&revista.tipoRevista.id=${TIPO_MARCAS}`
  let r
  try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) } catch (e) { return { erro: String((e && e.message) || e), itens: [] } }
  if (!r.ok) return { erro: 'HTTP ' + r.status, itens: [] }
  const j = await r.json().catch(() => null)
  const lista = Array.isArray(j) ? j : (j && (j.content || j.revistas || j.data || j.items)) || []
  const itens = lista.map((x) => ({
    edicao: parseInt(soDig(x.numero || x.numeroRevista || x.numero_revista || x.edicao || 0), 10) || 0,
    data: String(x.dataPublicacao || x.dataOficial || x.data || x.dataDisponibilizacao || '').slice(0, 10),
    arquivo: x.nomeArquivoEscritorio || x.nomeArquivo || x.nome_arquivo_escritorio || x.arquivo || null
  })).filter((x) => x.edicao && x.arquivo)
  itens.sort((a, b) => a.edicao - b.edicao)
  return { itens, url }
}

async function baixarXml(arquivo) {
  const url = `${RPI}/xml/${arquivo}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(50000) })
  if (!r.ok) throw new Error('download ' + r.status)
  const buf = Buffer.from(await r.arrayBuffer())
  return extrairXmlDoZip(buf)
}

// ---- extrai os despachos de UM número dentro do XML da RPI ----
function despachosDoProcesso(xmlBuf, numero) {
  const alvo = soDig(numero)
  const idx = xmlBuf.indexOf(alvo, 0, 'latin1')
  if (idx < 0) return null // processo não aparece nesta RPI
  // recorta o bloco <processo>…</processo> em volta do número (com folga)
  const janela = xmlBuf.toString('latin1', Math.max(0, idx - 40000), Math.min(xmlBuf.length, idx + 40000))
  const rel = janela.indexOf(alvo)
  let ini = janela.lastIndexOf('<processo', rel); if (ini < 0) ini = 0
  let fim = janela.indexOf('</processo>', rel); fim = fim < 0 ? janela.length : fim + 11
  const bloco = janela.slice(ini, fim)
  const titular = (bloco.match(/nome-razao-social="([^"]+)"/i) || bloco.match(/<titular[^>]*>([^<]+)/i) || [])[1] || null
  const desp = []
  const re = /<despacho\b([^>]*?)(?:\/>|>([\s\S]*?)<\/despacho>)/gi
  let m
  while ((m = re.exec(bloco))) {
    const attrs = m[1] || '', inner = m[2] || ''
    const codigo = (attrs.match(/codigo="([^"]*)"/i) || [])[1] || ''
    const nome = (attrs.match(/nome="([^"]*)"/i) || [])[1] || ''
    const complemento = inner.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (!codigo && !nome && !complemento) continue
    desp.push({ codigo, nome, complemento })
  }
  return { titular, despachos: desp }
}

// encerramento -> auto-suspende
function motivoEncerramento(d) {
  const s = semAcento((d.nome || '') + ' ' + (d.complemento || ''))
  if (/arquiv\w* definitiv/.test(s)) return 'arquivamento definitivo'
  if (/concess\w* de registro|registro concedido|expedi\w* do certificado de registro/.test(s)) return 'registro concedido'
  if (/\bextin\w+/.test(s)) return 'extinção'
  return null
}

function emailDespachos(marca, edicao, dataRpi, novos, suspensoMotivo) {
  const linhas = novos.map((d) => '<div style="padding:7px 0;border-top:1px dashed #e4e8ef"><b>' + escH(d.codigo || '—') + '</b> ' + escH(d.nome || '') + (d.complemento ? '<div style="font-size:12.5px;color:#445;margin-top:2px">' + escH(d.complemento.slice(0, 400)) + '</div>' : '') + '</div>').join('')
  const aviso = suspensoMotivo ? '<div style="background:#fff4e5;border:1px solid #ffd9a8;border-radius:10px;padding:11px 13px;font-size:12.5px;color:#7a4b00;margin-top:10px">⏸ Monitoramento <b>suspenso automaticamente</b> — despacho de encerramento (' + escH(suspensoMotivo) + '). Reative pelo painel se ainda quiser acompanhar.</div>' : ''
  return '<div style="font-family:Arial;font-size:14px;color:#1e2733;max-width:640px;margin:0 auto;padding:8px"><div style="border-top:3px solid #b8912e;padding:14px 6px"><h2 style="color:#2E3A4B;font-size:17px;margin:0 0 4px">INPI — marca ' + escH(marca.numero) + '</h2><p style="font-size:13px;color:#697180;margin:0 0 10px">' + escH(marca.descricao || marca.titular || '') + ' · RPI ' + escH(String(edicao)) + (dataRpi ? ' (' + dataRpi.split('-').reverse().join('/') + ')' : '') + ' · ' + novos.length + ' despacho(s) novo(s)</p>' + linhas + aviso + '<p style="font-size:12px;color:#8a8f98;text-align:center;margin-top:12px">Lançado no histórico da pasta. Crispim, Mendonça e Pinheiro Advogados</p></div></div>'
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const tarefa = searchParams.get('tarefa') || 'varrer'
  const debug = searchParams.get('debug') != null
  const dry = searchParams.get('dry') != null
  const soNumero = soDig(searchParams.get('numero') || '')
  const sb = admin()
  const office = process.env.EMAIL_COPIA || 'djan.adv@gmail.com'

  if (tarefa !== 'varrer') return Response.json({ erro: 'use ?tarefa=varrer' }, { status: 400 })

  let q = sb.from('inpi_marcas').select('*').eq('escritorio_id', ESCRITORIO_CMP).eq('ativo', true)
  if (soNumero) q = q.eq('numero', soNumero)
  const { data: marcas } = await q.limit(500)
  if (!marcas || !marcas.length) return Response.json({ ok: true, tarefa, marcas: 0, msg: 'nenhuma marca ativa' })

  const minRpi = Math.min(...marcas.map((m) => m.ultima_rpi || 0))
  const rev = await listarRevistas(21)
  if (rev.erro) return Response.json({ ok: false, tarefa, erro_rpi: rev.erro, url: rev.url })
  // só as RPIs ainda não varridas (as mais novas), no máximo 4 por rodada
  let edicoes = rev.itens.filter((e) => e.edicao > minRpi)
  if (edicoes.length > 4) edicoes = edicoes.slice(-4)

  const relatorio = { ok: true, tarefa, marcas: marcas.length, edicoes: edicoes.map((e) => e.edicao), lancados: 0, avisos: 0, suspensos: 0, detalhe: [] }

  for (const ed of edicoes) {
    let xmlBuf
    try { xmlBuf = await baixarXml(ed.arquivo) } catch (e) { relatorio.detalhe.push({ edicao: ed.edicao, erro: String((e && e.message) || e) }); continue }
    for (const m of marcas) {
      if ((m.ultima_rpi || 0) >= ed.edicao) continue
      const achado = despachosDoProcesso(xmlBuf, m.numero)
      const vistos = new Set(Array.isArray(m.despachos_vistos) ? m.despachos_vistos : [])
      const novos = []
      let motivoSusp = null
      if (achado && achado.despachos.length) {
        for (const d of achado.despachos) {
          const chave = ed.edicao + '|' + (d.codigo || '') + '|' + semAcento(d.complemento).slice(0, 80)
          if (vistos.has(chave)) continue
          vistos.add(chave); novos.push(d)
          if (!motivoSusp) motivoSusp = motivoEncerramento(d)
        }
      }
      if (debug) relatorio.detalhe.push({ edicao: ed.edicao, numero: m.numero, achou: !!achado, titular: achado && achado.titular, novos })
      if (dry) continue
      // grava andamentos no histórico da pasta
      if (novos.length && m.processo_id) {
        const rows = novos.map((d) => ({ processo_id: m.processo_id, data: ed.data || null, texto: '[INPI · RPI ' + ed.edicao + '] ' + (d.codigo ? d.codigo + ' — ' : '') + (d.nome || '') + (d.complemento ? ': ' + d.complemento : ''), fonte: 'inpi' }))
        await sb.from('andamentos').insert(rows)
        await sb.from('processos').update({ ultima_movimentacao: ed.data || null }).eq('id', m.processo_id)
        relatorio.lancados += rows.length
      }
      // atualiza tracker (mesmo sem novidade, avança a RPI varrida)
      const upd = { ultima_rpi: ed.edicao, despachos_vistos: Array.from(vistos), ultima_varredura: new Date().toISOString() }
      if (achado && achado.titular && !m.titular) upd.titular = achado.titular
      if (motivoSusp) { upd.ativo = false; upd.suspenso_motivo = motivoSusp; relatorio.suspensos++ }
      await sb.from('inpi_marcas').update(upd).eq('id', m.id)
      m.ultima_rpi = ed.edicao; m.despachos_vistos = Array.from(vistos)
      // e-mail ao escritório
      if (novos.length) {
        const ok = await enviar(office, 'INPI · marca ' + m.numero + ' — ' + novos.length + ' despacho(s) na RPI ' + ed.edicao, emailDespachos(m, ed.edicao, ed.data, novos, motivoSusp))
        if (ok) relatorio.avisos++
      }
    }
  }

  return Response.json(relatorio)
}
