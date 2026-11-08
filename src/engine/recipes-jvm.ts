// Java·Kotlin 레시피 (V60, V70): Maven(mvnw), Gradle(gradlew). 여러 모듈 Maven은 빠른 검사와 수용 시험이 verify까지 간다
// (모듈 사이의 jar를 reactor가 만든다. 시범 찾은 문제 10). Kotlin 멀티플랫폼은 jvm 대상의 jvmTestClasses·jvmTest와
// build/test-results/jvmTest(문제 11). 순수 함수다.

import { at, filesUnder, JUNIT, namesIn, unit, type RepoScan, type Unit } from './recipe-kit.ts'
import { tomlEntries } from './toml-lite.ts'

/** 시험 결과 폴더(sub, 여럿이면 어느 것이든)의 TEST-*.xml을 하나의 JUnit 파일로 묶는 셸 조각(XML 선언 줄만 뺀다) */
export function mergeJUnit(sub: string | readonly string[]): string {
  const subs = typeof sub === 'string' ? [sub] : sub
  const paths = subs.map((s) => `-path '*/${s}/TEST-*.xml'`)
  const match = paths.length === 1 ? (paths[0] ?? '') : `\\( ${paths.join(' -o ')} \\)`
  const find = `find . ${match} -exec sed '/^<?xml/d' {} +`
  return `mkdir -p .relay-out && { echo '<testsuites>'; ${find}; echo '</testsuites>'; } > ${JUNIT}`
}

