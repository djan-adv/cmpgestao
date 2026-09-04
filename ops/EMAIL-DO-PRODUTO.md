# A conta de e-mail do produto

O sistema manda dois tipos de e-mail, e eles não podem sair do mesmo endereço:

- **Da advocacia** — o que o escritório envia a vara e a cliente. Sai pela conta
  do próprio escritório (⚙ → Conta de e-mail), ou pela conta do servidor no
  escritório raiz.
- **Do produto** — código de confirmação do cadastro, senha provisória,
  boas-vindas, avisos de fim de teste, e os avisos internos de "novo teste
  aberto" / "pedido de demonstração".

## Por que isto existe

No primeiro cadastro real, um interessado preencheu o formulário em
`djan.app.br` e o aviso saiu de `contato@cmpadvogados.com.br` para os sócios do
escritório. Dois erros de uma vez: quem vende o sistema é o produto, não a
banca; e sócio de escritório de advocacia não tem por que receber lead de
software.

Pior no outro sentido: um advogado que nunca ouviu falar da banca recebia
"GestãoJurídica" de um endereço de escritório de advocacia.

## Como configurar

No `.env.local` do servidor:

```
SMTP_PRODUTO_HOST=<servidor de saída do provedor de contato@djan.app.br>
SMTP_PRODUTO_PORT=465
SMTP_PRODUTO_USER=contato@djan.app.br
SMTP_PRODUTO_PASS=<senha da conta>
SMTP_PRODUTO_FROM_NAME=GestãoJurídica
```

Depois, `systemctl restart` no serviço da aplicação.

## Enquanto não estiver configurado

O envio **não para**: cai na conta do servidor, mas com o nome exibido do
produto. Trocar só o endereço escrito no cabeçalho, autenticando por outra
conta, quebraria SPF/DKIM e mandaria a mensagem direto para o spam — então o
nome dá para corrigir sem a conta, o endereço não.

O aviso interno de "novo teste aberto" **diz quando saiu pela conta emprestada**,
para isso não passar despercebido.

## Não misturar as filas

Lead do produto (`canal` = `site do sistema` ou `auto-cadastro teste`) fica de
fora do robô `/api/notificar-jader`, que avisa os sócios sobre lead de cliente
de advocacia. Os leads do produto já têm canal próprio: o e-mail para
`VENDAS_EMAIL`, mandado pela conta do produto.

## SPF/DKIM

Para `contato@djan.app.br` sair do spam, o domínio `djan.app.br` precisa dos
registros SPF e DKIM do provedor dessa caixa. Sem eles, o e-mail sai — mas boa
parte cai em spam, e o código de confirmação que não chega é cadastro perdido.
