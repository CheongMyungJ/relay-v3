// [단위] 구조 규칙의 import 읽기(V74, engine/imports.ts): 언어마다 뽑기(주석·글 안은 세지 않음, 여러 줄, 묶음, 동적 import는
// 못 봄)와 레포 안으로 풀기(상대 경로, ESM의 .js, index, tsconfig 별칭, 작업 공간 이름, Python 상대·절대·src 배치, Go module).
import { describe, expect, test } from 'vitest'
import {
  importContext,
  importFacts,
  looseJson,
  rawImports,
  stripComments,
} from '../../src/engine/imports.ts'

const specs = (path: string, text: string) => rawImports(path, text).map((r) => [r.line, r.spec])

function facts(files: Record<string, string>) {
  const texts = new Map(Object.entries(files))
  return importFacts(texts, importContext(Object.keys(files), texts))
}
const edges = (files: Record<string, string>) =>
  facts(files).edges.map((e) => `${e.from}:${e.line} → ${e.to}`)

describe('뽑기', () => {
  test('JS/TS: import·export from·import()·require, 여러 줄, type. 주석과 글 안은 세지 않는다', () => {
    const text = [
      "import a from './a'", // 1
      "import { b,\n  c } from '../b.js'", // 2-3
      "import type { T } from '@/types'", // 4
      "import './side.css'", // 5
      "export * from './re'", // 6
      "export { x as y } from './re2'", // 7
      "const m = await import('./lazy')", // 8
      "const r = require('./cjs')", // 9
      "// import z from './commented'", // 10
      "/* import w from './block' */", // 11
      'const s = "import q from \'./in-string\'"', // 12
      'const t = `import(${name})`', // 13
      'obj.import(x); important(1)', // 14
      'const d = import(name)', // 15
    ].join('\n')
    expect(rawImports('src/m.ts', text)).toEqual([
      { line: 1, spec: './a' },
      { line: 2, spec: '../b.js' },
      { line: 4, spec: '@/types' },
      { line: 5, spec: './side.css' },
      { line: 6, spec: './re' },
      { line: 7, spec: './re2' },
      { line: 8, spec: './lazy' },
      { line: 9, spec: './cjs' },
      { line: 15, spec: 'import(…)', dynamic: true },
    ])
  })

  test('Python: import a.b, as, 여러 이름, from 상대, 괄호로 여러 줄. 주석·글(docstring) 안은 세지 않는다', () => {
    const text = [
      'import os, app.db as d', // 1
      'from . import views, models', // 2
      'from ..core.util import (', // 3
      '    one,', // 4
      '    two as t,', // 5
      ')', // 6
      '"""', // 7
      'import hidden', // 8
      '"""', // 9
      '# import nope', // 10
      '    from app.x import y  # 함수 안', // 11
    ].join('\n')
    expect(rawImports('app/m.py', text)).toEqual([
      { line: 1, spec: 'os' },
      { line: 1, spec: 'app.db' },
      { line: 2, spec: '.', names: ['views', 'models'] },
      { line: 3, spec: '..core.util', names: ['one', 'two'] },
      { line: 11, spec: 'app.x', names: ['y'] },
    ])
  })

  test('Go: 한 줄, 묶음, 별칭·점·밑줄. 주석과 여러 줄 글 안은 세지 않는다', () => {
    const text = [
      'package x', // 1
      'import "fmt"', // 2
      'import (', // 3
      '\t"example.com/m/internal/db"', // 4
      '\tdb2 "example.com/m/pkg/db"', // 5
      '\t_ "example.com/m/side"', // 6
      '\t// "example.com/m/commented"', // 7
      ')', // 8
      'var s = `', // 9
      'import "example.com/m/in-string"', // 10
      '`', // 11
    ].join('\n')
    expect(specs('a.go', text)).toEqual([
      [2, 'fmt'],
      [4, 'example.com/m/internal/db'],
      [5, 'example.com/m/pkg/db'],
      [6, 'example.com/m/side'],
    ])
  })

  test('표에 없는 언어는 빈 목록', () => {
    expect(rawImports('A.java', 'import com.x.Y;')).toEqual([])
  })

  test('주석 지우기는 자리와 줄바꿈을 둔다. Python은 글도 지운다', () => {
    const js = "a // b\n/* c\nd */ 'e // f'"
    expect(stripComments(js, 'js')).toBe("a     \n    \n     'e // f'")
    expect(stripComments('x = "y" # z', 'py')).toBe('x = " "    ')
    expect(looseJson('{\n // c\n "a": [1, 2,],\n}')).toEqual({ a: [1, 2] })
    expect(looseJson('{')).toBeNull()
  })
})

