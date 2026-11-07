/* Proof page: reads data.json and draws the cases, the delegation flow and the result card.
 * Every number on the page is computed here from data.json. */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MODELS = ['haiku', 'sonnet', 'opus'];
  var EFFORTS = ['low', 'medium', 'high', 'xhigh'];
  var GLYPH = { ok: '○', partial: '△', fail: '✕' };
  var RANK = { fail: 0, partial: 1, ok: 2 };

  var STR = {
    en: {
      'p.eyebrow': 'Proof',
      'p.h1': 'Easy jobs to a cheaper model. Harder ones with more effort.',
      'p.lede': 'We took real jobs that sprag had delegated, ran each one again on Haiku, Sonnet and Opus at different effort levels and had the answers graded blind. Click a case and watch where sprag sends it.',
      'c.h': 'Pick a case',
      'c.sub': 'Each one is a request that was really delegated.',
      'f.req': 'Your request', 'f.main': 'Main session', 'f.router': 'sprag router',
      'f.router.b': 'Picks model and effort', 'f.model': 'Model', 'f.effort': 'Effort', 'f.result': 'Result',
      'e.h': 'Repeats: does more effort hold steady?',
      'e.sub': 'Same case, same Sonnet, several runs per effort level.',
      'm.h': 'Method and limits',
      'nav.how': 'How it works', 'nav.routing': 'Routing', 'nav.features': 'Features', 'nav.docs': 'Docs',
      'nav.proof': 'Proof', 'nav.license': 'License', 'nav.teams': 'Team console',
      title: 'Sprag Proof | Does delegating to a cheaper model hold up?',
      desc: 'Real delegated jobs, re-run on Haiku, Sonnet and Opus at different effort levels and graded blind. Click a case to watch sprag route it and see quality and cost.',
      research: 'Research', lookup: 'Lookup', run: 'Run', implement: 'Implement', review: 'Review',
      'lab.req': 'Your request', 'lab.deleg': 'Delegated task',
      notrun: 'Not run.', 'notrun.impl': 'Not run: current rules never give implementation to Haiku.',
      conds: 'Setup',
      'cond.haiku-low': 'Haiku low', 'cond.sonnet-medium': 'Sonnet medium', 'cond.sonnet-high': 'Sonnet high',
      'cond.opus-direct': 'Opus does it (baseline)', 'cond.sonnet-high-improved': 'Sonnet high + better prompt',
      rec: 'sprag pick', 'rec.exp': 'Best in this test',
      bypass: 'Skipped. Opus does it itself.', routed: 'Delegated',
      'v.ok': 'Can be passed on as is', 'v.partial': 'Needs some fixing', 'v.fail': 'Would have to be asked again',
      cost: 'Cost', tokens: 'Tokens', time: 'Time', calls: 'Tool calls', web: 'Web searches',
      vsBase: 'vs Opus', baseBar: 'Opus', meBar: 'This setup',
      saved: function (p) { return p + '% cheaper than Opus'; },
      pricier: function (p) { return p + '% more than Opus'; },
      isBase: 'Baseline: the main session does the job itself',
      missLabel: 'What it missed (grader note, in Korean)', missNone: 'Nothing important missed.',
      excerptLabel: 'Report', fullBtn: 'Show the full report', fullTrunc: 'Cut at 8,000 characters.',
      shot: 'Screenshot the run took', task: 'The job', truth: 'What was true', lesson: 'What it shows',
      score: 'Score',
      stat1: function (ok, m, p) {
        return 'In ' + (ok === m ? 'all ' + m : ok + ' of ' + m) + ' cost-saving cases a setup cheaper than Opus gave an answer that could be passed on as is. The cheapest such setup cost ' + p + '% of Opus on average.';
      },
      stat2: function (k, m) { return 'Of ' + m + ' cases where quality had to go up, the cheapest setup could not be passed on as is in ' + k + ', and the recommended one could.'; },
      stat3: function (found, title) {
        return 'Repeat runs of "' + title + '", times the key story was found: ' + found.map(function (f) { return f.effort + ' ' + f.n + '/' + f.of; }).join(', ') + '.';
      },
      stat3fb: function (k, m) { return 'Raising Sonnet from medium to high lifted the verdict on ' + k + ' of ' + m + ' cases.'; },
      statsNote: function (m, r, k, d, pending) {
        return m + ' cases, ' + r + ' runs in ' + k + ' rounds, graded blind by Opus. Run on ' + d + '.' + (pending ? ' Repeat runs are still in progress.' : '') + ' See "Method and limits".';
      },
      effPending: 'Repeat runs are in progress. Each case is run several times per effort level to see whether the verdict wobbles. Once graded, one mark per run appears here.',
      effCase: 'Case', runN: function (n) { return 'run ' + n; },
      'rp.legend': 'Dot color: whether the answer could be passed on (green yes, amber partly, red no). The number under it is the score.',
      'rp.blocked': 'Run partly hit the web search budget',
      'rp.click': 'Click a dot to read what it said.',
      rpAvg: function (u, s) { return 'avg ' + u + ', ' + s; },
      rpFound: function (f) { return 'Key story found: ' + f.map(function (x) { return x.effort + ' ' + x.n + '/' + x.of; }).join(', '); },
      rpWeb: function (n) { return n + ' web searches'; },
      rpClose: 'Close',
      mlist: function (d, n, o) {
        var l = [
          'Run on ' + d + '. Only the ' + n + ' cases cleared for publication are shown.',
          'Each setup got the original delegation instruction, sent again as it was. Only the "better prompt" setup had its wording improved. Cases from the second round show a short summary of what was delegated, not the user’s own words.',
          'One Opus grader scored every report against a fixed rubric without seeing which setup produced it. There is one grader per case, labels were shuffled, and the answer keys were built from the code before any report was read.',
          'Each cell is a single run, so there is room for chance. That is why the repeats above exist.',
          'Web results change by date. A re-run next week may find different stories.',
          'Cost is tokens priced at Anthropic list prices through sprag’s price table. It is not a bill, and it is not what a subscription charges.',
          '"Opus does it" is the baseline: the main session handles the job with no delegation.'
        ];
        if (o.r2) l.push(
          'Each second-round case ran in a git worktree pinned to the commit where the original delegation happened, so every setup saw the same code.',
          'Case 492’s original run reviewed code that had not been committed yet, and the pinned commit does not have it. One Sonnet high run read the newer main checkout instead and said so in its report.',
          'Case 476 has no Haiku run, because the current rules never give implementation to Haiku.'
        );
        if (o.r1) l.push(
          'In the repeat runs, some runs partly hit the web search budget. They are kept and marked with a striped ring.',
          'Subagents could read the user’s auto-memory, which the original runs could not. One repeat run of a case that is not shown here used it.'
        );
        return l;
      },
      'story.all': 'All', 'story.quality-up': 'Raise effort or model: better answer',
      'story.cost-down': 'Lower model or effort: same answer, less cost', 'story.context': 'Missing context: no setup could fix it',
      'story.aria': 'Filter cases by story',
      'btn.replay': 'Replay', 'btn.skip': 'Skip', 'btn.race': 'Race all setups',
      'live.title': 'delegation log', 'live.run': function (n) { return n + ' calls'; },
      'cn.time': 'Elapsed (real)', 'cn.tok': 'Tokens', 'cn.usd': 'Cost', 'cn.calls': 'Tool calls', 'cn.web': 'Web searches',
      cap: function (n) { return 'Replaying the recorded run at ' + n + '\u00d7 speed'; },
      'ev.think': 'thinking', 'ev.text': 'writing the answer', 'ev.SubagentHandback': 'hands back the report', 'ev.ToolSearch': 'loads a tool',
      'race.h': function (n) { return ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'][n] + (n === 1 ? ' setup' : ' setups') + ' on one clock'; }, 'lanes.aria': 'One lane per setup',
      'vw.ok': 'passed', 'vw.partial': 'passed in part', 'vw.fail': 'failed',
      sumUp: function (a, av, b, bv, pct) { return a + ' ' + av + ', ' + b + ' ' + bv + (pct > 0 ? '. ' + pct + '% cheaper than Opus.' : '.'); },
      sumDown: function (a, cmp, pct) { return a + ': ' + (cmp > 0 ? 'a better verdict than Opus' : cmp < 0 ? 'a lower verdict than Opus' : 'same verdict as Opus') + (pct > 0 ? ', ' + pct + '% cheaper' : '') + '.'; },
      loadFail: 'Could not load the data. Please reload the page.'
    },
    ko: {
      'p.eyebrow': '검증 사례',
      'p.h1': '쉬운 일은 싼 모델에, 어려운 일은 effort를 올려서 맡깁니다.',
      'p.lede': 'sprag가 실제로 위임했던 일을 Haiku, Sonnet, Opus와 effort 조합으로 다시 돌리고, 어느 조건의 답인지 가린 채 채점했습니다. 사례를 눌러 sprag가 어디로 보내는지 지켜보십시오.',
      'c.h': '사례 고르기',
      'c.sub': '모두 실제로 위임했던 요청입니다.',
      'f.req': '사용자 요청', 'f.main': '메인 세션', 'f.router': 'sprag 라우터',
      'f.router.b': '모델과 effort 선택', 'f.model': '모델', 'f.effort': 'effort', 'f.result': '결과',
      'e.h': '반복 실험: effort를 올리면 안정적일까',
      'e.sub': '같은 사례를 같은 Sonnet으로 effort마다 여러 번 돌립니다.',
      'm.h': '방법과 한계',
      'nav.how': '작동 방식', 'nav.routing': '라우팅', 'nav.features': '기능', 'nav.docs': '문서',
      'nav.proof': '검증 사례', 'nav.license': '라이선스', 'nav.teams': '팀 콘솔',
      title: 'Sprag 검증 사례 | 싼 모델에 맡겨도 괜찮을까',
      desc: '실제로 위임했던 일을 Haiku, Sonnet, Opus와 effort 조합으로 다시 돌려 블라인드 채점했습니다. 사례를 눌러 sprag가 고르는 모델과 품질, 비용을 확인하십시오.',
      research: '조사형', lookup: '조회형', run: '실행형', implement: '구현형', review: '검토형',
      'lab.req': '사용자 요청', 'lab.deleg': '위임 내용',
      notrun: '실행하지 않음', 'notrun.impl': '실행하지 않음, 현재 룰이 Haiku에 구현을 맡기지 않습니다.',
      conds: '조건',
      'cond.haiku-low': 'Haiku low', 'cond.sonnet-medium': 'Sonnet medium', 'cond.sonnet-high': 'Sonnet high',
      'cond.opus-direct': 'Opus가 직접 (기준)', 'cond.sonnet-high-improved': 'Sonnet high + 부탁 개선',
      rec: 'sprag 추천', 'rec.exp': '실험상 권장',
      bypass: '건너뜀. Opus가 직접 처리합니다.', routed: '위임함',
      'v.ok': '그대로 전달 가능', 'v.partial': '일부 수정 필요', 'v.fail': '다시 물어야 함',
      cost: '비용', tokens: '토큰', time: '시간', calls: '도구 호출', web: '웹 검색',
      vsBase: 'Opus 대비', baseBar: 'Opus', meBar: '이 조건',
      saved: function (p) { return 'Opus보다 ' + p + '% 저렴'; },
      pricier: function (p) { return 'Opus보다 ' + p + '% 비쌈'; },
      isBase: '기준: 메인 세션이 위임 없이 직접 처리한 경우',
      missLabel: '놓친 것 (채점 메모)', missNone: '눈에 띄는 놓침이 없습니다.',
      excerptLabel: '보고서', fullBtn: '보고서 전문 보기', fullTrunc: '8,000자에서 잘랐습니다.',
      shot: '실행이 찍은 화면', task: '맡긴 일', truth: '정답', lesson: '이 사례가 보여 주는 것',
      score: '점수',
      stat1: function (ok, m, p) {
        return '비용 절감 사례 ' + (ok === m ? m + '건 모두' : m + '건 중 ' + ok + '건에서') + ' Opus보다 싼 조건이 그대로 전달 가능한 답을 냈습니다. 그중 가장 싼 조건의 비용은 Opus의 평균 ' + p + '%입니다.';
      },
      stat2: function (k, m) { return '품질을 올려야 했던 사례 ' + m + '건 중 ' + k + '건에서 가장 싼 조건은 그대로 전달할 수 없었고 권장 조건은 전달할 수 있었습니다.'; },
      stat3: function (found, title) {
        return '"' + title + '" 반복 실험에서 핵심 소식을 찾은 횟수는 ' + found.map(function (f) { return f.effort + ' ' + f.n + '/' + f.of; }).join(', ') + '입니다.';
      },
      stat3fb: function (k, m) { return 'Sonnet의 effort를 medium에서 high로 올리자 ' + m + '건 중 ' + k + '건에서 판정이 올랐습니다.'; },
      statsNote: function (m, r, k, d, pending) {
        return '사례 ' + m + '건, ' + k + '개 라운드에서 실행 ' + r + '회, 조건을 가린 채 Opus가 채점했습니다. 실행일은 ' + d + '입니다.' + (pending ? ' 반복 실험은 아직 진행 중입니다.' : '') + ' 자세한 내용은 "방법과 한계"에 있습니다.';
      },
      effPending: '반복 실험이 진행 중입니다. 같은 사례를 effort마다 여러 번 돌려 판정이 흔들리는지 보고 있습니다. 채점이 끝나면 실행 하나마다 점 하나로 이곳에 찍힙니다.',
      effCase: '사례', runN: function (n) { return n + '회차'; },
      'rp.legend': '점 색은 그대로 전달 가능한 답이었는지를 뜻합니다. 초록은 예, 노랑은 부분, 빨강은 아니오입니다. 점 아래 숫자는 점수입니다.',
      'rp.blocked': '웹 검색 예산이 일부 막힌 실행',
      'rp.click': '점을 누르면 그 실행의 답을 볼 수 있습니다.',
      rpAvg: function (u, s) { return '평균 ' + u + ', ' + s; },
      rpFound: function (f) { return '핵심 소식 발견: ' + f.map(function (x) { return x.effort + ' ' + x.n + '/' + x.of; }).join(', '); },
      rpWeb: function (n) { return '웹 검색 ' + n + '회'; },
      rpClose: '닫기',
      mlist: function (d, n, o) {
        var l = [
          '실행일은 ' + d + '입니다. 공개해도 되는 ' + n + '건만 실었습니다.',
          '조건마다 원래 위임했던 지시문을 그대로 다시 보냈습니다. 부탁 개선 조건만 문장을 고쳤습니다. 2라운드 사례에 적은 위임 내용은 사용자가 쓴 말 그대로가 아니라 위임한 일을 짧게 요약한 것입니다.',
          '채점은 Opus 한 명이 고정된 기준표로 했고 어느 조건의 답인지는 가렸습니다. 채점자는 사례마다 한 명이고, 라벨은 섞었으며, 정답 기준은 보고서를 읽기 전에 코드를 보고 만들었습니다.',
          '칸마다 한 번씩만 돌렸으므로 우연이 섞일 수 있습니다. 위의 반복 실험이 그래서 있습니다.',
          '웹 조사 결과는 날짜에 따라 달라집니다. 다음 주에 다시 돌리면 다른 소식이 나올 수 있습니다.',
          '비용은 토큰을 sprag 가격표의 Anthropic 정가로 환산한 값입니다. 실제 청구액이 아니고 구독이 청구하는 금액도 아닙니다.',
          '"Opus가 직접"은 위임 없이 메인 세션이 처리한 기준입니다.'
        ];
        if (o.r2) l.push(
          '2라운드 사례는 모두 원래 위임이 일어난 시점의 커밋에 고정한 git worktree에서 돌렸습니다. 그래서 모든 조건이 같은 코드를 봤습니다.',
          '사례 492의 원래 실행은 아직 커밋하지 않은 코드를 검토했고, 고정한 커밋에는 그 코드가 없습니다. Sonnet high 실행 하나는 더 새로운 main 체크아웃을 읽었고 보고서에 그렇게 밝혔습니다.',
          '사례 476에는 Haiku 실행이 없습니다. 현재 룰이 구현을 Haiku에 맡기지 않기 때문입니다.'
        );
        if (o.r1) l.push(
          '반복 실험에서 일부 실행은 웹 검색 예산이 일부 막혔습니다. 그런 실행은 빼지 않고 줄무늬 테두리로 표시했습니다.',
          '서브에이전트는 사용자의 자동 메모리를 읽을 수 있었지만 원래 실행은 읽을 수 없었습니다. 여기에 싣지 않은 사례의 반복 실행 하나가 그 메모리를 썼습니다.'
        );
        return l;
      },
      'story.all': '전체', 'story.quality-up': 'effort나 모델을 올려 품질 상승',
      'story.cost-down': '모델이나 effort를 낮춰 비용 절감', 'story.context': '부탁에서 빠진 사정은 어떤 조건도 못 채움',
      'story.aria': '이야기별로 사례 거르기',
      'btn.replay': '다시 재생', 'btn.skip': '건너뛰기', 'btn.race': '모든 조건 동시에 돌리기',
      'live.title': '위임 로그',
      'cn.time': '경과 시간 (실제)', 'cn.tok': '토큰', 'cn.usd': '비용', 'cn.calls': '도구 호출', 'cn.web': '웹 검색',
      cap: function (n) { return '기록된 실제 실행을 ' + n + '배 빠르게 재생합니다'; },
      'ev.think': '생각 중', 'ev.text': '답변 쓰는 중', 'ev.SubagentHandback': '보고서 제출', 'ev.ToolSearch': '도구 불러오기',
      'race.h': function (n) { return ['영', '한', '두', '세', '네', '다섯'][n] + ' 조건을 같은 시계로'; }, 'lanes.aria': '조건마다 한 줄',
      'vw.ok': '통과', 'vw.partial': '일부만 통과', 'vw.fail': '실패',
      sumUp: function (a, av, b, bv, pct) { return a + ' ' + av + ', ' + b + ' ' + bv + (pct > 0 ? ', 비용은 Opus보다 ' + pct + '% 저렴' : '') + '.'; },
      sumDown: function (a, cmp, pct) { return a + ': ' + (cmp > 0 ? 'Opus보다 나은 판정' : cmp < 0 ? 'Opus보다 낮은 판정' : 'Opus와 같은 판정') + (pct > 0 ? ', 비용 ' + pct + '% 절감' : '') + '.'; },
      loadFail: '데이터를 불러오지 못했습니다. 페이지를 새로 고쳐 주십시오.'
    }
  };

  var lang = 'en';
  var data = null;
  var state = { caseId: null, cond: null, race: false, story: 'all' };
  var runToken = 0;
  var rafId = 0;
  var timers = [];
  var statsPlayed = false;
  var STORIES = ['quality-up', 'cost-down', 'context'];
  var $ = function (id) { return document.getElementById(id); };

  function t(key) { var v = STR[lang][key]; return v === undefined ? STR.en[key] : v; }
  function L(obj) { return obj && (obj[lang] || obj.en || obj.ko) || ''; }

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
    var m = Math.floor(s / 60), r = s % 60;
    if (!m) return lang === 'ko' ? r + '초' : r + 's';
    return lang === 'ko' ? m + '분 ' + r + '초' : m + 'm ' + r + 's';
  }
  function mmss(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* data helpers */
  function caseById(id) { return data.cases.filter(function (c) { return c.id === id; })[0]; }
  function runOf(c, cond) {
    return c.runs.filter(function (r) { return r.condition === cond; })[0];
  }
  function laneIds(c) { return c.lanes || data.conditions.map(function (cd) { return cd.id; }); }
  /* research cases are not delegated by the current rules, so the badge there says what the test showed */
  function recText(c) { return t(c.kind === 'research' ? 'rec.exp' : 'rec'); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function condObj(id) { return data.conditions.filter(function (c) { return c.id === id; })[0]; }
  function traceOf(run) { return (run && run.trace) || []; }

  /* sample tokens and cost at a real time t (seconds) by interpolating between recorded events */
  function pointsOf(run) {
    var pts = [{ t: 0, tok: 0, usd: 0 }];
    traceOf(run).forEach(function (e) { pts.push({ t: e.t, tok: e.tok, usd: e.usd }); });
    var last = pts[pts.length - 1];
    pts.push({ t: Math.max(run.seconds, last.t + 0.1), tok: run.tokens, usd: run.usd });
    return pts;
  }
  function sampleAt(pts, rt) {
    var end = pts[pts.length - 1];
    if (rt >= end.t) return { tok: end.tok, usd: end.usd };
    for (var i = 1; i < pts.length; i++) {
      if (rt <= pts[i].t) {
        var a = pts[i - 1], b = pts[i], span = b.t - a.t;
        var f = span > 0 ? (rt - a.t) / span : 1;
        return { tok: a.tok + (b.tok - a.tok) * f, usd: a.usd + (b.usd - a.usd) * f };
      }
    }
    return { tok: end.tok, usd: end.usd };
  }
  function countsAt(run, rt) {
    var calls = 0, web = 0;
    traceOf(run).forEach(function (e) {
      if (e.kind !== 'tool' || e.t > rt) return;
      if (e.tool !== 'SubagentHandback') calls++;
      if (e.tool === 'WebSearch') web++;
    });
    return { calls: calls, web: web };
  }

  /* headline numbers, all from data.json */
  function computeStats() {
    /* 1: cost-saving cases where the recommended setup could be passed on, and what it cost next to Opus */
    var cd = data.cases.filter(function (c) { return c.story === 'cost-down'; });
    /* the cheapest setup, Opus excluded, whose answer could be passed on as is */
    var cheapestOk = function (c) {
      return c.runs.filter(function (r) { return r.condition !== 'opus-direct' && r.prompt === 'original' && r.verdict === 'ok'; })
        .sort(function (a, b) { return a.usd - b.usd; })[0];
    };
    var okCd = cd.filter(function (c) { return cheapestOk(c); });
    var p1 = Math.round(mean(okCd.map(function (c) { return cheapestOk(c).usd / c.baseline.usd; })) * 100);

    /* 2: quality-up cases where the cheapest setup could not be passed on but the recommended one could */
    var qu = data.cases.filter(function (c) { return c.story === 'quality-up'; });
    var k2 = qu.filter(function (c) {
      var rec = runOf(c, c.recommended);
      var cheap = c.runs.filter(function (r) { return r.prompt === 'original'; }).sort(function (a, b) { return a.usd - b.usd; })[0];
      return rec && cheap && rec.verdict === 'ok' && cheap.verdict !== 'ok';
    }).length;

    /* 3: key story found per effort in the repeat runs; before they are graded, the medium to high lift */
    var keyCase = data.cases.filter(function (c) { return (c.repeats || []).some(function (r) { return typeof r.foundKey === 'boolean'; }); })[0];
    var s3;
    if (keyCase) {
      var found = ['medium', 'high', 'xhigh'].map(function (e) {
        var rs = keyCase.repeats.filter(function (r) { return r.effort === e; });
        return { effort: e, n: rs.filter(function (r) { return r.foundKey; }).length, of: rs.length };
      }).filter(function (f) { return f.of > 0; });
      var top = found[found.length - 1];
      s3 = { v: top.n + '/' + top.of, to: top.n, fmt: function (x) { return x + '/' + top.of; }, text: t('stat3')(found, L(keyCase.title)) };
    } else {
      var lifted = 0, pairs = 0;
      data.cases.forEach(function (c) {
        var m = runOf(c, 'sonnet-medium'), h = runOf(c, 'sonnet-high');
        if (m && h) { pairs++; if (RANK[h.verdict] > RANK[m.verdict]) lifted++; }
      });
      s3 = { v: lifted + '/' + pairs, to: lifted, fmt: function (x) { return x + '/' + pairs; }, text: t('stat3fb')(lifted, pairs) };
    }
    return [
      { v: okCd.length ? p1 + '%' : '-', to: p1, fmt: function (x) { return x + '%'; }, text: t('stat1')(okCd.length, cd.length, p1) },
      { v: k2 + '/' + qu.length, to: k2, fmt: function (x) { return x + '/' + qu.length; }, text: t('stat2')(k2, qu.length) },
      s3
    ];
  }

  function renderStatic() {
    document.documentElement.lang = lang;
    document.title = t('title');
    var d = document.querySelector('meta[name=description]');
    if (d) d.content = t('desc');
    document.querySelectorAll('[data-k]').forEach(function (n) {
      var v = STR[lang][n.dataset.k];
      if (typeof v === 'string') n.textContent = v;
    });
    var g = $('conds'); if (g) g.setAttribute('aria-label', t('conds'));
    var sp = $('story-pills'); if (sp) sp.setAttribute('aria-label', t('story.aria'));
    var ln = $('lanes'); if (ln) ln.setAttribute('aria-label', t('lanes.aria'));
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
  }

  /* hero numbers count up the first time they scroll into view */
  function countUp(node, s) {
    var t0 = null, dur = 1300;
    function step(now) {
      if (t0 === null) t0 = now;
      var f = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - f, 3);
      node.textContent = s.fmt(Math.round(s.to * e));
      if (f < 1) requestAnimationFrame(step); else node.textContent = s.v;
    }
    requestAnimationFrame(step);
  }
  function renderStats() {
    var box = $('stats'); box.textContent = '';
    var nodes = [];
    var stats = computeStats();
    var animateIt = !REDUCED && !statsPlayed && 'IntersectionObserver' in window;
    stats.forEach(function (s) {
      var b = el('b', { text: animateIt ? s.fmt(0) : s.v });
      nodes.push(b);
      box.appendChild(el('div', { class: 'stat' }, [b, el('p', { text: s.text })]));
    });
    if (animateIt) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        io.disconnect(); statsPlayed = true;
        stats.forEach(function (s, i) { if (s.to) countUp(nodes[i], s); else nodes[i].textContent = s.v; });
      }, { threshold: 0.4 });
      io.observe(box);
    }
    var r0 = data.rounds.filter(function (r) { return r.id === 'r0'; })[0] || data.rounds[0];
    var nRuns = 0, hasRep = false;
    data.cases.forEach(function (c) { nRuns += c.runs.length + (c.repeats ? c.repeats.length : 0); if (c.repeats && c.repeats.length) hasRep = true; });
    $('stats-note').textContent = t('statsNote')(data.cases.length, nRuns, data.rounds.length, r0 ? r0.date : '', !hasRep);
  }

  /* story filter and case cards */
  function storiesPresent() {
    return STORIES.filter(function (s) { return data.cases.some(function (c) { return c.story === s; }); });
  }
  function renderPills() {
    var box = $('story-pills'); box.textContent = '';
    ['all'].concat(storiesPresent()).forEach(function (s) {
      var n = s === 'all' ? data.cases.length : data.cases.filter(function (c) { return c.story === s; }).length;
      var b = el('button', { type: 'button', class: 'pill ' + (s === 'all' ? '' : 's-' + s), 'aria-pressed': String(state.story === s) }, [
        el('span', { text: t('story.' + s) }), el('em', { text: String(n) })
      ]);
      b.addEventListener('click', function () { state.story = s; renderPills(); renderCases(); });
      box.appendChild(b);
    });
  }
  function renderCases() {
    var ul = $('cases'); ul.textContent = '';
    storiesPresent().forEach(function (s) {
      if (state.story !== 'all' && state.story !== s) return;
      var list = data.cases.filter(function (c) { return c.story === s; });
      ul.appendChild(el('li', { class: 'grp s-' + s }, [el('span', { text: t('story.' + s) }), el('em', { text: String(list.length) })]));
      list.forEach(function (c) {
        var a = el('a', { class: 'case-card s-' + c.story, href: '#case-' + c.id, 'data-case': c.id, 'aria-current': String(c.id === state.caseId) }, [
          el('span', { class: 'badges' }, [
            el('span', { class: 'badge ' + c.kind, text: t(c.kind) }),
            el('span', { class: 'badge sb s-' + c.story, text: t('story.' + c.story) })
          ]),
          el('h3', { text: L(c.title) }),
          el('small', { class: 'qlab', text: t(askLabelKey(c)) }),
          el('q', { text: L(c.userPrompt) }),
          el('p', { class: 'snote', text: L(c.storyNote) })
        ]);
        a.addEventListener('click', function (e) {
          e.preventDefault();
          showCase(c.id, null, 'now');
          var top = $('stage-sec').getBoundingClientRect().top;
          if (top > window.innerHeight * 0.6) $('stage-sec').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
        });
        ul.appendChild(el('li', null, [a]));
      });
    });
  }

  /* a round-2 prompt is a short summary of what was delegated, not the user's own words */
  function askLabelKey(c) { return c.round === 'r2' ? 'lab.deleg' : 'lab.req'; }

  function renderLamps() {
    var m = $('lamps-model'), e = $('lamps-effort');
    [m, e].forEach(function (row) { while (row.children.length > 1) row.removeChild(row.lastChild); });
    MODELS.forEach(function (k) { m.appendChild(el('span', { class: 'lamp', 'data-lamp': k, text: k.charAt(0).toUpperCase() + k.slice(1), style: 'flex:0 0 auto' })); });
    EFFORTS.forEach(function (k) { e.appendChild(el('span', { class: 'lamp', 'data-lamp': k, text: k, style: 'flex:0 0 auto' })); });
  }

  function renderConds() {
    var g = $('conds'); g.textContent = '';
    var c = caseById(state.caseId), missing = false;
    laneIds(c).forEach(function (id) {
      var cd = condObj(id), has = !!runOf(c, id);
      if (!cd) return;
      if (!has) missing = true;
      var kids = [el('span', { text: t('cond.' + cd.id) })];
      if (cd.id === c.recommended) kids.push(el('span', { class: 'rec', text: recText(c) }));
      var attrs = { type: 'button', class: 'cond' + (has ? '' : ' off'), 'data-cond': cd.id, 'aria-pressed': String(has && !state.race && cd.id === state.cond) };
      if (!has) { attrs.disabled = ''; attrs.title = t(notRunKey(c)); }
      var b = el('button', attrs, kids);
      if (has) b.addEventListener('click', function () { selectCond(cd.id, true); });
      g.appendChild(b);
    });
    $('notrun').textContent = missing ? t(notRunKey(c)) : '';
  }
  function notRunKey(c) { return c.kind === 'implement' ? 'notrun.impl' : 'notrun'; }

  function setLamps(cd, lit) {
    document.querySelectorAll('#flow .lamp').forEach(function (l) {
      var k = l.dataset.lamp;
      var on = lit && (k === cd.model || k === cd.effort);
      l.classList.toggle('on', !!on);
      if (!on) l.classList.remove('pulse');
    });
  }
  function lightLamp(k) {
    var l = lampEl(k);
    l.classList.add('on');
    l.classList.remove('pulse'); void l.offsetWidth; l.classList.add('pulse');
  }
  function clearFlow() {
    document.querySelectorAll('#flow .node').forEach(function (n) { n.classList.remove('hit', 'skipped'); });
    $('flow').classList.remove('running');
    setLamps({}, false);
    $('n-router').textContent = '';
    var mk = $('n-mark'); mk.className = 'mark'; mk.textContent = '?';
    $('packet').style.opacity = '0';
    $('rcard').classList.add('pending');
  }

  function renderResult(c, run) {
    var card = $('rcard'); card.textContent = '';
    var isBase = run.role === 'baseline';
    var head = el('div', { class: 'verdict' }, [
      el('span', { class: 'mark ' + run.verdict, text: GLYPH[run.verdict], 'aria-hidden': 'true' }),
      el('h3', { text: t('v.' + run.verdict) })
    ]);
    if (run.condition === c.recommended) head.appendChild(el('span', { class: 'rec', text: recText(c) }));
    head.appendChild(el('span', { class: 'score' }, [
      document.createTextNode(t('score') + ' '), el('b', { text: String(run.score) }), document.createTextNode(' / ' + run.max)
    ]));
    card.appendChild(head);

    var metrics = el('div', { class: 'metrics' });
    function m(label, val) { metrics.appendChild(el('div', null, [el('small', { text: label }), el('strong', { text: val })])); }
    m(t('cost'), usd(run.usd)); m(t('tokens'), tokens(run.tokens)); m(t('time'), secs(run.seconds)); m(t('calls'), String(run.toolCalls));
    if (run.webSearches > 0) m(t('web'), String(run.webSearches));
    card.appendChild(metrics);

    var ratio = Math.min(1, run.usd / c.baseline.usd);
    var over = run.usd > c.baseline.usd;
    var bars = el('div', { class: 'bars' }, [
      el('div', { class: 'bar' }, [el('span', { text: t('baseBar') }), el('i', { style: '--w:100%' }), el('span', { text: usd(c.baseline.usd) })]),
      el('div', { class: 'bar me' + (over ? ' over' : '') }, [el('span', { text: t('meBar') }), el('i', { style: '--w:' + Math.max(1.5, ratio * 100).toFixed(1) + '%' }), el('span', { text: usd(run.usd) })])
    ]);
    card.appendChild(bars);
    var pct = Math.abs(Math.round(run.savingsPct));
    var save = isBase ? el('p', { class: 'save', text: t('isBase') })
      : over ? el('p', { class: 'save neg', text: t('pricier')(pct) })
      : el('p', { class: 'save pos', text: t('saved')(pct) });
    card.appendChild(save);

    var miss = el('div', { class: 'miss' + (run.keyMiss ? '' : ' none') }, [
      el('small', { text: t('missLabel') }),
      el('span', { text: run.keyMiss || t('missNone') })
    ]);
    card.appendChild(miss);

    if (c.screenshot) {
      var fig = el('figure', { class: 'shot' }, [
        el('a', { href: c.screenshot, target: '_blank', rel: 'noopener' }, [el('img', { src: c.screenshot, alt: L(c.title), loading: 'lazy', width: '1440', height: '900' })]),
        el('figcaption', { text: t('shot') })
      ]);
      card.appendChild(fig);
    }

    var ex = el('div', { class: 'excerpt' }, [el('pre', { text: run.excerpt })]);
    card.appendChild(ex);
    if (run.report && run.report.length > run.excerpt.length) {
      var det = el('details', { class: 'full' }, [
        el('summary', { text: t('fullBtn') }),
        el('pre', { text: run.report + (run.reportTruncated ? '\n\n' + t('fullTrunc') : '') })
      ]);
      card.appendChild(det);
    }
  }

  function renderSide(c) {
    function fill(id, h, body, cls) {
      var n = $(id); n.textContent = '';
      n.appendChild(el('h3', { text: h }));
      n.appendChild(el('p', { text: body }));
    }
    fill('task-card', t('task'), L(c.task));
    fill('truth-card', t('truth'), L(c.truth));
    fill('lesson-card', t('lesson'), L(c.lesson));
  }

  function nodeEl(k) { return document.querySelector('#flow [data-n="' + k + '"]'); }
  function lampEl(k) { return document.querySelector('#flow [data-lamp="' + k + '"]'); }

  /* ---------- terminal log ---------- */
  var ICON = {
    search: 'M10.5 10.5L14 14M7 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z',
    globe: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c1.9 1.8 2.9 4 2.9 6.5S9.900 12.700 8 14.500C6.100 12.700 5.100 10.500 5.100 8S6.100 3.300 8 1.500',
    file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
    term: 'M1.5 3h13v10h-13zM4 6l2.200 2L4 10M8 10.500h3.500',
    think: 'M8 2a4 4 0 0 0-2 7.500V11h4V9.500A4 4 0 0 0 8 2zM6.500 13.500h3',
    text: 'M3 4h10M3 8h10M3 12h6',
    report: 'M3 8.500l3.200 3.200L13 4.500',
    tool: 'M10 2.500a3 3 0 0 0 3.200 4L6.500 13.200a1.500 1.500 0 0 1-2.100-2.100L11 4.400'
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '14'); s.setAttribute('height', '14');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICON[name] || ICON.tool);
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
  function eventIcon(e) {
    if (e.kind === 'think') return 'think';
    if (e.kind === 'text') return 'text';
    return { WebSearch: 'search', WebFetch: 'globe', Read: 'file', Grep: 'search', Glob: 'search', Bash: 'term', SubagentHandback: 'report' }[e.tool] || 'tool';
  }
  function eventName(e) {
    if (e.kind === 'think') return t('ev.think');
    if (e.kind === 'text') return t('ev.text');
    return STR[lang]['ev.' + e.tool] || e.tool;
  }
  function logLine(e) {
    return el('div', { class: 'ln k-' + e.kind + (e.tool === 'SubagentHandback' ? ' k-done' : '') }, [
      el('span', { class: 'ts', text: mmss(e.t) }),
      el('span', { class: 'ic' }, [icon(eventIcon(e))]),
      el('span', { class: 'nm', text: eventName(e) }),
      el('span', { class: 'ar', text: e.arg || '' })
    ]);
  }

  /* ---------- counters and cost race ---------- */
  var CN = [['time', 'cn.time'], ['tok', 'cn.tok'], ['usd', 'cn.usd'], ['calls', 'cn.calls'], ['web', 'cn.web']];
  function buildLive(c, run, base, isBase) {
    var box = $('counters'); box.textContent = '';
    CN.forEach(function (p) {
      if (p[0] === 'web' && !run.webSearches && !(base && base.webSearches)) return;
      box.appendChild(el('div', { class: 'cn', 'data-cn': p[0] }, [el('small', { text: t(p[1]) }), el('strong', { id: 'cn-' + p[0], text: '0' })]));
    });
    var cb = $('cbars'); cb.textContent = '';
    function row(cls, label, id) {
      return el('div', { class: 'cbar ' + cls }, [el('span', { text: label }), el('i', null, [el('u', { id: id + '-f' })]), el('b', { id: id + '-v', text: usd(0) })]);
    }
    cb.appendChild(row('base', t('baseBar'), 'cb-base'));
    if (!isBase) cb.appendChild(row('me', t('meBar'), 'cb-me'));
    $('log').textContent = '';
    $('log').classList.add('live-on');
    $('live-cap').textContent = '';
    $('term-title').textContent = t('live.title');
    var st = $('stamp'); st.className = 'stamp'; st.textContent = '';
    $('live').classList.add('running');
  }
  function setCounters(run, rt, smp, cnt) {
    $('cn-time').textContent = mmss(rt);
    $('cn-tok').textContent = tokens(smp.tok);
    $('cn-usd').textContent = usd(smp.usd);
    $('cn-calls').textContent = String(cnt.calls);
    var w = $('cn-web'); if (w) w.textContent = String(cnt.web);
  }
  function setBars(maxUsd, base, meUsd, baseUsd, isBase) {
    function set(id, v) {
      var f = $(id + '-f'); if (!f) return;
      f.style.width = (maxUsd ? clamp(v / maxUsd * 100, 0, 100) : 0).toFixed(1) + '%';
      $(id + '-v').textContent = usd(v);
    }
    set('cb-base', baseUsd);
    if (!isBase) set('cb-me', meUsd);
    var me = document.querySelector('#cbars .cbar.me');
    if (me) me.classList.toggle('over', meUsd > baseUsd + 1e-9);
  }
  function showStamp(run, animateIt) {
    var st = $('stamp'); st.textContent = '';
    st.className = 'stamp ' + run.verdict;
    st.appendChild(el('span', { class: 'sm', text: GLYPH[run.verdict], 'aria-hidden': 'true' }));
    st.appendChild(el('span', { class: 'st' }, [
      el('b', { text: t('v.' + run.verdict) }),
      el('em', { text: t('score') + ' ' + run.score + ' / ' + run.max })
    ]));
    void st.offsetWidth;
    st.classList.add('in');
    if (!animateIt) st.classList.add('static');
  }
  function fmtN(n) { return n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString(); }

  /* put everything in its final state: no motion, exact numbers */
  function finalizeLive(c, cd, run, base, animateStamp) {
    var isBase = run.role === 'baseline';
    buildLive(c, run, base, isBase);
    var log = $('log'); log.textContent = '';
    traceOf(run).forEach(function (e) { log.appendChild(logLine(e)); });
    log.scrollTop = log.scrollHeight;
    $('live').classList.remove('running');
    log.classList.remove('live-on');
    $('cn-time').textContent = mmss(run.seconds);
    $('cn-tok').textContent = tokens(run.tokens);
    $('cn-usd').textContent = usd(run.usd);
    $('cn-calls').textContent = String(run.toolCalls);
    var w = $('cn-web'); if (w) w.textContent = String(run.webSearches);
    var maxUsd = Math.max(run.usd, base ? base.usd : 0);
    setBars(maxUsd, base, run.usd, base ? base.usd : run.usd, isBase);
    showStamp(run, animateStamp);
    var Tmax = Math.max(run.seconds, base ? base.seconds : 0);
    $('live-cap').textContent = t('cap')(fmtN(Tmax / liveDur(Tmax)));
  }
  function liveDur(Tmax) { return clamp(Tmax / 4, 8, 12); }

  function revealResult(c, cd, run) {
    var mk = $('n-mark'); mk.className = 'mark ' + run.verdict; mk.textContent = GLYPH[run.verdict];
    nodeEl('result').classList.add('hit');
    $('flow').classList.remove('running');
    renderResult(c, run);
    $('rcard').classList.remove('pending');
  }

  /* final lit state without animation */
  function applyInstant(c, cd, run) {
    clearFlow();
    var isBase = cd.role === 'baseline';
    ['req', 'main', 'lamps', 'result'].forEach(function (k) { nodeEl(k).classList.add('hit'); });
    if (isBase) { nodeEl('router').classList.add('skipped'); $('n-router').textContent = t('bypass'); }
    else { nodeEl('router').classList.add('hit'); $('n-router').textContent = t('routed'); }
    setLamps(cd, true);
    finalizeLive(c, cd, run, runOf(c, 'opus-direct'), false);
    revealResult(c, cd, run);
  }

  function center(node, host) {
    var a = node.getBoundingClientRect(), b = host.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
  }

  function later(fn, ms, my) {
    var id = setTimeout(function () { if (my === runToken) fn(); }, ms);
    timers.push(id);
  }
  function stopAll() {
    runToken++;
    cancelAnimationFrame(rafId);
    timers.forEach(clearTimeout); timers = [];
  }
  function loop(my, frame) {
    var t0 = performance.now();
    function step() {
      if (my !== runToken) return;
      var done = frame((performance.now() - t0) / 1000);
      if (!done) rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
  }

  var PACKET_STEP = 400;
  /* the packet runs request, main session, router, then the two lamps light up */
  function packetPhase(cd, my, done) {
    var host = $('flow'), pk = $('packet');
    var isBase = cd.role === 'baseline';
    var steps = [{ node: nodeEl('req') }, { node: nodeEl('main') }];
    if (isBase) { nodeEl('router').classList.add('skipped'); $('n-router').textContent = t('bypass'); }
    else steps.push({ node: nodeEl('router'), after: function () { $('n-router').textContent = t('routed'); } });
    steps.push({ node: nodeEl('lamps'), pt: lampEl(cd.model), after: function () { lightLamp(cd.model); } });
    steps.push({ node: nodeEl('lamps'), pt: lampEl(cd.effort), after: function () { lightLamp(cd.effort); }, noHit: true });
    host.classList.add('running');

    var first = center(steps[0].node, host);
    pk.style.transition = 'none';
    pk.style.opacity = '1';
    pk.style.transform = 'translate(' + first.x + 'px,' + first.y + 'px)';
    void pk.offsetWidth;
    var MOVE = 300, HOLD = PACKET_STEP - MOVE;
    function go(i) {
      if (my !== runToken) return;
      if (i >= steps.length) { pk.style.opacity = '0'; done(); return; }
      var s = steps[i], p = center(s.pt || s.node, host);
      pk.style.transition = 'transform ' + MOVE + 'ms cubic-bezier(.23,1,.32,1)';
      pk.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      later(function () {
        s.node.classList.add('hit');
        if (s.after) s.after();
        later(function () { go(i + 1); }, HOLD, my);
      }, MOVE, my);
    }
    go(0);
    return steps.length * PACKET_STEP / 1000;
  }

  function playSingle(c, cd, run) {
    stopAll();
    var my = runToken;
    var base = runOf(c, 'opus-direct');
    var isBase = cd.role === 'baseline';
    clearFlow();
    buildLive(c, run, base, isBase);
    var pts = pointsOf(run), bpts = base ? pointsOf(base) : pts;
    var Tmax = Math.max(run.seconds, base ? base.seconds : 0);
    var packet = (isBase ? 4 : 5) * PACKET_STEP / 1000;
    var D = liveDur(Tmax);
    var S = Math.max(4, D - packet);
    var N = Tmax / S;
    $('live-cap').textContent = t('cap')(fmtN(N));
    var maxUsd = Math.max(run.usd, base ? base.usd : 0);
    var log = $('log'), trace = traceOf(run), shown = 0, finished = false;
    setBars(maxUsd, base, 0, 0, isBase);

    packetPhase(cd, my, function () {
      loop(my, function (sim) {
        var rt = sim * N, rtMe = Math.min(rt, run.seconds), rtBase = Math.min(rt, base ? base.seconds : run.seconds);
        var smp = sampleAt(pts, rtMe), bs = sampleAt(bpts, rtBase);
        setCounters(run, rtMe, smp, countsAt(run, rtMe));
        while (shown < trace.length && trace[shown].t <= rtMe) { log.appendChild(logLine(trace[shown++])); log.scrollTop = log.scrollHeight; }
        setBars(maxUsd, base, smp.usd, bs.usd, isBase);
        if (!finished && rt >= run.seconds) {
          finished = true;
          while (shown < trace.length) log.appendChild(logLine(trace[shown++]));
          log.scrollTop = log.scrollHeight;
          log.classList.remove('live-on');
          showStamp(run, true);
          later(function () { revealResult(c, cd, run); }, 650, my);
        }
        var allDone = finished && (isBase || rt >= base.seconds);
        if (allDone) { finalizeLive(c, cd, run, base, true); $('stamp').classList.add('static'); }
        return allDone;
      });
    });
  }

  function skipSingle() {
    if (state.race) { skipRace(); return; }
    var c = caseById(state.caseId), cd = condObj(state.cond), run = runOf(c, state.cond);
    if (!c || !run) return;
    stopAll();
    applyInstant(c, cd, run);
  }

  /* ---------- race view ---------- */
  var lanes = [];
  function raceRuns(c) {
    var rec = c.recommended;
    var list = laneIds(c).map(function (id) { return { cd: condObj(id), run: runOf(c, id) }; }).filter(function (x) { return x.cd; });
    list.sort(function (a, b) { return (b.cd.id === rec ? 1 : 0) - (a.cd.id === rec ? 1 : 0); });
    return list;
  }
  function miniLamps(cd) {
    var row = el('div', { class: 'ml' });
    MODELS.forEach(function (k) { row.appendChild(el('span', { class: 'lamp sm' + (k === cd.model ? ' on' : ''), 'data-k': 'm', text: k.charAt(0).toUpperCase() + k.slice(1) })); });
    EFFORTS.forEach(function (k) { row.appendChild(el('span', { class: 'lamp sm eff' + (k === cd.effort ? ' on' : ''), text: k })); });
    return row;
  }
  function buildRace(c) {
    var box = $('lanes'); box.textContent = '';
    var items = raceRuns(c);
    lanes = [];
    items.forEach(function (x) {
      var isRec = x.cd.id === c.recommended;
      if (!x.run) {
        box.appendChild(el('div', { class: 'lane is-off', 'data-cond': x.cd.id }, [
          el('div', { class: 'lane-l' }, [el('div', { class: 'lane-n' }, [el('span', { text: t('cond.' + x.cd.id) })]), miniLamps(x.cd)]),
          el('p', { class: 'lane-off', text: t(notRunKey(c)) })
        ]));
        return;
      }
      var f = {
        cd: x.cd, run: x.run, pts: pointsOf(x.run), trace: traceOf(x.run), done: false, lastShown: -1,
        prog: el('i'), tick: el('p', { class: 'tick' }), tok: el('b', { text: '0' }), cost: el('b', { text: usd(0) }),
        cfill: el('u'), stamp: el('div', { class: 'lane-stamp' })
      };
      f.node = el('div', { class: 'lane' + (isRec ? ' is-rec' : '') + (x.cd.role === 'baseline' ? ' is-base' : ''), 'data-cond': x.cd.id }, [
        el('div', { class: 'lane-l' }, [
          el('div', { class: 'lane-n' }, [el('span', { text: t('cond.' + x.cd.id) }), isRec ? el('span', { class: 'rec', text: recText(c) }) : null]),
          miniLamps(x.cd)
        ]),
        el('div', { class: 'lane-m' }, [el('div', { class: 'prog' }, [f.prog]), f.tick, el('div', { class: 'cost-track' }, [f.cfill])]),
        el('div', { class: 'lane-r' }, [
          el('div', { class: 'lane-c' }, [el('small', { text: t('cn.tok') }), f.tok]),
          el('div', { class: 'lane-c' }, [el('small', { text: t('cn.usd') }), f.cost]),
          f.stamp
        ])
      ]);
      box.appendChild(f.node);
      lanes.push(f);
    });
    $('race-h').textContent = t('race.h')(lanes.length);
    $('race-sum').textContent = '';
    $('race-sum').classList.remove('in');
  }
  function laneStamp(f, animateIt) {
    var run = f.run;
    f.stamp.textContent = '';
    f.stamp.className = 'lane-stamp ' + run.verdict + ' in' + (animateIt ? '' : ' static');
    f.stamp.appendChild(el('span', { class: 'sm', text: GLYPH[run.verdict], 'aria-hidden': 'true' }));
    f.stamp.appendChild(el('em', { text: run.score + '/' + run.max }));
    f.stamp.setAttribute('aria-label', t('v.' + run.verdict));
  }
  function laneSet(f, rt, maxUsd) {
    var run = f.run, r = Math.min(rt, run.seconds), smp = sampleAt(f.pts, r);
    f.prog.style.width = (r / run.seconds * 100).toFixed(1) + '%';
    f.tok.textContent = tokens(smp.tok);
    f.cost.textContent = usd(smp.usd);
    f.cfill.style.width = clamp(smp.usd / maxUsd * 100, 0, 100).toFixed(1) + '%';
    var k = -1;
    for (var i = 0; i < f.trace.length; i++) { if (f.trace[i].t <= r) k = i; else break; }
    if (k !== f.lastShown) {
      f.lastShown = k;
      f.tick.textContent = '';
      if (k >= 0) {
        var e = f.trace[k];
        f.tick.appendChild(el('span', { class: 'ic k-' + e.kind }, [icon(eventIcon(e))]));
        f.tick.appendChild(el('span', { text: eventName(e) + (e.arg ? '  ' + e.arg : '') }));
      }
    }
  }
  function raceSummary(c) {
    var rec = runOf(c, c.recommended), base = runOf(c, 'opus-direct');
    if (!rec || !base) return '';
    var pct = Math.round(rec.savingsPct);
    var lower = c.runs.filter(function (r) {
      return r.role !== 'baseline' && r.prompt === 'original' && r.condition !== rec.condition && RANK[r.verdict] < RANK[rec.verdict];
    });
    if (lower.length) {
      lower.sort(function (a, b) {
        var sa = a.model === rec.model ? 1 : 0, sb = b.model === rec.model ? 1 : 0;
        return sb - sa || b.usd - a.usd;
      });
      var low = lower[0];
      return t('sumUp')(t('cond.' + low.condition), t('vw.' + low.verdict), t('cond.' + rec.condition), t('vw.' + rec.verdict), pct);
    }
    return t('sumDown')(t('cond.' + rec.condition), RANK[rec.verdict] - RANK[base.verdict], pct);
  }
  function raceFinal(c, animateIt) {
    var maxUsd = Math.max.apply(null, lanes.map(function (f) { return f.run.usd; }));
    lanes.forEach(function (f) {
      laneSet(f, f.run.seconds, maxUsd);
      f.tok.textContent = tokens(f.run.tokens); f.cost.textContent = usd(f.run.usd);
      f.done = true; laneStamp(f, animateIt);
    });
    var sm = $('race-sum'); sm.textContent = raceSummary(c);
    void sm.offsetWidth; sm.classList.add('in');
    $('race-cap').textContent = t('cap')(fmtN(raceN(c)));
  }
  function raceTmax() { return Math.max.apply(null, lanes.map(function (f) { return f.run.seconds; })); }
  function raceN(c) { var T = raceTmax(); return T / liveDur(T); }

  function enterRace(c, animateIt) {
    stopAll();
    var my = runToken;
    state.race = true;
    $('stage').classList.add('is-race');
    $('b-race').setAttribute('aria-pressed', 'true');
    document.querySelectorAll('#conds .cond').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    writeHash();
    buildRace(c);
    $('race-cap').textContent = t('cap')(fmtN(raceN(c)));
    if (!animateIt || REDUCED) { raceFinal(c, false); return; }
    var N = raceN(c), maxUsd = Math.max.apply(null, lanes.map(function (f) { return f.run.usd; }));
    lanes.forEach(function (f) { laneSet(f, 0, maxUsd); f.node.classList.add('go'); });
    var Tmax = raceTmax();
    loop(my, function (sim) {
      var rt = sim * N, all = true;
      lanes.forEach(function (f) {
        laneSet(f, rt, maxUsd);
        if (rt >= f.run.seconds) {
          if (!f.done) { f.done = true; f.node.classList.remove('go'); laneStamp(f, true); }
        } else all = false;
      });
      if (all) {
        var sm = $('race-sum'); sm.textContent = raceSummary(c);
        void sm.offsetWidth; sm.classList.add('in');
      }
      return all;
    });
  }
  function skipRace() {
    var c = caseById(state.caseId);
    stopAll();
    lanes.forEach(function (f) { f.node.classList.remove('go'); });
    raceFinal(c, false);
  }
  function leaveRace() {
    state.race = false;
    $('stage').classList.remove('is-race');
    $('b-race').setAttribute('aria-pressed', 'false');
  }

  /* ---------- selection ---------- */
  function selectCond(id, animateIt) {
    var c = caseById(state.caseId);
    var run = runOf(c, id), cd = condObj(id);
    if (!run || !cd) return;
    leaveRace();
    state.cond = id;
    document.querySelectorAll('#conds .cond').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.cond === id)); });
    writeHash();
    if (animateIt && !REDUCED) playSingle(c, cd, run); else { stopAll(); applyInstant(c, cd, run); }
  }

  /* play: 'now' runs the replay at once, 'visible' waits until the stage is on screen, anything else shows the final state */
  function showCase(id, cond, play) {
    var c = caseById(id) || data.cases[0];
    stopAll();
    state.caseId = c.id;
    document.querySelectorAll('#cases .case-card').forEach(function (a) { a.setAttribute('aria-current', String(a.dataset.case === c.id)); });
    $('stage-h').textContent = L(c.title);
    var ask = $('stage-ask'); ask.textContent = '';
    ask.appendChild(el('small', { class: 'qlab', text: t(askLabelKey(c)) }));
    ask.appendChild(document.createTextNode('“' + L(c.userPrompt) + '”'));
    $('n-req-l').textContent = t(askLabelKey(c));
    var bd = $('stage-badge'); bd.className = 'badge ' + c.kind; bd.textContent = t(c.kind);
    var sb = $('stage-story'); sb.className = 'badge sb s-' + c.story; sb.textContent = t('story.' + c.story);
    $('stage-note').textContent = L(c.storyNote);
    $('stage').dataset.story = c.story;
    $('n-req').textContent = L(c.userPrompt);
    $('b-replay').textContent = t('btn.replay');
    $('b-skip').textContent = t('btn.skip');
    $('b-race').textContent = t('btn.race');
    var wantRace = cond === 'race';
    state.race = wantRace;
    if (!wantRace) state.cond = cond && runOf(c, cond) ? cond : c.recommended;
    else state.cond = state.cond && runOf(c, state.cond) ? state.cond : c.recommended;
    $('stage').classList.toggle('is-race', wantRace);
    $('b-race').setAttribute('aria-pressed', String(wantRace));
    renderConds();
    renderSide(c);
    writeHash();
    var animateIt = play === 'now' && !REDUCED;
    if (wantRace) { enterRace(c, animateIt); }
    else {
      var cd = condObj(state.cond), run = runOf(c, state.cond);
      if (animateIt) playSingle(c, cd, run); else applyInstant(c, cd, run);
    }
    if (play === 'visible' && !REDUCED && 'IntersectionObserver' in window) {
      var token = ++visibleToken;
      var io = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        io.disconnect();
        if (token !== visibleToken) return;
        if (state.race) enterRace(c, true); else playSingle(c, condObj(state.cond), runOf(c, state.cond));
      }, { threshold: 0.35 });
      io.observe($('stage'));
    } else visibleToken++;
  }
  var visibleToken = 0;

  function restart() {
    var c = caseById(state.caseId);
    visibleToken++;
    if (state.race) enterRace(c, true);
    else if (REDUCED) selectCond(state.cond, false);
    else playSingle(c, condObj(state.cond), runOf(c, state.cond));
  }

  function writeHash() {
    var h = '#case-' + state.caseId + (state.race ? '/race' : state.cond ? '/' + state.cond : '');
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }
  function parseHash() {
    var m = /^#case-([^/]+)(?:\/(.+))?$/.exec(location.hash);
    return m ? { id: m[1], cond: m[2] || null } : null;
  }

  /* ---------- repeat runs ---------- */
  var EFF3 = ['medium', 'high', 'xhigh'];
  var repIo = null;
  function legendDot(cls, label) {
    return el('span', { class: 'lg' }, [el('i', { class: 'rd ' + cls, 'aria-hidden': 'true' }), el('span', { text: label })]);
  }
  function repPanel(panel, c, r, btn) {
    panel.textContent = '';
    var head = el('div', { class: 'rp-h' }, [
      el('strong', { text: r.effort + ', ' + t('runN')(r.rep) }),
      el('span', { class: 'rp-v ' + r.verdict, text: t('v.' + r.verdict) + ', ' + r.total + '/' + r.max })
    ]);
    var close = el('button', { type: 'button', class: 'rp-x', text: t('rpClose') });
    close.addEventListener('click', function () { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); });
    head.appendChild(close);
    panel.appendChild(head);
    var meta = usd(r.usd) + ', ' + secs(r.seconds) + (r.webSearches ? ', ' + t('rpWeb')(r.webSearches) : '') + (r.blockedPartial ? ', ' + t('rp.blocked') : '');
    panel.appendChild(el('p', { class: 'rp-m', text: meta }));
    panel.appendChild(el('div', { class: 'miss' + (r.keyMiss ? '' : ' none') }, [el('small', { text: t('missLabel') }), el('span', { text: r.keyMiss || t('missNone') })]));
    panel.appendChild(el('pre', { class: 'rp-pre', text: r.excerpt || '' }));
    panel.hidden = false;
  }
  function renderEffort() {
    var box = $('effort'); box.textContent = '';
    if (repIo) { repIo.disconnect(); repIo = null; }
    var cases = data.cases.filter(function (c) { return c.repeats && c.repeats.length; });
    if (!cases.length) { box.appendChild(el('p', { class: 'pending-msg', text: t('effPending') })); return; }

    box.appendChild(el('div', { class: 'rp-legend' }, [
      legendDot('ok', t('v.ok')), legendDot('partial', t('v.partial')), legendDot('fail', t('v.fail')),
      el('span', { class: 'lg' }, [el('i', { class: 'rd ok blk', 'aria-hidden': 'true' }), el('span', { text: t('rp.blocked') })])
    ]));
    box.appendChild(el('p', { class: 'rp-hint', text: t('rp.legend') + ' ' + t('rp.click') }));

    var n = 0;
    cases.forEach(function (c) {
      var blk = el('div', { class: 'rcase' });
      blk.appendChild(el('div', { class: 'rcase-h' }, [el('h3', { text: L(c.title) }), el('span', { class: 'badge ' + c.kind, text: t(c.kind) })]));
      var panel = el('div', { class: 'rpanel', hidden: '', role: 'region', 'aria-live': 'polite' });
      panel.hidden = true;
      var grid = el('div', { class: 'rgrid' });
      var found = [];
      EFF3.forEach(function (e) {
        var rs = c.repeats.filter(function (r) { return r.effort === e; });
        if (!rs.length) return;
        var dots = el('div', { class: 'rdots' });
        rs.forEach(function (r) {
          var b = el('button', {
            type: 'button', class: 'rdot', style: '--i:' + (n++), 'aria-expanded': 'false',
            title: t('runN')(r.rep) + ': ' + t('v.' + r.verdict) + ', ' + r.total + '/' + r.max + (r.blockedPartial ? ', ' + t('rp.blocked') : ''),
            'aria-label': e + ', ' + t('runN')(r.rep) + ': ' + t('v.' + r.verdict) + ', ' + r.total + '/' + r.max + (r.blockedPartial ? ', ' + t('rp.blocked') : '')
          }, [
            el('i', { class: 'rd ' + r.verdict + (r.blockedPartial ? ' blk' : ''), text: GLYPH[r.verdict], 'aria-hidden': 'true' }),
            el('span', { class: 'rs', text: r.total + '/' + r.max })
          ]);
          b.addEventListener('click', function () {
            var open = b.getAttribute('aria-expanded') === 'true';
            blk.querySelectorAll('.rdot').forEach(function (x) { x.setAttribute('aria-expanded', 'false'); });
            if (open) { panel.hidden = true; return; }
            b.setAttribute('aria-expanded', 'true');
            repPanel(panel, c, r, b);
          });
          dots.appendChild(b);
        });
        if (rs.some(function (r) { return typeof r.foundKey === 'boolean'; })) {
          found.push({ effort: e, n: rs.filter(function (r) { return r.foundKey; }).length, of: rs.length });
        }
        grid.appendChild(el('div', { class: 'rcol' }, [
          el('h4', { text: e }), dots,
          el('p', { class: 'ravg', text: t('rpAvg')(usd(mean(rs.map(function (r) { return r.usd; }))), secs(Math.round(mean(rs.map(function (r) { return r.seconds; }))))) })
        ]));
      });
      blk.appendChild(grid);
      if (found.length) blk.appendChild(el('p', { class: 'rfound', text: t('rpFound')(found) }));
      blk.appendChild(panel);
      box.appendChild(blk);
    });

    /* the dots pop in one by one when the section comes into view */
    if (!REDUCED && 'IntersectionObserver' in window) {
      box.classList.add('pre');
      repIo = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        repIo.disconnect(); repIo = null;
        box.classList.remove('pre'); box.classList.add('in');
      }, { threshold: 0.15 });
      repIo.observe(box);
    }
  }

  function renderMethod() {
    var r0 = data.rounds.filter(function (r) { return r.id === 'r0'; })[0] || data.rounds[0];
    var has = function (id) { return data.rounds.some(function (r) { return r.id === id; }); };
    var ul = $('method-list'); ul.textContent = '';
    t('mlist')(r0 ? r0.date : '', data.cases.length, { r2: has('r2'), r1: has('r1') }).forEach(function (s) { ul.appendChild(el('li', { text: s })); });
  }

  function renderAll(play) {
    renderStatic();
    renderStats();
    renderPills();
    renderCases();
    renderLamps();
    renderEffort();
    renderMethod();
    showCase(state.caseId, state.race ? 'race' : state.cond, play);
  }

  function setLang(next, remember) {
    lang = next === 'ko' ? 'ko' : 'en';
    if (remember) { try { localStorage.setItem('sprag.lang', lang); } catch (e) { /* private mode */ } }
    statsPlayed = true;
    if (data) renderAll(null); else renderStatic();
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
  $('b-replay').addEventListener('click', restart);
  $('b-skip').addEventListener('click', skipSingle);
  $('b-race').addEventListener('click', function () { visibleToken++; enterRace(caseById(state.caseId), true); });

  fetch('data.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    var h = parseHash();
    var first = h && caseById(h.id) ? h : { id: data.cases[0].id, cond: null };
    state.caseId = first.id; state.cond = first.cond === 'race' ? null : first.cond; state.race = first.cond === 'race';
    renderAll(h && h.cond ? 'now' : 'visible');
    window.addEventListener('hashchange', function () {
      var p = parseHash();
      if (!p || !caseById(p.id)) return;
      var cur = state.race ? 'race' : state.cond;
      if (p.id !== state.caseId || (p.cond && p.cond !== cur)) showCase(p.id, p.cond, 'now');
    });
  }).catch(function () {
    var n = $('stats'); if (n) n.textContent = t('loadFail');
  });
})();
