'use client'
import { create } from 'zustand'
import { fetchGeoConfig } from '@/lib/api/geo.api'
import type { GeoConfig } from '@/types/wallet'

interface GeoState {
  config: GeoConfig | null
  isLoading: boolean
  load: (country?: string) => Promise<void>
}

export const useGeoStore = create<GeoState>((set) => ({
  config: null,
  isLoading: false,
  load: async (country) => {
    set({ isLoading: true })
    try {
      const config = await fetchGeoConfig(country)
      set({ config, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },
}))