describe('풀기', () => {
  test('JS: 상대 경로, 확장자 찾기, ESM의 .js → .ts, 폴더의 index, 바깥 패키지는 버림', () => {
    expect(
      edges({
        'src/a.ts': [
          "import { b } from './b.js'",
          "import c from './c'",
          "import d from './d'",
          "import x from 'lodash'",
          "import n from 'node:fs'",
        ].join('\n'),
        'src/b.ts': '',
        'src/c.tsx': '',
        'src/d/index.ts': '',
      }),
    ).toEqual(['src/a.ts:1 → src/b.ts', 'src/a.ts:2 → src/c.tsx', 'src/a.ts:3 → src/d/index.ts'])
  })

  test('JS: tsconfig의 paths·baseUrl(가까운 tsconfig, 주석 허락), 작업 공간 패키지 이름', () => {
    const f = facts({
      'tsconfig.json':
        '{ // 뿌리\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
      'src/ui/v.ts': [
        "import { q } from '@/db/q'",
        "import u from 'src/util'",
        "import p from '@acme/core/sub'",
        "import r from '@acme/core'",
        "import m from '@/missing'",
      ].join('\n'),
      'src/db/q.ts': '',
      'src/util.ts': '',
      'packages/core/package.json': '{ "name": "@acme/core" }',
      'packages/core/sub.ts': '',
    })
    expect(f.edges.map((e) => `${e.line} → ${e.to}`)).toEqual([
      '1 → src/db/q.ts',
      '2 → src/util.ts',
      '3 → packages/core/sub.ts',
      '4 → packages/core',
    ])
    expect(f.unseen).toEqual([{ from: 'src/ui/v.ts', line: 5, spec: '@/missing' }])
  })

  test('JS: tsconfig의 extends(상대 경로)를 따라가 paths를 물려받고 baseUrl은 자식 것이 이긴다(castore 시범)', () => {
    const f = facts({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["*"] } } }',
      'demo/tsconfig.json':
        '{ "extends": "../tsconfig.json", "compilerOptions": { "baseUrl": "src" } }',
      'demo/tsconfig.build.json': '{ "extends": "./tsconfig" }',
      'demo/src/a.ts': "import p from '~/pokemons'",
      'demo/src/pokemons/index.ts': '',
      'lib/x.ts': "import y from '~/lib/y'",
      'lib/y.ts': '',
      'pkg/tsconfig.json':
        '{ "extends": "@tsconfig/node20/tsconfig.json", "compilerOptions": { "paths": { "#/*": ["./src/*"] } } }',
      'pkg/src/m.ts': "import n from '#/n'",
      'pkg/src/n.ts': '',
    })
    expect(f.edges.map((e) => `${e.from} → ${e.to}`)).toEqual([
      'demo/src/a.ts → demo/src/pokemons/index.ts',
      'lib/x.ts → lib/y.ts',
      // baseUrl이 없으면 paths의 대상은 paths를 적은 tsconfig의 폴더 기준
      'pkg/src/m.ts → pkg/src/n.ts',
    ])
    expect(f.unseen).toEqual([])
  })

  test('JS: 풀지 못한 상대 경로와 동적 import는 못 봄. 자기 자신과 같은 대상은 한 번', () => {
    const f = facts({
      'a.js': "import './gone'\nimport('./a.js')\nrequire('./b')\nrequire('./b')\nimport(x)",
      'b.js': '',
    })
    expect(f.edges.map((e) => e.to)).toEqual(['b.js'])
    expect(f.unseen.map((u) => u.spec)).toEqual(['./gone', 'import(…)'])
    expect(f.files).toBe(2)
  })

  test('Python: 절대(모듈·패키지·from의 하위 모듈), 상대(. ..), src 배치, 이름 공간 패키지, 바깥은 버림', () => {
    expect(
      edges({
        'pyproject.toml': '',
        'src/app/__init__.py': '',
        'src/app/core/util.py': '',
        'src/app/db/__init__.py': '',
        'src/app/db/models.py': '',
        'src/app/ui/views.py': [
          'import os',
          'import app.db',
          'from app.db import models',
          'from app.core.util import f',
          'from ..db import models as m',
          'from . import other',
          'from .other import g',
          'from app import core',
        ].join('\n'),
        'src/app/ui/other.py': '',
      }),
    ).toEqual([
      'src/app/ui/views.py:2 → src/app/db/__init__.py',
      'src/app/ui/views.py:3 → src/app/db/models.py',
      'src/app/ui/views.py:4 → src/app/core/util.py',
      'src/app/ui/views.py:6 → src/app/ui/other.py',
      // app.core는 __init__.py가 없는 이름 공간 패키지라 폴더
      'src/app/ui/views.py:8 → src/app/core',
    ])
  })

  test('Python: 레포 안 이름인데 없는 모듈은 못 봄. 뿌리 밖으로 나가는 상대 import도 못 봄', () => {
    const f = facts({ 'app/a.py': 'from app.gone import x\nfrom ... import y', 'app/b.py': '' })
    expect(f.edges).toEqual([])
    expect(f.unseen.map((u) => u.spec)).toEqual(['app.gone', '...'])
  })

  test('Go: go.mod의 module 앞부분을 떼고 폴더로(하위 모듈은 긴 것부터). 표준·바깥은 버림, 없는 패키지는 못 봄', () => {
    const f = facts({
      'go.mod': 'module example.com/m\n\ngo 1.22\n',
      'tools/go.mod': 'module example.com/m/tools\n',
      'cmd/app/main.go': [
        'package main',
        'import (',
        '\t"fmt"',
        '\t"github.com/x/y"',
        '\t"example.com/m/internal/db"',
        '\t"example.com/m/tools/gen"',
        '\t"example.com/m/gone"',
        ')',
      ].join('\n'),
      'internal/db/db.go': 'package db',
      'tools/gen/gen.go': 'package gen',
    })
    expect(f.edges.map((e) => `${e.from}:${e.line} → ${e.to}${e.folder ? '/' : ''}`)).toEqual([
      'cmd/app/main.go:5 → internal/db/',
      'cmd/app/main.go:6 → tools/gen/',
    ])
    expect(f.unseen.map((u) => u.spec)).toEqual(['example.com/m/gone'])
  })

  test('늘 빼는 곳(node_modules, vendor, dist)의 소스는 읽지 않는다', () => {
    expect(
      facts({ 'node_modules/x/i.js': "import './j'", 'vendor/a.go': 'import "x"', 'a.js': '' })
        .files,
    ).toBe(1)
  })
})
