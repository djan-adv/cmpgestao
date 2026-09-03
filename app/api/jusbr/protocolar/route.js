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
import { contaDemo, respostaDemo } from '../../../../lib/demo.js'

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
// mesma ideia, para chave cujo valor é uma LISTA (assuntos vem no plural em
// vários tribunais, e era por isso que peticaoAssuntos saía vazio)
function achaArr(o, nomes, prof) {
  prof = prof || 0
  if (!o || typeof o !== 'object' || prof > 8) return null
  if (Array.isArray(o)) { for (const x of o) { const v = achaArr(x, nomes, prof + 1); if (v) return v } return null }
  for (const k of Object.keys(o)) if (nomes.some(n => k.toLowerCase() === n.toLowerCase()) && Array.isArray(o[k]) && o[k].length) return o[k]
  for (const k of Object.keys(o)) { const v = achaArr(o[k], nomes, prof + 1); if (v) return v }
  return null
}
/* No PDPJ o mesmo campo vem ora como objeto, ora como LISTA de um item só:
   classe:[{codigo,descricao}], assunto:[{...}], orgaoJulgador:[{...}]. Ler só o
   objeto fazia classe.codigo virar undefined e a tela dizer que o jus.br não
   devolveu nada — quando devolveu, só que dentro de uma lista. */
const umNo = (x) => Array.isArray(x) ? (x.find(v => v && typeof v === 'object') || null) : x
const numOu = (v) => { if (v == null || typeof v === 'object') return null; const n = Number(String(v).replace(/[^\d.-]/g, '')); return (Number.isFinite(n) && n !== 0) ? n : null }
const txtOu = (v) => (v == null || typeof v === 'object') ? null : (String(v).trim() || null)

// a tramitação onde o processo está — é lá que moram órgão, classe e o id que o
// portal chama de idOrigemTramitacao
function noTramitacao(f) {
  if (!f || typeof f !== 'object') return null
  if (f.tramitacaoAtual && typeof f.tramitacaoAtual === 'object') return f.tramitacaoAtual
  if (Array.isArray(f.tramitacoes) && f.tramitacoes.length) return f.tramitacoes[0]
  const n = achaNo(f, ['tramitacaoAtual'])
  if (n) return n
  const a = achaArr(f, ['tramitacoes'])
  return (a && a[0]) || null
}
function primeiro(fontes, nomes) { for (const f of fontes) { const v = acha(f, nomes); if (v != null && v !== '') return v } return null }
function primeiroNo(fontes, nomes) { for (const f of fontes) { const n = achaNo(f, nomes); if (n) return n } return null }
function primeiroArr(fontes, nomes) { for (const f of fontes) { const a = achaArr(f, nomes); if (a && a.length) return a } return null }

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

// Assunto com CÓDIGO — nome sozinho o tribunal não aceita (o envelope que passou
// no TJBA levava {codigo:7780}). Aceita 'assuntos' (plural, lista) e 'assunto'.
function assuntosDe(fontes) {
  const arr = primeiroArr(fontes, ['peticaoAssuntos', 'assuntos', 'assunto'])
  let cru = (arr && arr.length) ? arr : []
  if (!cru.length) { const n = primeiroNo(fontes, ['assunto', 'assuntoPrincipal']); if (n) cru = Array.isArray(n) ? n : [n] }
  const out = []
  for (const a of cru) {
    if (!a || typeof a !== 'object') continue
    const codigo = numOu(a.codigo != null ? a.codigo : (a.codigoNacional != null ? a.codigoNacional : a.id))
    const nome = txtOu(a.nome || a.descricao)
    if (codigo == null && !nome) continue
    out.push({ nome, codigo, descricao: txtOu(a.descricao || a.nome), hierarquia: txtOu(a.hierarquia) })
  }
  return out
}

