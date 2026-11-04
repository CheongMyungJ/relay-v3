# M2 사람 차례(P3) 쪼개기: relay3이 relay@auto보다 차례가 많은 까닭

- 자료: 배치 1·2의 여섯 시나리오(07, 08, 10, 14, 19, 40), relay3·relay3-noreview·relay@auto 각 30회의 `turns.jsonl`과 relay-v3 `events.jsonl`.
- 방법: 워크플로(시나리오마다 분류 에이전트 하나 → 합치기 → 상위 다섯 주장을 원자료로 다시 세어 반박 시도). 분류는 AI가 했고 일부 수만 다시 셌다(아래 "주의"). 규약 밖의 탐색이며 Q1~Q4 판정에 쓰지 않는다. 평가 뒤 고칠 차례를 정하는 데 쓴다.
- 원문은 영어(분류 에이전트 출력)라 표와 까닭 이름은 그대로 둔다.

## Mean turns per run by category

Each figure is the mean of the 6 scenario means. Every arm had n = 5 per scenario, so each figure is also the mean over 30 runs.

| category | relay3 | relay3-noreview | relay@auto | **relay3 − relay@auto** | share of gap | relay3 − noreview |
|---|---:|---:|---:|---:|---:|---:|
| start | 2.73 | 2.57 | 2.07 | **+0.67** | 8% | +0.17 |
| answer_question | 4.40 | 3.40 | 4.97 | **−0.57** | −6% | +1.00 |
| contract_revise | 0.53 | 0.60 | 0.07 | **+0.47** | 5% | −0.07 |
| contract_approve | 1.50 | 1.50 | 1.00 | **+0.50** | 6% | 0.00 |
| change_request_answer | 1.03 | 0.37 | 0.00 | **+1.03** | 12% | +0.67 |
| wait | 2.70 | 0.60 | 0.97 | **+1.73** | 20% | +2.10 |
| inspect | 1.37 | 1.07 | 1.00 | **+0.37** | 4% | +0.30 |
| evidence_confusion | 1.20 | 0.80 | 0.00 | **+1.20** | 14% | +0.40 |
| review_relay | 0.47 | 0.00 | 0.00 | **+0.47** | 5% | +0.47 |
| steer | 0.03 | 0.07 | 0.03 | **0.00** | 0% | −0.03 |
| end | 4.63 | 3.90 | 1.63 | **+3.00** | 34% | +0.73 |
| other | 0 | 0 | 0 | 0 | 0% | 0 |
| **total** | **20.60** | **14.87** | **11.73** | **+8.87** | 100% | **+5.73** |

### Totals per scenario

| scenario | relay3 | relay3-noreview | relay@auto | relay3 − relay@auto |
|---|---:|---:|---:|---:|
| 07-two-bugs | 20.8 | 18.2 | 11.8 | +9.0 |
| 08-timezone | 13.4 | 10.8 | 10.2 | +3.2 |
| 10-invoice-rounding | 17.0 | 12.2 | 9.6 | +7.4 |
| 14-double-notify | 14.0 | 10.8 | 11.6 | +2.4 |
| 19-split-report | 17.6 | 9.4 | 11.8 | +5.8 |
| 40-three-libraries | 40.8 | 27.8 | 15.4 | +25.4 |
| mean | 20.60 | 14.87 | 11.73 | +8.87 |
| mean without 40 | 16.56 | 12.28 | 11.00 | +5.56 |

### What makes up each category gap

Counts are turns over the 30 relay3 runs.

- **end +3.00 (90 turns).** It splits four ways:
  - 33 turns: 끝내기, 끝 확정 and switch turns of Works 2–3 created by the per-unit split (07, 40).
  - 30 turns: the first Work's 끝 확정. turns.jsonl has exactly one 끝 확정 click per relay3 Work, 45 in total.
  - 16 turns: 끝내기 pressed again after review findings (14) or after the confirm dialog was lost (2).
  - 11 turns: a separate 'done'-only turn. relay3 has 30 such turns and relay@auto 19. This is a habit of the simulated human, not the app.
