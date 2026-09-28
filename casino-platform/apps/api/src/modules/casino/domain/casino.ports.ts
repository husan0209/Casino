/** Порты casino (решение В5: application-слой работает с infrastructure
 * только через интерфейсы + DI-токены — по образцу payments.ports.ts и
 * auth.ports.ts).
 *
 * Контракт повторяет публичную поверхность ProviderAdapterFactory
 * (infrastructure/providers/provider-adapter.factory.ts); сам класс остаётся
 * в infrastructure и получает `implements`.
 */

import { type GameProviderAdapter } from './provider-adapter.interface'

/** Фабрика адаптеров провайдеров: выбор адаптера по slug провайдера. */
export interface IProviderAdapterFactory {
  getAdapter(slug: string): GameProviderAdapter
}

/** DI-токен порта фабрики провайдеров для Nest-DI. */
export const PROVIDER_ADAPTER_FACTORY = Symbol('PROVIDER_ADAPTER_FACTORY')