// ——— rede de segurança: o envelope que o PRÓPRIO PORTAL mandou neste processo ———
// Nos juizados do TJBA o /api/v2/processos devolve a vara como TEXTO ("3VARA DO
// SISTEMA DO JUIZADO ESPECIAL - ILHEUS"), sem código de órgão, sem código de
// classe e sem o id da tramitação — dados que o portal tem porque os carrega de
// outra rota interna. Como a extensão guardou o POST /peticoes/protocolar de
// cada protocolo feito à mão, quando falta um campo ESTRUTURAL nós o tiramos de
// lá: mesmo processo, mesmo órgão, envelope que o tribunal já aceitou (201).
// A tela diz quais campos vieram daí e de quando, para conferência antes do envio.
async function envelopeDeCaptura(sb, dig) {
  try {
    const { data } = await sb.from('pdpj_capturas')
      .select('corpo_forma,criado_em').eq('escritorio_id', ESCRITORIO_CMP)
      .eq('metodo', 'POST').eq('resposta_status', 201).like('url', '%peticoes/protocolar%')
      .order('criado_em', { ascending: false }).limit(50)
    for (const c of (data || [])) {
      const e = c && c.corpo_forma
      if (e && typeof e === 'object' && soDig(e.numeroProcesso) === dig) return { env: e, quando: c.criado_em }
    }
  } catch (e) {}
  return null
}

/* Esqueleto do JSON: mesma forma, valores encurtados. Lista vira ["(lista de
   N)", <esqueleto do 1º>]; movimentos/documentos ficam de fora. É o que permite
   consertar a leitura de um tribunal novo sem pedir o processo inteiro. */
function esqueleto(o, prof) {
  prof = prof || 0
  if (o == null) return null
  if (Array.isArray(o)) return o.length ? ['(lista de ' + o.length + ')', esqueleto(o[0], prof + 1)] : []
  if (typeof o !== 'object') return String(o).slice(0, 60)
  if (prof > 2) return '{…}'
  const out = {}
  for (const k of Object.keys(o).slice(0, 25)) {
    if (/moviment|documento|anexo/i.test(k)) { out[k] = '(omitido)'; continue }
    out[k] = esqueleto(o[k], prof + 1)
  }
  return out
}

/* O endereço assinado de upload nem sempre vem em urlPreSigned na raiz — já
   apareceu aninhado e com outro nome. Em vez de exigir uma chave só, procuramos
   a URL http de upload em qualquer profundidade. */
function achaUrlUpload(o, prof) {
  prof = prof || 0
  if (!o || typeof o !== 'object' || prof > 6) return null
  if (Array.isArray(o)) { for (const x of o) { const v = achaUrlUpload(x, prof + 1); if (v) return v } return null }
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && /presign|upload/i.test(k)) return v
  }
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && /^url$/i.test(k)) return v
  }
  for (const k of Object.keys(o)) { const v = achaUrlUpload(o[k], prof + 1); if (v) return v }
  return null
}
/* nome de arquivo que o PDPJ aceita sem discutir: parêntese e sinal exótico já
   derrubaram um envio ("… ELEN (2).pdf", 31/08/2026). O arquivo local não muda —
   só o nome que viaja. */
function nomePdpj(n) {
  let x = String(n || 'documento').replace(/\.pdf$/i, '')
  x = x.replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!x) x = 'documento'
  return x.slice(0, 100) + '.pdf'
}

async function pdpj(url, token, opts) {
  return fetch(url, { ...(opts || {}), headers: { ...CAB, Authorization: 'Bearer ' + token, Accept: 'application/json', ...((opts && opts.headers) || {}) }, cache: 'no-store', signal: AbortSignal.timeout(60000) })
}

