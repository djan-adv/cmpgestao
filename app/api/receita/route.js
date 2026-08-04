// Ficha da Receita Federal a partir do CNPJ — é o que permite abrir um caso
// completo tendo só o documento do cliente.
//
//   GET /api/receita?doc=33.000.167/0001-01     → ficha normalizada + bruto
//   GET /api/receita?doc=33000167000101&cru=1   → só o retorno cru da fonte
//
// Duas fontes, na ordem: BrasilAPI e Minha Receita. As duas leem a MESMA base
// pública da Receita e não pedem cadastro nem chave; a segunda existe porque a
// primeira tem limite por minuto e cai de vez em quando. Se as duas falharem, o
// erro volta dizendo qual foi o motivo de cada uma — sem isso, "não achei" tanto
// pode ser CNPJ inexistente quanto fonte fora do ar, e são problemas diferentes.
//
// CPF não entra aqui de propósito: NÃO existe consulta pública que devolva o nome
// a partir de um CPF (a Receita exige data de nascimento e captcha). Pedir CPF
// aqui só produziria erro; quem tem CPF informa o nome na mão.

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 30

const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'

function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, '') }

// Dígito verificador do CNPJ. Vale a conta antes de sair na rede: CNPJ digitado
// errado é o caso comum, e assim o erro sai na hora, com a causa certa.
function cnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const calc = (base, pesos) => {
    const soma = base.reduce((acc, n, i) => acc + n * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const n = d.split('').map(Number)
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  return calc(n.slice(0, 12), p1) === n[12] && calc(n.slice(0, 13), p2) === n[13]
}

function fmtCNPJ(d) {
  return /^\d{14}$/.test(d)
    ? d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12)
    : d
}

