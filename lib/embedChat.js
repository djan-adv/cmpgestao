// HTML do chat público de captação (/cliente) embutido nos sites do
// escritório. Compartilhado por app/api/site-embed (inserção manual/em massa
// na home e nos posts existentes) e app/api/publicacoes (todo post NOVO
// publicado pelo sistema já sai com o chat, sem precisar rodar nada depois).
export const MARCA_EMBED_CHAT = 'gestao.cmpadvogados.com.br/cliente'

export const EMBED_CHAT_HTML = '<div style="max-width:480px;margin:50px auto;text-align:center;font-family:system-ui,-apple-system,sans-serif;padding:0 16px">'
  + '<h2 style="color:#2E3A4B;font-size:22px;margin:0 0 6px">Fale agora com o escritório</h2>'
  + '<p style="color:#697180;font-size:14px;margin:0 0 18px">Conte sua situação no chat abaixo — sem sair da página.</p>'
  + '<iframe src="https://' + MARCA_EMBED_CHAT + '" title="Chat com o escritório" style="width:100%;height:620px;border:0;border-radius:16px;box-shadow:0 10px 34px rgba(20,28,40,.18)" loading="lazy"></iframe>'
  + '</div>'

export const EMBED_CHAT_BLOCO_GUTENBERG = '\n<!-- wp:html -->\n' + EMBED_CHAT_HTML + '\n<!-- /wp:html -->\n'

// versão sem título/legenda (pra substituir um widget específico dentro de
// uma seção que já tem texto ao redor — ex.: um formulário quebrado) —
// altura configurável, já que o pedido foi "o dobro da altura" do padrão
export function embedChatHtmlSemTitulo(altura) {
  const h = Number(altura) > 0 ? Number(altura) : 620
  return '<iframe src="https://' + MARCA_EMBED_CHAT + '" title="Chat com o escritório" style="width:100%;max-width:480px;height:' + h + 'px;border:0;border-radius:16px;box-shadow:0 10px 34px rgba(0,0,0,.25);display:block;margin:0 auto" loading="lazy"></iframe>'
}

export function detectarConstrutorWP(html) {
  const h = String(html || '')
  if (/<!--\s*wp:/i.test(h)) return 'gutenberg'
  if (/elementor|data-elementor/i.test(h)) return 'elementor'
  if (/et_pb_section|et_pb_row/i.test(h)) return 'divi'
  if (h.trim().length < 20) return 'vazio_ou_construtor_externo'
  return 'classico'
}
