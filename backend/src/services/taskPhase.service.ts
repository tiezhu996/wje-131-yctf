import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../models/project.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus } from '../types/enums';
import { PhaseSchedulePayload } from '../types/interfaces';
import { isDateOnly, toDateOnly } from '../utils/date';
import { AuditService } from './audit.service';

@Injectable()
export class TaskPhaseService {
  constructor(
    @InjectRepository(TaskPhase) private readonly phaseRepository: Repository<TaskPhase>,
    @InjectRepository(Project) private readonly projectRepository: Repository<Project>,
    private readonly auditService: AuditService
  ) {}

  async findByProject(projectId: number) {
    return this.phaseRepository.find({ where: { projectId }, relations: ['subTasks'], order: { plannedStartDate: 'ASC' } });
  }

  async create(payload: Partial<TaskPhase>, actorId = 1) {
    const phase = await this.phaseRepository.save(this.phaseRepository.create(payload));
    await this.auditService.record('phase.create', 'TaskPhase', phase.id, actorId, payload);
    return phase;
  }

  async updateProgress(id: number, percentComplete: number, actorId = 1) {
    const phase = await this.phaseRepository.findOneBy({ id });
    if (!phase) {
      throw new NotFoundException('任务阶段不存在');
    }
    phase.percentComplete = percentComplete;
    phase.status = percentComplete >= 100 ? PhaseStatus.Completed : PhaseStatus.InProgress;
    const updated = await this.phaseRepository.save(phase);
    await this.auditService.record('phase.progress.update', 'TaskPhase', id, actorId, { percentComplete });
    return updated;
  }

  async setBlocked(id: number, blocked: boolean, actorId = 1) {
    const phase = await this.phaseRepository.findOneBy({ id });
    if (!phase) {
      throw new NotFoundException('任务阶段不存在');
    }
    phase.status = blocked ? PhaseStatus.Blocked : PhaseStatus.InProgress;
    const updated = await this.phaseRepository.save(phase);
    await this.auditService.record(blocked ? 'phase.block' : 'phase.unblock', 'TaskPhase', id, actorId);
    return updated;
  }

  async updateSchedule(id: number, payload: PhaseSchedulePayload, actorId = 1) {
    const phase = await this.phaseRepository.findOneBy({ id });
    if (!phase) {
      throw new NotFoundException('任务阶段不存在');
    }
    const project = await this.projectRepository.findOneBy({ id: phase.projectId });
    if (!project) {
      throw new NotFoundException('阶段所属项目不存在');
    }

    const plannedStartDate = toDateOnly(payload?.plannedStartDate);
    const plannedEndDate = toDateOnly(payload?.plannedEndDate);
    if (!isDateOnly(plannedStartDate) || !isDateOnly(plannedEndDate) || plannedStartDate > plannedEndDate) {
      throw new BadRequestException('请提供有效的计划起止日期，且开始日期不能晚于结束日期');
    }

    if (phase.status === PhaseStatus.Completed) {
      throw new BadRequestException(`阶段「${phase.name}」已完成，不允许再调整排期`);
    }
    if (project.status === ProjectStatus.Archived || project.status === ProjectStatus.Completed) {
      const label = project.status === ProjectStatus.Archived ? '归档' : '完成';
      throw new BadRequestException(`项目已${label}，阶段排期不允许再调整`);
    }

    // 新排期不得压到同项目其他阶段的区间上；有冲突则整体拒绝，本次改动一点都不写
    const siblings = await this.phaseRepository.find({ where: { projectId: phase.projectId } });
    const conflicts = siblings.filter(
      (other) =>
        other.id !== phase.id &&
        plannedStartDate <= toDateOnly(other.plannedEndDate) &&
        plannedEndDate >= toDateOnly(other.plannedStartDate)
    );
    if (conflicts.length > 0) {
      const detail = conflicts
        .map((other) => `「${other.name}」（${toDateOnly(other.plannedStartDate)} ~ ${toDateOnly(other.plannedEndDate)}）`)
        .join('、');
      throw new BadRequestException(`新排期与同项目阶段 ${detail} 的区间冲突，本次修改未保存`);
    }

    const previous = {
      plannedStartDate: toDateOnly(phase.plannedStartDate),
      plannedEndDate: toDateOnly(phase.plannedEndDate)
    };
    phase.plannedStartDate = plannedStartDate;
    phase.plannedEndDate = plannedEndDate;
    const updated = await this.phaseRepository.save(phase);
    await this.auditService.record('phase.schedule.update', 'TaskPhase', id, actorId, {
      previous,
      next: { plannedStartDate, plannedEndDate }
    });

    await this.syncProjectDelayStatus(project, actorId);
    return updated;
  }

  /**
   * 任一阶段排期越过项目计划竣工日期 → 项目立即进入延期预警（Delayed）；
   * 全部回到范围内 → 自动解除预警，恢复到预警前的推进状态。
   */
  private async syncProjectDelayStatus(project: Project, actorId: number) {
    const phases = await this.phaseRepository.find({ where: { projectId: project.id } });
    const plannedEndDate = toDateOnly(project.plannedEndDate);
    const exceeded = phases.some((phase) => toDateOnly(phase.plannedEndDate) > plannedEndDate);

    if (exceeded && [ProjectStatus.Planning, ProjectStatus.InProgress].includes(project.status)) {
      project.status = ProjectStatus.Delayed;
      await this.projectRepository.save(project);
      await this.auditService.record('project.delay.flagged', 'Project', project.id, actorId, { plannedEndDate });
    } else if (!exceeded && project.status === ProjectStatus.Delayed) {
      project.status = project.progress > 0 ? ProjectStatus.InProgress : ProjectStatus.Planning;
      await this.projectRepository.save(project);
      await this.auditService.record('project.delay.resolved', 'Project', project.id, actorId, { plannedEndDate });
    }
  }
}
