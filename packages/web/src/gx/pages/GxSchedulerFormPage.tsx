/**
 * スケジュール 作成 / 編集フォーム（step 7・/g/scheduler/new ・ /:taskId/edit）。
 * 旧UI SchedulerTaskFormPage の入力契約（taskName/prompt/agent/model/schedule）を
 * 新シェルのデザインへ移植。エージェントは useAgentCore、モデルは MODELS から取得。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSchedulerApi, {
  ScheduleType,
  ScheduleConfig,
} from '../../hooks/useSchedulerApi';
import { useAgentCore } from '../../hooks/useAgentCore';
import { MODELS } from '../../hooks/useModel';
import { GX } from '../strings';
import { IcBack } from '../components/icons';
import '../styles/scheduler.css';

const pad2 = (v: string): string => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return '00';
  return String(Math.max(0, n)).padStart(2, '0');
};

const GxSchedulerFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const isEdit = !!taskId;
  const scheduler = useSchedulerApi();
  const { getAllAvailableRuntimes } = useAgentCore('/g/scheduler');
  const runtimes = getAllAvailableRuntimes();
  const modelIds = MODELS.modelIds;

  const { data: taskData } = scheduler.getTask(taskId ?? null);

  const [taskName, setTaskName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentName, setAgentName] = useState('');
  const [modelId, setModelId] = useState('');
  const [type, setType] = useState<ScheduleType>('daily');
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const populated = useRef(false);

  // 新規時の既定（エージェント/モデルの先頭）。
  useEffect(() => {
    if (!agentName && runtimes.length > 0) setAgentName(runtimes[0].name);
    if (!modelId && modelIds.length > 0) setModelId(modelIds[0]);
  }, [runtimes, modelIds, agentName, modelId]);

  // 編集時：取得したタスクでフォームを一度だけ初期化。
  useEffect(() => {
    if (!isEdit || populated.current) return;
    const t = taskData?.task;
    if (!t) return;
    populated.current = true;
    setTaskName(t.taskName);
    setPrompt(t.prompt);
    setAgentName(t.agentName);
    setModelId(t.modelId);
    setType(t.schedule.type);
    const [hh, mm] = (t.schedule.time ?? '09:00').split(':');
    setHour(hh ?? '09');
    setMinute(mm ?? '00');
    if (t.schedule.daysOfWeek?.length) setDaysOfWeek(t.schedule.daysOfWeek);
    if (t.schedule.dayOfMonth) setDayOfMonth(t.schedule.dayOfMonth);
  }, [isEdit, taskData]);

  const toggleDay = (d: number): void =>
    setDaysOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );

  const submit = async (): Promise<void> => {
    if (!taskName.trim() || !prompt.trim() || !agentName) {
      setError(GX.scheduler.form.errorRequired);
      return;
    }
    if (type === 'weekly' && daysOfWeek.length === 0) {
      setError(GX.scheduler.form.errorWeekday);
      return;
    }
    setError(null);

    const schedule: ScheduleConfig = {
      type,
      time: `${pad2(hour)}:${pad2(minute)}`,
      ...(type === 'weekly' ? { daysOfWeek: [...daysOfWeek].sort() } : {}),
      ...(type === 'monthly' ? { dayOfMonth } : {}),
    };
    const payload = {
      taskName: taskName.trim(),
      prompt: prompt.trim(),
      agentName,
      modelId,
      schedule,
    };

    setSaving(true);
    try {
      if (isEdit && taskId) {
        await scheduler.updateTask(taskId, payload);
        navigate(`/g/scheduler/${taskId}`);
      } else {
        const res = await scheduler.createTask(payload);
        const newId = res?.data?.task?.taskId;
        navigate(newId ? `/g/scheduler/${newId}` : '/g/scheduler');
      }
    } catch {
      setSaving(false);
      setError(GX.scheduler.form.errorRequired);
    }
  };

  return (
    <div className="gx-sched">
      <div className="sch-top">
        <div className="sch-top-l" style={{ flexDirection: 'row', gap: 12 }}>
          <button
            className="sch-back"
            title={GX.scheduler.form.backTitle}
            onClick={() => navigate('/g/scheduler')}>
            <IcBack size={14} />
          </button>
          <div className="sch-top-l">
            <div className="sch-eyebrow plain">
              {GX.scheduler.detail.crumbRoot}
            </div>
            <div className="sch-title sm">
              {isEdit
                ? GX.scheduler.form.editTitle
                : GX.scheduler.form.newTitle}
            </div>
          </div>
        </div>
      </div>

      <div className="sch-content">
        <div className="schF">
          {error && <div className="schF-err">{error}</div>}

          <div className="schF-field">
            <label className="schF-label">{GX.scheduler.form.taskName}</label>
            <input
              className="schF-input"
              value={taskName}
              placeholder={GX.scheduler.form.taskNamePlaceholder}
              onChange={(e) => setTaskName(e.target.value)}
            />
          </div>

          <div className="schF-field">
            <label className="schF-label">{GX.scheduler.form.prompt}</label>
            <textarea
              className="schF-textarea"
              value={prompt}
              placeholder={GX.scheduler.form.promptPlaceholder}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="schF-field">
            <div className="schF-row2">
              <div>
                <label className="schF-label">{GX.scheduler.form.agent}</label>
                <select
                  className="schF-select"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}>
                  {runtimes.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.displayName ?? r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="schF-label">{GX.scheduler.form.model}</label>
                <select
                  className="schF-select"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}>
                  {modelIds.map((m) => (
                    <option key={m} value={m}>
                      {MODELS.modelDisplayName(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="schF-field">
            <label className="schF-label">{GX.scheduler.form.schedule}</label>
            <div className="schF-typebtns">
              {(['daily', 'weekly', 'monthly'] as ScheduleType[]).map((tp) => (
                <button
                  key={tp}
                  className={'schF-typebtn' + (type === tp ? ' on' : '')}
                  onClick={() => setType(tp)}>
                  {tp === 'daily'
                    ? GX.scheduler.form.typeDaily
                    : tp === 'weekly'
                      ? GX.scheduler.form.typeWeekly
                      : GX.scheduler.form.typeMonthly}
                </button>
              ))}
            </div>
          </div>

          {type === 'weekly' && (
            <div className="schF-field">
              <label className="schF-label">
                {GX.scheduler.form.daysOfWeek}
              </label>
              <div className="schF-dows">
                {GX.scheduler.form.weekdayLabels.map((lbl, i) => {
                  const d = i + 1; // 1=月..7=日
                  return (
                    <button
                      key={d}
                      className={
                        'schF-dow' + (daysOfWeek.includes(d) ? ' on' : '')
                      }
                      onClick={() => toggleDay(d)}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {type === 'monthly' && (
            <div className="schF-field">
              <label className="schF-label">
                {GX.scheduler.form.dayOfMonth}
              </label>
              <select
                className="schF-select"
                style={{ maxWidth: 160 }}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                    {GX.scheduler.form.dayUnit}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="schF-field">
            <label className="schF-label">{GX.scheduler.form.time}</label>
            <div className="schF-time">
              <input
                className="schF-input"
                value={hour}
                inputMode="numeric"
                onChange={(e) => setHour(e.target.value)}
                onBlur={() => setHour(pad2(hour))}
              />
              <span>:</span>
              <input
                className="schF-input"
                value={minute}
                inputMode="numeric"
                onChange={(e) => setMinute(e.target.value)}
                onBlur={() => setMinute(pad2(minute))}
              />
            </div>
          </div>

          <div className="schF-acts">
            <button className="schF-submit" disabled={saving} onClick={submit}>
              {saving
                ? GX.scheduler.form.saving
                : isEdit
                  ? GX.scheduler.form.save
                  : GX.scheduler.form.create}
            </button>
            <button
              className="sch-ghost"
              onClick={() => navigate('/g/scheduler')}>
              {GX.scheduler.form.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GxSchedulerFormPage;
