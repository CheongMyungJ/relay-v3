// 렌더러의 뿌리 (docs/m2-modules.md 4절): 왼쪽 사이드바, 가운데 터미널, 오른쪽 패널. 틀은 Astryx AppShell이다.
// 상태는 메인이 정본이다. 처음에 list()로 받고, 그 뒤로는 이벤트(EVENTS.work, EVENTS.projects)로 바꾼다.
import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Button } from '@astryxdesign/core/Button'
import { EVENTS, type ProjectView, type WorkView } from '../../shared/api.ts'
import { NewWorkDialog, SettingsDialog } from './dialogs.tsx'
import { Sidebar } from './Sidebar.tsx'
import { newWorkKey, newWorkKeyText } from './keys.ts'
import { Empty, ErrorLine, useAction } from './ui.tsx'
import { WorkPane } from './WorkPane.tsx'

type Dialog = { kind: 'new'; project: string } | { kind: 'settings'; project: string } | null

function upsert(works: WorkView[], w: WorkView): WorkView[] {
  const i = works.findIndex((x) => x.id === w.id)
  if (i < 0) return [w, ...works]
  const next = works.slice()
  next[i] = w
  return next
}

export function App() {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [works, setWorks] = useState<WorkView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { run: runAdd, busy: adding, error: addError } = useAction()

  useEffect(() => {
    // 이벤트를 먼저 구독한다. list의 답보다 먼저 온 이벤트는 그 답보다 오래된 것이다(같은 IPC 통로의 차례)
    const offWork = window.relay.on(EVENTS.work, (w) => setWorks((ws) => upsert(ws, w)))
    const offProjects = window.relay.on(EVENTS.projects, setProjects)
    // OS 알림을 눌렀다(V78): 그 Work를 고른다
    const offShow = window.relay.on(EVENTS.show, ({ id }) => setSelected(id))
    window.relay.list().then(
      (l) => {
        setProjects(l.projects)
        setWorks(l.works)
        setSelected((s) => s ?? l.works[0]?.id ?? null)
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      offWork()
      offProjects()
      offShow()
    }
  }, [])

  const addProject = useCallback(
    () =>
      void runAdd(async () => {
        const p = await window.relay.addProject()
        if (p) setProjects((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]))
      }),
    [runAdd],
  )

  const view = works.find((w) => w.id === selected) ?? null
  // 새 Work 단축키(V78): 고른 Work의 프로젝트, 없으면 첫 프로젝트. 대화상자가 열려 있으면 듣지 않는다
  const target = view?.project ?? projects[0]?.id ?? null
  const dialogOpen = dialog !== null
  useEffect(() => {
    if (target === null || dialogOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (!newWorkKey(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDialog({ kind: 'new', project: target })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [target, dialogOpen])
  const closeDialog = useCallback(() => setDialog(null), [])
  const settingsProject =
    dialog?.kind === 'settings' ? projects.find((p) => p.id === dialog.project) : undefined

  return (
    <>
      <AppShell
        variant="section"
        contentPadding={0}
        mobileNav={false}
        sideNav={
          <Sidebar
            projects={projects}
            works={works}
            selected={selected}
            onSelect={setSelected}
            onNewWork={(project) => setDialog({ kind: 'new', project })}
            onSettings={(project) => setDialog({ kind: 'settings', project })}
            onAddProject={addProject}
          />
        }
      >
        <div className="main">
          <ErrorLine text={loadError ?? addError} />
          {view ? (
            <WorkPane
              key={view.id}
              view={view}
              project={projects.find((p) => p.id === view.project) ?? null}
            />
          ) : projects.length === 0 ? (
            <Empty
              title="프로젝트를 추가하세요"
              actions={
                <Button
                  variant="primary"
                  label="프로젝트 추가"
                  onClick={addProject}
                  isDisabled={adding}
                />
              }
            >
              <p>git 레포 폴더를 고르면 그 레포에 Work를 맡길 수 있습니다.</p>
            </Empty>
          ) : (
            <Empty
              title="Work를 고르거나 새로 만드세요"
              actions={
                <Button
                  variant="primary"
                  label="새 Work"
                  onClick={() => {
                    const first = projects[0]
                    if (first) setDialog({ kind: 'new', project: first.id })
                  }}
                />
              }
            >
              <p>
                요청을 쓰면 세션이 계약을 먼저 씁니다. 승인하면 세션이 알아서 구현하고, 앱이 증거를
                확인합니다.
              </p>
              <p className="small">단축키 {newWorkKeyText()}</p>
            </Empty>
          )}
        </div>
      </AppShell>
      {dialog?.kind === 'new' ? (
        <NewWorkDialog
          projects={projects}
          projectId={dialog.project}
          onClose={closeDialog}
          onCreated={(w) => {
            setWorks((ws) => upsert(ws, w))
            setDialog(null)
            setSelected(w.id)
          }}
        />
      ) : null}
      {settingsProject ? <SettingsDialog project={settingsProject} onClose={closeDialog} /> : null}
    </>
  )
}
