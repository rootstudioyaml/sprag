/**
 * Harness templates — single-file CLAUDE.md (5 sections) + ratchet.md.
 *
 * Section markers (HARNESS_SECTIONS) are the source of truth for completeness
 * detection: harness/check counts how many of these headers appear in the
 * project's CLAUDE.md, and the statusline 🅷 N/5 indicator reports the same.
 */

export const HARNESS_BLOCK_BEGIN = '<!-- claude-token-saver:harness:begin -->';
export const HARNESS_BLOCK_END = '<!-- claude-token-saver:harness:end -->';

export const HARNESS_SECTIONS = [
  { id: 'ratchet', heading: '### 1. Ratchet — 같은 실수는 두 번 안 한다' },
  { id: 'evidence', heading: '### 2. Evidence — "다 됐어요" 금지' },
  { id: 'pev', heading: '### 3. PEV — Plan → Execute → Verify' },
  { id: 'structured', heading: '### 4. Structured Task — 입력 구조화' },
  { id: 'safe-path', heading: '### 5. Default Safe Path — 파괴적 명령 항상 확인' },
];

export function harnessClaudeMdBlock() {
  const sections = HARNESS_SECTIONS.map((s) => s.heading).join('\n\n... (see full block below)');
  return `${HARNESS_BLOCK_BEGIN}
## 🅷 Harness Rules (claude-token-saver)

이 섹션은 \`claude-token-saver harness init\`이 생성합니다. 5가지 원칙 모두를
지키면 statusline에 \`🅷 5/5\`로 표시되고, 빠진 게 있으면 \`🅷 3/5\` 식으로
경고합니다. 수정해도 무방하지만, 섹션 헤더(### 1. ~ ### 5.)는 검출용이므로
지우지 마세요.

${HARNESS_SECTIONS[0].heading}
- 같은 에러·오해·반복 작업이 한 번 더 발생하면 즉시 \`.claude/ratchet.md\`에
  "조건 → 행동" 한 줄로 룰 추가.
- claude-token-saver가 후보를 감지하면 statusline에 \`🅷⚠ ratchet?\`로 알림.
  \`claude-token-saver harness promote "<rule>"\`로 승인.
- 승인된 룰은 다음 세션부터 자동 적용.

${HARNESS_SECTIONS[1].heading}
완료 보고("다 됐어요", "테스트 통과") 시 다음 중 1개 이상을 항상 첨부:
- 테스트 실행 결과 (실제 stdout)
- 변경 파일 diff (file:line)
- UI 작업이면 스크린샷
- 명령 실행 출력

증거 없는 완료 보고는 거짓일 확률이 매우 높음. 토큰 낭비의 주범.

${HARNESS_SECTIONS[2].heading}
3단계 이상 작업은 다음 사이클을 강제:
1. **Plan** — 텍스트로 단계 명시 (TodoWrite 권장)
2. **Execute** — 한 단계씩 실행, 결과 확인
3. **Verify** — 테스트·실행·grep 등으로 결과 검증

Verify를 건너뛰면 statusline에 \`🅷⚠ PEV-skip\` 표시.
0.85의 10제곱 ≈ 0.20 — 단계당 85%만 맞아도 10단계면 80% 실패.

${HARNESS_SECTIONS[3].heading}
새 작업 시작 시 다음 4줄을 먼저 채울 것 (입력이 구조화돼야 출력도 구조화됨):
- **목표:** 한 문장으로
- **제약:** 시간·범위·금지사항
- **검증 방법:** 어떻게 "됐다"고 판정할지
- **완료 기준:** 무엇이 통과하면 완료인지

${HARNESS_SECTIONS[4].heading}
다음 작업은 **항상** 사용자 확인 후 실행:
- 파괴적 명령: \`rm -rf\`, force push, drop table, kill process
- 외부 시스템: deploy, slack 발송, 댓글 작성, PR merge
- 비가역적: amend pushed commit, branch -D

단순 read·local edit·테스트 실행은 묻지 말고 즉시 진행 (마찰 최소화).

---

📌 운영:
- \`claude-token-saver harness check\` — 현재 셋업 점수
- \`claude-token-saver harness promote "<룰>"\` — ratchet에 룰 추가
- \`claude-token-saver harness off\` — statusline 표시 끄기
${HARNESS_BLOCK_END}
`;
}

export function harnessRatchetMdInitial() {
  return `# Ratchet Rules (auto-grown by claude-token-saver)

같은 실수가 두 번 발생하면 여기에 한 줄 추가됩니다. 형식: "YYYY-MM-DD: <조건> → <행동>".

\`claude-token-saver harness promote "<rule>"\`로 룰을 추가하면 자동으로
이 파일에 append 됩니다.

## Rules

`;
}

/**
 * Append a rule to ratchet.md content. Safe to call on the initial template
 * or on a user-edited file: we just add to the end. Rules are dated.
 */
export function appendRatchetRule(existing, ruleText) {
  const today = new Date().toISOString().slice(0, 10);
  const line = `- ${today}: ${ruleText.trim()}\n`;
  // Ensure trailing newline so the new rule lands on its own line.
  const base = existing.endsWith('\n') ? existing : existing + '\n';
  return base + line;
}
