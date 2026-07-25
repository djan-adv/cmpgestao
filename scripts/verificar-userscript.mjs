// gera o script EXATAMENTE como o servidor entrega (avaliando o template literal)
import fs from 'fs';
const src = fs.readFileSync('app/api/jusbr/userscript/route.js','utf8');
const i = src.indexOf('function scriptTexto(segredo, endpoint) {');
const j = src.indexOf('\n}', src.indexOf('return `', i)) ;
// extrai o corpo da função e executa
const corpo = src.slice(i, src.indexOf('\n}\n', i)+3);
const f = new Function('URL', corpo + '; return scriptTexto;')(URL);
const out = f('SEGREDO', 'https://gestao.cmpadvogados.com.br/api/jusbr/token');
fs.writeFileSync('/tmp/gerado.user.js', out);
console.log('gerado:', out.length, 'bytes');
// procura o trecho suspeito
const m = out.match(/ENDPOINT_APRENDER.*/);
console.log('linha suspeita:', m ? m[0] : '(não achou)');

// Verificação: o script ENTREGUE ao Tampermonkey precisa ter sintaxe válida.
// (Um erro aqui mata o userscript inteiro em silêncio — já aconteceu: um "\/"
//  virou "//" e o arquivo inteiro parou de rodar, sem selo e sem sincronização.)
import { execSync } from 'child_process';
try {
  execSync('node --check /tmp/gerado.user.js', { stdio: 'pipe' });
  console.log('OK: userscript gerado tem sintaxe válida');
} catch (e) {
  console.error('FALHOU: o userscript gerado tem ERRO DE SINTAXE');
  console.error(String(e.stderr || e));
  process.exit(1);
}
