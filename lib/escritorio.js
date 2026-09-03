// ATENÇÃO: este arquivo não tem mais implementação própria.
//
// Duas frentes construíram a versão autônoma em paralelo e cada uma criou o seu
// "de quem é este pedido": este arquivo e app/api/_lib/inquilino.js. Duas fontes
// para a mesma pergunta é como o uuid chumbado em 25 arquivos voltaria a
// acontecer — bastaria uma rota importar a que não foi atualizada. A
// implementação viva é a de app/api/_lib/inquilino.js; aqui ficam só os nomes
// antigos, encaminhando para lá, para não quebrar quem já importava daqui.
//
// Diferenças que a unificação resolveu, e por quê:
//  - escritorioDoUsuario devolvia o escritório da INSTALAÇÃO quando o usuário
//    não tinha escritório. Cair no escritório do dono calado é exatamente o
//    defeito que a separação existe para impedir; agora devolve nulo e a rota
//    recusa o pedido.
//  - a pasta do inquilino ficava em /opt/cmpdocs/_esc/<id>, DENTRO da árvore do
//    dono — e a tela de documentos lista o conteúdo da raiz, então a pasta do
//    cliente apareceria para o dono como se fosse acervo dele. Agora é uma
//    árvore irmã (/opt/cmpdocs-inq/<id>), como a da Inove.
export {
  ESCRITORIO_RAIZ,
  ESCRITORIO_RAIZ as ESCRITORIO_PADRAO,
  ESCRITORIO_RAIZ as ESCRITORIO_CMP,
  escritorioDoUsuario,
  usuarioDoRequest,
  inquilinoDoRequest as escritorioDoRequest,
  raizDocs,
} from '../app/api/_lib/inquilino.js'

import { raizDocs as _raizDocs } from '../app/api/_lib/inquilino.js'

// A versão antiga recebia (raiz, esc) — a raiz vinha de quem chamava. A nova
// resolve a raiz sozinha (variável DOCS_ROOT). O invólucro mantém a assinatura
// antiga funcionando em vez de trocá-la calada e quebrar quem já chamava.
export function pastaDoEscritorio(_raizIgnorada, esc) {
  return _raizDocs(esc)
}
