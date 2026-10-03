/**
 * Единственный источник базового URL API для админки.
 *
 * Вынесено из lib/api.ts, потому что middleware (CSP) обязан знать РОВНО тот же
 * URL, на который ходит клиент: connect-src из чужого дефолта молча режет все
 * запросы админки. lib/api.ts тянет axios и 'use client' — в Edge-рантайме
 * middleware это импортнуть нельзя, поэтому константа живёт здесь (тот же
 * приём, что apps/web/src/lib/api-base.ts).
 *
 * В проде задаётся NEXT_PUBLIC_API_URL (запекается в бандл build-аргом —
 * GAP-59: vhost админки не проксирует /api/, поэтому URL абсолютный и ДРУГОГО
 * origin, чем ADMIN_DOMAIN; без него админка уходила на чужой хост).
 */
export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'
