import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../models/auditLog.entity';
import { Project } from '../models/project.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { TaskPhaseController } from '../controllers/taskPhase.controller';
import { AuditService } from '../services/audit.service';
import { TaskPhaseService } from '../services/taskPhase.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskPhase, Project, AuditLog])],
  controllers: [TaskPhaseController],
  providers: [TaskPhaseService, AuditService]
})
export class TaskPhaseRoutesModule {}
