// Carga inicial do escritório que administra o sistema.
//
// Estes dados — 60 processos do Kanban, 79 tarefas e a agenda importada do
// Astrea — estavam ESCRITOS DENTRO de public/sistema.html. Esse arquivo é
// servido como estático: qualquer pessoa com o endereço baixava e lia nome de
// cliente e número de processo, sem login. Sigilo de cliente num arquivo
// público.
//
// Aqui é código de servidor, que nunca é entregue ao navegador. A rota exige
// sessão válida E escritório raiz — é carga da casa, e só ela precisa.
//
// Por que não migrar para o banco: o sistema já mescla estas cargas com as
// tarefas do banco, deduplicando por conteúdo. Inserir tudo criaria linhas
// duplicadas para conciliar depois, com risco numa base em uso. Mover para o
// servidor resolve o vazamento sem escrever nada.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const CARGA = {
"kanbanSeed": [
{
"numero": "0503371-04.2017.8.05.0001",
"cliente": "PK COMERCIO DE MOVEIS,",
"titulo": "PRAZO PARA RECORRER - Realizado: protocolado",
"tipo": "DIREITO CIVIL (899) - Obrigaçõ"
},
{
"numero": "0804855-43.2017.8.15.0731",
"cliente": "HIGIENE CONS E LIMPEZA LTDA -",
"titulo": "prazo pra embargos - verificar - improcedencia e sem gratuidade - Realizado: emb",
"tipo": "Adimplemento e Extinção (7690)"
},
{
"numero": "0815979-78.2026.8.15.2001",
"cliente": "JADER GABRIEL PINHEIRO DOS",
"titulo": "replica",
"tipo": "Atraso de vôo (4829)"
},
{
"numero": "0826159-56.2026.8.15.2001",
"cliente": "SERGIO ASSABBI",
"titulo": "Lembrar cliente, advogado e testemunha(s) da audiência",
"tipo": "Procedimento do Juizado Especi"
},
{
"numero": "0805174-55.2026.8.15.0000",
"cliente": "JOANA ANA DA CONCEICAO",
"titulo": "Decorrido prazo de JOANA ANA DA CONCEICAO FILHA em 30/06/2026 23:59.",
"tipo": "Agravo de Instrumento"
},
{
"numero": "0823900-88.2026.8.15.2001",
"cliente": "CICERA FERREIRA ALVES",
"titulo": "AUDIENCIA UNA - Realizado: realizada - rita -processo concluso, audiencia adiada",
"tipo": "PROCEDIMENTO DO JUIZADO ESPECI"
},
{
"numero": "0800168-78.2026.8.15.2001",
"cliente": "Andre Henrique Silva da Conceição",
"titulo": "Juntada de Petição de execução / cumprimento de sentença",
"tipo": "Indenização por Dano Material "
},
{
"numero": "0000179-83.2026.5.05.0251",
"cliente": "SERGIO ASSABBI",
"titulo": "Recebido(s) o(s) Embargos de Declaração de ARISTARCO TELES QUINTILIANO DOS SANTO",
"tipo": "ETCiv"
},
{
"numero": "0131694-07.2015.5.13.0026",
"cliente": "FRANCISCA EVARISTO DE LIMA",
"titulo": "Juntada a petição de Manifestação",
"tipo": "ATOrd"
},
{
"numero": "0001608-19.2026.5.05.0661",
"cliente": "F. A. B. B.",
"titulo": "Juntada a petição de Manifestação",
"tipo": "ATSum"
},
{
"numero": "0806949-91.2018.8.15.2003",
"cliente": "YGOR MENDES JORGE DE SOUZA",
"titulo": "Juntada de Petição de contestação",
"tipo": "Indenização por Dano Moral (77"
},
{
"numero": "0051095-09.2011.8.15.2001",
"cliente": "JOSENILDO DEOLINDO DA SILVA",
"titulo": "PROTOCOLADO PEDIDO DE CUMPRIMENTO DA SENTENÇA",
"tipo": "Gratificação Extraordinária - "
},
{
"numero": "0051098-61.2011.8.15.2001",
"cliente": "GERMANO LEITE PRAXEDES",
"titulo": "INTIMAR o executado para impugnar a execução, no prazo de 30 (trinta) dias. João",
"tipo": "Descontos Indevidos (10296)"
},
{
"numero": "0046557-82.2011.8.15.2001",
"cliente": "PBPREV PARAIBA PREVIDENCIA",
"titulo": "EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DO NÚCLEO DE JUSTIÇA 4.",
"tipo": "Cumprimento de Sentença contra"
},
{
"numero": "8034561-27.2022.8.05.0001",
"cliente": "JEFERSON ROQUE DA SILVA",
"titulo": "Decorrido prazo de MUNICIPIO DE SALVADOR em 26/06/2026 23:59.",
"tipo": "DIREITO TRIBUTÁRIO (14) - Impo"
},
{
"numero": "0000904-12.2015.8.15.2003",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Conhecido o recurso de CLEONICE DA COSTA DUARTE (APELANTE) e não-provido",
"tipo": "Indenização por Dano Moral (10"
},
{
"numero": "8016001-15.2025.8.05.0039",
"cliente": "EMANUEL PINHEIRO BARBOSA DA",
"titulo": "Decorrido prazo de MUNICIPIO DE CAMACARI em 29/04/2026 23:59.",
"tipo": "DIREITO TRIBUTÁRIO (14) - Impo"
},
{
"numero": "0000494-98.2026.5.05.0029",
"cliente": "C. S. C.",
"titulo": "Decorrido o prazo de CAMILE SILVA DA CONCEICAO em 25/06/2026",
"tipo": "AÇÃO TRABALHISTA"
},
{
"numero": "0045915-12.2011.8.15.2001",
"cliente": "ABDIAS BRANDAO DOS SANTOS",
"titulo": "Decorrido prazo de ABDIAS BRANDAO DOS SANTOS em 25/06/2026 23:59.",
"tipo": "Indenização por Dano Material "
},
{
"numero": "4058814-54.2025.8.26.0100",
"cliente": "ALEXANDRE MARQUES DAS NEVES",
"titulo": "Decorrido prazo - Refer. aos Eventos: 74 e 75 Usuário: SECFP",
"tipo": "EXECUÇÃO DE TÍTULO EXTRAJUDICI"
},
{
"numero": "0260956-84.2022.8.06.0001",
"cliente": "MARCOS HELENO CHAGAS",
"titulo": "Decorrido prazo de OLIMPIO STUDART GALDINO em 23/06/2026 23:59.",
"tipo": "Promessa de Compra e Venda (10"
},
{
"numero": "0800727-69.2026.8.23.0010",
"cliente": "DON SILVA MARTINS",
"titulo": "DECORRIDO PRAZO DE DON SILVA MARTINS",
"tipo": "10439 - Indenização por Dano M"
},
{
"numero": "0078269-50.2022.8.17.2001",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Decorrido prazo de CARLOS MAGNO DE FREITAS EVANGELISTA em 19/06/2026 23:59.",
"tipo": "Citação"
},
{
"numero": "0000211-41.2026.5.13.0033",
"cliente": "CONCEITO INDUSTRIA DE",
"titulo": "Decorrido o prazo de CONCEITO INDUSTRIA DE ESTOFADOS LTDA em 19/06/2026",
"tipo": "ATOrd"
},
{
"numero": "0008140-30.2016.8.17.2001",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Proferido despacho de mero expediente - Tribunal de Justiça de Pernambuco Poder ",
"tipo": "Planos de Saúde"
},
{
"numero": "0000601-71.2022.5.05.0001",
"cliente": "ODAISE",
"titulo": "Decorrido o prazo de BANCOSEGURO S.A. em 16/06/2026",
"tipo": "ATSum"
},
{
"numero": "2801096-38.2026.8.13.0000",
"cliente": "DJAN HENRIQUE MENDONCA",
"titulo": "CONTRARRAZÕES",
"tipo": ""
},
{
"numero": "0000234-98.2025.5.05.0532",
"cliente": "Itallo Pericles Oliveira Lima",
"titulo": "Decorrido o prazo de ITALLO PERICLES OLIVEIRA LIMA em 16/06/2026",
"tipo": "ATOrd"
},
{
"numero": "1030952-65.2025.8.26.0002",
"cliente": "GRANTUBOS - COMERCIO",
"titulo": "Execução/Cumprimento de Sentença Iniciada (o) 0004518- 22.2026.8.26.0002 - Cumpr",
"tipo": "Inclusão Indevida em Cadastro "
},
{
"numero": "0000373-54.2026.5.13.0027",
"cliente": "CONCEITO INDUSTRIA DE",
"titulo": "Juntada a petição de Manifestação",
"tipo": "ATSum"
},
{
"numero": "0014422-07.2015.8.17.0001",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Decorrido prazo de VISION MED ASSISTENCIA MEDICA LTDA em 15/06/2026 23:59.",
"tipo": "Planos de Saúde"
},
{
"numero": "0805438-64.2018.8.15.2001",
"cliente": "SYLVIO MARCUS FERNANDES DE",
"titulo": "Situação: Cumprimento de sentença em curso. Última distribuição: 02/02/2026. Val",
"tipo": "Rescisão / Resolução (10582)"
},
{
"numero": "0042391-59.2025.8.17.2001",
"cliente": "Iara Costa Da Silva",
"titulo": "DESPACHO R.H. Intime-se a parte demandada para, no prazo de 15 (quinze) dias, ma",
"tipo": "AÇÃO DE INDENIZAÇÃO POR DANOS "
},
{
"numero": "0130135-80.2013.5.13.0027",
"cliente": "VALTEX IND E COM DE",
"titulo": "Decorrido o prazo de ANGELA ALCANTARA FERREIRA MIRANDA em 12/06/2026",
"tipo": "ATSum"
},
{
"numero": "0816420-69.2020.8.15.2001",
"cliente": "JOANA ANA DA CONCEICAO",
"titulo": "Decorrido prazo de JOANA ANA DA CONCEICAO FILHA em 12/06/2026 23:59.",
"tipo": "DIREITO CIVIL (899) - Responsa"
},
{
"numero": "0053227-49.2003.8.17.0001",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Decorrido prazo de EDVALDO LAURENTINO VASCONCELOS em 11/06/2026 23:59.",
"tipo": ""
},
{
"numero": "0802501-79.2016.8.15.0731",
"cliente": "ADRIANO MUSSOLIN",
"titulo": "Decorrido prazo de JALINE CRISPIM MENDONÇA em 11/06/2026 23:59.",
"tipo": "Produto Impróprio (11867)"
},
{
"numero": "8010314-49.2024.8.05.0150",
"cliente": "MARIA JOSE ANDRADE CHAVES",
"titulo": "Juntada de Petição de embargos de declaração",
"tipo": "DIREITO CIVIL (899) - Obrigaçõ"
},
{
"numero": "0003555-40.2026.8.05.0150",
"cliente": "NATALIA BARBOSA DA SILVA",
"titulo": "N° 38 Decorrido prazo de Advogados de NATALIA BARBOSA DA SILVA Decorrido prazo d",
"tipo": "AÇÃO DECLARATÓRIA DE INEXISTÊN"
},
{
"numero": "0802871-55.2021.8.15.2001",
"cliente": "MANUELLA THEREZA PEREIRA",
"titulo": "Decorrido prazo de YOUBE WORK SERVICOS DE COWORKING E ESCRITORIOS VIRTUAIS LTDA ",
"tipo": "Incorporação Imobiliária (1047"
},
{
"numero": "0810617-95.2026.8.15.2001",
"cliente": "LEGACY EMPREENDIMENTOS E",
"titulo": "D-1 resposta a impugnação ao cumprimento de sentença - Realizado: PROTOCOLADA CO",
"tipo": "Cumprimento Provisório de Sent"
},
{
"numero": "0084523-06.2014.8.17.0001",
"cliente": "Diniz de Carvalho Nogueira Ferraz",
"titulo": "Proferido despacho de mero expediente - Tribunal de Justiça de Pernambuco Poder ",
"tipo": "Inventário e Partilha"
},
{
"numero": "0801204-27.2023.8.15.0461",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Decorrido prazo de FRANCISCO CARMENATO DE OLIVEIRA GOMES em 09/06/2026 23:59.",
"tipo": "Ausência de Cobrança Administr"
},
{
"numero": "0826449-52.2018.8.15.2001",
"cliente": "SILVIO ROMERO DE ARAUJO",
"titulo": "Decorrido prazo de SILVIO ROMERO DE ARAUJO FARIAS em 09/06/2026 23:59.",
"tipo": "Assunção de Dívida (7689)"
},
{
"numero": "0802448-30.2018.8.15.0731",
"cliente": "HIGIENE CONS E LIMPEZA LTDA -",
"titulo": "Decorrido prazo de MARIA DE FATIMA BRAGA FERNANDES em 09/06/2026 23:59.",
"tipo": "ISS/ Imposto sobre Serviços (5"
},
{
"numero": "0850958-18.2016.8.15.2001",
"cliente": "RODRIGO PINHEIRO DE TOLEDO",
"titulo": "Decorrido prazo de RODRIGO PINHEIRO DE TOLEDO VIANNA em 09/06/2026 23:59.",
"tipo": "Provas (8990)"
},
{
"numero": "0009757-50.2014.8.15.2001",
"cliente": "SERGIO ASSABBI",
"titulo": "Decorrido prazo de inativo em 08/06/2026 23:59.",
"tipo": "Esbulho / Turbação / Ameaça (1"
},
{
"numero": "5054812-60.2021.8.13.0024",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Juntada de Petição de manifestação",
"tipo": ""
},
{
"numero": "0000335-07.2022.5.05.0641",
"cliente": "SAMUEL DIAS VIANA",
"titulo": "Decorrido o prazo de MARINALDO COSTA DE ALMEIDA em 01/06/2026",
"tipo": "ATOrd"
},
{
"numero": "1051769-13.2026.8.13.0024",
"cliente": "DJAN HENRIQUE MENDONCA DO",
"titulo": "Comprovar pagamento das custas iniciais ou agravar - Realizado: AI PROTOCOLADO",
"tipo": "PROCEDIMENTO COMUM CÍVEL"
},
{
"numero": "0861883-29.2023.8.15.2001",
"cliente": "PRAXISAUDE GESTAO E SERVICOS",
"titulo": "Decorrido prazo de FRANCISCO FREIRE DE FIGUEIREDO FILHO em 29/05/2026 23:59.",
"tipo": "Depósito Elisivo (10924)"
},
{
"numero": "0872381-36.2024.8.20.5001",
"cliente": "Philipy de Oliveira Mourao",
"titulo": "Contrarrazões a apelaçãoz - Realizado: PROTOCOLADO",
"tipo": "DIREITO PROCESSUAL CIVIL E DO "
},
{
"numero": "0881238-54.2025.8.15.2001",
"cliente": "Julia Sarmento",
"titulo": "AUDIENCIA UNA - Realizado: realizada - djan",
"tipo": "Indenização por Dano Moral (77"
},
{
"numero": "0000790-25.2007.8.05.0001",
"cliente": "INOVE CONSULTORIA ATUARIAL",
"titulo": "Decorrido prazo de EVERALDO RODRIGUES DAYUBE em 28/05/2026 23:59.",
"tipo": "DIREITO DO CONSUMIDOR (1156) -"
},
{
"numero": "0808789-45.2018.8.15.2001",
"cliente": "JOSE LEITAO SOBRINHO",
"titulo": "Decorrido prazo de MARIA GORETE FELIX LEITAO em 28/05/2026 23:59.",
"tipo": "Indenização por Dano Moral (10"
},
{
"numero": "0000623-92.2022.5.13.0006",
"cliente": "CARLOS LUAN FELIX DA SILVA",
"titulo": "AUDIENCIA - Realizado: realizada - djan",
"tipo": "ATOrd"
},
{
"numero": "8117765-32.2023.8.05.0001",
"cliente": "JODIAEL SIMOES DOS SANTOS",
"titulo": "Decorrido prazo de BANCO SANTANDER (BRASIL) S.A. em 27/05/2026 23:59.",
"tipo": "DIREITO CIVIL (899) - Responsa"
},
{
"numero": "0801262-27.2022.8.15.0441",
"cliente": "EDSON DE MEDEIROS DANTAS",
"titulo": "Decorrido prazo de JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBI",
"tipo": "Indenização por Dano Moral (10"
},
{
"numero": "0800742-62.2025.8.15.0441",
"cliente": "Iara Costa Da Silva",
"titulo": "Decorrido prazo de JOSE FRANCISCO DOS SANTOS FILHO em 26/05/2026 23:59.",
"tipo": "Procedimento Comum Civel"
},
{
"numero": "0818243-05.2025.8.15.2001",
"cliente": "CASSIO LUIZ DE ANDRADE SILVA",
"titulo": "Decorrido prazo de REDIANA VIEIRA SILVA DE ANDRADE em 26/05/2026 23:59.",
"tipo": "Cláusulas Abusivas (11974)"
}
],
"tarefas": [
{
"id": 7001,
"titulo": "Lembrar cliente, advogado e testemunha(s) da audiência",
"cliente": "SERGIO ASSABBI",
"numero": "0826159-56.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7002,
"titulo": "Lembrar cliente e advogado da audiência",
"cliente": "JADER GABRIEL PINHEIRO DOS SANTOS 4 x AZUL LINHA AEREAS",
"numero": "0815979-78.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7003,
"titulo": "Definir advogado responsável pela audiência",
"cliente": "SERGIO ASSABBI",
"numero": "0826159-56.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7004,
"titulo": "01/07/2026 - EMITIR GUIA DE PARCELAMENTO DAS CUSTAS INICIAIS",
"cliente": "AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54 x AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54",
"numero": "1002697-72.2026.8.11.0037",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7005,
"titulo": "verificar transito em julgado e executar custas e honorarios",
"cliente": "IZABEL DA CUNHA LIMA x EMILSON TORRES GALVAO",
"numero": "0836378-02.2024.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7006,
"titulo": "01/08/2026 - EMITIR GUIA DE PARCELAMENTO DAS CUSTAS INICIAIS",
"cliente": "AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54 x AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54",
"numero": "1002697-72.2026.8.11.0037",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-08-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7007,
"titulo": "01/09/2026 - EMITIR GUIA DE PARCELAMENTO DAS CUSTAS INICIAIS",
"cliente": "AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54 x AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54",
"numero": "1002697-72.2026.8.11.0037",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-01",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7008,
"titulo": "VERIFICAE  - pedir saldo sobejante nos autos do processo nº 0002981-08.2005.8.16.0001. - DESISTIR DE FAZER AÇÃO INDENIZATÓRIA",
"cliente": "CAIXA DE PREVIDÊNCIA DOS FUNCIONÁRIOS DO BANCO DO BRASIL x SYLVIO MARCUS FERNANDES DE MIRANDA - AÇÃO INDENIZATÓRIA - PREPARAR",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-02",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7009,
"titulo": "Avisar cliente",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO X SHOPEE BRASIL INTERNET LTDA",
"numero": "0841289-86.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-08-04",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7010,
"titulo": "04/09/2026 - ENVIAR AUDIÊNCIAS DA SEMANA",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-04",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7011,
"titulo": "Enviar mensagem com instruções sobre a audiência para cliente e relembrar testemunha(s)",
"cliente": "SERGIO ASSABBI",
"numero": "0826159-56.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-06",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7012,
"titulo": "Lembrar cliente da audiencia e verificar testemunhas",
"cliente": "Gilvan Almeida Furtado X Coimbra Alves Construções",
"numero": "0016025-63.2026.5.16.0016",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-06",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7013,
"titulo": "VERIFICAR TRANSITO EM JULGADO",
"cliente": "NNF - EMPREENDIMENTOS E PARTICIPACOES S.A. x JULIANA PONTES SANTOS SILVA",
"numero": "0070245-67.2021.8.17.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-07",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7014,
"titulo": "Verificar se djan corrigiu a rescisória e dar andamento",
"cliente": "JOSE ARRIEL COFFEE IMPORTACAO E EXPORTACAO LTDA - ME - CNPJ: 10.570.327/0001-52 x Credores em Geral",
"numero": "5004273-49.2023.8.13.0112",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-05-08",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7015,
"titulo": "verificar transito em julgado do processo principal e olhar como está o andamento do cump prov (0808861-51.2026.8.15.2001)",
"cliente": "MARIA DIGNA PEREIRA X EXECUT CONSULTORIA & NEGÓCIOS IMOBILIÁRIOS LTDA",
"numero": "0850579-04.2021.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-10",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7016,
"titulo": "REPLICA",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO X SHOPEE BRASIL INTERNET LTDA",
"numero": "0841289-86.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-08-11",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7017,
"titulo": "Lembrar cliente e advogado da audiência",
"cliente": "EMPIRICO DIGITAL x META",
"numero": "5001724-29.2026.8.08.0006",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-11",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7018,
"titulo": "11/09/2026 - ENVIAR AUDIÊNCIAS DA SEMANA",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-11",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7019,
"titulo": "Diligenciar certidão de crédito",
"cliente": "SILVIO ROMERO DE ARAUJO FARIAS - CPF: 441.644.834-15 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0826449-52.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7020,
"titulo": "Informar decretação de falência e continuidade do processo",
"cliente": "MARGARETH FERREIRA - CPF: 602.017.034-91 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0813121-55.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7021,
"titulo": "Informar decretação de falência e pedir certidão de crédito",
"cliente": "MATHEUS AMORIM RODRIGUES DE AGUIAR - CPF: 014.563.444-20 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0827149-28.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7022,
"titulo": "Informar decretação de falência e pedir certidão de crédito",
"cliente": "MAURICIO ERLAND NORIEGA MONJE - CPF: 013.783.954-50 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0802769-72.2017.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7023,
"titulo": "Pedir certidão de crédito",
"cliente": "SERGIO RICARDO DE LIMA ANDRADE - CPF: 671.378.573-53 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0800621-78.2018.8.15.0441",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7024,
"titulo": "Pedir certidão de crédito",
"cliente": "VALERIA MATOS LEITAO DE MEDEIROS - CPF: 885.173.224-87 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0808646-56.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7025,
"titulo": "Pedir certidão de crédito",
"cliente": "RENATO JOSE SANTOS - CPF: 874.162.047-04 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0812562-98.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7026,
"titulo": "Pedir certidão de crédito",
"cliente": "REGINALDO MAIA LEITE FILHO registrado(a) civilmente como REGINALDO MAIA LEITE FILHO - CPF: 963.006.124-49 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0800569-85.2018.8.15.0731",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7027,
"titulo": "Pedir certidão de crédito",
"cliente": "DIMAS GERMANO DA SILVA - CPF: 992.040.888-34 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0826577-72.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7028,
"titulo": "Pedir certidão de crédito",
"cliente": "SANDRA MICHELE DE OLIVEIRA DANTAS - CPF: 977.590.824-87 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0801314-32.2018.8.15.2003",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7029,
"titulo": "Requerer certidão de crédito",
"cliente": "LUCIANO LIMA DE OLIVEIRA - CPF: 039.287.046-05 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0808195-31.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7030,
"titulo": "Requerer certidão de crédito",
"cliente": "LYEBER MARANHAO DE MOURA - CPF: 020.142.814-83 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0808198-83.2018.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7031,
"titulo": "Requerer emissão de certidão de trânsito em julgado e posterior certidão de crédito",
"cliente": "SAYONARA DA SILVA BEZERRA - CPF: 028.290.584-70 x JAMES LAURENCE DEVELOPMENTS CONSTRUCOES INCORPORACOES E IMOBILIARIA LTDA - ME - CNPJ: 10.689.837/0001-43",
"numero": "0816020-60.2017.8.15.2001",
"col": "distribuir",
"resp": "Maria Eduarda",
"data": "2026-05-13",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7032,
"titulo": "Lembrar cliente e advogado da audiência",
"cliente": "GIVALSO DIAS DOS SANTOS JUNIOR x TAM LINHAS AEREAS S A",
"numero": "0009652-03.2026.8.05.0103",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-14",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7033,
"titulo": "Enviar mensagem com instruções sobre a audiência para cliente e relembrar testemunha(s)",
"cliente": "CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA",
"numero": "0000494-98.2026.5.05.0029",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-14",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7034,
"titulo": "Definir advogado responsável pela audiência",
"cliente": "EMPIRICO DIGITAL x META",
"numero": "5001724-29.2026.8.08.0006",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-14",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7035,
"titulo": "verificar cumprimento da sentença",
"cliente": "THIAGO CESAR SANTOS DA ROCHA x JULIO CESAR AGUIAR PEREIRA e JMV CONSTRUCAO E VENDA DE IMOVEIS EIRELI - APELAÇÃO CÍVEL (198)",
"numero": "0008527-03.2021.8.17.3090",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-15",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7036,
"titulo": "VERIFICAR SE RECURSO DE REVISTA TRANSITOU EM JULGADO E CASO POSITIVO, PROSSEGUIR COM EXEC PROV",
"cliente": "Ellen Virginia Nicomedes Gaspar X\tValle Recursos Humanos Ltda - AÇÃO TRABALHISTA - EXECUÇÃO",
"numero": "0010410-56.2025.5.15.0016",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-15",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7037,
"titulo": "Enviar mensagens com instruções sobre a audiência",
"cliente": "EMPIRICO DIGITAL x META",
"numero": "5001724-29.2026.8.08.0006",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-15",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7038,
"titulo": "Contratar adv para audiencia presencial",
"cliente": "CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA",
"numero": "0000494-98.2026.5.05.0029",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-15",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7039,
"titulo": "Enviar mensagens com instruções sobre a audiência",
"cliente": "GIVALSO DIAS DOS SANTOS JUNIOR x TAM LINHAS AEREAS S A",
"numero": "0009652-03.2026.8.05.0103",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-17",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7040,
"titulo": "17/07/2026 - ENVIAR AUDIÊNCIAS DA SEMANA",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-17",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7041,
"titulo": "verificar se a parte foi citada",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO - CPF: 029.044.594-99 x NATIVA CONSTRUCOES E SERVICOS LTDA - CNPJ: 63.359.541/0001-20",
"numero": "0800682-10.2026.8.10.0016",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-22",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7042,
"titulo": "Lembrar cliente e advogado da audiência",
"cliente": "COOP.REGIONAL AGRO-PECUARIA DE SANTA RITA DO SAPUCAI LTDA - CNPJ: 24.490.401/0001-35 x JOSE ARRIEL COFFEE IMPORTACAO E EXPORTACAO LTDA - ME - CNPJ: 10.570.327/0001-52",
"numero": "5000365-79.2026.8.13.0596",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-23",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7043,
"titulo": "verificar transito em julgado e executar",
"cliente": "ERALDO CRISPIM BATISTA x UNIÃO FEDERAL-DIREITO ADMINISTRATIVO E OUTRAS MATÉRIAS DE DIREITO PÚBLICO|Serviços|Saúde|Fornecimento de Medicamentos",
"numero": "0808457-54.2017.4.05.8200",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-23",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7044,
"titulo": "24/07/2026 - ENVIAR AUDIÊNCIAS DA SEMANA",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-24",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7045,
"titulo": "Definir advogado responsável pela audiência",
"cliente": "JADER GABRIEL PINHEIRO DOS SANTOS 4 x AZUL LINHA AEREAS",
"numero": "0815979-78.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7046,
"titulo": "Enviar boletos mensais para kelvin e juntar ao processo",
"cliente": "UNIÃO X VALTEX",
"numero": "0130135-80.2013.5.13.0027",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7047,
"titulo": "Juntar comp de pagamento das custas",
"cliente": "AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54 x AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54",
"numero": "1002697-72.2026.8.11.0037",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7048,
"titulo": "verificar prazo",
"cliente": "PBPREV PARAIBA PREVIDENCIA",
"numero": "0046557-82.2011.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7049,
"titulo": "26/06/2026 - ENVIAR AUDIÊNCIAS DA SEMANA",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7050,
"titulo": "TODOS OS MESES EMITIR GUIA DE DEPÓSITO JUDICIAL DE R$ 695,22",
"cliente": "Luiz Raylton x Eco park",
"numero": "0844176-77.2025.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7051,
"titulo": "01/06/2026 - EMITIR GUIA DE PARCELAMENTO DAS CUSTAS INICIAIS",
"cliente": "AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54 x AGROPLANTE INSUMOS LTDA - CNPJ: 48.279.271/0001-54",
"numero": "1002697-72.2026.8.11.0037",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7052,
"titulo": "CONTRARRAZÕES AOS ED",
"cliente": "Philipy de Oliveira Mourao x LEGACY EMPREENDIMENTOS E SERVICOS LTDA - 0848466-72.2024.8.15.2001",
"numero": "0848466-72.2024.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7053,
"titulo": "prosseguir execução nos autos principais - verificar",
"cliente": "EDSON E SILVA JUNIOR x SERGIO ASSABBI - CPF: 016.212.754-50",
"numero": "0836721-32.2023.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7054,
"titulo": "Verificar execução e dar andamento",
"cliente": "JOSENILDO DEOLINDO DA SILVA\tx\tPBPREV",
"numero": "0051095-09.2011.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7055,
"titulo": "Enviar mensagens com instruções sobre a audiência",
"cliente": "COOP.REGIONAL AGRO-PECUARIA DE SANTA RITA DO SAPUCAI LTDA - CNPJ: 24.490.401/0001-35 x JOSE ARRIEL COFFEE IMPORTACAO E EXPORTACAO LTDA - ME - CNPJ: 10.570.327/0001-52",
"numero": "5000365-79.2026.8.13.0596",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-28",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7056,
"titulo": "replica",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO - CPF: 029.044.594-99 x NATIVA CONSTRUCOES E SERVICOS LTDA - CNPJ: 63.359.541/0001-20",
"numero": "0800682-10.2026.8.10.0016",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-28",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7057,
"titulo": "Confirmar comparecimento das testemunhas",
"cliente": "CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA",
"numero": "0000494-98.2026.5.05.0029",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-28",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7058,
"titulo": "ACOMPANHAR - PETICIONAR SE NECESSÁRIO - FALAR COM ROOSEVELT ANTES DE PETICIONAR",
"cliente": "CONSTROMOB CONSTRUTORA E IMOBILIARIA COQUEIRINHO LTDA  X JOSÉ ANTÔNIO DE SOUZA",
"numero": "0800103-88.2018.8.15.0441",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7059,
"titulo": "Enviar mensagens com instruções sobre a audiência",
"cliente": "CICERA FERREIRA ALVES X AGENCIA DESTAQUE",
"numero": "0823900-88.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7060,
"titulo": "Estudar viabilidade defesa - EPE. - pedir cópia do Processo Administrativo pelo Regularize ou pedir senha do Gov ao cliente",
"cliente": "MINISTERIO DA FAZENDA - CNPJ: 00.394.460/0216-53 x EDMILSON MARCONDES DOS SANTOS - CPF: 185.770.324-34",
"numero": "0006692-66.2026.4.05.8200",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7061,
"titulo": "Confirmar comparecimento das testemunhas",
"cliente": "SERGIO ASSABBI",
"numero": "0826159-56.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7062,
"titulo": "lembrar cliente e djan",
"cliente": "VALDIR PEREIRA DE NÓBREGA x MINISTÉRIO PÚBLICO DA PARAÍBA",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7063,
"titulo": "VERIFICAR - 08026013120218152001 - EX CLIENTE - quando finalizar a execução temos que pedir reserva de parte da sucumbencia e entrar com ação de arbitramento de honorarios",
"cliente": "",
"numero": "—",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7064,
"titulo": "INICIAR EXECUÇÃO (EVIALENE E WENDER), os processo foram julgados em conjunto e deve prosseguir ambas as execução apenas no de evilane",
"cliente": "EVILANE CONCEIÇÃO OLIVEIRA BARBOSA X AZUL LINHA AEREAS",
"numero": "59702542920258090051",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-30",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7065,
"titulo": "Lembrar cliente, advogado e testemunha(s) da audiência",
"cliente": "CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA",
"numero": "0000494-98.2026.5.05.0029",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-09-30",
"prazo": "",
"tipoForm": "tarefa",
"origem": "astrea"
},
{
"id": 7066,
"titulo": "Iniciar cumprimento da sentença",
"cliente": "OSVALDO BARBOSA DE PONTES NETO\tx\tPBPREV",
"numero": "0002210-27.2012.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-18",
"prazo": "2026-06-17",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7067,
"titulo": "comprovar hipossuficiencia",
"cliente": "CONDOMINIO DO EDIFICIO MONTES CLAROS - CNPJ: 73.702.243/0001-45-Embargos à Execução",
"numero": "3107379-33.2026.8.19.0001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-23",
"prazo": "2026-06-25",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7068,
"titulo": "prazo para embargos de declaração",
"cliente": "ARCO IRIS x FAZENDA NACIONAL",
"numero": "0035600-70.2025.4.05.8200",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-24",
"prazo": "",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7069,
"titulo": "Comprovar hipossuficiencia",
"cliente": "HIGIENE CONS E LIMPEZA LTDA - EPP",
"numero": "0812220-95.2026.8.15.0000",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "2026-06-29",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7070,
"titulo": "D-1 REGULARIZAR CITAÇÃO",
"cliente": "CICERA FERREIRA ALVES X AGENCIA DESTAQUE",
"numero": "0823900-88.2026.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "2026-06-26",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7071,
"titulo": "prazo pra embargos - só vamos embargar se eles embargarem",
"cliente": "SERGIO ASSABBI X E.O.S",
"numero": "0000179-83.2026.5.05.0251",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7072,
"titulo": "RAZÕES FINAIS",
"cliente": "GUSTAVO MELO MAIA LEITE\tx\tUnimed Joao Pessoa Cooperativa de Trabalho Medico LTDA",
"numero": "0837994-46.2023.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-25",
"prazo": "2026-06-29",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7073,
"titulo": "INFORMAR ENDEREÇOS",
"cliente": "FRANCISCA EVARISTO DE LIMA x CONDORES - TECNOLOGIA E SERVIÇOS LTDA",
"numero": "0131694-07.2015.5.13.0026",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-26",
"prazo": "2026-06-30",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7074,
"titulo": "PRAZO PARA RECORRER",
"cliente": "KARINE CRISPIM PEDRAO X PK COMERCIO DE MOVEIS, SERVICO E LOCACAO LTDA",
"numero": "0503371-04.2017.8.05.0001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-29",
"prazo": "2026-07-01",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7075,
"titulo": "RESPOSTA A IMPUGNAÇÃO AO CUMP DE SENTENÇA PROV",
"cliente": "RENATA GONCALVES PEREIRA GUERRA POUSO x  YOUBE WORK SERVICOS DE COWORKING E ESCRITORIOS VIRTUAIS LTDA-Cumprimento Provisório de Sentença (10880)",
"numero": "0874810-56.2025.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-06-30",
"prazo": "2026-07-02",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7076,
"titulo": "Responder despacho",
"cliente": "INDENIZATÓRIA - PROTESTO INDEVIDO",
"numero": "0874462-38.2025.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-03",
"prazo": "",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7077,
"titulo": "CONTRARRAZÕES A APELAÇÃO",
"cliente": "CRISTINA KAZUMI OUCHI - CPF: 009.865.058-03 x SG DESENVOLVIMENTO URBANISTICO E IMOBILIARIO LTDA - CNPJ: 18.519.733/0001-00",
"numero": "0051036-03.2021.8.06.0164",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-06",
"prazo": "",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7078,
"titulo": "RECURSO",
"cliente": "Grantubos  Comércio Varejista de Tubos Ltda x TIM S A-Inclusão Indevida em Cadastro de Inadimplentes",
"numero": "1030952-65.2025.8.26.0002",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-06",
"prazo": "2026-07-08",
"tipoForm": "prazo",
"origem": "astrea"
},
{
"id": 7079,
"titulo": "verificar como iremos prosseguir com a obrigação de fazer",
"cliente": "SERGIO ASSABBI - CPF: 016.212.754-50 x ARISTARCO TELES QUINTILIANO DOS SANTOS - CPF: 310.991.145-00 - CUMPRIMENTO PROVISÓRIO DE SENTENÇA (157)",
"numero": "0834063-98.2024.8.15.2001",
"col": "distribuir",
"resp": "Maria Rita Caldas",
"data": "2026-07-06",
"prazo": "2026-06-19",
"tipoForm": "prazo",
"origem": "astrea"
}
],
"agenda": [
{
"data": "2026-07-01",
"hora": "10:40",
"tipo": "az",
"tt": "AUDIENCIA DE MEDIAÇÃO — VALDIR PEREIRA DE NÓBREGA x MINISTÉRIO PÚBLICO DA PARAÍBA",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "—",
"cliente": "VALDIR PEREIRA DE NÓBREGA x MINISTÉRIO PÚBLICO DA PARAÍBA"
}
},
{
"data": "2026-07-01",
"hora": "11:00",
"tipo": "az",
"tt": "AUDIENCIA UNA — CICERA FERREIRA ALVES X AGENCIA DESTAQUE",
"resp": "Maria Rita Caldas",
"p": {
"numero": "0823900-88.2026.8.15.2001",
"cliente": "CICERA FERREIRA ALVES X AGENCIA DESTAQUE"
}
},
{
"data": "2026-07-02",
"hora": "09:00",
"tipo": "az",
"tt": "AUDIÊNCIA UNA (JADER GABRIEL) — JADER GABRIEL PINHEIRO DOS SANTOS 4 x AZUL LINHA AEREAS",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0815979-78.2026.8.15.2001",
"cliente": "JADER GABRIEL PINHEIRO DOS SANTOS 4 x AZUL LINHA AEREAS"
}
},
{
"data": "2026-07-08",
"hora": "08:00",
"tipo": "az",
"tt": "Teleaudiência UNA (Conciliação, Instrução e Julgamento) Tipo: Una Sala: — SERGIO ASSABBI",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0826159-56.2026.8.15.2001",
"cliente": "SERGIO ASSABBI"
}
},
{
"data": "2026-07-21",
"hora": "07:30",
"tipo": "az",
"tt": "AUDIENCIA DE CONCILIAÇÃO — GIVALSO DIAS DOS SANTOS JUNIOR x TAM LINHAS AEREAS S A",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0009652-03.2026.8.05.0103",
"cliente": "GIVALSO DIAS DOS SANTOS JUNIOR x TAM LINHAS AEREAS S A"
}
},
{
"data": "2026-07-29",
"hora": "09:00",
"tipo": "az",
"tt": "AUDIENCIA UNA — DJAN HENRIQUE MENDONCA DO NASCIMENTO - CPF: 029.044.594-99 x NATIVA CONSTRUCOES E SERVICOS LTDA - CNPJ: 63.359.541/0001-20",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0800682-10.2026.8.10.0016",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO - CPF: 029.044.594-99 x NATIVA CONSTRUCOES E SERVICOS LTDA - CNPJ: 63.359.541/0001-20"
}
},
{
"data": "2026-07-30",
"hora": "17:10",
"tipo": "az",
"tt": "AUDIENCIA CEJUSC — COOP.REGIONAL AGRO-PECUARIA DE SANTA RITA DO SAPUCAI LTDA - CNPJ: 24.490.401/0001-35 x JOSE ARRIEL COFFEE IMPORTACAO E EXPORTACAO LTDA - ME - CNPJ: 10.570.327/0001-52",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "5000365-79.2026.8.13.0596",
"cliente": "COOP.REGIONAL AGRO-PECUARIA DE SANTA RITA DO SAPUCAI LTDA - CNPJ: 24.490.401/0001-35 x JOSE ARRIEL COFFEE IMPORTACAO E EXPORTACAO LTDA - ME - CNPJ: 10.570.327/0001-52"
}
},
{
"data": "2026-07-31",
"hora": "08:30",
"tipo": "az",
"tt": "AUDIENCIA DE INSTRUÇÃO TRABALHISTA — Gilvan Almeida Furtado X Coimbra Alves Construções",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0016025-63.2026.5.16.0016",
"cliente": "Gilvan Almeida Furtado X Coimbra Alves Construções"
}
},
{
"data": "2026-08-18",
"hora": "10:20",
"tipo": "az",
"tt": "AUDIÊNCIA UNA — DJAN HENRIQUE MENDONCA DO NASCIMENTO X SHOPEE BRASIL INTERNET LTDA",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0841289-86.2026.8.15.2001",
"cliente": "DJAN HENRIQUE MENDONCA DO NASCIMENTO X SHOPEE BRASIL INTERNET LTDA"
}
},
{
"data": "2026-09-17",
"hora": "15:30",
"tipo": "az",
"tt": "AUDIENCIA DE CONCILIAÇÃO — EMPIRICO DIGITAL x META",
"resp": "Maria Rita Caldas",
"p": {
"numero": "5001724-29.2026.8.08.0006",
"cliente": "EMPIRICO DIGITAL x META"
}
},
{
"data": "2026-10-07",
"hora": "08:50",
"tipo": "az",
"tt": "AUDIENCIA UNA — CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0000494-98.2026.5.05.0029",
"cliente": "CAMILE SILVA DA CONCEIÇÃO X DOMI FARMA LTDA"
}
},
{
"data": "2026-07-30",
"hora": "10:20",
"tipo": "az",
"tt": "Audiência inicial por videoconferência (Zoom, rito sumaríssimo) — Thaysa Cristina Costa de Figueiredo x Mercearia Avenida Ltda",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0000859-73.2026.5.09.0084",
"cliente": "Thaysa Cristina Costa de Figueiredo x Mercearia Avenida Ltda"
}
},
{
"data": "2026-07-13",
"hora": "10:00",
"tipo": "az",
"tt": "Perícia de insalubridade (presencial) — JEFERSON NATIVIDADE DOS SANTOS X F F DOURADO",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0000255-66.2026.5.05.0491",
"cliente": "JEFERSON NATIVIDADE DOS SANTOS X F F DOURADO"
}
},
{
"data": "2026-08-06",
"hora": "14:30",
"tipo": "az",
"tt": "Perícia de insalubridade (presencial) — CAUAN SILVA SANTANA X F F DOURADO",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0000348-93.2026.5.05.0017",
"cliente": "CAUAN SILVA SANTANA X F F DOURADO"
}
},
{
"data": "2026-08-06",
"hora": "13:30",
"tipo": "az",
"tt": "Sessão de julgamento (Apelação) - presencial/videoconferência — VERA/SYLVIO DE MIRANDA x HELIO ROBERTO SANTANA",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0006773-74.2022.8.16.0194",
"cliente": "VERA/SYLVIO DE MIRANDA x HELIO ROBERTO SANTANA"
}
},
{
"data": "2026-07-23",
"hora": "13:00",
"tipo": "az",
"tt": "Audiência de conciliação por videoconferência (Zoom) — Thaysa Cristina Costa (Autora)",
"resp": "Djan Henrique Mendonça",
"p": {
"numero": "0000859-73.2026.5.09.0084",
"cliente": "Thaysa Cristina Costa (Autora)"
}
}
]
}

export async function GET(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  try {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data } = await anon.auth.getUser(jwt)
    const user = (data && data.user) || null
    if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    const { data: perfil } = await sb
      .from('usuarios').select('escritorio_id, escritorios!inner(raiz)')
      .eq('id', user.id).maybeSingle()
    // escritório cliente não recebe carga nenhuma: a tela dele começa do banco
    if (!perfil || !perfil.escritorios || perfil.escritorios.raiz !== true) {
      return Response.json({ ok: true, kanbanSeed: [], tarefas: [], agenda: [] })
    }
    return Response.json({ ok: true, ...CARGA })
  } catch (e) {
    return Response.json({ erro: String((e && e.message) || e) }, { status: 500 })
  }
}
