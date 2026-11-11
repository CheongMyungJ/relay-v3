// 새 Work 대화상자와 프로젝트 설정 (docs/m2-modules.md 4절). 대화상자와 입력은 Astryx 부품이다.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton'
import type { NewWorkInput, ProjectSettings, ProjectView, WorkView } from '../../shared/api.ts'
import { RecordTable } from './RecordTable.tsx'
import { ErrorLine, useAction } from './ui.tsx'

/** 너비: wide 600, draft 760 */
const WIDTH = { wide: 600, draft: 760 } as const

/**
 * relay의 대화상자는 모두 입력이 있다(purpose form): Esc·✕·취소로 닫고, 바탕을 눌러서는 닫지 않는다(쓰던 글을 잃지
 * 않게, V77). 내용은 .dialog-body가 스크롤한다
 */
export function Modal(p: {
  title: string
  onClose: () => void
  children: ReactNode
  size: keyof typeof WIDTH
}) {
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) p.onClose()
      }}
      width={WIDTH[p.size]}
      maxHeight="calc(100dvh - 48px)"
      purpose="form"
      aria-label={p.title}
    >
      <DialogHeader title={p.title} onOpenChange={() => p.onClose()} />
      <div className="dialog-body">{p.children}</div>
    </Dialog>
  )
}

