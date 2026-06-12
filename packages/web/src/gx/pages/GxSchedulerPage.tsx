/**
 * スケジューラー運用コンソール（step 7・/g/scheduler）。
 * デザイン SchedulerConsole.jsx を新シェルへ移植。一覧（定義リスト）を主役に、
 * タスク枠メーター・状態フィルタ・健康表示を備えた監視サーフェスとして組む。
 *
 * 適応（縮退・記録）:
 *  - 右レール（カレンダー＋選択詳細＋実行履歴）は詳細ページ（GxSchedulerTaskPage）へ
 *    集約し、本コンソールは「一覧→行クリックで詳細」に振り分ける（ルーティング前提の
 *    実アプリではレールは詳細ページと重複するため）。カレンダー可視化は後続で追加可。
 *  - nextRun（次回実行時刻）は backend が返さないため頻度ラベルで代替。
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSchedulerApi, {
  ScheduledTaskResponse,
} from '../../hooks/useSchedulerApi';
import { GX } from '../strings';
import { formatScheduleLabel, statusOf, fmtDateTime } from '../lib/scheduler';
import {
  IcScheduler,
  IcPlus,
  IcRefresh,
  IcClock,
  IcAgent,
  IcCheck,
  IcAlert,
} from '../components/icons';
import '../styles/scheduler.css';

type Filter = 'all' | 'active' | 'paused' | 'error';

const GxSchedulerPage: React.FC = () => {
  const navigate = useNavigate();
  const scheduler = useSchedulerApi();
  const { data, isLoading, mutate } = scheduler.listTasks();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks: ScheduledTaskResponse[] = useMemo(
    () => data?.tasks ?? [],
    [data]
  );
  const limit = data?.limit ?? 10;
  const used = tasks.length;

  const counts = useMemo(() => {
    const c = { all: tasks.length, active: 0, paused: 0, error: 0 };
    for (const t of tasks) c[statusOf(t)] += 1;
    return c;
  }, [tasks]);

  const list = useMemo(
    () =>
      filter === 'all' ? tasks : tasks.filter((t) => statusOf(t) === filter),
    [tasks, filter]
  );

  const onToggle = async (
    e: React.MouseEvent,
    t: ScheduledTaskResponse
  ): Promise<void> => {
    e.stopPropagation();
    if (busyId) return;
    setBusyId(t.taskId);
    try {
      await scheduler.updateTask(t.taskId, {
        enabled: statusOf(t) !== 'active',
      });
      await mutate();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="gx-sched">
      {/* 上部バー */}
      <div className="sch-top">
        <div className="sch-top-l">
          <div className="sch-eyebrow">
            <span className="ic">
              <IcScheduler size={13} />
            </span>
            {GX.scheduler.eyebrow}
          </div>
          <div className="sch-title">{GX.scheduler.title}</div>
        </div>
        <div className="sch-top-r">
          <div className="sch-budget">
            <span className="bt">{GX.scheduler.budgetLabel}</span>
            <span className="bn">
              <b>{used}</b> / {limit}
            </span>
            <span className="track">
              <span
                className="fill"
                style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
              />
            </span>
          </div>
          <button
            className="sch-iconbtn"
            title={GX.scheduler.refresh}
            onClick={() => mutate()}>
            <IcRefresh size={15} />
          </button>
          <button
            className="sch-cta"
            onClick={() => navigate('/g/scheduler/new')}>
            <IcPlus size={14} />
            {GX.scheduler.newTask}
          </button>
        </div>
      </div>

      {/* ツールバー（状態フィルタ） */}
      <div className="sch-toolbar">
        <div className="sch-pills">
          {(['all', 'active', 'paused', 'error'] as Filter[]).map((k) => (
            <button
              key={k}
              className={'sch-pill' + (filter === k ? ' active' : '')}
              onClick={() => setFilter(k)}>
              {GX.scheduler.filters[k]}
              {k === 'error' && counts.error > 0 ? (
                <span className="cnt">{counts.error}</span>
              ) : (
                <span className="num">{counts[k]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="sch-sort">
          {GX.scheduler.sortLabel} <b>{GX.scheduler.sortNext}</b>
        </div>
      </div>

      {/* 一覧 */}
      <div className="sch-content">
        {isLoading ? (
          <div className="sch-state">{GX.scheduler.loading}</div>
        ) : list.length === 0 ? (
          <div className="sch-state">
            <div className="t">{GX.scheduler.empty}</div>
            {GX.scheduler.emptyHint}
          </div>
        ) : (
          <div className="schA-list">
            <div className="schA-listhead">
              <h2>
                {list.length}
                {GX.scheduler.countSuffix}
              </h2>
              <span className="meta">{GX.scheduler.listHint}</span>
            </div>
            {list.map((t) => {
              const st = statusOf(t);
              return (
                <div
                  key={t.taskId}
                  className={
                    'schA-row' +
                    (st === 'error' ? ' err' : '') +
                    (st === 'paused' ? ' paused' : '')
                  }
                  onClick={() => navigate(`/g/scheduler/${t.taskId}`)}>
                  <div className="schA-row-main">
                    <div
                      className="sch-aicon"
                      style={{ width: 44, height: 44 }}>
                      <IcScheduler size={22} />
                    </div>
                    <div className="schA-row-id">
                      <div className="schA-row-name">
                        <span className="nm">{t.taskName}</span>
                        {st === 'error' && (
                          <span className="sch-st error">
                            <span className="dot" />
                            {GX.scheduler.status.error}
                          </span>
                        )}
                        {st === 'paused' && (
                          <span className="sch-st paused">
                            <span className="dot" />
                            {GX.scheduler.status.paused}
                          </span>
                        )}
                      </div>
                      <div className="schA-row-meta">
                        <span className="schA-row-agent">
                          <IcAgent size={12} />
                          {t.agentName}
                        </span>
                        <span className="sch-freq">
                          <IcClock size={11} />
                          {formatScheduleLabel(t.schedule)}
                        </span>
                      </div>
                    </div>
                    <div className="schA-row-right">
                      <button
                        className={
                          'sch-toggle ' + (st === 'active' ? 'on' : 'off')
                        }
                        disabled={busyId === t.taskId}
                        onClick={(e) => onToggle(e, t)}
                        title={
                          st === 'active'
                            ? GX.scheduler.status.active
                            : GX.scheduler.status.paused
                        }
                      />
                    </div>
                  </div>
                  <div className="schA-row-foot">
                    <div className="schA-row-last">
                      {t.lastError ? (
                        <>
                          <span className="ic fail">
                            <IcAlert size={13} />
                          </span>
                          <span className="tx">
                            {GX.scheduler.lastRun} {fmtDateTime(t.lastError.at)}{' '}
                            · {t.lastError.message}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="ic ok">
                            <IcCheck size={13} />
                          </span>
                          <span className="tx">
                            {st === 'paused'
                              ? GX.scheduler.status.paused
                              : GX.scheduler.status.active}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="sch-deliver">
                      {GX.scheduler.deliverySelf}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GxSchedulerPage;
