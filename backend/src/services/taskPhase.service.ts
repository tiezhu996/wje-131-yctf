import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../models/project.entity';
import { TaskPhase } from '../models/taskPhase.entity';
import { PhaseStatus, ProjectStatus } from '../types/enums';
import { PhaseScheduleChange, validateReschedule } from '../utils/scheduleValidator';
import { AuditService } from './audit.service';

export interface RescheduleResult {
  phases: TaskPhase[];
  project: Project;
  delayed: boolean;
  delayCleared: boolean;
}

@Injectable()
export class TaskPhaseService {
  constructor(
    @InjectRepository(TaskPhase) private readonly phaseRepository: Repository<TaskPhase>,
    @InjectRepository(Project) private readonly projectRepository: Repository<Project>,
    private readonly dataSource: DataSource,
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

  /**
   * 批量调整同一项目下阶段的计划起止日期。
   * 规则：
   * - 已归档项目的阶段、已完成阶段不允许调整；
   * - 调整后的区间不得与同项目其他阶段（含本次一起调整的阶段）重叠，
   *   相邻（一端结束日 = 另一端开始日）允许；
   * - 只要有任一阶段越过项目计划竣工日期，项目立即进入延期预警；
   *   全部回到计划竣工日期以内时恢复为进行中；
   * - 任一规则不通过，本次改动整体不写入。
   */
  async reschedule(projectId: number, changes: PhaseScheduleChange[], actorId = 1): Promise<RescheduleResult> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
      relations: ['phases']
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    // 纯规则校验，先于任何写操作；冲突类问题以 409 返回
    let validation;
    try {
      validation = validateReschedule(project, project.phases, changes);
    } catch (error) {
      const message = error instanceof Error ? error.message : '排期校验未通过';
      if (message.includes('冲突')) {
        throw new ConflictException(message);
      }
      throw new BadRequestException(message);
    }

    const { exceedsPlannedEnd, wasDelayed } = validation;

    // 全部校验通过后才开启事务写入，任何失败都会回滚，保证本次改动一点都不写
    const saved = await this.dataSource.transaction(async (manager) => {
      for (const change of changes) {
        await manager.update(TaskPhase, change.id, {
          plannedStartDate: change.plannedStartDate,
          plannedEndDate: change.plannedEndDate
        });
      }
      if (exceedsPlannedEnd) {
        project.status = ProjectStatus.Delayed;
      } else if (wasDelayed) {
        project.status = ProjectStatus.InProgress;
      }
      const savedProject = await manager.save(project);
      const list = await manager.find(TaskPhase, {
        where: { projectId },
        relations: ['subTasks'],
        order: { plannedStartDate: 'ASC' }
      });
      return { savedProject, list };
    });

    for (const change of changes) {
      const phase = project.phases.find((item) => item.id === change.id)!;
      await this.auditService.record('phase.schedule.update', 'TaskPhase', change.id, actorId, {
        projectId,
        from: { plannedStartDate: phase.plannedStartDate, plannedEndDate: phase.plannedEndDate },
        to: { plannedStartDate: change.plannedStartDate, plannedEndDate: change.plannedEndDate }
      });
    }
    if (exceedsPlannedEnd !== wasDelayed) {
      await this.auditService.record(
        exceedsPlannedEnd ? 'project.delay.flagged' : 'project.delay.cleared',
        'Project',
        projectId,
        actorId,
        { status: saved.savedProject.status, plannedEndDate: project.plannedEndDate }
      );
    }

    return {
      phases: saved.list,
      project: saved.savedProject,
      delayed: exceedsPlannedEnd,
      delayCleared: wasDelayed && !exceedsPlannedEnd
    };
  }
}
