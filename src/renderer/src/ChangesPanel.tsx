// [변경]과 [빚] 패널 (docs/m2-modules.md 4절). 변경: `git diff --stat`의 내용(모두 몇 줄, 파일마다 몇 줄과 막대)과 파일별
// diff(접기. 작은 diff는 펼친 채로, M2.1 13절). git의 영어 --stat 글은 좁은 패널에서 잘리므로 그대로 보이지 않고 patch에서
// 센다. 빚: 이 Work가 건드린 경로의 빚. HEAD가 바뀌면 다시 읽는다.
import { useEffect, useState } from 'react'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import type { DebtItem, DebtKind } from '../../core/types.ts'
import { diffOpen, splitDiff } from './format.ts'
import { Empty, ErrorLine, Fold, Spinner, Tag } from './ui.tsx'

export type Loaded<T> =
  { state: 'loading' } | { state: 'ok'; value: T } | { state: 'error'; error: string }

const loadDiff = (id: string) => window.relay.diff(id)
const loadDebt = (id: string) => window.relay.debt(id)

/** id와 head가 바뀔 때마다 읽는다. 늦게 온 앞 답은 버린다. load는 모듈의 함수(바뀌지 않음) */
export function useLoad<T>(
  load: (id: string) => Promise<T>,
  id: string,
  head: string | null,
): Loaded<T> {
  const key = `${id}:${head ?? ''}`
  const [got, setGot] = useState<{ key: string; value: Loaded<T> }>({
    key: '',
    value: { state: 'loading' },
  })
  useEffect(() => {
    let live = true
    load(id).then(
      (value) => live && setGot({ key, value: { state: 'ok', value } }),
      (e: unknown) =>
        live &&
        setGot({
          key,
          value: { state: 'error', error: e instanceof Error ? e.message : String(e) },
        }),
    )
    return () => {
      live = false
    }
  }, [load, id, key])
  return got.key === key ? got.value : { state: 'loading' }
}

export function DiffPanel({ id, head }: { id: string; head: string | null }) {
  const got = useLoad(loadDiff, id, head)
  if (got.state === 'loading') return <Spinner label="변경을 읽는 중…" />
  if (got.state === 'error') return <ErrorLine text={got.error} />
  const files = splitDiff(got.value)
  if (files.length === 0)
    return (
      <Empty title="아직 바뀐 것이 없습니다">
        세션이 커밋하면 기준 브랜치와의 차이가 보입니다.
      </Empty>
    )
  const added = files.reduce((n, f) => n + f.added, 0)
  const deleted = files.reduce((n, f) => n + f.deleted, 0)
  const most = Math.max(1, ...files.map((f) => f.added + f.deleted))
  const open = diffOpen(files)
  return (
    <div className="panel-body" data-testid="diff-panel">
      <p className="diff-summary">
        기준 브랜치와 갈라진 곳부터 파일 {files.length}개 바뀜
        <span className="diff-count">
          <span className="plus">+{added}</span> <span className="minus">−{deleted}</span>
        </span>
      </p>
      <div className="diff-files">
        {files.map((f) => (
          <Fold
            key={f.path}
            className="diff-file"
            open={open}
            title={
              <span className="diff-file-head">
                <code className="diff-path">{f.path}</code>
                <span className="diff-count">
                  {f.binary ? (
                    <span className="muted">바이너리</span>
                  ) : (
                    <>
                      <span className="plus">+{f.added}</span>{' '}
                      <span className="minus">−{f.deleted}</span>
                    </>
                  )}
                </span>
                <span className="diff-bar" aria-hidden="true">
                  <span className="plus" style={{ width: `${(f.added / most) * 100}%` }} />
                  <span className="minus" style={{ width: `${(f.deleted / most) * 100}%` }} />
                </span>
              </span>
            }
          >
            <div className="patch">
              <CodeBlock
                code={f.patch}
                isDiff
                isWrapped
                hasLanguageLabel={false}
                size="sm"
                width="100%"
                container="section"
                hasCopyButton={false}
              />
            </div>
          </Fold>
        ))}
      </div>
    </div>
  )
}

export const DEBT_KIND: Record<DebtKind, string> = {
  tidy: '정리',
  accepted_regression: '받아들인 나빠짐',
  rule_violation: '규칙 어김',
  test_gap: '시험 빈틈',
}

export function DebtPanel({ id, head }: { id: string; head: string | null }) {
  const got = useLoad<DebtItem[]>(loadDebt, id, head)
  if (got.state === 'loading') return <Spinner label="빚을 읽는 중…" />
  if (got.state === 'error') return <ErrorLine text={got.error} />
  if (got.value.length === 0)
    return (
      <Empty title="건드린 경로에 빚이 없습니다">
        레포의 <code>.relay/debt/</code>에 적힌 빚 가운데 이 Work가 바꾼 경로에 닿은 것만 보입니다.
      </Empty>
    )
  return (
    <div className="panel-body" data-testid="debt-panel">
      <ul className="debt-list">
        {got.value.map((d) => (
          <li key={d.id} className="debt">
            <div className="row tight">
              <Tag tone="warn">{DEBT_KIND[d.kind]}</Tag>
              <code>
                {d.anchor.path}
                {d.anchor.name ? ` · ${d.anchor.name}` : ''}
                {d.anchor.metric ? ` · ${d.anchor.metric}` : ''}
              </code>
            </div>
            <p>{d.reason}</p>
            <p className="muted small">
              {d.id} · {d.source} · {d.created}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
