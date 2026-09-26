/**
 * Rich HTML-шаблоны писем (GAP-02 post-MVP).
 *
 * Фиксирует контракт для всех четырёх писем (email-верификация, сброс пароля,
 * withdrawal-reminder, generic notification):
 * 1) html содержит ссылку/данные письма (кнопка + текстовая ссылка);
 * 2) plain-text fallback присутствует и дословно сохраняет прежний текст писем;
 * 3) секреты/токены не попадают в subject (subject виден в списке писем);
 * 4) в html/text/subject нет literal "undefined" (пропущенный параметр шаблона);
 * 5) вёрстка: inline-стили, таблица 600px, без внешних ресурсов
 *    (никаких <img>/<link>/<script>/url()/@import — email-клиенты);
 * 6) пользовательские значения экранируются (инъекция разметки исключена).
 */
import { describe, it, expect } from 'vitest'

import {
  renderNotificationEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
  renderWithdrawalReminderEmail,
  type EmailTemplate,
} from '../src/queues/templates'

const VERIFY_LINK = 'http://localhost:3000/verify-email?token=abc123DEF'
const RESET_LINK = 'http://localhost:3000/reset-password?token=tok_456&src=mail'

/** Проверки вёрстки, общие для всех шаблонов. */
function expectEmailLayout(html: string): void {
  expect(html).toContain('lang="ru"')
  expect(html).toContain('max-width:600px')
  expect(html).toContain('Casino')
  // никаких внешних ресурсов — только inline-стили
  expect(html).not.toMatch(/<img/i)
  expect(html).not.toMatch(/<link\s/i)
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toMatch(/url\(/i)
  expect(html).not.toMatch(/@import/i)
  expect(html).not.toMatch(/<style/i)
}

function expectNoUndefined(mail: EmailTemplate): void {
  expect(mail.subject).not.toContain('undefined')
  expect(mail.text).not.toContain('undefined')
  expect(mail.html).not.toContain('undefined')
}

describe('email HTML templates (GAP-02 post-MVP)', () => {
  describe('renderVerificationEmail', () => {
    const mail = renderVerificationEmail(VERIFY_LINK)

    it('subject — прежний, ссылка есть в html (кнопка и текстом) и в text', () => {
      expect(mail.subject).toBe('Подтвердите ваш email')
      expect(mail.html).toContain(`href="${VERIFY_LINK}"`)
      expect(mail.html).toContain('Подтвердить email')
      expect(mail.text).toContain(VERIFY_LINK)
    })

    it('plain-text fallback дословно повторяет прежний текст', () => {
      expect(mail.text).toBe(
        `Здравствуйте!\n\nПодтвердите ваш email по ссылке:\n${VERIFY_LINK}\n\nСсылка действительна 24 часа.`,
      )
    })

    it('токен не попадает в subject', () => {
      expect(mail.subject).not.toContain('abc123DEF')
    })

    it('вёрстка корректна, undefined отсутствует', () => {
      expectEmailLayout(mail.html)
      expectNoUndefined(mail)
    })
  })

  describe('renderPasswordResetEmail', () => {
    const mail = renderPasswordResetEmail(RESET_LINK)

    it('subject — прежний, ссылка есть в html и в text', () => {
      expect(mail.subject).toBe('Сброс пароля')
      expect(mail.html).toContain('href="http://localhost:3000/reset-password?token=tok_456&amp;src=mail"')
      expect(mail.html).toContain('Сбросить пароль')
      expect(mail.text).toContain(RESET_LINK)
    })

    it('plain-text fallback дословно повторяет прежний текст', () => {
      expect(mail.text).toBe(
        `Вы запросили сброс пароля.\nСсылка для сброса:\n${RESET_LINK}\n\nЕсли это не вы — проигнорируйте письмо.`,
      )
    })

    it('секрет (токен) не попадает в subject', () => {
      expect(mail.subject).not.toContain('tok_456')
      expect(mail.subject).not.toContain('src=mail')
    })

    it('& в ссылке экранируется в html, но остаётся сырым в text', () => {
      expect(mail.html).toContain('&amp;src=mail')
      expect(mail.html).not.toContain('&src=mail')
      expect(mail.text).toContain('&src=mail')
    })

    it('вёрстка корректна, undefined отсутствует', () => {
      expectEmailLayout(mail.html)
      expectNoUndefined(mail)
    })
  })

  describe('renderWithdrawalReminderEmail', () => {
    const mail = renderWithdrawalReminderEmail({
      withdrawalId: 'wd_100500',
      amount: '100.50',
      currency: 'RUB',
      hoursPending: 25,
    })

    it('subject и text — прежние; id есть в text и html', () => {
      expect(mail.subject).toBe('[Casino] Вывод RUB 100.50 в pending 25ч')
      expect(mail.text).toContain('wd_100500')
      expect(mail.text).toContain('все ещё в статусе pending')
      expect(mail.html).toContain('wd_100500')
      expect(mail.html).toContain('100.50 RUB')
    })

    it('id заявки не попадает в subject (виден в списке писем админа)', () => {
      expect(mail.subject).not.toContain('wd_100500')
    })

    it('вёрстка корректна, undefined отсутствует', () => {
      expectEmailLayout(mail.html)
      expectNoUndefined(mail)
    })
  })

  describe('renderNotificationEmail (generic)', () => {
    const mail = renderNotificationEmail({
      title: 'Ответ по обращению #42',
      message: 'Здравствуйте!\nВаш билет обработан.\n<script>alert(1)</script>',
    })

    it('subject = title, text = message без изменений (fallback прежнего поведения)', () => {
      expect(mail.subject).toBe('Ответ по обращению #42')
      expect(mail.text).toBe('Здравствуйте!\nВаш билет обработан.\n<script>alert(1)</script>')
    })

    it('html содержит сообщение с переносами строк, разметка в сообщении экранируется', () => {
      expect(mail.html).toContain('Ваш билет обработан.')
      expect(mail.html).toContain('<br />')
      expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(mail.html).not.toContain('<script>alert')
    })

    it('вёрстка корректна, undefined отсутствует', () => {
      expectEmailLayout(mail.html)
      expectNoUndefined(mail)
    })
  })
})