/** 대화상자 맨 아래의 동작 줄 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="row end dialog-actions">{children}</div>
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
    <Modal title="새 Work" onClose={p.onClose} size="wide">
      <form className="form" onSubmit={submit}>
        {p.projects.length > 1 ? (
          <Selector
            label="프로젝트"
            width="100%"
            value={projectId}
            options={p.projects.map((x) => ({ value: x.id, label: x.name }))}
            onChange={(v) => {
              setProjectId(v)
              const next = p.projects.find((x) => x.id === v)
              setBase(next?.defaultBranch ?? '')
            }}
          />
        ) : (
          <Text type="supporting" as="p">
            프로젝트 <strong>{project?.name}</strong> <span className="small">{project?.path}</span>
          </Text>
        )}
        <TextArea
          label="요청"
          rows={6}
          width="100%"
          value={request}
          onChange={setRequest}
          placeholder="무엇을 바라나요? 세션이 이 글을 읽고 계약 초안을 씁니다."
          hasAutoFocus
        />
        <div className="field-group">
          <ToggleButtonGroup
            label="일의 성격 제안"
            size="sm"
            type="single"
            value={HINTS.includes(hint) ? hint : null}
            onChange={(v) => setHint(typeof v === 'string' ? v : '')}
          >
            {HINTS.map((h) => (
              <ToggleButton key={h} value={h} label={h} />
            ))}
          </ToggleButtonGroup>
          <TextInput
            label="일의 성격 직접 쓰기"
            description="일의 성격 제안(선택). 위에서 고르거나 직접 씁니다."
            isOptional
            width="100%"
            value={hint}
            onChange={setHint}
            placeholder="예) 동작은 그대로 두는 정리로 봐 주세요"
          />
        </div>
        <TextInput
          label="기준 브랜치"
          width="100%"
          value={base}
          onChange={setBase}
          placeholder="origin의 기본 브랜치"
          controlClassName="mono"
        />
        <ErrorLine text={act.error} />
        <DialogActions>
          <Button variant="ghost" label="취소" onClick={p.onClose} />
          <Button
            type="submit"
            variant="primary"
            label="만들기"
            isLoading={act.busy}
            isDisabled={request.trim() === ''}
          />
        </DialogActions>
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
    <div className="field-group">
      <Text type="label">{p.label}</Text>
      <SegmentedControl label={p.label} value={p.value} onChange={(v) => p.onChange(v as T)}>
        {p.options.map((o) => (
          <SegmentedControlItem key={o.value} value={o.value} label={o.label} />
        ))}
      </SegmentedControl>
      {p.help ? <Text type="supporting">{p.help}</Text> : null}
    </div>
  )
}

/** 설정의 켜고 끄기 한 줄: 제목이 이름, 설명이 아래 글 */
function Toggle(p: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="switch-row">
      <Switch
        label={p.label}
        description={p.description}
        value={p.value}
        onChange={(v) => p.onChange(v)}
        labelPosition="start"
        labelSpacing="spread"
        width="100%"
      />
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
    <Modal title={`${p.project.name} 설정`} onClose={p.onClose} size="wide">
      <form className="form" onSubmit={save}>
        <Toggle
          label="자동 머지"
          description="레포의 자동 조건, 서버 쪽 보호(필수 검사), 그 조건의 그림자 실적을 모두 채울 때만 자동으로 머지합니다. 꺼 두어도 결론은 그림자로 기록합니다."
          value={s.auto_merge}
          onChange={(v) => set('auto_merge', v)}
        />
        <div className="field-group">
          <NumberInput
            label="그림자 실적 기준"
            width={160}
            min={0}
            step={1}
            isIntegerOnly
            hasNumberSteppers
            value={s.min_shadow}
            onChange={(v) => set('min_shadow', Math.max(0, Math.floor(Number(v))))}
          />
          <Text type="supporting">
            자동 머지에 필요한 그림자 일치 수입니다. 일치율도 95% 이상이어야 합니다.
          </Text>
        </div>
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
        <Toggle
          label="지식 잇기"
          description="요청에 관련된 docs/knowledge/ 항목의 목록을 세션에 주고, 바뀐 지식 파일의 형식을 증거에서 확인합니다. 새로 만드는 Work에 적용됩니다."
          value={s.m3.knowledge}
          onChange={(v) => set('m3', { ...s.m3, knowledge: v })}
        />
        <Toggle
          label="빚 기록"
          description={`래칫이 나빠진 채 머지하거나 끝낼 때 .relay/debt/에 빚으로 남길지 한 번 묻고, 새 Work를 만들 때 기록 안 된 나빠짐을 알립니다. 새로 만드는 Work에 적용됩니다.${
            p.project.unrecordedDebt > 0
              ? ` 받아들였지만 기록하지 않은 나빠짐: ${p.project.unrecordedDebt}건.`
              : ''
          }`}
          value={s.m3.debt}
          onChange={(v) => set('m3', { ...s.m3, debt: v })}
        />
        <Toggle
          label="곁들일 정리"
          description=".relay/debt/의 빚 목록을 세션에 주어 계약의 곁들일 정리로 집게 하고, 갚은 빚과 못 갚은 빚, 건드린 곳의 빚을 증거에 보입니다. 새로 만드는 Work에 적용됩니다."
          value={s.m3.tidy}
          onChange={(v) => set('m3', { ...s.m3, tidy: v })}
        />
        <Toggle
          label="규칙 승격"
          description="기계로 볼 수 있는 지식 규칙을 lint 설정이나 스크립트의 검사로 옮겨 check:에 적게 하고, 말로만 남은 규칙과 승격된 규칙의 늘어난 허용 목록을 증거에 보입니다. 새로 만드는 Work에 적용됩니다."
          value={s.m3.promote}
          onChange={(v) => set('m3', { ...s.m3, promote: v })}
        />
        <Toggle
          label="세션 커밋 트레일러"
          description="세션이 만든 커밋에 Relay-Work 트레일러를 붙여 사람 커밋과 가릅니다. 세션 프로세스에만 훅 자리를 주고 레포의 훅에 그대로 넘깁니다. 레포 설정과 훅 파일은 바꾸지 않습니다. 훅 위임 사고가 나면 relay가 끕니다. 다음에 띄우는 세션부터 적용됩니다."
          value={s.trailer}
          onChange={(v) => set('trailer', v)}
        />
        <RecordTable project={p.project} />
        <ErrorLine text={act.error} />
        <DialogActions>
          <Button variant="ghost" label="취소" onClick={p.onClose} />
          <Button type="submit" variant="primary" label="저장" isLoading={act.busy} />
        </DialogActions>
      </form>
    </Modal>
  )
}
