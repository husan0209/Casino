/*
 * Автономный Node-скрипт проверки: CommonJS и без типов, поэтому правила
 * модулей приложения к нему неприменимы — require() и console здесь норма,
 * а type-aware правила видят только any.
 */
/* eslint-disable no-console, complexity, max-lines-per-function, max-depth, max-params, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
/**
 * Обход всех вкладок кабинета партнёра с реальной сессией.
 *
 * Проверяет, что каждая страница рендерится с данными, а не падает в
 * ErrorBox/500: регрессия @CurrentUser/@Query ломала ровно это, а снаружи
 * выглядело как «страница есть».
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

function check(condition, message) {
  if (condition) {
    pass++
    console.log(`  OK   ${message}`)
  } else {
    fail++
    console.log(`  FAIL ${message}`)
  }
}

/**
 * Признаки того, что страница упала: ErrorBox, HTTP 500, «что-то пошло не так».
 *
 * Регулярка с границами слов: без \b подстрока "500" находилась внутри
 * «вывода свыше 5000 ₽» и давала ложное срабатывание на странице настроек.
 */
function looksBroken(text) {
  return /\berror\b|\bошибк\w*|\b500\b|Internal Server|что-то пошло|unexpected/i.test(text)
}

async function main() {
  const { chromium } = require(PW)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  console.log('\n=== Регистрация партнёра ===')
  const email = `cabinet-${Date.now()}@example.com`
  await page.goto(`${WEB}/affiliate/register`, { waitUntil: 'domcontentloaded' })
  // Ждём именно поля формы: networkidle недостижим — на сайте висят фоновые
  // запросы (/auth/refresh у гостя), и goto с networkidle зависает.
  try {
    await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    console.log(`  ДИАГНОСТИКА: url=${page.url()}`)
    console.log(`  ДИАГНОСТИКА: inputs=${await page.locator('input').count()}`)
    const dump =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? ''
    console.log(`  ДИАГНОСТИКА: body="${dump.slice(0, 200).replace(/\n/g, ' | ')}"`)
    await page.screenshot({ path: `${SHOTS}\\debug-register-fail.png`, fullPage: true })
    throw new Error('поле email не появилось на /affiliate/register')
  }
  await page.fill('input[type="email"]', email)
  const passInputs = page.locator('input[type="password"]')
  const count = await passInputs.count()
  await passInputs.nth(0).fill('SuperSecret123')
  if (count >= 2) {
    await passInputs.nth(1).fill('SuperSecret123')
  }
  const terms = page.locator('input[type="checkbox"]').first()
  if ((await terms.count()) > 0) {
    await terms.check()
  }
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)
  if (page.url().includes('/register')) {
    const dump =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? ''
    console.log(
      `  ДИАГНОСТИКА (остались на регистрации): ${dump.slice(0, 300).replace(/\n/g, ' | ')}`,
    )
  }
  check(!page.url().includes('/register'), `регистрация прошла -> ${page.url()}`)

  const tabs = [
    ['Обзор', /Ставка|RevShare|20%/],
    ['Начисления', /Начислен|Начислений|нет начислений/i],
    ['Игроки', /игрок|Игрок/i],
    ['Настройки', /Настройки|Имя/i],
  ]

  console.log('\n=== Обход вкладок кабинета (кликами, как живой пользователь) ===')
  // Важно: переходы делаем кликом по вкладке, а не page.goto. Сессия партнёра
  // живёт в памяти store и не переживает жёсткую перезагрузку (в MVP нет
  // refresh-токена), поэтому page.goto уводил бы на страницу входа.
  await page.locator('text=Обзор').first().click()
  await page.waitForTimeout(1500)
  for (const [label, marker] of tabs) {
    const tab = page.locator(`nav >> text="${label}"`).first()
    if ((await tab.count()) > 0) {
      await tab.click()
      await page.waitForTimeout(1500)
    }
    const text =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? ''
    check(!/Вход в кабинет/.test(text), `${label}: остались в кабинете, а не на экране входа`)
    check(text.trim().length > 40, `${label}: страница не пустая (${text.trim().length} символов)`)
    check(!looksBroken(text), `${label}: нет признаков ошибки`)
    check(marker.test(text), `${label}: содержит ожидаемый контент`)
    await page.screenshot({ path: `${SHOTS}\\cab-${label}.png`, fullPage: true })
  }

  console.log('\n=== Прямой переход в кабинет без сессии ===')
  const fresh = await context.newPage()
  await fresh.goto(`${WEB}/affiliate/dashboard`, { waitUntil: 'domcontentloaded' })
  await fresh.waitForTimeout(1500)
  const freshUrl = fresh.url()
  const freshText =
    (await fresh
      .locator('body')
      .innerText()
      .catch(() => '')) ?? ''
  check(
    /вход|login|войти/i.test(freshText) ||
      freshUrl.includes('/login') ||
      freshUrl.endsWith('/affiliate'),
    `гость перенаправлен на вход (URL: ${freshUrl})`,
  )
  check(!/partner_id|undefined|NaN/.test(freshText), 'нет сырых значений в интерфейсе')
  await fresh.close()

  console.log('\n=== Ошибки JS ===')
  check(consoleErrors.length === 0, `необработанных ошибок JS: ${consoleErrors.length}`)
  for (const line of consoleErrors.slice(0, 5)) {
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