- **wait +1.73 (52 turns).**
  - 37 turns are pure waits for the independent review after 끝내기.
  - About 18 are waits inside review-fix loops.
  - relay3 has fewer itemized idle waits for "session still working" than relay@auto (10 vs 17), which offsets part of this.
- **evidence_confusion +1.20 and change_request_answer +1.03.** Only relay3 has these mechanisms:
  - the example file differs from the approved contract
  - the base-run rule on change and keep examples
  - the contract:false change-request bug
  - review-driven contract changes
  - ratchet and keep-line base evidence
- **start +0.67 and contract_approve +0.50.** All of it comes from the per-unit split in 07 and 40. The extra approvals are 15/30 = 0.50 exactly.
- **contract_revise +0.47.** In 07 the session made even-count median a non-goal; in 14 the contract left out push. Each revise takes 2 turns because of the revise form.
- **review_relay +0.47.** This counts only the typed relay turns. The full review cost is 89 turns (2.97/run): 37 wait-after-End plus 52 loop turns, spread over wait, end, change_request_answer and review_relay.
- **inspect +0.37.** Per-file diff expands in 07, and Work-switch inspections.
- **answer_question −0.57.** relay3 asks fewer questions per Work, for example 14: 1.4 vs 5.0 and 19: 2.0 vs 5.0. The exception is 40 (+6.2/run), where each split Work ran its own question round.

### relay3 vs relay3-noreview (+5.73/run)

Itemized review-caused turns come to 2.97/run. The rest is mostly variance between runs: relay3-noreview-3 in 40 used one Work and took 14 turns, and relay3 asked more questions in 10 and 40.

## 까닭과 고칠 안 (relay3 30회 평균 차례, 줄일 것으로 보는 차례)

| 까닭 | 차례/회 | 줄임/회 | 확신 | 다시 센 결과 |
|---|---|---|---|---|
| One Work per unit (one Work = one branch). When the human wants separate branches per bug or module, every extra unit repeats start, contract approval, 끝내기, 끝 확정 and a Work switch. relay@auto handled all units in one Work. | 2.47 | 1.5 | high | 맞음 (2.47) |
| Review findings are not sent to the session. The human types the fixes, presses 끝내기 again and waits for the re-review. Review-driven contract changes also need a separate accept. | 1.73 | 0.75 | medium | 맞음 (1.8) |
| Example file mismatch. The session hand-writes .relay/examples/<id>.json with paraphrased text, a different shape or values JSON cannot hold. Evidence says only '예시 자료가 승인된 예시와 다름' with example ids, and the session stops without understanding or fixing it, so the human has to diagnose and relay it. | 1.53 | 1.2 | high | - |
| The independent review starts only at 끝내기, so the human spends a pure-wait turn before 끝 확정 in almost every Work. | 1.23 | 0.9 | high | - |
| Ending takes two steps (끝내기, then a separate 끝 확정), while relay@auto ends with one 'Work 완료'. | 1 | 0.5 | medium | - |
| Contract examples are checked against base only after approval. A change-line example passes on base, a keep-line example fails on base, or a refactor's expected output is wrong, so the session raises a change_requested that the human must accept. | 0.6 | 0.4 | medium | - |
| The first contract settles scope without asking (even-count median written as a non-goal in 07; push left out in 14). Revising takes two turns: click '고쳐 달라고 하기', then fill and send. | 0.57 | 0.27 | medium | - |
| Bug: change_requested carried contract=false, so 받아들이기 approved it but left contract.json unchanged. Evidence stayed not_met and the session had to ask again. | 0.37 | 0.33 | high | - |
| The csv-only Work still asked about money and workdays, and the later split Works asked the same questions again. | 0.17 | 0.15 | medium | - |
| The diff view needs a click on the '변경' tab and then a separate expand for each file. | 0.17 | 0.15 | low | - |
| Ratchet false positive: tagging or renaming an existing test with [work:Cx.y] is reported as a test that disappeared. Keep lines also get no base evidence ('Cx.1(missing)') when the tests import new functions. The two rules push the session in opposite directions. | 0.13 | 0.1 | medium | - |
| The pending end confirmation is lost after switching to another Work, so 끝내기 and the review have to run again. | 0.07 | 0.07 | low | - |

