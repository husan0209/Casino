import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
@Injectable()
export class ListGamesUseCase {
  async execute(q: any) {
    const page = parseInt(q.page)||1, perPage = Math.min(parseInt(q.per_page)||24, 100)
    const where:any = { isEnabled: true, provider: { isEnabled: true } }
    if (q.category) where.category = q.category
    if (q.type) where.type = q.type
    if (q.provider) where.provider = { ...where.provider, slug: q.provider }
    if (q.is_featured === 'true') where.isFeatured = true
    if (q.is_new === 'true') where.isNew = true
    if (q.is_popular === 'true') where.isPopular = true
    if (q.search) where.OR = [
      { name: { contains: q.search, mode: 'insensitive' }},
      { nameRu: { contains: q.search, mode: 'insensitive' }},
    ]
    let orderBy:any = { sortOrder: 'asc' }
    if (q.sort === 'popular') orderBy = { launchCount: 'desc' }
    if (q.sort === 'new') orderBy = { createdAt: 'desc' }
    if (q.sort === 'name_asc') orderBy = { name: 'asc' }
    if (q.sort === 'name_desc') orderBy = { name: 'desc' }
    const [items, total] = await Promise.all([
      prisma.game.findMany({
        where, skip: (page-1)*perPage, take: perPage, orderBy,
        select: { id:true, slug:true, name:true, nameRu:true, category:true, type:true, thumbnailUrl:true,
          isFeatured:true, isNew:true, isPopular:true, hasDemo:true, rtp:true, volatility:true,
          provider:{ select:{ slug:true, name:true }}}
      }),
      prisma.game.count({ where })
    ])
    return { items, meta: { page, perPage, total, totalPages: Math.ceil(total/perPage), hasNext: page*perPage < total, hasPrev: page > 1 }}
  }
}
