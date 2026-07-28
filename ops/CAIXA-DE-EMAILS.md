# Caixa de e-mails — respostas caindo no histórico do processo

O que a vara, o cartório ou o cliente responde volta para dentro do sistema: o robô
lê a caixa `contato@cmpadvogados.com.br` por IMAP e lança cada resposta **no
histórico do processo** que ela responde. Dá para responder de lá mesmo, sem abrir
o webmail.

## Como a resposta acha o processo

Nesta ordem, e só isso — o sistema não chuta:

1. **Conversa (`thread`)** — todo e-mail que sai leva uma raiz de `References`
   própria (`<cmp-thread-…@cmpadvogados.com.br>`), guardada em `email_threads` com o
   número do processo. A resposta devolve essa raiz. É o caminho exato: funciona
   mesmo que o servidor não escreva o número em lugar nenhum.
2. **Número CNJ** — aparece no assunto ou no corpo e bate com um processo nosso.
3. **Contato da vara** — o remetente é o e-mail cadastrado do órgão **e** só há um
   processo nosso com ele. Havendo dois ou mais, não decide.

**O que não casa não entra no histórico de ninguém.** Fica na caixa, marcado como
**sem processo**, para você vincular à mão. Um e-mail parado é problema pequeno; um
e-mail no processo errado é problema grande.

## Onde ver

- **Menu esquerdo → ✉ E-mails** — a caixa, com o contador de não lidas.
  Filtros: *Todas*, *Não lidas*, *Sem processo*.
- **Histórico do processo** — a resposta aparece como
  `[E-mail recebido — resposta]`, com o texto já aberto na tela (não precisa clicar)
  e um botão **✉ responder** ao lado.

## Responder

O botão **✉ responder** existe nos dois lugares (caixa e histórico). A janela abre
com destinatário, `Re:` no assunto e a assinatura do escritório já prontos.

- A resposta sai **encaixada na conversa** (`In-Reply-To`), então cai na mesma
  cadeia no cliente de quem recebe.
- Se o destinatário for **vara/cartório** (`@…jus.br`, `mp.br`, `def.br`), vale o
  **horário de envio** de sempre — 08:00 justiça comum e trabalhista, 10:00 federal.
  Fora do horário, oferece agendar. Veja `HORARIO-EMAIL-VARA.md`.
- A resposta que **nós** damos também fica no histórico, como
  `[E-mail enviado — resposta]`, com o nome de quem escreveu.

## O robô

`email_receber` (`/api/email/receber`), de **10 em 10 minutos** pelo maestro. O
botão **📥 buscar agora** na caixa força a leitura na hora.

- Guarda o último UID lido em `email_imap_estado` — nunca relê a caixa inteira.
- Se o servidor recriar a caixa (`uidvalidity` muda), recomeça sozinho.
- No máximo 60 mensagens e 60 KB de texto por mensagem, por rodada.
- Ignora: o que nós mesmos mandamos, mala direta (`List-Unsubscribe`,
  `Precedence: bulk`), automação (`Auto-Submitted`) e remetentes `no-reply@`.
- Corta a citação do e-mail anterior — fica só o que a pessoa escreveu agora.

### Primeira carga

Depois de subir a versão, rode uma vez para trazer os últimos dias:

```
GET /api/email/receber?dias=7
```

Sem o `?dias`, a primeira execução já varre 3 dias sozinha.

## Anexos

Esta versão importa **texto**, não anexos. Se a vara mandar um PDF, o lançamento
avisa que a mensagem veio, e o arquivo continua no webmail. Anexos ficam para depois.

## Tabelas

| Tabela | O que guarda |
|---|---|
| `emails_recebidos` | a caixa (RLS por escritório; só o robô insere) |
| `email_threads` | raiz da conversa → processo (só service-role) |
| `email_imap_estado` | até onde o robô leu (uma linha) |

```sql
-- respostas que não acharam processo
select recebido_em, de, assunto from emails_recebidos
where numero is null and not arquivado order by recebido_em desc;

-- como está a leitura do IMAP
select * from email_imap_estado;

-- refazer a leitura dos últimos e-mails (o robô repega o que já viu, o unique impede duplicar)
update email_imap_estado set ultima_uid = 0 where id = 1;
```

## Depende do IMAP

Usa as mesmas credenciais do envio (`SMTP_USER` / `SMTP_PASS`) e `IMAP_HOST`
(padrão: o `SMTP_HOST` com `smtp.` trocado por `imap.`). Se a leitura falhar, o
motivo fica em `email_imap_estado.ultimo_resultado` e aparece no painel de robôs.
