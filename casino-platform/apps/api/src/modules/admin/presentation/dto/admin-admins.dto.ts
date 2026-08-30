import { z } from 'zod'

// GAP-21: создание администратора (superadmin only). role — закрытый enum.
export const CreateAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  first_name: z.string().min(1).max(64).optional(),
  last_name: z.string().min(1).max(64).optional(),
  role: z.enum(['admin', 'superadmin']),
})
export type CreateAdminDto = z.infer<typeof CreateAdminSchema>
