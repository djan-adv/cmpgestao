// Protocolar pelo Gestão — juntada de petição em processo existente.
//
//   GET  /api/jusbr/protocolar?numero=...        → PREPARO (não protocola)
//   POST /api/jusbr/protocolar {numero, arquivo, idTipoDocumento, ...}  → protocola
//
// De onde saiu esta receita: o dono protocolou três petições pelo portal com a
// extensão ligada (TJBA, TRT5 e TJPB) e ela registrou o caminho inteiro. São
// três chamadas em sequência:
//   1) POST /api/v1/documentos/{numero}/upload/url  → devolve id e urlPreSigned
//   2) PUT  na urlPreSigned (S3 da PDPJ) com os bytes do PDF
//   3) POST /api/v1/peticoes/protocolar             → 201 com o recibo do CNJ
// e depois GET /api/v1/peticoes/{id}/recibo, que devolve a URL do comprovante.
//
// A TRAVA QUE IMPORTA: protocolar é irreversível. O GET aqui monta o envelope e
// devolve o que conseguiu preencher e o que faltou, SEM enviar nada. A tela só
// oferece o botão quando não falta campo. Se o tribunal recusar (o TJSE recusou
// "A petição não pode ser protocolada"), a resposta do portal vai inteira para a
// tela — não inventamos explicação.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { jusbrAdmin, getFreshToken, ESCRITORIO_CMP } from '../lib.js'
import { ROOT } from '../../peticao/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const CAB = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Origin: PDPJ, Referer: PDPJ + '/peticao',
}
const soDig = (s) => String(s || '').replace(/\D/g, '')
const mascara = (d) => (soDig(d).length === 20
  ? soDig(d).replace(/^(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6') : String(d || ''))

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

// ——— leitura defensiva do JSON do processo ———
// O PDPJ aninha os mesmos dados em lugares diferentes conforme o tribunal (o
// leitor de movimentos já sofreu com isso). Aqui procuramos a CHAVE pelo nome,
// em qualquer profundidade, e ficamos com o primeiro valor útil.
function acha(o, nomes, prof) {
  prof = prof || 0
  if (!o || typeof o !== 'object' || prof > 8) return null
  if (Array.isArray(o)) { for (const x of o) { const v = acha(x, nomes, prof + 1); if (v != null) return v } return null }
  for (const k of Object.keys(o)) {
    if (nomes.some(n => k.toLowerCase() === n.toLowerCase())) {
      const v = o[k]
      if (v != null && typeof v !== 'object') return v
      if (v && typeof v === 'object') { const d = v.codigo != null ? v.codigo : (v.id != null ? v.id : null); if (d != null) return d }
    }
  }
  for (const k of Object.keys(o)) { const v = acha(o[k], nomes, prof + 1); if (v != null) return v }
  return null
}
function achaNo(o, nomes, prof) {
  prof = prof || 0
  if (!o || typeof o !== 'object' || prof > 8) return null
  if (Array.isArray(o)) { for (const x of o) { const v = achaNo(x, nomes, prof + 1); if (v) return v } return null }
  for (const k of Object.keys(o)) if (nomes.some(n => k.toLowerCase() === n.toLowerCase()) && o[k] && typeof o[k] === 'object') return o[k]
  for (const k of Object.keys(o)) { const v = achaNo(o[k], nomes, prof + 1); if (v) return v }
  return null
}
// "AT" (ativo) / "PA" (passivo) — é o que o portal manda em modalidadePolo
function poloDe(p) {
  const t = String(p.polo || p.tipoPolo || p.modalidadePolo || '').toUpperCase()
  if (/^(AT|ATIVO|A)$/.test(t) || /ativ/i.test(t)) return 'AT'
  if (/^(PA|PASSIVO|P)$/.test(t) || /passiv/i.test(t)) return 'PA'
  return t || 'AT'
}
function partesDoProcesso(proc) {
  const lista = []
  const varre = (o, prof) => {
    prof = prof || 0
    if (!o || typeof o !== 'object' || prof > 8) return
    if (Array.isArray(o)) { o.forEach(x => varre(x, prof + 1)); return }
    for (const k of Object.keys(o)) {
      if (/^partes$/i.test(k) && Array.isArray(o[k])) {
        for (const p of o[k]) {
          const nome = p.nome || (p.pessoa && p.pessoa.nome) || null
          if (!nome) continue
          const doc = p.numeroDocumentoPrincipal || (p.pessoa && p.pessoa.numeroDocumentoPrincipal)
            || (Array.isArray(p.documentosIdentificacao) && p.documentosIdentificacao[0] && p.documentosIdentificacao[0].numero) || null
          const mod = p.modalidadeDocumentoIdentificador
            || (Array.isArray(p.documentosIdentificacao) && p.documentosIdentificacao[0] && (p.documentosIdentificacao[0].tipo || p.documentosIdentificacao[0].sigla)) || (doc ? (String(doc).length > 11 ? 'CNPJ' : 'CPF') : null)
          lista.push({
            pessoa: { nome: String(nome), numeroDocumentoPrincipal: doc ? soDig(doc) : null, modalidadeDocumentoIdentificador: mod || null },
            advogados: [], modalidadePolo: poloDe(p), assistenciaJudiciaria: false,
          })
        }
      } else varre(o[k], prof + 1)
    }
  }
  varre(proc, 0)
  // o mesmo nome pode vir repetido nas tramitações
  const vis = {}, out = []
  for (const p of lista) { const k = p.pessoa.nome.toLowerCase() + '|' + p.modalidadePolo; if (!vis[k]) { vis[k] = 1; out.push(p) } }
  return out
}

async function pdpj(url, token, opts) {
  return fetch(url, { ...(opts || {}), headers: { ...CAB, Authorization: 'Bearer ' + token, Accept: 'application/json', ...((opts && opts.headers) || {}) }, cache: 'no-store', signal: AbortSignal.timeout(60000) })
}

// monta o envelope do POST /peticoes/protocolar a partir do processo do PDPJ
async function montarEnvelope(token, dig) {
  const r = await pdpj(`${PDPJ}/api/v2/processos/${dig}`, token)
  if (!r.ok) return { erro: 'não consegui ler o processo no jus.br (HTTP ' + r.status + ')', http: r.status }
  const j = await r.json().catch(() => null)
  if (!j) return { erro: 'o jus.br respondeu algo que não é JSON' }
  const proc = (Array.isArray(j) ? j[0] : (j.content && j.content[0]) || j) || {}

  // jtrTribunal sai do próprio número CNJ (J + TR): 8.15 → 815, 5.05 → 505.
  // Confirmado nas três capturas; não depende de tabela nenhuma.
  const d = soDig(dig)
  const jtr = d.length === 20 ? (d.slice(13, 14) + d.slice(14, 16)) : null

  const grauTxt = String(acha(proc, ['grau', 'siglaGrau', 'instancia']) || '')
  const siglaGrau = /2|segundo|g2/i.test(grauTxt) ? 'G2' : 'G1'

  const assuntoNo = achaNo(proc, ['assunto', 'assuntoPrincipal']) || {}
  const assuntos = []
  if (assuntoNo && (assuntoNo.codigo || assuntoNo.descricao || assuntoNo.nome)) {
    assuntos.push({
      nome: assuntoNo.nome || assuntoNo.descricao || null, codigo: assuntoNo.codigo != null ? Number(assuntoNo.codigo) : null,
      descricao: assuntoNo.descricao || assuntoNo.nome || null, hierarquia: assuntoNo.hierarquia || null,
    })
  }
  const orgaoNo = achaNo(proc, ['orgaoJulgador', 'orgaoJulgadorOrigem', 'unidadeJudiciaria']) || {}

  const env = {
    id: null, tipo: 'A', sigiloso: 'nao',
    siglaGrau, numeroGrau: siglaGrau === 'G2' ? '2' : '1',
    valorCausa: Number(acha(proc, ['valorCausa', 'valorAcao']) || 0) || null,
    jtrTribunal: jtr,
    distribuidoEm: String(acha(proc, ['dataHoraAjuizamento', 'dataAjuizamento', 'dataDistribuicao', 'dataHoraDistribuicao']) || '').replace('T', ' ').slice(0, 19) || null,
    peticaoPartes: partesDoProcesso(proc),
    siglaTribunal: acha(proc, ['siglaTribunal', 'tribunal']) || null,
    numeroProcesso: mascara(d),
    idTipoDocumento: null,             // vem da escolha na tela
    peticaoAssuntos: assuntos,
    idComunicacaoDjen: null,
    idFonteDadosCodex: Number(acha(proc, ['idFonteDadosCodex', 'fonteDadosCodex', 'idCodex'])) || null,
    peticaoDocumentos: [],             // preenchido depois do upload
    idOrigemTramitacao: (acha(proc, ['idOrigemTramitacao', 'idTramitacao']) != null) ? String(acha(proc, ['idOrigemTramitacao', 'idTramitacao'])) : null,
    codigoClasseProcessual: Number(acha(proc, ['codigoClasseProcessual', 'classeProcessual', 'classe'])) || null,
    peticaoDadosComplementares: [],
    codOrgaoJulgadorCorporativo: Number(orgaoNo.codigo != null ? orgaoNo.codigo : (orgaoNo.id != null ? orgaoNo.id : acha(proc, ['codOrgaoJulgadorCorporativo']))) || null,
    nomeOrgaoJulgadorCorporativo: orgaoNo.nome || orgaoNo.descricao || null,
  }

  // o que ficou sem preencher — a tela não deixa protocolar assim
  const faltando = []
  const obrig = ['jtrTribunal', 'siglaTribunal', 'valorCausa', 'distribuidoEm', 'idFonteDadosCodex', 'idOrigemTramitacao', 'codigoClasseProcessual', 'codOrgaoJulgadorCorporativo', 'nomeOrgaoJulgadorCorporativo']
  for (const k of obrig) if (env[k] == null || env[k] === '') faltando.push(k)
  if (!env.peticaoPartes.length) faltando.push('peticaoPartes')
  if (!env.peticaoAssuntos.length) faltando.push('peticaoAssuntos')
  return { env, faltando, proc_bruto_chaves: Object.keys(proc).slice(0, 40) }
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const dig = soDig(searchParams.get('numero'))
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = jusbrAdmin()
  const tk = await getFreshToken(sb)
  if (!tk || !tk.token) return Response.json({ erro: 'sem acesso ao jus.br — entre no portal (a extensão sincroniza)', sem_sessao: true }, { status: 409 })

  const m = await montarEnvelope(tk.token, dig)
  if (m.erro) return Response.json({ erro: m.erro }, { status: m.http === 401 ? 409 : 502 })

  // lista de tipos de documento (é o "Juntada de Petição de" da tela do portal)
  let tipos = []
  try {
    const rt = await pdpj(`${PDPJ}/api/v1/tipo/documento?size=1000`, tk.token)
    const jt = await rt.json().catch(() => null)
    const cont = (jt && jt.dadosResposta && jt.dadosResposta.content) || (jt && jt.content) || []
    tipos = cont.map(x => ({ id: x.id, codigo: x.codigo, descricao: x.descricao || x.nome })).filter(x => x.descricao)
  } catch (e) {}

  return Response.json({ ok: true, numero: mascara(dig), envelope: m.env, faltando: m.faltando, tipos, pronto: m.faltando.length === 0 })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let b = {}
  try { b = await request.json() } catch (e) { return Response.json({ erro: 'corpo inválido' }, { status: 400 }) }
  const dig = soDig(b.numero)
  const rel = String(b.arquivo || '')                 // caminho relativo dentro da pasta do processo
  const idTipo = Number(b.idTipoDocumento || 0)
  const nomeTipo = String(b.nomeTipoDocumento || '')
  const quem = String(b.quem || '').slice(0, 80)
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })
  if (!rel) return Response.json({ erro: 'escolha o arquivo da petição' }, { status: 400 })
  if (!idTipo) return Response.json({ erro: 'escolha o tipo de documento' }, { status: 400 })

  // o arquivo tem de estar DENTRO da pasta do processo — nada de caminho solto
  const alvo = path.resolve(ROOT, dig, rel)
  if (!alvo.startsWith(path.resolve(ROOT, dig) + path.sep)) return Response.json({ erro: 'caminho de arquivo inválido' }, { status: 400 })
  let bytes
  try { bytes = fs.readFileSync(alvo) } catch (e) { return Response.json({ erro: 'não achei o arquivo na pasta do processo' }, { status: 404 }) }
  if (!bytes.length) return Response.json({ erro: 'o arquivo está vazio' }, { status: 400 })
  if (bytes.slice(0, 5).toString('latin1') !== '%PDF-') return Response.json({ erro: 'o arquivo precisa ser PDF' }, { status: 400 })

  const sb = jusbrAdmin()
  const tk = await getFreshToken(sb)
  if (!tk || !tk.token) return Response.json({ erro: 'sem acesso ao jus.br — entre no portal (a extensão sincroniza)', sem_sessao: true }, { status: 409 })

  const m = await montarEnvelope(tk.token, dig)
  if (m.erro) return Response.json({ erro: m.erro }, { status: 502 })
  if (m.faltando.length) return Response.json({ erro: 'faltam dados do processo para montar a petição: ' + m.faltando.join(', '), faltando: m.faltando }, { status: 422 })

  const nomeArq = path.basename(rel)
  const hash = crypto.createHash('sha1').update(bytes).digest('hex')
  const descricao = nomeArq.replace(/\.pdf$/i, '').slice(0, 200)
  const numMasc = mascara(dig)

  // 1) pede o endereço de upload
  const docMeta = {
    id: null, file: {}, hash, nome: nomeArq, ordem: 0, tamanho: bytes.length,
    mimeType: 'application/pdf', sigiloso: false, descricao, principal: true,
    idTipoDocumento: String(idTipo), nomeTipoDocumento: nomeTipo || null, idOrigemTipoDocumento: '3',
  }
  const r1 = await pdpj(`${PDPJ}/api/v1/documentos/${numMasc}/upload/url`, tk.token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(docMeta),
  })
  const j1 = await r1.json().catch(() => null)
  if (!r1.ok || !j1 || !j1.urlPreSigned) {
    return Response.json({ erro: 'o jus.br não liberou o envio do arquivo', http: r1.status, resposta: j1 || null }, { status: 502 })
  }

  // 2) sobe os bytes no endereço assinado (S3 da PDPJ)
  const r2 = await fetch(j1.urlPreSigned, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/pdf' }, signal: AbortSignal.timeout(180000) })
  if (!r2.ok) return Response.json({ erro: 'falha ao enviar o arquivo ao jus.br (HTTP ' + r2.status + ')' }, { status: 502 })

  // 3) protocola
  const env = m.env
  env.idTipoDocumento = idTipo
  env.peticaoDocumentos = [{ documento: { ...docMeta, id: j1.id != null ? j1.id : null, url: null, base64: null, idTipoDocumento: idTipo } }]
  const r3 = await pdpj(`${PDPJ}/api/v1/peticoes/protocolar`, tk.token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env),
  })
  const j3 = await r3.json().catch(() => null)
  if (!r3.ok) {
    // o tribunal recusou (o TJSE recusa com "A petição não pode ser protocolada")
    return Response.json({ erro: (j3 && (j3.message || j3.error)) || ('o jus.br recusou (HTTP ' + r3.status + ')'), http: r3.status, resposta: j3 || null, recusado: true }, { status: 502 })
  }

  // 4) comprovante: GET recibo devolve {url, contentType, nroProtocolo}
  let recibo = null
  try {
    const idPet = j3 && (j3.idPeticao || j3.id)
    if (idPet) {
      const r4 = await pdpj(`${PDPJ}/api/v1/peticoes/${idPet}/recibo`, tk.token)
      const j4 = await r4.json().catch(() => null)
      if (j4 && j4.url) {
        const r5 = await fetch(j4.url, { signal: AbortSignal.timeout(60000) })
        if (r5.ok) {
          const pdf = Buffer.from(await r5.arrayBuffer())
          const nomeRec = 'protocoloPeticao_' + (j4.nroProtocolo || j3.numeroReciboCnj || idPet) + '.pdf'
          const pastaProt = path.join(ROOT, dig, path.dirname(rel))
          fs.mkdirSync(pastaProt, { recursive: true })
          fs.writeFileSync(path.join(pastaProt, nomeRec), pdf)
          recibo = { arquivo: nomeRec, bytes: pdf.length, protocolo: j4.nroProtocolo || null }
        }
      }
    }
  } catch (e) { /* o protocolo foi feito; o comprovante é extra */ }

  // registra no histórico do processo
  try {
    const { data: proc } = await sb.from('processos').select('id').eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
    if (proc && proc.id) {
      await sb.from('andamentos').insert({
        processo_id: proc.id, data: new Date().toISOString().slice(0, 10), fonte: 'minuta',
        texto: '[ESTAGIÁRIO VIRTUAL] Petição protocolada pelo sistema' + (quem ? (' por ' + quem) : '') +
          ': "' + nomeArq + '" (' + (nomeTipo || idTipo) + '). Recibo CNJ ' + (j3.numeroReciboCnj || '—') +
          ', ' + (j3.status || 'enviado') + ' ao ' + (j3.siglaTribunal || env.siglaTribunal || 'tribunal') +
          (recibo ? ('. Comprovante guardado em "' + recibo.arquivo + '".') : '.'),
      })
    }
  } catch (e) {}

  return Response.json({
    ok: true, protocolo: j3.numeroReciboCnj || null, status: j3.status || null,
    data: j3.dataProtocolo || null, tribunal: j3.siglaTribunal || null,
    idPeticao: j3.idPeticao || j3.id || null, recibo,
  })
}
