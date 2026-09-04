# Teste de 30 dias — como funciona, ponta a ponta

A oferta: o escritório entra e usa o **sistema inteiro** por 30 dias. Dois
gatilhos levam à contratação, e o que vier primeiro vale: **passou dos 30 dias**,
ou **passou do tamanho do teste**. Não se
escolhe plano para testar — o plano é escolhido na hora de contratar. **Nada é
apagado** no fim: o acesso para, o acervo fica, e ao pagar tudo reaparece.

O que o teste limita é **tamanho**, não função.

| | Teste | Starter | Intermediário | Full |
|---|---|---|---|---|
| Processos | 100 | 2.500 | 5.000 | 10.000 |
| Acessos | 3 | 25 | 50 | 100 |
| Documentos | 2 GB | 2,5 GB | 5 GB | 10 GB |
| IA | teto de R$ 30 no mês | sem teto próprio | sem teto próprio | sem teto próprio |

## O que acontece sozinho

1. **Criar o inquilino** no painel `/inquilinos` já grava `teste_ate = hoje + 30`
   e os limites acima. O e-mail de boas-vindas diz a data e os limites.
2. **`/api/cron/testes`** roda todo dia às 9h (registrado no tick):
   - avisa o contratante por e-mail a **10 dias**, a **3 dias** e no **último dia**;
   - cada aviso é registrado em `produtividade_config` (`teste_aviso_d10` etc.)
     com a data do teste no valor, então não sai duas vezes — e sai de novo se o
     teste for prorrogado, porque aí é outro vencimento;
   - vencido, marca `ativo = false` com o motivo escrito em `suspenso_motivo` e
     grava `coleta_ate = hoje + 10`.
3. **Contratar um plano** (painel → Plano → Salvar) limpa `teste_ate`, devolve
   `ativo = true` e sobe os limites. Não há passo manual.

## As três proteções que não podem ser removidas

**Carência de coleta (`coleta_ate`).** Bloquear o acesso NÃO desliga a captura.
O robô do diário usa `escritoriosAtivos('coleta')`, que inclui quem está
bloqueado mas dentro da carência. Sem isso, o fim de um teste vira prazo perdido
— a publicação sai no dia seguinte ao bloqueio e não entra em lugar nenhum, nem
quando o cliente volta. Nada é ENVIADO em nome de escritório bloqueado; só
capturado e guardado.

**Aviso antes do bloqueio.** Se o e-mail não sair, o aviso não é marcado como
enviado e é tentado na rodada seguinte. Bloquear quem nunca foi avisado é o pior
desfecho possível deste robô.

**O bloqueio é explicado.** `/api/inquilino` devolve `suspenso_motivo`, e a tela
mostra uma folha dizendo que o acesso está suspenso e que **nada foi apagado**.
Sem isso o cliente veria um sistema vazio e acharia que perdeu os processos.

## Onde os tetos são aplicados de verdade

- **Processos** — gatilho `processos_teto()` no banco. Tem de ser no banco: o
  cadastro avulso vai da tela direto ao Postgres pela RLS, sem passar por rota
  nenhuma. Conferir só no servidor deixaria o caminho mais usado sem porteiro.
- **Acessos** — `/api/acessos`, na criação de usuário.
- **Disco** — `lib/espaco.js`, chamado antes de gravar no upload de documentos e
  no robô que puxa a íntegra dos autos do jus.br (o maior consumidor de espaço
  do sistema).
- **IA** — `escritorios.ia_teto_brl`, conferido dentro de `chamarClaude`, que é
  o único ponto por onde toda chamada passa. O teto global de `ia_config`
  continua valendo por cima.
- **Suspensão** — `meu_escritorio()` devolve NULL quando o escritório está
  suspenso ou o usuário desativado. É o que faz a suspensão valer no banco, e
  não só na tela.

## Prorrogar, encerrar, liberar módulo

Tudo no painel `/inquilinos`, botão **gerir**: data do teste, **+7 / +30 dias**,
teto de IA, e as caixas de **Estagiário/Secretária Virtual** e **e-mail**.
Prorrogação conta a partir do vencimento, não de hoje — prorrogar no dia 3 um
teste que vence no dia 10 não pode encurtar o prazo.

## Auto-cadastro (o cliente se cadastra sozinho)

`POST /api/cadastro-teste` — rota **pública** ligada ao formulário da página de
vendas (seção "Começar o teste de 30 dias"). O visitante preenche escritório,
nome, e-mail e telefone; o sistema:

1. reserva um endereço livre a partir do nome (`silvaesouza.djan.app.br`;
   se ocupado, tenta com número — nunca devolve a porta de outro escritório);
2. cria o escritório em teste, com o sistema inteiro liberado;
3. cria a conta de contratante com senha provisória e manda por e-mail;
4. avisa `VENDAS_EMAIL` e grava o interessado no Comercial como lead novo.

O certificado TLS do endereço novo sai sozinho na primeira visita (`on_demand`
no Caddy, com o `ask` batendo em `/api/tls`), e o DNS já é curinga. **Nenhum
passo manual em nenhum ponto.**

### Os freios (rota pública que CRIA coisas)

| Freio | Padrão | Variável |
|---|---|---|
| Cadastros por dia | 5 | `TESTES_MAX_DIA` |
| Testes ativos ao mesmo tempo | 25 | `TESTES_MAX_ATIVOS` |
| Por e-mail | 1 por hora, e nunca para quem já tem acesso | — |

Batido o teto, **o interessado não é descartado**: entra no Comercial como fila
de espera, recebe uma mensagem dizendo que os testes estão sendo abertos por
ordem de chegada, e um aviso sai para quem vende. Perder o lead seria pior do
que abrir mais um teste.

Subdomínios reservados (`www`, `api`, `admin`, `sistema`, `suporte`…) não podem
ser escolhidos por quem se cadastra.

A senha provisória vai por e-mail e é obrigatória para entrar — isso já faz as
vezes de confirmação de endereço, sem nenhuma tela a mais.

### O que o cliente NÃO vê

Os números dos tetos não aparecem na página, nem no e-mail de boas-vindas, nem
na faixa da tela, nem nas respostas do robô de suporte. Teto anunciado na porta
soa como aviso de que vai faltar. A **existência** do limite é dita (a página
diz que o teste tem limites de volume e que o sistema avisa antes de travar
qualquer coisa); o número aparece no momento em que ele é atingido — junto com
o convite para contratar, que é quando ele funciona.
