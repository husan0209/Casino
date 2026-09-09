-- pre-launch hardening A2 (2026-09-04): game_transactions росла без индексов.
-- Таблица пустая на момент применения — CREATE INDEX без CONCURRENTLY безопасен
-- (CONCURRENTLY нельзя выполнить внутри транзакции миграции Prisma).
-- Index launch: создаём ДО приёма трафика, чтобы прод не встретил seq-scan.
CREATE INDEX "game_transactions_user_id_type_created_at_idx" ON "game_transactions"("user_id", "type", "created_at");
CREATE INDEX "game_transactions_created_at_idx" ON "game_transactions"("created_at");
CREATE INDEX "game_transactions_type_amount_idx" ON "game_transactions"("type", "amount");

-- История кошелька (wallet.controller: where walletAccountId + orderBy createdAt desc,
-- пагинация) — композит вместо seq-sort; walletAccountId-индекс остаётся для FK-join'ов.
CREATE INDEX "ledger_entries_wallet_account_id_created_at_idx" ON "ledger_entries"("wallet_account_id", "created_at");
