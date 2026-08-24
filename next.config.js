/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // habilita instrumentation.js (agendador interno dos robôs) no Next 14
  experimental: { instrumentationHook: true },
  // As telas do escritório são arquivos estáticos em public/ (sistema.html,
  // portal.html, monitoramento.html…). Sem cabeçalho explícito, o navegador
  // decide sozinho por quanto tempo segurá-los — e o resultado foi passar o dia
  // 24/08/2026 achando que o "Publicar" não tinha funcionado, quando o servidor
  // já estava atualizado (build "done") e o navegador é que servia a versão
  // velha. no-store: toda abertura busca do servidor. São arquivos pequenos, e
  // a certeza de estar vendo a versão publicada vale mais que o download extra.
  async headers() {
    return [
      {
        source: '/:arquivo*.html',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ]
  },
}
export default nextConfig
