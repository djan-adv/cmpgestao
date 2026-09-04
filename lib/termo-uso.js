// Termo de Uso e de Tratamento de Dados — o texto que o escritório aceita ao
// abrir o teste, e o registro de que aceitou.
//
// Existe porque o auto-cadastro mudou a natureza do risco: até ele, cada
// cliente entrava por uma conversa e um contrato. Agora um advogado que nunca
// falou com ninguém sobe, no primeiro dia, processos com dados de clientes
// DELE — dados de terceiros, muitos sob sigilo profissional. Guardar isso sem
// instrumento nenhum é o único ponto do "tudo automático" que o código não
// resolve sozinho.
//
// Três decisões de conteúdo, e as três têm motivo:
//
//   1. A cláusula sobre PRAZOS vem antes das de dinheiro. É o risco real do
//      produto: quem confia a captação de intimação a um robô e perde um prazo
//      procura o fornecedor. O sistema é auxiliar e a conferência continua do
//      escritório — isso precisa estar escrito, e escrito em português claro.
//   2. Os suboperadores são NOMEADOS. Um escritório de advocacia tem o dever de
//      saber por onde passam os dados do cliente dele; descobrir depois é o que
//      quebra a confiança.
//   3. Nada de "o fornecedor não se responsabiliza por nada". Cláusula assim
//      não segura em juízo e ainda anuncia má-fé para um leitor que é advogado.
//
// A VERSÃO é o que fica gravado no aceite. Mudou o texto, muda a versão — sem
// isso não há como provar QUAL texto a pessoa aceitou.

export const VERSAO_TERMO = '2026-09-04'

export const FORNECEDOR = {
  nome: 'Djan Henrique Mendonça',
  papel: 'desenvolvedor e fornecedor do sistema',
  email: 'contato@djan.app.br',
}

