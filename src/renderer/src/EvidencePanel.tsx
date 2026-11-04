// [증거] 패널 (docs/m2-modules.md 4절): 맨 위 결론 한 줄(그림자면 '자동이었으면 머지했을 것'), 그 아래 결론을 정한 사실.
// 끝난 Work는 결과(머지됨, 머지 없이 끝남, 버림)를 먼저 쓰고 관문 결론은 '그때의 결론'으로 낮춘다. 구현 중이면 다음 할 일
// 한 줄(PR이 지금 HEAD를 가리키지 않음, PR 없음, 품질 기준 없음). 펼침: 까닭, 명령, 줄 판정, 래칫, 신호, 리뷰 지적, 없는
// 증거, 낡음. [증거 다시 재기], PR이 있으면 [머지].
import { useState, type ReactNode } from 'react'
import type { EvidenceBundle, GateResult } from '../../core/types.ts'
import type { WorkView } from '../../shared/api.ts'
import {
  LINE_STATUS,
  OUTCOME,
  RATCHET,
  SEVERITY,
  SIGNAL_LABEL,
  canMergeView,
  conclusionOf,
  decisiveText,
  isActive,
  isStale,
  missingOf,
  nextStep,
  outcomeOf,
  reviewNote,
  shortSha,
  timeText,
} from './format.ts'
import { Empty, ErrorLine, Spinner, Tag, useAction } from './ui.tsx'

export function EvidencePanel({ view }: { view: WorkView }) {
  const e = view.evidence
  return (
    <div className="panel-body" data-testid="evidence-panel">
      {view.gate ? (
        <Verdict gate={view.gate} view={view} />
      ) : e === null ? (
        <Empty title="아직 증거가 없습니다">
          세션이 커밋하고 쉬면, 또는 PR을 열면 앱이 품질 기준의 명령을 돌려 증거를 잽니다.
        </Empty>
      ) : (
        <Empty title="관문의 결론이 아직 없습니다">증거를 다시 재면 관문을 다시 계산합니다.</Empty>
      )}
      {view.evidenceRunning ? <Spinner label="증거를 재는 중…" /> : null}
      {view.reviewRunning ? <Spinner label="독립 리뷰 중…" /> : null}
      <Actions view={view} />
      {e ? <Details gate={view.gate} e={e} reviewRunning={view.reviewRunning} /> : null}
    </div>
  )
}

function Verdict({ gate, view }: { gate: GateResult; view: WorkView }) {
  const c = conclusionOf(gate)
  const e = view.evidence
  const outcome = outcomeOf(view)
  const next = nextStep(view)
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
          <span>{reviewText(e.review)}</span>
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

function reviewText(r: EvidenceBundle['review']): string {
  if (r === null) return '리뷰 없음'
  if (r.status === 'done') return `리뷰 지적 ${r.findings.length}개`
  return r.status === 'failed' ? '리뷰 실패' : '리뷰 건너뜀'
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

function Details(p: { gate: GateResult | null; e: EvidenceBundle; reviewRunning: boolean }) {
  const { gate, e } = p
  const findings = e.review?.findings ?? []
  const review = reviewNote(e.review, p.reviewRunning)
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
                <li key={i}>{r}</li>
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
        <ul className="fact-list">
          {findings.map((f) => (
            <li key={f.id}>
              <Tag tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Tag>
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