// monta o envelope do POST /peticoes/protocolar a partir do processo do PDPJ
async function montarEnvelope(token, dig, sb) {
  const r = await pdpj(`${PDPJ}/api/v2/processos/${dig}`, token)
  if (!r.ok) return { erro: 'não consegui ler o processo no jus.br (HTTP ' + r.status + ')', http: r.status }
  const j = await r.json().catch(() => null)
  if (!j) return { erro: 'o jus.br respondeu algo que não é JSON' }
  const proc = (Array.isArray(j) ? j[0] : (j.content && j.content[0]) || j) || {}

  /* Segunda fonte: a rota que o próprio portal chama ao abrir o peticionamento.
     É de lá que ele tira os códigos de órgão e classe — o /api/v2/processos, nos
     juizados, devolve só os nomes. Pode falhar (o TJPB devolveu 500); quando
     falha, seguimos com o que há. */
  let pp = null, ppHttp = null
  try {
    const rp = await pdpj(`${PDPJ}/api/v1/peticoes/processo/${dig}`, token)
    ppHttp = rp.status
    if (rp.ok) pp = await rp.json().catch(() => null)
  } catch (e) { ppHttp = 0 }

  // ordem de leitura: peticionamento → tramitação dele → processo → tramitação do processo
  const fontes = [pp, noTramitacao(pp), proc, noTramitacao(proc)].filter(Boolean)

  // jtrTribunal sai do próprio número CNJ (J + TR): 8.15 → 815, 5.05 → 505.
  // Confirmado nas três capturas; não depende de tabela nenhuma.
  const d = soDig(dig)
  const jtr = d.length === 20 ? (d.slice(13, 14) + d.slice(14, 16)) : null

  const grauTxt = String(primeiro(fontes, ['siglaGrau', 'grau', 'instancia']) || '')
  const siglaGrau = /2|segundo|g2/i.test(grauTxt) ? 'G2' : 'G1'

  const assuntos = assuntosDe(fontes)

  /* Órgão julgador: pode vir como objeto {codigo,nome} OU como texto puro. Era
     esse o caso do 0009652-03.2026.8.05.0103 — achaNo() só devolve objeto, então
     não achava nada e a tela dizia "Vara: —". */
  const orgaoNo = umNo(primeiroNo(fontes, ['orgaoJulgador', 'orgaoJulgadorOrigem', 'unidadeJudiciaria', 'orgao'])) || {}
  const orgaoCod = numOu(primeiro(fontes, ['codOrgaoJulgadorCorporativo', 'codigoOrgaoJulgadorCorporativo']))
    || numOu(orgaoNo.codigoOrgao != null ? orgaoNo.codigoOrgao : (orgaoNo.codigo != null ? orgaoNo.codigo : orgaoNo.id))
    || numOu(primeiro(fontes, ['codigoOrgaoJulgador', 'idOrgaoJulgador', 'codigoOrgao']))
  const orgaoNome = txtOu(primeiro(fontes, ['nomeOrgaoJulgadorCorporativo', 'nomeOrgaoJulgador']))
    || txtOu(orgaoNo.nome || orgaoNo.nomeOrgao || orgaoNo.descricao)
    || txtOu(primeiro(fontes, ['orgaoJulgador', 'unidadeJudiciaria', 'orgao']))

  const classeNo = umNo(primeiroNo(fontes, ['classe', 'classeProcessual', 'classeJudicial'])) || {}
  const classeCod = numOu(primeiro(fontes, ['codigoClasseProcessual', 'codClasseProcessual', 'codigoClasse']))
    || numOu(classeNo.codigo != null ? classeNo.codigo : (classeNo.codigoNacional != null ? classeNo.codigoNacional : classeNo.id))

  /* o id da tramitação, no v2, chama-se idOrigem dentro de tramitacaoAtual —
     não idOrigemTramitacao (esse é o nome que o PORTAL usa no envelope) */
  const tramId = primeiro(fontes, ['idOrigemTramitacao', 'idTramitacao'])
    || (() => {
      for (const f of [umNo(noTramitacao(pp)), umNo(noTramitacao(proc))]) {
        if (!f) continue
        const v = f.idOrigemTramitacao != null ? f.idOrigemTramitacao : (f.idTramitacao != null ? f.idTramitacao : (f.idOrigem != null ? f.idOrigem : f.id))
        if (v != null && v !== '') return v
      }
      return null
    })()

  const env = {
    id: null, tipo: 'A', sigiloso: 'nao',
    siglaGrau, numeroGrau: siglaGrau === 'G2' ? '2' : '1',
    valorCausa: numOu(primeiro(fontes, ['valorCausa', 'valorAcao'])),
    jtrTribunal: jtr,
    distribuidoEm: String(primeiro(fontes, ['dataHoraAjuizamento', 'dataAjuizamento', 'dataDistribuicao', 'dataHoraDistribuicao']) || '').replace('T', ' ').slice(0, 19) || null,
    peticaoPartes: (partesDoProcesso(pp || {}).length ? partesDoProcesso(pp) : partesDoProcesso(proc)),
    siglaTribunal: txtOu(primeiro(fontes, ['siglaTribunal', 'tribunal'])),
    numeroProcesso: mascara(d),
    idTipoDocumento: null,             // vem da escolha na tela
    peticaoAssuntos: assuntos,
    idComunicacaoDjen: null,
    idFonteDadosCodex: numOu(primeiro(fontes, ['idFonteDadosCodex', 'fonteDadosCodex', 'idCodex'])),
    peticaoDocumentos: [],             // preenchido depois do upload
    idOrigemTramitacao: tramId != null ? String(tramId) : null,
    codigoClasseProcessual: classeCod,
    peticaoDadosComplementares: [],
    codOrgaoJulgadorCorporativo: orgaoCod,
    nomeOrgaoJulgadorCorporativo: orgaoNome,
  }

  const OBRIG = ['jtrTribunal', 'siglaTribunal', 'valorCausa', 'distribuidoEm', 'idFonteDadosCodex', 'idOrigemTramitacao', 'codigoClasseProcessual', 'codOrgaoJulgadorCorporativo', 'nomeOrgaoJulgadorCorporativo']
  const oQueFalta = () => {
    const f = []
    for (const k of OBRIG) if (env[k] == null || env[k] === '') f.push(k)
    if (!env.peticaoPartes.length) f.push('peticaoPartes')
    if (!env.peticaoAssuntos.some(a => a.codigo != null)) f.push('peticaoAssuntos')
    return f
  }

  // faltou campo estrutural? tenta o envelope que o portal já usou neste processo
  let reaproveitado = null
  let divergencias = []
  if (sb) {
    const cap = await envelopeDeCaptura(sb, d)
    /* Mesmo com tudo preenchido, se existe um protocolo ACEITO neste processo,
       vale comparar: nome de vara certo com CÓDIGO errado não se vê na tela, e
       protocolo não se desfaz. Diferença aqui não é necessariamente erro (o
       processo pode ter mudado de vara ou subido de grau) — por isso a tela
       mostra em vez de decidir sozinha. */
    if (cap && cap.env) {
      /* Comparar texto na bruta dava alarme falso: o envelope guardado pode vir
         com o nome da vara CORTADO ("… CONSUMIDOR - S…"), e aí "13ª VARA …
         SALVADOR" parecia divergente de si mesma. Compara sem acento, sem
         caixa, e aceita um lado ser começo do outro. */
      const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[…]|\.\.\.$/g, '').replace(/\s+/g, ' ').trim()
      const igual = (a, b) => {
        const x = norm(a), y = norm(b)
        if (!x || !y) return true
        return x === y || x.startsWith(y) || y.startsWith(x)
      }
      const codigosBatem = String(env.codOrgaoJulgadorCorporativo || '') === String(cap.env.codOrgaoJulgadorCorporativo || '')
      for (const k of ['codOrgaoJulgadorCorporativo', 'idOrigemTramitacao', 'codigoClasseProcessual', 'nomeOrgaoJulgadorCorporativo']) {
        // o nome é rótulo do código: com o código igual, diferença de texto não é divergência
        if (k === 'nomeOrgaoJulgadorCorporativo' && codigosBatem) continue
        const meu = env[k], dele = cap.env[k]
        if (meu != null && meu !== '' && dele != null && dele !== '' && !igual(meu, dele)) {
          divergencias.push({ campo: k, jusbr: String(meu), protocolo_anterior: String(dele), quando: cap.quando })
        }
      }
    }
    if (cap && cap.env && oQueFalta().length) {
      const usados = []
      for (const k of ['idOrigemTramitacao', 'codigoClasseProcessual', 'codOrgaoJulgadorCorporativo', 'nomeOrgaoJulgadorCorporativo', 'idFonteDadosCodex', 'siglaTribunal', 'valorCausa', 'distribuidoEm', 'jtrTribunal']) {
        if ((env[k] == null || env[k] === '') && cap.env[k] != null && cap.env[k] !== '') { env[k] = cap.env[k]; usados.push(k) }
      }
      if (!env.peticaoAssuntos.some(a => a.codigo != null) && Array.isArray(cap.env.peticaoAssuntos) && cap.env.peticaoAssuntos.length) {
        env.peticaoAssuntos = cap.env.peticaoAssuntos; usados.push('peticaoAssuntos')
      }
      if (!env.peticaoPartes.length && Array.isArray(cap.env.peticaoPartes) && cap.env.peticaoPartes.length) {
        env.peticaoPartes = cap.env.peticaoPartes; usados.push('peticaoPartes')
      }
      /* o grau tem de casar com o órgão: se o código do órgão veio da captura, o
         grau dela manda mais do que o nosso palpite pelo texto */
      if (usados.indexOf('codOrgaoJulgadorCorporativo') >= 0 && cap.env.siglaGrau && cap.env.siglaGrau !== env.siglaGrau) {
        env.siglaGrau = cap.env.siglaGrau
        env.numeroGrau = cap.env.numeroGrau || (cap.env.siglaGrau === 'G2' ? '2' : '1')
        usados.push('siglaGrau')
      }
      if (usados.length) reaproveitado = { campos: usados, quando: cap.quando }
    }
  }

  /* O próprio jus.br diz, processo a processo, se aceita peticionamento pelo
     portal — é o campo permitePeticionar da tramitação. Tribunal com sistema
     próprio fora da integração (o Projudi do TJPR, por exemplo) responde false,
     e aí não adianta montar envelope nenhum: o protocolo é no sistema dele.
     Dizer isso na cara é melhor do que listar campos faltando. */
  const permiteBruto = primeiro(fontes, ['permitePeticionar', 'permitePeticionamento'])
  const permitePeticionar = (permiteBruto === false || String(permiteBruto).toLowerCase() === 'false') ? false
    : ((permiteBruto === true || String(permiteBruto).toLowerCase() === 'true') ? true : null)

  const faltando = oQueFalta()
  /* o que o jus.br REALMENTE devolveu — sem isto, campo faltando vira
     adivinhação. A primeira versão trazia só os NOMES das chaves, e nome de
     chave não diz se o valor é objeto, lista ou texto — que é exatamente onde
     a leitura se perdia. Agora vai o esqueleto com os tipos e uma amostra
     curta, sem movimentos nem documentos (que são listas enormes). */
  const visto = {
    v2_chaves: Object.keys(proc || {}).slice(0, 40),
    v2_tramitacao: Object.keys(umNo(noTramitacao(proc)) || {}).slice(0, 40),
    peticionamento_http: ppHttp,
    peticionamento_chaves: Object.keys((Array.isArray(pp) ? pp[0] : pp) || {}).slice(0, 40),
    amostra: faltando.length ? esqueleto(umNo(noTramitacao(proc)) || proc, 0) : undefined,
  }
  return { env, faltando, reaproveitado, divergencias, permitePeticionar, visto }
}

