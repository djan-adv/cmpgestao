/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // habilita instrumentation.js (agendador interno dos robôs) no Next 14
  experimental: { instrumentationHook: true },
}
export default nextConfig
