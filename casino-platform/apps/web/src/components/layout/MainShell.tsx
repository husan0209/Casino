'use client'
import { LoginSheet } from '@/components/auth/LoginSheet'
import { AppHeader } from '@/components/layout/AppHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import { DepositReturnHandler } from '@/components/wallet/DepositReturnHandler'
import { DepositSheet } from '@/components/wallet/DepositSheet'
import { LaunchCurrencySheet } from '@/components/wallet/LaunchCurrencySheet'
import { WalletSwitcher } from '@/components/wallet/WalletSwitcher'

export function MainShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="pb-20 md:pb-8">{children}</main>
      <BottomNav />
      <LoginSheet />
      <DepositSheet />
      <WalletSwitcher />
      <LaunchCurrencySheet />
      <DepositReturnHandler />
    </>
  )
}
