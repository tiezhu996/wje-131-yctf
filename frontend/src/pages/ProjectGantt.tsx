import { Alert, Button, DatePicker, Space, Tooltip, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { taskPhaseApi } from '../api/taskPhase';
import { EmptyState } from '../components/common/EmptyState';
import { ProgressBar } from '../components/common/ProgressBar';
import { StatusBadge } from '../components/common/StatusBadge';
import { UserAvatar } from '../components/common/UserAvatar';
import { useProject } from '../hooks/useProject';
import { useProjectStore } from '../stores/projectStore';
import { PhaseStatus, ProjectStatus, TaskPhase } from '../types';
import { formatDate } from '../utils/formatDate';

const DAY_MS = 1000 * 60 * 60 * 24;
const DATE_FORMAT = 'YYYY-MM-DD';

type ScheduleDraft = [Dayjs, Dayjs];

function dateOnly(value?: string | null) {
  return value ? dayjs(value).format(DATE_FORMAT) : '';
}

function barStyle(phase: TaskPhase, windowStart: number, windowSpan: number) {
  const start = dayjs(phase.plannedStartDate).valueOf();
  const end = dayjs(phase.plannedEndDate).valueOf();
  const left = ((start - windowStart) / windowSpan) * 100;
  const width = ((Math.max(end, start) - start + DAY_MS) / windowSpan) * 100;
  return {
    left: `${Math.max(0, Math.min(96, left))}%`,
    width: `${Math.max(3, Math.min(100, width))}%`
  };
}

export function ProjectGantt() {
  const id = Number(useParams().id || 1);
  const { project, loading, refresh } = useProject(id);
  const phases = project?.phases || [];
  const [drafts, setDrafts] = useState<Record<number, ScheduleDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const projectLocked = project?.status === ProjectStatus.Archived || project?.status === ProjectStatus.Completed;
  const projectPlannedEnd = dateOnly(project?.plannedEndDate);
  const windowStart = (project ? dayjs(project.startDate) : dayjs()).subtract(7, 'day').valueOf();
  const windowEnd = (project ? dayjs(project.plannedEndDate) : dayjs().add(180, 'day')).add(7, 'day').valueOf();
  const windowSpan = Math.max(windowEnd - windowStart, DAY_MS);

  const saveSchedule = async (phase: TaskPhase) => {
    const draft = drafts[phase.id];
    if (!draft) {
      return;
    }
    setSavingId(phase.id);
    try {
      await taskPhaseApi.updateSchedule(phase.id, {
        plannedStartDate: draft[0].format(DATE_FORMAT),
        plannedEndDate: draft[1].format(DATE_FORMAT)
      });
      message.success(`阶段「${phase.name}」排期已保存`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[phase.id];
        return next;
      });
      await refresh();
      if (useProjectStore.getState().current?.status === ProjectStatus.Delayed) {
        message.warning('阶段排期已越过计划竣工日期，项目进入延期预警');
      }
    } catch {
      // 冲突等校验失败由请求拦截器弹出错原因，本地保留草稿便于继续调整
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>{project?.name || '项目详情'} · 甘特图</Typography.Title>
          <Typography.Text type="secondary">{project?.address || '加载中'}</Typography.Text>
        </div>
        <Space size={12}>
          {project && <StatusBadge value={project.status} />}
          <Typography.Text type="secondary">计划竣工日期：{formatDate(project?.plannedEndDate)}</Typography.Text>
        </Space>
      </div>
      {project?.status === ProjectStatus.Delayed && (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message="延期预警"
          description={`存在阶段排期越过计划竣工日期（${formatDate(project.plannedEndDate)}），将阶段排期调整回范围内即可自动解除预警。`}
        />
      )}
      {projectLocked && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={`项目已${project?.status === ProjectStatus.Archived ? '归档' : '完成'}，各阶段排期不允许再调整`}
        />
      )}
      <div className="surface">
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          <ProgressBar value={project?.progress || 0} />
          {loading ? (
            <Typography.Text>加载中...</Typography.Text>
          ) : phases.length === 0 ? (
            <EmptyState description="暂无任务阶段" />
          ) : (
            phases.map((phase) => {
              const style = barStyle(phase, windowStart, windowSpan);
              const phaseLocked = projectLocked || phase.status === PhaseStatus.Completed;
              const draft = drafts[phase.id];
              const pickerValue: ScheduleDraft = draft || [dayjs(phase.plannedStartDate), dayjs(phase.plannedEndDate)];
              const dirty =
                !!draft &&
                (draft[0].format(DATE_FORMAT) !== dateOnly(phase.plannedStartDate) ||
                  draft[1].format(DATE_FORMAT) !== dateOnly(phase.plannedEndDate));
              const delayed = dateOnly(phase.plannedEndDate) > projectPlannedEnd;
              return (
                <div className="gantt-row" key={phase.id}>
                  <div>
                    <Typography.Text strong>{phase.name}</Typography.Text>
                    <br />
                    <Space>
                      <StatusBadge value={phase.status} />
                      <UserAvatar name={phase.owner?.name} />
                    </Space>
                  </div>
                  <Tooltip
                    title={`${dateOnly(phase.plannedStartDate)} ~ ${dateOnly(phase.plannedEndDate)}${delayed ? '，已越过计划竣工日期' : ''}`}
                  >
                    <div className="gantt-track" aria-label={`${phase.name} 时间线`}>
                      <div className={delayed ? 'gantt-bar gantt-bar-delayed' : 'gantt-bar'} style={style} />
                    </div>
                  </Tooltip>
                  <div className="gantt-editor">
                    <DatePicker.RangePicker
                      size="small"
                      allowClear={false}
                      disabled={phaseLocked}
                      value={pickerValue}
                      onChange={(values) => {
                        const [start, end] = values || [null, null];
                        if (!start || !end) {
                          return;
                        }
                        setDrafts((prev) => ({ ...prev, [phase.id]: [start, end] }));
                      }}
                    />
                    {phaseLocked ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {phase.status === PhaseStatus.Completed ? '阶段已完成，不可调整' : '项目已锁定，不可调整'}
                      </Typography.Text>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        disabled={!dirty}
                        loading={savingId === phase.id}
                        onClick={() => void saveSchedule(phase)}
                      >
                        保存排期
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Space>
      </div>
    </>
  );
}
