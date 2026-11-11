// 고른 Work 하나: 머리줄(WorkHeader.tsx), 가운데 터미널(위에 세션 상태 띠), 오른쪽 패널 탭 [계약] [증거] [변경] [빚].
// 터미널과 패널 사이의 경계를 끌어 패널 너비를 바꾼다(V78: Astryx Resizable, 너비는 기억한다). 좁은 창에서는 터미널이 70열쯤
// 남게 패널이 먼저 준다. 탭 줄 오른쪽의 단추로 패널만 넓게 본다(터미널을 가린다). 단축키: ⌘1~4(다른 OS는 Alt+1~4)로 탭.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { IconButton } from '@astryxdesign/core/IconButton'
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { answerReason, showEndBox } from '../../shared/answer.ts'
import type { ProjectView, WorkState, WorkView } from '../../shared/api.ts'
import { DebtPanel, DiffPanel } from './ChangesPanel.tsx'
import { ContractPanel } from './ContractPanel.tsx'
import { EvidencePanel } from './EvidencePanel.tsx'
import { SESSION_LABEL, isActive } from './format.ts'
import { ExpandIcon, ShrinkIcon } from './icons.tsx'
import { tabKey } from './keys.ts'
import { PANEL_DEFAULT, PANEL_MIN, panelMax } from './panelSize.ts'
import { TerminalView } from './TerminalView.tsx'
import { modalOpen } from './ui.tsx'
import { WorkHeader } from './WorkHeader.tsx'

type PanelTab = 'contract' | 'evidence' | 'diff' | 'debt'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'contract', label: '계약' },
  { id: 'evidence', label: '증거' },
  { id: 'diff', label: '변경' },
  { id: 'debt', label: '빚' },
]

/** 상태가 바뀌면 그 상태에서 볼 탭으로 옮긴다: 계약을 다루는 동안은 [계약], 그 뒤로는 [증거] */
function defaultTab(s: WorkState): PanelTab {
  return s === 'drafting' || s === 'awaiting_approval' || s === 'recontract'
    ? 'contract'
    : 'evidence'
}

/** 사람의 답이 필요한 탭(판정은 src/shared/answer.ts): 계약(승인, 계약 다시)과 증거(끝내기 상자) */
function tabNeeds(view: WorkView, tab: PanelTab): boolean {
  if (tab === 'contract') return ['approval', 'change'].includes(answerReason(view) ?? '')
  return tab === 'evidence' && showEndBox(view)
}

/** 터미널과 패널이 나눠 쓰는 너비(경계 손잡이를 뺀 것). 재기 전에는 null. 창 크기가 바뀌면 다시 잰다 */
function useRoom(ref: RefObject<HTMLDivElement | null>, wide: boolean): number | null {
  const [room, setRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      let rest = 0
      for (const k of el.children)
        if (!k.matches('.terminal-pane, .panel')) rest += k.getBoundingClientRect().width
      setRoom(el.clientWidth - rest)
    }
    const seen = new ResizeObserver(measure)
    seen.observe(el)
    return () => seen.disconnect()
  }, [ref, wide])
  return room
}

export function WorkPane({ view, project }: { view: WorkView; project: ProjectView | null }) {
  const [picked, setPicked] = useState<{ tab: PanelTab; state: WorkState } | null>(null)
  const [wide, setWide] = useState(false)
  const tab = picked && picked.state === view.state ? picked.tab : defaultTab(view.state)
  const live = view.session !== 'stopped'
  // 패널을 끌 수 있는 끝은 창에 달려 있다: 터미널이 줄 수 있는 데까지만(끝이 줄면 기억하는 너비도 따라 준다)
  const body = useRef<HTMLDivElement>(null)
  const panel = useResizable({
    defaultSize: PANEL_DEFAULT,
    minSize: PANEL_MIN,
    maxSize: panelMax(useRoom(body, wide)),
    autoSaveId: 'relay-panel',
  })
  // 탭이나 상태가 바뀌면 맨 위로: 결론 한 줄과 답이 필요한 상자(계약 바꾸기, 끝내기)가 먼저 보이게
  const scroll = useRef<HTMLDivElement>(null)
  const pend = view.endPending
  const endKey = pend ? `${pend.head}:${pend.armed}:${pend.handed === true}` : null
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [tab, view.state, endKey])
  const state = view.state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = tabKey(e)
      const t = i === null ? undefined : TABS[i]
      // 대화상자가 떠 있으면 그 뒤의 탭을 바꾸지 않는다(글쇠는 대화상자의 것이다)
      if (!t || modalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      setPicked({ tab: t.id, state })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state])
  return (
    <div className="work">
      <WorkHeader view={view} onEnding={() => setPicked({ tab: 'evidence', state: view.state })} />
      <div className={`work-body${wide ? ' wide' : ''}`} ref={body}>
        <section
          className={`terminal-pane${live ? '' : ' stopped'}`}
          aria-label="세션 터미널"
          aria-hidden={wide}
        >
          <TerminalBar view={view} />
          <div className="terminal-wrap">
            <TerminalView workId={view.id} live={live} />
          </div>
        </section>
        {wide ? null : (
          <ResizeHandle
            isReversed
            hasDivider
            isAlwaysVisible={false}
            label="패널 너비"
            resizable={panel.props}
          />
        )}
        <aside
          className="panel"
          aria-label="계약과 증거"
          style={wide ? undefined : { flexBasis: panel.size }}
        >
          <div className="tabs">
            <TabList
              role="tablist"
              value={tab}
              onChange={(v) => {
                const t = TABS.find((x) => x.id === v)
                if (t) setPicked({ tab: t.id, state: view.state })
              }}
              size="sm"
            >
              {TABS.map((t) => (
                <Tab
                  key={t.id}
                  value={t.id}
                  label={t.label}
                  panelId={`panel-${view.id}`}
                  endContent={
                    tabNeeds(view, t.id) ? (
                      <StatusDot variant="warning" label="답이 필요함" />
                    ) : undefined
                  }
                />
              ))}
            </TabList>
            <IconButton
              variant="ghost"
              size="sm"
              label={wide ? '터미널 다시 보기' : '패널 넓게 보기'}
              tooltip={wide ? '터미널 다시 보기' : '패널 넓게 보기'}
              icon={wide ? <ShrinkIcon /> : <ExpandIcon />}
              onClick={() => setWide((w) => !w)}
            />
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

/** 터미널 위의 띠: 세션의 상태. 계약 도구가 사람의 답을 기다리는 동안은 그렇게 말한다 */
function TerminalBar({ view }: { view: WorkView }) {
  const waiting =
    (view.state === 'awaiting_approval' || view.state === 'recontract') &&
    view.session !== 'stopped'
  const active = isActive(view.state)
  const text = waiting ? '세션이 답을 기다림' : active ? SESSION_LABEL[view.session] : '세션 닫힘'
  return (
    <div className="terminal-bar" data-testid="terminal-bar">
      <span className={`term-dot ${waiting ? 'waiting' : active ? view.session : 'stopped'}`} />
      <span className={waiting || (active && view.session === 'stopped') ? 'waiting-text' : ''}>
        {text}
      </span>
    </div>
  )
}
