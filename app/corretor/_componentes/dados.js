// Leitura de dados públicos direto do banco (mesma conexão restrita ao schema
// `imoveis`, role imoveis_app — sem passar por HTTP, é tudo servidor).
//
// Enquanto IMOVEIS_DB_URL não estiver configurada na VPS (falta credencial/infra —
// ver ops/PROJETO-CORRETOR-IMOVEIS.md), as funções abaixo caem num valor padrão em
// vez de derrubar a página, pra dar pra revisar o site antes do banco estar no ar.

import { q, q1 } from '../../api/imoveis/lib.js'

export const PERFIL_PADRAO = {
  nome: 'Djan',
  titulo: 'Corretor e Avaliador de Imóveis',
  creci: '5401',
  cnai: '8514',
  bio: 'Corretor de imóveis e avaliador, atuando com imóveis próprios, parcerias com outros corretores e avaliação de imóveis.',
  telefone: null,
  whatsapp: null,
  email: 'djan@creci.org.br',
  instagram: null,
  foto_url: null,
}

export async function buscarPerfil() {
  try {
    const p = await q1('select * from imoveis.perfil where id = 1')
    return p || PERFIL_PADRAO
  } catch (e) {
    return PERFIL_PADRAO
  }
}

export async function buscarImoveis({ tipo, destaque } = {}) {
  try {
    const cond = ["status = 'ativo'"]
    const params = []
    if (tipo === 'proprio' || tipo === 'parceria') { params.push(tipo); cond.push(`tipo = $${params.length}`) }
    if (destaque) cond.push('destaque = true')
    return await q(`select * from imoveis.imoveis where ${cond.join(' and ')} order by destaque desc, criado_em desc`, params)
  } catch (e) {
    return []
  }
}

export async function buscarImovel(id) {
  try {
    return await q1('select * from imoveis.imoveis where id = $1', [id])
  } catch (e) {
    return null
  }
}

export async function buscarAnuncios() {
  try {
    return await q('select * from imoveis.anuncios where ativo = true order by criado_em desc')
  } catch (e) {
    return []
  }
}

export async function buscarTermo() {
  try {
    return await q1('select versao, texto, atualizado_em from imoveis.termo where id = 1')
  } catch (e) {
    return { versao: 'v1', texto: '' }
  }
}
