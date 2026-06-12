/**
 * 実行結果詳細（step 7・/g/scheduler/:taskId/executions/:executionId）。
 * デザイン SchedulerRunDetail.jsx を新シェルへ移植。左に生成結果（Markdown）、
 * 右に実行メタ＋「チャットで続けて質問」（実行結果をチャットへ引き継ぎ）。
 */
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSchedulerApi from '../../hooks/useSchedulerApi';
import Markdown from '../../components/Markdown';
import { GX } from '../strings';
import {
  fmtFull,
  fmtDuration,
  fmtTokens,
  triggerLabel,
} from '../lib/scheduler';
import { IcBack, IcCheck, IcAlert, IcClock, IcChat } from '../components/icons';
import '../styles/scheduler.css';

const GxSchedulerExecutionPage: React.FC = () => {
  const navigate = useNavigate();
  const { taskId, executionId: rawExecutionId } = useParams();
  const executionId = rawExecutionId
    ? decodeURIComponent(rawExecutionId)
    : null;
  const scheduler = useSchedulerApi();
  const { data: taskData } = scheduler.getTask(taskId ?? null);
  const { data: execData } = scheduler.getExecution(
    taskId ?? null,
    executionId
  );

  const task = taskData?.task;
  const ex = execData?.execution;

  if (!ex) {
    return (
      <div className="gx-sched">
        <div className="sch-content">
          <div className="sch-state">{GX.scheduler.exec.loading}</div>
        </div>
      </div>
    );
  }

  const isError = ex.status === 'error';
  const isRunning = ex.status === 'running';
  const title = isError
    ? GX.scheduler.exec.titleError
    : isRunning
      ? GX.scheduler.exec.titleRunning
      : GX.scheduler.exec.titleSuccess;

  const openInChat = (): void => {
    const content = `${GX.scheduler.exec.resultTitle}: ${task?.taskName ?? ''}\n\n---\n${ex.resultText ?? ''}\n---\n\n`;
    navigate('/g/chat', { state: { content } });
  };

  return (
    <div className="gx-sched">
      <div className="sch-top">
        <div className="sch-top-l" style={{ flexDirection: 'row', gap: 12 }}>
          <button
            className="sch-back"
            title={GX.scheduler.exec.backTitle}
            onClick={() => navigate(`/g/scheduler/${taskId}`)}>
            <IcBack size={14} />
          </button>
          <div className="sch-top-l">
            <div className="sch-eyebrow plain">
              {GX.scheduler.detail.crumbRoot} / {task?.taskName ?? ''} /{' '}
              {fmtFull(ex.startedAt)}
            </div>
            <div className="sch-title sm">{title}</div>
          </div>
        </div>
        <div className="sch-top-r">
          <span className={'sch-st ' + (isError ? 'error' : 'active')}>
            <span className="dot" />
            {isError
              ? GX.scheduler.exec.bannerError
              : isRunning
                ? GX.scheduler.exec.bannerRunning
                : GX.scheduler.exec.bannerSuccess}
          </span>
        </div>
      </div>

      <div className="sch-content split">
        <div className="sch-split-main">
          <div
            className={
              'schC-banner ' + (isError ? 'fail' : isRunning ? 'running' : 'ok')
            }>
            {isError ? <IcAlert size={18} /> : <IcCheck size={18} />}
            {isError
              ? GX.scheduler.exec.bannerError
              : isRunning
                ? GX.scheduler.exec.bannerRunning
                : GX.scheduler.exec.bannerSuccess}
          </div>

          {isError && ex.errorMessage && (
            <div className="schC-card">
              <h3 className="schC-h3">
                <span className="bar" />
                {GX.scheduler.exec.errorTitle}
              </h3>
              <div className="schC-error">{ex.errorMessage}</div>
            </div>
          )}

          {ex.resultText ? (
            <div className="schC-card">
              <h3 className="schC-h3">
                <span className="bar" />
                {GX.scheduler.exec.resultTitle}
              </h3>
              <div className="schC-result">
                <Markdown>{ex.resultText}</Markdown>
              </div>
            </div>
          ) : (
            !isError && (
              <div className="sch-state">{GX.scheduler.exec.resultEmpty}</div>
            )
          )}
        </div>

        <div className="sch-split-side">
          <div className="sch-scard">
            <div className="sch-scard-h">
              <IcClock size={14} />
              {GX.scheduler.exec.sectionInfo}
            </div>
            <div className="sch-scard-b">
              <div className="sch-mr">
                <span className="k">{GX.scheduler.exec.trigger}</span>
                <span className="v">
                  {triggerLabel(ex.trigger, ex.attempt)}
                </span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.exec.startedAt}</span>
                <span className="v mono">{fmtFull(ex.startedAt)}</span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.exec.duration}</span>
                <span className="v mono">
                  {fmtDuration(ex.startedAt, ex.completedAt)}
                </span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.exec.tokens}</span>
                <span className="v mono">{fmtTokens(ex.tokenUsage)}</span>
              </div>
              <div className="sch-mr">
                <span className="k">{GX.scheduler.exec.emailSent}</span>
                <span className="v">
                  {ex.emailSent
                    ? GX.scheduler.exec.emailSentYes
                    : GX.scheduler.exec.emailSentNo}
                </span>
              </div>
              {isError && ex.errorCategory && (
                <div className="sch-mr">
                  <span className="k">{GX.scheduler.exec.errorCause}</span>
                  <span className="v">
                    {ex.errorCategory === 'permanent'
                      ? GX.scheduler.exec.causePermanent
                      : GX.scheduler.exec.causeTransient}
                  </span>
                </div>
              )}
            </div>
          </div>

          {!isError && ex.resultText && (
            <div className="schC-sess">
              <div className="schC-sess-h">
                <IcChat size={14} />
                {GX.scheduler.exec.openInChat}
              </div>
              <div className="schC-sess-b">
                <p>{GX.scheduler.exec.openInChatHint}</p>
                <button className="schC-sess-go" onClick={openInChat}>
                  <IcChat size={14} />
                  {GX.scheduler.exec.openInChat}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GxSchedulerExecutionPage;
