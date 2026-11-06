# M4 관문 5회 반복 ((A)·(B))

규약 8.4의 3·4. 규약 SHA `d287c4a`. 도구 출력 그대로.

## (A) 평가 대상 T1~T10

```
관문 5회 (A) 결정론 입력: 대상마다 갈린 칸(반복마다의 값)
- 07-two-bugs/relay3-m21-2/1982d73f: 5회 → 같음
- 07-two-bugs/relay3-m21-2/e5affdc4: 5회 → 같음
- 07-two-bugs/relay3-m21-3/ec993a2d: 5회 → 같음
- 07-two-bugs/relay3-m21-4/c16c735c: 5회 → 같음
- 07-two-bugs/relay3-m21-5/452fa99c: 5회 → 같음
- 07-two-bugs/relay3-m21-5/99de9298: 5회 → 같음
- 07-two-bugs/relay3-m21-3/99dda7cd: 5회 → 같음
- 07-two-bugs/relay3-m21-4/b54c9c51: 5회 → 같음
- 09-stock-negative/relay3-m21-3/fa6ac6aa: 5회 → 같음
- 09-stock-negative/relay3-m21-4/7e65ced6: 5회 → 같음
결정론 입력만으로 결론(또는 채운 조건)이 갈린 head: 0/10
met을 가를 수 있는 입력 칸(commands, ratchets, lines, examples_file, signals, test_weakening, diff)이 갈린 head: 0/10
덜 함(끝난 반복이 5 아래): -
```

## (A) relay-v3 head R1~R3

```
관문 5회 (A) 결정론 입력: 대상마다 갈린 칸(반복마다의 값)
- R1 be2ed90: 5회 → 같음
- R2 dc72189: 5회 → 같음
- R3 14f3303: 5회 → 같음
결정론 입력만으로 결론(또는 채운 조건)이 갈린 head: 0/3
met을 가를 수 있는 입력 칸(commands, ratchets, lines, examples_file, signals, test_weakening, diff)이 갈린 head: 0/3
덜 함(끝난 반복이 5 아래): -
```

## (B) 리뷰 5회 (T1~T10, --check로 (A)와 이음)

```
관문 5회 (B) 리뷰: 같은 head의 리뷰 반복마다 올린 갈래(● 올림 있음, ○ 없음)
- 07-two-bugs/relay3-m21-2/1982d73f: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-2/e5affdc4: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-3/ec993a2d: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-4/c16c735c: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-5/452fa99c: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-5/99de9298: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-3/99dda7cd: ○○○○○ - | - | - | - | -
- 07-two-bugs/relay3-m21-4/b54c9c51: ○○○○○ - | - | - | - | -
- 09-stock-negative/relay3-m21-3/fa6ac6aa: ○○○○○ - | - | - | - | -
- 09-stock-negative/relay3-m21-4/7e65ced6: ○○○○○ - | - | - | - | -
반복이 둘 이상인 head 10개 가운데 올림 유무가 갈림 0, 올림 갈래(심각도는 보지 않음)가 갈림 0
유무는 같고 갈래만 갈림 0
결론을 가르는 갈림(유무가 갈렸고 (A)의 끝난 반복 5 이상이 모두 small을 채운 head): 0
이 숫자는 8.4 일곱째 조건(결정론 입력)이 아니라 devices.md 독립 리뷰 줄의 지표다(8절)
리뷰 한 번(끝난 반복 50, 토큰을 적은 반복 50): 평균 5초, 토큰 평균 입력 2, 캐시 읽기 5946, 캐시 쓰기 6390, 출력 396
```

## 참고: M2.1 리뷰 재생 자료(review --from)

