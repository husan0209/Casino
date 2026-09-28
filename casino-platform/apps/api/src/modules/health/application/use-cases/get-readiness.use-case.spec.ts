import { describe, expect, it } from 'vitest'

import { GetReadinessUseCase } from './get-readiness.use-case'
import { type IHealthProbe, type ProbeName, type ProbeStatus } from '../../domain/health.ports'

function fakeProbe(name: ProbeName, status: ProbeStatus): IHealthProbe {
  return { name, check: async () => status }
}

describe('GetReadinessUseCase', () => {
  it('db ok + redis ok → ready:true, degraded:false', async () => {
    const useCase = new GetReadinessUseCase([fakeProbe('db', 'ok'), fakeProbe('redis', 'ok')])

    await expect(useCase.execute()).resolves.toEqual({
      ready: true,
      degraded: false,
      checks: { db: 'ok', redis: 'ok' },
    })
  })

  it('db ok + redis fail → ready:true, degraded:true (queue-only деградация)', async () => {
    const useCase = new GetReadinessUseCase([fakeProbe('db', 'ok'), fakeProbe('redis', 'fail')])

    await expect(useCase.execute()).resolves.toEqual({
      ready: true,
      degraded: true,
      checks: { db: 'ok', redis: 'fail' },
    })
  })

  it('db fail → ready:false (fail-closed) независимо от Redis', async () => {
    const useCase = new GetReadinessUseCase([fakeProbe('db', 'fail'), fakeProbe('redis', 'ok')])

    await expect(useCase.execute()).resolves.toEqual({
      ready: false,
      degraded: false,
      checks: { db: 'fail', redis: 'ok' },
    })
  })

  it('пробы вызываются все и параллельно (агрегация по имени пробы)', async () => {
    const calls: ProbeName[] = []
    const tracking = (name: ProbeName, status: ProbeStatus): IHealthProbe => ({
      name,
      check: async () => {
        calls.push(name)
        return status
      },
    })
    const useCase = new GetReadinessUseCase([tracking('db', 'ok'), tracking('redis', 'fail')])

    const report = await useCase.execute()

    expect(calls.sort()).toEqual(['db', 'redis'])
    expect(report.checks).toEqual({ db: 'ok', redis: 'fail' })
  })
})
