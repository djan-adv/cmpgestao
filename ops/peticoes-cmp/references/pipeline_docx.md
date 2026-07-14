# Pipeline de geração do .docx (preservando timbre)

Objetivo: gerar a peça em Word mantendo timbre, marca d'água e rodapé do escritório,
e permitindo embutir imagens-prova destacadas.

## Visão geral
1. **Unpack** do `assets/template_cmp.docx` (descompacta o .docx em XML/partes).
2. **Reconstruir só o corpo** (`<w:body>`): preserve o *prefixo* (cabeçalho do
   `<w:document>` com os namespaces e o `<w:body>`) e o `<w:sectPr>` (que carrega as
   referências de header/footer e o tamanho de página). Injete apenas os parágrafos
   novos entre o prefixo e o `<w:sectPr>`.
3. **Limpar imagens herdadas** do template que não interessam (remova relationships e
   arquivos de mídia órfãos), mantendo as do timbre (logo/marca/rodapé, referenciadas
   pelos headers/footers).
4. **Repack** preservando as partes originais (no ambiente Claude, use o
   `pack.py` do skill de docx).
5. **Renderizar PDF** (LibreOffice headless) e **rasterizar** para QA visual.

## Helper de construção
`scripts/build_peticao.py` traz funções utilitárias (run/para/H/SUB/P/CITE/QUOTE/
CALLOUT/LI) que ramificam por modo (tradicional × legal design) e montam o
`document.xml`. Ajuste os blocos de conteúdo ao caso. É um ponto de partida — adapte
caminhos do template e do empacotador ao ambiente em que rodar.

## Embutir imagem-prova (inline)
- Copie a imagem para `word/media/imageN.png`.
- Adicione um relationship em `word/_rels/document.xml.rels`
  (`Type=.../image`, `Target="media/imageN.png"`).
- Insira um `<w:drawing>` *inline* no parágrafo, referenciando `r:embed="rIdN"`.
- **Atenção aos namespaces**: o template pode não declarar `xmlns:a` (drawingml main)
  e `xmlns:pic` (picture) na raiz. Declare-os **inline** nos elementos `<a:graphic>` e
  `<pic:pic>` do drawing.
- Para destacar a prova (ex.: anotação relevante), pré-processe a imagem (recorte +
  retângulo/realce com PIL) antes de embutir, e acrescente uma legenda em itálico menor.

## QA antes de entregar
- Timbre/logo/rodapé presentes; marca d'água ok.
- Grifos e caixas (legal design) renderizando.
- Imagem-prova nítida e destacada.
- Bloco de assinatura íntegro (não quebrado entre páginas — use `keepNext/keepLines`).
- Conferir valor da causa, datas e dados (todos de documentos).
