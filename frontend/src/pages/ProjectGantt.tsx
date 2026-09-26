import { Alert, Button, DatePicker, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { LockOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ProgressBar } from '../components/common/ProgressBar';
import { StatusBadge } from '../components/common/StatusBadge';
import { UserAvatar } from '../components/common/UserAvatar';
import { useProject } from '../hooks/useProject';
import { taskPhaseApi } from '../api/taskPhase';
import { useProjectStore } from '../stores/projectStore';
import { PhaseStatus, ProjectStatus, TaskPhase } from '../types';
import { formatDate } from '../utils/formatDate';

const RANGE_ANCHOR = new Date('2026-03-01').getTime();
const RANGE_SPAN_MS = 1000 * 60 * 60 * 24 * 260;

type PhaseDraft = { plannedStartDate: string; plannedEndDate: string };

function offsetPercent(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const duration = Math.max(end - start, 1);
  return {
    left: Math.max(0, Math.min(78, ((start - RANGE_ANCHOR) / RANGE_SPAN_MS) * 100)),
    width: Math.max(10, Math.min(95, (duration / RANGE_SPAN_MS) * 100))
  };
}

export function ProjectGantt() {
  const id = Number(useParams().id || 1);
  const { project, loading } = useProject(id);
  const loadProject = useProjectStore((state) => state.loadProject);
  const [drafts, setDrafts] = useState<Record<number, PhaseDraft>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const phases = project?.phases || [];
  const projectArchived = project?.status === ProjectStatus.Archived;
  const dirtyPhaseIds = useMemo(() => new Set(Object.keys(drafts).map(Number)), [drafts]);
  const hasChanges = dirtyPhaseIds.size > 0;

  const effectiveRange = (phase: TaskPhase): PhaseDraft => drafts[phase.id] ?? {
    plannedStartDate: phase.plannedStartDate,
    plannedEndDate: phase.plannedEndDate
  };

  const isPhaseLocked = (phase: TaskPhase) => projectArchived || phase.status === PhaseStatus.Completed;

  const anyDraftExceedsPlannedEnd = phases.some(
    (phase) => !isPhaseLocked(phase) && drafts[phase.id]?.plannedEndDate > (project?.plannedEndDate ?? '')
  );

  const handleRangeChange = (phase: TaskPhase, range: [Dayjs | null, Dayjs | null] | null) => {
    if (!range || !range[0] || !range[1]) {
      // 清空选择即放弃该行未保存的调整，恢复到已保存日期
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[phase.id];
        return next;
      });
      setBanner(null);
      return;
    }
    const plannedStartDate = range[0].format('YYYY-MM-DD');
    const plannedEndDate = range[1].format('YYYY-MM-DD');
    if (plannedStartDate === phase.plannedStartDate && plannedEndDate === phase.plannedEndDate) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[phase.id];
        return next;
      });
    } else {
      setDrafts((prev) => ({ ...prev, [phase.id]: { plannedStartDate, plannedEndDate } }));
    }
    setBanner(null);
  };

  const handleSave = async () => {
    if (!project || !hasChanges) {
      return;
    }
    setSaving(true);
    setBanner(null);
    const changes = phases
      .filter((phase) => drafts[phase.id])
      .map((phase) => ({ id: phase.id, ...drafts[phase.id] }));
    try {
      const result = await taskPhaseApi.reschedule(project.id, changes);
      setDrafts({});
      // 用后端返回的最新项目/阶段刷新，延期状态立即反映到徽标和仪表盘
      await loadProject(project.id);
      const text = result.delayCleared
        ? '排期已保存，项目已回到计划竣工日期以内，延期预警解除'
        : result.delayed
          ? '排期已保存，但已越过项目计划竣工日期，项目已进入延期预警'
          : '阶段排期已保存';
      setBanner(result.delayed ? { type: 'warning', text } : { type: 'success', text });
    } catch (error) {
      const data = (error as { response?: { data?: { message?: string } } }).response?.data;
      setBanner({
        type: 'error',
        text: data?.message || '排期未保存，请检查各阶段日期后重试'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={2}>
            {project?.name || '项目详情'} · 甘特图
          </Typography.Title>
          <Typography.Text type="secondary">
            {project?.address || '加载中'}
            {project && (
              <>
                {' '}· 计划竣工 {formatDate(project.plannedEndDate)} · <StatusBadge value={project.status} />
              </>
            )}
          </Typography.Text>
        </div>
        <Space>
          <Tooltip title={projectArchived ? '项目已归档，阶段排期不可调整' : undefined}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!hasChanges || projectArchived}
              onClick={() => void handleSave()}
            >
              保存日期调整
            </Button>
          </Tooltip>
        </Space>
      </div>

      {banner && (
        <Alert
          style={{ marginBottom: 12 }}
          type={banner.type}
          showIcon
          closable
          onClose={() => setBanner(null)}
          message={banner.text}
        />
      )}
      {projectArchived && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="该项目已归档，所有阶段排期均为只读"
        />
      )}
      {anyDraftExceedsPlannedEnd && !projectArchived && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`有阶段的计划结束日期越过了项目计划竣工日期 ${formatDate(project?.plannedEndDate)}，保存后项目将立即进入延期预警`}
        />
      )}

      <div className="surface">
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          <ProgressBar value={project?.progress || 0} />
          {loading ? (
            <Spin />
          ) : (
            phases.map((phase) => {
              const range = effectiveRange(phase);
              const style = offsetPercent(range.plannedStartDate, range.plannedEndDate);
              const locked = isPhaseLocked(phase);
              const dirty = dirtyPhaseIds.has(phase.id);
              return (
                <div className="gantt-row" key={phase.id}>
                  <div>
                    <Typography.Text strong>{phase.name}</Typography.Text>
                    <br />
                    <Space>
                      <StatusBadge value={phase.status} />
                      <UserAvatar name={phase.owner?.name} />
                      {dirty && <Tag color="orange">未保存</Tag>}
                      {locked && (
                        <Tag icon={<LockOutlined />} color="default">
                          {projectArchived ? '项目已归档' : '阶段已完成'}
                        </Tag>
                      )}
                    </Space>
                  </div>
                  <div className="gantt-track" aria-label={`${phase.name} 时间线`}>
                    <div
                      className={dirty ? 'gantt-bar gantt-bar-draft' : 'gantt-bar'}
                      style={{ left: `${style.left}%`, width: `${style.width}%` }}
                    />
                  </div>
                  <Tooltip title={locked ? '已归档项目或已完成阶段不允许调整排期' : undefined}>
                    <DatePicker.RangePicker
                      size="small"
                      value={[dayjs(range.plannedStartDate), dayjs(range.plannedEndDate)]}
                      disabled={locked}
                      allowClear={false}
                      onChange={(value) => handleRangeChange(phase, value as [Dayjs | null, Dayjs | null] | null)}
                      placeholder={['计划开始', '计划结束']}
                    />
                  </Tooltip>
                </div>
              );
            })
          )}
          <Typography.Text type="secondary">
            规则：同一项目内阶段区间首尾相接可以相邻，但不能相互压到；越过项目计划竣工日期保存会触发项目延期预警，改回范围内即恢复；已归档项目和已完成阶段不可调整。
          </Typography.Text>
        </Space>
      </div>
    </>
  );
}
