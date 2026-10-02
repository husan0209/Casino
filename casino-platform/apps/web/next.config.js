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
