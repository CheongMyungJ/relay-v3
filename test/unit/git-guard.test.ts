// [단위] 세션의 git·gh 바닥 막기: 작업 브랜치 push와 PR 열기는 두고 되돌리기 어려운 것만 막는다.
// v2 app/test/unit/git-guard.test.ts의 경우를 옮겼다(v2의 deny 규칙 경우는 v3에 deny 규칙이 없어 뺐다).
import { describe, expect, test } from 'vitest'
import { guardCommand } from '../../src/core/git-guard.ts'

// 기준 브랜치 develop. main, master는 늘 지킨다
const guard = (cmd: string) => guardCommand(cmd, ['develop'])

describe('guardCommand', () => {
  test('작업 브랜치 push, upstream 설정, PR 열기와 보기는 막지 않는다', () => {
    for (const cmd of [
      'git push',
      'git push -u origin relay/median-a1b2',
      'git push origin HEAD',
      'git push origin HEAD:refs/heads/relay/a',
      'git -C /tmp/x push origin feat/b',
      'gh pr create --title t --body b',
      'gh pr view 3',
      'git stash push -m wip',
      'git log --grep=push',
      'echo "git push origin main"',
      'gh api repos/o/r/pulls/1',
    ])
      expect(guard(cmd), cmd).toEqual({ blocked: false, reason: '' })
  })

  test('지킬 브랜치(main, master, 기준)에 push하면 막는다', () => {
    for (const cmd of [
      'git push origin main',
      'git push origin HEAD:main',
      'git push origin refs/heads/master',
      'git push origin develop',
      'cd x && git push origin HEAD:develop',
    ]) {
      const r = guard(cmd)
      expect(r.blocked, cmd).toBe(true)
      expect(r.reason, cmd).toMatch(/에 바로 push하지 않습니다/)
    }
  })

  test('기준 브랜치는 refs/heads/로 주어도 같다', () => {
    expect(guardCommand('git push origin develop', ['refs/heads/develop']).blocked).toBe(true)
    expect(guardCommand('git push origin develop', []).blocked).toBe(false)
  })

  test('따옴표, 서브셸, 명령 치환, bash -c 안의 push와 여러 브랜치 refspec도 본다', () => {
    for (const cmd of [
      'git push origin "HEAD:main"',
      "git push origin 'main'",
      '(git push origin main)',
      "bash -c 'git push origin main'",
      'echo $(git push origin main)',
      'git push origin refs/heads/*:refs/heads/*',
    ])
      expect(guard(cmd).blocked, cmd).toBe(true)
  })

  test('강제 push, 원격 브랜치 지우기, 모든 브랜치 push, PR 머지를 막는다', () => {
    for (const cmd of [
      'git push -f origin relay/a',
      'git push --force origin relay/a',
      'git push --force-with-lease',
      'git push -uf origin relay/a',
      'git push origin +relay/a',
      'git push origin :relay/a',
      'git push --delete origin relay/a',
      'git push --all',
      'git push --mirror',
      'gh pr merge 3 --squash',
      'git push -ud origin feat',
      'gh api -X PUT repos/o/r/pulls/1/merge',
      'gh api --method DELETE repos/o/r/git/refs/heads/x',
    ]) {
      const r = guard(cmd)
      expect(r.blocked, cmd).toBe(true)
      expect(r.reason, cmd).toMatch(/relay/)
    }
  })

  test('gh pr의 -R/--repo 뒤 merge, gh api의 GraphQL 머지·기준 ref 바꾸기·바로 머지·바로 커밋도 막는다', () => {
    for (const cmd of [
      'gh pr -R o/r merge 5',
      'gh pr --repo o/r merge 5',
      'gh pr --repo=o/r merge 5',
      'gh -R o/r pr merge 5',
      'gh pr "merge" 5',
      'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
      "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
      'gh api graphql -f query=\'mutation { updateRef(input: {refId: "x", oid: "y", force: true}) { ref { name } } }\'',
      'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true',
      'gh api -X PATCH repos/o/r/git/refs/heads/develop -f sha=abc',
      'gh api -X PATCH repos/o/r/git/refs/heads/relay/x -f sha=abc -F force=true',
      'gh api repos/o/r/merges -f base=main -f head=relay/x',
      'gh api -X POST /repos/o/r/merges --input body.json',
      'gh api -X PUT repos/o/r/contents/README.md -f message=m -f content=eA==',
      'gh api -X PUT repos/o/r/contents/README.md -f message=m -f content=eA== -f branch=main',
    ]) {
      const r = guard(cmd)
      expect(r.blocked, cmd).toBe(true)
      expect(r.reason, cmd).toMatch(/relay/)
    }
  })

  test('gh api의 읽기, 작업 브랜치 ref 갱신, 작업 브랜치에 커밋, GraphQL 읽기는 막지 않는다', () => {
    for (const cmd of [
      'gh api repos/o/r/merges',
      'gh api repos/o/r/git/refs/heads/main',
      'gh api -X PATCH repos/o/r/git/refs/heads/relay/x -f sha=abc',
      'gh api -X PUT repos/o/r/contents/a.md -f message=m -f content=eA== -f branch=relay/x',
      "gh api graphql -f query='query { viewer { login } }'",
      'gh pr -R o/r view 5',
      'gh pr create --repo o/r --title merge',
    ])
      expect(guard(cmd), cmd).toEqual({ blocked: false, reason: '' })
  })

  test('따옴표로 감싼 refspec의 목적지도 셸처럼 이어 붙여 본다', () => {
    for (const cmd of [
      'git push origin HEAD:"main"',
      "git push origin HEAD:'main'",
      'git push origin HEAD:"refs/heads/develop"',
      'git push origin "+"relay/a',
    ])
      expect(guardCommand(cmd, ['develop']).blocked, cmd).toBe(true)
  })

  test('까닭은 막은 것을 말한다', () => {
    expect(guard('gh pr merge 3').reason).toBe('PR 머지는 사람이 합니다. relay가 막았습니다')
    expect(guard('git push -f origin relay/a').reason).toContain('(-f)')
    expect(guard('git push origin +relay/a').reason).toBe('강제 push(+relay/a)는 relay가 막습니다')
  })
})
