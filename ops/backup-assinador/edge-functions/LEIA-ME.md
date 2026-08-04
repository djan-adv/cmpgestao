# Código das 7 edge functions do projeto do assinador

Backup do código-fonte das edge functions de `fjboytucivmdykkfpdhs`, tirado em
04/08/2026 como parte do **passo 1** de `ops/MIGRACAO-ASSINADOR.md`.

Fica no repositório (e não no VPS, como o resto do backup) porque é código: não
tem dado de cliente, o GitHub já é o backup natural do código, e é daqui que sai
o deploy do **passo 6**.

## O que foi salvo

| Função | Arquivo | Versão na origem |
|---|---|---|
| `enviar-email` | `enviar-email/index.ts` | 9 |
| `enviar-confirmacao` | `enviar-confirmacao/index.ts` | 1 |
| `enviar-copia-assinada` | `enviar-copia-assinada/index.ts` | 3 |
| `enviar-lembretes` | `enviar-lembretes/index.ts` | 2 |
| `finalizar-documento` | `finalizar-documento/index.ts` | 3 |
| `ver-documento` | `ver-documento/index.ts` | 1 |
| `app` | **não recuperado** — ver abaixo | 6 |

## A função `app` não pôde ser baixada

A API da Supabase responde `Failed to retrieve function bundle` para ela (duas
tentativas). Ela é a única das 7 que aparece na listagem **sem**
`entrypoint_path` e **sem** `ezbr_sha256`, o que indica um deploy em formato
antigo que o painel já não consegue servir. Foi implantada em 02/07/2026 e nunca
mais atualizada — as outras seis têm deploys posteriores.

O que se sabe sobre ela, sem o código:

- **Nada no CMPGestão a chama.** Não há nenhuma referência a `functions/v1/app`
  em todo o repositório.
- O bucket público `app` guarda `assinar.html`, `config.js` e `painel.html` —
  as telas do site antigo. A hipótese mais provável é que a função `app` servia
  essas páginas estáticas a partir do bucket.

**Decisão pendente para o passo 6.** O plano previa renomeá-la para
`assinatura-app`. Sem o bundle, não há o que redeployar. Como o passo 0 decidiu
desligar o site antigo com redirect 301 para `/assinar`, a recomendação é
**não migrar a `app`** e registrar que o código dela se perdeu junto com o
projeto. Se for para mantê-la, o código tem de ser reescrito do zero — e isso
precisa acontecer **antes** do passo 11, porque depois não há de onde tirar.

Os 3 arquivos do bucket `app` continuam no backup do VPS (em
`storage/app/`), então as **telas** estão preservadas mesmo sem a função.

## Secrets — não estão em backup nenhum

O código depende destas variáveis, que a Supabase não deixa ler depois de
salvas. Elas precisam ser recriadas no projeto do Gestão no passo 6, senão as
funções sobem e falham no envio:

```
SMTP_HOSTNAME     (padrão no código: smtp.hostinger.com)
SMTP_PORT         (padrão no código: 465)
SMTP_USERNAME
CMP_EMAIL_PASS    ← sem padrão; sem ela nenhum e-mail sai
OFFICE_EMAIL      (padrão no código: contato@cmpadvogados.com.br)
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas pela própria Supabase
em toda edge function — essas não precisam ser recriadas à mão.

## Ao redeployar no projeto do Gestão (passo 6)

Três ajustes que o código exige, além do deploy:

1. **`enviar-lembretes`** tem o link do site antigo fixo no código
   (`https://djan.app.br/link/assinar.html?d=…&s=…`). Trocar pela URL do
   Gestão (`/assinar` e `/assinar-doc`).
2. **A URL do logo** (`https://djan.app.br/link/cmp-logo.png`) aparece em
   `enviar-email`, `enviar-confirmacao`, `enviar-copia-assinada`,
   `enviar-lembretes` e `finalizar-documento`. Cosmético, mas quebra a imagem
   dos e-mails se o site antigo sair do ar de vez.
3. **As tabelas passam a viver no schema `assinatura`.** Todas as funções usam
   `admin.from("signatarios")` / `.from("documentos")` / `.from("eventos_auditoria")`,
   que apontam para `public` por padrão. Ou se usa `.schema("assinatura")` nas
   chamadas, ou se expõe o schema `assinatura` na configuração de API do projeto
   — decidir no passo 6 e aplicar nas 6 funções.
