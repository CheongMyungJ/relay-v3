// 고른 Work 하나: 머리(요청, 상태, 브랜치, 동작), 가운데 터미널, 오른쪽 패널 탭 [계약] [증거] [변경] [빚].
import { useEffect, useRef, useState } from 'react'
import type { WorkState, WorkView } from '../../shared/api.ts'
import { DebtPanel, DiffPanel } from './ChangesPanel.tsx'
import { ContractPanel } from './ContractPanel.tsx'
import { EvidencePanel } from './EvidencePanel.tsx'
import { SESSION_LABEL, STATE_LABEL, isActive, workTone } from './format.ts'
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

export function WorkPane({ view }: { view: WorkView }) {
  const [picked, setPicked] = useState<{ tab: Tab; state: WorkState } | null>(null)
  const tab = picked && picked.state === view.state ? picked.tab : defaultTab(view.state)
  const live = view.session !== 'stopped'
  // 탭이나 상태가 바뀌면 맨 위로: 결론 한 줄과 답이 필요한 상자(승인, 계약 바꾸기)가 먼저 보이게
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [tab, view.state])
  return (
    <div className="work">
      <WorkHeader view={view} />
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
            {tab === 'evidence' ? <EvidencePanel view={view} /> : null}
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

function WorkHeader({ view }: { view: WorkView }) {
  const act = useAction()
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
        <ErrorLine text={act.error} />
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
            disabled={act.busy}
            title="내보내기 증거(리뷰 포함)를 재고 Work를 끝냅니다"
            onClick={() => void act.run(() => window.relay.end(view.id))}
          >
            끝내기
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