export const TERMO = [
  {
    t: '1. Do que trata este termo',
    p: [
      'Este termo rege o uso do sistema GestãoJurídica, fornecido por ' + FORNECEDOR.nome +
        ' (' + FORNECEDOR.email + '), por escritórios e profissionais da advocacia.',
      'Quem abre o cadastro declara ter poderes para contratar em nome do escritório indicado. ' +
        'A partir daqui, esse escritório é chamado de CONTRATANTE e quem fornece o sistema, de FORNECEDOR.',
    ],
  },
  {
    t: '2. Período de teste',
    p: [
      'O cadastro inicial dá acesso ao sistema inteiro, sem corte de função, por 30 dias.',
      'O teste tem limites de volume — quantidade de processos, de acessos e de espaço para documentos. ' +
        'Ao atingir qualquer um deles, o sistema avisa na própria tela, no momento em que acontece, e propõe a contratação. ' +
        'Nada é bloqueado sem aviso.',
      'Terminado o teste, o acesso é interrompido. NENHUM DADO É APAGADO: processos, prazos, documentos e histórico ' +
        'continuam guardados e voltam exatamente como estavam quando o CONTRATANTE contratar.',
      'Nos dias seguintes ao término, o sistema continua capturando as publicações do Diário de Justiça do escritório, ' +
        'para que nenhuma intimação se perca no intervalo. Nada é enviado a clientes ou a órgãos em nome de escritório com acesso interrompido.',
    ],
  },
  {
    t: '3. Prazos processuais — leia esta parte',
    p: [
      'O sistema captura publicações, sugere prazos e monta rascunhos. Ele é FERRAMENTA AUXILIAR e não substitui, ' +
        'em nenhuma hipótese, a conferência do prazo pelo advogado responsável.',
      'A responsabilidade pelo controle de prazos, pela decisão sobre a peça e pelo protocolo é do CONTRATANTE e dos ' +
        'advogados que atuam por ele — como seria com qualquer outro sistema, agenda ou anotação.',
      'As fontes públicas de onde o sistema lê (Diário de Justiça eletrônico, portais dos tribunais, plataformas do ' +
        'Poder Judiciário) podem ficar fora do ar, atrasar ou publicar de forma incompleta, por motivo alheio ao FORNECEDOR.',
      'O FORNECEDOR responde por defeito do próprio sistema, apurado em cada caso. Não responde por prazo perdido em ' +
        'razão de falha, atraso ou omissão dessas fontes externas, nem por decisão do escritório sobre a peça.',
    ],
  },
  {
    t: '4. Contas, senhas e uso',
    p: [
      'Cada pessoa do escritório usa uma conta própria. A senha é pessoal e intransferível, e no primeiro acesso o ' +
        'sistema obriga a troca da senha provisória.',
      'O CONTRATANTE administra os próprios acessos: cria, desativa e define o papel de cada um. Os atos praticados ' +
        'por essas contas são atribuídos ao escritório.',
      'É vedado usar o sistema para finalidade ilícita, para tratar dados sem base legal, ou para acessar processo ou ' +
        'cliente que não seja do escritório.',
    ],
  },
  {
    t: '5. Dados: quem é quem',
    p: [
      'Os dados de processos, clientes e partes que o escritório insere no sistema são dele. O CONTRATANTE é o ' +
        'CONTROLADOR desses dados; o FORNECEDOR atua como OPERADOR, tratando-os apenas conforme este termo e as ' +
        'instruções do CONTRATANTE, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).',
      'O FORNECEDOR não usa esses dados para finalidade própria, não os comercializa, não os cede a terceiros e não ' +
        'os utiliza para treinar modelos de inteligência artificial.',
      'O acesso do FORNECEDOR ao conteúdo do escritório se limita ao necessário para operar, corrigir defeito ou ' +
        'atender pedido de suporte do próprio CONTRATANTE.',
      'O FORNECEDOR e sua equipe estão sujeitos a dever de confidencialidade sobre tudo o que acessarem, dever que ' +
        'permanece depois de encerrada a relação. O CONTRATANTE é escritório de advocacia e parte do que insere está ' +
        'protegida por sigilo profissional: o sistema é operado com essa premissa.',
    ],
  },
  {
    t: '6. Por onde os dados passam',
    p: [
      'Operar o sistema exige terceiros de infraestrutura, que atuam como suboperadores e ficam nomeados aqui:',
      '• Banco de dados e autenticação: Supabase (servidores em São Paulo, Brasil).',
      '• Servidor da aplicação e dos arquivos: infraestrutura de servidor privado contratada pelo FORNECEDOR.',
      '• Inteligência artificial: Anthropic, para as rotinas que leem publicações, montam rascunhos e respondem ao ' +
        'suporte. O conteúdo enviado nessas rotinas não é usado para treinar modelos.',
      '• Envio e leitura de e-mail: o provedor de e-mail do próprio escritório, cadastrado por ele.',
      'A troca de qualquer suboperador é comunicada ao CONTRATANTE antes de passar a valer.',
    ],
  },
  {
    t: '7. Segurança e incidentes',
    p: [
      'O tráfego é cifrado, as senhas de serviços cadastrados pelo escritório são guardadas cifradas, e o acesso a ' +
        'dados de um escritório é isolado dos demais no próprio banco de dados.',
      'Nenhum sistema é imune. Havendo incidente de segurança que possa acarretar risco relevante aos dados do ' +
        'CONTRATANTE, o FORNECEDOR o comunicará sem demora, com o que se sabe e o que está sendo feito, para que o ' +
        'CONTRATANTE cumpra os próprios deveres perante os titulares e a autoridade.',
    ],
  },
  {
    t: '8. Contratação, preço e encerramento',
    p: [
      'A contratação é mensal, sem fidelidade e sem taxa de instalação. O preço é o publicado na página do sistema ' +
        'no momento da contratação, e o valor contratado não muda por alteração posterior da tabela.',
      'Havendo atraso no pagamento, o acesso pode ser suspenso após comunicação ao CONTRATANTE. Suspensão não é ' +
        'exclusão: os dados continuam guardados.',
      'O CONTRATANTE pode encerrar quando quiser, sem multa.',
      'Encerrada a relação por qualquer motivo, o CONTRATANTE tem 90 dias para exportar seus dados, e o FORNECEDOR ' +
        'presta o apoio necessário para isso. Findo esse prazo, os dados são eliminados, salvo o que a lei exigir guardar.',
    ],
  },
  {
    t: '9. O que o escritório precisa providenciar',
    p: [
      'Algumas funções dependem de coisas que só o escritório tem: o certificado digital (para a integração com as ' +
        'plataformas do Judiciário) e a conta de e-mail do escritório. Sem elas, essas funções específicas não operam ' +
        '— e o sistema diz isso na tela, em vez de falhar em silêncio.',
    ],
  },
  {
    t: '10. Alterações deste termo',
    p: [
      'Este termo tem versão e data. Alteração relevante é comunicada ao CONTRATANTE por e-mail com antecedência, e ' +
        'ele pode encerrar a contratação sem ônus caso não concorde.',
    ],
  },
  {
    t: '11. Lei aplicável e foro',
    p: [
      'Aplica-se a lei brasileira. Fica eleito o foro do domicílio do CONTRATANTE para dirimir questões oriundas deste termo.',
    ],
  },
  {
    t: '12. Aceite',
    p: [
      'O aceite é eletrônico, feito no ato do cadastro. Ficam registrados a data e hora, o endereço de origem e a ' +
        'versão do texto aceito — é o que permite, depois, saber exatamente qual texto valeu.',
    ],
  },
]

// Texto corrido, para quem precisa do termo fora da tela (e-mail, PDF, registro).
export function termoEmTexto() {
  return TERMO.map(s => s.t + '\n\n' + s.p.join('\n\n')).join('\n\n')
}
