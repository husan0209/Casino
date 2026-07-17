export interface RegisterInput { email: string; password: string; referralCode?: string; ip?: string; userAgent?: string }
export interface RegisterResult { message: string; verificationSent: boolean }
export interface LoginInput { email: string; password: string; ip?: string; userAgent?: string }
export interface LoginResult { accessToken: string; refreshToken: string; user: { id: string; email: string | null; role: string } }
export interface RefreshInput { refreshToken: string; ip?: string; userAgent?: string }
export interface RefreshResult { accessToken: string; refreshToken: string }
