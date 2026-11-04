#!/usr/bin/env node
// relay 진입점. bin `relay`, `npm run relay -- <명령>`, `node src/cli/main.ts <명령>`.

import { killActive } from '../adapters/exec.ts'
import { main } from './app.ts'

// 레포 명령은 자기 프로세스 묶음(setsid)에서 돌아 터미널의 Ctrl+C도, 터미널을 닫을 때의 SIGHUP도
// 받지 않는다. 신호로 끝나면 'exit' 이벤트가 오지 않으므로(exec.ts의 exit 훅으로는 못 잡음) 여기서 함께 끝낸다
const SIGNALS: [NodeJS.Signals, number][] = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]
if (process.platform === 'win32') SIGNALS.push(['SIGBREAK', 149])
for (const [signal, code] of SIGNALS) {
  process.on(signal, () => {
    killActive()
    process.exit(code)
  })
}

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  now: () => new Date(),
})
