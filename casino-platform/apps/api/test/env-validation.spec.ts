import { validateEnv } from '@casino/shared-config'

describe('Environment Validation', () => {
  const baseEnv = {
    NODE_ENV: 'development',
    APP_PORT: '3001',
    APP_URL: 'http://localhost:3000',
    ADMIN_URL: 'http://localhost:3002',
    DOMAIN: 'localhost',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/casino',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    CORS_ORIGINS: 'http://localhost:3000',
  }

  describe('Development environment', () => {
    it('accepts development placeholders', () => {
      const env = {
        ...baseEnv,
        NODE_ENV: 'development',
        RUKASSA_SECRET_KEY: 'dev_secret_key',
        NOWPAYMENTS_IPN_SECRET: 'dev_ipn_secret',
        DEMO_PROVIDER_ENABLED: 'true',
      }

      expect(() => validateEnv(env)).not.toThrow()
    })
  })

  describe('Test environment', () => {
    it('accepts test environment without provider secrets', () => {
      const env = {
        ...baseEnv,
        NODE_ENV: 'test',
      }

      expect(() => validateEnv(env)).not.toThrow()
    })
  })

  describe('Production environment', () => {
    const prodEnv = { ...baseEnv, NODE_ENV: 'production' }

    it('rejects production without RUKASSA_SECRET_KEY', () => {
      const env = {
        ...prodEnv,
        NOWPAYMENTS_IPN_SECRET: 'real_production_secret_1234567890abcdef',
      }

      expect(() => validateEnv(env)).toThrow()
    })

    it('rejects production without NOWPAYMENTS_IPN_SECRET', () => {
      const env = {
        ...prodEnv,
        RUKASSA_SECRET_KEY: 'real_production_secret_1234567890abcdef',
      }

      expect(() => validateEnv(env)).toThrow()
    })

    it('rejects production with DEMO_PROVIDER_ENABLED=true', () => {
      const env = {
        ...prodEnv,
        RUKASSA_SECRET_KEY: 'real_production_secret_rukassa',
        NOWPAYMENTS_IPN_SECRET: 'real_production_secret_nowpayments',
        DEMO_PROVIDER_ENABLED: 'true',
      }

      expect(() => validateEnv(env)).toThrow()
    })

    it('rejects known placeholder secrets in production', () => {
      const placeholders = [
        'dev_secret',
        'dev_',
        'your_secret',
        'change_me',
        'replace_me',
        'test_secret',
      ]

      for (const placeholder of placeholders) {
        const env = {
          ...prodEnv,
          RUKASSA_SECRET_KEY: placeholder,
          NOWPAYMENTS_IPN_SECRET: 'real_production_secret_1234567890abcdef',
        }

        expect(() => validateEnv(env)).toThrow(
          /appears to be a placeholder/,
        )
      }
    })

    it('accepts production with non-empty secrets and demo disabled', () => {
      const env = {
        ...prodEnv,
        RUKASSA_SECRET_KEY: 'real_production_secret_1234567890abcdefghij',
        NOWPAYMENTS_IPN_SECRET: 'real_production_secret_0987654321fedcbahgij',
        DEMO_PROVIDER_ENABLED: 'false',
      }

      expect(() => validateEnv(env)).not.toThrow()
    })

    // ── GAP-40: SMTP-пароль обязателен в проде, если SMTP-хост и пользователь заданы
    describe('GAP-40 SMTP_PASSWORD required in production', () => {
      it('rejects production with SMTP_HOST + SMTP_USER but no SMTP_PASSWORD', () => {
        const env = {
          ...prodEnv,
          RUKASSA_SECRET_KEY: 'real_production_secret_1234567890abcdefghij',
          NOWPAYMENTS_IPN_SECRET: 'real_production_secret_0987654321fedcbahgij',
          DEMO_PROVIDER_ENABLED: 'false',
          SMTP_HOST: 'smtp.resend.com',
          SMTP_USER: 'resend',
        }
        expect(() => validateEnv(env)).toThrow(/SMTP_PASSWORD/)
      })

      it('accepts production with full SMTP configuration', () => {
        const env = {
          ...prodEnv,
          RUKASSA_SECRET_KEY: 'real_production_secret_1234567890abcdefghij',
          NOWPAYMENTS_IPN_SECRET: 'real_production_secret_0987654321fedcbahgij',
          DEMO_PROVIDER_ENABLED: 'false',
          SMTP_HOST: 'smtp.resend.com',
          SMTP_USER: 'resend',
          SMTP_PASSWORD: 're_real_resend_api_key_xxxxxxxxx',
        }
        expect(() => validateEnv(env)).not.toThrow()
      })

      it('не требует SMTP_PASSWORD если SMTP_HOST не задан', () => {
        const env = {
          ...prodEnv,
          RUKASSA_SECRET_KEY: 'real_production_secret_1234567890abcdefghij',
          NOWPAYMENTS_IPN_SECRET: 'real_production_secret_0987654321fedcbahgij',
          DEMO_PROVIDER_ENABLED: 'false',
        }
        expect(() => validateEnv(env)).not.toThrow()
      })
    })
  })
})