// Pega o primeiro campo que existir. As duas fontes usam nomes parecidos mas não
// iguais, e nomes mudam com o tempo — tentar uma lista evita ficha meio vazia por
// causa de um campo renomeado.
function pega(o, nomes, padrao) {
  for (const n of nomes) {
    const v = o && o[n]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return padrao === undefined ? null : padrao
}

function telefone(o) {
  const t = [pega(o, ['ddd_telefone_1', 'telefone1', 'telefone']), pega(o, ['ddd_telefone_2', 'telefone2'])]
    .filter(Boolean).map(x => String(x).trim())
  return t.length ? t : null
}

function endereco(o) {
  const p = [
    [pega(o, ['descricao_tipo_de_logradouro', 'tipo_logradouro']), pega(o, ['logradouro'])].filter(Boolean).join(' '),
    pega(o, ['numero']),
    pega(o, ['complemento']),
    pega(o, ['bairro']),
    [pega(o, ['municipio', 'cidade']), pega(o, ['uf'])].filter(Boolean).join('/'),
    pega(o, ['cep']) ? ('CEP ' + String(pega(o, ['cep'])).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2')) : null,
  ].filter(x => x && String(x).trim())
  return p.length ? p.join(', ') : null
}

function socios(o) {
  const qsa = pega(o, ['qsa', 'socios'], []) || []
  if (!Array.isArray(qsa)) return []
  return qsa.map(s => ({
    nome: pega(s, ['nome_socio', 'nome', 'nome_representante_legal']),
    qualificacao: pega(s, ['qualificacao_socio', 'descricao_qualificacao_socio', 'qual']),
    entrada: pega(s, ['data_entrada_sociedade', 'data_entrada']),
    faixaEtaria: pega(s, ['faixa_etaria', 'descricao_faixa_etaria']),
  })).filter(s => s.nome)
}

function cnaesSecundarios(o) {
  const l = pega(o, ['cnaes_secundarios', 'cnaes_secundarias'], []) || []
  if (!Array.isArray(l)) return []
  return l.map(c => ({ codigo: pega(c, ['codigo', 'cnae']), descricao: pega(c, ['descricao', 'texto']) }))
    .filter(c => c.codigo || c.descricao)
}

function normaliza(o, fonte) {
  const doc = soDigitos(pega(o, ['cnpj', 'estabelecimento'], '')) || null
  return {
    fonte,
    documento: doc,
    documentoFmt: doc ? fmtCNPJ(doc) : null,
    razaoSocial: pega(o, ['razao_social', 'nome_empresarial', 'nome']),
    nomeFantasia: pega(o, ['nome_fantasia', 'fantasia']),
    situacao: pega(o, ['descricao_situacao_cadastral', 'situacao_cadastral', 'situacao']),
    situacaoEm: pega(o, ['data_situacao_cadastral', 'data_situacao']),
    situacaoMotivo: pega(o, ['descricao_motivo_situacao_cadastral', 'motivo_situacao_cadastral']),
    abertura: pega(o, ['data_inicio_atividade', 'data_inicio_ativididade', 'abertura']),
    porte: pega(o, ['porte', 'descricao_porte']),
    naturezaJuridica: pega(o, ['natureza_juridica', 'descricao_natureza_juridica', 'codigo_natureza_juridica']),
    capitalSocial: pega(o, ['capital_social']),
    matrizFilial: pega(o, ['descricao_identificador_matriz_filial', 'identificador_matriz_filial']),
    simples: pega(o, ['opcao_pelo_simples']),
    mei: pega(o, ['opcao_pelo_mei']),
    cnaePrincipal: {
      codigo: pega(o, ['cnae_fiscal', 'cnae_fiscal_codigo']),
      descricao: pega(o, ['cnae_fiscal_descricao', 'atividade_principal_descricao']),
    },
    cnaesSecundarios: cnaesSecundarios(o),
    endereco: endereco(o),
    municipio: pega(o, ['municipio', 'cidade']),
    uf: pega(o, ['uf']),
    cep: pega(o, ['cep']),
    telefones: telefone(o),
    email: pega(o, ['email', 'correio_eletronico']),
    socios: socios(o),
  }
}

async function busca(url, fonte, doc) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000) })
  const txt = await r.text()
  if (!r.ok) {
    // 404 é resposta legítima: o CNPJ não existe na base. Vale distinguir de
    // "fonte fora do ar", senão o usuário fica procurando erro de digitação.
    const e = new Error(r.status === 404 ? 'CNPJ não encontrado na base da Receita' : ('HTTP ' + r.status))
    e.status = r.status
    throw e
  }
  let j
  try { j = JSON.parse(txt) } catch (e) { throw new Error('resposta não era JSON') }
  if (!j || (!j.cnpj && !j.razao_social && !j.nome)) throw new Error('resposta sem os campos da Receita')
  return { normal: normaliza(j, fonte), cru: j }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const doc = soDigitos(searchParams.get('doc') || '')

  if (!doc) return Response.json({ erro: 'informe ?doc=<CNPJ>' }, { status: 400 })
  if (doc.length === 11) {
    return Response.json({
      erro: 'CPF não tem consulta pública que devolva o nome — a Receita exige data de nascimento e captcha. Informe o nome do cliente à mão.',
      tipo: 'cpf',
    }, { status: 422 })
  }
  if (doc.length !== 14) return Response.json({ erro: 'CNPJ precisa ter 14 dígitos (veio ' + doc.length + ')' }, { status: 400 })
  if (!cnpjValido(doc)) return Response.json({ erro: 'CNPJ inválido — confira os dígitos' }, { status: 400 })

  const fontes = [
    { nome: 'BrasilAPI', url: 'https://brasilapi.com.br/api/cnpj/v1/' + doc },
    { nome: 'Minha Receita', url: 'https://minhareceita.org/' + doc },
  ]

  const falhas = []
  for (const f of fontes) {
    try {
      const { normal, cru } = await busca(f.url, f.nome, doc)
      if (searchParams.get('cru')) return Response.json({ ok: true, fonte: f.nome, cru })
      return Response.json({ ok: true, ficha: normal, cru, tentativas: falhas })
    } catch (e) {
      falhas.push({ fonte: f.nome, erro: String((e && e.message) || e) })
      // CNPJ inexistente é a mesma resposta em qualquer fonte: não adianta insistir
      if (e && e.status === 404) break
    }
  }

  return Response.json({ erro: 'não consegui consultar a Receita', tentativas: falhas }, { status: 502 })
}
