# QA Checklist – Casino Platform

## Auth
- [ ] Register → email arrives → verify → login OK
- [ ] Invalid password → INVALID_CREDENTIALS
- [ ] Refresh rotates token, old invalidated
- [ ] Logout revokes session
- [ ] Forgot / reset → all sessions revoked
- [ ] Google OAuth creates user, email_verified=true
- [ ] Telegram hash verification works

## Wallet / Payments
- [ ] Credit/debit balance correct
- [ ] Duplicate idempotency_key → no double credit
- [ ] Insufficient funds → 422
- [ ] Rukassa deposit → callback → credit → duplicate callback ignored
- [ ] NOWPayments deposit → actually_paid credited
- [ ] Withdrawal → funds locked → admin approve → balance debited / reject → unlock
- [ ] KYC 5000 RUB limit enforced on deposit
- [ ] Withdrawal always requires KYC

## Casino
- [ ] Game launch → session_token created → iframe opens
- [ ] Bet → balance debited, ledger entry created
- [ ] Win → balance credited
- [ ] Rollback → funds returned
- [ ] Duplicate bet_transaction → idempotent
- [ ] Session expire after 2h inactivity
- [ ] Catalog filters / search / pagination

## Support / Referrals
- [ ] User creates ticket → admin sees → reply → user notified
- [ ] Internal notes not visible to user
- [ ] Referral code generated on register
- [ ] Daily GGR cron → reward credited
- [ ] Notifications list / read / unread_count

## Admin
- [ ] Admin login separate from user
- [ ] Roles guard blocks user access to /admin/*
- [ ] User block → sessions invalidated
- [ ] KYC approve/reject → user notified
- [ ] Balance credit/debit → audit_log written
- [ ] All admin actions in audit_logs
