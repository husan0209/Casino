import { apiGet } from '@/lib/api'
import type { GeoConfig } from '@/types/wallet'

export function fetchGeoConfig(country?: string) {
  return apiGet<GeoConfig>('/geo/config', country ? { country } : undefined)
}