- **One Work per unit (one Work = one branch). When the human wants separate branches per bug or module, every extra unit repeats start, contract approval, 끝내기, 끝 확정 and a Work switch. relay@auto handled all units in one Work.** — 고칠 안: Let one Work carry several units. Each unit gets its own branch and commits under one contract with per-unit line groups, and the Work has one approval, one review and one End. That is what relay@auto did: 2 bugs in one Work, and 3 module branches in one Work in 40 auto-2. A smaller version: a 'split into Works' action creates sibling Works from the one request, carries the clarifying answers over, and allows batch approve and batch End.
- **Review findings are not sent to the session. The human types the fixes, presses 끝내기 again and waits for the re-review. Review-driven contract changes also need a separate accept.** — 고칠 안: Send the findings to the session automatically, or with one '세션에 넘기기' button on the review result. After the session's next commit, re-run evidence and the review on their own, so the human neither presses 끝내기 again nor polls for the re-review. Show findings above 낮음 as blocking and the 낮음 ones as notes.
- **Example file mismatch. The session hand-writes .relay/examples/<id>.json with paraphrased text, a different shape or values JSON cannot hold. Evidence says only '예시 자료가 승인된 예시와 다름' with example ids, and the session stops without understanding or fixing it, so the human has to diagnose and relay it.** — 고칠 안: Generate .relay/examples/<id>.json from the approved contract.json, or have relay_check compare the tagged tests to contract.json directly, so the session never copies examples by hand. Store example values in a form JSON can hold (NaN in 19). If a session-written file remains, relay_check should return a field-level diff to the session (example id, field, expected vs found), and the Stop hook should keep the session working while this not_met is the decisive line.
- **The independent review starts only at 끝내기, so the human spends a pure-wait turn before 끝 확정 in almost every Work.** — 고칠 안: Start the review on its own once evidence first turns met on a commit, or when the session stops with clean evidence, and re-run it in the background if the head moves. The result is then ready when the human presses 끝내기, and the confirm step can show it at once.
- **Ending takes two steps (끝내기, then a separate 끝 확정), while relay@auto ends with one 'Work 완료'.** — 고칠 안: When all lines are met and the review has nothing above 낮음 (or review is off), let 끝내기 end the Work in one click. Keep the separate 끝 확정 only when something is still open: not_met, missing evidence, or higher findings.
- **Contract examples are checked against base only after approval. A change-line example passes on base, a keep-line example fails on base, or a refactor's expected output is wrong, so the session raises a change_requested that the human must accept.** — 고칠 안: Run the base-run rule at contract submit. The session submits the tagged example tests (or an example runner) with the contract, relay runs them on base, and the submit is refused like contract_invalid when a change example passes on base or a keep example fails there. The session then fixes the examples before the human sees the contract. This also catches wrong expected outputs in refactors, where keep examples must equal base output (19 padEnd).
- **The first contract settles scope without asking (even-count median written as a non-goal in 07; push left out in 14). Revising takes two turns: click '고쳐 달라고 하기', then fill and send.** — 고칠 안: (a) Put a text box and '보내기' directly on the contract view so a revise takes one turn. (b) In the contract-draft instructions, require the session to ask before writing behaviour inside the request's domain as a non-goal, and to give each target the request names (mail and push) its own end-to-end line and example.
- **Bug: change_requested carried contract=false, so 받아들이기 approved it but left contract.json unchanged. Evidence stayed not_met and the session had to ask again.** — 고칠 안: Make the change-request tool require the full new contract whenever lines or examples change, and refuse a request without one at call time with an error to the session. Never show an approved change that did not alter contract.json.
- **The csv-only Work still asked about money and workdays, and the later split Works asked the same questions again.** — 고칠 안: Pass the scope the human chose in the first question into the Work's question round. Seed each new sibling Work with the answers already given in the earlier ones.
- **The diff view needs a click on the '변경' tab and then a separate expand for each file.** — 고칠 안: Open the '변경' tab with file diffs already expanded when the change is small, for example 5 files or fewer.
- **Ratchet false positive: tagging or renaming an existing test with [work:Cx.y] is reported as a test that disappeared. Keep lines also get no base evidence ('Cx.1(missing)') when the tests import new functions. The two rules push the session in opposite directions.** — 고칠 안: Have the ratchet compare test names with the [work:...] tags stripped, so tagging an existing test does not count as removing it. For keep lines, run the head's tagged keep tests against base sources when they import only base exports, or tell the session at contract time to put keep tests in files that import only existing APIs.
- **The pending end confirmation is lost after switching to another Work, so 끝내기 and the review have to run again.** — 고칠 안: Keep a Work's pending end (ended and reviewed, waiting for 끝 확정) in its saved state, so switching away and back shows the confirm again.

