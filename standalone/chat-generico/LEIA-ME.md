# Chat da Equipe — versão genérica (independente)

Este pacote é um **aplicativo de chat completo e independente**, extraído do
CMPGestão e **limpo de tudo que era específico do escritório**: não tem nomes,
senhas, cores personalizadas de usuários, vínculo com processos, regra de
férias nem qualquer dado. É um produto genérico, pronto para ser instalado em
qualquer empresa/equipe — ou vendido/licenciado.

## O que ele faz

- Conversa em **grupo** ("Todos") e conversas **privadas** entre duas pessoas
- **Responder** citando uma mensagem (como no WhatsApp)
- Envio de **imagens/prints** (botão 📷, ou colando a imagem no campo de texto)
- **Cor própria** por pessoa (botão 🎨)
- **Alarme no celular** (notificação push) mesmo com o app fechado —
  Android sempre; iPhone a partir do iOS 16.4, instalado na tela de início
- Mensagens privadas protegidas **no banco**: quem não participa da conversa
  não consegue lê-las nem pela API
- Visual estilo WhatsApp, feito para celular (mas funciona no computador)

## O que é preciso para colocar no ar (tudo tem plano gratuito)

1. Uma conta no **Supabase** (o "banco de dados" — guarda mensagens e logins)
2. Uma conta na **Vercel** (o "servidor" — deixa o site no ar), ou qualquer
   servidor que rode Next.js
3. **Node.js** instalado no computador de quem for fazer a instalação

## Instalação (passo a passo para quem for técnico)

1. **Supabase**: crie um projeto novo → abra o **SQL Editor** → cole o conteúdo
   do arquivo `banco.sql` → Run. Isso cria as tabelas, a segurança e a pasta
   de imagens de uma vez.
2. **Usuários**: no painel do Supabase → **Authentication → Users → Add user**,
   crie um usuário por pessoa (e-mail + senha). O nome que aparece no chat pode
   ser ajustado depois na tabela `usuarios` (coluna `nome`, pelo Table Editor).
3. **Chaves**: copie `.env.local.exemplo` para `.env.local` e preencha:
   - URL e chaves do Supabase (Project Settings → API)
   - chaves VAPID do alarme: rode `npx web-push generate-vapid-keys` e cole
     o resultado
4. **Rodar local** (teste): `npm install` e depois `npm run dev` →
   abra http://localhost:3000
5. **Publicar**: suba esta pasta para um repositório no GitHub e importe na
   Vercel. Cadastre as MESMAS variáveis do `.env.local` em
   Settings → Environment Variables. O push exige **https** — na Vercel já vem.
6. **Celular**: cada pessoa abre o endereço, faz login, toca em
   "🔕 ativar alarme" e (recomendado) usa "Adicionar à tela de início".

## Mapa dos arquivos

| Arquivo | O que é |
|---|---|
| `app/chat/page.jsx` | A tela do chat (todo o visual e o funcionamento) |
| `app/api/chat/push/route.js` | O alarme: guarda inscrições e dispara as notificações |
| `app/api/chat/print/route.js` | Recebe as imagens enviadas e guarda no Storage |
| `app/api/anexo/route.js` | Mostra/baixa uma imagem do chat (só para quem está logado) |
| `public/chat-sw.js` | O "vigia" que toca o alarme com o app fechado |
| `lib/supabase.js` | Conexão do navegador com o Supabase |
| `banco.sql` | Cria todas as tabelas e a segurança no Supabase |
| `.env.local.exemplo` | Modelo das chaves/senhas (copiar para `.env.local`) |

## O que foi retirado de propósito (em relação ao chat do CMPGestão)

- Vínculo de mensagem com **processo** (dependia das tabelas do sistema de gestão)
- Regra de **férias** (dependia da tela de Acessos/produtividade do CMPGestão)
- **Escritório** fixo no código e chaves guardadas em tabela interna
  (aqui tudo vem de variáveis de ambiente ou do `banco.sql`)
- Letras aumentadas em 50% (preferência da equipe do CMP) — aqui o tamanho é
  normal; para aumentar, mude o `const F = 1` no topo de `app/chat/page.jsx`
