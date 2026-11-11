// 화면 곳곳에서 쓰는 작은 조각: 꼬리표, 빈 상태, 비동기 동작의 바쁨·오류. 생김새는 Astryx(@astryxdesign/core)가 맡는다.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Heading } from '@astryxdesign/core/Heading'
import { Spinner as AxSpinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import type { Tone } from './format.ts'

/** 꼬리표의 색: 옅은 바탕에 진한 글(Badge의 색 이름). 흐림은 중립 */
const BADGE: Record<Tone, 'green' | 'orange' | 'red' | 'blue' | 'neutral'> = {
  ok: 'green',
  warn: 'orange',
  bad: 'red',
  info: 'blue',
  muted: 'neutral',
}

const DOT: Record<Tone, 'success' | 'warning' | 'error' | 'accent' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  info: 'accent',
  muted: 'neutral',
}

export function Tag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`tag tone-${tone}`}>
      <Badge variant={BADGE[tone]} label={children} />
    </span>
  )
}

/** 접는 칸의 오른쪽 한 마디: 숫자 대신 상태를 말한다(예: '2개 통과', '나빠짐 1') */
export interface FoldSummary {
  text: string
  tone: Tone
}

/**
 * 접는 칸: 제목, 오른쪽 한 마디(summary) 또는 수(count), 내용. 처음에는 닫혀 있다(open이면 열림). Collapsible은 닫힌 내용도
 * 그려 두므로, 무거운 내용은 lazy로 처음 열 때 그린다(그 뒤로는 닫아도 남김). help는 제목에 올리면 보이는 풀이
 */
export function Fold(p: {
  title: ReactNode
  count?: number
  summary?: FoldSummary
  help?: string
  open?: boolean
  lazy?: boolean
  className?: string
  testId?: string
  children: ReactNode
}) {
  const [opened, setOpened] = useState(p.open ?? false)
  return (
    <Collapsible
      className={`fold${p.className ? ` ${p.className}` : ''}`}
      data-testid={p.testId}
      defaultIsOpen={p.open ?? false}
      onOpenChange={(o) => {
        if (o) setOpened(true)
      }}
      chevronPosition="start"
      trigger={
        <span className="fold-trigger" title={p.help}>
          <span className="fold-title">{p.title}</span>
          {p.summary ? (
            <span className={`fold-summary tone-${p.summary.tone}`}>{p.summary.text}</span>
          ) : p.count === undefined ? null : (
            <span className="count">{p.count}</span>
          )}
        </span>
      }
    >
      <div className="fold-body">{!p.lazy || opened ? p.children : null}</div>
    </Collapsible>
  )
}

export function Dot({ tone, label }: { tone: Tone; label?: string }) {
  return <StatusDot variant={DOT[tone]} label={label ?? ''} tooltip={label} />
}

/** 빈 상태: 제목, 설명(선택), 동작(선택) */
export function Empty(p: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <Heading level={3}>{p.title}</Heading>
      {p.children ? <div className="empty-body">{p.children}</div> : null}
      {p.actions ? <div className="row empty-actions">{p.actions}</div> : null}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="busy-line" role="status">
      <AxSpinner size="sm" aria-label={label} />
      {label}
    </div>
  )
}

/** 오류 한 줄. 방금 난 실패는 알린다(role alert). quiet면 남아 있는 실패라 알리지 않는다 */
export function ErrorLine({ text, quiet }: { text: string | null; quiet?: boolean }) {
  if (!text) return null
  return (
    <div className="error-line" role={quiet ? undefined : 'alert'}>
      <Banner status="error" title={text} collapsible={false} />
    </div>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 버튼이 부르는 비동기 동작: 도는 동안 busy, 실패하면 error. 성공하면 true */
export function useAction(): {
  busy: boolean
  error: string | null
  run: (f: () => Promise<unknown>) => Promise<boolean>
  clear: () => void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = useCallback(async (f: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await f()
      return true
    } catch (e) {
      if (alive.current) setError(message(e))
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])
  const clear = useCallback(() => setError(null), [])
  return { busy, error, run, clear }
}
