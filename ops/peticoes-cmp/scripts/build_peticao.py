# -*- coding: utf-8 -*-
"""
build_peticao.py — utilitários de montagem de peças .docx no padrão CMP.

Dois modos: tradicional (padrão) e "design" (legal design).
Uso típico:
  1) Descompacte o template (assets/template_cmp.docx) numa pasta `unpacked/`.
  2) Monte a lista `body` com os helpers (H/SUB/P/CITE/QUOTE/CALLOUT/LI).
  3) Injete no document.xml preservando prefixo + sectPr (ver assemble()).
  4) Empacote de volta e renderize um PDF para QA.

Este arquivo é um PONTO DE PARTIDA: adapte os caminhos do template/empacotador ao
ambiente em que rodar (Claude.ai com execução de código, Claude Code, etc.).
"""
import re

# ---- estilo ----
DESIGN = False  # vire para True para gerar a versão legal design
NAVY, LIGHT, HLY, RULE = "2E3A4B", "EEF1F5", "FFF1A8", "C7D0DA"
FONT = '<w:rFonts w:ascii="Barlow" w:eastAsia="Barlow" w:hAnsi="Barlow" w:cs="Barlow"/>'

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def run(text, b=False, i=False, u=False, size=24, color=None, hl=False):
    rpr = FONT + f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    if b: rpr += "<w:b/>"
    if i: rpr += "<w:i/>"
    if u: rpr += '<w:u w:val="single"/>'
    if color: rpr += f'<w:color w:val="{color}"/>'
    if hl: rpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{HLY}"/>'
    return f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'

def grif(text):
    """Grifo: negrito+sublinhado (tradicional) | negrito+realce (design)."""
    return run(text, b=True, u=not DESIGN, hl=DESIGN)

def _pPr(first=709, jc="both", before=0, after=240, line=360, left=None, right=None,
         shd=None, border=None, keep=False):
    p = "<w:pPr>"
    if border:  # ('full'|'left'|'bottom', cor, sz)
        kind, col, sz = border
        b = ""
        if kind in ("full", "left"):
            b += f'<w:left w:val="single" w:sz="{sz}" w:space="10" w:color="{col}"/>'
        if kind == "full":
            b += (f'<w:top w:val="single" w:sz="6" w:space="6" w:color="{col}"/>'
                  f'<w:bottom w:val="single" w:sz="6" w:space="6" w:color="{col}"/>'
                  f'<w:right w:val="single" w:sz="6" w:space="6" w:color="{col}"/>')
        if kind == "bottom":
            b = f'<w:bottom w:val="single" w:sz="{sz}" w:space="4" w:color="{col}"/>'
        p += f"<w:pBdr>{b}</w:pBdr>"
    if shd:
        p += f'<w:shd w:val="clear" w:color="auto" w:fill="{shd}"/>'
    p += f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'
    ind = ""
    if left is not None: ind += f'w:left="{left}" '
    if right is not None: ind += f'w:right="{right}" '
    if first: ind += f'w:firstLine="{first}" '
    if ind: p += f'<w:ind {ind.strip()}/>'
    p += f'<w:jc w:val="{jc}"/>'
    if keep: p += "<w:keepNext/><w:keepLines/>"
    return p + "</w:pPr>"

def para(runs, **kw):
    if isinstance(runs, str): runs = [run(runs)]
    return f"<w:p>{_pPr(**kw)}{''.join(runs)}</w:p>"

# ---- blocos semânticos ----
def P(x, **kw):
    return para([run(x)] if isinstance(x, str) else x, **kw)

def TITLE(t):
    return para([run(t, b=True)], first=0, jc="center", before=180, after=180)

def H(t):
    if DESIGN:
        return para([run(t, b=True, color="FFFFFF")], first=0, jc="left",
                    before=260, after=140, line=276, shd=NAVY, keep=True)
    return para([run(t, b=True)], first=0, before=240, after=120, keep=True)

def SUB(t):
    if DESIGN:
        return para([run(t, b=True, size=23, color=NAVY)], first=0, before=180,
                    after=90, border=("bottom", RULE, 6), keep=True)
    return para([run(t, b=True)], first=0, before=160, after=90, keep=True)

def CITE(t):
    if DESIGN:
        return para([run(t, i=True, size=22)], first=0, left=482, after=140, line=260,
                    shd="F6F8FB", border=("left", NAVY, 18))
    return para([run(t, i=True, size=22)], first=0, left=2268, after=120, line=240)

def QUOTE(runs):
    """Bloco de ementa; use grif() nos trechos on-point."""
    if DESIGN:
        return para(runs, first=0, left=300, right=200, after=140, line=252,
                    shd=LIGHT, border=("left", NAVY, 24))
    return para(runs, first=0, left=2268, after=140, line=240)

def CALLOUT(x):
    runs = [run(x, b=True)] if isinstance(x, str) else x
    if DESIGN:
        return para(runs, first=0, after=160, line=288, shd="FBF7E6",
                    border=("left", "C9A227", 24))
    return para(runs, first=0, after=160)

def LI(label, x):
    runs = [run(label + " ", b=True)] + ([run(x)] if isinstance(x, str) else x)
    return para(runs, first=0, left=709, after=120)

# ---- imagem-prova inline (rId livre -> media/imageN.png) ----
def drawing(rid="rId8", cx=4937760, cy=2401440, did=77, name="PROVA"):
    A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    P_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
    return (
      '<w:p><w:pPr><w:spacing w:before="80" w:after="60" w:line="240" w:lineRule="auto"/>'
      '<w:jc w:val="center"/></w:pPr><w:r><w:rPr>' + FONT + '</w:rPr><w:drawing>'
      '<wp:inline distT="0" distB="0" distL="0" distR="0">'
      f'<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
      f'<wp:docPr id="{did}" name="{name}"/>'
      f'<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="{A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      f'<a:graphic xmlns:a="{A_NS}"><a:graphicData uri="{P_NS}">'
      f'<pic:pic xmlns:pic="{P_NS}"><pic:nvPicPr><pic:cNvPr id="{did}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
      f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )

def assemble(template_document_xml, body_blocks):
    """Recebe o document.xml do template e a lista de blocos; devolve o XML final,
    preservando o prefixo (até <w:body>) e o <w:sectPr> do template."""
    xml = template_document_xml
    prefix = xml[: xml.find("<w:body>") + len("<w:body>")]
    sectpr = re.search(r"<w:sectPr.*?</w:sectPr>", xml, re.S).group(0)
    return prefix + "".join(body_blocks) + sectpr + "</w:body></w:document>"

# ---- exemplo mínimo ----
if __name__ == "__main__":
    body = [
        H("SÍNTESE DA DEMANDA"),
        P("Resumo executivo do que se pede, contra quem e por quê..."),
        CALLOUT("Pede-se, em resumo: (i) ...; (ii) ...; (iii) ..."),
        H("I – DOS FATOS"),
        P("Em [data], ... (narrativa cronológica)."),
        H("II – DO DIREITO"),
        SUB("II.1 – Da relação de consumo"),
        P("Discute-se ... A regra é ... No caso ... Logo, ..."),
        QUOTE([run("EMENTA: ... ", size=22), grif("trecho on-point grifado"),
               run(" ... (Tribunal, classe nº, relator, publicado em DD/MM/AAAA).", size=22)]),
    ]
    print("\n".join(body))
