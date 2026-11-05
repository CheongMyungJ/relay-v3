// [증거] 패널 (docs/m2-modules.md 4절): 맨 위 결론 한 줄(그림자면 '자동이었으면 머지했을 것'), 그 아래 결론을 정한 사실.
// 끝난 Work는 결과(머지됨, 머지 없이 끝남, 버림)를 먼저 쓰고 관문 결론은 '그때의 결론'으로 낮춘다. 구현 중이면 다음 할 일
// 한 줄(PR이 지금 HEAD를 가리키지 않음, PR 없음, 품질 기준 없음). 펼침: 까닭, 명령, 줄 판정, 래칫, 신호, 리뷰 지적(올림과
// 메모를 나눠, V26), 없는 증거, 낡음. [증거 다시 재기], PR이 있으면 [머지]. 그 위에 품질 기준 알림(V20)과 [끝내기]의 걸린
// 끝·상자(V25: 상자는 열린 것만 보인다. 메인이 work.json에 두므로 다른 Work로 갔다 와도 남는다).
import { useState, type ReactNode } from 'react'
import type { EvidenceBundle, GateResult, ReviewFinding } from '../../core/types.ts'
import type { ProjectView, WorkView } from '../../shared/api.ts'
import {
  LINE_STATUS,
  OUTCOME,
  RATCHET,
  SEVERITY,
  SIGNAL_LABEL,
  canMergeView,
  conclusionOf,
  decisiveText,
  endArmed,
  endMovedText,
  endTexts,
  factText,
  isActive,
  isStale,
  missingOf,
  nextStep,
  openText,
  outcomeOf,
  qualityNotice,
  reviewMeta,
  reviewNote,
  shortSha,
  showEndBox,
  timeText,
} from './format.ts'
import { findingGroups, raiseLabel } from './findings.ts'
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
      {moved ? (
        <p className="stale" role="note" data-testid="end-moved">
          {moved}
        </p>
      ) : null}
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
        <Empty title="관문의 결론이 아직 없습니다">증거를 다시 재면 관문을 다시 계산합니다.</Empty>
      )}
      {view.evidenceRunning ? <Spinner label="증거를 재는 중…" /> : null}
      {view.reviewRunning ? <Spinner label="리뷰 도는 중…" /> : null}
      <Actions view={view} />
      {e ? <Details view={view} e={e} /> : null}
    </div>
  )
}

/** 걸린 끝(V25): 내보내기 증거와 리뷰가 끝나면 메인이 끝내거나 상자로 바꾼다. [취소]로 푼다 */
function EndArmed({ view }: { view: WorkView }) {
  const act = useAction()
  return (
    <div
      className="callout tone-info"
      role="region"
      aria-label="걸린 끝내기"
      data-testid="end-armed"
    >
      <p className="callout-title">{endTexts(view).armed}</p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={act.busy}
          onClick={() => void act.run(() => window.relay.cancelEnd(view.id))}
        >
          취소
        </button>
      </div>
      <ErrorLine text={act.error} />
    </div>
  )
}

/**
 * [끝내기]의 상자(V25): 열린 것(관문이 사람에게 보내는 사실)만 보인다. 사람이 보고 [그래도 끝내기]하거나, 세션에게 더
 * 고치라고 말하고 [더 고치기]로 닫는다. [그래도 끝내기]는 상자의 head를 넘긴다: 그사이 세션이 커밋했으면 메인이 끝내지 않는다
 */