/* "Protocolei — e chegou?" O recibo do CNJ prova que o CNJ recebeu e mandou ao
   tribunal (ENVIADO_AO_TRIBUNAL). A juntada nos autos é assíncrona: entra numa
   fila do tribunal e pode levar de minutos a horas. Isto pergunta ao jus.br em
   que pé está, para ninguém ficar recarregando o PJe no dia do prazo.
   Lê defensivamente: o formato de /peticoes varia, então varremos o JSON atrás
   dos objetos que têm cara de petição. */
/* Três destinos possíveis, e só um deles encerra o prazo:
   RECUSADA  — o tribunal não recebeu. O prazo continua correndo.
   CONFIRMADA— entrou nos autos.
   ENVIADA   — o CNJ mandou e o tribunal ainda não respondeu. */
function classeDoStatus(st) {
  const t = String(st || '').toLowerCase()
  if (/recus|rejeit|erro|falh|inval|n[ãa]o[\s_-]*protocol|cancel|devolv/.test(t)) return 'recusada'
  if (/protocolad|juntad|conclu|sucesso|aceit|receb.*tribunal.*ok/.test(t)) return 'confirmada'
  if (/envi|process|aguard|andamento|fila/.test(t)) return 'enviada'
  return 'desconhecida'
}
function coletaPeticoes(o, out, prof) {
  out = out || []; prof = prof || 0
  if (!o || typeof o !== 'object' || prof > 6 || out.length > 60) return out
  if (Array.isArray(o)) { for (const x of o) coletaPeticoes(x, out, prof + 1); return out }
  const k = Object.keys(o)
  const tem = (re) => k.find(x => re.test(x))
  const cRecibo = tem(/^(numeroReciboCnj|nroProtocolo|numeroProtocolo|protocolo)$/i)
  const cStatus = tem(/^(status|situacao|situação)$/i)
  const cProc = tem(/^(numeroProcesso|processo)$/i)
  if ((cRecibo && cStatus) || (cProc && cStatus)) {
    const st = String(o[cStatus] && typeof o[cStatus] === 'object' ? (o[cStatus].descricao || o[cStatus].nome || '') : o[cStatus] || '')
    out.push({
      recibo: cRecibo ? String(o[cRecibo]) : null,
      status: st,
      classe: classeDoStatus(st),
      motivo: (o.motivo || o.mensagem || o.erro || o.descricaoErro || o.observacao || null),
      processo: cProc ? String(o[cProc]) : null,
      quando: o.dataProtocolo || o.dataHoraProtocolo || o.dataEnvio || o.dataHoraEnvio || o.criadoEm || null,
      tipo: (o.nomeTipoDocumento || o.tipoDocumento || null),
      id: (o.idPeticao != null ? o.idPeticao : (o.id != null ? o.id : null)),
    })
    return out
  }
  for (const x of k) coletaPeticoes(o[x], out, prof + 1)
  return out
}
async function situacaoDasPeticoes(token, dig) {
  const tentativas = []
  const urls = [
    `${PDPJ}/api/v1/peticoes/processo/${dig}`,
    `${PDPJ}/api/v1/peticoes?numeroProcesso=${mascara(dig)}`,
    `${PDPJ}/api/v1/peticoes`,
  ]
  for (const u of urls) {
    let r, j = null
    try { r = await pdpj(u, token); j = await r.json().catch(() => null) } catch (e) { tentativas.push({ url: u.replace(PDPJ, ''), erro: String((e && e.message) || e) }); continue }
    tentativas.push({ url: u.replace(PDPJ, ''), status: r.status })
    if (!r.ok || !j) continue
    const todas = coletaPeticoes(j, [])
    // a lista geral traz as de todos os processos: filtra pela deste
    const minhas = todas.filter(p => !p.processo || soDig(p.processo) === dig)
    if (minhas.length) return { peticoes: minhas, tentativas }
  }
  return { peticoes: [], tentativas }
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

  if (searchParams.get('situacao') != null) {
    const r = await situacaoDasPeticoes(tk.token, dig)
    return Response.json({ ok: true, numero: mascara(dig), peticoes: r.peticoes, tentativas: r.tentativas })
  }

  const m = await montarEnvelope(tk.token, dig, sb)
  if (m.erro) return Response.json({ erro: m.erro }, { status: m.http === 401 ? 409 : 502 })

  // lista de tipos de documento (é o "Juntada de Petição de" da tela do portal)
  let tipos = []
  try {
    const rt = await pdpj(`${PDPJ}/api/v1/tipo/documento?size=1000`, tk.token)
    const jt = await rt.json().catch(() => null)
    const cont = (jt && jt.dadosResposta && jt.dadosResposta.content) || (jt && jt.content) || []
    tipos = cont.map(x => ({ id: x.id, codigo: x.codigo, descricao: x.descricao || x.nome })).filter(x => x.descricao)
  } catch (e) {}

  return Response.json({
    ok: true, numero: mascara(dig), envelope: m.env, faltando: m.faltando,
    reaproveitado: m.reaproveitado || null, divergencias: m.divergencias || [],
    permite_peticionar: (m.permitePeticionar === undefined ? null : m.permitePeticionar), visto: m.visto || null,
    tipos, pronto: m.faltando.length === 0,
  })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (await contaDemo(user)) return respostaDemo('protocolar no jus.br')
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

  const m = await montarEnvelope(tk.token, dig, sb)
  if (m.erro) return Response.json({ erro: m.erro }, { status: 502 })
  if (m.permitePeticionar === false) {
    return Response.json({ erro: 'o jus.br informa que este processo não aceita peticionamento pelo portal — protocole pelo sistema do próprio tribunal', nao_permite: true }, { status: 422 })
  }
  if (m.faltando.length) return Response.json({ erro: 'faltam dados do processo para montar a petição: ' + m.faltando.join(', '), faltando: m.faltando, visto: m.visto || null }, { status: 422 })

  const nomeArq = path.basename(rel)
  const numMasc = mascara(dig)

  /* Petição não vai sozinha: procuração, comprovante, laudo. O envelope aceita
     vários documentos (foi assim que o portal mandou nas capturas) — o primeiro
     é a peça (principal:true) e os demais entram como Anexo, na ordem. */
  const idAnexo = Number(b.idTipoAnexo || 0) || idTipo
  const nomeTipoAnexo = String(b.nomeTipoAnexo || 'Anexo')
  const pecas = [{ rel, bytes, principal: true, idT: idTipo, nomeT: nomeTipo || null }]
  for (const ra of (Array.isArray(b.anexos) ? b.anexos : []).slice(0, 20)) {
    const relA = String(ra || '')
    if (!relA) continue
    const alvoA = path.resolve(ROOT, dig, relA)
    if (!alvoA.startsWith(path.resolve(ROOT, dig) + path.sep)) return Response.json({ erro: 'caminho de anexo inválido' }, { status: 400 })
    let bufA
    try { bufA = fs.readFileSync(alvoA) } catch (e) { return Response.json({ erro: 'não achei o anexo "' + path.basename(relA) + '" na pasta' }, { status: 404 }) }
    if (!bufA.length) return Response.json({ erro: 'o anexo "' + path.basename(relA) + '" está vazio' }, { status: 400 })
    if (bufA.slice(0, 5).toString('latin1') !== '%PDF-') return Response.json({ erro: 'o anexo "' + path.basename(relA) + '" precisa ser PDF' }, { status: 400 })
    pecas.push({ rel: relA, bytes: bufA, principal: false, idT: idAnexo, nomeT: nomeTipoAnexo })
  }

  // 1 e 2) para cada documento: pede o endereço de upload e sobe os bytes
  const docs = []
  for (let i = 0; i < pecas.length; i++) {
    const pc = pecas[i]
    const nm = nomePdpj(path.basename(pc.rel))
    const meta = {
      id: null, file: {}, hash: crypto.createHash('sha1').update(pc.bytes).digest('hex'),
      nome: nm, ordem: i, tamanho: pc.bytes.length,
      mimeType: 'application/pdf', sigiloso: false, descricao: nm.replace(/\.pdf$/i, '').slice(0, 200),
      principal: pc.principal, idTipoDocumento: String(pc.idT), nomeTipoDocumento: pc.nomeT, idOrigemTipoDocumento: '3',
    }
    const r1 = await pdpj(`${PDPJ}/api/v1/documentos/${numMasc}/upload/url`, tk.token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
    })
    const j1 = await r1.json().catch(() => null)
    const urlUp = achaUrlUpload(j1)
    /* HTTP 200, com id e hash, mas SEM endereço de upload: o PDPJ já tem estes
       bytes — ele deduplica pelo sha1 e não pede de novo o que já guardou.
       Aconteceu em 02/09/2026 reenviando a mesma "Petição Prosseguimento.pdf"
       que já fora protocolada dias antes e ainda esperava confirmação.
       Aqui não se segue calado: protocolo não se desfaz, e mandar duas vezes a
       mesma peça é pior que não mandar. Avisa e só continua se o advogado
       confirmar — aí sobe nada e vai direto protocolar, que é o que o portal faz. */
    const jaGuardado = !!(r1.ok && !urlUp && j1 && j1.id != null && j1.hash)
    if (jaGuardado && b.confirmar_reenvio !== true) {
      return Response.json({
        erro: 'o jus.br respondeu que JÁ TEM este arquivo — "' + nm + '" é idêntico, byte a byte, a um documento que você já enviou a este processo.'
          + ' Ele foi registrado lá como documento ' + j1.id + '. Protocolar de novo criaria uma segunda petição com a mesma peça.',
        duplicado: true, documento_id: j1.id, hash: j1.hash, arquivo: nm, resposta: j1,
      }, { status: 409 })
    }
    if (jaGuardado) {
      docs.push({ documento: { ...meta, id: j1.id, url: null, base64: null, idTipoDocumento: pc.idT } })
      continue
    }
    if (!r1.ok || !j1 || !urlUp) {
      /* mensagem que serve para consertar: o que o servidor respondeu e o que
         faltou nela. "não liberou o envio" sozinho não diz nada a ninguém. */
      const chaves = (j1 && typeof j1 === 'object' && !Array.isArray(j1)) ? Object.keys(j1).slice(0, 25).join(', ') : ''
      const motivo = (j1 && (j1.message || j1.erro || j1.error || j1.detail)) || ''
      return Response.json({
        erro: 'o jus.br não liberou o envio de "' + nm + '" (HTTP ' + r1.status + ')'
          + (motivo ? (' — ' + String(motivo).slice(0, 200)) : (r1.ok ? ' — respondeu sem o endereço de upload' : ''))
          + (chaves ? (' [campos: ' + chaves + ']') : ''),
        http: r1.status, sem_url_upload: !!(r1.ok && !urlUp), resposta: j1 || null,
      }, { status: 502 })
    }
    const r2 = await fetch(urlUp, { method: 'PUT', body: pc.bytes, headers: { 'Content-Type': 'application/pdf' }, signal: AbortSignal.timeout(180000) })
    if (!r2.ok) return Response.json({ erro: 'falha ao enviar "' + nm + '" ao jus.br (HTTP ' + r2.status + ')' }, { status: 502 })
    docs.push({ documento: { ...meta, id: j1.id != null ? j1.id : null, url: null, base64: null, idTipoDocumento: pc.idT } })
  }

  // 3) protocola
  const env = m.env
  env.idTipoDocumento = idTipo
  env.peticaoDocumentos = docs
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
      /* mesma fonte do protocolo confirmado à mão ('protocolo', providência):
         é o mesmo ato jurídico, e registrá-lo de dois jeitos diferentes fazia a
         mesma petição contar de um jeito quando saía daqui e de outro quando
         saía pelo portal */
      await sb.from('andamentos').insert({
        processo_id: proc.id, data: new Date().toISOString().slice(0, 10), fonte: 'protocolo', providencia: true,
        texto: '[PROTOCOLO] Petição protocolada pelo Gestão' + (quem ? (' por ' + quem) : '') +
          ': "' + nomeArq + '" (' + (nomeTipo || idTipo) + ')' + (docs.length > 1 ? (' + ' + (docs.length - 1) + ' anexo(s)') : '') + '. Recibo CNJ ' + (j3.numeroReciboCnj || '—') +
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
