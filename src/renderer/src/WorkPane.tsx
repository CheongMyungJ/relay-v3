// 고른 Work 하나: 머리(요청, 상태, 브랜치, 동작), 가운데 터미널, 오른쪽 패널 탭 [계약] [증거] [변경] [빚].
// [끝내기](V18)는 내보내기 증거(리뷰 포함)를 재고 [증거]에 확인 상자를 띄운다. [끝 확정]이 Work를 끝낸다.
import { useEffect, useRef, useState } from 'react'
import type { ProjectView, WorkState, WorkView } from '../../shared/api.ts'
import { DebtPanel, DiffPanel } from './ChangesPanel.tsx'
import { ContractPanel } from './ContractPanel.tsx'
import { EvidencePanel } from './EvidencePanel.tsx'
import { SESSION_LABEL, STATE_LABEL, endTexts, isActive, workTone } from './format.ts'
import { TerminalView } from './TerminalView.tsx'
import { ErrorLine, Tag, useAction } from './ui.tsx'

type Tab = 'contract' | 'evidence' | 'diff' | 'debt'

const TABS: { id: Tab; label: string }[] = [
  { id: 'contract', label: '계약' },
  { id: 'evidence', label: '증거' },
  { id: 'diff', label: '변경' },
  { id: 'debt', label: '빚' },
]

/** 상태가 바뀌면 그 상태에서 볼 탭으로 옮긴다: 계약을 다루는 동안은 [계약], 그 뒤로는 [증거] */
function defaultTab(s: WorkState): Tab {
  return s === 'drafting' || s === 'awaiting_approval' || s === 'recontract'
    ? 'contract'
    : 'evidence'
}

export function WorkPane({ view, project }: { view: WorkView; project: ProjectView | null }) {
  const [picked, setPicked] = useState<{ tab: Tab; state: WorkState } | null>(null)
  // [끝내기]가 내보내기 증거를 잰 head. HEAD가 바뀌면 확인 상자는 보이지 않는다(format.ts showEndBox)
  const [endHead, setEndHead] = useState<string | null>(null)
  const tab = picked && picked.state === view.state ? picked.tab : defaultTab(view.state)
  const live = view.session !== 'stopped'
  // 탭이나 상태가 바뀌면 맨 위로: 결론 한 줄과 답이 필요한 상자(승인, 계약 바꾸기, 끝내기 확인)가 먼저 보이게
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [tab, view.state, endHead])
  return (
    <div className="work">
      <WorkHeader
        view={view}
        onEnding={() => {
          setEndHead(null)
          setPicked({ tab: 'evidence', state: view.state })
        }}
        onPrepared={setEndHead}
      />
      <div className="work-body">
        <section className="terminal-pane" aria-label="세션 터미널">
          <TerminalView workId={view.id} live={live} />
        </section>
        <aside className="panel" aria-label="계약과 증거">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'on' : undefined}
                onClick={() => setPicked({ tab: t.id, state: view.state })}
              >
                {t.label}
                {t.id === 'contract' &&
                (view.state === 'awaiting_approval' || view.state === 'recontract') ? (
                  <span className="badge" aria-label="답이 필요함" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="panel-scroll" role="tabpanel" ref={scroll}>
            {tab === 'contract' ? <ContractPanel view={view} /> : null}
            {tab === 'evidence' ? (
              <EvidencePanel
                view={view}
                project={project}
                endHead={endHead}
                onEndClose={() => setEndHead(null)}
              />
            ) : null}
            {tab === 'diff' ? <DiffPanel id={view.id} head={view.head} /> : null}
            {tab === 'debt' ? <DebtPanel id={view.id} head={view.head} /> : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** 세션의 상태. 계약 도구가 사람의 답을 기다리는 동안은 그렇게 말한다 */
function sessionText(v: WorkView): string {
  const waiting = v.state === 'awaiting_approval' || v.state === 'recontract'
  return waiting && v.session !== 'stopped' ? '세션이 답을 기다림' : SESSION_LABEL[v.session]
}

function WorkHeader(p: {
  view: WorkView
  /** [끝내기]를 눌렀다: [증거] 탭으로 옮겨 재는 것을 보인다 */
  onEnding: () => void
  /** 내보내기 증거를 잰 head(재는 사이 Work가 끝났으면 null) */
  onPrepared: (head: string | null) => void
}) {
  const { view } = p
  const act = useAction()
  const ending = useAction()
  const active = isActive(view.state)
  const canEnd = view.state === 'working' || view.state === 'recontract'
  const stopped = view.session === 'stopped'
  return (
    <header className="work-head">
      <div className="work-head-main">
        <h1 className="work-name" title={view.title}>
          {view.title}
        </h1>
        <p className="work-meta">
          <Tag tone={workTone(view)}>{STATE_LABEL[view.state]}</Tag>
          {active ? (
            <span className={stopped ? 'warn-text' : undefined}>{sessionText(view)}</span>
          ) : null}
          <span className="branch" title="작업 브랜치 ← 기준 브랜치">
            <code>{view.branch}</code> ← <code>{view.base}</code>
          </span>
        </p>
        {view.error ? <p className="error-line">마지막 실패: {view.error}</p> : null}
        <ErrorLine text={act.error ?? ending.error} />
      </div>
      <div className="row">
        {active && stopped ? (
          <button
            type="button"
            className="primary"
            disabled={act.busy}
            onClick={() => void act.run(() => window.relay.resumeWork(view.id))}
          >
            다시 열기
          </button>
        ) : null}
        {canEnd ? (
          <button
            type="button"
            className="secondary"
            disabled={act.busy || ending.busy}
            title={endTexts(view).button}
            onClick={() => {
              p.onEnding()
              void ending.run(async () =>
                p.onPrepared((await window.relay.prepareEnd(view.id)).head),
              )
            }}
          >
            {ending.busy ? '증거 재는 중…' : '끝내기'}
          </button>
        ) : null}
        {active ? (
          <button
            type="button"
            className="ghost danger"
            disabled={act.busy}
            onClick={() => {
              if (
                window.confirm('이 Work를 버릴까요? 세션을 끝냅니다. 브랜치와 worktree는 남습니다.')
              )
                void act.run(() => window.relay.abandon(view.id))
            }}
          >
            버리기
          </button>
        ) : null}
      </div>
    </header>
  )
}
