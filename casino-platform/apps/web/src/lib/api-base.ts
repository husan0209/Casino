/**
 * Единственный источник базового URL API: клиент (lib/api.ts), серверный ход
 * (lib/api/server.ts) и middleware (origin для connect-src CSP) обязаны
 * совпадать — три независимых дефолта разъезжаются незаметно (CSP молча
 * режет запросы, если middleware знает один URL, а клиент ходит на другой).
 *
 * В проде задаётся NEXT_PUBLIC_API_URL (same-origin за nginx, docs-guard D3/D7:
 * каждый ключ env обязан быть в .env.example и ENVIRONMENT_VARIABLES §22).
 */
export const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'
