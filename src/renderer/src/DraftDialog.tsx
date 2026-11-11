// 품질 기준 초안 화면 (V60~V62, docs/quality-floor.md 5.1): [초안 만들기]가 짜서 지금 커밋에서 한 번 돌려 본 결과. 언어,
// 돌려 본 명령(됨·안 됨과 까닭), 래칫의 지금 값, 고칠 것(초안에서 뺀 것), 묻는 것(셋까지), 빠진 도구의 제안을 보이고 [초안 쓰기]가
// 답을 넣어 작업 트리에 쓴다. 커밋은 사람이 한다(V20).
import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { TextInput } from '@astryxdesign/core/TextInput'
import type {
  DraftAnswersInput,
  DraftCommandView,
  DraftPreview,
  DraftQualityResult,
  DraftQuestionView,
} from '../../shared/api.ts'
import { Modal } from './dialogs.tsx'
import { Fold, Tag, useAction } from './ui.tsx'

const KIND: Readonly<Record<DraftCommandView['kind'], string>> = {
  setup: '설치',
  fast: '빠른 검사',
  acceptance: '수용 시험',
  ratchet: '래칫',
}

const secs = (ms: number | undefined) =>
  ms === undefined ? '' : `${(Math.round(ms / 100) / 10).toFixed(1)}초`

/** 고른 후보와 글 칸(쉼표·줄바꿈으로 나눔)을 답으로 */
export function answersOf(
  questions: DraftQuestionView[],
  picked: Record<string, string[]>,
  typed: Record<string, string>,
): DraftAnswersInput {
  const out: DraftAnswersInput = {}
  for (const q of questions) {
    const extra = (typed[q.id] ?? '').split(/[,\n]/).map((s) => s.trim())
    const all = [...(picked[q.id] ?? []), ...extra].filter((s) => s !== '')
    if (all.length > 0) out[q.id] = [...new Set(all)]
  }
  return out
}

function CommandLine({ c }: { c: DraftCommandView }) {
  return (
    <li className="draft-command">
      <Tag tone={c.ok ? 'ok' : 'bad'}>{c.ok ? '됨' : '안 됨'}</Tag>
      <span className="draft-id">{c.id}</span>
      <span className="muted small">{KIND[c.kind]}</span>
      {c.duration_ms === undefined ? null : (
        <span className="muted small">{secs(c.duration_ms)}</span>
      )}
      <code className="draft-run">{c.run}</code>
      {c.ok ? null : <span className="draft-reason">{c.reason}</span>}
    </li>
  )
}

export function DraftDialog(p: {
  projectName: string
  preview: DraftPreview
  onClose: () => void
  onWritten: (r: DraftQualityResult) => void
  write: (answers: DraftAnswersInput) => Promise<DraftQualityResult>
}) {
  const v = p.preview
  const act = useAction()
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [typed, setTyped] = useState<Record<string, string>>({})
  const toggle = (id: string, value: string, on: boolean) =>
    setPicked((s) => {
      const now = (s[id] ?? []).filter((x) => x !== value)
      return { ...s, [id]: on ? [...now, value] : now }
    })
  const write = () =>
    void act.run(async () => p.onWritten(await p.write(answersOf(v.questions, picked, typed))))
  const units = v.units.map((u) => (u.dir === '.' ? u.label : `${u.label} ${u.dir}/`))
  // Astryx Dialog는 맨 위 층(<dialog>)에 뜬다: 사이드바의 좁은 알림 안에서 열려도 그 글꼴·색을 물려받지 않는다
  return (
    <Modal
      title={`품질 기준 초안 · ${p.projectName}`}
      onClose={p.onClose}
      size="draft"
      error={act.error}
      footer={
        <>
          <Button variant="ghost" label="닫기" onClick={p.onClose} />
          <Button
            variant="primary"
            label="초안 쓰기"
            isLoading={act.busy}
            isDisabled={v.exists}
            onClick={write}
          />
        </>
      }
    >
      <div className="draft" data-testid="draft-dialog">
        <p className="muted">
          언어: {units.length === 0 ? '찾지 못함(앱이 직접 재는 래칫만)' : units.join(', ')}.{' '}
          {v.head === null
            ? '커밋이 없어 돌려 보지 못했습니다.'
            : `지금 커밋 ${v.head.slice(0, 7)}에서 한 번씩 돌려 봤습니다.`}
        </p>
        {v.commands.length > 0 ? (
          <section>
            <h3 className="draft-head">돌려 본 명령</h3>
            <ul className="draft-list" data-testid="draft-commands">
              {v.commands.map((c) => (
                <CommandLine key={`${c.kind}:${c.id}`} c={c} />
              ))}
            </ul>
          </section>
        ) : null}
        {v.values.length > 0 ? (
          <section>
            <h3 className="draft-head">지금 값</h3>
            <ul className="draft-list" data-testid="draft-values">
              {v.values.map((x) => (
                <li key={x.id}>
                  <span className="draft-id">{x.id}</span> {x.text}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {v.fixes.length > 0 ? (
          <section className="draft-fixes" data-testid="draft-fixes">
            <h3 className="draft-head">고칠 것 · 초안에서 뺌</h3>
            <ul className="draft-list">
              {v.fixes.map((c) => (
                <li key={`${c.kind}:${c.id}`} className="draft-command">
                  <span className="draft-id">{c.id}</span>
                  <span className="muted small">{KIND[c.kind]}</span>
                  <code className="draft-run">{c.run}</code>
                  <span className="draft-reason">{c.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {v.questions.length > 0 ? (
          <section data-testid="draft-questions">
            <h3 className="draft-head">묻는 것</h3>
            {v.questions.map((q) => (
              <fieldset key={q.id} className="draft-question" data-testid={`draft-q-${q.id}`}>
                <legend>{q.text}</legend>
                <span className="help">{q.hint}</span>
                {q.options.map((o) => (
                  <div key={o.value} className="draft-option">
                    <CheckboxInput
                      size="sm"
                      label={o.label}
                      value={(picked[q.id] ?? []).includes(o.value)}
                      onChange={(on) => toggle(q.id, o.value, on)}
                    />
                  </div>
                ))}
                <TextInput
                  size="sm"
                  width="100%"
                  label={`${q.text}: 더 적기`}
                  isLabelHidden
                  placeholder="더 적기(쉼표로 나눔)"
                  value={typed[q.id] ?? ''}
                  onChange={(v) => setTyped((s) => ({ ...s, [q.id]: v }))}
                />
              </fieldset>
            ))}
          </section>
        ) : null}
        {v.suggestions.length > 0 ? (
          <section>
            <h3 className="draft-head">제안 · 설치하지 않음</h3>
            <ul className="draft-list muted" data-testid="draft-suggestions">
              {v.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <Fold title="쓸 초안(.relay/quality.json, 답을 넣기 전)">
          <div className="draft-text">
            <CodeBlock code={v.text} language="json" size="sm" width="100%" maxHeight={260} />
          </div>
        </Fold>
        {v.exists ? (
          <p className="quality-drafted">
            작업 트리에 이미 .relay/quality.json이 있어 덮지 않습니다. 고치려면 직접 고칩니다.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
