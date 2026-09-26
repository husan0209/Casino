/**
 * Rich HTML-шаблоны писем (GAP-02, post-MVP) + обязательный plain-text fallback.
 *
 * Требования email-вёрстки (email-клиенты режут всё внешнее):
 * - только inline-стили: никаких внешних CSS, картинок, шрифтов и <script>;
 * - простой table-layout, max-width 600px, системные шрифты (Arial/Helvetica);
 * - нейтральный брендинг: шапка «Casino» (SMTP_FROM_NAME конфигурируем на операторе,
 *   в письме используется фиксированное имя — см. INDEX.md §6.3 трекер GAP-02);
 * - язык писем — русский (унаследован от прежних plain-text шаблонов);
 * - plain-text fallback обязателен и дословно повторяет прежний текст писем:
 *   клиенты без HTML (и спам-фильтры) получают тот же текст, что и раньше.
 *
 * Все билдеры чистые (без I/O) — покрываются юнит-спекой test/email-html-templates.spec.ts.
 */

/** Результат рендера письма: subject + text (fallback) + html. */
export interface EmailTemplate {
  subject: string
  text: string
  html: string
}

/** Экранирование значений в HTML-контексте (порядок важен: & первым). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Кнопка-ссылка: единственный допустимый «дизайн» — inline-стили на <a>. */
function actionButton(href: string, label: string): string {
  const safeHref = escapeHtml(href)
  const style =
    'display:inline-block;padding:12px 28px;background-color:#1f2937;color:#ffffff;' +
    'text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;'
  return `<a href="${safeHref}" style="${style}">${label}</a>`
}

/** Ссылка текстом (fallback, если клиент не рендерит кнопку). */
function asTextLink(href: string): string {
  const safeHref = escapeHtml(href)
  return `<a href="${safeHref}" style="color:#2563eb;word-break:break-all;">${safeHref}</a>`
}

/** Общий каркас: таблица 600px, inline-стили, без внешних ресурсов. */
function renderShell(input: { title: string; bodyHtml: string; footerNote: string }): string {
  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:20px 32px;border-bottom:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;">
                <span style="font-size:20px;font-weight:bold;color:#111827;">Casino</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#374151;">
                <h1 style="margin:0 0 16px;font-size:18px;line-height:1.4;color:#111827;">${input.title}</h1>
                ${input.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;">
                ${input.footerNote}
              </td>
            </tr>
          </table>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td style="padding:12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#9ca3af;">
                Это письмо отправлено автоматически — отвечать на него не нужно.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Email-верификация (auth.register): subject/text — прежние, html — новый. */
export function renderVerificationEmail(link: string): EmailTemplate {
  return {
    subject: 'Подтвердите ваш email',
    text: `Здравствуйте!\n\nПодтвердите ваш email по ссылке:\n${link}\n\nСсылка действительна 24 часа.`,
    html: renderShell({
      title: 'Подтверждение email',
      bodyHtml:
        '<p style="margin:0 0 16px;">Здравствуйте!</p>' +
        '<p style="margin:0 0 24px;">Подтвердите ваш email, нажав на кнопку ниже.</p>' +
        `<p style="margin:0 0 24px;">${actionButton(link, 'Подтвердить email')}</p>` +
        '<p style="margin:0;">Если кнопка не работает, скопируйте ссылку в браузер:<br />' +
        `${asTextLink(link)}</p>`,
      footerNote: 'Ссылка действительна 24 часа.',
    }),
  }
}

/** Сброс пароля (auth.forgot-password): subject/text — прежние, html — новый. */
export function renderPasswordResetEmail(link: string): EmailTemplate {
  return {
    subject: 'Сброс пароля',
    text: `Вы запросили сброс пароля.\nСсылка для сброса:\n${link}\n\nЕсли это не вы — проигнорируйте письмо.`,
    html: renderShell({
      title: 'Сброс пароля',
      bodyHtml:
        '<p style="margin:0 0 16px;">Вы запросили сброс пароля.</p>' +
        '<p style="margin:0 0 24px;">Нажмите на кнопку, чтобы задать новый пароль.</p>' +
        `<p style="margin:0 0 24px;">${actionButton(link, 'Сбросить пароль')}</p>` +
        '<p style="margin:0;">Если кнопка не работает, скопируйте ссылку в браузер:<br />' +
        `${asTextLink(link)}</p>`,
      footerNote: 'Если это не вы — проигнорируйте письмо: пароль останется прежним.',
    }),
  }
}

/** Напоминание админам о зависшем выводе (maintenance withdrawal-reminder, ТЗ ч.3 §13). */
export function renderWithdrawalReminderEmail(input: {
  withdrawalId: string
  amount: string
  currency: string
  hoursPending: number
}): EmailTemplate {
  const id = escapeHtml(input.withdrawalId)
  const amount = escapeHtml(input.amount)
  const currency = escapeHtml(input.currency)
  return {
    subject: `[Casino] Вывод ${input.currency} ${input.amount} в pending ${input.hoursPending}ч`,
    text: `Заявка на вывод ${input.withdrawalId} (${input.currency} ${input.amount}) от пользователя ${input.hoursPending} ч назад\nвсе ещё в статусе pending. Проверьте Admin → Finance → Withdrawals.`,
    html: renderShell({
      title: 'Заявка на вывод ожидает обработки',
      bodyHtml:
        '<p style="margin:0 0 16px;">Заявка на вывод <b>' +
        `${amount} ${currency}</b> находится в статусе pending уже ${input.hoursPending} ч.</p>` +
        `<p style="margin:0 0 16px;">Заявка: <b>#${id}</b></p>` +
        '<p style="margin:0;">Проверьте Admin → Finance → Withdrawals.</p>',
      footerNote: 'Напоминание отправляется раз в сутки, пока заявка остаётся в pending.',
    }),
  }
}

/** Generic-уведомление (notifications module): subject/text — как раньше (title/message), html — брендированная обёртка. */
export function renderNotificationEmail(input: { title: string; message: string }): EmailTemplate {
  const message = escapeHtml(input.message).replace(/\r?\n/g, '<br />')
  return {
    subject: input.title,
    text: input.message,
    html: renderShell({
      title: escapeHtml(input.title),
      bodyHtml: `<p style="margin:0;">${message}</p>`,
      footerNote: 'Вы получаете это уведомление по настройкам вашего аккаунта.',
    }),
  }
}
