// HTML do chat público de captação (/cliente) embutido nos sites do
// escritório, e a função que desfaz essa inserção — usados por
// app/api/site-embed (inserir/remover, manual ou em massa, na home e nos
// posts existentes). Posts novos NÃO saem mais com o chat automaticamente
// (desligado a pedido do dono, 24/08/2026 — leads saindo com dado ruim).
export const MARCA_EMBED_CHAT = 'gestao.cmpadvogados.com.br/cliente'

// altura em clamp(mínimo, %vh, máximo) — sem media query: no celular a caixa
// encolhe pra caber na tela de verdade (dvh já desconta a barra de
// endereço/abas do navegador, ao contrário de vh puro), no desktop respeita
// o teto. O chat por dentro já usa 100dvh, então ele preenche certinho
// qualquer altura que a caixa acabar tendo, sem sobra nem corte.
function _alturaResponsiva(maxima) {
  const teto = Number(maxima) > 0 ? Number(maxima) : 620
  const piso = Math.min(480, teto)
  return 'clamp(' + piso + 'px, 75dvh, ' + teto + 'px)'
}

export const EMBED_CHAT_HTML = '<div style="max-width:480px;margin:clamp(24px,6vw,50px) auto;text-align:center;font-family:system-ui,-apple-system,sans-serif;padding:0 16px">'
  + '<h2 style="color:#2E3A4B;font-size:22px;margin:0 0 6px">Fale agora com o escritório</h2>'
  + '<p style="color:#697180;font-size:14px;margin:0 0 18px">Conte sua situação no chat abaixo — sem sair da página.</p>'
  + '<iframe src="https://' + MARCA_EMBED_CHAT + '" title="Chat com o escritório" style="width:100%;height:' + _alturaResponsiva(620) + ';border:0;border-radius:16px;box-shadow:0 10px 34px rgba(20,28,40,.18);display:block" loading="lazy"></iframe>'
  + '</div>'

export const EMBED_CHAT_BLOCO_GUTENBERG = '\n<!-- wp:html -->\n' + EMBED_CHAT_HTML + '\n<!-- /wp:html -->\n'

// versão sem título/legenda (pra substituir um widget específico dentro de
// uma seção que já tem texto ao redor — ex.: um formulário quebrado) —
// altura máxima configurável (o pedido original foi "o dobro da altura" do
// padrão), mas sempre encolhendo no celular via clamp()
export function embedChatHtmlSemTitulo(altura) {
  return '<iframe src="https://' + MARCA_EMBED_CHAT + '" title="Chat com o escritório" style="width:100%;max-width:480px;height:' + _alturaResponsiva(altura) + ';border:0;border-radius:16px;box-shadow:0 10px 34px rgba(0,0,0,.25);display:block;margin:0 auto" loading="lazy"></iframe>'
}

// Tira o embed do chat de um conteúdo (home ou post).
//
// A primeira versão só casava texto IDÊNTICO ao que a inserção colou — e falhou
// na prática (25/08/2026): o WordPress reescreve o HTML ao salvar (aspas,
// espaços, quebras de linha, wpautop), então o bloco no banco não é byte a byte
// o que saiu daqui. O botão dizia "não achei o bloco exato" com o chat bem ali.
//
// Agora a remoção é por PADRÃO, em camadas, da mais específica para a mais
// solta — e todas ancoradas na MARCA (a URL do chat), então nada que não seja
// o embed é tocado:
//   1. bloco Gutenberg <!-- wp:html --> … marca … <!-- /wp:html -->
//   2. o <div> embrulho do embed (sem <div> aninhado dentro, que é o nosso caso)
//   3. o <iframe> solto, se o embrulho já tiver sido desfeito à mão
//   4. o título/legenda órfãos que sobrariam de um embrulho desmontado
export function removerEmbedDoConteudo(conteudo) {
  const c = String(conteudo || '')
  if (!c.includes(MARCA_EMBED_CHAT)) return { conteudo: c, mudou: false }
  const marca = MARCA_EMBED_CHAT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // "sem <div> no meio": impede que o casamento engula a página inteira quando
  // o embed estiver dentro de outras seções
  const semDiv = '(?:(?!<\\/?div\\b)[\\s\\S])*?'
  let novo = c
    // 1) bloco Gutenberg inteiro
    .replace(new RegExp('<!--\\s*wp:html\\s*-->[\\s\\S]*?' + marca + '[\\s\\S]*?<!--\\s*\\/wp:html\\s*-->', 'gi'), '')
    // 2) o div embrulho
    .replace(new RegExp('<div\\b[^>]*>' + semDiv + marca + semDiv + '<\\/div>', 'gi'), '')
    // 3) iframe solto
    .replace(new RegExp('<iframe\\b[^>]*' + marca + '[^>]*>\\s*<\\/iframe>', 'gi'), '')
    // 4) título e legenda que acompanham o embed, se ficaram órfãos
    .replace(/<h2\b[^>]*>\s*Fale agora com o escritório\s*<\/h2>/gi, '')
    .replace(/<p\b[^>]*>\s*Conte sua situação no chat abaixo[^<]*<\/p>/gi, '')
    // parágrafos/divs que sobraram vazios por causa da remoção
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
  return { conteudo: novo, mudou: novo !== c }
}

export function detectarConstrutorWP(html) {
  const h = String(html || '')
  if (/<!--\s*wp:/i.test(h)) return 'gutenberg'
  if (/elementor|data-elementor/i.test(h)) return 'elementor'
  if (/et_pb_section|et_pb_row/i.test(h)) return 'divi'
  if (h.trim().length < 20) return 'vazio_ou_construtor_externo'
  return 'classico'
}
