// 가운데 터미널 (docs/m2-modules.md 4절). xterm은 terminals.ts가 Work마다 들고 있고, 여기서는 붙이고 뗀다.
import { useEffect, useRef } from 'react'
import { mountTerminal, setTerminalLive } from './terminals.ts'

export function TerminalView({ workId, live }: { workId: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return mountTerminal(workId, el)
  }, [workId])

  useEffect(() => setTerminalLive(workId, live), [workId, live])

  return <div ref={ref} className="terminal-host" data-work={workId} data-testid="terminal" />
}
