import { apiGet } from '@/lib/api'
import type { GeoConfig } from '@/types/wallet'

export function fetchGeoConfig(country?: string): Promise<GeoConfig> {
  return apiGet<GeoConfig>('/geo/config', country ? { country } : undefined)
}
