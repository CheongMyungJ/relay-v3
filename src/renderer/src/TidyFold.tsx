// [증거]의 '빚' 칸(곁들일 정리 M3c, V41): 정리 몫과 상한, 갚은 빚, 못 갚은 빚, 건드린 곳의 빚. 알림이다(관문 사실이 아니다).
// EvidencePanel.tsx가 600줄을 넘지 않게 나눴다. 묶음을 나누는 글은 debt.ts(tidyGroups, tidyLinesText).
import type { DebtPayoff, EvidenceBundle } from '../../core/types.ts'
import { tidyGroups, tidyLinesText } from './debt.ts'
import type { Tone } from './format.ts'
import { Fold, Tag } from './ui.tsx'

const STATUS: Record<DebtPayoff['status'], { label: string; tone: Tone }> = {
  paid: { label: '갚음', tone: 'ok' },
  open: { label: '못 갚음', tone: 'warn' },
  unknown: { label: '모름', tone: 'muted' },
}

function Items(p: { id: string; title: string; items: DebtPayoff[] }) {
  if (p.items.length === 0) return null
  return (
    <section data-testid={p.id}>
      <p className="muted small">{p.title}</p>
      <ul className="fact-list">
        {p.items.map((i) => (
          <li key={i.id}>
            <Tag tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Tag>
            <code>{i.path || i.id}</code>
            <span>{i.reason}</span>
            <span className="muted">
              {' '}
              {i.id} · {i.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TidyFold({ t }: { t: NonNullable<EvidenceBundle['tidy']> }) {
  const g = tidyGroups(t)
  const lines = tidyLinesText(t)
  return (
    <Fold title="빚" count={g.unpaid.length + g.touched.length + (g.over ? 1 : 0)}>
      {lines ? (
        <p className={g.over ? undefined : 'muted'} data-testid="tidy-lines">
          {g.over ? <Tag tone="warn">상한 넘음</Tag> : null}
          {lines}
        </p>
      ) : null}
      {t.items.length === 0 ? <p className="muted">갚거나 건드린 빚이 없음</p> : null}
      <Items id="tidy-paid" title={`갚은 빚 ${g.paid.length}`} items={g.paid} />
      <Items
        id="tidy-unpaid"
        title={`못 갚은 빚 ${g.unpaid.length} · 계약의 곁들일 정리인데 갚지 않음`}
        items={g.unpaid}
      />
      <Items
        id="tidy-touched"
        title={`건드린 곳의 빚 ${g.touched.length} · 이 diff가 바꾼 경로에 있음. 끝내기 전에 세션에게 말할 수 있습니다`}
        items={g.touched}
      />
    </Fold>
  )
}
