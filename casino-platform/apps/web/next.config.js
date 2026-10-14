/**
 * GAP-55 (е) (ТЗ ч.5 §22): «домены CDN провайдеров сразу в next.config».
 *
 * Реальные хосты брендов GitSlotPark станут известны только при подключении
 * (GAP-46), поэтому список берётся из env, а не из хардкода. Выворачивать
 * `hostname: '**'` нельзя: оптимизатор next/image начал бы ходить по
 * произвольным URL самой же платформой (SSRF-вектор + кеш мусора).
 * Разрешённые хосты — NEXT_PUBLIC_IMAGE_HOSTS через запятую.
 */
const path = require('node:path')

const hosts = (process.env['NEXT_PUBLIC_IMAGE_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0)

/**
 * Origin API — из NEXT_PUBLIC_API_URL (тот же источник, что у lib/api-base.ts),
 * дефолт совпадает с его dev-фолбэком. Хардкода хоста в конфиге нет.
 */
function apiOrigin() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'
  return new URL(apiUrl).origin
}

/**
 * Dev-прокси /uploads на API: аватары и KYC-документы раздаёт API из своего
 * ./uploads (в проде этот префикс закрывает nginx same-origin, и здесь rewrite
 * не нужен). Браузер при этом ходит за файлами со своего origin (:3000) —
 * относительный /uploads/… с карточек и профиля работает без абсолютных URL.
 */
function uploadsRewrites() {
  if (process.env['NODE_ENV'] === 'production') {
    return []
  }
  return [{ source: '/uploads/:path*', destination: `${apiOrigin()}/uploads/:path*` }]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Второй `next dev` в этой же папке (QA-съёмка) не должен сносить .next чужого dev-сервера.
  distDir: process.env['WEB_DIST_DIR'] ?? '.next',
  // infra/docker/web.prod.Dockerfile копирует .next/standalone и запускает apps/web/server.js —
  // без standalone этого каталога не существует, и `docker compose build web` падает на COPY.
  output: 'standalone',
  // Монорепо: трассировка от корня workspace, иначе standalone соберёт зависимости вне /app.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  async rewrites() {
    // Фронт Construct 3 ходит относительным /api/vgames (apiURL зашит в
    // data.json донора), а API отдаёт /api/v1/vgames. Самописный клиент Plinko
    // — тем же приёмом за /api/plinko.
    return [
      {
        source: '/api/vgames/:path*',
        destination: `${apiOrigin()}/api/v1/vgames/:path*`,
      },
      {
        source: '/api/plinko/:path*',
        destination: `${apiOrigin()}/api/v1/plinko/:path*`,
      },
      ...uploadsRewrites(),
    ]
  },
  images: {
    // AVIF отключён до миграции на Next 15: GHSA-2xp9-vwfh-vxw4 (critical) — RCE в
    // Image Optimization именно через декодирование AVIF, а чинится только мажором
    // Next. Webp остаётся, деградация — форматы картинок, не функциональность.
    formats: ['image/webp'],
    remotePatterns: hosts.map((hostname) => ({
      protocol: 'https',
      hostname,
    })),
  },
}

module.exports = nextConfig