```
관문 5회 (B) 리뷰: 같은 head의 리뷰 반복마다 올린 갈래(● 올림 있음, ○ 없음)
- 14-double-notify/relay3-1/dc01c449: ●●● example_test_mismatch+request_gap | example_test_mismatch | example_test_mismatch [갈래 갈림]
- 14-double-notify/relay3-noreview-1/26e99966: ●●● example_test_mismatch | example_test_mismatch+request_gap | example_test_mismatch+request_gap+structure [갈래 갈림]
- 14-double-notify/relay3-noreview-2/f2b704d7: ●●● example_test_mismatch+structure | example_test_mismatch | example_test_mismatch [갈래 갈림]
- 14-double-notify/relay3-2/a20b4044: ●●● example_test_mismatch+request_gap+structure | example_test_mismatch | example_test_mismatch [갈래 갈림]
- 14-double-notify/relay3-noreview-4/11e9410b: ●●● example_test_mismatch | example_test_mismatch | example_test_mismatch
- 14-double-notify/relay3-4/c4f1e71a: ●●● example_test_mismatch+structure | example_test_mismatch+structure | example_test_mismatch [갈래 갈림]
- 14-double-notify/relay3-5/5129f362: ●●● example_test_mismatch+structure | example_test_mismatch | example_test_mismatch [갈래 갈림]
- 14-double-notify/relay3-noreview-5/a840189c: ●●● example_test_mismatch | example_test_mismatch+structure | example_test_mismatch [갈래 갈림]
- 07-two-bugs/relay3-1/8eef55ea: ● example_test_mismatch+out_of_contract+structure
- 07-two-bugs/relay3-noreview-1/6a85fd9a: ● example_test_mismatch+structure
- 07-two-bugs/relay3-2/0c4b7f99: ● example_test_mismatch
- 07-two-bugs/relay3-noreview-2/bf931a61: ● example_test_mismatch
- 07-two-bugs/relay3-3/3f3e2aa9: ● example_test_mismatch
- 08-timezone/relay3-1/00165a0f: ● example_test_mismatch
- 08-timezone/relay3-noreview-1/28f5bb8d: ● example_test_mismatch
- 08-timezone/relay3-2/999bd795: ● example_test_mismatch
- 08-timezone/relay3-noreview-2/534fac8e: ● example_test_mismatch
- 08-timezone/relay3-3/655a031f: ● example_test_mismatch
- 10-invoice-rounding/relay3-1/dc016fc2: ● example_test_mismatch
- 10-invoice-rounding/relay3-noreview-1/60ef8ca5: ● example_test_mismatch+request_gap
- 10-invoice-rounding/relay3-2/97f3e418: ● example_test_mismatch+structure
- 10-invoice-rounding/relay3-noreview-2/13473b90: ● example_test_mismatch
- 10-invoice-rounding/relay3-3/6b2fe9e6: ● example_test_mismatch
- 19-split-report/relay3-1/b7cb049c: ● example_test_mismatch
- 19-split-report/relay3-noreview-1/ec39c819: ● example_test_mismatch
- 19-split-report/relay3-2/5bbfeef8: ● example_test_mismatch
- 19-split-report/relay3-noreview-2/a561987e: ● example_test_mismatch
- 19-split-report/relay3-3/f96e95e2: ● example_test_mismatch
- 40-three-libraries/relay3-1/0729062f: ● example_test_mismatch+structure
- 40-three-libraries/relay3-noreview-1/434678e3: ● example_test_mismatch
- 40-three-libraries/relay3-2/045b5ff0: ● example_test_mismatch+structure
- 40-three-libraries/relay3-noreview-2/1e8bb67a: ● example_test_mismatch
- 40-three-libraries/relay3-3/80fb17f6: ● example_test_mismatch+structure
- 43-split-engines/relay3-noreview-1/7eac7d60: ● example_test_mismatch+out_of_contract+security+structure
- 43-split-engines/relay3-1/6228c886: ● example_test_mismatch+structure
- 43-split-engines/relay3-2/5af7586e: ● example_test_mismatch+out_of_contract+structure
- 43-split-engines/relay3-noreview-2/c63a24a3: ● example_test_mismatch+security
- 43-split-engines/relay3-3/868bf470: ● example_test_mismatch+out_of_contract+structure
반복이 둘 이상인 head 8개 가운데 올림 유무가 갈림 0, 올림 갈래(심각도는 보지 않음)가 갈림 7
유무는 같고 갈래만 갈림 7
결론을 가르는 갈림: (A) 자료(--check)를 주지 않아 재지 않음
이 숫자는 8.4 일곱째 조건(결정론 입력)이 아니라 devices.md 독립 리뷰 줄의 지표다(8절)
리뷰 한 번(끝난 반복 54, 토큰을 적은 반복 54): 평균 12초, 토큰 평균 입력 3, 캐시 읽기 9988, 캐시 쓰기 9829, 출력 1061
```
