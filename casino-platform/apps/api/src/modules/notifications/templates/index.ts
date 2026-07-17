// Email templates – Part 6
// verify_email, password_reset, kyc_approved, kyc_rejected, kyc_resubmission,
// deposit_completed, withdrawal_completed, withdrawal_rejected,
// support_reply, referral_reward, account_blocked, account_unblocked
// Use handlebars / mjml in production. Stub for now.
export const emailTemplates = {
  email_verification: (link: string) => `Подтвердите email: ${link}`,
  password_reset: (link: string) => `Сброс пароля: ${link}`,
  kyc_approved: () => `Верификация пройдена!`,
  kyc_rejected: (reason: string) => `KYC отклонён: ${reason}`,
  deposit_completed: (amount: string, currency: string) => `Баланс пополнен на ${amount} ${currency}`,
  withdrawal_completed: (amount: string, currency: string) => `Вывод ${amount} ${currency} обработан`,
  support_reply: (ticketId: string) => `Ответ по обращению #${ticketId}`,
  referral_reward: (amount: string, currency: string) => `Реферальное вознаграждение ${amount} ${currency}`,
}
