// 설정 대화상자의 [실적] (M4c, docs/m4-design.md 5.2): 조건마다 한 줄(일치 k/n과 Wilson 하한, 불일치 갈래, 분모 밖, 머지 뒤
// 30일, 비교군과 lift)과 '사람 경로' 비교 줄. 기본은 지금 판이고 '모든 판'으로 바꾼다. 판이 바뀐 자리, 판을 모르는 결론 줄과 깨진
// 장부 줄도 보인다. 귀속된 되돌림·main 실패마다 [귀속이 틀림](M4d 이의). 진행 막대·'M5까지 몇 건'·남은 주는 없다.
import { useEffect, useState } from 'react'
import {
  EVENTS,
  type AfterEvent,
  type ProjectView,
  type RecordStats,
  type ShadowEnd,
  type WorkView,
} from '../../shared/api.ts'
import {
  conditionHead,
  conditionRest,
  controlText,
  epochText,
  footText,
  sessionText,
} from './record.ts'
import { ErrorLine, useAction } from './ui.tsx'

export function RecordTable(p: { project: ProjectView }) {
  const [all, setAll] = useState(false)
  const [stats, setStats] = useState<RecordStats | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const id = p.project.id
  useEffect(
    () =>
      window.relay.on(EVENTS.record, (x) => {
        if (x.project === id) setTick((t) => t + 1)
      }),
    [id],
  )
  useEffect(() => {
    let live = true
    window.relay.record(id, all).then(
      (s) => {
        if (!live) return
        setStats(s)
        setError(null)
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [id, all, tick])
  return (
    <section className="record" data-testid="record">
      <div className="record-head">
        <span className="switch-title">실적</span>
        <div className="segmented" role="group" aria-label="판">
          <button type="button" className={all ? '' : 'on'} onClick={() => setAll(false)}>
            지금 판
          </button>
          <button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>
            모든 판
          </button>
        </div>
      </div>
      <ErrorLine text={error} />
      {stats ? <Stats stats={stats} project={id} onChange={() => setTick((t) => t + 1)} /> : null}
    </section>
  )
}

function Stats(p: { stats: RecordStats; project: string; onChange: () => void }) {
  const { stats } = p
  const events = [
    ...stats.conditions.flatMap((c) => c.after.events),
    ...stats.human.after.events,
  ].filter(
    (e, i, xs) =>
      xs.findIndex((y) => y.merge_commit === e.merge_commit && y.event === e.event) === i,
  )
  return (
    <>
      <p className="help" data-testid="record-epoch">
        {stats.epoch === 'all' ? '모든 판' : `이 판: ${epochText(stats.current)}`}
      </p>
      {stats.conditions.length === 0 ? (
        <p className="help">자동 조건을 채운 내보내기가 아직 없습니다.</p>
      ) : null}
      <ul className="record-rows">
        {stats.conditions.map((c) => (
          <li key={c.id} className="record-row" data-testid="record-condition" data-id={c.id}>
            <p className="record-title">{conditionHead(c)}</p>
            {conditionRest(c).map((line) => (
              <p key={line} className="help">
                {line}
              </p>
            ))}
          </li>
        ))}
        <li className="record-row" data-testid="record-human">
          <p className="record-title">사람 경로(조건 못 채움)</p>
          <p className="help">{controlText(stats.human)}</p>
        </li>
      </ul>
      {events.length > 0 ? (
        <ul className="record-rows" data-testid="record-events">
          {events.map((e) => (
            <EventRow
              key={`${e.merge_commit}:${e.event}`}
              e={e}
              project={p.project}
              onChange={p.onChange}
            />
          ))}
        </ul>
      ) : null}
      {stats.changes.map((c) => (
        <p key={c.ts} className="help">
          판이 바뀜: {c.fields.join(', ')}
        </p>
      ))}
      <p className="help" data-testid="record-sessions">
        {sessionText(stats.sessions)}
      </p>
      <p className="help" data-testid="record-foot">
        {footText(stats)}
      </p>
    </>
  )
}

function EventRow(p: { e: AfterEvent; project: string; onChange: () => void }) {
  const { e } = p
  const act = useAction()
  const what = e.event === 'revert' ? '되돌림' : 'main 실패 귀속'
  return (
    <li className="record-event" data-testid="record-event">
      <span>
        {what} · 머지 <code>{e.merge_commit.slice(0, 7)}</code> · 커밋{' '}
        <code>{e.sha.slice(0, 7)}</code>
        {e.disputed ? ' · 이의로 셈에서 뺌' : ''}
      </span>
      {e.disputed ? null : (
        <button
          type="button"
          className="ghost small"
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              await window.relay.dispute(p.project, e.merge_commit, e.event)
              p.onChange()
            })
          }
        >
          귀속이 틀림
        </button>
      )}
      <ErrorLine text={act.error} />
    </li>
  )
}

/**
 * 이 Work의 그림자 표본의 끝(Q6). 그림자 결론이 있을 때만 메인에 묻고, Work의 상태·PR·head가 바뀌거나 장부에 줄이 더해지면
 * (EVENTS.record) 다시 묻는다. 읽지 못하면 빈 목록(줄을 가린 채 둔다)
 */
export function useShadowEnds(view: WorkView, shadow: boolean): ShadowEnd[] {
  const [ends, setEnds] = useState<ShadowEnd[]>([])
  const [tick, setTick] = useState(0)
  useEffect(
    () =>
      window.relay.on(EVENTS.record, (p) => {
        if (p.project === view.project) setTick((t) => t + 1)
      }),
    [view.project],
  )
  const prs = [view.pr?.state, ...view.exports.map((x) => x.pr?.state)].join(',')
  useEffect(() => {
    if (!shadow) return
    let live = true
    window.relay.shadowEnds(view.id).then(
      (xs) => live && setEnds(xs),
      () => live && setEnds([]),
    )
    return () => {
      live = false
    }
  }, [view.id, view.state, view.head, prs, shadow, tick])
  return shadow ? ends : []
}
