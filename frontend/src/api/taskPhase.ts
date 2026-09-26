import { apiPaths } from '../constants/apiPaths';
import { Project, TaskPhase } from '../types';
import { getData, patchData, postData } from '../utils/request';

export interface PhaseScheduleChange {
  id: number;
  plannedStartDate: string;
  plannedEndDate: string;
}

export interface RescheduleResult {
  phases: TaskPhase[];
  project: Project;
  delayed: boolean;
  delayCleared: boolean;
}

export const taskPhaseApi = {
  listByProject: (projectId: number) => getData<TaskPhase[]>(`${apiPaths.taskPhases}/project/${projectId}`),
  create: (payload: Partial<TaskPhase>) => postData<TaskPhase>(apiPaths.taskPhases, payload),
  reschedule: (projectId: number, changes: PhaseScheduleChange[]) =>
    patchData<RescheduleResult>(
      `${apiPaths.taskPhases}/project/${projectId}/schedule`,
      { changes },
      { skipErrorMessage: true }
    ),
  updateProgress: (id: number, percentComplete: number) =>
    patchData<TaskPhase>(`${apiPaths.taskPhases}/${id}/progress`, { percentComplete }),
  block: (id: number) => patchData<TaskPhase>(`${apiPaths.taskPhases}/${id}/block`),
  unblock: (id: number) => patchData<TaskPhase>(`${apiPaths.taskPhases}/${id}/unblock`)
};
