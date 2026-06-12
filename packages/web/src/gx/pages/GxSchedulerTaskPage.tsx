/**
 * スケジュール詳細＋失敗UI（step 7・/g/scheduler/:taskId）。
 * デザイン SchedulerFailure.jsx（失敗時）＋ SchedulerConsole 右レール（情報・履歴）を
 * 1ページに統合。status==='error' のとき自動停止アラート・原因分類・リトライ記録・
 * 復旧アクション（今すぐ再実行 / スケジュール再開）を表示する。
 */
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSchedulerApi from '../../hooks/useSchedulerApi';
import { GX } from '../strings';
import {
  formatScheduleLabel,
  statusOf,
  fmtDateTime,
  triggerLabel,
} from '../lib/scheduler';
import {
  IcBack,
  IcRetry,
  IcRefresh,
  IcCheck,
  IcAlert,
  IcAgent,
  IcTrash,
  IcArrowRight,
  IcInfo,
} from '../components/icons';
import '../styles/scheduler.css';

const GxSchedulerTaskPage: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const scheduler = useSchedulerApi();
  const { data: taskData, mutate: mutateTask } = scheduler.getTask(
    taskId ?? null
  );
  const { data: execData } = scheduler.listExecutions(taskId ?? null, 10);

  const [busy, setBusy] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = taskData?.task;
  const executions = execData?.executions ?? [];

  if (!task) {
    return (
      <div className="gx-sched">
        <div className="sch-content">
          <div className="sch-state">{GX.scheduler.detail.crumbRoot}…</div>
        </div>
      </div>
    );
  }

  const st = statusOf(task);
  const isError = st === 'error';
  const isTransient = task.lastError?.category !== 'permanent';

  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (busy || !taskId) return;
    setBusy(true);
    try {
      await scheduler.updateTask(taskId, { enabled });
      await mutateTask();
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (): Promise<void> => {
    if (busy || !taskId) return;
    setBusy(true);
    try {
      await scheduler.runNow(taskId);
      setRunMsg(GX.scheduler.detail.running);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (): Promise<void> => {
    if (!taskId) return;
    await scheduler.deleteTask(taskId);
    navigate('/g/scheduler');
  };

  return (
    <div className="gx-sched">
      {/* ヘッダ */}
      <div className="sch-top">
        <div className="sch-top-l" style={{ flexDirection: 'row', gap: 12 }}>
          <button
            className="sch-back"
            title={GX.scheduler.detail.backTitle}
            onClick={() => navigate('/g/scheduler')}>
            <IcBack size={14} />
          </button>
          <div className="sch-top-l">
            <div className="sch-eyebrow plain">
              {GX.scheduler.detail.crumbRoot} / {task.taskName}
            </div>
            <div className="sch-title sm">{task.taskName}</div>
          </div>
        </div>
        <div className="sch-top-r">
          <span className={'sch-st ' + st}>
            <span className="dot" />
            {GX.scheduler.status[st]}
          </span>
          <button
            className={'sch-toggle ' + (st === 'active' ? 'on' : 'off')}
            disabled={busy}
            title={GX.scheduler.detail.enabledToggle}
            onClick={() => setEnabled(st !== 'active')}
          />
          <button
            className="sch-ghost"
            onClick={() => navigate(`/g/scheduler/${taskId}/edit`)}>
            {GX.scheduler.detail.edit}
          </button>
          <button
            className="sch-ghost danger"
            onClick={() => setConfirmDelete(true)}>
            <IcTrash size={13} />
            {GX.scheduler.detail.delete}
          </button>
        </div>
      </div>

      <div className="sch-content split">
        <div className="sch-split-main">
          {/* 失敗UI（自動停止時） */}
          {isError && (
            <>
              <div className="schD-alert">
                <span className="ico">
                  <IcAlert size={20} />
                </span>
                <div className="tx">
                  <div className="t">{GX.scheduler.failure.autoStopTitle}</div>
                  <div className="s">
                    {isTransient
                      ? GX.scheduler.failure.autoStopBodyTransient
                      : GX.scheduler.failure.autoStopBodyPermanent}
                  </div>
                </div>
              </div>

              <div className="schD-cause">
                <div className={'c ' + (isTransient ? 'on' : 'off')}>
                  <div className="hd">
                    <IcRefresh size={14} />
                    {GX.scheduler.failure.causeTransientHd}
                  </div>
                  <div className="desc">
                    {GX.scheduler.failure.causeTransientDesc}
                  </div>
                  <span className="chip">
                    {isTransient ? (
                      <>
                        <IcCheck size={10} />
                        {GX.scheduler.failure.causeThis}
                      </>
                    ) : (
                      GX.scheduler.failure.causeNone
                    )}
                  </span>
                </div>
                <div className={'c ' + (!isTransient ? 'on' : 'off')}>
                  <div className="hd">
                    <IcInfo size={14} />
                    {GX.scheduler.failure.causePermanentHd}
                  </div>
                  <div className="desc">
                    {GX.scheduler.failure.causePermanentDesc}
                  </div>
                  <span className="chip">
                    {!isTransient ? (
                      <>
                        <IcCheck size={10} />
                        {GX.scheduler.failure.causeThis}
                      </>
                    ) : (
                      GX.scheduler.failure.causeNone
                    )}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* 実行・リトライの記録 */}
          <h3 className="schD-h3">
            <span className={'bar' + (isError ? '' : ' grad')} />
            {GX.scheduler.detail.sectionHistory}
          </h3>
          {executions.length === 0 ? (
            <div className="sch-state" style={{ padding: '24px 0' }}>
              {GX.scheduler.detail.historyEmpty}
            </div>
          ) : (
            <div className="schD-tl">
              {executions.map((ex) => {
                const ok = ex.status === 'success';
                const node = ok ? 'ok' : 'fail';
                return (
                  <div className="schD-step" key={ex.executionId}>
                    <span className={'schD-node ' + node}>
                      {ok ? <IcCheck size={14} /> : <IcAlert size={14} />}
                    </span>
                    <div className="schD-step-b">
                      <div
                        className="schD-step-hd"
                        onClick={() =>
                          navigate(
                            `/g/scheduler/${taskId}/executions/${encodeURIComponent(
                              ex.executionId
                            )}`
                          )
                        }>
                        <span className="lab">
                          {triggerLabel(ex.trigger, ex.attempt)}
                        </span>
                        <span className="at">{fmtDateTime(ex.startedAt)}</span>
                        <span className="go">
                          <IcArrowRight size={12} />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 復旧アクション */}
          <div className="schD-acts">
            <button className="primary" disabled={busy} onClick={runNow}>
              <IcRetry size={14} />
              {isError
                ? GX.scheduler.failure.retryNow
                : GX.scheduler.detail.run}
            </button>
            {st !== 'active' && (
              <button
                className="resume"
                disabled={busy}
                onClick={() => setEnabled(true)}>
                <IcRefresh size={13} />
                {GX.scheduler.failure.resumeSchedule}
              </button>
            )}
          </div>
          {runMsg && (
            <div className="sch-state" style={{ padding: '14px 0 0' }}>
              {runMsg} {GX.scheduler.detail.runHint}
            </div>
          )}
        </div>

        {/* 側カード：スケジュール情報 */}
        <div className="sch-split-side">
          <div className="sch-scard">
            <div className="sch-scard-h">
              <IcAgent size={14} />
              {GX.scheduler.detail.sectionInfo}
            </div>
            <div className="sch-scard-b">
              <div className="sch-mr">
                <span className="k">{GX.scheduler.detail.freq}</span>
                <span className="v">{formatScheduleLabel(task.schedule)}</span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.agentLabel}</span>
                <span className="v">{task.agentName}</span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.status.error}</span>
                <span className="v">
                  <span
                    className={'sch-st ' + st}
                    style={{ padding: '2px 8px' }}>
                    <span className="dot" />
                    {GX.scheduler.status[st]}
                  </span>
                </span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.detail.delivery}</span>
                <span className="v">
                  {GX.scheduler.detail.deliverySelfNote}
                </span>
              </div>
            </div>
          </div>

          <div className="sch-scard">
            <div className="sch-scard-h">{GX.scheduler.detail.prompt}</div>
            <div className="sch-scard-b">
              <div className="sch-prompt">{task.prompt}</div>
            </div>
          </div>

          <div className="sch-scard">
            <div className="sch-scard-b" style={{ display: 'flex', gap: 10 }}>
              <span style={{ flex: '0 0 auto', color: 'var(--indigo-500)' }}>
                <IcInfo size={16} />
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.65,
                  color: 'var(--gray-600)',
                }}>
                {GX.scheduler.detail.sessionNote}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 削除確認 */}
      {confirmDelete && (
        <div
          className="sch-modal-backdrop"
          onClick={() => setConfirmDelete(false)}>
          <div className="sch-modal" onClick={(e) => e.stopPropagation()}>
            <div className="t">{GX.scheduler.detail.confirmDeleteTitle}</div>
            <div className="s">{GX.scheduler.detail.confirmDeleteBody}</div>
            <div className="sch-modal-acts">
              <button
                className="sch-ghost"
                onClick={() => setConfirmDelete(false)}>
                {GX.scheduler.detail.confirmCancel}
              </button>
              <button className="danger" onClick={doDelete}>
                {GX.scheduler.detail.confirmDelete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GxSchedulerTaskPage;
