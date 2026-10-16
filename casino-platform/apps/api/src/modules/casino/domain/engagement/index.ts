/**
 * Домен движка вовлечения (ТЗ ч.9). Наружу торчит один баррель: use-cases
 * и infrastructure импортируют отсюда, а не из отдельных файлов, чтобы
 * структура §16.2 оставалась проверяемой по импортам.
 */
export * from './engagement-phase'
export * from './engagement-config'
export * from './engagement-state.vo'
export * from './player-behavior.vo'
export * from './engagement-score.vo'
export * from './balance-cycle.vo'
export * from './phase-fsm'
export * from './adaptive-rtp'
export * from './ldw'
export * from './near-miss'
export * from './experiment-assignment'