export function jvmUnit(scan: RepoScan, dir: string): Unit {
  const names = namesIn(scan.files, dir)
  if (names.has('pom.xml')) return mavenUnit(scan, dir, names)
  const build =
    scan.texts.get(at(dir, 'build.gradle.kts')) ?? scan.texts.get(at(dir, 'build.gradle')) ?? ''
  const kotlin =
    /kotlin\(|org\.jetbrains\.kotlin/.test(build) ||
    filesUnder(scan.files, dir).some((f) => f.endsWith('.kt'))
  const shape = gradleShape(scan, dir)
  const u = unit(
    'java',
    dir,
    `${kotlin ? 'Kotlin' : 'Java'} (Gradle${shape.kmp ? ', 멀티플랫폼' : ''})`,
  )
  const gw = `${names.has('gradlew') ? './gradlew' : 'gradle'} --no-daemon`
  // 멀티플랫폼 프로젝트에는 testClasses·test가 없고 jvm 대상의 jvmTestClasses·jvmTest가 있다(다른 프로젝트가 JVM이면 둘 다)
  const classes = [...(shape.jvm ? ['testClasses'] : []), ...(shape.kmp ? ['jvmTestClasses'] : [])]
  const tests = [...(shape.jvm ? ['test'] : []), ...(shape.kmp ? ['jvmTest'] : [])]
  const results = [
    ...(shape.jvm ? ['build/test-results/test'] : []),
    ...(shape.kmp ? ['build/test-results/jvmTest'] : []),
  ]
  if (classes.length === 0) {
    u.bare = true
    u.suggestions.push(
      'Kotlin 멀티플랫폼 프로젝트에 jvm 대상이 없어 컴파일·시험 명령을 고르지 않았습니다: jvm()을 더하면 jvmTest를 쓸 수 있습니다',
    )
    return u
  }
  u.fast.push({ id: 'compile', run: `${gw} -q ${classes.join(' ')}` })
  if (/ktlint/.test(build)) u.fast.push({ id: 'ktlint', run: `${gw} -q ktlintCheck` })
  if (/detekt/.test(build)) u.fast.push({ id: 'detekt', run: `${gw} -q detekt` })
  if (/\bcheckstyle\b/.test(build))
    u.fast.push({ id: 'checkstyle', run: `${gw} -q checkstyleMain` })
  // jacocoTestReport는 JVM 프로젝트의 test 작업에 붙는다(멀티플랫폼의 jvmTest에는 없다)
  const jacocoXml =
    !shape.kmp &&
    /\bjacoco\b/.test(build) &&
    /xml\.(?:required|isEnabled|enabled)\s*(?:\.set\(\s*true\s*\)|=\s*true|\s+true)/.test(build)
  const tasks = jacocoXml ? 'test jacocoTestReport' : tests.join(' ')
  const sub = results.length === 1 ? (results[0] ?? '') : results
  u.acceptance = {
    id: 'test',
    run: `${gw} ${tasks}; s=$?; ${mergeJUnit(sub)}; exit $s`,
    junit: JUNIT,
  }
  u.test = { id: 'test', run: `${gw} ${tests.join(' ')}` }
  if (jacocoXml)
    u.coverage = { report: 'build/reports/jacoco/test/jacocoTestReport.xml', format: 'jacoco' }
  else
    u.suggestions.push(
      shape.kmp
        ? 'Kotlin 멀티플랫폼은 jacoco 보고서가 jvmTest에 붙지 않습니다: kover의 XML 보고서를 쓰는 시험 명령을 두면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다'
        : 'jacoco 플러그인과 XML 보고서(xml.required)를 켜면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    )
  return u
}

const KMP_ID = 'org.jetbrains.kotlin.multiplatform'
const JVM_IDS = ['org.jetbrains.kotlin.jvm', 'java', 'java-library', 'application', 'groovy']

/** 판 목록(gradle/libs.versions.toml)의 [plugins]: 별칭(libs.plugins.<점 이름>) → 플러그인 id */
export function catalogPlugins(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of tomlEntries(text)) {
    if (e.path[0] !== 'plugins' || e.path.length < 2) continue
    const alias = (e.path[1] ?? '').replace(/[-_]/g, '.')
    const id =
      e.path[2] === 'id'
        ? /^["']([^"']+)/.exec(e.value)?.[1]
        : (/\bid\s*=\s*["']([^"']+)/.exec(e.value)?.[1] ?? /^["']([^"':]+)/.exec(e.value)?.[1])
    if (id !== undefined) out.set(alias, id)
  }
  return out
}

/** 빌드 글 하나가 적용하는 플러그인 id(apply false는 뺀다) */
export function appliedPlugins(build: string, catalog: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>()
  for (const line of build.replace(/\/\/.*$/gm, '').split(/\r?\n/)) {
    if (/\bapply\s*\(?\s*false\b/.test(line)) continue
    for (const m of line.matchAll(/\bkotlin\(\s*"([a-z-]+)"\s*\)/g))
      out.add(`org.jetbrains.kotlin.${m[1]}`)
    for (const m of line.matchAll(/\bid\s*\(?\s*["']([A-Za-z0-9._-]+)["']/g)) out.add(m[1] ?? '')
    for (const m of line.matchAll(/\balias\(\s*libs\.plugins\.([A-Za-z0-9_.]+)\s*\)/g)) {
      const id = catalog.get((m[1] ?? '').replace(/_/g, '.'))
      if (id !== undefined) out.add(id)
    }
    for (const m of line.matchAll(/apply\s+plugin:\s*["']([A-Za-z0-9._-]+)["']/g))
      out.add(m[1] === 'kotlin-multiplatform' ? KMP_ID : (m[1] ?? ''))
    // Kotlin DSL의 맨 이름(plugins { java; `java-library` })
    const bare = /^\s*`?(java|java-library|application|groovy)`?\s*$/.exec(line)
    if (bare?.[1] !== undefined) out.add(bare[1])
  }
  return out
}

/**
 * 단위 안의 Gradle 빌드 글(루트와 하위 프로젝트)을 보고 멀티플랫폼 프로젝트(jvm 대상이 있는 것)와 다른 JVM 프로젝트가 있나.
 * 멀티플랫폼이 없으면 전처럼 JVM 하나로 본다(testClasses·test)
 */
function gradleShape(scan: RepoScan, dir: string): { kmp: boolean; jvm: boolean } {
  const catalog = catalogPlugins(scan.texts.get(at(dir, 'gradle/libs.versions.toml')) ?? '')
  const pre = dir === '.' ? '' : `${dir}/`
  const builds = [...scan.texts]
    .filter(([p]) => p.startsWith(pre) && /(^|\/)build\.gradle(\.kts)?$/.test(p))
    .map(([, t]) => ({ text: t, plugins: appliedPlugins(t, catalog) }))
  const kmpBuilds = builds.filter((b) => b.plugins.has(KMP_ID))
  if (kmpBuilds.length === 0) return { kmp: false, jvm: true }
  const kmp = kmpBuilds.some((b) => /\bjvm\s*[({]/.test(b.text))
  const jvm = builds.some((b) => !b.plugins.has(KMP_ID) && JVM_IDS.some((id) => b.plugins.has(id)))
  return { kmp, jvm }
}

function mavenUnit(scan: RepoScan, dir: string, names: Set<string>): Unit {
  const pom = scan.texts.get(at(dir, 'pom.xml')) ?? ''
  const multi = /<modules>/.test(pom)
  const u = unit('java', dir, `Java (Maven${multi ? ', 여러 모듈' : ''})`)
  const mvn = `${names.has('mvnw') ? './mvnw' : 'mvn'} -B`
  // 여러 모듈이면 test-compile·test는 다른 모듈의 jar를 만들지 않아(JPMS 시험 모듈 등) verify까지 간다. install은 로컬
  // 저장소(~/.m2)에 써서 다른 check worktree와 프로젝트가 이 판의 SNAPSHOT을 읽게 되므로 쓰지 않는다(V70)
  const goal = multi ? 'verify' : 'test'
  u.fast.push({ id: 'compile', run: `${mvn} -q -DskipTests ${multi ? 'verify' : 'test-compile'}` })
  if (/maven-checkstyle-plugin/.test(pom))
    u.fast.push({ id: 'checkstyle', run: `${mvn} -q checkstyle:check` })
  if (/spotless-maven-plugin/.test(pom))
    u.fast.push({ id: 'format', run: `${mvn} -q spotless:check` })
  // 여러 모듈이면 보고서가 모듈마다라 하나로 읽을 수 없다
  const jacoco = /jacoco-maven-plugin/.test(pom) && !multi
  u.acceptance = {
    id: 'test',
    run: `${mvn} ${goal}${jacoco ? ' jacoco:report' : ''}; s=$?; ${mergeJUnit('target/surefire-reports')}; exit $s`,
    junit: JUNIT,
  }
  u.test = { id: 'test', run: `${mvn} ${goal}` }
  if (jacoco) u.coverage = { report: 'target/site/jacoco/jacoco.xml', format: 'jacoco' }
  else
    u.suggestions.push(
      'jacoco-maven-plugin을 pom.xml에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    )
  return u
}
