// [계약] 패널 (docs/m2-modules.md 4절): 목표, 줄 표(종류, 글, 근거와 확인됨/추정, 예시 입력→출력, 확인 방법), 비목표,
// 사람만 아는 규칙, hint. 단위가 있으면(V21) 줄을 단위마다 묶고 전달 방식을 보인다. 승인을 기다리면 [승인]과 늘 보이는 고칠
// 점 칸·[보내기], 계약 다시면 세션의 요청, 승인본과 제안의 차이, [받아들이기]·[거절하기].
import { useState } from 'react'
import type { Contract, ContractLine, GroundingCheck } from '../../core/types.ts'
import type { WorkView } from '../../shared/api.ts'
import {
  CHECK_LABEL,
  KIND_LABEL,
  contractDelta,
  deliveryText,
  exampleText,
  groundStatus,
  groundText,
  timeText,
  unitGroups,
  type DeltaItem,
  type Tone,
} from './format.ts'
import { Empty, ErrorLine, Tag, useAction } from './ui.tsx'

export function ContractPanel({ view }: { view: WorkView }) {
  const shown = view.pendingContract ?? view.contract
  return (
    <div className="panel-body" data-testid="contract-panel">
      {view.state === 'awaiting_approval' && view.pendingContract ? (
        <ApproveBox id={view.id} />
      ) : null}
      {view.state === 'recontract' ? (
        <ChangeBox
          id={view.id}
          reason={view.pendingChange}
          approved={view.contract}
          proposed={view.pendingContract}
        />
      ) : null}
      {shown ? (
        <ContractView
          contract={shown}
          branch={view.branch}
          groundings={view.groundings}
          hint={view.hint}
          pending={view.pendingContract !== null}
        />
      ) : (
        <Empty title="아직 계약이 없습니다">
          세션이 코드와 요청을 읽고 묻는 중입니다. 질문에는 가운데 터미널에서 답하세요. 세션이
          계약을 내면 여기에 보입니다.
          {view.hint ? <p className="muted">일의 성격 제안: {view.hint}</p> : null}
        </Empty>
      )}
    </div>
  )
}

/** 승인을 기다리는 계약(M2.1 13절): [승인]과, 여는 단계 없이 늘 보이는 고칠 점 칸과 [보내기] */
function ApproveBox({ id }: { id: string }) {
  const act = useAction()
  const [text, setText] = useState('')
  return (
    <div className="callout tone-warn" data-testid="approve-box">
      <p className="callout-title">세션이 계약을 냈습니다. 읽고 답해 주세요.</p>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={act.busy}
          onClick={() => void act.run(() => window.relay.approveContract(id))}
        >
          승인
        </button>
      </div>
      <textarea
        className="field"
        rows={2}
        value={text}
        placeholder="고칠 점이 있으면 적고 보내기를 누르세요. 세션이 고쳐 다시 냅니다."
        aria-label="고칠 점"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={act.busy || text.trim() === ''}
          onClick={() =>
            void act
              .run(() => window.relay.askChanges(id, text.trim()))
              .then((ok) => {
                // 세션이 곧바로 다시 내면 이 상자가 그대로 남을 수 있다: 보낸 글을 비운다
                if (ok) setText('')
              })
          }
        >
          보내기
        </button>
      </div>
      <ErrorLine text={act.error} />
    </div>
  )
}

function ChangeBox(p: {
  id: string
  reason: string | null
  approved: Contract | null
  proposed: Contract | null
}) {
  const act = useAction()
  const [text, setText] = useState('')
  const answer = (approved: boolean) =>
    void act.run(() => window.relay.answerChange(p.id, { approved, message: text.trim() }))
  return (
    <div className="callout tone-warn" data-testid="change-box">
      <p className="callout-title">세션이 계약을 바꾸자고 합니다</p>
      <p className="quote">{p.reason ?? '(까닭 없음)'}</p>
      {p.proposed && p.approved ? <Delta approved={p.approved} proposed={p.proposed} /> : null}
      <p className="muted small">
        {p.proposed
          ? '아래는 세션이 제안한 새 계약 전체입니다.'
          : '새 계약 없이 요청만 했습니다. 거절하고 바꾼 계약 전체를 내 달라고 하세요.'}
      </p>
      <textarea
        className="field"
        rows={2}
        value={text}
        placeholder="세션에게 줄 말 (선택)"
        aria-label="세션에게 줄 말"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={act.busy || !p.proposed}
          onClick={() => answer(true)}
        >
          받아들이기
        </button>
        <button
          type="button"
          className="secondary"
          disabled={act.busy}
          onClick={() => answer(false)}
        >
          거절하기
        </button>
      </div>
      <ErrorLine text={act.error} />
    </div>
  )
}

const DELTA: Record<DeltaItem['how'], { label: string; tone: Tone }> = {
  added: { label: '더함', tone: 'ok' },
  removed: { label: '뺌', tone: 'bad' },
  changed: { label: '고침', tone: 'warn' },
}

