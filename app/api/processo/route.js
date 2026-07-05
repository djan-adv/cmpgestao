// API do CMPGestão — auto-preenchimento por número (roda no SERVIDOR).
// Consulta o DataJud (base pública do CNJ) em TODAS as instâncias em que o
// processo tramita: 1º grau, 2º grau, Turma Recursal e superiores (TST/STJ/STF).
// Identifica ONDE o processo está tramitando agora (instância com o movimento
// mais recente) e devolve o histórico mesclado, com etiqueta da instância.
//
// Uso:  GET /api/processo?numero=0816640-57.2026.8.15.2001
//
// Lógica da movimentação: se o processo sobe ao 2º grau, para de movimentar no
// 1º e movimenta lá; se é baixado, volta a movimentar no 1º. O movimento mais
// recente entre TODAS as instâncias indica a instância atual.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEY = 'APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='
const TJ  = {'01':'tjac','02':'tjal','03':'tjap','04':'tjam','05':'tjba','06':'tjce','07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms','13':'tjmg','14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi','19':'tjrj','20':'tjrn','21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc','25':'tjse','26':'tjsp','27':'tjto'}
const TRF = {'01':'trf1','02':'trf2','03':'trf3','04':'trf4','05':'trf5','06':'trf6'}

function alias(numDigitos) {
  const d = numDigitos
  if (d.length < 16) return null
  const J = d[13], TR = d.slice(14, 16)
  if (J === '8') return TJ[TR] || null
  if (J === '4') return TRF[TR] || null
  if (J === '5') return 'trt' + parseInt(TR, 10)
  return null
}

// índices superiores a consultar conforme o ramo da Justiça
function superiores(numDigitos) {
  const J = numDigitos[13]
  if (J === '5') return ['tst', 'stf']
  if (J === '8' || J === '4') return ['stj', 'stf']
  return []
}

function grauLabel(grau, trib) {
  const t = String(trib || '').toLowerCase()
  if (t === 'tst') return 'TST'
  if (t === 'stj') return 'STJ'
  if (t === 'stf') return 'STF'
  const g = String(grau || '').toUpperCase()
  if (g === 'G1' || g === 'JE') return '1º Grau'
  if (g === 'G2') return '2º Grau'
  if (g === 'TR') return 'Turma Recursal'
  if (g === 'SUP') return 'Instância Superior'
  return g || '1º Grau'
}

async function buscaIndice(tribAlias, dig) {
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribAlias}/_search`
  const body = { query: { match: { numeroProcesso: dig } }, size: 10 }
  let r
  for (let t = 0; t < 2; t++) {
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
      break
    } catch (e) {
      if (t === 1) return []
      await new Promise(res => setTimeout(res, 2000))
    }
  }
  if (!r || !r.ok) return []
  const j = await r.json().catch(() => null)
  return (j && j.hits && j.hits.hits) || []
}

async function consultaDataJud(numero) {
  const dig = String(numero).replace(/\D/g, '')
  const a = alias(dig)
  if (!a) return { erro: 'tribunal não identificado pelo número' }

  // 1) tribunal de origem (traz G1, G2, TR no mesmo índice) + superiores em paralelo
  const idxs = [a, ...superiores(dig)]
  const resultados = await Promise.all(idxs.map(ix => buscaIndice(ix, dig)))

  const instancias = []
  let todosMov = []
  resultados.forEach((hits, i) => {
    const trib = idxs[i]
    for (const hit of hits) {
      const s = hit._source || {}
      const label = grauLabel(s.grau, i === 0 ? null : trib)
      const movs = (s.movimentos || []).map(m => ({
        data: m.dataHora,
        instancia: label,
        texto: '[' + label + '] ' + [m.nome, (m.complementosTabelados || []).map(c => c.nome).filter(Boolean).join('; ')].filter(Boolean).join(' — '),
      }))
      movs.sort((x, y) => (y.data || '').localeCompare(x.data || ''))
      instancias.push({
        instancia: label,
        tribunal: trib.toUpperCase(),
        grau: s.grau || null,
        orgao: s.orgaoJulgador?.nome || null,
        classe: s.classe?.nome || null,
        assunto: (s.assuntos || [])[0]?.nome || null,
        dataAjuizamento: s.dataAjuizamento || null,
        ultimaMovimentacao: movs[0]?.data || null,
        totalMovimentos: movs.length,
      })
      todosMov = todosMov.concat(movs)
    }
  })

  if (!instancias.length) return { erro: 'sem dados na base pública (processo novo, sigiloso ou não integrado)' }

  todosMov.sort((x, y) => (y.data || '').localeCompare(x.data || ''))

  // instância atual = a que tem o movimento mais recente (empate: instância mais alta)
  const peso = { '1º Grau': 1, 'Turma Recursal': 2, '2º Grau': 2, 'TST': 3, 'STJ': 3, 'STF': 4 }
  let atual = instancias[0]
  for (const inst of instancias) {
    const cmp = String(inst.ultimaMovimentacao || '').localeCompare(String(atual.ultimaMovimentacao || ''))
    if (cmp > 0 || (cmp === 0 && (peso[inst.instancia] || 0) > (peso[atual.instancia] || 0))) atual = inst
  }

  const g1 = instancias.find(i => i.instancia === '1º Grau') || atual

  return {
    numero,
    // compatibilidade com o fluxo de cadastro existente:
    classe: g1.classe || atual.classe || null,
    assunto: g1.assunto || atual.assunto || null,
    orgao: g1.orgao || atual.orgao || null,
    grau: atual.grau || null,
    dataAjuizamento: g1.dataAjuizamento || null,
    // novo — visão multi-instância:
    instanciaAtual: atual.instancia,
    orgaoAtual: atual.orgao || null,
    statusSugerido: 'Ativo ' + atual.instancia,
    instancias,
    andamentos: todosMov,
    totalAndamentos: todosMov.length,
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const numero = searchParams.get('numero')
  if (!numero) return Response.json({ erro: 'informe ?numero=' }, { status: 400 })
  const dados = await consultaDataJud(numero)
  const status = dados.erro ? 404 : 200
  return Response.json(dados, { status })
}
