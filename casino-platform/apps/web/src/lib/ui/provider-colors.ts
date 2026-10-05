/**
 * Детерминированный цвет провайдера по имени (палитра ч.5.1): лента на главной,
 * чипы фильтров каталога и будущие списки красят аватарки одинаково.
 * Don't-лист §6: цветные карточки, не серые буквенные плитки «P, P, H, N».
 */

export const PROVIDER_COLORS = [
  { bg: 'bg-[#E53E3E]/15', text: 'text-[#FC8181]', icon: 'bg-[#E53E3E]' },
  { bg: 'bg-[#3182CE]/15', text: 'text-[#63B3ED]', icon: 'bg-[#3182CE]' },
  { bg: 'bg-[#D69E2E]/15', text: 'text-[#F6E05E]', icon: 'bg-[#D69E2E]' },
  { bg: 'bg-[#38B2AC]/15', text: 'text-[#4FD1C5]', icon: 'bg-[#38B2AC]' },
  { bg: 'bg-[#805AD5]/15', text: 'text-[#B794F4]', icon: 'bg-[#805AD5]' },
  { bg: 'bg-[#DD6B20]/15', text: 'text-[#F6AD55]', icon: 'bg-[#DD6B20]' },
  { bg: 'bg-[#E53E3E]/15', text: 'text-[#FEB2B2]', icon: 'bg-[#9B2C2C]' },
  { bg: 'bg-[#6C63FF]/15', text: 'text-[#A3BFFA]', icon: 'bg-[#6C63FF]' },
] as const

export function pickProviderColor(name: string): (typeof PROVIDER_COLORS)[number] {
  const code = name.charCodeAt(0)
  return PROVIDER_COLORS[code % PROVIDER_COLORS.length]!
}
