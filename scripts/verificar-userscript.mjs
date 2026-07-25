// Verifica o userscript ENTREGUE (não o código-fonte): gera o texto como o
// servidor entrega e roda "node --check" nele. Um escape errado no template já
// matou o script inteiro em silêncio — este teste impede que se repita.
import fs from 'fs';
import { execSync } from 'child_process';
const src = fs.readFileSync('app/api/jusbr/userscript/gerar.js', 'utf8');
const i = src.indexOf('export function scriptTexto(');
const fim = src.indexOf('\n}\n', src.indexOf('return `', i)) + 3;
const corpo = src.slice(i, fim).replace('export function', 'function');
const f = new Function('URL', corpo + '; return scriptTexto;')(URL);
const out = f('SEGREDO_TESTE', 'https://exemplo.com/api/jusbr/token', 'https://exemplo.com/api/jusbr/userscript/pub?k=X');
fs.writeFileSync('/tmp/gerado.user.js', out);
try {
  execSync('node --check /tmp/gerado.user.js', { stdio: 'pipe' });
  const temSelo = /function selo\(/.test(out), temAtu = /@updateURL/.test(out);
  console.log('OK: userscript válido (' + out.length + ' bytes) · selo:' + temSelo + ' · auto-update:' + temAtu);
} catch (e) {
  console.error('FALHOU: erro de sintaxe no userscript gerado');
  console.error(String(e.stderr || e));
  process.exit(1);
}
