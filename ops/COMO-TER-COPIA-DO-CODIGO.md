# Cópia de segurança do CÓDIGO — como ter a sua, sem depender de ninguém

> Escrito para leigo. Objetivo: se o Claude sumir, se uma senha for roubada,
> se o GitHub ficar inacessível — você ter, **no seu computador**, uma cópia
> completa de tudo o que foi construído.

## Primeiro, entenda: o sistema tem 3 partes, e cada uma mora num lugar

| Parte | O que é | Onde mora | Quem faz o backup |
|---|---|---|---|
| **Código** | As "receitas" do sistema (telas, robôs, chat) | GitHub (`djan-adv/cmpgestao`) | O próprio GitHub guarda todo o histórico — e os zips deste documento |
| **Banco de dados** | Processos, andamentos, contatos, agenda, mensagens do chat | Supabase | O script do VPS (`ops/COMO-CONFIGURAR-BACKUP.md`) — **atenção: em 05/08/2026 estava travado, nunca rodou** |
| **Documentos** | Petições, autos do jus.br, procurações (18 GB) | Disco do VPS (`/opt/cmpdocs`) | O mesmo script do VPS — **mesma atenção acima** |

**Um zip do código NÃO contém os processos nem os documentos.** Perder senha
do Claude/GitHub não perde dados de cliente; mas um problema no VPS/Supabase
sem o backup do documento acima funcionando, sim. As duas proteções são
independentes e as duas precisam existir.

## Jeito 1 — Baixar o código do GitHub a qualquer momento (2 cliques)

1. Entre em https://github.com/djan-adv/cmpgestao (com o seu login do GitHub)
2. Clique no botão verde **`<> Code`** → **Download ZIP**
3. Guarde o zip onde quiser (pendrive, HD externo, Google Drive pessoal)

Isso funciona hoje, amanhã e sempre — e pode repetir 1x por mês, por exemplo.
O zip baixado é o retrato fiel do sistema naquele dia.

## Jeito 2 — Os zips gerados em 12/08/2026 (pedido desta conversa)

Foram entregues no chat 3 arquivos para download:

| Arquivo | Conteúdo |
|---|---|
| `codigo-completo-cmpgestao_*.zip` | TODO o código do sistema de gestão (inclui o chat e a versão genérica) |
| `chat-cmpgestao_*.zip` | Só o chat, exatamente como roda hoje no escritório |
| `chat-generico_*.zip` | Chat "limpo", sem nada do escritório — para reutilizar ou vender (pasta `standalone/chat-generico/` deste repositório) |

Guarde os três em pelo menos **dois lugares diferentes** (ex.: computador do
escritório + um pendrive ou HD externo). Zip não vence: daqui a anos continua
abrindo.

## O que NUNCA está nos zips (de propósito)

As **senhas e chaves** (Supabase, e-mail, Cora, etc.) não ficam no código —
ficam no arquivo `.env.local` do VPS, que não entra no GitHub nem nos zips.
Isso é uma proteção: se um zip vazar, ninguém acessa nada com ele. O outro
lado da moeda: guarde uma cópia impressa/anotada das chaves do `.env.local`
num lugar físico seguro do escritório, porque sem elas uma reinstalação do
zero exige gerar tudo de novo nos painéis (Supabase, Cora, gov.br...).

## Se um dia precisar reconstruir o sistema a partir do zip

Qualquer programador (ou um agente de IA) consegue, com o zip em mãos:
`npm install` → preencher o `.env.local` com as chaves → `npm run build` →
`npm start`. O passo a passo do servidor completo está em
`ops/COMO-CONFIGURAR-BACKUP.md` e nos demais documentos da pasta `ops/`.
