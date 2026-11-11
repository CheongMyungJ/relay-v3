// [증거]의 펼침 (docs/m2-modules.md 4절, V78): 접는 칸을 한 목록으로 묶고, 칸마다 오른쪽에 숫자 대신 상태 한 마디를 쓴다
// (summary.ts: '2개 통과', '나빠짐 1', '올림 2 · 메모 3', 없으면 흐린 '없음'). 까닭, 명령, 줄 판정, 래칫, 신호, 지식(V38), 빚(V41),
// 리뷰 지적(올림과 메모를 나눠, V26. 지적마다 되먹임 표시와 [세션에 넘기기], V24), 없는 증거. EvidencePanel.tsx가 600줄을
// 넘지 않게 나눴다.
import { Button } from '@astryxdesign/core/Button'
import type { EvidenceBundle, ReviewFinding } from '../../core/types.ts'
import type { WorkView } from '../../shared/api.ts'
import { AUTO_HIDDEN, hideAuto } from './record.ts'
import { useShadowEnds } from './RecordTable.tsx'
import {
  KNOWLEDGE_ISSUE,
  LINE_STATUS,
  OUTCOME,
  RATCHET,
  SEVERITY,
  SIGNAL_LABEL,
  factText,
  missingOf,
  outcomeOf,
  reviewNote,
} from './format.ts'
import { findingGroups, findingRoute, passable, raiseLabel } from './findings.ts'
import {
  commandSummary,
  countSummary,
  knowledgeSummary,
  lineSummary,
  ratchetSummary,
  reviewSummary,
} from './summary.ts'
import { TidyFold } from './TidyFold.tsx'
import { ErrorLine, Fold, Tag, useAction } from './ui.tsx'

/**
 * 리뷰 지적 목록: 심각도, 갈래, 글, 파일:줄, 되먹임(V24: 세션에 보냄, 세션 몫이면 쉬면 저절로 감, 사람 몫이거나 저절로 가지
 * 않는 세션 몫(상한, 사람 몫의 올림이 막음, 끝내기)이면 [세션에 넘기기])
 */
