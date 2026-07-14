# 추적: run/T1 글로벌 룰 에러율 24%의 실체

대상: yaml-sns-agent 프로젝트, 최근 14일, run 카테고리 shape-eligible(T1/T2) 에피소드
방법: route-scan 파이프라인 재현 후 에러 에피소드의 실제 tool_result 스니펫 회수

## 결과: 22건 중 5건 에러 (23%) — 그러나 대부분 노이즈

| # | 시각 | 프롬프트 | 에러 실체 | 성격 |
|---|---|---|---|---|
| 1 | 07-02 | "봇에서 돌리는 클로드 모델은 opus 4.8로 고정되어 있나?" | Bash exit 2 (설정 조회 스크립트의 비제로 종료 — 조회 자체는 성공, "model pin 없음" 결과까지 출력됨) | 무해 |
| 2 | 07-12 | "shipthatcode 관련 레딧 반응" | `ERR_MODULE_NOT_FOUND: puppeteer` | 환경 문제 (진짜 에러) |
| 3 | 07-12 | "systemctl restart … 킵고잉" | **사용자가 도구 실행을 거부** ("The user doesn't want to proceed…") | 에러 아님 — 권한 거부 |
| 4 | 07-12 | "token-saver와 연계하면 좋을 부분…" | Bash exit 2 (README head 출력 — 출력은 정상적으로 나옴) | 무해 |
| 5 | 07-14 | "99부터 생성해보고…" (TTS 파이프라인) | Bash 10분 타임아웃 (영상 내레이션 생성 중) | 장시간 작업 — 위임 부적합 신호로는 유효 |

## 해석

- **진짜 "위임하면 위험" 신호는 5건 중 1~2건**(#2 환경, #5 타임아웃). 나머지는:
  - **#3 사용자 권한 거부가 toolError로 계상** — 모델 실패가 아닌데 rule-health 분자에 들어감. 이것만 제외해도 4/22 = 18% < 임계치 20% → 플래그 해제됨
  - #1·#4는 스크립트가 결과를 내고도 비제로 종료한 케이스 (grep 스타일 exit 2)
- 즉 현재 24% 플래그는 **과대 계상**. 표본 가드는 통과했지만 분자의 질이 낮다.

## 권장 수정

`src/session-records.js`의 toolErrors 계상에서 **사용자 거부 tool_result 제외**:
`is_error`이면서 내용이 "The user doesn't want to proceed" / "tool use was rejected"
패턴이면 카운트하지 않음. (거부는 사용자 의사지 작업 난이도 신호가 아님)

비제로 종료(무해 exit 2)와 타임아웃 구분은 내용 판별이 어려워 보류 —
타임아웃은 오히려 유효한 신호이므로 그대로 두는 게 맞음.

## 광역 감사 결과 (2026-07-14, 전 프로젝트 14일 — 사용자 요청 후속)

is_error tool_result 전수 142건의 원인 분포:

| 원인 | 건수 | 난이도 신호인가 |
|---|---|---|
| auto mode classifier 권한 거부 (production deploy·PII·시크릿 차단) | ~29 | ✗ 정책 산물 |
| input-validation (파일 미리드·old_string 불일치) | 31 | ✓ 모델 실수 — 유효 |
| not-found (모듈·명령·파일) | 16 | ✓ 환경/실수 — 유효 |
| 사용자 도구 거부 | 6 | ✗ 사용자 의사 |
| 타임아웃 | 2 | ✓ 장시간 작업 — 유효 |
| 기타 비제로 종료 등 | 나머지 | 혼재 |

→ **분자의 ~25%가 권한 계열 노이즈**였음.

## 적용된 수정 (v3.4.2)

`session-records.js` REJECTION_RE 확장: 사용자 거부 + auto mode classifier 거부 +
"Permission for this action was denied" + "requires approval"을 toolErrors에서 제외.

효과 (수정 전 → 후):
- 글로벌 run/T1 룰: err 24% ⚠ → **18% 플래그 해제** (×17 표본 유지)
- 전체 run/T1 에러율: 23% → 8%
- 잔여 고에러율 항목(read/T1 67% 등)은 표본 2~3건이라 HEALTH_MIN_SAMPLE 가드가 차단

부수 관찰: classifier 거부가 몰린 에피소드는 대부분 비가역 작업(deploy·제출) 시도였음 —
ESCALATE_RE 확장(v3.4.0)과 방향이 일치. 위임 룰의 "비가역은 메인 직접" 가드가 실측으로 정당화됨.
