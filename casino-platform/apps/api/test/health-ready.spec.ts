import { beforeEach, describe, expect, it, vi } from 'vitest'

// Моки ДО импорта SUT (hoisted)
vi.mock('@casino/database', () => ({
  prisma: { $queryRaw: vi.fn() },
}))

type FakeRedis = {
  connect: ReturnType<typeof vi.fn>
  ping: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
}

const redisInstances = vi.hoisted(() => [] as FakeRedis[])
const redisFailMode = vi.hoisted(() => ({ fail: false }))

vi.mock('ioredis', () => ({
  default: class MockRedis implements FakeRedis {
    connect = redisFailMode.fail
      ? vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      : vi.fn().mockResolvedValue(undefined)
    ping = vi.fn().mockResolvedValue('PONG')
    quit = vi.fn().mockResolvedValue(undefined)
    constructor() {
      redisInstances.push(this)
    }
  },
}))

import { HealthController } from '@modules/health/presentation/health.controller'

import { prisma } from '@casino/database'

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>

type ResStub = {
  statusCode?: number
  body?: unknown
  status(c: number): ResStub
  send(b: unknown): unknown
}

function makeRes(): ResStub {
  const res: ResStub = {
    status(c: number) {
      res.statusCode = c
      return res
    },
    send(b: unknown) {
      res.body = b
      return res
    },
  }
  return res
}

function makeCtrl(redisUrl?: string): HealthController {
  const config = { get: (k: string) => (k === 'REDIS_URL' ? redisUrl : undefined) }
  return new HealthController(config as never)
}

describe('HealthController readiness (GAP-35)', () => {
  beforeEach(() => {
    queryRaw.mockReset()
    redisInstances.length = 0
    redisFailMode.fail = false
  })

  it('db ok + redis ok → 200 {ready:true, degraded:false}', async () => {
    queryRaw.mockResolvedValue([] as never)
    const res = makeRes()
    await makeCtrl('redis://localhost:6379').readiness(res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ready: true, degraded: false, db: 'ok', redis: 'ok' })
  })

  it('db ok + redis отказ → 200 degraded:true (деградация, не отказ)', async () => {
    queryRaw.mockResolvedValue([] as never)
    redisFailMode.fail = true
    const res = makeRes()
    await makeCtrl('redis://localhost:6379').readiness(res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ready: true, degraded: true, db: 'ok', redis: 'fail' })
  })

  it('db fail → 503 {ready:false} (fail-closed)', async () => {
    queryRaw.mockRejectedValue(new Error('db down'))
    const res = makeRes()
    await makeCtrl('redis://localhost:6379').readiness(res as never)
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ ready: false, db: 'fail' })
  })

  it('REDIS_URL не задан → degraded, Redis-коннект не создаётся', async () => {
    queryRaw.mockResolvedValue([] as never)
    const res = makeRes()
    await makeCtrl(undefined).readiness(res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ready: true, degraded: true, redis: 'fail' })
    expect(redisInstances.length).toBe(0)
  })

  it('liveness — статический 200 без зависимостей', () => {
    expect(makeCtrl(undefined).liveness()).toEqual({ live: true })
  })
})
