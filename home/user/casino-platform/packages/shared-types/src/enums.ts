export enum UserStatus {
  active = 'active',
  blocked = 'blocked',
  suspended = 'suspended',
}

export enum UserRole {
  user = 'user',
  admin = 'admin',
  superadmin = 'superadmin',
}

export enum KycStatus {
  not_started = 'not_started',
  pending = 'pending',
  approved = 'approved',
  rejected = 'rejected',
  requires_resubmission = 'requires_resubmission',
}

export enum PaymentStatus {
  pending = 'pending',
  processing = 'processing',
  completed = 'completed',
  failed = 'failed',
  cancelled = 'cancelled',
  expired = 'expired',
}

export enum PaymentProvider {
  rukassa = 'rukassa',
  nowpayments = 'nowpayments',
  manual = 'manual',
}

export enum GameCategory {
  slots = 'slots',
  live_casino = 'live_casino',
  table_games = 'table_games',
  instant_games = 'instant_games',
  other = 'other',
}
