'use client'

import { useState } from 'react'

import { toast } from '@/components/ui/toaster'
import { errText } from '@/lib/api'
import { launchDemo } from '@/lib/api/casino.api'
import { openDemoGame } from '@/lib/open-game'

/**
 * Демо-запуск (ТЗ ч.5 §7: «Demo запускается с превью игры»). Идёт мимо
 * launch-мутации, поэтому ошибку провайдера показываем сами: без catch промис
 * падал молча, и кнопка выглядела сломанной.
 * Волна 5.1 (остаток): на актуальном main хук берёт `launchDemo` из casino.api.
 */
export function useDemoLaunch(): {
  startDemo: (slug: string, currency: string) => Promise<void>
  isRunning: boolean
} {
  const [isRunning, setRunning] = useState(false)

  const startDemo = async (slug: string, currency: string): Promise<void> => {
    setRunning(true)
    try {
      const res = await launchDemo(slug, currency)
      if (res.launch_url) {
        openDemoGame(slug, res.launch_url)
      }
    } catch (error) {
      toast.error(errText(error) || 'Не удалось запустить демо')
    } finally {
      setRunning(false)
    }
  }

  return { startDemo, isRunning }
}
