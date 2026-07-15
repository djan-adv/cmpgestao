# Módulo Assinaturas — assinador de documentos dentro do CMPGestão

O assinador que rodava só em `djan.app.br/link/` (HTML estático) agora também vive
dentro do CMPGestão, como módulo. **Os dois convivem**: usam o MESMO banco
(projeto Supabase `fjboytucivmdykkfpdhs` — separado do banco do CMPGestão,
`ndeqlyrydcijbgjiviuw`). Um documento criado em um aparece no outro.
Nada foi alterado no banco nem nas edge functions.

## Rotas

| Rota | O que é | Origem (site antigo) | Login |
|---|---|---|---|
| `/assinatura` | Gerar procuração + link | `index.html` | CMPGestão |
| `/assinatura/avulso` | PDF/Word/imagem p/ até 30 signatários | `avulso.html` | CMPGestão |
| `/assinatura/painel` | Painel: status, trilha, ações | `admin.html` | CMPGestão |
| `/assinar?d=…&s=…` | Cliente assina a procuração | `assinar.html` | público (token) |
| `/assinar-doc?d=…&s=…` | Cliente assina documento avulso | `assinar-doc.html` | público (token) |
| `/assinar/confirmar?d=…&s=…` | Dupla verificação por e-mail | `confirmar.html` | público (token) |

Atalhos no sistema (`public/sistema.html`):
- menu lateral **✍ Assinaturas** (entre Comercial e Contatos);
- ficha do processo → botão **✍ Procuração** (abre com o cliente preenchido);
- contato do CRM → botão **✍ Procuração** (abre com nome/e-mail/telefone).

## Arquitetura (por que tem uma API no meio)

- As telas **públicas** falam direto com o Supabase do assinador (chave publishable,
  RPCs por token) — exatamente como o site antigo.
- As telas **internas** usam o login do CMPGestão. Como as RPCs de admin do assinador
  (`admin_listar_documentos` etc.) só aceitam o login DAQUELE projeto (`is_admin()`
  compara o e-mail do JWT), o painel passa por `/api/assinatura` (POST), que valida a
  sessão do CMPGestão e opera o banco do assinador com a chave secreta, no servidor.
  Qualquer conta logada no CMPGestão pode usar o módulo.

Arquivos: `lib/supabaseAssinatura.js` (cliente público), `lib/assinaturaApi.js`
(chamadas à API interna), `app/api/assinatura/route.js` (API), páginas em
`app/assinatura/*` e `app/assinar*`.

## Para ativar em produção (checklist do deploy)

1. **Variável na Vercel** (obrigatória para o painel/gerar): adicionar
   `SIGN_SUPABASE_SERVICE_ROLE_KEY` = *service_role key* do projeto
   `fjboytucivmdykkfpdhs` (Supabase → Project Settings → API keys → service_role).
   Sem ela, as telas públicas funcionam, mas o painel interno responde com erro claro.
2. (Opcional) `NEXT_PUBLIC_SIGN_SUPABASE_URL` e `NEXT_PUBLIC_SIGN_SUPABASE_ANON_KEY`
   — já têm os valores públicos corretos como padrão no código; só definir se um dia
   as chaves forem trocadas.
3. Redeploy.

## Coexistência com djan.app.br/link (URLs nas edge functions)

- `enviar-email` e `enviar-confirmacao` recebem o link de quem chama → o site antigo
  continua mandando links `djan.app.br/link/...` e o módulo manda links do CMPGestão.
  **Nenhuma mudança necessária.**
- `enviar-lembretes` tem o link FIXO no código (`https://djan.app.br/link/assinar.html?d=…&s=…`).
  Os lembretes continuam levando ao site antigo (que segue funcionando). Se um dia
  quisermos que apontem ao CMPGestão, é trocar essa base de URL e fazer deploy da function.
- A URL do logo dos e-mails (`https://djan.app.br/link/cmp-logo.png`) aparece em
  4 functions — cosmético, sem pressa.

## Pendências conhecidas

- Marca d'água e timbre da procuração usam `public/logo_cmp_full.png`. Se quiser a
  marca d'água exata do site antigo, copiar `cmp-marca.png` e `cmp-logo.png` para
  `public/` e trocar as referências em `app/assinar/page.jsx`.
- Upload de avulso: PDF entra direto; Word/imagem são convertidos no navegador
  (bibliotecas via CDN, como no site antigo).
