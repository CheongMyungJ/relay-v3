// [증거] 패널 (docs/m2-modules.md 4절): 맨 위 결론 한 줄(그림자 표본은 끝이 정해진 뒤 '일치·불일치', Q6), 그 아래 결론을 정한 사실.
// 끝난 Work는 결과(머지됨, 머지 없이 끝남, 버림)를 먼저 쓰고 관문 결론은 '그때의 결론'으로 낮춘다. 구현 중이면 다음 할 일
// 한 줄(PR이 지금 HEAD를 가리키지 않음, PR 없음, 품질 기준 없음). 펼침: 까닭, 명령, 줄 판정, 래칫, 신호, 지식(V38), 빚(V41), 리뷰 지적(올림과
// 메모를 나눠, V26), 없는 증거, 낡음. [증거 다시 재기], PR이 있으면 [머지]. 그 위에 품질 기준 알림(V20)과 [끝내기]의 걸린
// 끝·상자(V25: 상자는 열린 것만 보인다. 메인이 work.json에 두므로 다른 Work로 갔다 와도 남는다), 끝난 Work는 끝낼 때의
// 메모(V37, 접힘). 결론 아래 되먹임 상태 한
// 줄(V24: 세션에 보냄 n/3, 보내지 않은 까닭), 지적마다 보냄·세션 몫 표시와 [세션에 넘기기](사람 몫, 그리고 저절로 가지 않는
// 세션 몫), 상자에도 [세션에 넘기기](걸린 끝과 상자는 EndPanels.tsx). 단위 브랜치로 내보내면(V22) Work 브랜치의 통합 증거
// 칸 하나(열린 것, 명령·줄·래칫·신호, 리뷰 없음)와 내보내기마다 칸 하나(결론, 되먹임, PR과 [머지], 펼침)를 보인다.
import { Button } from '@astryxdesign/core/Button'
import { useState } from 'react'
import type { GateResult } from '../../core/types.ts'
import type { ExportView, ProjectView, WorkView } from '../../shared/api.ts'
import { debtAsk, debtCommitText } from './debt.ts'
import { DebtChoice, EndArmed, EndBox, EndMemos } from './EndPanels.tsx'
import { Details } from './EvidenceDetails.tsx'
import { exportSection, integrationText } from './exports.ts'
import { AUTO_HIDDEN, hideAuto, shadowLine } from './record.ts'
import { useShadowEnds } from './RecordTable.tsx'
import {
  canMergeView,
  conclusionOf,
  decisiveText,
  endArmed,
  endMovedText,
  isActive,
  isStale,
  nextStep,
  outcomeOf,
  qualityNotice,
  reviewMeta,
  shortSha,
  showEndBox,
  timeText,
} from './format.ts'
import { feedbackStatus } from './findings.ts'
import { QualityNotice } from './QualityNotice.tsx'
import { Empty, ErrorLine, Spinner, Tag, useAction } from './ui.tsx'

export function EvidencePanel(p: { view: WorkView; project: ProjectView | null }) {
  const { view } = p
  const e = view.evidence
  const box = showEndBox(view) ? view.endPending : null
  const armed = endArmed(view)
  const moved = endMovedText(view)
  const notice = p.project !== null && qualityNotice(p.project.quality) !== null
  return (
    <div className="panel-body" data-testid="evidence-panel">
      {p.project ? <QualityNotice project={p.project} /> : null}
      {armed ? <EndArmed view={view} /> : null}
      {box ? <EndBox view={view} head={box.head} open={box.open} /> : null}
      <EndMemos view={view} />
      {moved ? (
        <p className="stale" role="note" data-testid="end-moved">
          {moved}
        </p>
      ) : null}
      {view.exports.length > 0 ? (
        <UnitSections view={view} qualityNotice={notice} ending={armed || box !== null} />
      ) : (
        <>
          {view.gate ? (
            <Verdict
              gate={view.gate}
              view={view}
              qualityNotice={notice}
              ending={armed || box !== null}
            />
          ) : e === null ? (
            <Empty title="아직 증거가 없습니다">
              세션이 커밋하고 쉬면, 또는 PR을 열면 앱이 품질 기준의 명령을 돌려 증거를 잽니다.
            </Empty>
          ) : (
            <Empty title="관문의 결론이 아직 없습니다">
              증거를 다시 재면 관문을 다시 계산합니다.
            </Empty>
          )}
          <FeedbackLine view={view} />
          {view.evidenceRunning ? <Spinner label="증거를 재는 중…" /> : null}
          {view.reviewRunning ? <Spinner label="리뷰 도는 중…" /> : null}
          <Actions view={view} unit={undefined} measure />
          {e ? <Details view={view} e={e} unit={undefined} /> : null}
        </>
      )}
    </div>
  )
}

