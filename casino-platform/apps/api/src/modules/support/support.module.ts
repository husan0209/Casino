import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SupportController } from './presentation/controllers/support.controller'
import { SupportAdminController } from './presentation/controllers/support-admin.controller'
import { PrismaSupportRepository } from './infrastructure/repositories/support.prisma'
import { SUPPORT_REPOSITORY } from './domain/repositories/support.repository'
import { CreateTicketUseCase } from './application/use-cases/create-ticket.use-case'
import { ListUserTicketsUseCase } from './application/use-cases/list-user-tickets.use-case'
import { GetTicketUseCase } from './application/use-cases/get-ticket.use-case'
import { SendMessageUseCase } from './application/use-cases/send-message.use-case'
import { CloseTicketUseCase } from './application/use-cases/close-ticket.use-case'

@Module({
  imports: [AuthModule],
  controllers: [SupportController, SupportAdminController],
  providers: [
    { provide: SUPPORT_REPOSITORY, useClass: PrismaSupportRepository },
    CreateTicketUseCase, ListUserTicketsUseCase, GetTicketUseCase,
    SendMessageUseCase, CloseTicketUseCase,
  ],
})
export class SupportModule {}