/** 승인본과 제안의 차이(M2.1 13절): 줄과 예시의 더함·뺌·고침, 그 밖에서 바뀐 것의 이름 */
function Delta(p: { approved: Contract; proposed: Contract }) {
  const d = contractDelta(p.approved, p.proposed)
  const empty = d.lines.length === 0 && d.examples.length === 0 && d.other.length === 0
  return (
    <div className="delta" data-testid="contract-delta">
      <p className="delta-title">승인된 계약에서 바뀌는 것</p>
      {empty ? (
        <p className="muted small">바뀐 줄, 예시, 칸이 없습니다(차례만 바뀌었을 수 있음)</p>
      ) : null}
      <DeltaList title="줄" items={d.lines} />
      <DeltaList title="예시" items={d.examples} />
      {d.other.length > 0 ? (
        <>
          <p className="delta-sub">그 밖</p>
          <ul className="delta-list" aria-label="그 밖">
            <li data-testid="delta-other">
              <Tag tone="warn">고침</Tag>
              <span className="line-id" />
              <span>{d.other.join(', ')}</span>
            </li>
          </ul>
        </>
      ) : null}
    </div>
  )
}

function DeltaList({ title, items }: { title: string; items: DeltaItem[] }) {
  if (items.length === 0) return null
  return (
    <>
      <p className="delta-sub">{title}</p>
      <ul className="delta-list" aria-label={title}>
        {items.map((x) => (
          <li key={`${x.how}:${x.id}`} data-testid="delta-item">
            <Tag tone={DELTA[x.how].tone}>{DELTA[x.how].label}</Tag>
            <span className="line-id">{x.id}</span>
            <span className={x.how === 'removed' ? 'delta-removed' : undefined}>{x.text}</span>
            {x.fields.length > 0 ? (
              <span className="delta-more muted small">고친 칸: {x.fields.join(', ')}</span>
            ) : null}
            {x.before !== undefined ? (
              <span className="delta-more muted small">앞: {x.before}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}

function ContractView(p: {
  contract: Contract
  branch: string
  groundings: GroundingCheck[] | null
  hint: string | null
  pending: boolean
}) {
  const c = p.contract
  const hint = c.hint ?? p.hint
  const groups = unitGroups(c)
  const units = groups.filter((g) => g.unit !== null).length
  const delivery = deliveryText(c, p.branch)
  const rows = (lines: ContractLine[]) => (
    <ol className="lines">
      {lines.map((l) => (
        <LineRow
          key={l.id}
          line={l}
          contract={c}
          checks={p.groundings?.filter((g) => g.line === l.id) ?? null}
        />
      ))}
    </ol>
  )
  return (
    <article className="contract">
      <p className="eyebrow">
        {p.pending ? '제안된 계약' : '승인된 계약'} · <code>{c.id}</code>
      </p>
      <h2 className="goal">{c.goal}</h2>
      {hint ? <p className="muted">일의 성격 제안: {hint}</p> : null}

      <h3 className="section-title">
        줄 {c.lines.length}개{units > 0 ? ` · 단위 ${units}개` : ''}
      </h3>
      {delivery ? (
        <p className="muted small" data-testid="delivery">
          전달 방식 · {delivery}
        </p>
      ) : null}
      {units === 0
        ? rows(c.lines)
        : groups.map((g) => (
            <section key={g.unit ?? ''} className="unit-group" data-testid="unit-group">
              <h4 className="unit-title">
                {g.unit === null ? (
                  '모든 단위에 걸친 줄'
                ) : (
                  <>
                    단위 <code>{g.unit}</code>
                  </>
                )}
                <span className="muted"> · 줄 {g.lines.length}개</span>
              </h4>
              {rows(g.lines)}
            </section>
          ))}

      <TextList title="비목표" items={c.non_goals} empty="없음" />
      <TextList title="사람만 아는 규칙" items={c.human_rules} empty="없음" />
      {c.tidy.length > 0 ? <TextList title="곁들일 정리(빚)" items={c.tidy} empty="" /> : null}
      {c.approved_at ? (
        <p className="muted small">
          {c.approved_by === 'human' ? '사람이' : '호출자가'} 승인함 · {timeText(c.approved_at)}
        </p>
      ) : null}
    </article>
  )
}

function LineRow(p: { line: ContractLine; contract: Contract; checks: GroundingCheck[] | null }) {
  const l = p.line
  const examples = l.examples.map((id) => ({
    id,
    ex: p.contract.examples.find((e) => e.id === id),
  }))
  return (
    <li className="line" data-testid="contract-line">
      <div className="line-head">
        <span className="line-id">{l.id}</span>
        <Tag tone="info">{KIND_LABEL[l.kind]}</Tag>
        <span className="line-text">{l.text}</span>
        <span className="line-check" title="확인 방법">
          {CHECK_LABEL[l.check]}
        </span>
      </div>
      <dl className="line-facts">
        <dt>근거</dt>
        <dd>
          {l.grounds.length === 0 ? <span className="muted">없음</span> : null}
          {l.grounds.map((g, i) => {
            const check = p.checks?.[i]
            const st = groundStatus(g, check)
            return (
              <span key={i} className="ground" title={check?.detail}>
                {g.type === 'guess' ? null : <code>{groundText(g)}</code>}
                <Tag tone={st.tone}>{st.label}</Tag>
              </span>
            )
          })}
        </dd>
        {examples.length > 0 ? (
          <>
            <dt>예시</dt>
            <dd>
              {examples.map(({ id, ex }) => (
                <span key={id} className="example">
                  <span className="example-id">{id}</span>
                  <code>{ex ? exampleText(ex) : '(예시 없음)'}</code>
                  {ex?.note ? <span className="muted"> {ex.note}</span> : null}
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  )
}

function TextList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <>
      <h3 className="section-title">{title}</h3>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="plain-list">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </>
  )
}
