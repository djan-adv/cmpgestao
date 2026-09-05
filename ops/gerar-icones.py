from PIL import Image

ORIG = '/root/.claude/uploads/09245b62-85c9-5cf7-b23d-98aba31321a7/e7ad7897-image.jpg'
orig = Image.open(ORIG).convert('RGB')
W, H = orig.size
FUNDO = orig.getpixel((5, 5))

# a marca ocupa x 109..527, y 251..389 (medido) — centro do quadrado
CX, CY = W // 2, H // 2
LARG_MARCA = 527 - 109


def quadrado(margem_lateral):
    """recorte quadrado centrado, deixando `margem_lateral` (fração) de cada lado
    da marca; o vazio de cima e de baixo é do próprio fundo, então nada distorce"""
    lado = int(LARG_MARCA / (1 - 2 * margem_lateral))
    lado = min(lado, W, H)
    meio = lado // 2
    return orig.crop((CX - meio, CY - meio, CX - meio + lado, CY - meio + lado))


saidas = [
    # ícone do aplicativo: zoom leve — o canto arredondado do iPhone come as beiradas
    ('/home/user/cmpgestao/public/icone-cmp-512.png', 512, 0.09),
    ('/home/user/cmpgestao/public/apple-touch-icon.png', 180, 0.09),
    # aba do navegador: aparece com 16 a 32 px, então a marca precisa ocupar tudo
    ('/home/user/cmpgestao/public/favicon-cmp.png', 64, 0.04),
]
for caminho, lado, margem in saidas:
    im = quadrado(margem).resize((lado, lado), Image.LANCZOS)
    im.save(caminho, 'PNG', optimize=True)
    print('gravado', caminho, im.size, 'fundo', FUNDO)
