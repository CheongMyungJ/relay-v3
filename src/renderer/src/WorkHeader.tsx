// Work의 머리줄 (docs/m2-modules.md 4절, V78): 한 줄 제목, 단계 표시(지난 단계는 찬 점, 지금 단계는 상태 꼬리표), 브랜치(누르면
// 이름을 복사), PR 링크, 그리고 동작([다시 열기], [끝내기], '⋯'의 [버리기]). [끝내기](V25)는 화면의 HEAD(V22: 와 단위 브랜치의
// 끝)를 넘긴다. 열린 것이 없으면 Work가 끝나고, 재는 동안은 걸린 끝, 열린 것이 있으면 [증거]의 상자다.
import { useEffect, useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import type { WorkState, WorkView } from '../../shared/api.ts'
import { endTips } from './exports.ts'
import { STATE_LABEL, endArmed, endHanded, endTexts, isActive, workTone } from './format.ts'
import { BranchIcon } from './icons.tsx'
import { ErrorLine, Tag, useAction } from './ui.tsx'

/** 단계: 계약 초안 → 승인 → 구현(계약 다시도 여기) → 끝(버림도 여기) */
const STEP_NAMES = ['계약 초안', '승인', '구현', '끝']
const STEP_OF: Record<WorkState, number> = {
  drafting: 0,
  awaiting_approval: 1,
  working: 2,
  recontract: 2,
  done: 3,
  abandoned: 3,
}

function Steps({ view }: { view: WorkView }) {
  const now = STEP_OF[view.state]
  return (
    <ol
      className="steps"
      aria-label={`단계 ${now + 1}/${STEP_NAMES.length}: ${STATE_LABEL[view.state]}`}
    >
      {STEP_NAMES.map((name, i) => (
        <li key={name}>
          {i === now ? (
            <Tag tone={workTone(view)}>{STATE_LABEL[view.state]}</Tag>
          ) : (
            <span className={`step-dot${i < now ? ' past' : ''}`} title={name} />
          )}
        </li>
      ))}
    </ol>
  )
}

/** 브랜치 이름: 누르면 클립보드에 복사하고 잠깐 '복사됨'을 보인다 */
function Branch({ view }: { view: WorkView }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <span className="branch">
      <button
        type="button"
        className="branch-copy"
        title="작업 브랜치 ← 기준 브랜치. 누르면 작업 브랜치 이름을 복사합니다"
        aria-label={`작업 브랜치 ${view.branch} 복사`}
        onClick={() =>
          void navigator.clipboard.writeText(view.branch).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        <BranchIcon size={12} />
        <span>{copied ? '복사됨' : view.branch}</span>
      </button>
      <span aria-hidden="true">←</span>
      <code>{view.base}</code>
    </span>
  )
}

export function WorkHeader(p: {
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
  const prs = [view.pr, ...view.exports.map((x) => x.pr)].filter((x) => x !== null)
  return (
    <header className="work-head">
      <div className="work-head-main">
        <h1 className="work-name" title={view.title}>
          {view.title}
        </h1>
        <div className="work-meta">
          <Steps view={view} />
          <Branch view={view} />
          {prs.map((pr) => (
            <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer">
              PR #{pr.number}
            </a>
          ))}
        </div>
        {/* 남아 있는 마지막 실패는 새 일이 아니다: Work를 고를 때마다 다시 알리지 않는다(role alert 없음) */}
        <ErrorLine text={view.error ? `마지막 실패: ${view.error}` : null} quiet />
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
          <MoreMenu
            label="더 보기"
            variant="ghost"
            isDisabled={act.busy}
            items={[
              {
                id: 'abandon',
                label: '버리기',
                description: '세션을 끝냅니다. 브랜치와 worktree는 남습니다',
                variant: 'destructive',
                onClick: () => setAbandoning(true),
              },
            ]}
          />
        ) : null}
      </div>
      <AlertDialog
        isOpen={abandoning && active}
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
