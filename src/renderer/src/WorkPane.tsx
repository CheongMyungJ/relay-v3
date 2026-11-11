// 고른 Work 하나: 머리(요청, 상태, 브랜치, 동작), 가운데 터미널, 오른쪽 패널 탭 [계약] [증거] [변경] [빚].
// [끝내기](V25)는 화면의 HEAD(V22: 와 단위 브랜치의 끝)를 넘긴다. 열린 것이 없으면 Work가 끝나고, 재는 동안은 걸린 끝, 열린 것이 있으면 [증거]의
// 상자다. 걸린 끝과 상자는 메인이 Work에 둔다(view.endPending): 다른 Work로 갔다 와도 남는다.
import { useEffect, useRef, useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Heading } from '@astryxdesign/core/Heading'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import type { ProjectView, WorkState, WorkView } from '../../shared/api.ts'
import { DebtPanel, DiffPanel } from './ChangesPanel.tsx'
import { ContractPanel } from './ContractPanel.tsx'
import { EvidencePanel } from './EvidencePanel.tsx'
import { endTips } from './exports.ts'
import {
  SESSION_LABEL,
  STATE_LABEL,
  endArmed,
  endHanded,
  endTexts,
  isActive,
  workTone,
} from './format.ts'
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
  const tab = picked && picked.state === view.state ? picked.tab : defaultTab(view.state)
  const live = view.session !== 'stopped'
  // 탭이나 상태가 바뀌면 맨 위로: 결론 한 줄과 답이 필요한 상자(승인, 계약 바꾸기, 끝내기)가 먼저 보이게
  const scroll = useRef<HTMLDivElement>(null)
  const pend = view.endPending
  const endKey = pend ? `${pend.head}:${pend.armed}:${pend.handed === true}` : null
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [tab, view.state, endKey])
  return (
    <div className="work">
      <WorkHeader view={view} onEnding={() => setPicked({ tab: 'evidence', state: view.state })} />
      <div className="work-body">
        <section className="terminal-pane" aria-label="세션 터미널">
          <TerminalView workId={view.id} live={live} />
        </section>
        <aside className="panel" aria-label="계약과 증거">
          <div className="tabs">
            <TabList
              role="tablist"
              value={tab}
              onChange={(t) => setPicked({ tab: t as Tab, state: view.state })}
              hasDivider
              size="sm"
            >
              {TABS.map((t) => (
                <Tab
                  key={t.id}
                  value={t.id}
                  label={t.label}
                  panelId={`panel-${view.id}`}
                  endContent={
                    t.id === 'contract' &&
                    (view.state === 'awaiting_approval' || view.state === 'recontract') ? (
                      <StatusDot variant="warning" label="답이 필요함" />
                    ) : undefined
                  }
                />
              ))}
            </TabList>
          </div>
          <div className="panel-scroll" role="tabpanel" id={`panel-${view.id}`} ref={scroll}>
            {tab === 'contract' ? <ContractPanel view={view} /> : null}
            {tab === 'evidence' ? <EvidencePanel view={view} project={project} /> : null}
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
  /** [끝내기]를 눌렀다: [증거] 탭으로 옮겨 걸린 끝이나 상자를 보인다 */
  onEnding: () => void
}) {
  const { view } = p
  const act = useAction()
  const ending = useAction()
  const active = isActive(view.state)
  const canEnd = view.state === 'working' || view.state === 'recontract'
  const armed = endArmed(view)
  const stopped = view.session === 'stopped'
  const [abandoning, setAbandoning] = useState(false)
  return (
    <header className="work-head">
      <div className="work-head-main">
        <Heading level={1} maxLines={1}>
          <span className="work-name">{view.title}</span>
        </Heading>
        <div className="work-meta">
          <Tag tone={workTone(view)}>{STATE_LABEL[view.state]}</Tag>
          {active ? (
            <span className={stopped ? 'warn-text' : undefined}>{sessionText(view)}</span>
          ) : null}
          <span className="branch" title="작업 브랜치 ← 기준 브랜치">
            <Code>{view.branch}</Code> ← <Code>{view.base}</Code>
          </span>
        </div>
        <ErrorLine text={view.error ? `마지막 실패: ${view.error}` : null} />
        <ErrorLine text={act.error ?? ending.error} />
      </div>
      <div className="row">
        {active && stopped ? (
          <Button
            variant="primary"
            label="다시 열기"
            isDisabled={act.busy}
            onClick={() => void act.run(() => window.relay.resumeWork(view.id))}
          />
        ) : null}
        {canEnd ? (
          <Button
            variant="secondary"
            isDisabled={act.busy || ending.busy || armed}
            tooltip={endTexts(view).button}
            label={
              endHanded(view)
                ? endTexts(view).handedButton
                : armed
                  ? endTexts(view).waiting
                  : ending.busy
                    ? '끝내는 중…'
                    : '끝내기'
            }
            onClick={() => {
              p.onEnding()
              void ending.run(() =>
                window.relay.end(
                  view.id,
                  view.head === null ? {} : { head: view.head, ...endTips(view) },
                ),
              )
            }}
          />
        ) : null}
        {active ? (
          <Button
            variant="ghost"
            label="버리기"
            isDisabled={act.busy}
            onClick={() => setAbandoning(true)}
          />
        ) : null}
      </div>
      <AlertDialog
        isOpen={abandoning}
        onOpenChange={setAbandoning}
        title="이 Work를 버릴까요?"
        description="세션을 끝냅니다. 브랜치와 worktree는 남습니다."
        actionLabel="버리기"
        cancelLabel="취소"
        onAction={() => {
          setAbandoning(false)
          void act.run(() => window.relay.abandon(view.id))
        }}
      />
    </header>
  )
}
