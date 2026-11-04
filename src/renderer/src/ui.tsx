// 화면 곳곳에서 쓰는 작은 조각: 꼬리표, 빈 상태, 비동기 동작의 바쁨·오류.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Tone } from './format.ts'

export function Tag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tone-${tone}`}>{children}</span>
}

export function Dot({ tone, label }: { tone: Tone; label?: string }) {
  return <span className={`dot tone-${tone}`} aria-label={label} title={label} />
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="busy-line" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="error-line" role="alert">
      {text}
    </p>
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

export function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L14.2 2h-4l-.4 2.6a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6Z"
      />
    </svg>
  )
}
