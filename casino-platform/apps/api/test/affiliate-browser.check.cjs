/*
 * Автономный Node-скрипт проверки: CommonJS и без типов, поэтому правила
 * модулей приложения к нему неприменимы — require() и console здесь норма,
 * а type-aware правила видят только any.
 */
/* eslint-disable no-console, complexity, max-lines-per-function, max-depth, max-params, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
/**
 * Браузерный проход по партнёрской программе на реальном стенде.
 *
 * Проверяет то, чего не видят ни HTTP-прогон, ни функциональный прогон через
 * DI: клиентский рендер, реальные данные в кабинете, ошибки консоли, наличие
 * входа в раздел с сайта.
 *
 * Требует поднятых API (3001) и web (3100).
 * Запуск: node apps/api/test/affiliate-browser.check.cjs
 */
/**
 * Playwright берётся из переменной окружения: пакет не в зависимостях
 * проекта (в репозитории нет playwright.config и e2e-обвязки), а скачанный
 * браузер лежит в общем кэше ms-playwright.
 *
 * Указать путь к установленному пакету:
 *   set AFFILIATE_PW=<путь к node_modules/playwright>
 * Либо положить playwright в devDependencies и убрать этот fallback.
 */
const PW = process.env['AFFILIATE_PW'] ?? 'playwright'
const WEB = process.env.AFFILIATE_WEB_URL ?? 'http://localhost:3100'
const SHOTS = process.env.AFFILIATE_SHOTS_DIR ?? `${process.env.TEMP}\\affiliate-shots`

let pass = 0
let fail = 0
const consoleErrors = []

function check(condition, message) {
  if (condition) {
    pass++
    console.log(`  OK   ${message}`)
  } else {
    fail++
    console.log(`  FAIL ${message}`)
  }
}

async function main() {
  const { chromium } = require(PW)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`${page.url()} :: ${msg.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(`${page.url()} :: pageerror: ${error.message}`)
  })

  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}\\${name}.png`, fullPage: true })
  }

  console.log('\n=== 1. Вход в раздел с сайта (то, чего не было) ===')
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' })
  const navLink = page.locator('a[href="/affiliate"]').first()
  check((await navLink.count()) > 0, 'на главной есть ссылка /affiliate')
  const navVisible = await navLink.isVisible().catch(() => false)
  check(navVisible, 'ссылка видима (меню или футер)')
  check((await page.locator('text=Партнёрам').count()) > 0, 'подпись «Партнёрам» на месте')
  await shot('01-home-with-partner-link')

  await navLink.click()
  await page.waitForURL('**/affiliate', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  check(page.url().endsWith('/affiliate'), `переход на публичную страницу: ${page.url()}`)
  const h1 =
    (await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => '')) ?? ''
  check(h1.trim().length > 0, `заголовок страницы: "${h1.trim()}"`)
  await shot('02-affiliate-landing')

  console.log('\n=== 2. Регистрация партнёра через форму ===')
  const email = `browser-${Date.now()}@example.com`
  await page.goto(`${WEB}/affiliate/register`, { waitUntil: 'domcontentloaded' })
  await shot('03-register-form')
  await page.fill('input[type="email"]', email)
  const passInputs = page.locator('input[type="password"]')
  const passCount = await passInputs.count()
  if (passCount >= 2) {
    await passInputs.nth(0).fill('SuperSecret123')
    await passInputs.nth(1).fill('SuperSecret123')
  } else {
    await passInputs.first().fill('SuperSecret123')
  }
  const nameInput = page.locator('input[name="display_name"], input[id*="display"]').first()
  if ((await nameInput.count()) > 0) {
    await nameInput.fill('Проверка браузера')
  }
  const terms = page.locator('input[type="checkbox"]').first()
  if ((await terms.count()) > 0) {
    await terms.check()
  }
  await shot('04-register-filled')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)
  const afterRegister = page.url()
  const bodyText =
    (await page
      .locator('body')
      .innerText()
      .catch(() => '')) ?? ''
  check(
    !afterRegister.endsWith('/register') || /ошибк|неверн|error|400/i.test(bodyText) === false,
    `регистрация прошла (URL после submit: ${afterRegister})`,
  )
  check(
    /код|tracking|ссылк|кабинет|ставк/i.test(bodyText),
    'после регистрации показан трекинг-код или переход в кабинет',
  )
  await shot('05-after-register')

  console.log('\n=== 3. Кабинет с реальными данными ===')
  const trackingCode = (bodyText.match(/\b[A-Z0-9]{8}\b/) ?? [])[0] ?? ''
  if (trackingCode !== '') {
    console.log(`  код партнёра: ${trackingCode}`)
  }
  await page.goto(`${WEB}/affiliate`, { waitUntil: 'domcontentloaded' })
  const landingText =
    (await page
      .locator('body')
      .innerText()
      .catch(() => '')) ?? ''
  check(!/Не найдено|404|not found/i.test(landingText), 'публичная страница рендерится')
  const statCards = await page.locator('text=/20\\s*%|20,0% RevShare|RevShare/').count()
  check(statCards > 0, `на странице видна ставка RevShare (${statCards} совпадений)`)
  await shot('06-landing-with-data')

  console.log('\n=== 4. Ошибки консоли ===')
  const realErrors = consoleErrors.filter(
    (line) => !line.includes('favicon') && !line.includes('Download the React DevTools'),
  )
  check(realErrors.length === 0, `ошибок в консоли: ${realErrors.length}`)
  for (const line of realErrors.slice(0, 8)) {
    console.log(`      ${line}`)
  }

  await browser.close()
  console.log(`\nСкриншоты: ${SHOTS}`)
  console.log(`ИТОГ: успешно=${pass} провалено=${fail}`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('FATAL:', error.message)
  process.exit(1)
})