function FindingList(p: { findings: ReviewFinding[]; view: WorkView; unit?: string }) {
  const { findings, view } = p
  const act = useAction()
  const send = (id: string) => void act.run(() => window.relay.sendFindings(view.id, [id], p.unit))
  return (
    <>
      <ul className="fact-list">
        {findings.map((f) => {
          const route = findingRoute(view, f)
          return (
            <li key={f.id} data-testid="finding">
              <Tag tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Tag>
              {f.raise === undefined ? null : <Tag>{raiseLabel(f)}</Tag>}
              <span>{f.text}</span>
              {f.file ? (
                <code>
                  {f.file}
                  {f.line === undefined ? '' : `:${f.line}`}
                </code>
              ) : null}
              {route === 'sent' ? <Tag tone="info">세션에 보냄</Tag> : null}
              {route === 'session' ? <Tag tone="info">세션 몫</Tag> : null}
              {passable(view, f) && view.state === 'working' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  label="세션에 넘기기"
                  isDisabled={act.busy}
                  tooltip="이 지적을 되먹임 파일로 세션에 보냅니다"
                  onClick={() => send(f.id)}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      <ErrorLine text={act.error} />
    </>
  )
}

/**
 * 올림과 메모(V26): 올림은 관문이 사람에게 보내는 사실이고(위 '사람에게 보낸 까닭'에도 있다), 메모(구조/낮음, 갈래가 없는
 * 지적)는 관문 사실이 아니다. 빈 묶음은 보이지 않는다
 */
function FindingGroups(p: { findings: ReviewFinding[]; view: WorkView; unit?: string }) {
  const { raised, notes } = findingGroups(p.findings)
  const group = (id: string, title: string, of: ReviewFinding[]) =>
    of.length === 0 ? null : (
      <section data-testid={id}>
        <p className="muted small">{title}</p>
        <FindingList findings={of} view={p.view} unit={p.unit} />
      </section>
    )
  return (
    <>
      {group('review-raised', `올림 ${raised.length} · 관문이 사람에게 보냅니다`, raised)}
      {group('review-notes', `메모 ${notes.length} · 관문에 들어가지 않습니다`, notes)}
    </>
  )
}

type KnowledgeEvidence = NonNullable<EvidenceBundle['knowledge']>

function Issues(p: { items: KnowledgeEvidence['issues']; id?: string }) {
  return (
    <ul className="fact-list" data-testid={p.id}>
      {p.items.map((i, n) => (
        <li key={n}>
          <Tag tone={KNOWLEDGE_ISSUE[i.kind].tone}>{KNOWLEDGE_ISSUE[i.kind].label}</Tag>
          <code>{i.path}</code>
          <span className="muted">{i.detail}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 지식 확인(V38)과 규칙 승격(V42): 바뀐 지식 파일 수와 문제마다 한 줄, 말로만 남은 규칙(규칙 승격이 켜졌을 때)은 따로 모은다.
 * 두 장치를 껐으면(null) 칸이 없다. 접힌 칸의 수는 말로만을 뺀 문제다
 */
function Knowledge(p: { k: KnowledgeEvidence; promote: boolean }) {
  const spoken = p.k.issues.filter((i) => i.kind === 'spoken')
  const rest = p.k.issues.filter((i) => i.kind !== 'spoken')
  return (
    <Fold
      title="지식"
      summary={knowledgeSummary(p.k)}
      help="docs/knowledge/의 규칙과 바뀐 지식 파일을 확인한 결과입니다(알림)"
    >
      <p className="muted" data-testid="knowledge-summary">
        바뀐 지식 파일 {p.k.changed.length}개
        {p.promote ? ` · 말로만 남은 규칙 ${spoken.length}개` : ''}
      </p>
      <Issues items={rest} />
      {spoken.length > 0 ? <Issues items={spoken} id="knowledge-spoken" /> : null}
    </Fold>
  )
}

/** 펼침. unit은 지적의 내보내기(V22), integration은 통합 증거(리뷰 없음: 리뷰 지적을 보이지 않는다) */
export function Details(p: {
  view: WorkView
  e: EvidenceBundle
  unit?: string
  integration?: boolean
}) {
  const { e, view } = p
  const gate = view.gate
  const ends = useShadowEnds(view, gate?.shadow === true)
  const end = ends.find((x) => x.unit === (p.unit ?? null))
  const hidden = gate !== null && hideAuto(gate, { end, outcome: outcomeOf(view) !== null })
  const reasons = hidden ? [] : (gate?.reasons ?? [])
  const findings = e.review?.findings ?? []
  const review = reviewNote(e.review, view.reviewRunning, view.reviewDisabled)
  const missing = missingOf(e)
  return (
    <div className="details">
      <div className="fold-list">
        {gate ? (
          <Fold
            // 까닭이 둘 이상일 때만 펼쳐 둔다: 없거나 하나면 결론의 글과 같은 말이다. 수가 바뀌면 처음 열림을 다시 정한다
            key={reasons.length > 1 ? 'many' : 'few'}
            title="사람에게 보낸 까닭"
            summary={countSummary(reasons.length)}
            help="관문이 자동으로 넘기지 않고 사람에게 보낸 사실입니다"
            open={reasons.length > 1}
          >
            {reasons.length === 0 ? (
              <p className="muted" data-testid="reasons-none">
                {hidden ? AUTO_HIDDEN : '없음'}
              </p>
            ) : (
              <ul className="plain-list">
                {reasons.map((r, i) => (
                  <li key={i}>{factText(r, view)}</li>
                ))}
              </ul>
            )}
          </Fold>
        ) : null}
        <Fold
          title="명령"
          summary={commandSummary(e.commands)}
          help="품질 기준(.relay/quality.json)의 명령을 앱이 돌린 결과입니다"
        >
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
                      {last.timed_out ? ' (시간 초과)' : ''} ·{' '}
                      {(last.duration_ms / 1000).toFixed(1)}초
                      {last.tests ? ` · 시험 ${last.tests.length}개` : ''}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Fold>
        <Fold
          title="줄 판정"
          summary={lineSummary(e.lines)}
          help="계약의 줄마다 증거가 채웠는지 본 결과입니다"
        >
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
        <Fold
          title="래칫"
          summary={ratchetSummary(e.ratchets)}
          help="기준 브랜치보다 나빠지면 안 되는 숫자입니다(시험 수, 파일 줄 수, 억누름 등)"
        >
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
        <Fold
          title="신호"
          summary={countSummary(e.signals.length)}
          help="사람이 봐야 하는 변경입니다(보호 경로, 지킴 파일, 시험 약화, 구조 변경)"
        >
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
        {e.knowledge ? <Knowledge k={e.knowledge} promote={view.m3.promote} /> : null}
        {e.tidy ? <TidyFold t={e.tidy} /> : null}
        {p.integration ? null : (
          <Fold
            title="리뷰 지적"
            summary={reviewSummary(findings)}
            help="독립 리뷰가 낸 지적입니다. 올림은 관문이 사람에게 보내고, 메모는 관문에 들어가지 않습니다"
          >
            {review ? (
              <p className="muted" data-testid="review-note">
                {review}
              </p>
            ) : null}
            <FindingGroups findings={findings} view={view} unit={p.unit} />
          </Fold>
        )}
        <Fold
          title="없는 증거"
          summary={countSummary(missing.length)}
          help="재지 못해 비어 있는 증거입니다"
        >
          {missing.length === 0 ? <p className="muted">없음</p> : null}
          <ul className="plain-list">
            {missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Fold>
      </div>
      <p className="muted small">
        바뀐 파일 {e.diff.files}개 · +{e.diff.added} −{e.diff.deleted}
        {e.diff.new_dependencies.length > 0
          ? ` · 새 의존성 ${e.diff.new_dependencies.join(', ')}`
          : ''}
      </p>
    </div>
  )
}