## 주의

- The causes are not additive. Itemized relay3 cause turns add up to about 10.0 per run (301 turns), more than the 8.87 gap, because relay@auto has costs relay3 lacks: more answer_question turns (−0.57) and more idle waits (17 itemized against 10). The expected savings (about 6.3 in total) overlap. Starting the review before End cuts both the review wait and the open-item confirms. A multi-unit Work removes confirms that the two-step-end fix would also remove. Each saving is an assumed fraction of counted turns, not a measurement; a re-run is needed to confirm any of them.
- 40-three-libraries dominates. Without it the relay3 − relay@auto gap is 5.56 per run instead of 8.87, and about 70% of the split cause (51 of 74 turns) comes from 40. The split also depends on a preference for separate branches: in 40 the request and session asked for it, in 07 it was the persona's choice. A human who accepts one branch would not pay this cost.
- Habits of the simulated human inflate some categories. It ends with a separate 'done'-only turn (relay3 30 such turns, relay@auto 19, i.e. 0.37 per run of the end gap is not caused by the app). It polls with 60-240s wait turns, so a wait turn measures polling, not human effort. It needs a separate turn to see a form before filling it (the two-step revise and the AskUserQuestion submit). It sometimes chooses the UI diff tab over inspect_diff. Its friction notes come from the same model that plays the human.
- The categories overlap and each turn got only one. The review loop's turns are spread over wait, end, change_request_answer and review_relay, so review_relay (0.47) understates the review cost (2.97 itemized turns per run). Example-mismatch turns fall under evidence_confusion, inspect, wait and change_request_answer. Some single messages covered two causes (08 relay3-3 t7, 40 noreview-1 #26) and were counted once.
- Changes to the input attribution: (a) 4 turns of 19 relay3-2 (t8-t11) were moved from example mismatch to the contract:false bug, after checking that change_requested 13:55:53 had contract=false. (b) The first-Work 끝 확정 turns of 08 and 40, which the per-scenario lists did not itemize, were added to the two-step-end cause from turns.jsonl click counts, which show exactly one 끝 확정 per relay3 Work (45 total). (c) Example authored wrong (19) was merged into the base-check cause. (d) Contract changes caused by review findings were merged into the review loop.
- Some mechanisms are shared by all arms and are left out of the ranking: AskUserQuestion submit and multi-select navigation turns (relay3 about 15 turns, 0.5/run; relay@auto 37 itemized, about 1.23/run) and idle waits while the session works. relay3 actually asks fewer questions per Work than relay@auto, except where Works are split.
- relay3 − noreview is +5.73 per run, but only 2.97 per run is itemized as review-caused. The rest is run-to-run variance at n=5: noreview-3 in 40 used a single Work and finished in 14 turns, and relay3 asked more questions in 10 and 40. Per-run totals vary widely (19 relay3 ranged from 12 to 26 turns).
- Turn counts ignore what a turn costs. Typed diagnostic messages at friction 2-3 (example mismatch, contract:false) cost far more than a click. Some evidence problems cost no turns but damage trust or quality: keep-line missing evidence was left unresolved at the end in most 40 Works, and ratchet false alarms were ended over.
- The categories and friction causes came from AI classifiers working per scenario. I re-checked only some of the numbers (contract=false events, 끝 확정 and 끝내기 counts, done-only turns, and how many Works hit example mismatch, the base rule, the ratchet and keep-line missing evidence). The rest of the turn ids are taken from the per-scenario inputs as given.
- These runs come before any fix for the contract-change (contract:false) bug. The parent session's task list shows such a fix pending merge after the eval, so that cause may already be addressed.
