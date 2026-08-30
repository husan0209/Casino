import { z } from 'zod'

// GAP-21: логин администратора.
export const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type AdminLoginDto = z.infer<typeof AdminLoginSchema>
