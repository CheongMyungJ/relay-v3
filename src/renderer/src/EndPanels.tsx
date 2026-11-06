// [끝내기]의 걸린 끝과 상자 (V25, docs/m2-modules.md 4절). EvidencePanel.tsx가 600줄을 넘지 않게 나눴다. 상자는 열린 것만
// 보인다(V22: 통합 증거와 내보내기마다의 열린 것, 없는 단위 브랜치). 메인이 work.json에 두므로 다른 Work로 갔다 와도 남는다.
// 상자의 [세션에 넘기기](V24, V35)는 열린 것에 보이는 올림과 저절로 가지 않은 세션 몫 사실을 보내고, 끝을 '고친 뒤 끝냄'으로
// 다시 건다: 세션이 고치고 쉬면 메인이 끝내거나 상자를 다시 띄운다. 그동안은 걸린 끝의 칸에 그 글과 [취소]가 보인다.
// [끝내기]로 끝난 Work는 끝낼 때 남은 리뷰 메모(V37)를 접어 보인다.
import type { WorkView } from '../../shared/api.ts'
import { handable, passByExport } from './exports.ts'
import { endMemosText, raiseLabel } from './findings.ts'
import { SEVERITY, endHanded, endTexts, openText } from './format.ts'
import { ErrorLine, Tag, useAction } from './ui.tsx'

/**
 * 걸린 끝(V25): 내보내기 증거와 리뷰가 끝나면 메인이 끝내거나 상자로 바꾼다. 세션에 넘겨 다시 건 끝(V35)은 세션이 고치고 쉬기를
 * 기다린다. [취소]로 푼다
 */
export function EndArmed({ view }: { view: WorkView }) {
  const act = useAction()
  const handed = endHanded(view)
  return (
    <div
      className="callout tone-info"
      role="region"
      aria-label="걸린 끝내기"
      data-testid={handed ? 'end-handed' : 'end-armed'}
    >
      <p className="callout-title">{handed ? endTexts(view).handed : endTexts(view).armed}</p>
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
export function EndBox(p: { view: WorkView; head: string; open: string[] }) {
  const act = useAction()
  const { view } = p
  // 열린 것에 보이는 올림과 세션 몫 사실을 세션에 보내고 끝을 다시 건다(V24, V35): 상자가 떠 있는 동안은 세션 몫도 저절로
  // 가지 않는다
  const hand = view.state === 'working' && handable(view)
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
        {hand ? (
          <button
            type="button"
            className="secondary"
            disabled={act.busy}
            title={endTexts(view).hand}
            onClick={() =>
              void act.run(() =>
                window.relay.handEnd(view.id, { head: p.head, picks: passByExport(view) }),
              )
            }
          >
            세션에 넘기기
          </button>
        ) : null}
      </div>
      <ErrorLine text={act.error} />
    </div>
  )
}

/**
 * 끝낼 때의 메모(V37): [끝내기]가 메모(관문 사실이 아닌 지적)를 남기고 끝냈으면 끝난 Work의 [증거] 맨 위에 접어 보인다(끝을
 * 막지 않았으므로 사람이 지나치지 않게). 지적마다 심각도, 단위(V22), 갈래, 글, 파일:줄
 */
export function EndMemos({ view }: { view: WorkView }) {
  const t = endMemosText(view)
  if (t === null) return null
  return (
    <details className="fold end-memos" data-testid="end-memos">
      <summary>{t.title}</summary>
      <div className="fold-body">
        <p className="muted small">{t.note}</p>
        <ul className="fact-list">
          {view.endMemos.map(({ unit, finding: f }, i) => (
            <li key={i} data-testid="end-memo">
              <Tag tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Tag>
              {unit === undefined ? null : <Tag>단위 {unit}</Tag>}
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
      </div>
    </details>
  )
}