/**
 * 단위 브랜치의 내보내기(V22): Work 브랜치의 통합 증거 칸(결정론만, 리뷰·관문·PR 없음)과 내보내기마다 칸. 내보내기의 칸은
 * 그 내보내기로 바꾼 WorkView(exportSection)로 one_branch와 같은 결론·되먹임·펼침을 그린다
 */
function UnitSections(p: { view: WorkView; qualityNotice: boolean; ending: boolean }) {
  const { view } = p
  const e = view.evidence
  const others = view.exports.some((x) => x.evidenceRunning || x.reviewRunning)
  return (
    <>
      <section className="export-section" data-testid="integration">
        <p className="export-title">
          통합 · <code>{view.branch}</code>
        </p>
        <p className="muted small">
          모든 단위가 함께 있는 Work 브랜치를 계약 전체로 잽니다(리뷰 없음). 내보내기가 자동 조건을
          채우려면 여기에 열린 것이 없어야 합니다.
        </p>
        <p
          className={`integration-status${view.integration?.length ? ' warn-text' : ''}`}
          data-testid="integration-status"
        >
          {integrationText(view)}
        </p>
        {view.integration && view.integration.length > 0 ? (
          <ul className="plain-list" data-testid="integration-open">
            {view.integration.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : null}
        {e ? (
          <p className="verdict-meta">
            <span>
              HEAD <code>{shortSha(e.head)}</code>
            </span>
            <span>{timeText(e.created_at)}</span>
          </p>
        ) : null}
        {isStale(view) ? <p className="stale">낡은 증거: 다시 재야 합니다.</p> : null}
        <FeedbackLine view={view} />
        {view.evidenceRunning && !others ? <Spinner label="증거를 재는 중…" /> : null}
        <Actions view={view} unit={undefined} measure />
        {e ? <Details view={view} e={e} unit={undefined} integration /> : null}
      </section>
      {view.exports.map((x) => (
        <ExportSection
          key={x.branch}
          x={x}
          view={exportSection(view, x)}
          qualityNotice={p.qualityNotice}
          ending={p.ending}
        />
      ))}
    </>
  )
}

/** 내보내기 하나(V22): 단위와 브랜치, 결론(없는 브랜치면 그 사실), 되먹임, PR과 [머지], 펼침 */
function ExportSection(p: {
  x: ExportView
  view: WorkView
  qualityNotice: boolean
  ending: boolean
}) {
  const { x, view } = p
  return (
    <section className="export-section" data-testid="export" data-unit={x.unit}>
      <p className="export-title">
        단위 {x.unit} · <code>{x.branch}</code>
      </p>
      {x.missing ? (
        <p className="stale" role="note" data-testid="export-missing">
          단위 브랜치가 없습니다: 세션이 {x.branch}를 기준 브랜치에서 만들고 이 단위의 커밋을 얹어야
          합니다.
        </p>
      ) : null}
      {view.gate ? (
        <Verdict
          gate={view.gate}
          view={view}
          unit={x.unit}
          qualityNotice={p.qualityNotice}
          ending={p.ending}
        />
      ) : (
        <Empty title="아직 증거가 없습니다">세션이 이 단위 브랜치에 커밋하고 쉬면 잽니다.</Empty>
      )}
      <FeedbackLine view={view} />
      {view.evidenceRunning ? <Spinner label="증거를 재는 중…" /> : null}
      {view.reviewRunning ? <Spinner label="리뷰 도는 중…" /> : null}
      <Actions view={view} unit={x.unit} measure={false} />
      {view.evidence ? <Details view={view} e={view.evidence} unit={x.unit} /> : null}
    </section>
  )
}

/** 되먹임(V24) 상태 한 줄: 세션에 보낸 것, 보내지 않은 까닭. 마지막 파일의 경로는 풍선 글로 */
function FeedbackLine({ view }: { view: WorkView }) {
  const text = feedbackStatus(view)
  if (text === null) return null
  return (
    <p
      className="feedback-status"
      data-testid="feedback-status"
      title={view.feedback.sent.at(-1)?.path}
    >
      {text}
    </p>
  )
}

function Verdict(p: {
  gate: GateResult
  view: WorkView
  unit?: string
  qualityNotice: boolean
  ending: boolean
}) {
  const { gate, view } = p
  const c = conclusionOf(gate)
  const ends = useShadowEnds(view, gate.shadow)
  const end = ends.find((x) => x.unit === (p.unit ?? null))
  const shadow = shadowLine(gate, end)
  const e = view.evidence
  const outcome = outcomeOf(view)
  const hidden = hideAuto(gate, { end, outcome: outcome !== null })
  const next = nextStep(view, { qualityNotice: p.qualityNotice, ending: p.ending })
  return (
    <section className={`verdict tone-${outcome ? 'muted' : c.tone}`} data-testid="verdict">
      {outcome ? (
        <>
          <p className="verdict-label">결과</p>
          <p className="verdict-title" data-testid="outcome">
            {outcome}
          </p>
          <p className="verdict-label">
            그때의 관문 결론 · <span data-testid="conclusion">{c.label}</span>
          </p>
        </>
      ) : (
        <>
          <p className="verdict-label">결론</p>
          <p className="verdict-title" data-testid="conclusion">
            {c.label}
          </p>
        </>
      )}
      {shadow ? (
        <p className="verdict-shadow" data-testid="shadow-line">
          {shadow}
        </p>
      ) : null}
      <p className="verdict-decisive" data-testid="decisive">
        {hidden ? AUTO_HIDDEN : decisiveText(view)}
      </p>
      {next ? (
        <p className="next-step" role="note" data-testid="next-step">
          {next}
        </p>
      ) : null}
      {e ? (
        <p className="verdict-meta">
          <span>
            HEAD <code>{shortSha(e.head)}</code>
          </span>
          <span>
            기준 <code>{shortSha(e.base)}</code>
          </span>
          {e.debt_commit ? (
            <span data-testid="debt-commit" title={debtCommitText(e)?.title}>
              {debtCommitText(e)?.text}
            </span>
          ) : null}
          <span>{timeText(e.created_at)}</span>
          <span data-testid="review-meta">
            {reviewMeta(e.review, {
              disabled: view.reviewDisabled,
              current: !isStale(view),
              running: view.reviewRunning,
            })}
          </span>
        </p>
      ) : null}
      {isStale(view) ? (
        <p className="stale" role="note">
          낡은 증거: 그 뒤로 HEAD가 <code>{shortSha(view.head)}</code>로 바뀌었습니다. 다시 재야
          합니다.
        </p>
      ) : null}
    </section>
  )
}

/** [머지](unit: 그 내보내기, V22)와 measure이면 [증거 다시 재기](모든 자리를 다시 잰다) */
function Actions({ view, unit, measure }: { view: WorkView; unit?: string; measure: boolean }) {
  const act = useAction()
  const [merged, setMerged] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const running = view.evidenceRunning || view.reviewRunning
  const measurable = measure && (view.state === 'working' || view.state === 'recontract')
  // 빚 확인(M3b)은 Work 브랜치의 내보내기(one_branch)만 묻는다
  const asks = unit === undefined ? debtAsk(view) : null
  const merge = (debt = false) =>
    void act.run(async () => {
      const r = await window.relay.merge(view.id, unit, debt ? { debt: true } : {})
      if (!r.ok) throw new Error(r.error ?? '머지하지 못함')
      setAsking(false)
      setMerged(debt ? '빚을 기록하고 머지했습니다' : '머지했습니다')
    })
  return (
    <div className="actions">
      {view.pr ? (
        <p className="pr-line">
          PR{' '}
          <a href={view.pr.url} target="_blank" rel="noreferrer">
            #{view.pr.number}
          </a>{' '}
          <Tag
            tone={view.pr.state === 'OPEN' ? 'info' : view.pr.state === 'MERGED' ? 'ok' : 'muted'}
          >
            {view.pr.state === 'OPEN' ? '열림' : view.pr.state === 'MERGED' ? '머지됨' : '닫힘'}
          </Tag>
          {view.pr.isDraft ? <Tag>초안</Tag> : null}
        </p>
      ) : null}
      <div className="row">
        {view.pr && isActive(view.state) ? (
          <Button
            variant="primary"
            label="머지"
            isDisabled={act.busy || !canMergeView(view)}
            tooltip={
              canMergeView(view)
                ? undefined
                : '관문이 계산되고 구현 중이며, PR이 열려 있고 증거를 잰 head를 가리킬 때'
            }
            onClick={() => (asks ? setAsking(true) : merge())}
          />
        ) : null}
        {measurable ? (
          <Button
            variant="secondary"
            label={view.evidence ? '증거 다시 재기' : '증거 재기'}
            isDisabled={act.busy || running}
            onClick={() => void act.run(() => window.relay.runEvidence(view.id))}
          />
        ) : null}
      </div>
      {asking && asks ? (
        <DebtChoice
          asks={asks}
          verb="머지"
          busy={act.busy}
          onChoose={merge}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      {merged && !act.error ? <p className="muted small">{merged}</p> : null}
      <ErrorLine text={act.error} />
    </div>
  )
}
