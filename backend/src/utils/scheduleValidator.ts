import { PhaseStatus, ProjectStatus } from '../types/enums';

export interface PhaseScheduleChange {
  id: number;
  plannedStartDate: string;
  plannedEndDate: string;
}

export interface SchedulePhaseLike {
  id: number;
  name: string;
  plannedStartDate: string;
  plannedEndDate: string;
  status: PhaseStatus;
}

export interface ScheduleProjectLike {
  id: number;
  name: string;
  plannedEndDate: string;
  status: ProjectStatus;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleValidation {
  /** 按阶段 ID 索引的调整后区间（未提交调整的阶段沿用原区间） */
  plannedOf: Map<number, { start: string; end: string }>;
  /** 调整后是否有阶段越过项目计划竣工日期 */
  exceedsPlannedEnd: boolean;
  /** 调整前项目是否已处于延期预警 */
  wasDelayed: boolean;
}

/**
 * 校验一批阶段排期调整。任何一条不通过都抛出异常，调用方据此保证整体不写入。
 */
export function validateReschedule(
  project: ScheduleProjectLike,
  phases: SchedulePhaseLike[],
  changes: PhaseScheduleChange[]
): ScheduleValidation {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('没有需要保存的排期调整');
  }

  if (project.status === ProjectStatus.Archived) {
    throw new Error(`项目「${project.name}」已归档，不能再调整阶段排期`);
  }

  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const changeById = new Map<number, PhaseScheduleChange>();

  for (const change of changes) {
    if (!change || typeof change.id !== 'number' || !change.plannedStartDate || !change.plannedEndDate) {
      throw new Error('排期数据不完整：需要阶段 ID、计划开始日期和计划结束日期');
    }
    if (!DATE_PATTERN.test(change.plannedStartDate) || !DATE_PATTERN.test(change.plannedEndDate)) {
      throw new Error('日期格式不正确，应为 YYYY-MM-DD');
    }
    if (change.plannedStartDate > change.plannedEndDate) {
      throw new Error(`阶段 #${change.id} 的计划开始日期不能晚于计划结束日期`);
    }
    if (changeById.has(change.id)) {
      throw new Error(`阶段 #${change.id} 的排期被重复提交`);
    }

    const phase = phaseById.get(change.id);
    if (!phase) {
      throw new Error(`阶段 #${change.id} 不属于项目「${project.name}」，不能在本项目调整`);
    }
    if (phase.status === PhaseStatus.Completed) {
      throw new Error(`阶段「${phase.name}」已完成，不允许再调整排期`);
    }
    changeById.set(change.id, change);
  }

  // 调整后区间：提交了调整的阶段用新区间，其余沿用原区间
  const plannedOf = new Map<number, { start: string; end: string }>();
  for (const phase of phases) {
    const change = changeById.get(phase.id);
    plannedOf.set(
      phase.id,
      change
        ? { start: change.plannedStartDate, end: change.plannedEndDate }
        : { start: phase.plannedStartDate, end: phase.plannedEndDate }
    );
  }

  // 两两比对：区间端点相接允许（一端结束日 = 另一端开始日），相互压到则冲突
  for (let i = 0; i < phases.length; i += 1) {
    const current = plannedOf.get(phases[i].id)!;
    for (let j = 0; j < i; j += 1) {
      const other = plannedOf.get(phases[j].id)!;
      const overlaps = current.start <= other.end && other.start <= current.end;
      if (overlaps) {
        throw new Error(
          `阶段「${phases[i].name}」(${current.start} ~ ${current.end}) 与阶段「${phases[j].name}」(${other.start} ~ ${other.end}) 的排期冲突，请调整后再保存`
        );
      }
    }
  }

  const exceedsPlannedEnd = phases.some((phase) => plannedOf.get(phase.id)!.end > project.plannedEndDate);

  return {
    plannedOf,
    exceedsPlannedEnd,
    wasDelayed: project.status === ProjectStatus.Delayed
  };
}
