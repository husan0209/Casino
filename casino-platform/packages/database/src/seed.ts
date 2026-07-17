import { prisma } from './index'
import * as argon2 from 'argon2'
import { randomBytes } from 'crypto'
async function main(){
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'superadmin@casino.example.com'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'dev_superadmin_password_123'
  let admin = await prisma.adminUser.findUnique({ where: { email: adminEmail }})
  if(!admin){
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 })
    admin = await prisma.adminUser.create({ data:{ email: adminEmail, passwordHash, role:'superadmin', firstName:'Super', lastName:'Admin', isActive:true }})
    console.log('Seeded admin', admin.email)
  }
  const demoProvider = await prisma.gameProvider.upsert({
    where:{ slug:'demo-provider' },
    update:{},
    create:{ slug:'demo-provider', name:'Demo Provider', type:'slots', isEnabled:true, sortOrder:0 }
  })
  const games = [
    {slug:'demo-sweet-fruits', name:'Sweet Fruits', nameRu:'Сладкие фрукты'},
    {slug:'demo-lucky-sevens', name:'Lucky Sevens', nameRu:'Счастливые семёрки'},
    {slug:'demo-book-of-demo', name:'Book of Demo', nameRu:'Книга демо'},
  ]
  for(const g of games){
    await prisma.game.upsert({
      where:{ slug:g.slug },
      update:{},
      create:{ providerId: demoProvider.id, externalGameId:g.slug, slug:g.slug, name:g.name, nameRu:g.nameRu, type:'slot', category:'slots', isEnabled:true, isFeatured:true, isPopular:true, hasDemo:true, rtp:96.5, supportedCurrencies:['RUB','USDT_TRC20'] }
    })
  }
  await prisma.gameProvider.update({ where:{ id: demoProvider.id }, data:{ gameCount: games.length }})
  console.log('Seeded demo games')
  const settings = [
    { key:'kyc_deposit_limit_rub', value:'5000', type:'number' as const, category:'kyc'},
    { key:'min_deposit_rub', value:'100', type:'number' as const, category:'payments'},
    { key:'referral_reward_rate', value:'0.05', type:'number' as const, category:'referral'},
    { key:'referral_enabled', value:'true', type:'boolean' as const, category:'referral'},
  ]
  for(const s of settings){ await prisma.systemSetting.upsert({ where:{ key:s.key }, update:{ value:s.value }, create:s })}
  console.log('Seed OK')
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect())
