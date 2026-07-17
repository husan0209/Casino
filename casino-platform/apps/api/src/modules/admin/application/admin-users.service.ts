import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import * as argon2 from 'argon2'
@Injectable()
export class AdminUsersService {
  list(page=1, perPage=20) {
    return prisma.$transaction([
      prisma.adminUser.findMany({ skip:(page-1)*perPage, take:perPage, orderBy:{createdAt:'desc'}, select:{ id:true,email:true,firstName:true,lastName:true,role:true,isActive:true,lastLoginAt:true,createdAt:true } }),
      prisma.adminUser.count()
    ]).then(([items,total])=>({ items, total, page, perPage }))
  }
  async create(data: { email: string; password: string; first_name?: string; last_name?: string; role: 'admin'|'superadmin'}, createdBy?: string) {
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id, memoryCost:65536, timeCost:3, parallelism:4 })
    return prisma.adminUser.create({ data: { email: data.email.toLowerCase(), passwordHash, firstName: data.first_name, lastName: data.last_name, role: data.role, createdBy }})
  }
  async block(id: string) { return prisma.adminUser.update({ where:{id}, data:{ isActive:false }}) }
  async unblock(id: string) { return prisma.adminUser.update({ where:{id}, data:{ isActive:true }}) }
}