function EndBox(p: { view: WorkView; head: string; open: string[] }) {
  const act = useAction()
  const { view } = p
  return (
    <div className="callout tone-warn" role="region" aria-label="끝내기 확인" data-testid="end-box">
      <p className="callout-title">{endTexts(view).box}</p>
      <ul className="plain-list" data-testid="end-open">
        {p.open.map((fact, i) => (
          <li key={i}>{openText(fact, view)}</li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={act.busy}
          onClick={() =>
            void act.run(() => window.relay.end(view.id, { head: p.head, force: true }))
          }
        >
          그래도 끝내기
        </button>
        <button
          type="button"
          className="secondary"
          disabled={act.busy}
          onClick={() => void act.run(() => window.relay.cancelEnd(view.id))}
        >
          더 고치기
        </button>
      </div>
      <ErrorLine text={act.error} />
    </div>
  )
}

function Verdict(p: { gate: GateResult; view: WorkView; qualityNotice: boolean; ending: boolean }) {
  const { gate, view } = p
  const c = conclusionOf(gate)
  const e = view.evidence
  const outcome = outcomeOf(view)
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
      {c.shadow ? <p className="verdict-shadow">{c.shadow}</p> : null}
      <p className="verdict-decisive" data-testid="decisive">
        {decisiveText(view)}
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

function Actions({ view }: { view: WorkView }) {
  const act = useAction()
  const [merged, setMerged] = useState<string | null>(null)
  const running = view.evidenceRunning || view.reviewRunning
  const measurable = view.state === 'working' || view.state === 'recontract'
  const merge = () =>
    void act.run(async () => {
      const r = await window.relay.merge(view.id)
      if (!r.ok) throw new Error(r.error ?? '머지하지 못함')
      setMerged('머지했습니다')
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
          <button
            type="button"
            className="primary"
            disabled={act.busy || !canMergeView(view)}
            title={
              canMergeView(view)
                ? undefined
                : '관문이 계산되고 구현 중이며, PR이 열려 있고 증거를 잰 head를 가리킬 때'
            }
            onClick={merge}
          >
            머지
          </button>
        ) : null}
        {measurable ? (
          <button
            type="button"
            className="secondary"
            disabled={act.busy || running}
            onClick={() => void act.run(() => window.relay.runEvidence(view.id))}
          >
            {view.evidence ? '증거 다시 재기' : '증거 재기'}
          </button>
        ) : null}
      </div>
      {merged && !act.error ? <p className="muted small">{merged}</p> : null}
      <ErrorLine text={act.error} />
    </div>
  )
}

function Fold(p: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="fold" open={p.open}>
      <summary>
        {p.title}
        {p.count === undefined ? null : <span className="count">{p.count}</span>}
      </summary>
      <div className="fold-body">{p.children}</div>
    </details>
  )
}

/** 리뷰 지적 목록: 심각도, 갈래, 글, 파일:줄 */
function FindingList({ findings }: { findings: ReviewFinding[] }) {
  return (
    <ul className="fact-list">
      {findings.map((f) => (
        <li key={f.id}>
          <Tag tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Tag>
          {f.raise === undefined ? null : <Tag>{raiseLabel(f)}</Tag>}
          <span>{f.text}</span>
          {f.file ? (
            <code>
              {f.file}
              {f.line === undefined ? '' : `:${f.line}`}
            </code>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * 올림과 메모(V26): 올림은 관문이 사람에게 보내는 사실이고(위 '사람에게 보낸 까닭'에도 있다), 메모(구조/낮음, 갈래가 없는
 * 지적)는 관문 사실이 아니다. 빈 묶음은 보이지 않는다
 */
function FindingGroups({ findings }: { findings: ReviewFinding[] }) {
  const { raised, notes } = findingGroups(findings)
  const group = (id: string, title: string, of: ReviewFinding[]) =>
    of.length === 0 ? null : (
      <section data-testid={id}>
        <p className="muted small">{title}</p>
        <FindingList findings={of} />
      </section>
    )
  return (
    <>
      {group('review-raised', `올림 ${raised.length} · 관문이 사람에게 보냅니다`, raised)}
      {group('review-notes', `메모 ${notes.length} · 관문에 들어가지 않습니다`, notes)}
    </>
  )
}

function Details(p: { view: WorkView; e: EvidenceBundle }) {
  const { e, view } = p
  const gate = view.gate
  const findings = e.review?.findings ?? []
  const review = reviewNote(e.review, view.reviewRunning, view.reviewDisabled)
  const missing = missingOf(e)
  return (
    <div className="details">
      {gate ? (
        <Fold title="사람에게 보낸 까닭" count={gate.reasons.length} open>
          {gate.reasons.length === 0 ? (
            <p className="muted">없음</p>
          ) : (
            <ul className="plain-list">
              {gate.reasons.map((r, i) => (
                <li key={i}>{factText(r, view)}</li>
              ))}
            </ul>
          )}
        </Fold>
      ) : null}
      <Fold title="명령" count={e.commands.length}>
        {e.commands.length === 0 ? <p className="muted">돌린 명령이 없음</p> : null}
        <ul className="fact-list">
          {e.commands.map((c) => {
            const last = c.head.at(-1)
            return (
              <li key={c.id}>
                <Tag tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Tag>
                <code>{c.id}</code>
                {last ? (
                  <span className="muted">
                    {' '}
                    종료 {last.exit ?? '—'}
                    {last.timed_out ? ' (시간 초과)' : ''} · {(last.duration_ms / 1000).toFixed(1)}
                    초{last.tests ? ` · 시험 ${last.tests.length}개` : ''}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Fold>
      <Fold title="줄 판정" count={e.lines?.length ?? 0}>
        {e.lines === null ? <p className="muted">계약 없이 잼</p> : null}
        <ul className="fact-list">
          {(e.lines ?? []).map((l) => (
            <li key={l.line}>
              <Tag tone={LINE_STATUS[l.status].tone}>{LINE_STATUS[l.status].label}</Tag>
              <span className="line-id">{l.line}</span>
              <span className="muted">{l.detail}</span>
            </li>
          ))}
        </ul>
      </Fold>
      <Fold title="래칫" count={e.ratchets.length}>
        {e.ratchets.length === 0 ? <p className="muted">없음</p> : null}
        <ul className="fact-list">
          {e.ratchets.map((r) => (
            <li key={r.id}>
              <Tag tone={RATCHET[r.status].tone}>{RATCHET[r.status].label}</Tag>
              <code>{r.id}</code>
              <span className="muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      </Fold>
      <Fold title="신호" count={e.signals.length}>
        {e.signals.length === 0 ? <p className="muted">없음</p> : null}
        <ul className="fact-list">
          {e.signals.map((s, i) => (
            <li key={i}>
              <Tag tone="warn">{SIGNAL_LABEL[s.kind]}</Tag>
              <span>{s.detail}</span>
              {s.path ? <code>{s.path}</code> : null}
            </li>
          ))}
        </ul>
      </Fold>
      <Fold title="리뷰 지적" count={findings.length}>
        {review ? (
          <p className="muted" data-testid="review-note">
            {review}
          </p>
        ) : null}
        <FindingGroups findings={findings} />
      </Fold>
      <Fold title="없는 증거" count={missing.length}>
        {missing.length === 0 ? <p className="muted">없음</p> : null}
        <ul className="plain-list">
          {missing.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </Fold>
      <p className="muted small">
        바뀐 파일 {e.diff.files}개 · +{e.diff.added} −{e.diff.deleted}
        {e.diff.new_dependencies.length > 0
          ? ` · 새 의존성 ${e.diff.new_dependencies.join(', ')}`
          : ''}
      </p>
    </div>
  )
}
