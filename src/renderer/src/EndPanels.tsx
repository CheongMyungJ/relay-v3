// [끝내기]의 걸린 끝과 상자 (V25, docs/m2-modules.md 4절). EvidencePanel.tsx가 600줄을 넘지 않게 나눴다. 상자는 열린 것만
// 보인다(V22: 통합 증거와 내보내기마다의 열린 것, 없는 단위 브랜치). 메인이 work.json에 두므로 다른 Work로 갔다 와도 남는다.
// 상자의 [세션에 넘기기](V24)는 열린 것에 보이는 올림을 내보내기마다 보내고 상자를 닫는다.
import type { WorkView } from '../../shared/api.ts'
import { passByExport } from './exports.ts'
import { endTexts, openText } from './format.ts'
import { ErrorLine, useAction } from './ui.tsx'

/** 걸린 끝(V25): 내보내기 증거와 리뷰가 끝나면 메인이 끝내거나 상자로 바꾼다. [취소]로 푼다 */
export function EndArmed({ view }: { view: WorkView }) {
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
export function EndBox(p: { view: WorkView; head: string; open: string[] }) {
  const act = useAction()
  const { view } = p
  // 열린 것에 보이는 올림을 세션에 보내고 상자를 닫는다(V24): 상자가 떠 있는 동안은 세션 몫도 저절로 가지 않는다
  const pass = view.state === 'working' ? passByExport(view) : []
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
        {pass.length > 0 ? (
          <button
            type="button"
            className="secondary"
            disabled={act.busy}
            title="열린 리뷰 올림을 세션에 보내고 상자를 닫습니다"
            onClick={() =>
              void act.run(async () => {
                for (const x of pass) await window.relay.sendFindings(view.id, x.ids, x.unit)
                await window.relay.cancelEnd(view.id)
              })
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
