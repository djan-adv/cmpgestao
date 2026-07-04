// API do CMPGestão — auto-preenchimento por número (roda no SERVIDOR).
// Recebe um número CNJ e consulta o DataJud (base pública do CNJ), devolvendo
// partes, classe, órgão e andamentos — para preencher o cadastro automaticamente,
// como o Astrea faz. Aqui NÃO há bloqueio de navegador: o servidor fala direto.
//
// Uso:  GET /api/processo?numero=0816640-57.2026.8.15.2001

export const dynamic = 'force-dynamic'

const KEY = 'APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='
const TJ  = {'26':'tjsp','15':'tjpb','05':'tjba','06':'tjce','17':'tjpe','20':'tjrn','16':'tjpr','25':'tjse','13':'tjmg','19':'tjrj','24':'tjsc','02':'tjal','08':'tjes','09':'tjgo'}
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

async function consultaDataJud(numero) {
  const dig = String(numero).replace(/\D/g, '')
  const a = alias(dig)
  if (!a) return { erro: 'tribunal não identificado pelo número' }
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${a}/_search`
  const body = { query: { match: { numeroProcesso: dig } } }
  let r
  for (let t = 0; t < 3; t++) {
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      break
    } catch (e) {
      if (t === 2) return { erro: 'timeout no DataJud' }
      await new Promise(res => setTimeout(res, 3000))
    }
  }
  if (!r || !r.ok) return { erro: 'processo não encontrado no DataJud' }
  const j = await r.json()
  const hit = j?.hits?.hits?.[0]
  if (!hit) return { erro: 'sem dados na base pública (processo novo, sigiloso ou não integrado)' }
  const s = hit._source
  const movimentos = (s.movimentos || [])
    .map(m => ({
      data: m.dataHora,
      texto: [m.nome, (m.complementosTabelados || []).map(c => c.nome).filter(Boolean).join('; ')].filter(Boolean).join(' — '),
    }))
    .sort((x, y) => (y.data || '').localeCompare(x.data || ''))
  return {
    numero,
    classe: s.classe?.nome || null,
    assunto: (s.assuntos || [])[0]?.nome || null,
    orgao: s.orgaoJulgador?.nome || null,
    grau: s.grau || null,
    dataAjuizamento: s.dataAjuizamento || null,
    andamentos: movimentos,
    totalAndamentos: movimentos.length,
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
