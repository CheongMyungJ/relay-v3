// 새 Work 대화상자와 프로젝트 설정 (docs/m2-modules.md 4절).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { NewWorkInput, ProjectSettings, ProjectView, WorkView } from '../../shared/api.ts'
import { ErrorLine, useAction } from './ui.tsx'

function Modal(p: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { onClose } = p
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog${p.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
      >
        <h2 className="dialog-title">{p.title}</h2>
        {p.children}
      </div>
    </div>
  )
}

const HINTS = ['버그 고침', '기능', '리팩터링', '문서']

export function NewWorkDialog(p: {
  projects: ProjectView[]
  projectId: string
  onClose: () => void
  onCreated: (w: WorkView) => void
}) {
  const [projectId, setProjectId] = useState(p.projectId)
  const project = p.projects.find((x) => x.id === projectId)
  const [request, setRequest] = useState('')
  const [hint, setHint] = useState('')
  const [base, setBase] = useState(project?.defaultBranch ?? '')
  const act = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (request.trim() === '') return
    const input: NewWorkInput = { project: projectId, request: request.trim() }
    if (hint.trim()) input.hint = hint.trim()
    if (base.trim()) input.base = base.trim()
    void act.run(async () => {
      p.onCreated(await window.relay.createWork(input))
    })
  }

  return (
    <Modal title="새 Work" onClose={p.onClose} wide>
      <form className="form" onSubmit={submit}>
        {p.projects.length > 1 ? (
          <label className="field-label">
            프로젝트
            <select
              className="field"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                const next = p.projects.find((x) => x.id === e.target.value)
                setBase(next?.defaultBranch ?? '')
              }}
            >
              {p.projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted">
            프로젝트 <strong>{project?.name}</strong> <span className="small">{project?.path}</span>
          </p>
        )}
        <label className="field-label">
          요청
          <textarea
            className="field"
            rows={6}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="무엇을 바라나요? 세션이 이 글을 읽고 계약 초안을 씁니다."
            aria-label="요청"
            autoFocus
          />
        </label>
        <div className="field-label">
          <span>
            일의 성격 제안 <span className="muted small">(선택)</span>
          </span>
          <div className="chips" role="group" aria-label="일의 성격 제안">
            {HINTS.map((h) => (
              <button
                key={h}
                type="button"
                className={`chip${hint === h ? ' on' : ''}`}
                aria-pressed={hint === h}
                onClick={() => setHint(hint === h ? '' : h)}
              >
                {h}
              </button>
            ))}
          </div>
          <input
            className="field"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="직접 쓰기: 예) 동작은 그대로 두는 정리로 봐 주세요"
            aria-label="일의 성격 직접 쓰기"
          />
        </div>
        <label className="field-label">
          기준 브랜치
          <input
            className="field mono"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="origin의 기본 브랜치"
            aria-label="기준 브랜치"
          />
        </label>
        <ErrorLine text={act.error} />
        <div className="row end">
          <button type="button" className="ghost" onClick={p.onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={act.busy || request.trim() === ''}>
            {act.busy ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Choice<T extends string>(p: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  help?: string
}) {
  return (
    <div className="field-label">
      {p.label}
      <div className="segmented" role="radiogroup" aria-label={p.label}>
        {p.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={p.value === o.value}
            className={p.value === o.value ? 'on' : undefined}
            onClick={() => p.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {p.help ? <p className="help">{p.help}</p> : null}
    </div>
  )
}

export function SettingsDialog(p: { project: ProjectView; onClose: () => void }) {
  const [s, setS] = useState<ProjectSettings>(p.project.settings)
  const act = useAction()
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) =>
    setS((old) => ({ ...old, [k]: v }))
  const save = (e: FormEvent) => {
    e.preventDefault()
    void act.run(async () => {
      await window.relay.updateSettings(p.project.id, s)
      p.onClose()
    })
  }
  return (
    <Modal title={`${p.project.name} 설정`} onClose={p.onClose}>
      <form className="form" onSubmit={save}>
        <label className="switch-row">
          <span>
            <span className="switch-title">자동 머지</span>
            <span className="help">
              레포의 자동 조건, 서버 쪽 보호(필수 검사), 그 조건의 그림자 실적을 모두 채울 때만
              자동으로 머지합니다. 꺼 두어도 결론은 그림자로 기록합니다.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={s.auto_merge}
            onChange={(e) => set('auto_merge', e.target.checked)}
          />
        </label>
        <label className="field-label">
          그림자 실적 기준
          <input
            className="field narrow"
            type="number"
            min={0}
            step={1}
            value={s.min_shadow}
            onChange={(e) => set('min_shadow', Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className="help">
            자동 머지에 필요한 그림자 일치 수입니다. 일치율도 95% 이상이어야 합니다.
          </span>
        </label>
        <Choice
          label="리뷰 범위"
          value={s.review}
          onChange={(v) => set('review', v)}
          options={[
            { value: 'all', label: '내보낼 때마다' },
            { value: 'auto_only', label: '자동 후보에만' },
          ]}
          help="자동 머지 경로에서는 리뷰를 끌 수 없습니다."
        />
        <Choice
          label="머지 방식"
          value={s.merge_method}
          onChange={(v) => set('merge_method', v)}
          options={[
            { value: 'squash', label: '하나로 합치기' },
            { value: 'merge', label: '머지 커밋' },
            { value: 'rebase', label: '리베이스' },
          ]}
        />
        <Choice
          label="질문 방식"
          value={s.question_mode}
          onChange={(v) => set('question_mode', v)}
          options={[
            { value: 'confirm_each', label: '결정마다 확인' },
            { value: 'draft_first', label: '초안 먼저' },
          ]}
          help="새로 만드는 Work의 세션에 적용됩니다."
        />
        <label className="switch-row">
          <span>
            <span className="switch-title">지식 잇기</span>
            <span className="help">
              요청에 관련된 docs/knowledge/ 항목의 목록을 세션에 주고, 바뀐 지식 파일의 형식을
              증거에서 확인합니다. 새로 만드는 Work에 적용됩니다.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={s.m3.knowledge}
            onChange={(e) => set('m3', { ...s.m3, knowledge: e.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <span className="switch-title">빚 기록</span>
            <span className="help">
              래칫이 나빠진 채 머지하거나 끝낼 때 .relay/debt/에 빚으로 남길지 한 번 묻고, 새 Work를
              만들 때 기록 안 된 나빠짐을 알립니다. 새로 만드는 Work에 적용됩니다.
              {p.project.unrecordedDebt > 0
                ? ` 받아들였지만 기록하지 않은 나빠짐: ${p.project.unrecordedDebt}건.`
                : ''}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={s.m3.debt}
            onChange={(e) => set('m3', { ...s.m3, debt: e.target.checked })}
          />
        </label>
        <ErrorLine text={act.error} />
        <div className="row end">
          <button type="button" className="ghost" onClick={p.onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={act.busy}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}
