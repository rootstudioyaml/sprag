/* Proof lab: the hero is a flow diagram of the same requests run without sprag and with it; below it every real delegation is shown twice, without sprag (the main session, Opus, does it)
 * and with sprag (the setup sprag's rules pick). Both lanes replay their recorded run:
 * the bar is cost, the fill time is proportional to the real elapsed time.
 * All cards are open. Every number on the page is computed here from data.json. */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var GLYPH = { ok: '○', partial: '△', fail: '✕' };
  function glyphOf(c, v) { return GLYPH[v]; }
  var RANK = { fail: 0, partial: 1, ok: 2 };
  var STORIES = ['cost-down', 'quality-up', 'context'];
  var EFF3 = ['medium', 'high', 'xhigh'];
  var POLICIES = ['opus', 'sprag'];
  /* kinds of the numbers-only cases (sprag rule names) mapped onto the lab's kinds */
  var BULK_KIND = { run: 'run', check: 'lookup', explore: 'lookup', read: 'lookup', paste: 'review' };
  var QMAX = 14;         /* waiting dots drawn per request group before a +N label takes over */
  var MODELS = ['haiku', 'sonnet', 'opus'];
  var DUR = 2000;        /* ms for the longest lane of a card */
  var ROUTE = [350, 750, 1000, 1150]; /* sprag lane: consider Haiku, verdict on it, light the pick, start work */

  var STR = {
    en: {
      'p.eyebrow': 'Proof lab',
      'p.h1': 'Proof lab', 'scroll.hint': 'Scroll sideways', 'korean.orig': '(Korean original)', 'nav.install': 'Install', 'ft.docs': 'Docs', 'ft.github': 'GitHub', 'ft.npm': 'npm', 'ft.bench': 'Benchmark', 'ft.terms': 'Terms', 'ft.priv': 'Privacy', 'ft.refund': 'Refunds', 'ft.data': 'What Sprag sends',
      'p.h1n0': 'Which model gets the job? sprag decides, job by job.',
      'p.h1n': function (b) { return 'Of ' + b.n + ' real requests, the ' + b.handed.n + ' that sprag handed off cost ' + b.handed.savedPct + '% less.'; },
      's.handed': function (n, a, c) { return 'cost of the ' + n + ' jobs handed off (' + a + ' without sprag, ' + c + ' with)'; },
      's.all': function (n, k, a, c) { return 'all ' + n + ' jobs, including the ' + k + ' kept on the main model (' + a + ' without sprag, ' + c + ' with)'; },
      's.ok': function (p, f, o, n) { return 'answers usable as they are (' + p + ' incomplete, ' + f + ' wrong; ' + o + ' / ' + n + ' when the main session does everything)'; },
      lede: function (n) { return 'Doing everything in the main session is the default, and you can keep doing that. "Without sprag" in this lab is exactly that: the same ' + n + ' requests done by the main session (Opus) itself and handed to subagents by sprag, graded without knowing which was which. For lookups and runs, where the answer sits in the code or a command output, the main session re-reads its whole context on every tool call, so it costs more and the context fills up. Handed off, the main context stays light.'; },
      'hero.fit': 'sprag picks the model and effort each job needs. Work whose answer shows in tool output goes down to a cheaper model; work that ends in a judgement goes up to Opus.',
      lede2: 'sprag never changes the model or effort of your main session. It only picks the model and effort for each job handed off: down to Haiku when cheap is enough, up in effort when cheap would miss.',
      pills: ['Main session model and effort untouched', 'Rules are listed and can be switched off one by one', 'Every delegation shows where it went, in the statusline', 'All of it off in one line: sprag routing off'],
      title: 'Sprag Proof Lab | real requests replayed with and without sprag',
      desc: 'Real requests run twice, by the main Opus session itself and handed off by sprag to the model and effort that fits, then graded blind. See what was handed off, what stayed on the main model, what each cost and where the answers differed.',
      'nav.how': 'How it works', 'nav.routing': 'Routing', 'nav.features': 'Features', 'nav.docs': 'Docs',
      'nav.proof': 'Proof lab', 'nav.license': 'License', 'nav.teams': 'Team console',
      'pol.cheapest': 'Cheapest only', 'pol.opus': 'Without sprag', 'pol.sprag': 'With sprag',
      'pol.sub.cheapest': 'the cheapest setup every time', 'pol.sub.opus': 'the main session, Opus, does it all', 'pol.sub.sprag': 'down or up, job by job',
      'pol.line': function (ok, partial, fail) { return 'correct ' + ok + ', incomplete ' + partial + ', wrong ' + fail; },
      'pol.cost': function (u, savedPct, isBase) { return 'total ' + u + (isBase ? ' (baseline)' : ' (' + savedPct + '% less)'); },
      verdict: function (o) { return 'With sprag the ' + o.n + ' jobs cost ' + o.savedPct + '% less. ' + o.ok + ' answers were usable as they are, against ' + o.opusOk + ' when the main session did everything itself.'; },
      'k.h': function (n) { return n + ' cases in full, before and after'; },
      'k.sub': 'Left: for the jobs sprag sent down, the main session (Opus) doing it itself. For the jobs it sent up, Sonnet at medium effort, before the raise. Right: always the setup sprag picked. The bar is cost, and it fills as fast as the run really went.',
      'k.note': function (r, k, d) { return r + ' runs in ' + k + ' rounds, run on ' + d + '. Reports and grader notes are in Korean.'; },
      'lg.ok': 'Correct, usable as is', 'lg.partial': 'Incomplete, needs fixing', 'lg.fail': 'Wrong, unusable',
      'grp.cost-down': 'Went down: cheap was enough', 'grp.quality-up': 'Went up: it took higher effort', 'grp.context': 'No setup could fix it',
      'lane.a': 'Without sprag', 'lane.b': 'With sprag', 'lane.a.sub': 'Opus does it itself', 'lane.a.up': 'Effort as is',
      'up.pick': function (f, to) { return 'effort raised from ' + f + ' to ' + to; }, 'up.tag': 'effort ↑', 'up.badge': function (v) { return '↑ ' + v; },
      'sum.up': function (o) {
        if (o.up) return o.from.name + ' was ' + o.from.verdict + '. sprag raised the effort to ' + o.to.eff + ' and the answer was ' + o.to.verdict + ', and the cost went from ' + o.from.usd + ' to ' + o.to.usd + '.';
        return 'In this run ' + o.from.name + ' was ' + o.to.verdict + ' too.' + (o.repeats ? ' The repeat runs below show the effort levels apart.' : '');
      },
      'pick.cost-down': function (c) { return 'down to ' + c; }, 'pick.quality-up': function (c) { return 'up to ' + c; }, 'pick.context': function (c) { return c; },
      'chip.na': 'not for Haiku',
      time: function (s) { return s; }, calls: function (n) { return n + ' tool calls'; },
      save: function (p) { return '−' + p + '%'; }, more: function (p) { return '+' + p + '%'; },
      replay: 'Replay',
      sum: function (o) {
        var s = '';
        if (o.cheap) s += 'Cheapest, ' + o.cheap.name + ', ' + o.cheap.verdict + '. ';
        s += 'sprag’s ' + o.rec.name + ' ' + (o.cmp > 0 ? 'beat Opus’s verdict' : o.cmp < 0 ? 'landed one step below Opus (' + o.rec.verdict + ')' : 'matched Opus’s verdict') + (o.pct > 0 ? ' at ' + o.pct + '% less.' : '.');
        return s;
      },
      'vp.ok': 'correct', 'vp.partial': 'incomplete', 'vp.fail': 'wrong',
      research: 'Research', lookup: 'Lookup', run: 'Run', implement: 'Implement', review: 'Review',
      'cond.haiku-low': 'Haiku low', 'cond.sonnet-medium': 'Sonnet medium', 'cond.sonnet-high': 'Sonnet high', 'cond.sonnet-xhigh': 'Sonnet xhigh',
      'cond.opus-direct': 'Opus itself (baseline)', 'cond.sonnet-high-improved': 'Sonnet high + better prompt',
      rec: 'sprag rule', 'rec.exp': 'best in this test',
      notrun: 'Not run', 'notrun.impl': 'Not run. Current rules never give implementation to Haiku.',
      'd.open': 'Every setup that was tried, and the reports',
      'd.task': 'The job', 'd.truth': 'Answer key', 'd.lesson': 'What it shows',
      'd.miss': 'Missed (grader note, in Korean)', 'd.missNone': 'Nothing important missed.',
      'd.report': function (s, m, tok, calls, sec) { return 'Report (rubric ' + s + '/' + m + ', ' + tok + ' tokens, ' + calls + ' tool calls, ' + sec + ')'; },
      'd.full': 'Full report', 'd.trunc': 'Cut at 8,000 characters.', 'd.shot': 'Screenshot the run took',
      'v.ok': 'Correct', 'v.partial': 'Incomplete', 'v.fail': 'Wrong',
      saved: function (p) { return p + '% cheaper than Opus'; },
      pricier: function (p) { return p + '% more than Opus'; },
      base: 'baseline',
      'rp.h': function (n) { return 'Same Sonnet, ' + n + ' more runs per effort'; },
      'rp.avg': function (u, s) { return 'avg ' + u + ', ' + s; },
      'rp.found': function (f) { return 'Key story found: ' + f.map(function (x) { return x.effort + ' ' + x.n + '/' + x.of; }).join(', '); },
      'rp.blocked': 'partly hit the web search budget', 'rp.run': function (n) { return 'run ' + n; },
      'm.h': 'Method and limits',
      mlist: function (d, n, o) {
        var l = [
          'Run on ' + d + '. Only the ' + n + ' cases cleared for publication are shown.',
          '"Without sprag" is the main session doing the job itself on Opus, with no delegation. "With sprag" is the setup sprag’s rules route that kind of job to. "Cheapest only" is the cheapest setup that was run for that case, usually Haiku at low effort.',
          'Research jobs are not delegated by the current rules, so for those two cases "with sprag" is the setup that did best in this test. They are marked "best in this test".',
          'Each setup got the original delegation instruction, sent again as it was. Only the "better prompt" setup had its wording improved. Cases from the second round show a short summary of what was delegated, not the user’s own words.',
          'One Opus grader scored every report against a fixed rubric without seeing which setup produced it. There is one grader per case, labels were shuffled, and the answer keys were built from the code before any report was read.',
          'Correct means the answer could be handed to the user as it was, incomplete means it needed fixing first, and wrong means the answer could not be used. The rubric score next to each report is the sum of the rubric items, so a high score can still be wrong when the one thing that mattered was missed.',
          'Each lane is a single run, so there is room for chance. The repeat runs inside a case show how much the verdict moves.',
          'Web results change by date. A re-run next week may find different stories.',
          'Cost is tokens priced at Anthropic list prices through sprag’s price table. It is not a bill, and it is not what a subscription charges. Token counts are large because every tool call re-reads the whole context.'
        ];
        if (o.r2) l.push(
          'Each second-round case ran in a git worktree pinned to the commit where the original delegation happened, so every setup saw the same code.',
          'Case 492’s original run reviewed code that had not been committed yet, and the pinned commit does not have it. One Sonnet high run read the newer main checkout instead and said so in its report.',
          'Case 476 has no Haiku run, because the current rules never give implementation to Haiku.'
        );
        if (o.r1) l.push(
          'In the repeat runs, some runs partly hit the web search budget. They are kept and marked.',
          'Subagents could read the user’s auto-memory, which the original runs could not. One repeat run of a case that is not shown here used it.'
        );
        return l;
      },
      'dg.head': function (n) { return 'The same ' + n + ' requests, two ways at once'; }, 'dg.cmp': 'Compared with', 'dg.vs': 'vs',
      'dg.aria': function (n) { return 'Flow of the same ' + n + ' requests run without sprag and with the compared policy'; },
      'dg.s.req': function (n) { return n + ' real requests'; }, 'dg.s.route': 'sprag decides', 'dg.s.run': 'Runs by setup', 'dg.s.grade': 'Blind grading', 'dg.s.out': 'Result',
      'dg.rules': ['kind of job', 'where the answer lives', 'can it be checked', 'effort'],
      'dg.grader': 'Opus grader', 'dg.grader.sub': ['answer key check', 'setup hidden'], 'dg.graded': function (k, n) { return k + ' / ' + n + ' graded'; },
      'dg.n': function (n) { return n === 1 ? '1 job' : n + ' jobs'; },
      'dg.lane': function (n, u) { return (n === 1 ? '1 job ' : n + ' jobs ') + u; },
      'dg.cost': 'Total cost', 'dg.base': 'baseline (Opus itself)',
      'dg.fl': { a: 'without', b: 'with' },
      'dg.split': function (h, k) { return h + ' handed off, ' + k + ' kept'; },
      'dg.delta.h': 'Difference',
      'dg.delta.handed': function (n) { return 'cost of the ' + n + ' handed off'; },
      'dg.delta.all': function (n, p, u) { return 'all ' + n + ': −' + p + '%, ' + u; },
      'dg.tip.click': 'Click to open the case', 'dg.more': function (k) { return '+' + k + ' more'; },
      'live.h': 'Real usage, counted only',
      'live.sub': function (s, u) { return 'Delegations a sprag rule sent in real sessions from ' + s + ' to ' + u + '. Not replayed and not graded, so only the count and the cost are shown. The graded replays are above.'; },
      'live.runs': 'delegations sent', 'live.to': 'where they went',
      'live.toV': function (h, s, o) { return 'Haiku ' + h + ', Sonnet ' + s + ', Opus ' + o; },
      'live.cost': function (n) { return 'what those runs cost (' + n + ' priced)'; },
      'live.saved': 'less than the main model would have cost (estimate)',
      'live.pair': function (o) { return 'On the ' + o.n + ' runs with a recorded cost: ' + o.cost + ' spent, against an estimated ' + o.base + ' had the main model done them itself.'; },
      'live.why': 'The estimate counts what the main session would pay to re-read its accumulated context on every call, and to keep re-reading the tool output that stays in that context. The replays above start from an empty session, so they leave that cost out and show a lower saving rate.',
      'bulk.more': 'Measurement detail: how the rule was narrowed, noise floor, grader variance',
      'bulk.recheck': function (o) { return 'After blind grading, ' + (o.n === 1 ? '1 case was' : o.n + ' cases were') + ' checked again with tools: the Opus reference was wrong and the model sprag picked was right. ' + (o.n === 1 ? 'That case counts' : 'Those cases count') + ' as the same conclusion for sprag and as wrong for Opus. As first graded: ' + o.ok + ' same, ' + o.partial + ' partial, ' + o.fail + ' unusable.'; },
      'cta.h': 'Check it on your own sessions',
      'cta.sub': 'Once installed, the statusline shows where each delegation went and what it saved. One line, sprag routing off, turns it all off.',
      'cta.copy': 'Copy', 'cta.copied': 'Copied', 'cta.guide': 'Setup guide',
      'bulk.h': 'Bulk replay, counted only', 'bulk.title': 'Numbers-only case', 'bulk.key': 'answer key', 'bulk.tipsum': 'The prompt stays private. Graded blind against the Opus answer.',
      'bulk.sub': function (n) { return n + ' more real delegations, replayed in the state the repository was in at the time. Read-only jobs only. A blind grader compares each sprag pick with the same job run on Opus and says whether it reached the same conclusion. The prompts stay private, so only the counts are shown. This bar is stricter than the cases above: the reference is the whole Opus report, so a pick that misses one key fact Opus found counts as incomplete.'; },
      'bulk.kept': function (k) { return 'The current rule keeps ' + k + ' of these on the main Opus instead of handing them off. Those answers are the reference itself, so they count as the same conclusion.'; },
      'bulk.n': 'cases replayed', 'bulk.same': 'same conclusion as Opus',
      'bulk.sameV': function (ok, p, f) { return ok + ' same, ' + p + ' partial, ' + f + ' unusable'; },
      'bulk.cost': 'cost, sprag pick vs Opus direct',
      'bulk.costV': function (a, b, pct) { return a + ' vs ' + b + ' (' + pct + '% less)'; },
      'bulk.th': ['kind of job', 'cases', 'same', 'partial', 'unusable', 'sprag pick', 'Opus direct'],
      'bulk.noise': function (o) { return 'Noise floor: Opus run a second time on ' + o.n + ' of these cases and graded against its own first answer gives same conclusion ' + o.ok + ', partial ' + o.partial + ', unusable ' + o.fail + '. Partial marks below that line are run-to-run variance, not a weaker model.'; },
      'bulk.var': function (o) { return 'Grader variance: graded a second time, ' + o.agree + ' of ' + o.n + ' reports (' + o.pct + '%) got the same verdict.' + (o.cross ? ' Most of the ' + o.changed + ' that changed moved between same and partial.' : ''); },
      'bulk.v3.h': 'Only the work the new rule hands off',
      'bulk.v3': function (o) { return 'The new rule hands off ' + o.delegated + ' of ' + o.pool + ' jobs and keeps the rest on the main model. The ' + o.n + ' it handed off came out same ' + o.ok + ', partial ' + o.partial + ', unusable ' + o.fail + ', at ' + o.pick + ' against ' + o.opus + ' on Opus.'; },
      'up.eff.h': 'With the main effort turned down',
      'bulk.cmp': function (o) { return 'The same ' + o.n + ' cases, replayed as the rules were narrowed (' + o.rules + '): same conclusion ' + o.ok + ', partial ' + o.partial + ', unusable ' + o.fail + ', cost ' + o.usd + ' against ' + o.opus + ' on Opus.'; },
      'bulk.kind': { run: 'command runs', check: 'status checks', paste: 'pasted screens and logs', explore: 'lookups', read: 'reading and summaries' },
      'bulk.method': function (b) { return 'On 8 November two measurement fixes went in. ' + b.replayed + ' cases were replayed again because an absolute path left in the prompt let the reference read today\'s code instead of the code at the time. The grading rule was changed so that facts from investigation the task forbade or did not ask for do not count as missing, and every case was graded again. The rule changed after the results were seen, so the earlier figures stay on record: same conclusion ' + b.ok + ', partial ' + b.partial + ', unusable ' + b.fail + '.'; },
      'bulk.pt.h': function (n, kind) { return kind ? 'Reading each of the ' + n + ' partial marks in ' + kind : 'Checking the ' + n + ' partial or unusable marks with tools'; },
      'bulk.pt.th': ['cause', 'cases', 'what happened'],
      'bulk.pt.cause': { rule: 'rule defect', gap: 'real model gap', measure: 'measurement limit', scope: 'judgement call on scope', ref: 'reference was wrong', image: 'fixed in the delegation appendix' },
      'bulk.pt.why': { rule: 'Work that should not have been handed off was handed off: improvement reviews, web research that needs searching, lookups that must conclude something does not exist, and checks that decide from the output what to open next. The new rule keeps these on the main model.', gap: 'The work was fine to hand off, and the delegated model missed a key fact.', measure: 'The job reads another repository as it is today, so the state at the time cannot be replayed. Opus against Opus was partial here too.', scope: 'The task forbade root-cause analysis, while the reference explained the cause. The grader counted the missing "these results are unusable" conclusion.', ref: 'The Opus reference could not reach the vendor page and concluded that nothing was stated. Sonnet found the answers in an archived snapshot. A grader with tools checked them and Sonnet was right. That case is now counted as the same conclusion for sprag and as wrong for Opus.', image: 'The key content sat in screenshots on the page and the report never opened them. A new rule in the delegation appendix says to open images before calling something unverifiable, and the rerun with it reached the same conclusion (one run).' },
      'impl.h': function (p) { return 'Handing off the code writing cuts its cost by ' + p + '%'; },
      'impl.sum.th': ['', 'cost', 'tests pass', 'usable untouched'],
      'impl.sum.rows': { s: 'Handed to Sonnet', b: 'Opus direct' },
      'impl.take': function (o) { return 'Tests pass about as often: ' + o.sPass + ' and ' + o.bPass + ' of ' + o.n + '. The gap is in the finish. Missing evidence and report claims that did not match the diff were more common on the Sonnet side, which is why sprag has the main model check a handed-off implementation against the diff and the tests. That check is not in the numbers above.'; },
      'impl.more': 'Measurement detail: each round, the rewritten-specification run, Haiku, limits',
      'impl.detail.sub': 'It was measured twice and the two rounds disagree, so both are here. Every condition implemented the same task in a fresh copy of the repository, and the grader checked each copy and ran its tests.',
      'impl.sub': function (n) { return n + ' implementation tasks, each done two ways: handed to Sonnet, and done by Opus itself.'; },
      'impl.th': ['run', 'usable as is', 'partial', 'unusable', 'tests pass', 'wrong claims', 'missed items', 'cost'],
      'impl.cond': { 'sonnet-next': 'Sonnet worker', 'haiku-next': 'Haiku worker', 'opus-direct': 'Opus direct', 'sonnet-spec': 'Rewritten spec + Sonnet', 'sonnet-high': 'Original draft + Sonnet' },
      'impl.large.h': function (n) { return n + ' larger implementations'; },
      'impl.large.sub': 'Implementations with a lot of output, run with the worker instructions that ship today. Opus direct could not call a sub-agent.',
      'impl.large.take': function (o) { return 'Sonnet was usable as is in ' + o.sOk + ' of ' + o.n + ' and Opus direct in ' + o.bOk + ', at ' + o.pct + '% of the Opus cost.' + (o.hOk == null ? '' : ' Haiku was usable in ' + o.hOk + ' and its tests passed in ' + o.hPass + ', so sprag does not hand implementation to Haiku.'); },
      'impl.spec.h': function (n) { return n + ' implementations, with the hand-off rewritten as a specification'; },
      'impl.spec.sub': 'The earlier round. Opus first rewrote each hand-off draft as a detailed specification, then Sonnet implemented from it.',
      'impl.spec.cost': function (spec, impl) { return 'The rewritten-spec path costs ' + spec + ' for writing the specifications plus ' + impl + ' for the implementation. Each specification was written in an empty session, which overstates what it costs in a session that has already read the code.'; },
      'impl.spec.take': function (o) { return 'Here Opus direct was usable as is in all ' + o.bOk + ' of ' + o.n + '. Sonnet was usable in ' + o.oldOk + ' from the original draft and ' + o.newOk + ' from the rewritten specification.'; },
      'impl.limit': 'Both rounds are small and graded once. Most marks were lost in the report and not in the code: evidence the task asked for was missing, or a claim did not match the diff. That happened to every model, which is why the main model checks the diff and the test results itself whoever wrote the code. In the first round one Opus direct run handed its work to a sub-agent; later rounds block that.',
      'up.h': 'When to go up',
      'up.sub': function (n) { return n + ' jobs whose conclusion is a judgement, run on Sonnet high, Opus high and Opus xhigh: improvement reviews, audits, root-cause diagnosis, lookups that must conclude something does not exist, and web research. Here the Opus answer is not the key. The grader gets the three reports unlabelled, checks the claims they disagree on against the repository and the web, and then rules.'; },
      'up.th': ['run', 'same', 'partial', 'unusable', 'wrong claims', 'missed facts', 'cost', 'time'],
      'up.cond': { 'sonnet-high': 'Sonnet high', 'opus-direct': 'Opus high', 'opus-xhigh': 'Opus xhigh', 'opus-high': 'Opus high', 'opus-medium': 'Opus medium', 'opus-low': 'Opus low' },
      'up.take': function (o) { return 'Moving these jobs from Sonnet to Opus high takes same conclusions from ' + o.sOk + ' to ' + o.bOk + ' and wrong claims from ' + o.sWrong + ' to ' + o.bWrong + ', for ' + o.costX + 'x the cost. Raising effort to xhigh on top made wrong claims ' + o.hWrong + ' and took ' + o.timeX + 'x the time, so sprag recommends high.'; },
      'up.limit': 'Ten cases is a small sample, and the grader is Opus too. Two runs of the same Opus high, graded this way, split 4 and 8 on same conclusions, because each report is judged against the best answer in its round. Read these tables as direction only; a larger sample is being measured.',
      loadFail: 'Could not load the data. Please reload the page.'
    },
    ko: {
      'p.eyebrow': '검증 Lab',
      'p.h1': '검증 Lab', 'scroll.hint': '← 옆으로 밀어 보기', 'korean.orig': '(Korean original)', 'nav.install': '설치', 'ft.docs': '문서', 'ft.github': 'GitHub', 'ft.npm': 'npm', 'ft.bench': '벤치마크', 'ft.terms': '이용약관', 'ft.priv': '개인정보처리방침', 'ft.refund': '환불정책', 'ft.data': 'Sprag가 보내는 데이터',
      'p.h1n0': '일마다 어느 모델에 맡길지 sprag가 고릅니다.',
      'p.h1n': function (b) { return '실제 요청 ' + b.n + '건 중 sprag가 넘긴 ' + b.handed.n + '건은 비용이 ' + b.handed.savedPct + '% 적게 들었습니다.'; },
      's.handed': function (n, a, c) { return '넘긴 ' + n + '건의 비용 (sprag 없이 ' + a + ', sprag와 함께 ' + c + ')'; },
      's.all': function (n, k, a, c) { return '메인에 남긴 ' + k + '건까지 합친 ' + n + '건 전체 (sprag 없이 ' + a + ', sprag와 함께 ' + c + ')'; },
      's.ok': function (p, f, o, n) { return '그대로 쓸 수 있는 답 (부족 ' + p + '건, 오답 ' + f + '건, 메인이 전부 직접 하면 ' + o + ' / ' + n + ')'; },
      lede: function (n) { return '메인 세션에서 전부 직접 하는 게 기본값이고 그래도 됩니다. 이 Lab의 "sprag 없이"가 바로 그 방식이라서, 같은 요청 ' + n + '건을 메인인 Opus가 직접 한 실행과 sprag가 서브에이전트로 넘긴 실행을 가린 채 채점해 비교했습니다. 조회나 실행처럼 답이 코드와 명령 출력에서 나오는 일은 메인이 직접 하면 도구 호출마다 문맥 전체를 다시 읽어 비싸고 문맥도 그만큼 찹니다. 넘기면 메인 문맥은 가볍게 남습니다.'; },
      'hero.fit': 'sprag는 일마다 맞는 모델과 effort를 고릅니다. 도구 출력으로 확인되는 일은 싼 모델로 내리고 판단이 결론인 일은 Opus로 올립니다.',
      lede2: 'sprag는 메인 세션의 모델과 effort를 바꾸지 않습니다. 넘기는 일마다 어느 모델과 effort가 맞는지만 고릅니다. 싸게 될 일은 Haiku로 내리고 놓칠 일은 effort를 올립니다.',
      pills: ['메인 세션의 모델과 effort는 건드리지 않음', '룰은 목록으로 보이고 한 줄씩 끌 수 있음', '위임마다 어디로 보냈는지 상태줄에 표시', '전부 끄기는 sprag routing off 한 줄'],
      title: 'Sprag 검증 Lab | 메인이 직접 할 때와 sprag가 넘길 때',
      desc: 'sprag는 메인 세션을 건드리지 않고 넘기는 일만 고릅니다. 실제 위임을 sprag 없이, sprag와 함께 다시 돌려 블라인드 채점했습니다.',
      'nav.how': '작동 방식', 'nav.routing': '라우팅', 'nav.features': '기능', 'nav.docs': '문서',
      'nav.proof': '검증 Lab', 'nav.license': '라이선스', 'nav.teams': '팀 콘솔',
      'pol.cheapest': '가장 싼 모델로만', 'pol.opus': 'sprag 없이', 'pol.sprag': 'sprag와 함께',
      'pol.sub.cheapest': '매번 가장 싼 조건', 'pol.sub.opus': '메인 세션인 Opus가 전부 처리', 'pol.sub.sprag': '일마다 내리거나 올림',
      'pol.line': function (ok, partial, fail) { return '정답 ' + ok + '건, 부족 ' + partial + '건, 오답 ' + fail + '건'; },
      'pol.cost': function (u, savedPct, isBase) { return '비용 합계 ' + u + (isBase ? ' (기준)' : ' (기준보다 ' + savedPct + '% 적음)'); },
      verdict: function (o) { return 'sprag와 함께 돌리면 ' + o.n + '건의 비용이 ' + o.savedPct + '% 줄어듭니다. 그대로 쓸 수 있는 답은 ' + o.ok + '건이고 메인이 전부 직접 하면 ' + o.opusOk + '건입니다.'; },
      'k.h': function (n) { return '자세히 공개한 ' + n + '건, 쓰기 전과 후'; },
      'k.sub': '내린 사례는 왼쪽이 메인 세션인 Opus가 직접 처리한 실행이고, 올린 사례는 왼쪽이 effort를 올리기 전 Sonnet medium 실행입니다. 오른쪽은 늘 sprag가 고른 조건입니다. 막대는 비용이고 채워지는 속도는 실제 걸린 시간에 비례합니다.',
      'k.note': function (r, k, d) { return '실행 ' + r + '회, 라운드 ' + k + '개, 실행일은 ' + d + '입니다.'; },
      'lg.ok': '정답, 그대로 씀', 'lg.partial': '부족, 고쳐야 씀', 'lg.fail': '오답, 못 씀',
      'grp.cost-down': '내린 사례: 싼 모델로 충분', 'grp.quality-up': '올린 사례: effort를 올려야 맞힘', 'grp.context': '어떤 조건도 못 채운 사례',
      'lane.a': 'sprag 없이', 'lane.b': 'sprag와 함께', 'lane.a.sub': 'Opus가 직접 처리', 'lane.a.up': 'effort 그대로',
      'up.pick': function (f, to) { return 'effort를 ' + f + '에서 ' + to + '로 올림'; }, 'up.tag': 'effort ↑', 'up.badge': function (v) { return '↑ ' + v; },
      'sum.up': function (o) {
        if (o.up) return o.from.name + '이면 ' + o.from.verdict + ' 답이었습니다. sprag가 effort를 ' + o.to.eff + '로 올리자 ' + o.to.verdict + ' 답이 나왔고 비용은 ' + o.from.usd + '에서 ' + o.to.usd + '가 됐습니다.';
        return '이 실행에서는 ' + o.from.name + '도 ' + o.to.verdict + ' 답을 냈습니다.' + (o.repeats ? ' 아래 반복 실행에서 effort별 차이를 볼 수 있습니다.' : '');
      },
      'pick.cost-down': function (c) { return c + '로 내림'; }, 'pick.quality-up': function (c) { return c + '로 올림'; }, 'pick.context': function (c) { return c; },
      'chip.na': '구현은 제외',
      time: function (s) { return s; }, calls: function (n) { return '도구 호출 ' + n + '회'; },
      save: function (p) { return '−' + p + '%'; }, more: function (p) { return '+' + p + '%'; },
      replay: '다시 재생',
      sum: function (o) {
        var s = '';
        if (o.cheap) s += '가장 싼 ' + o.cheap.name + '는 ' + o.cheap.verdict + ' 답을 냈고 ';
        s += 'sprag가 고른 ' + o.rec.name + '는 Opus' + (o.cmp > 0 ? '보다 나은 판정을' : o.cmp < 0 ? '보다 한 단계 낮은 판정(' + o.rec.verdict + ')을' : '와 같은 판정을') + (o.pct > 0 ? ' ' + o.pct + '% 싸게 냈습니다.' : ' 냈습니다.');
        return s;
      },
      'vp.ok': '그대로 쓸 수 있는', 'vp.partial': '고쳐야 쓰는', 'vp.fail': '쓸 수 없는',
      research: '조사', lookup: '조회', run: '실행', implement: '구현', review: '검토',
      'cond.haiku-low': 'Haiku low', 'cond.sonnet-medium': 'Sonnet medium', 'cond.sonnet-high': 'Sonnet high', 'cond.sonnet-xhigh': 'Sonnet xhigh',
      'cond.opus-direct': 'Opus가 직접 (기준)', 'cond.sonnet-high-improved': 'Sonnet high + 지시문 수정',
      rec: 'sprag 룰', 'rec.exp': '실험상 최선',
      notrun: '실행하지 않음', 'notrun.impl': '실행하지 않음. 현재 룰은 구현을 Haiku에 맡기지 않습니다.',
      'd.open': '돌려 본 조건 전부와 보고서',
      'd.task': '맡긴 일', 'd.truth': '정답', 'd.lesson': '이 사례가 보여 주는 것',
      'd.miss': '놓친 것', 'd.missNone': '눈에 띄게 놓친 것이 없습니다.',
      'd.report': function (s, m, tok, calls, sec) { return '보고서 보기 (채점표 ' + s + '/' + m + ', 토큰 ' + tok + ', 도구 호출 ' + calls + '회, ' + sec + ')'; },
      'd.full': '전문 보기', 'd.trunc': '8,000자에서 잘랐습니다.', 'd.shot': '실행이 찍은 화면',
      'v.ok': '정답', 'v.partial': '부족', 'v.fail': '오답',
      saved: function (p) { return 'Opus보다 ' + p + '% 저렴'; },
      pricier: function (p) { return 'Opus보다 ' + p + '% 비쌈'; },
      base: '기준',
      'rp.h': function (n) { return '같은 Sonnet으로 effort마다 ' + n + '번 더 돌리면'; },
      'rp.avg': function (u, s) { return '평균 ' + u + ', ' + s; },
      'rp.found': function (f) { return '핵심 소식 발견: ' + f.map(function (x) { return x.effort + ' ' + x.n + '/' + x.of; }).join(', '); },
      'rp.blocked': '웹 검색 예산이 일부 막힘', 'rp.run': function (n) { return n + '회차'; },
      'm.h': '방법과 한계',
      mlist: function (d, n, o) {
        var l = [
          '실행일은 ' + d + '입니다. 공개해도 되는 ' + n + '건만 실었습니다.',
          '"sprag 없이"는 위임 없이 메인 세션인 Opus가 직접 처리한 실행입니다. "sprag와 함께"는 sprag 룰이 그 유형의 일을 보내는 조건입니다. "가장 싼 모델로만"은 그 사례에서 돌린 조건 중 가장 싼 것이고 대개 Haiku low입니다.',
          '조사형 일은 현재 룰이 위임하지 않습니다. 그래서 조사형 사례 2건의 "sprag와 함께"는 이 실험에서 가장 잘한 조건이고 "실험상 최선"으로 표시했습니다.',
          '조건마다 원래 위임했던 지시문을 그대로 다시 보냈습니다. 지시문 수정 조건만 문장을 고쳤습니다. 2라운드 사례에 적은 요청은 사용자가 쓴 말 그대로가 아니라 위임한 일을 짧게 요약한 것입니다.',
          '채점은 Opus 한 명이 고정된 기준표로 했고 어느 조건의 답인지는 가렸습니다. 채점자는 사례마다 한 명이고 라벨은 섞었으며 정답 기준은 보고서를 읽기 전에 코드를 보고 만들었습니다.',
          '정답은 고치지 않고 사용자에게 넘길 수 있는 답, 부족은 고쳐야 넘길 수 있는 답, 오답은 쓸 수 없는 답입니다. 보고서 옆의 채점표 점수는 기준표 항목의 합이라서 점수가 높아도 꼭 필요한 하나를 놓치면 오답이 됩니다.',
          '레인 하나는 실행 한 번이므로 우연이 섞일 수 있습니다. 사례 안의 반복 실행이 판정이 얼마나 흔들리는지 보여 줍니다.',
          '웹 조사 결과는 날짜에 따라 달라집니다. 다음 주에 다시 돌리면 다른 소식이 나올 수 있습니다.',
          '비용은 토큰을 sprag 가격표의 Anthropic 정가로 환산한 값입니다. 실제 청구액이 아니고 구독이 청구하는 금액도 아닙니다. 도구를 부를 때마다 문맥 전체를 다시 읽기 때문에 토큰 수가 큽니다.'
        ];
        if (o.r2) l.push(
          '2라운드 사례는 모두 원래 위임이 일어난 시점의 커밋에 고정한 git worktree에서 돌렸습니다. 그래서 모든 조건이 같은 코드를 봤습니다.',
          '사례 492의 원래 실행은 아직 커밋하지 않은 코드를 검토했고 고정한 커밋에는 그 코드가 없습니다. Sonnet high 실행 하나는 더 새로운 main 체크아웃을 읽었고 보고서에 그렇게 밝혔습니다.',
          '사례 476에는 Haiku 실행이 없습니다. 현재 룰이 구현을 Haiku에 맡기지 않기 때문입니다.'
        );
        if (o.r1) l.push(
          '반복 실행에서 일부는 웹 검색 예산이 일부 막혔습니다. 그런 실행은 빼지 않고 표시했습니다.',
          '서브에이전트는 사용자의 자동 메모리를 읽을 수 있었지만 원래 실행은 읽을 수 없었습니다. 여기에 싣지 않은 사례의 반복 실행 하나가 그 메모리를 썼습니다.'
        );
        return l;
      },
      'dg.head': function (n) { return '같은 요청 ' + n + '건을 두 방식으로 동시에 돌리면'; }, 'dg.cmp': '비교 대상', 'dg.vs': 'vs',
      'dg.aria': function (n) { return '같은 요청 ' + n + '건을 sprag 없이, 그리고 비교 대상 방식으로 돌린 경로 그림'; },
      'dg.s.req': function (n) { return '실제 요청 ' + n + '건'; }, 'dg.s.route': 'sprag 판정', 'dg.s.run': '모델별 실행', 'dg.s.grade': '블라인드 채점', 'dg.s.out': '결과',
      'dg.rules': ['일의 종류', '답이 나오는 곳', '검증 가능성', 'effort'],
      'dg.grader': 'Opus 채점자', 'dg.grader.sub': ['정답표와 대조', '어느 조건인지 가림'], 'dg.graded': function (k, n) { return '채점 ' + k + ' / ' + n; },
      'dg.n': function (n) { return n + '건'; },
      'dg.lane': function (n, u) { return n + '건 ' + u; },
      'dg.cost': '비용 합계', 'dg.base': '기준 (Opus 직접)',
      'dg.fl': { a: '없이', b: '함께' },
      'dg.split': function (h, k) { return '넘김 ' + h + '건, 남김 ' + k + '건'; },
      'dg.delta.h': '차이',
      'dg.delta.handed': function (n) { return '넘긴 ' + n + '건의 비용'; },
      'dg.delta.all': function (n, p, u) { return '전체 ' + n + '건 −' + p + '%, ' + u; },
      'dg.tip.click': '클릭하면 사례로 이동합니다', 'dg.more': function (k) { return '외 ' + k + '건'; },
      'live.h': '실제 사용 기록, 수치만',
      'live.sub': function (s, u) { return s + '부터 ' + u + '까지 sprag 룰이 실제 세션에서 보낸 위임입니다. 다시 돌리지도 채점하지도 않은 집계라서 건수와 비용만 보여 줍니다. 채점한 재생은 위에 있습니다.'; },
      'live.runs': '보낸 위임', 'live.to': '어디로 보냈나',
      'live.toV': function (h, s, o) { return 'Haiku ' + h + '건, Sonnet ' + s + '건, Opus ' + o + '건'; },
      'live.cost': function (n) { return '그 실행에 든 비용 (' + n + '건 기준)'; },
      'live.saved': '메인 모델이 그대로 받았을 때보다 적게 쓴 금액 (추정)',
      'live.pair': function (o) { return '비용이 기록된 ' + o.n + '건만 보면 실제 비용 ' + o.cost + ' 대 메인 모델이 직접 했을 때의 추정 비용 ' + o.base + '입니다.'; },
      'live.why': '이 추정은 메인 세션이 쌓인 문맥을 호출마다 다시 읽는 비용과 도구 출력이 문맥에 남아 이후 호출에서 다시 읽히는 비용까지 셉니다. 위의 재생은 빈 세션에서 시작해 그 비용이 빠지므로 절감률이 더 낮게 나옵니다.',
      'bulk.more': '측정 세부: 룰을 좁혀 온 이력, 잡음 바닥, 채점자 편차',
      'bulk.recheck': function (o) { return '블라인드 채점 뒤 ' + o.n + '건을 도구로 다시 확인했더니 기준인 Opus 답이 틀렸고 sprag가 고른 모델의 답이 맞았습니다. 이 ' + o.n + '건은 sprag 쪽을 같음으로, Opus 쪽을 오답으로 고쳐 셉니다. 고치기 전 채점은 같음 ' + o.ok + ', 부분 ' + o.partial + ', 못 씀 ' + o.fail + '이었습니다.'; },
      'cta.h': '내 세션에서 확인하기',
      'cta.sub': '설치하면 위임마다 어느 모델로 보냈는지와 아낀 금액이 상태줄에 나옵니다. sprag routing off 한 줄로 전부 끌 수 있습니다.',
      'cta.copy': '복사', 'cta.copied': '복사됨', 'cta.guide': '설치 안내 보기',
      'bulk.h': '대량 재생, 수치만', 'bulk.title': '수치만 공개한 사례', 'bulk.key': '기준 답', 'bulk.tipsum': '프롬프트는 비공개입니다. Opus 답을 기준으로 가린 채 채점했습니다.',
      'bulk.sub': function (n) { return '실제 위임 ' + n + '건을 당시 저장소 상태 그대로 다시 돌렸습니다. 파일을 고치지 않는 읽기 전용 일만 골랐습니다. 같은 일을 Opus가 직접 한 답을 기준으로 두고, 채점자가 어느 쪽인지 모른 채 sprag가 고른 모델의 답이 같은 결론에 닿았는지 가립니다. 프롬프트는 비공개라 수치만 보여 줍니다. 위의 상세 사례보다 기준이 엄격합니다. Opus 답 전체가 기준이라 Opus가 찾은 핵심 사실을 하나만 빠뜨려도 부족으로 셉니다.'; },
      'bulk.kept': function (k) { return '지금 규칙은 이 중 ' + k + '건을 넘기지 않고 메인 Opus가 직접 하게 합니다. 그 답이 곧 기준이므로 같은 결론으로 셉니다.'; },
      'bulk.n': '다시 돌린 사례', 'bulk.same': 'Opus와 같은 결론',
      'bulk.sameV': function (ok, p, f) { return '같음 ' + ok + ', 부분 ' + p + ', 못 씀 ' + f; },
      'bulk.cost': '비용, sprag 선택 대 Opus 직접',
      'bulk.costV': function (a, b, pct) { return a + ' 대 ' + b + ' (' + pct + '% 절감)'; },
      'bulk.th': ['일의 종류', '건수', '같음', '부분', '못 씀', 'sprag 선택', 'Opus 직접'],
      'bulk.noise': function (o) { return '잡음 바닥: 이 중 ' + o.n + '건은 Opus가 한 번 더 풀고 자기 첫 답을 기준으로 같은 채점을 받았습니다. 같음 ' + o.ok + ', 부분 ' + o.partial + ', 못 씀 ' + o.fail + '. 이 수준의 부분은 모델 차이가 아니라 실행마다 생기는 편차입니다.'; },
      'bulk.var': function (o) { return '채점자 편차: 같은 보고서 ' + o.n + '건을 한 번 더 채점하자 ' + o.agree + '건(' + o.pct + '%)이 같은 판정을 받았습니다.' + (o.cross ? ' 판정이 바뀐 ' + o.changed + '건은 대부분 같음과 부분 사이를 오갔습니다.' : ''); },
      'bulk.v3.h': '새 룰로 넘기는 일만 따로 본 결과',
      'bulk.v3': function (o) { return '새 룰은 풀 ' + o.pool + '건 가운데 ' + o.delegated + '건만 넘기고 나머지는 메인에 남깁니다. 넘긴 ' + o.n + '건은 같음 ' + o.ok + ', 부분 ' + o.partial + ', 못 씀 ' + o.fail + '이었고 비용은 ' + o.pick + ' 대 Opus ' + o.opus + '입니다.'; },
      'up.eff.h': '메인 effort를 낮췄을 때',
      'bulk.cmp': function (o) { return '같은 ' + o.n + '건을 룰을 좁혀 가며 다시 돌린 결과(' + o.rules + '). 같음 ' + o.ok + ', 부분 ' + o.partial + ', 못 씀 ' + o.fail + ', 비용 ' + o.usd + ', Opus 직접은 ' + o.opus + '.'; },
      'bulk.kind': { run: '명령 실행', check: '상태 확인', paste: '붙여넣은 화면과 로그', explore: '탐색과 조회', read: '읽기와 요약' },
      'bulk.method': function (b) { return '11월 8일에 측정 방법 두 가지를 고쳤습니다. 프롬프트에 남은 절대 경로 때문에 기준 답이 당시 코드가 아니라 현재 코드를 읽은 ' + b.replayed + '건은 다시 돌렸습니다. 작업 지시가 금지했거나 요구하지 않은 조사에서 나온 사실은 누락으로 세지 않도록 채점 기준을 고친 뒤 모든 사례를 다시 채점했습니다. 결과를 본 뒤에 기준을 바꿨으므로 바꾸기 전 수치도 남깁니다. 그때는 같음 ' + b.ok + ', 부분 ' + b.partial + ', 못 씀 ' + b.fail + '이었습니다.'; },
      'bulk.pt.h': function (n, kind) { return kind ? kind + '의 부분 ' + n + '건을 하나씩 읽은 결과' : '부분과 못 씀 ' + n + '건을 도구로 다시 확인한 결과'; },
      'bulk.pt.th': ['원인', '건수', '내용'],
      'bulk.pt.cause': { rule: '룰 결함', gap: '실제 모델 격차', measure: '측정 한계', scope: '판정 경계', ref: '기준 답 오류', image: '위임 부록 보강' },
      'bulk.pt.why': { rule: '넘기면 안 되는 일을 넘겼습니다. 개선점 검토, 검색이 필요한 웹 조사, "없다"를 단정하는 조회, 출력을 보고 더 볼 곳을 정하는 점검입니다. 새 룰은 이런 일을 메인에 남깁니다.', gap: '넘겨도 되는 일인데 위임받은 모델이 핵심 사실을 놓쳤습니다.', measure: '다른 저장소를 현재 상태로 읽는 일이라 당시 상태를 재현할 수 없습니다. Opus끼리 비교해도 부분이 나왔습니다.', scope: '지시가 원인 분석을 금지했는데 기준 답은 원인을 밝혔습니다. 채점자는 결과를 쓸 수 없다는 결론이 빠졌다고 봤습니다.', ref: 'Opus 기준 답은 업체 페이지에 닿지 못해 아무것도 적혀 있지 않다고 결론냈습니다. Sonnet은 보관된 스냅숏에서 답을 찾았습니다. 도구를 쓰는 채점자가 확인해 보니 Sonnet이 맞았습니다. 이 건은 sprag 쪽을 같음으로, Opus 쪽을 오답으로 고쳐 셌습니다.', image: '핵심 내용이 페이지의 스크린샷에 있었는데 보고서는 이미지를 열지 않았습니다. 확인할 수 없다고 쓰기 전에 이미지를 열라는 규칙을 위임 부록에 더해 다시 돌리니 같은 결론이 나왔습니다(1회).' },
      'impl.h': function (p) { return '코드 작성을 넘기면 구현비가 ' + p + '% 줄어듭니다'; },
      'impl.sum.th': ['', '비용', '테스트 통과', '손보지 않고 씀'],
      'impl.sum.rows': { s: 'Sonnet에 넘김', b: 'Opus 직접' },
      'impl.take': function (o) { return '테스트 통과는 ' + o.n + '건 중 ' + o.sPass + '건과 ' + o.bPass + '건으로 거의 같습니다. 차이는 마무리에서 납니다. 요구한 증거를 빠뜨리거나 보고가 실제와 다른 경우가 Sonnet 쪽에 더 많았습니다. 그래서 sprag는 넘긴 구현을 메인 모델이 diff와 테스트로 확인하게 합니다. 이 확인 비용은 위 숫자에 들어 있지 않습니다.'; },
      'impl.more': '측정 세부: 라운드별 결과, 설계서를 다시 쓴 경우, Haiku, 한계',
      'impl.detail.sub': '두 번 쟀는데 결과가 서로 달라서 둘 다 싣습니다. 조건마다 같은 과제를 새 저장소 사본에서 구현하게 했고 채점기가 사본마다 테스트를 돌려 대조했습니다.',
      'impl.sub': function (n) { return '구현 과제 ' + n + '건을 Sonnet에 넘겼을 때와 Opus가 직접 했을 때를 같은 과제로 비교했습니다.'; },
      'impl.th': ['실행', '그대로 씀', '부분', '못 씀', '테스트 통과', '틀린 주장', '놓친 항목', '비용'],
      'impl.cond': { 'sonnet-next': 'Sonnet 워커', 'haiku-next': 'Haiku 워커', 'opus-direct': 'Opus 직접', 'sonnet-spec': '새 설계서 + Sonnet', 'sonnet-high': '기존 초안 + Sonnet' },
      'impl.large.h': function (n) { return '큰 구현 ' + n + '건'; },
      'impl.large.sub': '출력이 많은 구현을 지금 배포되는 워커 지침으로 돌렸습니다. Opus 직접은 하위 에이전트를 부르지 못하게 막았습니다.',
      'impl.large.take': function (o) { return o.n + '건 중 Sonnet은 ' + o.sOk + '건, Opus 직접은 ' + o.bOk + '건을 그대로 쓸 수 있었습니다. Sonnet 비용은 Opus의 ' + o.pct + '%였습니다.' + (o.hOk == null ? '' : ' Haiku는 ' + o.hOk + '건이었고 테스트 통과가 ' + o.hPass + '건에 그쳐 sprag는 구현을 Haiku에 넘기지 않습니다.'); },
      'impl.spec.h': function (n) { return '설계서를 다시 썼을 때 ' + n + '건'; },
      'impl.spec.sub': '먼저 잰 라운드입니다. Opus가 위임 초안을 상세 설계서로 다시 썼고 Sonnet이 그 설계서로 구현했습니다.',
      'impl.spec.cost': function (spec, impl) { return '새 설계서 경로의 비용은 설계서 작성분(' + spec + ')과 구현분(' + impl + ')을 합친 값입니다. 설계서는 빈 세션에서 썼기 때문에 코드를 이미 읽은 실제 세션보다 비용이 크게 잡힙니다.'; },
      'impl.spec.take': function (o) { return '이 라운드에서는 Opus 직접이 ' + o.n + '건 중 ' + o.bOk + '건을 그대로 쓸 수 있었습니다. Sonnet은 기존 초안으로 ' + o.oldOk + '건, 새 설계서로 ' + o.newOk + '건이었습니다.'; },
      'impl.limit': '두 라운드 모두 표본이 작고 채점은 한 번입니다. 감점은 대부분 코드보다 보고에서 나왔습니다. 과제가 요구한 증거를 빠뜨렸거나 주장이 diff와 달랐습니다. 어느 모델에서나 생긴 일이라 누가 구현하든 메인 모델이 diff와 테스트 결과를 직접 확인합니다. 첫 라운드에서는 Opus 직접 1건이 스스로 하위 에이전트에 일을 넘겼고 그 뒤 측정부터 막았습니다.',
      'up.h': '올려야 할 때',
      'up.sub': function (n) { return '판단이 결론인 일 ' + n + '건을 Sonnet high, Opus high, Opus xhigh로 각각 돌렸습니다. 개선점 검토, 감사, 원인 진단, "없다"를 단정하는 조회, 웹 조사가 섞여 있습니다. 여기서는 Opus 답을 정답으로 쓰지 않습니다. 채점자가 세 보고서를 가린 채 받아 서로 엇갈리는 주장을 저장소와 웹에서 직접 확인하고 판정합니다.'; },
      'up.th': ['실행', '같음', '부분', '못 씀', '틀린 주장', '놓친 사실', '비용', '시간'],
      'up.cond': { 'sonnet-high': 'Sonnet high', 'opus-direct': 'Opus high', 'opus-xhigh': 'Opus xhigh', 'opus-high': 'Opus high', 'opus-medium': 'Opus medium', 'opus-low': 'Opus low' },
      'up.take': function (o) { return '이런 일을 Sonnet에서 Opus high로 올리면 같음이 ' + o.sOk + '건에서 ' + o.bOk + '건으로 늘고 틀린 주장은 ' + o.sWrong + '개에서 ' + o.bWrong + '개로 줄며 비용은 ' + o.costX + '배입니다. 여기서 effort를 xhigh로 더 올리면 틀린 주장이 ' + o.hWrong + '개가 되고 시간이 ' + o.timeX + '배 걸려 sprag는 high를 권합니다.'; },
      'up.limit': '10건이라 표본이 작고 채점자도 Opus입니다. 같은 Opus high를 두 번 돌려 이 방식으로 채점하자 같은 결론이 4건과 8건으로 갈렸습니다. 보고서마다 같은 라운드에서 가장 좋은 답을 기준으로 판정하기 때문입니다. 그러니 이 표들은 방향만 보여 주며 표본을 늘려 다시 재고 있습니다.',
      loadFail: '데이터를 불러오지 못했습니다. 페이지를 새로 고쳐 주십시오.'
    }
  };

  var lang = 'en';
  var data = null;
  var banner = null;  /* banner.json: the headline and the three stat tiles come from it alone */
  var players = {};   /* case id -> { timers, raf, played } */
  var io = null;
  var $ = function (id) { return document.getElementById(id); };

  function t(key) { var v = STR[lang][key]; return v === undefined ? STR.en[key] : v; }
  function L(obj) { return obj && (obj[lang] || obj.en || obj.ko) || ''; }

  /* the case notes in data.json are Korean only: in EN mode they stay as written and carry a small label */
  function korStr(node, s) {
    if (lang === 'en' && /[가-힣]/.test(s || '')) node.appendChild(el('span', { class: 'kor-orig', text: ' ' + t('korean.orig') }));
    return node;
  }
  function kor(node, obj) {
    var s = L(obj);
    if (lang === 'en' && /[가-힣]/.test(s)) node.appendChild(el('span', { class: 'kor-orig', text: ' ' + t('korean.orig') }));
    return node;
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* number formats */
  function usd(v) { return '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2)); }
  function tokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k';
    return String(Math.round(n));
  }
  function secs(s) {
    s = Math.round(s);
    var m = Math.floor(s / 60), r = s % 60;
    if (!m) return lang === 'ko' ? r + '초' : r + 's';
    return lang === 'ko' ? m + '분 ' + r + '초' : m + 'm ' + r + 's';
  }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* data helpers */
  function caseById(id) { return data.cases.filter(function (c) { return c.id === id; })[0]; }
  function runOf(c, cond) { return c.runs.filter(function (r) { return r.condition === cond; })[0]; }
  /* setups the bulk rounds use that the graded rounds never ran; the page only needs the model family and a label */
  var EXTRA_CONDS = { 'sonnet-xhigh': { id: 'sonnet-xhigh', model: 'sonnet', effort: 'xhigh' } };
  function condObj(id) { return data.conditions.filter(function (c) { return c.id === id; })[0] || EXTRA_CONDS[id]; }
  /* research cases are not delegated by the current rules, so the chip there says what the test showed */
  function recText(c) { return t(c.kind === 'research' ? 'rec.exp' : 'rec'); }
  function notRunKey(c) { return c.kind === 'implement' ? 'notrun.impl' : 'notrun'; }
  function storiesPresent() { return STORIES.filter(function (s) { return data.cases.some(function (c) { return c.story === s; }); }); }
  function policyRun(c, p) {
    if (p === 'sprag') return runOf(c, c.recommended);
    if (p === 'opus') return runOf(c, 'opus-direct');
    return c.runs.filter(function (r) { return r.prompt === 'original'; }).sort(function (a, b) { return a.usd - b.usd; })[0];
  }
  function orderedCases() {
    var out = [];
    storiesPresent().forEach(function (s) { data.cases.forEach(function (c) { if (c.story === s) out.push(c); }); });
    return out;
  }
  /* the numbers-only cases, shaped like graded cases so the hero can flow them: the Opus run is the answer key, so it counts as correct */
  function bulkCases() {
    var b = data.bulk; if (!b || !b.cases) return [];
    return b.cases.map(function (r, i) {
      var lane = r.lane === 'sonnet-xhigh-web' ? 'sonnet-xhigh' : r.lane;
      return { id: 'bulk-' + i, bulk: true, kind: BULK_KIND[r.kind] || 'lookup', story: 'bulk', recommended: lane, web: r.lane === 'sonnet-xhigh-web',
        runs: [{ condition: lane, verdict: r.verdict, usd: r.pickUsd, seconds: r.pickSec, prompt: 'original' },
          { condition: 'opus-direct', verdict: r.opusVerdict || 'ok', ref: true, usd: r.opusUsd, seconds: r.opusSec, prompt: 'original' }] };
    });
  }
  function heroCases() { return orderedCases().concat(bulkCases()); }
  function caseTitle(c) { return c.bulk ? t('bulk.title') : L(c.title); }
  function pctSaved(run, base) { return Math.round((1 - run.usd / base.usd) * 100); }

  /* ---------- static text, hero ---------- */
  function renderStatic() {
    document.documentElement.lang = lang;
    document.title = t('title');
    var d = document.querySelector('meta[name=description]');
    if (d) d.content = t('desc');
    document.querySelectorAll('[data-k]').forEach(function (n) {
      var v = STR[lang][n.dataset.k];
      if (typeof v === 'string') n.textContent = v;
    });
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    renderBanner();
  }

  /* headline and stat tiles: only banner.json feeds them, so the page and the home banner agree */
  function renderBanner() {
    var h = $('h1n'), st = $('stats');
    if (!h) return;
    var b = banner;
    if (st) st.textContent = '';
    if (!b || !b.handed) { h.textContent = t('p.h1n0'); return; }
    h.textContent = t('p.h1n')(b);
    if (!st) return;
    var tile = function (big, label, cls) { return el('div', { class: 'hs' + (cls ? ' ' + cls : '') }, [el('b', { text: big }), el('span', { text: label })]); };
    var kept = (b.kept && b.kept.n) || 0;
    st.appendChild(tile('−' + b.handed.savedPct + '%', t('s.handed')(b.handed.n, usd(b.handed.opusUsd), usd(b.handed.pickUsd)), 'hs-main'));
    st.appendChild(tile('−' + b.savedPct + '%', t('s.all')(b.n, kept, usd(b.opusUsd), usd(b.pickUsd))));
    st.appendChild(tile(b.ok + ' / ' + b.n, t('s.ok')(b.partial, b.fail, b.opusOk, b.n)));
  }

  function renderHero() {
    var cs0 = heroCases();
    $('lede').textContent = t('lede')(cs0.length);
    $('fit').textContent = t('hero.fit');
    $('lede2').textContent = t('lede2');
    var pills = $('pills'); pills.textContent = '';
    t('pills').forEach(function (s) { pills.appendChild(el('li', { text: s })); });
    var box = $('policies'); box.textContent = '';
    var cases = cs0;
    var opusTotal = cases.reduce(function (s, c) { return s + policyRun(c, 'opus').usd; }, 0);
    var tally = {};
    POLICIES.forEach(function (p) {
      var runs = cases.map(function (c) { return policyRun(c, p); });
      var n = { ok: 0, partial: 0, fail: 0 }, total = 0;
      runs.forEach(function (r) { n[r.verdict]++; total += r.usd; });
      tally[p] = { n: n, total: total };
      var strip = runs.length > 30 ? null : el('div', { class: 'strip', 'aria-hidden': 'true' }, cases.map(function (c, i) { return el('i', { class: 'g ' + runs[i].verdict, text: glyphOf(c, runs[i].verdict) }); }));
      box.appendChild(el('div', { class: 'pol pol-' + p }, [
        el('h3', { text: t('pol.' + p) }),
        el('small', { text: t('pol.sub.' + p) }),
        strip,
        el('p', { class: 'pol-line', text: t('pol.line')(n.ok, n.partial, n.fail) }),
        el('p', { class: 'pol-cost', text: t('pol.cost')(usd(total), 100 - Math.round(total / opusTotal * 100), p === 'opus') })
      ]));
    });
    $('verdict').textContent = t('verdict')({ n: cases.length, savedPct: 100 - Math.round(tally.sprag.total / opusTotal * 100), ok: tally.sprag.n.ok, opusOk: tally.opus.n.ok });
  }

  function renderLive() {
    var box = $('live'); if (!box) return;
    var v = data.live;
    box.textContent = '';
    if (!v || !v.runs) { box.hidden = true; return; }
    box.hidden = false;
    var tile = function (big, label, cls) { return el('div', { class: 'lv' + (cls ? ' ' + cls : '') }, [el('b', { text: big }), el('span', { text: label })]); };
    box.appendChild(el('h2', { id: 'live-h', text: t('live.h') }));
    box.appendChild(el('p', { class: 'lv-sub', text: t('live.sub')(v.since, v.until) }));
    box.appendChild(el('div', { class: 'lv-grid' }, [
      tile(usd(v.savedUsd), t('live.saved'), 'lv-hl'),
      tile(usd(v.costUsd), t('live.cost')(v.costRuns)),
      tile(String(v.runs), t('live.runs')),
      tile(t('live.toV')(v.to.haiku, v.to.sonnet, v.to.opus), t('live.to'), 'sm')
    ]));
    if (Number.isFinite(v.savedCostUsd) && v.costRuns) {
      box.appendChild(el('p', { class: 'lv-note', text: t('live.pair')({ n: v.costRuns, cost: usd(v.costUsd), base: usd(v.costUsd + v.savedCostUsd) }) }));
    }
    box.appendChild(el('p', { class: 'lv-note', text: t('live.why') }));
  }

  function renderBulk() {
    var box = $('bulk'); if (!box) return;
    var v = data.bulk, tot = v && v.totals;
    var wasOpen = !!box.querySelector('details.bk-more[open]');
    box.textContent = '';
    if (!tot || !tot.n) { box.hidden = true; return; }
    box.hidden = false;
    var tile = function (big, label, cls) { return el('div', { class: 'lv' + (cls ? ' ' + cls : '') }, [el('b', { text: big }), el('span', { text: label })]); };
    var pct = tot.opusUsd ? Math.round((1 - tot.pickUsd / tot.opusUsd) * 100) : 0;
    box.appendChild(el('h2', { id: 'bulk-h', text: t('bulk.h') }));
    box.appendChild(el('p', { class: 'lv-sub', text: t('bulk.sub')(tot.n) }));
    if (tot.keptMain) box.appendChild(el('p', { class: 'lv-sub', text: t('bulk.kept')(tot.keptMain) }));
    if (tot.rechecked) {
      /* a verdict overturned after the blind grade is counted as corrected, and the first grade stays on the page */
      var graded = { ok: 0, partial: 0, fail: 0 };
      (v.cases || []).forEach(function (r) { graded[r.graded || r.verdict]++; });
      box.appendChild(el('p', { class: 'lv-sub', text: t('bulk.recheck')({ n: tot.rechecked, ok: graded.ok, partial: graded.partial, fail: graded.fail }) }));
    }
    box.appendChild(el('div', { class: 'lv-grid lv-3' }, [
      tile(String(tot.n), t('bulk.n')),
      tile(t('bulk.sameV')(tot.ok, tot.partial, tot.fail), t('bulk.same'), 'sm'),
      tile(t('bulk.costV')(usd(tot.pickUsd), usd(tot.opusUsd), pct), t('bulk.cost'), 'sm')
    ]));
    /* what stays visible: title, text, tiles, the table by kind, the new-rule result. The measurement history folds into one details */
    var more = el('details', { class: 'bk-more' }, [el('summary', { text: t('bulk.more') })]);
    var cm = v.compare;
    if (cm && cm.steps && cm.steps.length > 1) {
      var seq = function (f) { return cm.steps.map(f).join(' → '); };
      more.appendChild(el('p', { class: 'bk-cmp', text: t('bulk.cmp')({ n: cm.n, rules: seq(function (x) { return x.rule; }), ok: seq(function (x) { return x.ok; }), partial: seq(function (x) { return x.partial; }), fail: seq(function (x) { return x.fail; }), usd: seq(function (x) { return usd(x.pickUsd); }), opus: usd(cm.opusUsd) }) }));
    }
    var nz = v.noise;
    if (nz && nz.n) more.appendChild(el('p', { class: 'bk-cmp bk-noise', text: t('bulk.noise')({ n: nz.n, ok: nz.ok, partial: nz.partial, fail: nz.fail }) }));
    var nt = v.notes;
    var vr = nt && nt.variance;
    if (vr && vr.n) more.appendChild(el('p', { class: 'bk-cmp bk-noise', text: t('bulk.var')({ n: vr.n, agree: vr.agree, changed: vr.changed, pct: Math.round(vr.agree / vr.n * 100), cross: vr.changed > 0 && vr.crossOkPartial / vr.changed >= 0.5 }) }));
    /* the method note joins the figures from before the grading fix with the replay count */
    if (nt && nt.method) more.appendChild(el('p', { class: 'bk-cmp bk-method', text: t('bulk.method')({ replayed: nt.method.replayed, ok: nt.method.before.ok, partial: nt.method.before.partial, fail: nt.method.before.fail }) }));
    var th = t('bulk.th'), names = t('bulk.kind');
    var kinds = Object.keys(v.byKind).sort(function (a, b) { return v.byKind[b].n - v.byKind[a].n; });
    var rows = kinds.map(function (k) {
      var r = v.byKind[k];
      return el('tr', null, [names[k] || k, r.n, r.ok, r.partial, r.fail, usd(r.pickUsd), usd(r.opusUsd)].map(function (c, i) { return el('td', { class: i ? 'num' : '', text: String(c) }); }));
    });
    box.appendChild(el('table', { class: 'bk' }, [
      el('thead', null, [el('tr', null, th.map(function (h, i) { return el('th', { class: i ? 'num' : '', text: h }); }))]),
      el('tbody', null, rows)
    ]));
    var v3 = nt && nt.v3;
    if (v3 && v3.n) {
      box.appendChild(el('h3', { class: 'bk-h3', text: t('bulk.v3.h') }));
      box.appendChild(el('p', { class: 'bk-cmp', text: t('bulk.v3')({ n: v3.n, ok: v3.ok, partial: v3.partial, fail: v3.fail, pool: v3.pool, delegated: v3.delegated, pick: usd(v3.pickUsd), opus: usd(v3.opusUsd) }) }));
    }
    var pt = nt && nt.partials;
    if (pt && pt.causes && pt.causes.length) {
      var pth = t('bulk.pt.th'), pcause = t('bulk.pt.cause'), pwhy = t('bulk.pt.why');
      more.appendChild(el('h3', { class: 'bk-h3', text: t('bulk.pt.h')(pt.n, pt.kind ? (names[pt.kind] || pt.kind) : null) }));
      more.appendChild(el('table', { class: 'bk bk-pt' }, [
        el('thead', null, [el('tr', null, pth.map(function (h, i) { return el('th', { class: i === 1 ? 'num' : '', text: h }); }))]),
        el('tbody', null, pt.causes.map(function (c) {
          return el('tr', null, [el('td', { text: pcause[c.k] || c.k }), el('td', { class: 'num', text: String(c.n) }), el('td', { text: pwhy[c.k] || '' })]);
        }))
      ]));
    }
    if (more.children.length > 1) { more.open = wasOpen; box.appendChild(more); }
  }

  function renderUp() {
    var box = $('up'); if (!box) return;
    var u = data.bulk && data.bulk.up;
    box.textContent = '';
    if (!u || !u.n || !u.conditions) { box.hidden = true; return; }
    var by = {};
    u.conditions.forEach(function (c) { by[c.id] = c; });
    var s = by['sonnet-high'], b = by['opus-direct'], h = by['opus-xhigh'];
    if (!s || !b || !h) { box.hidden = true; return; }
    box.hidden = false;
    var th = t('up.th'), names = t('up.cond');
    var upTable = function (list) {
      return el('table', { class: 'bk' }, [
        el('thead', null, [el('tr', null, th.map(function (x, i) { return el('th', { class: i ? 'num' : '', text: x }); }))]),
        el('tbody', null, list.map(function (c) {
          return el('tr', null, [names[c.id] || c.id, c.ok, c.partial, c.fail, c.wrong, c.missed, usd(c.usd), secs(c.sec)].map(function (x, i) { return el('td', { class: i ? 'num' : '', text: String(x) }); }));
        }))
      ]);
    };
    var o = { sOk: s.ok, bOk: b.ok, sWrong: s.wrong, bWrong: b.wrong, hWrong: h.wrong, costX: (b.usd / s.usd).toFixed(1), timeX: (h.sec / b.sec).toFixed(1) };
    box.appendChild(el('h2', { id: 'up-h', text: t('up.h') }));
    box.appendChild(el('p', { class: 'lv-sub', text: t('up.sub')(u.n) }));
    box.appendChild(upTable(['sonnet-high', 'opus-direct', 'opus-xhigh'].map(function (id) { return by[id]; })));
    box.appendChild(el('p', { class: 'bk-cmp', text: t('up.take')(o) }));
    box.appendChild(el('p', { class: 'bk-cmp bk-noise', text: t('up.limit') }));
    var ef = data.bulk.notes && data.bulk.notes.effort;
    if (ef && ef.conditions && ef.conditions.length) {
      box.appendChild(el('h3', { class: 'bk-h3', text: t('up.eff.h') }));
      box.appendChild(upTable(ef.conditions));
      var tk = ef.take && (ef.take[lang] || ef.take.en);
      if (tk) box.appendChild(el('p', { class: 'bk-cmp', text: tk }));
    }
  }

  function renderImpl() {
    var box = $('impl'); if (!box) return;
    var L = data.bulk && data.bulk.implLarge, S = data.bulk && data.bulk.implSpec;
    var usable = function (r) { return !!(r && r.n && r.conditions && r.conditions.length); };
    var wasOpen = !!box.querySelector('details.bk-more[open]');
    box.textContent = '';
    if (!usable(L) && !usable(S)) { box.hidden = true; return; }
    box.hidden = false;
    var th = t('impl.th'), names = t('impl.cond');
    // Headline: the draft handed to Sonnet against Opus doing it, summed over the rounds that have both rows.
    var sum = { n: 0, s: { usd: 0, ok: 0, pass: 0 }, b: { usd: 0, ok: 0, pass: 0 } };
    [[L, 'sonnet-next'], [S, 'sonnet-high']].forEach(function (p) {
      var r = p[0]; if (!usable(r)) return;
      var by = {}; r.conditions.forEach(function (c) { by[c.id] = c; });
      var sc = by[p[1]], bc = by['opus-direct']; if (!sc || !bc) return;
      sum.n += r.n;
      [['s', sc], ['b', bc]].forEach(function (q) {
        var tt = r.tests && r.tests[q[1].id];
        sum[q[0]].usd += q[1].usd; sum[q[0]].ok += q[1].ok; sum[q[0]].pass += tt ? tt.pass : 0;
      });
    });
    var rowsOf = function (r, ids) {
      var by = {};
      r.conditions.forEach(function (c) { by[c.id] = c; });
      return { by: by, list: ids.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; }) };
    };
    var implTable = function (r, list, extra) {
      return el('table', { class: 'bk' }, [
        el('thead', null, [el('tr', null, th.map(function (x, i) { return el('th', { class: i ? 'num' : '', text: x }); }))]),
        el('tbody', null, list.map(function (c) {
          var tt = r.tests && r.tests[c.id];
          var cost = c.usd + (extra && extra[c.id] || 0);
          return el('tr', null, [names[c.id] || c.id, c.ok, c.partial, c.fail, tt ? tt.pass + ' / ' + c.n : '-', c.wrong, c.missed, usd(cost)].map(function (x, i) { return el('td', { class: i ? 'num' : '', text: String(x) }); }));
        }))
      ]);
    };
    if (!sum.n || !sum.b.usd) { box.hidden = true; return; }
    var sth = t('impl.sum.th'), srow = t('impl.sum.rows');
    box.appendChild(el('h2', { id: 'impl-h', text: t('impl.h')(Math.round((1 - sum.s.usd / sum.b.usd) * 100)) }));
    box.appendChild(el('p', { class: 'lv-sub', text: t('impl.sub')(sum.n) }));
    box.appendChild(el('table', { class: 'bk' }, [
      el('thead', null, [el('tr', null, sth.map(function (x, i) { return el('th', { class: i ? 'num' : '', text: x }); }))]),
      el('tbody', null, ['s', 'b'].map(function (k) {
        return el('tr', null, [srow[k], usd(sum[k].usd), sum[k].pass + ' / ' + sum.n, sum[k].ok + ' / ' + sum.n].map(function (x, i) { return el('td', { class: i ? 'num' : '', text: String(x) }); }));
      }))
    ]));
    box.appendChild(el('p', { class: 'bk-cmp', text: t('impl.take')({ n: sum.n, sPass: sum.s.pass, bPass: sum.b.pass }) }));
    var top = box;
    box = el('details', { class: 'bk-more' }, [el('summary', { text: t('impl.more') })]);
    if (wasOpen) box.open = true;
    top.appendChild(box);
    box.appendChild(el('p', { class: 'lv-sub', text: t('impl.detail.sub') }));
    if (usable(L)) {
      var lr = rowsOf(L, ['sonnet-next', 'haiku-next', 'opus-direct']);
      box.appendChild(el('h3', { class: 'bk-h3', text: t('impl.large.h')(L.n) }));
      box.appendChild(el('p', { class: 'lv-sub', text: t('impl.large.sub') }));
      box.appendChild(implTable(L, lr.list));
      var ls = lr.by['sonnet-next'], lb = lr.by['opus-direct'], lh = lr.by['haiku-next'];
      if (ls && lb) {
        var lo = { n: L.n, sOk: ls.ok, bOk: lb.ok, pct: Math.round(ls.usd / lb.usd * 100), hOk: lh ? lh.ok : null, hPass: lh && L.tests && L.tests['haiku-next'] ? L.tests['haiku-next'].pass : null };
        box.appendChild(el('p', { class: 'bk-cmp', text: t('impl.large.take')(lo) }));
      }
    }
    if (usable(S)) {
      var sr = rowsOf(S, ['sonnet-spec', 'sonnet-high', 'opus-direct']);
      var extra = S.spec ? { 'sonnet-spec': S.spec.usd } : null;
      box.appendChild(el('h3', { class: 'bk-h3', text: t('impl.spec.h')(S.n) }));
      box.appendChild(el('p', { class: 'lv-sub', text: t('impl.spec.sub') }));
      box.appendChild(implTable(S, sr.list, extra));
      var ss = sr.by['sonnet-spec'], so = sr.by['sonnet-high'], sb = sr.by['opus-direct'];
      if (S.spec && ss) box.appendChild(el('p', { class: 'bk-cmp', text: t('impl.spec.cost')(usd(S.spec.usd), usd(ss.usd)) }));
      if (ss && so && sb) box.appendChild(el('p', { class: 'bk-cmp', text: t('impl.spec.take')({ n: S.n, bOk: sb.ok, oldOk: so.ok, newOk: ss.ok }) }));
    }
    box.appendChild(el('p', { class: 'bk-cmp bk-noise', text: t('impl.limit') }));
  }

  function renderLegend() {
    var box = $('legend'); box.textContent = '';
    ['ok', 'partial', 'fail'].forEach(function (v) {
      box.appendChild(el('span', { class: 'lg' }, [el('i', { class: 'g ' + v, 'aria-hidden': 'true', text: GLYPH[v] }), el('span', { text: t('lg.' + v) })]));
    });
  }

  /* ---------- the cards ---------- */
  function lane(side, c, run, opts) {
    var up = opts.mode === 'up';
    var f = { side: side, run: run };
    f.fill = el('i', { class: 'fill' });
    f.amt = el('span', { class: 'amt', text: usd(0) });
    f.time = el('span', { class: 'time', text: secs(0) });
    f.stamp = el('div', { class: 'stamp ' + run.verdict }, [el('i', { class: 'g ' + run.verdict, 'aria-hidden': 'true', text: GLYPH[run.verdict] }), el('span', { text: t('v.' + run.verdict) })]);
    var meta = [f.time, el('span', { class: 'calls', text: t('calls')(run.toolCalls) })];
    var chips, head, sub;
    if (side === 'a') {
      head = up ? t('lane.a.up') : t('lane.a');
      sub = up ? t('cond.' + run.condition) : t('lane.a.sub');
      chips = el('div', { class: 'chips' }, [el('span', { class: 'chip lit ' + (up ? condObj(run.condition).model : 'opus'), text: up ? t('cond.' + run.condition) : 'Opus high' })]);
    } else if (up) {
      /* the raise: same model, higher effort. Nothing is tried and dropped; the rule picks the effort up front */
      head = t('lane.b'); sub = opts.pickText;
      f.cls = { from: 'chip ' + condObj(opts.from.condition).model, pick: 'chip pickc ' + condObj(run.condition).model };
      f.chips = {
        from: el('span', { class: f.cls.from }, [el('b', { text: t('cond.' + opts.from.condition) }), el('em')]),
        pick: el('span', { class: f.cls.pick }, [el('b', { text: t('cond.' + run.condition) }), el('em', { text: t('up.tag') })])
      };
      chips = el('div', { class: 'chips' }, [el('span', { class: 'sp', text: 'sprag' }), f.chips.from, f.chips.pick]);
      if (RANK[run.verdict] > RANK[opts.from.verdict]) { f.save = el('span', { class: 'save q', text: t('up.badge')(t('v.' + run.verdict)) }); meta.push(f.save); }
    } else {
      head = t('lane.b'); sub = opts.pickText;
      f.chips = {};
      chips = el('div', { class: 'chips' }, [el('span', { class: 'sp', text: 'sprag' })].concat(MODELS.map(function (m) {
        var label = m === opts.pick.model ? t('cond.' + opts.pick.id) : m === 'haiku' && opts.haiku ? t('cond.haiku-low') : cap(m);
        var ch = el('span', { class: 'chip ' + m }, [el('b', { text: label }), el('em')]);
        f.chips[m] = ch;
        return ch;
      })));
      var pct = pctSaved(run, opts.base);
      f.save = el('span', { class: 'save' + (pct < 0 ? ' neg' : ''), text: pct >= 0 ? t('save')(pct) : t('more')(-pct) });
      meta.push(f.save);
    }
    f.node = el('div', { class: 'lane ' + side + (up ? ' up' : '') + ' v-' + run.verdict }, [
      el('div', { class: 'l-h' }, [el('b', { text: head }), el('span', { text: sub })]),
      chips,
      el('div', { class: 'cbar' }, [f.fill, f.amt]),
      el('div', { class: 'meta' }, meta),
      f.stamp
    ]);
    return f;
  }

  /* for a case sprag sent up: the run of the same model one effort step below the pick, if it was run */
  function upFrom(c) {
    if (c.story !== 'quality-up') return null;
    var rec = runOf(c, c.recommended);
    if (!rec) return null;
    var lower = c.runs.filter(function (r) {
      return r.prompt === 'original' && r.model === rec.model && r.condition !== rec.condition && EFF3.indexOf(r.effort) >= 0 && EFF3.indexOf(r.effort) < EFF3.indexOf(rec.effort);
    }).sort(function (a, b) { return EFF3.indexOf(b.effort) - EFF3.indexOf(a.effort); });
    return lower[0] || null;
  }

  function caseSummary(c) {
    var rec = runOf(c, c.recommended), base = runOf(c, 'opus-direct'), from = upFrom(c);
    if (from) return t('sum.up')({
      from: { name: t('cond.' + from.condition), verdict: t('vp.' + from.verdict), eff: from.effort, usd: usd(from.usd) },
      to: { name: t('cond.' + rec.condition), verdict: t('vp.' + rec.verdict), eff: rec.effort, usd: usd(rec.usd) },
      up: RANK[rec.verdict] > RANK[from.verdict], repeats: !!(c.repeats && c.repeats.length)
    });
    return summary(c, rec, base, policyRun(c, 'cheapest'));
  }

  function summary(c, rec, base, cheap) {
    var o = { rec: { name: t('cond.' + rec.condition), verdict: t('vp.' + rec.verdict) }, cmp: RANK[rec.verdict] - RANK[base.verdict], pct: pctSaved(rec, base) };
    if (cheap && cheap.condition !== rec.condition && cheap.verdict !== 'ok') o.cheap = { name: t('cond.' + cheap.condition), verdict: t('vp.' + cheap.verdict) };
    return t('sum')(o);
  }

  function card(c) {
    var rec = runOf(c, c.recommended), base = runOf(c, 'opus-direct');
    var from = upFrom(c);
    var pick = condObj(c.recommended);
    var haiku = runOf(c, 'haiku-low');
    var a = from ? lane('a', c, from, { mode: 'up' }) : lane('a', c, base, {});
    var b = from ? lane('b', c, rec, { mode: 'up', from: from, pickText: t('up.pick')(from.effort, rec.effort) })
      : lane('b', c, rec, { pick: pick, haiku: haiku, base: base, pickText: t('pick.' + c.story)(t('cond.' + c.recommended)) });
    var replay = el('button', { type: 'button', class: 'replay', text: t('replay') });
    var sum = el('p', { class: 'sum', text: caseSummary(c) });
    var node = el('article', { class: 'kase s-' + c.story, id: 'case-' + c.id, 'data-case': c.id }, [
      el('header', { class: 'k-h' }, [
        el('div', { class: 'k-t' }, [
          el('b', { text: L(c.title) }), el('span', { class: 'kind ' + c.kind, text: t(c.kind) }),
          el('span', { class: 'rec' + (c.kind === 'research' ? ' exp' : ''), text: recText(c) }),
          el('q', { text: L(c.userPrompt) })
        ]),
        replay
      ]),
      el('div', { class: 'lanes' }, [a.node, b.node]),
      sum,
      el('details', { class: 'more' }, [el('summary', { text: t('d.open') }), renderDetail(c)])
    ]);
    var p = { c: c, node: node, a: a, b: b, sum: sum, timers: [], raf: 0, played: false, mode: from ? 'up' : 'down',
      scale: from ? { usd: Math.max(from.usd, rec.usd) } : base,
      haikuState: from ? null : !haiku ? (c.kind === 'implement' ? 'na' : null) : haiku.condition === c.recommended ? 'pick' : null };
    players[c.id] = p;
    replay.addEventListener('click', function () { play(p, true); });
    return node;
  }

  function renderCases() {
    var box = $('cases'); box.textContent = '';
    players = {};
    if (io) { io.disconnect(); io = null; }
    storiesPresent().forEach(function (s) {
      var list = data.cases.filter(function (c) { return c.story === s; });
      box.appendChild(el('h3', { class: 'grp s-' + s }, [el('span', { text: t('grp.' + s) }), el('em', { text: String(list.length) })]));
      list.forEach(function (c) { box.appendChild(card(c)); });
    });
    $('k-h').textContent = t('k.h')(data.cases.length);
    $('k-sub').textContent = t('k.sub');
    var nRuns = 0;
    data.cases.forEach(function (c) { nRuns += c.runs.length + (c.repeats ? c.repeats.length : 0); });
    var r0 = data.rounds.filter(function (r) { return r.id === 'r0'; })[0] || data.rounds[0];
    $('k-note').textContent = t('k.note')(nRuns, data.rounds.length, r0 ? r0.date : '');

    if (REDUCED || !('IntersectionObserver' in window)) {
      Object.keys(players).forEach(function (id) { finish(players[id]); });
      return;
    }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var p = players[e.target.dataset.case];
        if (p && !p.played) play(p, false);
      });
    }, { threshold: 0.35 });
    Object.keys(players).forEach(function (id) { io.observe(players[id].node); });
  }

  /* ---------- playing a card ---------- */
  function widthOf(run, base) { return Math.max(2, Math.min(100, run.usd / base.usd * 100)); }

  function reset(p) {
    p.timers.forEach(clearTimeout); p.timers = [];
    if (p.raf) cancelAnimationFrame(p.raf); p.raf = 0;
    [p.a, p.b].forEach(function (f) {
      f.node.classList.remove('work', 'done', 'r1', 'r2', 'r3');
      f.fill.style.transition = 'none';
      f.fill.style.width = '0%';
      f.amt.textContent = usd(0);
      f.time.textContent = secs(0);
    });
    if (p.mode === 'up') { p.b.chips.from.className = p.b.cls.from; p.b.chips.pick.className = p.b.cls.pick; }
    else MODELS.forEach(function (m) { p.b.chips[m].className = 'chip ' + m; p.b.chips[m].querySelector('em').textContent = ''; });
    p.node.classList.remove('played');
    void p.a.fill.offsetWidth;
  }

  function setFinal(f, base) {
    f.fill.style.width = widthOf(f.run, base) + '%';
    f.amt.textContent = usd(f.run.usd);
    f.time.textContent = secs(f.run.seconds);
    f.node.classList.add('work', 'done');
  }

  function finish(p) {
    reset(p);
    var base = p.scale;
    setFinal(p.a, base); setFinal(p.b, base);
    chipsFinal(p);
    p.node.classList.add('played');
    p.played = true;
  }

  function chipsFinal(p) {
    if (p.mode === 'up') { p.b.chips.pick.classList.add('lit'); p.b.node.classList.add('r3'); return; }
    if (p.haikuState === 'na') {
      p.b.chips.haiku.classList.add('na');
      p.b.chips.haiku.querySelector('em').textContent = t('chip.na');
    }
    p.b.chips[condObj(p.c.recommended).model].classList.add('lit');
    p.b.node.classList.add('r3');
  }

  function play(p, force) {
    if (p.played && !force) return;
    p.played = true;
    reset(p);
    var base = p.scale;
    var T = Math.max(p.a.run.seconds, p.b.run.seconds) || 1;
    var Da = DUR * p.a.run.seconds / T, Db = DUR * p.b.run.seconds / T;
    var startB = ROUTE[3];
    var t0 = performance.now();

    function startLane(f, D) {
      f.node.classList.add('work');
      f.fill.style.transition = 'width ' + Math.round(D) + 'ms linear';
      f.fill.style.width = widthOf(f.run, base) + '%';
    }
    startLane(p.a, Da);
    /* the sprag lane first shows the pick being made */
    p.b.node.classList.add('r1');
    if (p.mode === 'up') {
      p.timers.push(setTimeout(function () { p.b.node.classList.add('r2'); }, ROUTE[0]));
      p.timers.push(setTimeout(function () { p.b.chips.pick.classList.add('lit'); p.b.node.classList.add('r3'); }, ROUTE[2]));
    } else {
      p.timers.push(setTimeout(function () { p.b.node.classList.add('r2'); p.b.chips.haiku.classList.add('look'); }, ROUTE[0]));
      p.timers.push(setTimeout(function () {
        p.b.chips.haiku.classList.remove('look');
        if (p.haikuState === 'pick') p.b.chips.haiku.classList.add('lit');
        else if (p.haikuState === 'na') { p.b.chips.haiku.classList.add('na'); p.b.chips.haiku.querySelector('em').textContent = t('chip.na'); }
      }, ROUTE[1]));
      p.timers.push(setTimeout(function () { p.b.chips[condObj(p.c.recommended).model].classList.add('lit'); p.b.node.classList.add('r3'); }, ROUTE[2]));
    }
    p.timers.push(setTimeout(function () { startLane(p.b, Db); }, startB));
    p.timers.push(setTimeout(function () { p.a.node.classList.add('done'); }, Da));
    p.timers.push(setTimeout(function () { p.b.node.classList.add('done'); }, startB + Db));
    p.timers.push(setTimeout(function () { p.node.classList.add('played'); }, Math.max(Da, startB + Db) + 150));

    function tick(now) {
      var e = now - t0, live = false;
      [{ f: p.a, s: 0, D: Da }, { f: p.b, s: startB, D: Db }].forEach(function (x) {
        var k = Math.min(1, Math.max(0, (e - x.s) / Math.max(1, x.D)));
        if (e >= x.s) { x.f.amt.textContent = usd(x.f.run.usd * k); x.f.time.textContent = secs(x.f.run.seconds * k); }
        if (k < 1) live = true;
      });
      if (live) p.raf = requestAnimationFrame(tick); else p.raf = 0;
    }
    p.raf = requestAnimationFrame(tick);
  }

  /* ---------- one case, the full record ---------- */
  function setupItem(c, cd) {
    var run = runOf(c, cd.id);
    if (!run) return el('li', { class: 'su none' }, [el('span', { class: 'g', 'aria-hidden': 'true', text: '–' }), el('div', { class: 'su-b' }, [el('b', { text: t('cond.' + cd.id) }), el('p', { class: 'nr', text: t(notRunKey(c)) })])]);
    var isRec = cd.id === c.recommended, isBase = run.role === 'baseline';
    var pct = Math.abs(Math.round(run.savingsPct));
    var costText = usd(run.usd) + ', ' + (isBase ? t('base') : run.usd > c.baseline.usd ? t('pricier')(pct) : t('saved')(pct));
    var head = el('div', { class: 'su-h' }, [
      el('b', { text: t('cond.' + cd.id) }),
      isRec ? el('span', { class: 'rec' + (c.kind === 'research' ? ' exp' : ''), text: recText(c) }) : null,
      el('span', { class: 'vl ' + run.verdict, text: t('v.' + run.verdict) }),
      el('span', { class: 'cost', text: costText })
    ]);
    var miss = korStr(el('p', { class: 'miss' + (run.keyMiss ? '' : ' none') }, [el('small', { text: t('d.miss') }), document.createTextNode(' ' + (run.keyMiss || t('d.missNone')))]), run.keyMiss);
    var rep = el('details', { class: 'rep' }, [
      el('summary', { text: t('d.report')(run.score, run.max, tokens(run.tokens), run.toolCalls, secs(run.seconds)) }),
      korStr(el('pre', { text: run.excerpt }), run.excerpt)
    ]);
    if (run.report && run.report.length > run.excerpt.length) {
      rep.appendChild(el('details', { class: 'full' }, [
        el('summary', { text: t('d.full') }),
        korStr(el('pre', { text: run.report + (run.reportTruncated ? '\n\n' + t('d.trunc') : '') }), run.report)
      ]));
    }
    return el('li', { class: 'su ' + run.verdict + (isRec ? ' is-rec' : ''), 'data-cond': cd.id }, [
      el('span', { class: 'g', 'aria-hidden': 'true', text: GLYPH[run.verdict] }),
      el('div', { class: 'su-b' }, [head, miss, rep])
    ]);
  }

  function repeatsBlock(c) {
    if (!c.repeats || !c.repeats.length) return null;
    var per = 0, found = [];
    var grid = el('div', { class: 'rp-grid' });
    EFF3.forEach(function (e) {
      var rs = c.repeats.filter(function (r) { return r.effort === e; });
      if (!rs.length) return;
      per = Math.max(per, rs.length);
      var dots = el('span', { class: 'rp-dots' });
      rs.forEach(function (r) {
        var label = t('rp.run')(r.rep) + ': ' + t('v.' + r.verdict) + ', ' + r.total + '/' + r.max + (r.blockedPartial ? ', ' + t('rp.blocked') : '');
        dots.appendChild(el('i', { class: 'g ' + r.verdict + (r.blockedPartial ? ' blk' : ''), title: label, 'aria-label': label, text: GLYPH[r.verdict] }));
      });
      if (rs.some(function (r) { return typeof r.foundKey === 'boolean'; })) {
        found.push({ effort: e, n: rs.filter(function (r) { return r.foundKey; }).length, of: rs.length });
      }
      grid.appendChild(el('div', { class: 'rp-col' }, [
        el('b', { text: e }), dots,
        el('small', { text: t('rp.avg')(usd(mean(rs.map(function (r) { return r.usd; }))), secs(Math.round(mean(rs.map(function (r) { return r.seconds; }))))) })
      ]));
    });
    var kids = [el('h4', { text: t('rp.h')(per) }), grid];
    if (found.length) kids.push(el('p', { class: 'rp-found', text: t('rp.found')(found) }));
    return el('div', { class: 'rp' }, kids);
  }

  function renderDetail(c) {
    var box = el('div', { class: 'detail' });
    box.appendChild(el('dl', { class: 'facts' }, [
      el('dt', { text: t('d.task') }), kor(el('dd', { text: L(c.task) }), c.task),
      el('dt', { text: t('d.truth') }), kor(el('dd', { class: 'truth', text: L(c.truth) }), c.truth)
    ]));
    box.appendChild(el('ol', { class: 'setups' }, data.conditions.filter(function (cd) {
      return runOf(c, cd.id) || (c.lanes || []).indexOf(cd.id) >= 0;
    }).map(function (cd) { return setupItem(c, cd); })));
    var rp = repeatsBlock(c);
    if (rp) box.appendChild(rp);
    if (c.screenshot) {
      box.appendChild(el('figure', { class: 'shot' }, [
        el('a', { href: c.screenshot, target: '_blank', rel: 'noopener' }, [el('img', { src: c.screenshot, alt: L(c.title), loading: 'lazy', width: '1440', height: '900' })]),
        el('figcaption', { text: t('d.shot') })
      ]));
    }
    box.appendChild(kor(el('p', { class: 'lesson' }, [el('small', { text: t('d.lesson') }), document.createTextNode(' ' + L(c.lesson))]), c.lesson));
    return box;
  }

  /* ---------- the flow diagram: the same requests, two ways at once ----------
   * Desktop hero. Five stages left to right: the real requests grouped by kind, sprag's call,
   * the run on each setup, the blind grader, the result. Every case sends two dots at the same
   * moment. The hollow amber one is "without sprag": it skips stage 02 and lands on Opus. The
   * filled one is the compared policy (sprag's pick, or cheapest only): it goes through sprag to
   * the setup that policy chose. Each lands in its own result block, so the two totals sit one
   * above the other and can be read side by side. */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LANES = ['haiku-low', 'sonnet-medium', 'sonnet-high', 'sonnet-xhigh', 'opus-direct'];
  var KINDS = ['lookup', 'run', 'review', 'implement', 'research'];
  var DG = {
    W: 1032, H: 400, top: 34, bot: 392, speed: 0.26, stagger: 320,
    stg: { req: [0, 194], route: [234, 384], run: [424, 664], grade: [704, 834], out: [874, 1032] },
    kind: { x: 8, w: 170, h: 40, pitch: 60 }, route: { x: 242, w: 134, h: 104 },
    lane: { x: 432, w: 224, h: 50, pitch: 80 }, grade: { x: 706, w: 126, h: 64 },
    out: { x: 882 }
  };
  var dg = { cmp: 'sprag', raf: 0, timers: [], played: false, io: null, items: {} };

  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function curveTo(x0, y0, x1, y1) { var mx = (x0 + x1) / 2; return ' C' + mx + ',' + y0 + ' ' + mx + ',' + y1 + ' ' + x1 + ',' + y1; }
  function curve(x0, y0, x1, y1) { return 'M' + x0 + ',' + y0 + curveTo(x0, y0, x1, y1); }
  function fitText(node, max) {
    var s = node.textContent;
    while (s.length > 1 && node.getComputedTextLength() > max) { s = s.slice(0, -1); node.textContent = s + '…'; }
  }
  function stageAt(x) {
    var ids = Object.keys(DG.stg);
    for (var i = 0; i < ids.length; i++) { var r = DG.stg[ids[i]]; if (x >= r[0] && x <= r[1]) return ids[i]; }
    return null;
  }

  function dgStop() {
    dg.timers.forEach(clearTimeout); dg.timers = [];
    if (dg.raf) cancelAnimationFrame(dg.raf); dg.raf = 0;
  }

  function renderDiagram() {
    var box = $('diagram'); if (!box) return;
    box.textContent = '';
    dgStop();
    dg.items = {};
    if (dg.io) { dg.io.disconnect(); dg.io = null; }
    var cases = heroCases(), n = cases.length, hasBulk = cases.some(function (c) { return c.bulk; });
    var MID = (DG.top + DG.bot) / 2;
    var opusTotal = cases.reduce(function (s, c) { return s + policyRun(c, 'opus').usd; }, 0);
    var FLOWS = ['a', 'b'];                      /* a: without sprag (Opus itself), b: the compared policy */
    function policyOf(f) { return f === 'a' ? 'opus' : dg.cmp; }

    /* layout */
    var kinds = KINDS.filter(function (k) { return cases.some(function (c) { return c.kind === k; }); });
    var kp = kinds.length > 1 ? Math.min(DG.kind.pitch, (DG.bot - DG.top - 40 - DG.kind.h) / (kinds.length - 1)) : 0;
    var ky0 = MID - ((kinds.length - 1) * kp + DG.kind.h) / 2;
    var K = {};
    kinds.forEach(function (k, i) {
      var list = cases.filter(function (c) { return c.kind === k; });
      K[k] = { kind: k, list: list, x: DG.kind.x, y: ky0 + i * kp, w: DG.kind.w, h: DG.kind.h, cy: ky0 + i * kp + DG.kind.h / 2, sp: Math.min(10, (DG.kind.w - 58) / Math.max(1, Math.min(list.length, QMAX))) };
    });
    /* a lane nobody uses stays out of the layout: the without flow (Opus itself) and every policy count as users */
    var usedLane = {};
    cases.forEach(function (c) { ['opus'].concat(POLICIES).forEach(function (p) { usedLane[policyRun(c, p).condition] = 1; }); });
    var lanes = LANES.filter(function (id) { return condObj(id) && usedLane[id]; });
    /* lanes both flows pass through get a flow tag on each count line */
    var bothFlows = {};
    lanes.forEach(function (id) {
      bothFlows[id] = FLOWS.every(function (f) { return cases.some(function (c) { return policyRun(c, policyOf(f)).condition === id; }); });
    });
    var lp = lanes.length > 1 ? Math.min(DG.lane.pitch, (DG.bot - DG.top - 36 - DG.lane.h) / (lanes.length - 1)) : 0;
    var ly0 = MID - ((lanes.length - 1) * lp + DG.lane.h) / 2;
    var LN = {};
    lanes.forEach(function (id, j) {
      LN[id] = { id: id, model: condObj(id).model, x: DG.lane.x, y: ly0 + j * lp, w: DG.lane.w, h: DG.lane.h, cy: ly0 + j * lp + DG.lane.h / 2 };
    });
    /* two result blocks, one per flow */
    var cols = n <= 10 ? 5 : n <= 40 ? 8 : 14, cell = n <= 10 ? 24 : n <= 40 ? 16 : 8, cs = cell + 2, rows = Math.ceil(n / cols), tiny = cell < 12;
    var outW = cols * cs - 2, blockH = 14 + rows * cs + 18 + 30 + 16, bgap = 12;
    var blocks = FLOWS.map(function (f, k) {
      var y = DG.top + 18 + k * (blockH + bgap), sy = y + 18;
      return { f: f, y: y, labelY: y + 10, stripY: sy, stripMid: sy + rows * cs / 2, countsY: sy + rows * cs + 16, bigY: sy + rows * cs + 44, pctY: sy + rows * cs + 60,
        cells: cases.map(function (c, i) { var x = DG.out.x + (i % cols) * cs, cy = sy + Math.floor(i / cols) * cs; return { c: c, x: x, y: cy, cx: x + cell / 2, cy: cy + cell / 2 }; }) };
    });

    /* the difference block sits under flow b's result block */
    var dY = blocks[1].y + blockH + bgap;
    var sprTotal = 0, handedOpus = 0, handedSpr = 0, handedN = 0;
    cases.forEach(function (c) {
      var a = policyRun(c, 'opus'), b = policyRun(c, dg.cmp);
      sprTotal += b.usd;
      if (b.condition !== 'opus-direct') { handedN++; handedOpus += a.usd; handedSpr += b.usd; }
    });
    var keptN = n - handedN;
    var deltaPct = opusTotal > 0 ? 100 - Math.round(sprTotal / opusTotal * 100) : 0;
    var handedPct = handedOpus > 0 ? 100 - Math.round(handedSpr / handedOpus * 100) : 0;

    /* controls: without sprag is always the top flow, the bottom one is a choice */
    var replay = el('button', { type: 'button', class: 'replay', text: t('replay') });
    replay.addEventListener('click', function () { dg.played = true; if (!REDUCED) dgPlay(); });
    box.appendChild(el('div', { class: 'dg-head' }, [
      el('span', { text: t('dg.head')(n) }),
      el('div', { class: 'dg-ctl' }, [el('span', { class: 'fa-chip', text: t('pol.opus') }), el('span', { class: 'vs', text: t('dg.vs') }), el('span', { class: 'fb-chip', text: t('pol.sprag') }), replay])
    ]));

    var svg = sv('svg', { class: 'dg c-' + dg.cmp + (tiny ? ' tiny' : ''), viewBox: '0 0 ' + DG.W + ' ' + DG.H, role: 'group', 'aria-label': t('dg.aria')(n) });
    var gl = sv('g', { class: 'links' }), gPaths = sv('g', { class: 'paths', style: 'fill:none;stroke:none' }), gDots = sv('g', { class: 'dots' });
    var meas = sv('path'); gPaths.appendChild(meas);
    svg.appendChild(gl);
    var tip = el('div', { class: 'dg-tip', role: 'tooltip' });
    var wrap = el('div', { class: 'dg-wrap' }, [svg, tip]);
    box.appendChild(wrap);
    var legend = el('div', { class: 'dg-legend' });
    ['ok', 'partial', 'fail'].forEach(function (v) {
      legend.appendChild(el('span', { class: 'lg' }, [el('i', { class: 'g ' + v, 'aria-hidden': 'true', text: GLYPH[v] }), el('span', { text: t('lg.' + v) })]));
    });
    box.appendChild(legend);

    /* stages */
    var stages = {};
    Object.keys(DG.stg).forEach(function (id, i) {
      var r = DG.stg[id];
      var g = sv('g', { class: 'stg stg-' + id }, [
        sv('rect', { class: 'stg-box', x: r[0] + 0.5, y: DG.top + 0.5, width: r[1] - r[0] - 1, height: DG.bot - DG.top - 1, rx: 10 }),
        sv('text', { class: 'stg-h', x: r[0] + 10, y: 20 }, [sv('tspan', { class: 'num', text: '0' + (i + 1) }), sv('tspan', { dx: 8, text: id === 'req' ? t('dg.s.req')(n) : t('dg.s.' + id) })])
      ]);
      stages[id] = g; svg.appendChild(g);
    });
    svg.appendChild(gPaths); svg.appendChild(gDots);

    /* tooltip */
    function showTip(target, html) {
      tip.textContent = '';
      html.forEach(function (x) { tip.appendChild(x); });
      var r = target.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      var left = r.right - w.left + 8, top = r.top - w.top + r.height / 2;
      var flip = left + 290 > w.width;
      tip.classList.toggle('left', flip);
      if (flip) left = r.left - w.left - 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      tip.classList.add('show');
    }
    function hideTip() { tip.classList.remove('show'); }
    function tipOn(node, build) {
      node.addEventListener('mouseenter', function () { showTip(node, build()); });
      node.addEventListener('mouseleave', hideTip);
      node.addEventListener('focus', function () { showTip(node, build()); });
      node.addEventListener('blur', hideTip);
    }

    /* stage 01: the requests, grouped by kind, each case a waiting dot */
    var qdot = {};
    kinds.forEach(function (k) {
      var o = K[k];
      var g = sv('g', { class: 'nd kind ' + k }, [
        sv('rect', { x: o.x, y: o.y, width: o.w, height: o.h, rx: 7 }),
        sv('text', { class: 'nm', x: o.x + 12, y: o.y + 17 }, [sv('tspan', { class: 'kd', text: t(k) }), sv('tspan', { class: 'sub', dx: 6, text: t('dg.n')(o.list.length) })])
      ]);
      o.list.forEach(function (c, i) { qdot[c.id] = sv('circle', { class: 'q', cx: o.x + 14 + Math.min(i, QMAX - 1) * o.sp, cy: o.y + 30, r: 3.5 }); if (i < QMAX) g.appendChild(qdot[c.id]); });
      if (o.list.length > QMAX) g.appendChild(sv('text', { class: 'sub qmore', x: o.x + 14 + QMAX * o.sp + 2, y: o.y + 34, text: '+' + (o.list.length - QMAX) }));
      tipOn(g, function () {
        var out = [el('b', { text: t(k) + ' ' + t('dg.n')(o.list.length) })];
        var full = o.list.filter(function (c) { return !c.bulk; }), nb = o.list.length - full.length;
        full.slice(0, 6).forEach(function (c) { out.push(el('div', { text: L(c.title) })); });
        if (full.length > 6) out.push(el('small', { text: t('dg.more')(full.length - 6) }));
        if (nb) out.push(el('small', { text: t('bulk.title') + ' ' + t('dg.n')(nb) }));
        return out;
      });
      stages.req.appendChild(g);
    });

    /* stage 02: sprag's call */
    var rx = DG.route.x, ry = MID - DG.route.h / 2;
    var routeNode = sv('g', { class: 'nd route' }, [
      sv('rect', { x: rx, y: ry, width: DG.route.w, height: DG.route.h, rx: 8 }),
      sv('text', { class: 'nm', x: rx + 12, y: ry + 22, text: 'sprag' })
    ].concat(t('dg.rules').map(function (s, i) {
      return sv('text', { class: 'rule', x: rx + 12, y: ry + 42 + i * 15 }, [sv('tspan', { class: 'tick', text: '✓' }), sv('tspan', { dx: 5, text: s })]);
    })));
    stages.route.appendChild(routeNode);

    /* stage 03: one lane per setup, with a count line per flow that used it */
    var laneSub = {}, laneNode = {};
    lanes.forEach(function (id) {
      var l = LN[id];
      var subs = FLOWS.map(function (f) { return sv('text', { class: 'sub f' + f, x: l.x + 12, y: l.y + 31 }, [sv('tspan', { class: 'mk', text: '●' }), sv('tspan', { dx: 5, text: '' })]); });
      var g = sv('g', { class: 'nd lane ' + l.model }, [
        sv('rect', { x: l.x, y: l.y, width: l.w, height: l.h, rx: 7 }),
        sv('circle', { class: 'mk', cx: l.x + l.w - 16, cy: l.y + l.h / 2, r: 4 }),
        sv('text', { class: 'nm', x: l.x + 12, y: l.y + 18, text: t('cond.' + id) })
      ].concat(subs));
      laneSub[id] = subs; laneNode[id] = g;
      tipOn(g, function () {
        var out = [el('b', { text: t('cond.' + id) })];
        FLOWS.forEach(function (f) {
          var its = getItems(f).filter(function (it) { return it.run.condition === id; });
          if (!its.length) return;
          var u = its.reduce(function (s, it) { return s + it.run.usd; }, 0);
          out.push(el('div', { class: 'f' + f, text: t('pol.' + policyOf(f)) + ': ' + t('dg.lane')(its.length, usd(u)) }));
        });
        if (out.length === 1) out.push(el('div', { text: t('dg.lane')(0, usd(0)) }));
        return out;
      });
      stages.run.appendChild(g);
    });

    /* stage 04: the grader, with a graded count per flow */
    var gx = DG.grade.x, gy = MID - DG.grade.h / 2;
    var gradeNode = sv('g', { class: 'nd grade' }, [
      sv('rect', { x: gx, y: gy, width: DG.grade.w, height: DG.grade.h, rx: 8 }),
      sv('text', { class: 'nm', x: gx + 12, y: gy + 22, text: t('dg.grader') })
    ].concat(t('dg.grader.sub').map(function (s, i) { return sv('text', { class: 'sub', x: gx + 12, y: gy + 40 + i * 14, text: s }); })));
    var gradeCnt = {};
    FLOWS.forEach(function (f, k) {
      gradeCnt[f] = sv('text', { class: 'sub gc f' + f, x: gx + DG.grade.w / 2, y: gy + DG.grade.h + 20 + k * 15, 'text-anchor': 'middle' }, [sv('tspan', { class: 'mk', text: '●' }), sv('tspan', { dx: 5, text: '' })]);
    });
    stages.grade.appendChild(gradeNode);
    FLOWS.forEach(function (f) { stages.grade.appendChild(gradeCnt[f]); });

    /* stage 05: a result block per flow: label, strip, tally, total */
    var cellEl = { a: {}, b: {} }, bigT = {}, pctT = {}, cntN = { a: {}, b: {} }, blockLabel = {};
    blocks.forEach(function (bk) {
      var f = bk.f;
      var g = sv('g', { class: 'blk f' + f });
      blockLabel[f] = sv('text', { class: 'blk-l', x: DG.out.x, y: bk.labelY }, [sv('tspan', { class: 'mk', text: '●' }), sv('tspan', { dx: 5, text: '' })]);
      g.appendChild(blockLabel[f]);
      bk.cells.forEach(function (ce) {
        var kids = [
          sv('rect', { x: ce.x, y: ce.y, width: cell, height: cell, rx: cell > 20 ? 5 : cell > 10 ? 4 : 2 }),
          sv('text', { x: ce.cx, y: ce.cy + 1, 'dominant-baseline': 'middle', text: '·' })
        ];
        var a = ce.c.bulk ? sv('g', { class: 'cell bulk', tabindex: '0' }, kids) : sv('a', { class: 'cell', href: '#case-' + ce.c.id }, kids);
        if (!ce.c.bulk) a.addEventListener('click', function (e) {
          if (location.hash === '#case-' + ce.c.id) { e.preventDefault(); goTo({ id: ce.c.id, cond: null }); }
        });
        tipOn(a, function () {
          var run = policyRun(ce.c, policyOf(f));
          var line = el('div', { class: 'f' + f, text: t('pol.' + policyOf(f)) + ': ' + t('cond.' + run.condition) + ', ' + (run.ref ? t('bulk.key') : t('v.' + run.verdict)) + ', ' + usd(run.usd) });
          if (ce.c.bulk) return [el('b', { text: caseTitle(ce.c) }), line, el('small', { text: t('bulk.tipsum') })];
          return [el('b', { text: caseTitle(ce.c) }), line, el('div', { text: caseSummary(ce.c) }), el('small', { text: t('dg.tip.click') })];
        });
        cellEl[f][ce.c.id] = a; g.appendChild(a);
      });
      var counts = sv('text', { class: 'cnt', x: DG.out.x, y: bk.countsY });
      ['ok', 'partial', 'fail'].forEach(function (v, i) {
        counts.appendChild(sv('tspan', { class: 'g ' + v, dx: i ? 12 : 0, text: GLYPH[v] }));
        cntN[f][v] = sv('tspan', { class: 'n', dx: 4, text: '0' });
        counts.appendChild(cntN[f][v]);
      });
      g.appendChild(counts);
      bigT[f] = sv('text', { class: 'big', x: DG.out.x, y: bk.bigY, text: usd(0) });
      pctT[f] = sv('text', { class: 'pct', x: DG.out.x, y: bk.pctY, text: '' });
      g.appendChild(bigT[f]); g.appendChild(pctT[f]);
      stages.out.appendChild(g);
    });

    /* the difference: shown only once every dot of flow b has arrived. The amount is taken from the two rounded totals shown above it, so the reader's own subtraction matches */
    var deltaG = sv('g', { class: 'delta', style: 'display:none' }, [
      sv('text', { class: 'dl-h', x: DG.out.x, y: dY + 12, text: t('dg.delta.h') }),
      /* the big figure is the one the page leads with: the jobs handed off. The line under it ties back to the two totals above */
      sv('text', { class: 'dl-big', x: DG.out.x, y: dY + 38, text: '−' + (handedN ? handedPct : deltaPct) + '%' }),
      sv('text', { class: 'dl-sub dl-handed', x: DG.out.x, y: dY + 55, text: handedN ? t('dg.delta.handed')(handedN) : '' }),
      sv('text', { class: 'dl-sub', x: DG.out.x, y: dY + 70, text: t('dg.delta.all')(n, deltaPct, usd(Math.round(opusTotal * 100) / 100 - Math.round(sprTotal * 100) / 100)) })
    ]);
    stages.out.appendChild(deltaG);

    /* links, drawn once, lit and coloured per flow */
    var links = [];
    function link(d, cls, key) { var p = sv('path', { class: 'lnk ' + cls, d: d, 'data-key': key }); links.push(p); gl.appendChild(p); }
    kinds.forEach(function (k) {
      var o = K[k];
      link(curve(o.x + o.w, o.cy, DG.route.x, MID), 'b', 'k2r');
      if (LN['opus-direct']) link(curve(o.x + o.w, o.cy, DG.lane.x, LN['opus-direct'].cy), 'a', 'k2o');
    });
    lanes.forEach(function (id) {
      var l = LN[id];
      link(curve(DG.route.x + DG.route.w, MID, l.x, l.cy), 'b', 'r2l:' + id);
      link(curve(l.x + l.w, l.cy, DG.grade.x, MID), '', 'l2g:' + id);
    });
    blocks.forEach(function (bk) { link(curve(DG.grade.x + DG.grade.w, MID, DG.out.x, bk.stripMid), bk.f, 'g2o:' + bk.f); });

    /* two dots per case */
    var dots = { a: {}, b: {} };
    cases.forEach(function (c) {
      FLOWS.forEach(function (f) {
        var d = sv('g', { class: 'dot f' + f, style: 'display:none' }, [sv('circle', { class: 'halo', r: 7.5 }), sv('circle', { class: 'core', r: 4.5 })]);
        dots[f][c.id] = d; gDots.appendChild(d);
      });
    });

    /* text that must fit its box, now that the svg is in the document */
    svg.querySelectorAll('.lane .nm').forEach(function (tx) { fitText(tx, DG.lane.w - 40); });
    svg.querySelectorAll('.kind .nm').forEach(function (tx) { fitText(tx, DG.kind.w - 20); });
    svg.querySelectorAll('.grade .sub').forEach(function (tx) { fitText(tx, DG.grade.w - 20); });
    svg.querySelectorAll('.delta text').forEach(function (tx) { fitText(tx, DG.W - DG.out.x - 4); });

    function measure(parts) { meas.setAttribute('d', parts.join('')); return meas.getTotalLength(); }
    function getItems(f) {
      var p = policyOf(f), bk = blocks[f === 'a' ? 0 : 1];
      if (dg.items[p] && dg.items[p].ok) return dg.items[p].list;
      var ok = true;
      var list = cases.map(function (c, i) {
        var run = policyRun(c, p), k = K[c.kind], qi = k.list.indexOf(c), lane = LN[run.condition], ce = bk.cells[i];
        var parts = ['M' + (k.x + 14 + Math.min(qi, QMAX - 1) * k.sp) + ',' + (k.y + 30) + ' L' + (k.x + k.w) + ',' + k.cy];
        var at = { route: 0 };
        if (f === 'b') {
          parts.push(curveTo(k.x + k.w, k.cy, DG.route.x, MID)); at.route = measure(parts);
          parts.push(' L' + (DG.route.x + DG.route.w) + ',' + MID, curveTo(DG.route.x + DG.route.w, MID, lane.x, lane.cy));
        } else parts.push(curveTo(k.x + k.w, k.cy, lane.x, lane.cy));
        at.lane = measure(parts);
        parts.push(' L' + (lane.x + lane.w) + ',' + lane.cy, curveTo(lane.x + lane.w, lane.cy, DG.grade.x, MID));
        at.grade = measure(parts);
        parts.push(' L' + (DG.grade.x + DG.grade.w) + ',' + MID, curveTo(DG.grade.x + DG.grade.w, MID, ce.cx, ce.cy));
        var len = measure(parts);
        if (!(len > 0)) ok = false;
        var path = sv('path', { d: parts.join('') }); gPaths.appendChild(path);
        return { c: c, f: f, run: run, lane: lane, cell: ce, path: path, len: len, at: { route: at.route / len, lane: at.lane / len, grade: at.grade / len }, dot: dots[f][c.id] };
      });
      dg.items[p] = { ok: ok, list: list };
      return list;
    }

    function setCmp() {
      var p = dg.cmp;
      var used = { a: {}, b: {} };
      FLOWS.forEach(function (f) { cases.forEach(function (c) { used[f][policyRun(c, policyOf(f)).condition] = 1; }); });
      links.forEach(function (l) {
        var k = l.getAttribute('data-key'), on = true;
        if (k.indexOf('r2l:') === 0) on = !!used.b[k.slice(4)];
        else if (k.indexOf('l2g:') === 0) {
          var id = k.slice(4); on = !!(used.a[id] || used.b[id]);
          l.classList.toggle('a', !!used.a[id] && !used.b[id]); l.classList.toggle('b', !!used.b[id]);
        }
        l.classList.toggle('on', on);
      });
      Object.keys(stages).forEach(function (id) { stages[id].classList.remove('on'); });
      FLOWS.forEach(function (f) {
        blockLabel[f].lastChild.textContent = t('pol.' + policyOf(f));
        cases.forEach(function (c) { var a = cellEl[f][c.id]; a.setAttribute('class', 'cell' + (c.bulk ? ' bulk' : '')); a.querySelector('text').textContent = '·'; });
        bigT[f].textContent = usd(0); pctT[f].textContent = '';
        ['ok', 'partial', 'fail'].forEach(function (v) { cntN[f][v].textContent = '0'; });
        gradeCnt[f].style.display = 'none';
        getItems(f).forEach(function (it) { it.dot.setAttribute('class', 'dot f' + f + ' m-' + it.lane.model); it.dot.style.display = 'none'; });
      });
      lanes.forEach(function (id) {
        laneSub[id].forEach(function (s) { s.style.display = 'none'; });
        laneNode[id].classList.remove('hit');
        laneNode[id].classList.toggle('used', !!(used.a[id] || used.b[id]));
      });
      cases.forEach(function (c) { qdot[c.id].style.opacity = ''; qdot[c.id].setAttribute('class', 'q'); });
      deltaG.style.display = 'none';
    }

    function paint(prog) {
      /* prog(it) -> 0..1 travelled; every number on the right follows the dots */
      var inside = {}, laneN = { a: {}, b: {} }, laneU = { a: {}, b: {} }, bDone = false;
      FLOWS.forEach(function (f) {
        var items = getItems(f), total = 0, cnt = { ok: 0, partial: 0, fail: 0 }, graded = 0;
        items.forEach(function (it) {
          var k = prog(it);
          if (f === 'b') {
            var q = qdot[it.c.id];
            if (k >= 1) { q.style.opacity = ''; q.setAttribute('class', 'q m-' + it.lane.model); }
            else { q.style.opacity = k >= 0 ? 0 : ''; q.setAttribute('class', 'q'); }
          }
          if (k >= it.at.lane) {
            total += it.run.usd * Math.min(1, (k - it.at.lane) / 0.08);
            laneN[f][it.lane.id] = (laneN[f][it.lane.id] || 0) + 1; laneU[f][it.lane.id] = (laneU[f][it.lane.id] || 0) + it.run.usd;
          }
          if (k >= it.at.grade) graded++;
          if (k >= 1) cnt[it.run.verdict]++;
          else if (k > 0) { var s = stageAt(it.path.getPointAtLength(k * it.len).x); if (s) inside[s] = 1; }
        });
        bigT[f].textContent = usd(total);
        pctT[f].textContent = f === 'a' ? t('dg.base') : (total > 0 ? t('dg.split')(handedN, keptN) : '');
        fitText(pctT[f], DG.W - DG.out.x - 4);
        ['ok', 'partial', 'fail'].forEach(function (v) { cntN[f][v].textContent = String(cnt[v]); });
        gradeCnt[f].style.display = graded ? '' : 'none';
        gradeCnt[f].lastChild.textContent = t('dg.graded')(graded, items.length);
        if (f === 'b') bDone = items.every(function (it) { return prog(it) >= 1; });
      });
      deltaG.style.display = bDone ? '' : 'none';
      lanes.forEach(function (id) {
        var row = 0;
        FLOWS.forEach(function (f, k) {
          var s = laneSub[id][k];
          if (!laneN[f][id]) { s.style.display = 'none'; return; }
          s.style.display = ''; s.setAttribute('y', LN[id].y + 31 + row * 12); row++;
          s.lastChild.textContent = (bothFlows[id] ? t('dg.fl')[f] + ' ' : '') + t('dg.lane')(laneN[f][id], usd(laneU[f][id]));
          fitText(s.lastChild, LN[id].w - 56);
        });
      });
      Object.keys(stages).forEach(function (id) { stages[id].classList.toggle('on', !!inside[id]); });
    }
    function land(it) {
      var a = cellEl[it.f][it.c.id];
      a.setAttribute('class', 'cell in ' + it.run.verdict + (it.c.bulk ? ' bulk' : '') + (it.f === 'b' && it.run.condition === 'opus-direct' ? ' kept' : ''));
      a.querySelector('text').textContent = glyphOf(it.c, it.run.verdict);
    }
    function pulse(node) {
      node.classList.add('hit');
      dg.timers.push(setTimeout(function () { node.classList.remove('hit'); }, 380));
    }

    function dgFinal() {
      dgStop();
      setCmp();
      FLOWS.forEach(function (f) { getItems(f).forEach(land); });
      paint(function () { return 1; });
    }

    function dgPlay() {
      dgStop();
      setCmp();
      var all = [];
      FLOWS.forEach(function (f) { all = all.concat(getItems(f)); });
      if (!FLOWS.every(function (f) { return dg.items[policyOf(f)].ok; })) { dgFinal(); return; }
      var stagger = Math.min(DG.stagger, 2600 / Math.max(1, n));
      all.forEach(function (it) {
        it.start = cases.indexOf(it.c) * stagger; it.dur = it.len / DG.speed;
        it.hitRoute = false; it.hitLane = false; it.hitGrade = false; it.done = false;
      });
      var t0 = performance.now();
      function progOf(it, e) { return Math.min(1, (e - it.start) / it.dur); }
      function frame(now) {
        var e = now - t0, live = false;
        all.forEach(function (it) {
          var k = progOf(it, e);
          if (k < 0) { live = true; return; }
          if (k >= 1) {
            if (!it.done) { it.done = true; land(it); it.dot.style.display = 'none'; }
            return;
          }
          live = true;
          var pt = it.path.getPointAtLength(k * it.len);
          it.dot.style.display = '';
          it.dot.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ')');
          if (!it.hitRoute && it.at.route && k >= it.at.route) { it.hitRoute = true; pulse(routeNode); }
          if (!it.hitLane && k >= it.at.lane) { it.hitLane = true; pulse(laneNode[it.lane.id]); }
          if (!it.hitGrade && k >= it.at.grade) { it.hitGrade = true; pulse(gradeNode); }
        });
        paint(function (it) { return progOf(it, e); });
        if (live) dg.raf = requestAnimationFrame(frame); else dg.raf = 0;
      }
      dg.raf = requestAnimationFrame(frame);
    }

    if (REDUCED || !('IntersectionObserver' in window)) { dg.played = true; dgFinal(); return; }
    if (dg.played) { dgFinal(); return; }
    setCmp();
    dg.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || dg.played) return;
        dg.played = true;
        dg.io.disconnect(); dg.io = null;
        dgPlay();
      });
    }, { threshold: 0.3 });
    dg.io.observe(box);
  }

  /* ---------- hash, method, language ---------- */
  function parseHash() {
    var m = /^#case-([^/]+)(?:\/(.+))?$/.exec(location.hash || '');
    return m ? { id: m[1], cond: m[2] || null } : null;
  }
  function goTo(h) {
    var p = players[h.id];
    if (!p) return;
    p.node.scrollIntoView({ behavior: 'instant', block: 'start' });
    if (h.cond && condObj(h.cond)) {
      var det = p.node.querySelector('details.more'); if (det) det.open = true;
      var li = p.node.querySelector('.su[data-cond="' + h.cond + '"]'); if (li) li.classList.add('hl');
    }
    if (!REDUCED) play(p, true);
  }

  function renderMethod() {
    var r0 = data.rounds.filter(function (r) { return r.id === 'r0'; })[0] || data.rounds[0];
    var has = function (id) { return data.rounds.some(function (r) { return r.id === id; }); };
    var ul = $('method-list'); ul.textContent = '';
    t('mlist')(r0 ? r0.date : '', data.cases.length, { r2: has('r2'), r1: has('r1') }).forEach(function (s) { ul.appendChild(el('li', { text: s })); });
  }

  function renderAll() {
    renderStatic();
    renderHero();
    renderDiagram();
    renderLive();
    renderBulk();
    renderUp();
    renderImpl();
    renderLegend();
    renderCases();
    renderMethod();
  }

  function setLang(next, remember) {
    lang = next === 'ko' ? 'ko' : 'en';
    if (remember) { try { localStorage.setItem('sprag.lang', lang); } catch (e) { /* private mode */ } }
    if (data) renderAll(); else renderStatic();
  }

  function initLang() {
    var q = new URLSearchParams(location.search).get('lang');
    var stored = null; try { stored = localStorage.getItem('sprag.lang'); } catch (e) { /* private mode */ }
    var nav = (navigator.languages || [navigator.language || 'en']).join(',');
    lang = (q || stored || (/\bko\b|ko-/i.test(nav) ? 'ko' : 'en')) === 'ko' ? 'ko' : 'en';
  }

  initLang();
  renderStatic();
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.dataset.lang, true); });
  });

  /* a caption above every table that scrolls sideways on phones (the CSS shows it at 720px and below) */
  function addHints() {
    document.querySelectorAll('table.bk').forEach(function (tb) {
      var p = tb.previousElementSibling;
      if (p && p.classList.contains('scroll-hint')) return;
      tb.parentNode.insertBefore(el('p', { class: 'scroll-hint', 'data-k': 'scroll.hint', text: t('scroll.hint') }), tb);
    });
  }
  /* install command copy in the closing block: no clipboard or a refused write changes nothing */
  (function () {
    var btn = document.querySelector('[data-copy="proof-install-command"]'), timer = 0;
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cmd = $('proof-install-command'), label = btn.querySelector('[data-k="cta.copy"]') || btn;
      try {
        if (!cmd || !navigator.clipboard || !navigator.clipboard.writeText) return;
        navigator.clipboard.writeText(cmd.textContent.trim()).then(function () {
          label.textContent = t('cta.copied');
          clearTimeout(timer);
          timer = setTimeout(function () { label.textContent = t('cta.copy'); }, 1500);
        }, function () { /* refused: leave the label alone */ });
      } catch (e) { /* no clipboard in this context */ }
    });
  })();
  new MutationObserver(addHints).observe(document.body, { childList: true, subtree: true });
  /* the headline and tiles load on their own, so they do not wait for the 480 KB data.json */
  fetch('banner.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (b) {
    banner = b;
    renderBanner();
  }).catch(function () { /* the default headline stays */ });
  fetch('data.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    renderAll();
    var h = parseHash();
    if (h && caseById(h.id)) goTo(h);
    window.addEventListener('hashchange', function () {
      var p = parseHash();
      if (p && caseById(p.id)) goTo(p);
    });
  }).catch(function () {
    var n = $('policies'); if (n) n.textContent = t('loadFail');
  });
})();
