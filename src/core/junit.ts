// JUnit XML 읽기 (V11). vitest, node:test, pytest, jest-junit이 실제로 내는 모양을 받는다.
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { err, ok, type Result } from './result.ts'
import type { TestCase, TestStatus } from './types.ts'

// preserveOrder로 읽은 마디: { <태그>: 자식[], ':@'?: 속성 } 또는 { '#text': 글 }
type XmlNode = Record<string, unknown>

const ATTRS = ':@'
const TEXT = '#text'
const MESSAGE_MAX = 500

/** 한 testcase에 자식이 여럿이면 센 쪽을 쓴다 (pytest는 failure 뒤에 teardown error를 붙인다) */
const RANK: Record<TestStatus, number> = { passed: 0, skipped: 1, error: 2, failed: 3 }

/** node:test가 시험 코드 밖의 실패에 붙이는 failure type. 단언 실패가 아니라 오류로 본다 */
const NODE_TEST_ERRORS = new Set(['hookFailed', 'cancelledByParent'])

function tagOf(n: XmlNode): string | null {
  for (const k of Object.keys(n)) if (k !== ATTRS) return k
  return null
}

function childrenOf(n: XmlNode): XmlNode[] {
  const tag = tagOf(n)
  const kids = tag === null ? undefined : n[tag]
  return Array.isArray(kids) ? (kids as XmlNode[]) : []
}

function attr(n: XmlNode, name: string): string | undefined {
  const a = n[ATTRS]
  if (typeof a !== 'object' || a === null) return undefined
  const v = (a as Record<string, unknown>)[name]
  if (typeof v === 'string') return v
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined
}

function textOf(n: XmlNode): string {
  return childrenOf(n)
    .map((k) => (typeof k[TEXT] === 'string' ? k[TEXT] : ''))
    .join('')
}

function clip(s: string): string {
  return s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s
}

/** message 속성이 있으면 그것, 없으면(jest-junit) 본문의 첫 줄 */
function messageOf(n: XmlNode): string | undefined {
  const m = attr(n, 'message')?.replace(/\s+/g, ' ').trim()
  if (m !== undefined && m !== '') return clip(m)
  const first = textOf(n)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '')
  return first === undefined ? undefined : clip(first)
}

function statusOf(n: XmlNode): TestStatus | null {
  switch (tagOf(n)) {
    case 'failure':
      return NODE_TEST_ERRORS.has(attr(n, 'type') ?? '') ? 'error' : 'failed'
    case 'error':
      return 'error'
    case 'skipped':
      return 'skipped'
    default:
      // system-out, properties, rerunFailure 같은 것은 결과를 바꾸지 않는다
      return null
  }
}

function readCase(n: XmlNode, suites: string[]): TestCase {
  let status: TestStatus = 'passed'
  let message: string | undefined
  for (const k of childrenOf(n)) {
    const s = statusOf(k)
    if (s === null || RANK[s] <= RANK[status]) continue
    status = s
    message = messageOf(k)
  }
  const tc: TestCase = { name: attr(n, 'name') ?? '', status }
  const classname = attr(n, 'classname')
  const file = attr(n, 'file')
  // vitest처럼 testsuite가 파일 이름이면 classname과 같아 뺀다
  const suite = suites.filter((s) => s !== '' && s !== classname && s !== file).join(' > ')
  if (suite !== '') tc.suite = suite
  if (classname !== undefined && classname !== '') tc.classname = classname
  if (file !== undefined && file !== '') tc.file = file
  if (message !== undefined) tc.message = message
  return tc
}

/**
 * testsuites·testsuite는 몇 겹이든 들어간다(node:test는 describe마다 testsuite를 겹친다).
 * 감싼 testsuite 이름은 testcase의 suite에 남긴다(맨 위 testsuites의 이름은 뺀다).
 */
function collect(nodes: XmlNode[], out: TestCase[], suites: string[]): void {
  for (const n of nodes) {
    const tag = tagOf(n)
    if (tag === 'testcase') out.push(readCase(n, suites))
    else if (tag === 'testsuites') collect(childrenOf(n), out, suites)
    else if (tag === 'testsuite') collect(childrenOf(n), out, [...suites, attr(n, 'name') ?? ''])
  }
}

function isElement(n: XmlNode): boolean {
  const tag = tagOf(n)
  return tag !== null && tag !== TEXT && !tag.startsWith('?') && !tag.startsWith('!')
}

export function parseJUnit(xml: string): Result<TestCase[]> {
  const text = xml.replace(/^\uFEFF/, '')
  if (text.trim() === '') return err('JUnit 파일이 비어 있음')

  const valid = XMLValidator.validate(text)
  if (valid !== true) return err(`XML을 읽지 못함: ${valid.err.msg} (${valid.err.line}줄)`)

  let doc: unknown
  try {
    doc = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseTagValue: false,
      // &#65; 같은 숫자 참조도 푼다. 끄면 이름에 '&#65;'가 그대로 남는다
      htmlEntities: true,
    }).parse(text)
  } catch (cause) {
    return err(`XML을 읽지 못함: ${(cause as Error).message}`)
  }
  const roots = (Array.isArray(doc) ? (doc as XmlNode[]) : []).filter(isElement)
  if (roots.length !== 1) return err('JUnit 모양이 아님: 맨 위 요소가 하나가 아님')
  const root = roots[0] as XmlNode
  const tag = tagOf(root)
  if (tag !== 'testsuites' && tag !== 'testsuite')
    return err(`JUnit 모양이 아님: 맨 위 요소가 <${tag ?? ''}>`)

  const out: TestCase[] = []
  collect([root], out, [])
  return ok(out)
}
