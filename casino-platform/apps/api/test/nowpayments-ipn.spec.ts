import { createHmac } from 'crypto'

import {
  canonicalizeForNOWPayments,
  NOWPaymentsClient,
} from '../src/modules/payments/infrastructure/clients/nowpayments.client'

const SECRET = 'test-ipn-secret'

/**
 * Эталонный Python-канонизатор из официальных док NOWPayments:
 *   sorted(data.items()) → json.dumps(..., separators=(',',':')) → HMAC-SHA512
 * Воспроизведён в Node (ensure_ascii, repr-числа) — его подписи принимаются.
 */
function signPythonStyle(rawBody: string): string {
  const marked = markNumbers(rawBody)
  const obj = JSON.parse(marked) as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
  const s = pyDumps(JSON.stringify(sorted).replace(/"\\u0000NUM:([^"\\]*)\\u0000"/g, '$1'))
  return createHmac('sha512', SECRET).update(s, 'utf8').digest('hex')
}

/** python json.dumps(ensure_ascii=True) поверх JSON.stringify. */
function pyDumps(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (code === undefined || code < 0x80) {
      out += ch
    } else {
      for (const unit of ch) out += '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')
    }
  }
  return out
}

/** Числа вне строк → строковые маркеры (тот же приём, что в канонизаторе). */
function markNumbers(raw: string): string {
  const RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
  let out = ''
  let inStr = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (inStr) {
      if (ch === '\\') {
        out += ch + (raw[i + 1] ?? '')
        i += 2
        continue
      }
      if (ch === '"') inStr = false
      out += ch
      i++
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      i++
      continue
    }
    const m = RE.exec(raw.slice(i))
    if (m) {
      out += '"\\u0000NUM:' + m[0] + '\\u0000"'
      i += m[0].length
      continue
    }
    out += ch
    i++
  }
  return out
}

function client(): NOWPaymentsClient {
  return new NOWPaymentsClient({
    get: (key: string) => (key === 'NOWPAYMENTS_IPN_SECRET' ? SECRET : undefined),
  } as never)
}

const BODY = JSON.stringify({
  payment_status: 'finished',
  pay_address: 'TXabc123',
  actually_paid: '10.5',
  payment_id: 500,
  order_id: 'order-42',
})

describe('P0 #4: NOWPayments IPN canonical-sorted-JSON HMAC (dual-check)', () => {
  it('принимает подпись по официальному Python-сниппету (sorted + compact)', () => {
    const sig = signPythonStyle(BODY)
    expect(client().verifyIPN(BODY, sig)).toBe(true)
  })

  it('подпись Python-стиля сходится независимо от порядка ключей и whitespace', () => {
    const shuffled = '{"order_id":"order-42",  "payment_id":500,' +
      '\n      "actually_paid":"10.5","pay_address":"TXabc123","payment_status":"finished"}'
    const sig = signPythonStyle(shuffled)
    expect(client().verifyIPN(shuffled, sig)).toBe(true)
  })

  it('целые числа: repr-форма 10.0 сохраняется (не схлопывается в 10)', () => {
    const raw = '{"payment_id":500,"actually_paid":10.0,"order_id":"o"}'
    const sig = signPythonStyle(raw)
    expect(client().verifyIPN(raw, sig)).toBe(true)
    // сигнатура реально отличается от «схлопнутой» — т.е. мы не дали бы ложный проход
    const collapsed = createHmac('sha512', SECRET)
      .update('{"actually_paid":10,"order_id":"o","payment_id":500}')
      .digest('hex')
    expect(collapsed).not.toBe(sig)
  })

  it('экспоненциальная форма сохраняется', () => {
    const raw = '{"payment_id":1,"amount":1.5e3}'
    const sig = signPythonStyle(raw)
    expect(client().verifyIPN(raw, sig)).toBe(true)
  })

  it('не-ASCII (кириллица) экранируется как Python ensure_ascii', () => {
    const raw = '{"payment_id":7,"comment":"привет"}'
    const sig = signPythonStyle(raw)
    expect(client().verifyIPN(raw, sig)).toBe(true)
  })

  it('канонизатор воспроизводит ровно python json.dumps', () => {
    const raw = '{"b":2.50,"a":"x/y","c":"привет","d":[1,2.0]}'
    const canonical = canonicalizeForNOWPayments(raw)
    // Python НЕ экранирует «/», числа сохраняют запись, ключи отсортированы,
    // кириллица → \uXXXX в нижнем регистре
    const u = (c: string) =>
      '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    const cyr = 'привет'.split('').map(u).join('')
    const expected = '{"a":"x/y","b":2.50,"c":"' + cyr + '","d":[1,2.0]}'
    expect(canonical).toBe(expected)
  })

  it('PHP-флейвор (экранированный «/») тоже принимается', () => {
    const raw = '{"payment_id":5,"url":"https://api.example.com/cb"}'
    const marked = markNumbers(raw)
    const obj = JSON.parse(marked) as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
    const s = pyDumps(JSON.stringify(sorted).replace(/"\\u0000NUM:([^"\\]*)\\u0000"/g, '$1'))
    const sig = createHmac('sha512', SECRET).update(s.split('/').join('\\/'), 'utf8').digest('hex')
    expect(client().verifyIPN(raw, sig)).toBe(true)
  })

  it('raw-body HMAC (обратная совместимость) принимается', () => {
    const sig = createHmac('sha512', SECRET).update(BODY, 'utf8').digest('hex')
    expect(client().verifyIPN(BODY, sig)).toBe(true)
  })

  it('подделка: другой секрет / правленое тело / отсутствие подписи — отклоняется', () => {
    const wrongSecret = createHmac('sha512', 'other-secret').update(BODY).digest('hex')
    expect(client().verifyIPN(BODY, wrongSecret)).toBe(false)
    expect(client().verifyIPN(BODY, '')).toBe(false)
    const tampered = BODY.replace('finished', 'failed')
    expect(client().verifyIPN(tampered, signPythonStyle(BODY))).toBe(false)
  })

  it('невалидный JSON: канон-ветка молча пропускается, работает raw-ветка', () => {
    const sig = createHmac('sha512', SECRET).update('not-json').digest('hex')
    expect(client().verifyIPN('not-json', sig)).toBe(true)
    expect(client().verifyIPN('not-json', 'deadbeef')).toBe(false)
  })

  it('fail-closed dev: без секрета — false', () => {
    const c = new NOWPaymentsClient({ get: () => undefined } as never)
    expect(c.verifyIPN('{"a":1}', 'x')).toBe(false)
  })

  it('маркер-инъекция: строка-подделка НЕ становится числом (type-confusion guard)', () => {
    // строка, выглядящая как наш внутренний маркер: в теле вставили 2 маркера
    // (число 2 → маркер), а находим 3 (b + строка-подделка) → канон-ветка
    // честно отклоняется, verifyIPN отработает по raw-HMAC
    const raw = '{"a":"\\u0000NUM:1\\u0000","b":2}'
    expect(() => canonicalizeForNOWPayments(raw)).toThrow('marker collision')
  })

  it('частичное совпадение с маркером внутри строки не ломает канон', () => {
    // не полный маркер (нет закрывающего \u0000) — count не увеличивает
    const raw = '{"a":"x\\u0000NUM:1","b":2}'
    const canonical = canonicalizeForNOWPayments(raw)
    expect(canonical).toBe('{"a":"x\\u0000NUM:1","b":2}')
  })
})
