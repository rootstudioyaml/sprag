/* Sprag admin UX kit, shared by site/team and site/ops.
   KPI cards (change chip, sparkline, count-up), comparison rail, data tables (search, filter chips,
   sorting, pagination, CSV), command palette, seat movement chart and empty/error states.
   Written from scratch in the pages' own style. Uses the pages' CSS tokens; reads the UI language
   from <html lang>. No dependencies. */
(function(){
'use strict';
const doc = document;
const lang = () => doc.documentElement.lang === 'ko' ? 'ko' : 'en';
const TXT = {
  en: {
    noprior:'No data for the previous period', vs:'Previous period', new:'new', prepre:'vs. pre-install period',
    search:'Search this list', all:'All', n:'{n} rows', nf:'{n} of {total} rows', csv:'Export CSV',
    prev:'Previous page', next:'Next page', pg:'{a}-{b} of {n}',
    nomatch:'Nothing matches these filters', clear:'Clear filters', retry:'Retry', failed:'Could not load this section',
    days:'{n} days', rail:'Compare ranges',
    palTitle:'Command palette', palPh:'Jump to a page, team or person', palNone:'No matches',
    palFoot:'Up and down to move, Enter to open, Esc to close', palHint:'Open the command palette',
    gHint:'G, then', palCount:'{n} results',
    mvTitle:'Seat movement', mvDay:'per day', mvWeek:'per week', mvNone:'No seat changes in this range',
    mvJoined:'Joined', mvRestored:'Restored', mvLeft:'Left', mvRemoved:'Removed', mvPaused:'Paused',
    mvTrunc:'Based on the latest {n} events; older changes are not shown',
    mvAria:'Seat movement: {joined} joined, {restored} restored, {left} left, {removed} removed, {paused} paused',
    cpTip:'Click to copy', cpDone:'Copied', cpFail:'Could not copy',
    svDay:'Daily', svWeek:'Weekly', svMonth:'Monthly', svCumT:'Cumulative savings', svProj:'Projected {v}', svProjTip:'Projected cumulative {v}',
    svMa7:'7-day average', svMa3w:'3-week average', svMa3m:'3-month average', svAvgTip:'Average',
    svIns:'Insights', svAria2:'Cumulative savings by team',
    svInUp:'Daily savings over the last 7 days average {a}, up {p} on the 7 days before', svInDown:'Daily savings over the last 7 days average {a}, down {p} on the 7 days before',
    svInFlat:'Daily savings over the last 7 days average {a}, about the same as the 7 days before',
    svInProj:'At this pace cumulative savings for this month will reach about {x}',
    svInConc:'Team {t} accounts for {p} of all savings',
    svInGrow:'Team {t} saved {d} more than in the previous period, the biggest increase',
    svInShrink:'Team {t} saved {d} less than in the previous period',
    svInLow:'Team {t} saves {x} of its spend against an organization average of {y}. Review its delegation rules together',
    svInPeak:'The biggest savings day was {d} with {x}',
    svSaved:'Savings this period', svAvg:'Daily average', svTrend:'Daily trend', svTrendSub:'First half {a} → second half {b}',
    svRate:'Savings rate (since install)', svBest:'Top saving team', svNone:'No savings were recorded in this range',
    svOther:'Other ({n} teams)', svMore:'+{n} more', svTot:'Total', svCumTo:'Cumulative', svAria:'Savings by team over time',
    svcRank:'Rank', svcTeam:'Team', svcSv:'Saved', svcShare:'Share', svcDelta:'Vs previous period', svcTrend:'Trend',
    svcSpend:'Spent', svcRate:'Savings rate (since install)', svcMem:'Saved per member', svcDeleg:'Delegated runs'
  },
  ko: {
    noprior:'비교할 이전 기간 데이터가 없습니다', vs:'이전 기간', new:'신규', prepre:'이전 기간은 설치 전',
    search:'이 목록에서 검색', all:'전체', n:'{n}개', nf:'{total}개 중 {n}개', csv:'CSV 내보내기',
    prev:'이전 페이지', next:'다음 페이지', pg:'{n}개 중 {a}-{b}',
    nomatch:'조건에 맞는 항목이 없습니다', clear:'필터 지우기', retry:'다시 시도', failed:'이 영역을 불러오지 못했습니다',
    days:'{n}일', rail:'기간 비교',
    palTitle:'명령 팔레트', palPh:'페이지, 팀, 사람으로 바로 이동', palNone:'일치하는 항목이 없습니다',
    palFoot:'위아래로 이동, Enter로 열기, Esc로 닫기', palHint:'명령 팔레트 열기',
    gHint:'G 다음에', palCount:'결과 {n}개',
    mvTitle:'좌석 변동', mvDay:'일별', mvWeek:'주별', mvNone:'이 기간에는 좌석 변동이 없습니다',
    mvJoined:'참여', mvRestored:'복원', mvLeft:'나감', mvRemoved:'제거', mvPaused:'중지',
    mvTrunc:'최근 기록 {n}건만 반영했습니다. 이보다 오래된 변동은 보이지 않습니다',
    mvAria:'좌석 변동: 참여 {joined}, 복원 {restored}, 나감 {left}, 제거 {removed}, 중지 {paused}',
    cpTip:'눌러서 복사', cpDone:'복사함', cpFail:'복사하지 못했습니다',
    svDay:'일별', svWeek:'주별', svMonth:'월별', svCumT:'누적 절감', svProj:'예상 {v}', svProjTip:'예상 누적 {v}',
    svMa7:'7일 이동평균', svMa3w:'3주 이동평균', svMa3m:'3개월 이동평균', svAvgTip:'평균',
    svIns:'인사이트', svAria2:'팀별 누적 절감',
    svInUp:'최근 7일 일평균 절감은 그 전 7일보다 {p} 늘어 {a}입니다', svInDown:'최근 7일 일평균 절감은 그 전 7일보다 {p} 줄어 {a}입니다',
    svInFlat:'최근 7일 일평균 절감은 그 전 7일과 비슷한 {a}입니다',
    svInProj:'이 속도면 이번 달 누적 절감은 {x}쯤 됩니다',
    svInConc:'{t} 팀이 전체 절감의 {p}를 차지합니다',
    svInGrow:'{t} 팀 절감이 이전 기간보다 {d} 늘어 가장 많이 늘었습니다',
    svInShrink:'{t} 팀 절감이 이전 기간보다 {d} 줄었습니다',
    svInLow:'{t} 팀은 지출 대비 절감이 {x}로 조직 평균 {y}보다 낮습니다. 위임 룰을 함께 보는 것이 좋습니다',
    svInPeak:'절감이 가장 많았던 날은 {d}이며 절감액은 {x}입니다',
    svSaved:'기간 절감', svAvg:'일평균 절감', svTrend:'일평균 추세', svTrendSub:'전반 {a} → 후반 {b}',
    svRate:'절감률(설치 후)', svBest:'최다 절감 팀', svNone:'이 기간에는 기록된 절감이 없습니다',
    svOther:'기타 ({n}개 팀)', svMore:'외 {n}개 팀', svTot:'합계', svCumTo:'누적', svAria:'팀별 절감 추이',
    svcRank:'순위', svcTeam:'팀', svcSv:'절감', svcShare:'비중', svcDelta:'이전 기간 대비', svcTrend:'추세',
    svcSpend:'지출', svcRate:'절감률(설치 후)', svcMem:'1인당 절감', svcDeleg:'위임 실행'
  }
};
const u = (k, v) => {
  let s = (TXT[lang()] && TXT[lang()][k]) ?? TXT.en[k] ?? k;
  if(v) for(const x in v) s = s.split('{' + x + '}').join(v[x]);
  return s;
};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const pad = n => String(n).padStart(2, '0');
const ymd = d => { const x = new Date(d); return isNaN(x) ? '' : x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
const dlabel = s => { const d = new Date(s + 'T00:00:00'); return lang() === 'ko' ? (d.getMonth() + 1) + '/' + d.getDate() : d.toLocaleDateString('en-US', { month:'short', day:'numeric' }); };

/* ── styles ─────────────────────────────────────────────────────────────── */
const css = `
html{scroll-padding-top:68px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@keyframes uxflash{0%{box-shadow:0 0 0 2px var(--accent2)}100%{box-shadow:0 0 0 2px transparent}}
.ux-flash{animation:uxflash 1.3s var(--ease) 1}

/* KPI cards */
.kcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));margin:0 -1px -1px 0}
@media(min-width:1000px){.kcards.k5{grid-template-columns:repeat(5,minmax(0,1fr))}}
/* phones: wide charts scroll sideways at a readable size instead of shrinking their labels to 3px */
@media(max-width:600px){.mv-chart,.chart{overflow-x:auto}.mv-chart svg,.chart svg{min-width:640px}.mv-chart svg text,.chart svg text{font-size:20px}}   /* 20 user units come to about 12px at 640px wide */
/* eight figures sit as two rows of four instead of seven and one left over */
@media(min-width:1000px){.kcards:not([class*=" k"]):has(> :nth-child(8):last-child){grid-template-columns:repeat(4,minmax(0,1fr))}}
.kc{--sc:#8a94f2;position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left;background:none;border:0;border-radius:0;color:inherit;padding:12px 16px 10px;box-shadow:inset -1px 0 0 var(--line),inset 0 -1px 0 var(--line);transition:background .12s var(--ease)}
button.kc:hover{background:var(--hover)}
button.kc:focus-visible{outline-offset:-2px}
.kc.sv{--sc:#3fd48f} .kc.lt{--sc:#e8ab3c}
.kc .kl{font-size:12px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kc .kv{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.kc .kv b{font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1.25;white-space:nowrap;font-variant-numeric:tabular-nums}
.kc.sp .kv b{color:var(--accent2)} .kc.sv .kv b{color:var(--ok)} .kc.lt .kv b{color:var(--warn)}
.kc .ksub{display:block;font-size:12px;color:var(--faint)}
.kc .ksub .bar{display:block;margin-top:6px;max-width:none}
.kchip{display:inline-flex;align-items:center;gap:3px;font:500 11px/18px var(--mono);border-radius:4px;padding:0 6px;color:var(--dim);background:var(--surface2);border:1px solid var(--line2);white-space:nowrap}
html[lang=ko] .kchip{font-family:var(--sans);font-size:11.5px}
.kchip.up{color:var(--ok);background:transparent;border-color:color-mix(in oklab,var(--accent) 30%,transparent)}
.kchip.down{color:var(--bad);background:transparent;border-color:color-mix(in oklab,var(--ink) 30%,transparent)}
.kchip.dir.up,.kchip.dir.down{color:var(--accent2);background:var(--accent-bg);border-color:color-mix(in oklab,var(--accent) 35%,transparent)}
.kchip .ar{font-size:10px;line-height:1}
.kspark{display:block;width:100%;height:24px;margin-top:8px;color:var(--sc);overflow:visible}
.kspark .ka{fill:currentColor;opacity:.12}
.kspark polyline{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.kc.k-compact{padding:10px 14px 8px}
@media(max-width:600px){.kcards,.kcards.k5{grid-template-columns:repeat(2,minmax(0,1fr))}.kc{padding:10px 12px 8px}.kc .kv b{font-size:18px}}

/* comparison rail */
.rail{display:flex;align-items:stretch;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s4);padding-top:var(--s3);border-top:1px solid var(--line)}
.rail-t{flex:0 0 100%;font-size:12px;color:var(--faint)}
.rail-i{flex:1 1 120px;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;padding:8px 12px;border:1px solid var(--line2);border-radius:var(--r);background:none;color:var(--dim);transition:border-color .15s var(--ease),background .15s var(--ease)}
.rail-i:hover{border-color:var(--line3);background:var(--hover);color:var(--ink)}
.rail-i[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent)}
.rail-i .rd{font-size:11.5px;color:var(--faint)}
.rail-i[aria-pressed=true] .rd{color:var(--accent2)}
.rail-i b{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--ink);font-variant-numeric:tabular-nums}
.rail-i small{font-size:11.5px;color:var(--faint)}
@media(max-width:600px){.rail-i{flex:1 1 calc(50% - 8px)}}

/* data tables */
.dt-tools{display:flex;align-items:center;gap:var(--s2) var(--s3);flex-wrap:wrap;margin-top:var(--s3)}
.card.flush .dt-tools{padding:var(--s3) 20px 0;margin-top:0}
.card.flush .dt-p{padding:0 20px 14px}
.dt-s{position:relative;flex:1 1 220px;max-width:340px;display:block}
.dt-s svg{position:absolute;left:9px;top:50%;width:14px;height:14px;margin-top:-7px;color:var(--faint);pointer-events:none}
.dt-s input{width:100%;height:32px;padding:0 10px 0 30px;font-size:13px;background-color:var(--bg);border:1px solid var(--line2);border-radius:var(--r);color:var(--ink);-webkit-appearance:none;appearance:none;transition:border-color .15s var(--ease),box-shadow .15s var(--ease)}
.dt-s input::placeholder{color:var(--faint)}
.dt-s input:hover{border-color:var(--line3)}
.dt-s input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 22%,transparent);outline:0}
.dt-s input::-webkit-search-cancel-button{-webkit-appearance:none}
.dt-fs{display:flex;gap:6px var(--s3);flex-wrap:wrap;align-items:center}
.dt-fg{display:flex;gap:4px;flex-wrap:wrap}
.dt-fg + .dt-fg{padding-left:var(--s3);border-left:1px solid var(--line)}
.dt-chip{height:26px;padding:0 10px;border:1px solid var(--line2);border-radius:99px;background:none;color:var(--dim);font-size:12px;font-weight:500;white-space:nowrap;transition:border-color .15s var(--ease),background .15s var(--ease),color .15s var(--ease)}
.dt-chip:hover{border-color:var(--line3);color:var(--ink)}
.dt-chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent)}
.dt-n{margin-left:auto;font:500 12px var(--mono);color:var(--faint);white-space:nowrap}
html[lang=ko] .dt-n{font-family:var(--sans)}
.dt-b{margin-top:0}
.dt tr[tabindex]{cursor:pointer}   /* a row that opens something looks like it */
.dt-sort{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;color:inherit;font:inherit;white-space:nowrap}
.dt-sort:hover{color:var(--ink)} .dt-sort:focus-visible{outline:2px solid var(--accent2);outline-offset:2px;border-radius:3px}
.dt-sort::after{content:"";width:0;height:0;border:4px solid transparent;opacity:0}
th[aria-sort=descending] .dt-sort::after{border-top-color:var(--accent2);border-bottom:0;opacity:1;margin-top:2px}
th[aria-sort=ascending] .dt-sort::after{border-bottom-color:var(--accent2);border-top:0;opacity:1;margin-bottom:2px}
th[aria-sort=ascending] .dt-sort,th[aria-sort=descending] .dt-sort{color:var(--ink)}
th.n .dt-sort,th.num .dt-sort{justify-content:flex-end}
.dt-p{display:flex;align-items:center;justify-content:flex-end;gap:var(--s2);margin-top:var(--s3);font:500 12px var(--mono);color:var(--faint)}
html[lang=ko] .dt-p{font-family:var(--sans)}
.dt-p:empty{display:none}
.dt-p .btn{min-width:30px}
.card.flush .dt-b .tbl-wrap{margin-top:var(--s3)}

/* empty and error states */
.ux-state{display:flex;flex-direction:column;align-items:center;gap:var(--s2);text-align:center;padding:28px 20px;color:var(--dim);font-size:13px;border:1px dashed var(--line2);border-radius:var(--r);margin-top:var(--s3)}
.card.flush .ux-state{margin:var(--s3) 20px 20px}
.ux-state svg{width:26px;height:26px;color:var(--faint)}
.ux-state p{max-width:56ch;margin:0}
.ux-state .btn{margin-top:4px}
.ux-state .ux-acts{display:flex;gap:var(--s2);flex-wrap:wrap;justify-content:center}
.ux-state.ux-error{border-color:color-mix(in oklab,var(--ink) 35%,transparent);background:transparent;color:var(--ink)}
.ux-state.ux-error svg{color:var(--bad)}
.ux-state.ux-error p{color:var(--dim)}
.err .btn,.err .ux-retry{margin-left:var(--s3);height:24px;font-size:12px}

/* command palette */
.kbd-hint{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 8px 0 9px;border:1px solid var(--line2);border-radius:var(--r);background:var(--surface);color:var(--faint);font-size:12px;transition:border-color .15s var(--ease),color .15s var(--ease)}
.kbd-hint:hover{border-color:var(--line3);color:var(--ink)}
.kbd-hint svg{width:14px;height:14px}
.kbd-hint kbd{font:500 11px var(--mono);color:var(--dim);border:1px solid var(--line2);border-radius:4px;padding:1px 5px;background:var(--surface2)}
.pal-back{position:fixed;inset:0;z-index:200;display:flex;justify-content:center;align-items:flex-start;padding:14vh 16px 16px;background:color-mix(in oklab,var(--shade) 62%,transparent);}
.pal-back[hidden]{display:none}
.pal{width:min(640px,100%);display:flex;flex-direction:column;max-height:min(520px,76vh);background:var(--surface2);border:1px solid var(--line2);border-radius:12px;box-shadow:none;overflow:hidden}
.pal-in{display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)}
.pal-in svg{width:16px;height:16px;color:var(--faint);flex:0 0 auto}
.pal-in input{flex:1;height:50px;border:0;background:none;box-shadow:none;font-size:15px;padding:0;color:var(--ink)}
.pal-in input:focus{box-shadow:none;border:0}
.pal-in kbd{font:500 11px var(--mono);color:var(--faint);border:1px solid var(--line2);border-radius:4px;padding:1px 5px}
.pal ul{list-style:none;margin:0;padding:6px;overflow:auto;flex:1;min-height:120px;scrollbar-width:thin;scrollbar-color:var(--line3) transparent}
.pal li{display:flex;align-items:center;gap:var(--s3);padding:9px 10px;border-radius:var(--r);cursor:pointer;color:var(--dim);font-size:13.5px;scroll-margin:6px}
.pal li[role=option] .pl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.pal li[role=option] .ph{flex:0 1 auto;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--faint)}
.pal li[role=option] .pk{flex:0 0 auto;font:500 10.5px var(--mono);color:var(--faint);border:1px solid var(--line2);border-radius:4px;padding:0 5px}
.pal li[aria-selected=true]{background:var(--accent-bg);box-shadow:inset 2px 0 0 var(--accent)}
.pal li[aria-selected=true] .ph{color:var(--dim)}
.pal li.pal-g{cursor:default;padding:10px 10px 4px;font-size:11px;letter-spacing:.04em;color:var(--faint);text-transform:uppercase}
html[lang=ko] .pal li.pal-g{text-transform:none;letter-spacing:0}
.pal li.pal-none{cursor:default;justify-content:center;color:var(--faint);padding:28px 10px}
.pal-foot{padding:8px 16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--faint)}
.gtoast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:210;background:var(--surface2);border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-size:12.5px;color:var(--dim);box-shadow:none;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
.gtoast[hidden]{display:none}
.gtoast b{color:var(--ink);font:500 12px var(--mono);margin-right:2px}
@media(max-width:600px){
  .kbd-hint kbd{display:none}.kbd-hint{padding:0 8px}
  .pal-back{padding:0}
  .pal{width:100%;max-height:100dvh;height:100dvh;border-radius:0;border:0}
  .gtoast{white-space:normal}
}

/* seat movement */
.mv{margin-top:var(--s4)}
.mv-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s3);flex-wrap:wrap}
.mv-h h3{font-size:13px}
.mv-h span{font-size:12px;color:var(--faint)}
.mv-sum{display:flex;flex-wrap:wrap;gap:4px var(--s4);margin-top:var(--s2);font-size:12px;color:var(--dim)}
.mv-sum i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.mv-sum b{font-weight:600;color:var(--ink);margin-left:3px}
.mv-chart{position:relative;margin-top:var(--s3)}
.mv-chart svg{display:block;width:100%;height:auto;overflow:visible}
.mv-chart text{fill:var(--faint);font:400 10.5px var(--mono)}
.mv-chart .zl{stroke:var(--line3);stroke-width:1}
.mv-chart .gl{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}
.mv-chart .hv{fill:color-mix(in oklab,var(--ink) 4%,transparent)}
.mv-tip{position:absolute;top:0;z-index:3;pointer-events:none;background:var(--surface2);border:1px solid var(--line2);border-radius:var(--r);padding:6px 10px;font-size:12px;line-height:1.55;white-space:nowrap;box-shadow:none}
.mv-tip b{display:block;font-weight:600}
.mv-tip i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.mv-note{margin-top:var(--s2);font-size:12px;color:var(--faint)}

/* copyable member name */
.cp-id{all:unset;cursor:copy;border-radius:3px;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
.cp-id:hover{color:var(--ink);text-decoration:underline dotted var(--faint);text-underline-offset:3px}
.cp-id:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.cp-id.on::after{content:attr(data-cp);margin-left:6px;font:500 11px var(--sans);color:var(--ok)}
.cp-id.on.bad::after{color:var(--bad)}

/* savings breakdown */
.svx{margin-top:var(--s4)}
.svx > .mv-h{align-items:center}
.svx-hl{display:flex;align-items:baseline;gap:var(--s3);flex-wrap:wrap;min-width:0}
.svx-hl h3{font-size:13px}
.svx-hl span{font-size:12px;color:var(--faint)}
.svx-sum{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:var(--s3) var(--s4);margin-top:var(--s3);padding:var(--s3) 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svx-c{display:flex;flex-direction:column;gap:2px;min-width:0}
.svx-c .l{font-size:11.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svx-c b{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1.3;font-variant-numeric:tabular-nums;min-width:0}
.svx-c b.nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svx-c small{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.svx-c .up{color:var(--ok)} .svx-c .down{color:var(--bad)}
.svx-c b .kchip{font-weight:500}
.svx-chart text.lab{fill:var(--dim)}
.svx-inw{margin-top:var(--s3)}
.svx-inw h4{font-size:12px;font-weight:500;color:var(--faint);margin:0 0 var(--s2)}
.svx-ins{list-style:none;margin:0;padding:0;font-size:13px;line-height:1.6;color:var(--ink)}
.svx-ins li{position:relative;padding-left:16px}
.svx-ins li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--dim)}
.svx-ins li.ok::before{background:var(--ok)}
.svx-ins li.bad::before{background:var(--bad)}
.svx-h2{margin-top:var(--s4)}
.svx-h2 .svx-hl h3{font-size:13px}
.svx-chart2{margin-top:var(--s2)}
.mv-sum i.svx-ln{width:14px;height:0;border-radius:0;border-top:2px solid var(--ink);opacity:.7;vertical-align:middle}
.svx-chart .hv{fill:color-mix(in oklab,var(--ink) 5%,transparent)}
.mv-tip .svx-tr{display:flex;justify-content:space-between;gap:16px}
.mv-tip .svx-tr span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}
.mv-tip .svx-tr span:last-child{font-variant-numeric:tabular-nums}
.mv-tip .svx-tt{margin-top:2px;padding-top:2px;border-top:1px solid var(--line2);font-weight:600}
.mv-tip .svx-tc{color:var(--dim)}
.svx-t{margin-top:var(--s4)}
.svx-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px;vertical-align:-1px}
.svx-t .bar{display:inline-block;width:56px;height:4px;margin:0 0 0 8px;vertical-align:middle}
.svx-t .kchip{margin-left:6px}
.svx-sp{display:inline-block;vertical-align:middle}
.svx-sp .kspark{display:block;width:88px;height:22px;margin:0}
@media(max-width:600px){
  .svx-sum{grid-template-columns:repeat(2,minmax(0,1fr))}
  .svx-c:last-child{grid-column:1/-1}
  .svx > .mv-h{align-items:flex-start}
}
`;
(function(){ const s = doc.createElement('style'); s.id = 'admin-ux-css'; s.textContent = css; doc.head.appendChild(s); })();

/* ── small helpers ──────────────────────────────────────────────────────── */
const ICON = {
  empty:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5.5a2.5 2.5 0 0 1-5 0z"/></svg>',
  error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
  search:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>'
};
/* state: a friendly empty or error block. action: {label, run | href} or an array of them */
function state(kind, msg, action){
  const d = doc.createElement('div');
  d.className = 'ux-state ux-' + kind;
  d.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  d.innerHTML = (ICON[kind] || ICON.empty) + '<p>' + esc(msg) + '</p>';
  const acts = [].concat(action || []).filter(Boolean);
  if(acts.length){
    const w = doc.createElement('div'); w.className = 'ux-acts';
    acts.forEach(a => {
      const el = doc.createElement(a.href ? 'a' : 'button');
      el.className = 'btn sm'; el.textContent = a.label;
      if(a.href) el.href = a.href; else { el.type = 'button'; el.addEventListener('click', () => a.run && a.run(el)); }
      w.appendChild(el);
    });
    d.appendChild(w);
  }
  return d;
}
/* err: fill a <p class="err"> with a message and, when given, a retry button; an empty message clears it */
function err(el, msg, retry){
  if(!el) return;
  el.textContent = msg || '';
  if(msg && retry){
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn sm ux-retry'; b.textContent = u('retry');
    b.addEventListener('click', () => { el.textContent = ''; retry(); });
    el.appendChild(b);
  }
}
function jump(t){
  const el = typeof t === 'string' ? doc.getElementById(t) : t;
  if(!el) return;
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block:'start' });
  el.classList.remove('ux-flash'); void el.offsetWidth; el.classList.add('ux-flash');
  setTimeout(() => el.classList.remove('ux-flash'), 1400);
}

/* ── KPI cards ──────────────────────────────────────────────────────────── */
const seen = new Set();
function sparkSvg(series){
  if(!series || series.length < 2) return '';
  const vs = series.map(v => Number(v) || 0), mn = Math.min(...vs), mx = Math.max(...vs), W = 100, H = 24, p = 2;
  const x = i => i / (vs.length - 1) * W, y = v => mx === mn ? H / 2 : H - p - (v - mn) / (mx - mn) * (H - p * 2);
  const pts = vs.map((v, i) => x(i).toFixed(2) + ',' + y(v).toFixed(2));
  return `<svg class="kspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="ka" d="M0,${H} L${pts.join(' L')} L${W},${H}Z"/><polyline points="${pts.join(' ')}"/></svg>`;
}
function chipOf(it){
  /* the previous period is mostly before install: a neutral chip with no percentage (item.prevPre, from prePrev) */
  if(it.prevPre) return { cls:'none', text:u('prepre'), title:u('prepre') };
  const ok = it.prev != null && it.cur != null && isFinite(it.prev) && isFinite(it.cur);
  if(!ok) return { cls:'none', text:'-', title:u('noprior') };
  const d = it.cur - it.prev, dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  let text;
  if(it.delta === 'abs') text = (d > 0 ? '+' : d < 0 ? '-' : '') + Math.round(Math.abs(d)).toLocaleString('en-US');
  else if(d === 0) text = '0%';
  else if(it.prev === 0) text = u('new');
  else { const p = Math.abs(d / it.prev * 100); text = (p < 1 ? '<1' : Math.round(p).toLocaleString('en-US')) + '%'; }
  const shown = it.fmt ? it.fmt(it.prev) : String(it.prev);
  return { cls: (dir !== 'flat' && it.judge === 'neutral' ? 'dir ' : '') + dir, dir, text,
    title: u('vs') + (it.prevLabel ? ' (' + it.prevLabel + ')' : '') + ': ' + shown };
}
function countUp(el, to, fmt){
  const t0 = performance.now(), D = 650;
  el.textContent = fmt(0);
  const step = now => {
    const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(to * e);
    if(p < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}
/* items: {id, label, tone:'sp'|'sv'|'lt'|'', value, fmt(n), cur, prev, delta:'pct'|'abs', judge:'good'|'neutral', prevLabel,
           series:[n] | null, sub:html, text (plain string, no count-up), static, prevPre (neutral chip, see prePrev), onClick} */
function kpis(host, items, o){
  o = o || {};
  const hid = o.id || host.id || 'k', tones = {};
  host.className = 'kcards' + (o.cols ? ' ' + o.cols : '');
  const animate = [];
  host.innerHTML = items.map(it => {
    const chip = it.noChip ? null : chipOf({ ...it, cur: it.cur != null ? it.cur : it.value });
    const numeric = it.text == null && it.value != null && isFinite(it.value);
    const fmt = it.fmt || (n => String(Math.round(n)));
    const key = hid + ':' + it.id, first = numeric && !seen.has(key) && !reduced();
    if(numeric) seen.add(key);
    if(first) animate.push([it.id, it.value, fmt]);
    const shown = it.text != null ? it.text : numeric ? fmt(first ? 0 : it.value) : '-';
    const tag = it.static ? 'div' : 'button';
    const aria = it.static ? '' : ` aria-label="${esc(it.label + ': ' + (it.text != null ? it.text : numeric ? fmt(it.value) : '-') + (chip ? ', ' + chip.title : ''))}"`;
    return `<${tag} class="kc ${it.tone || ''}${o.compact ? ' k-compact' : ''}"${it.static ? '' : ' type="button"'} data-kid="${esc(it.id)}"${aria}>
      <span class="kl">${esc(it.label)}</span>
      <span class="kv"><b>${esc(shown)}</b>${chip ? `<span class="kchip ${chip.cls}" title="${esc(chip.title)}">${chip.dir === 'up' ? '<span class="ar">&#9650;</span>' : chip.dir === 'down' ? '<span class="ar">&#9660;</span>' : ''}${esc(chip.text)}</span>` : ''}</span>
      ${it.sub ? `<span class="ksub">${it.sub}</span>` : ''}${sparkSvg(it.series)}</${tag}>`;
  }).join('');
  animate.forEach(([id, to, fmt]) => { const b = host.querySelector(`[data-kid="${CSS.escape(id)}"] .kv b`); if(b) countUp(b, to, fmt); });
  host.onclick = ev => {
    const c = ev.target.closest('[data-kid]'); if(!c || !host.contains(c)) return;
    const it = items.find(x => x.id === c.dataset.kid);
    if(it && it.onClick) it.onClick();
  };
}

/* ── comparison rail: the same headline metric for 7 / 30 / 90 / 365 days ── */
function rail(host, o){
  host.innerHTML = `<div class="rail" role="group" aria-label="${esc(o.title)}"><span class="rail-t">${esc(o.title)}</span>` +
    o.items.map(it => `<button type="button" class="rail-i" data-d="${it.days}" aria-pressed="${o.active === it.days}"><span class="rd">${esc(u('days', { n: it.days }))}</span><b>${esc(it.main)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('') + '</div>';
  host.onclick = ev => { const b = ev.target.closest('.rail-i'); if(b && o.onPick) o.onPick(+b.dataset.d); };
}

/* ── data tables ────────────────────────────────────────────────────────── */
const csvCell = v => {
  if(v == null) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  if(typeof v === 'string' && /^[=+@\t\r]|^-(?![\d.])/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function download(name, text){
  const blob = new Blob(['﻿' + text], { type:'text/csv;charset=utf-8' });
  const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), lang(), { numeric:true, sensitivity:'base' });
const isNil = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v));

function Table(key){
  const S = { q:'', f:{}, sort:null, dir:1, page:0, reveal:null };
  let cfg = null, el = null, pageRows = [];
  const label = c => typeof c.label === 'function' ? c.label() : c.label;
  const sortable = c => !c.noSort && !!c.val;
  function filtered(){
    const tokens = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    let rows = cfg.rows.filter(r => {
      for(const g of cfg.filters || []){ const v = S.f[g.key]; if(v && !g.match(r, v)) return false; }
      if(!tokens.length) return true;
      const hay = (cfg.search ? cfg.search(r) : cfg.columns.map(c => c.val ? c.val(r) : '').join(' ')).toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
    const col = cfg.columns.find(c => c.key === S.sort);
    if(col && sortable(col)){
      const dir = S.dir;
      rows = rows.map((r, i) => [r, i, col.val(r)]).sort((x, y) => {
        const a = x[2], b = y[2], an = isNil(a), bn = isNil(b);
        if(an || bn) return an && bn ? x[1] - y[1] : an ? 1 : -1;
        return cmp(a, b) * dir || x[1] - y[1];
      }).map(x => x[0]);
    }
    return rows;
  }
  function filtersActive(){ return !!S.q || Object.values(S.f).some(Boolean); }
  function clear(){ S.q = ''; S.f = {}; S.page = 0; const q = el && el.querySelector('.dt-q'); if(q) q.value = ''; update(); }
  function head(c){
    const cls = c.thCls != null ? c.thCls : (c.cls || '');
    if(!sortable(c)) return `<th scope="col" class="${esc(cls)}">${esc(label(c) || '')}</th>`;
    const on = S.sort === c.key;
    return `<th scope="col" class="${esc(cls)}" aria-sort="${on ? (S.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="dt-sort" data-col="${esc(c.key)}">${esc(label(c))}</button></th>`;
  }
  function tableHtml(){
    return `<div class="tbl-wrap tall ${esc(cfg.wrap || '')}"><table><thead><tr>${cfg.columns.map(head).join('')}</tr></thead><tbody>` +
      pageRows.map((r, i) => `<tr data-i="${i}"${cfg.onRow ? ' tabindex="0"' : ''} class="${esc(cfg.rowClass ? cfg.rowClass(r) : '')}"${cfg.rowAttr ? ' ' + cfg.rowAttr(r) : ''}>` +
        cfg.columns.map(c => `<td class="${esc(c.cls || '')}"${c.tdAttr ? ' ' + c.tdAttr(r) : ''}>${c.cell ? c.cell(r) : esc(c.val ? c.val(r) : '')}</td>`).join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }
  function update(){
    if(!el || !cfg || !el.querySelector('.dt')) return;
    const rows = filtered(), per = cfg.pageSize || 25, pages = Math.max(1, Math.ceil(rows.length / per));
    if(S.reveal){ const idx = rows.findIndex(S.reveal); if(idx >= 0) S.page = Math.floor(idx / per); S.reveal = null; }
    S.page = Math.max(0, Math.min(pages - 1, S.page));
    pageRows = rows.slice(S.page * per, S.page * per + per);
    const b = el.querySelector('.dt-b');
    if(!rows.length) b.replaceChildren(state('empty', u('nomatch'), filtersActive() ? { label:u('clear'), run:clear } : null));
    else b.innerHTML = tableHtml();
    el.querySelectorAll('.dt-chip').forEach(c => c.setAttribute('aria-pressed', String((S.f[c.dataset.g] || '') === c.dataset.v)));
    el.querySelector('.dt-n').textContent = rows.length === cfg.rows.length ? u('n', { n: rows.length }) : u('nf', { n: rows.length, total: cfg.rows.length });
    const csv = el.querySelector('.dt-csv'); if(csv) csv.disabled = !rows.length;
    const p = el.querySelector('.dt-p');
    if(pages > 1){
      const a = S.page * per + 1, z = Math.min(rows.length, a + per - 1);
      p.innerHTML = `<span>${esc(u('pg', { a, b: z, n: rows.length }))}</span><button type="button" class="btn sm dt-pg" data-s="-1" aria-label="${esc(u('prev'))}" ${S.page === 0 ? 'disabled' : ''}>&lsaquo;</button><button type="button" class="btn sm dt-pg" data-s="1" aria-label="${esc(u('next'))}" ${S.page >= pages - 1 ? 'disabled' : ''}>&rsaquo;</button>`;
    } else p.innerHTML = '';
  }
  function exportCsv(){
    const cols = cfg.columns.filter(c => !c.noCsv && (c.val || c.csv)), rows = filtered();
    const head = cols.map(c => csvCell(label(c) || c.key)).join(',');
    const lines = rows.map(r => cols.map(c => csvCell(c.csv ? c.csv(r) : c.val(r))).join(','));
    download((cfg.csvName || key) + '-' + ymd(new Date()) + '.csv', [head].concat(lines).join('\r\n') + '\r\n');
  }
  function onClick(ev){
    const t = ev.target;
    const sb = t.closest('.dt-sort');
    if(sb){
      const k = sb.dataset.col;
      if(S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = (cfg.columns.find(c => c.key === k) || {}).first === -1 ? -1 : 1; }
      S.page = 0; update();
      const nb = el.querySelector(`.dt-sort[data-col="${CSS.escape(k)}"]`); if(nb) nb.focus();
      return;
    }
    const ch = t.closest('.dt-chip');
    if(ch){ S.f[ch.dataset.g] = ch.dataset.v; S.page = 0; update(); return; }
    if(t.closest('.dt-csv')){ exportCsv(); return; }
    const pg = t.closest('.dt-pg');
    if(pg){ S.page += +pg.dataset.s; update(); return; }
    if(cfg.onRow && !t.closest('button,select,a,input,label')){
      const tr = t.closest('tr[data-i]'); if(tr && el.contains(tr) && pageRows[+tr.dataset.i]) cfg.onRow(pageRows[+tr.dataset.i]);
    }
  }
  function onKey(ev){
    if(!cfg.onRow || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    const tr = ev.target.closest && ev.target.closest('tr[data-i]');
    if(tr && ev.target === tr && pageRows[+tr.dataset.i]){ ev.preventDefault(); cfg.onRow(pageRows[+tr.dataset.i]); }
  }
  function render(host, c){
    cfg = c; el = host;
    if(S.sort == null && cfg.sort){ S.sort = cfg.sort.col; S.dir = cfg.sort.dir || 1; }
    if(cfg.error){ el.replaceChildren(state('error', cfg.error.msg || u('failed'), cfg.error.retry ? { label:u('retry'), run:cfg.error.retry } : null)); return; }
    if(cfg.loading){ el.innerHTML = `<p class="msg loading">${esc(cfg.loading)}</p>`; return; }
    if(!cfg.rows.length){ el.replaceChildren(state('empty', (cfg.empty && cfg.empty.msg) || u('nomatch'), cfg.empty && cfg.empty.action)); return; }
    const groups = (cfg.filters || []).map(g => `<div class="dt-fg" role="group" aria-label="${esc(g.label)}">` +
      [{ v:'', label:u('all') }].concat(g.options).map(o => `<button type="button" class="dt-chip" data-g="${esc(g.key)}" data-v="${esc(o.v)}" aria-pressed="false">${esc(o.label)}</button>`).join('') + '</div>').join('');
    el.innerHTML = `<div class="dt"><div class="dt-tools"><label class="dt-s"><span class="sr-only">${esc(u('search'))}</span>${ICON.search}<input type="search" class="dt-q" placeholder="${esc(u('search'))}" autocomplete="off" value="${esc(S.q)}" /></label>` +
      (groups ? `<div class="dt-fs">${groups}</div>` : '') +
      `<span class="dt-n" role="status"></span><button type="button" class="btn sm dt-csv">${esc(u('csv'))}</button></div><div class="dt-b"></div><div class="dt-p"></div></div>`;
    el.querySelector('.dt-q').addEventListener('input', ev => { S.q = ev.target.value; S.page = 0; update(); });
    el.querySelector('.dt').addEventListener('click', onClick);
    el.querySelector('.dt').addEventListener('keydown', onKey);
    update();
  }
  return { render, state:S, clear, reset(){ S.q = ''; S.f = {}; S.sort = null; S.dir = 1; S.page = 0; S.reveal = null; }, reveal(pred){ S.q = ''; S.f = {}; S.reveal = pred; } };
}
const tables = {};
const table = key => tables[key] || (tables[key] = Table(key));

/* ── command palette ────────────────────────────────────────────────────── */
function fuzzy(q, s){
  q = q.toLowerCase(); s = s.toLowerCase();
  if(!q) return 0;
  const at = s.indexOf(q);
  if(at >= 0) return 1000 - at * 2 - (s.length - q.length) * .1 + (at === 0 || /[\s\-_/.·]/.test(s[at - 1]) ? 120 : 0);
  let i = 0, score = 0, last = -2;
  for(let j = 0; j < s.length && i < q.length; j++){
    if(s[j] === q[i]){ score += (j === last + 1 ? 8 : 2) + (j === 0 || /[\s\-_/.·]/.test(s[j - 1]) ? 6 : 0); last = j; i++; }
  }
  return i === q.length ? score : -1;
}
const typing = t => !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
function palette(cfg){
  let root = null, input = null, list = null, status = null, toast = null, isOpen = false, all = [], shown = [], act = 0, prevFocus = null, pend = 0, pendT = 0;
  function build(){
    if(root) return;
    root = doc.createElement('div'); root.className = 'pal-back'; root.hidden = true;
    root.innerHTML = `<div class="pal" role="dialog" aria-modal="true" aria-label="${esc(u('palTitle'))}">
      <div class="pal-in">${ICON.search}<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-activedescendant="" autocomplete="off" spellcheck="false" aria-label="${esc(u('palPh'))}" placeholder="${esc(u('palPh'))}" /><kbd>Esc</kbd></div>
      <ul id="pal-list" role="listbox" aria-label="${esc(u('palTitle'))}"></ul><div class="sr-only" role="status" aria-live="polite"></div><div class="pal-foot"></div></div>`;
    doc.body.appendChild(root);
    input = root.querySelector('input'); list = root.querySelector('ul'); status = root.querySelector('[role=status]');
    root.addEventListener('mousedown', ev => { if(ev.target === root) close(); });
    input.addEventListener('input', () => { act = 0; paint(); });
    list.addEventListener('mousemove', ev => { const li = ev.target.closest('li[role=option]'); if(li && +li.dataset.i !== act){ act = +li.dataset.i; mark(); } });
    list.addEventListener('click', ev => { const li = ev.target.closest('li[role=option]'); if(li) run(+li.dataset.i); });
    root.addEventListener('keydown', ev => {
      if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); close(); }
      else if(ev.key === 'ArrowDown'){ ev.preventDefault(); act = shown.length ? (act + 1) % shown.length : 0; mark(true); }
      else if(ev.key === 'ArrowUp'){ ev.preventDefault(); act = shown.length ? (act - 1 + shown.length) % shown.length : 0; mark(true); }
      else if(ev.key === 'Home'){ ev.preventDefault(); act = 0; mark(true); }
      else if(ev.key === 'End'){ ev.preventDefault(); act = Math.max(0, shown.length - 1); mark(true); }
      else if(ev.key === 'Enter'){ ev.preventDefault(); run(act); }
      else if(ev.key === 'Tab'){ ev.preventDefault(); }
    });
  }
  function paint(){
    const q = input.value.trim();
    shown = all.map(it => ({ it, s: q ? Math.max(fuzzy(q, it.label), fuzzy(q, it.label + ' ' + (it.hint || '') + ' ' + (it.group || '')) - 40) : 0 }))
      .filter(x => x.s >= 0).sort((a, b) => b.s - a.s || 0).slice(0, 40).map(x => x.it);
    let html = '', last = null;
    if(!shown.length) html = `<li class="pal-none" role="presentation">${esc(u('palNone'))}</li>`;
    shown.forEach((it, i) => {
      if(!q && it.group !== last){ html += `<li class="pal-g" role="presentation">${esc(it.group || '')}</li>`; last = it.group; }
      html += `<li role="option" id="pal-o-${i}" data-i="${i}" aria-selected="${i === act}"><span class="pl">${esc(it.label)}</span>${it.hint ? `<span class="ph">${esc(it.hint)}</span>` : ''}${it.key ? `<span class="pk">${esc(it.key)}</span>` : ''}</li>`;
    });
    list.innerHTML = html;
    status.textContent = u('palCount', { n: shown.length });
    root.querySelector('.pal-foot').textContent = u('palFoot');
    mark(true);
  }
  function mark(scroll){
    list.querySelectorAll('li[role=option]').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === act)));
    const cur = list.querySelector(`#pal-o-${act}`);
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    if(cur && scroll) cur.scrollIntoView({ block:'nearest' });
  }
  function open(){
    if(isOpen) return;
    build(); all = cfg.items() || []; prevFocus = doc.activeElement; act = 0;
    root.querySelector('.pal').setAttribute('aria-label', u('palTitle'));
    input.placeholder = u('palPh'); input.value = '';
    root.hidden = false; isOpen = true; paint(); input.focus();
  }
  function close(){
    if(!isOpen) return;
    root.hidden = true; isOpen = false;
    if(prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus();
  }
  function run(i){ const it = shown[i]; if(!it) return; close(); setTimeout(() => it.run(), 0); }
  function showToast(){
    if(!toast){ toast = doc.createElement('div'); toast.className = 'gtoast'; toast.setAttribute('role', 'status'); toast.hidden = true; doc.body.appendChild(toast); }
    const go = cfg.go || {};
    toast.innerHTML = esc(u('gHint')) + ' ' + Object.keys(go).map(k => `<b>${esc(k.toUpperCase())}</b> ${esc(go[k].label)}`).join(' &middot; ');
    toast.hidden = false;
    clearTimeout(pendT); pendT = setTimeout(() => { pend = 0; toast.hidden = true; }, 1500);
  }
  doc.addEventListener('keydown', ev => {
    if(ev.defaultPrevented) return;
    const code = ev.code || '';
    if((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && (code === 'KeyK' || String(ev.key).toLowerCase() === 'k')){
      ev.preventDefault(); if(isOpen) close(); else open(); return;
    }
    if(isOpen || ev.metaKey || ev.ctrlKey || ev.altKey || typing(ev.target)) return;
    const k = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : String(ev.key).toLowerCase();
    if(pend && Date.now() - pend < 1500){
      pend = 0; if(toast) toast.hidden = true; clearTimeout(pendT);
      const s = (cfg.go || {})[k]; if(s){ ev.preventDefault(); s.run(); }
      return;
    }
    if(k === 'g' && cfg.go){ pend = Date.now(); showToast(); }
  });
  return { open, close, isOpen: () => isOpen };
}
/* hint: the header button that shows the shortcut */
function hint(parent, before, onOpen){
  const b = doc.createElement('button');
  b.type = 'button'; b.className = 'kbd-hint'; b.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  b.setAttribute('aria-label', u('palHint')); b.title = u('palHint');
  b.innerHTML = ICON.search + '<kbd>' + (isMac ? '⌘K' : 'Ctrl K') + '</kbd>';
  b.addEventListener('click', onOpen);
  parent.insertBefore(b, before || null);
  return b;
}
const refreshHint = () => doc.querySelectorAll('.kbd-hint').forEach(b => { b.setAttribute('aria-label', u('palHint')); b.title = u('palHint'); });

/* ── seat movement ──────────────────────────────────────────────────────── */
const MV = { joined:'#3fd48f', restored:'#9be8c6', left:'#f06b6b', removed:'#b84a4a', paused:'rgba(232,171,60,.55)' };
function movement(host, o){
  const days = o.days || [], per = days.length <= 31 ? 1 : 7, nb = Math.max(1, Math.ceil(days.length / per));
  const kinds = ['joined', 'restored', 'left', 'removed', 'paused'];
  const bins = Array.from({ length: nb }, (_, i) => ({ a: days[i * per], z: days[Math.min(days.length - 1, i * per + per - 1)], joined:0, restored:0, left:0, removed:0, paused:0 }));
  const at = {}; days.forEach((d, i) => { at[d] = Math.floor(i / per); });
  const tot = { joined:0, restored:0, left:0, removed:0, paused:0 };
  (o.events || []).forEach(e => {
    const b = bins[at[ymd(e.at)]];
    if(b && b[e.event] !== undefined){ b[e.event]++; tot[e.event]++; }
  });
  const sum = kinds.reduce((n, k) => n + tot[k], 0);
  const gran = per === 1 ? u('mvDay') : u('mvWeek');
  const rangeTxt = days.length ? dlabel(days[0]) + '-' + dlabel(days[days.length - 1]) : '';
  const legend = kinds.map(k => `<span><i style="background:${MV[k]}"></i>${esc(u('mv' + k[0].toUpperCase() + k.slice(1)))}<b>${tot[k]}</b></span>`).join('');
  let note = '';
  if(o.limit && (o.events || []).length >= o.limit && days.length){
    const oldest = ymd(o.events[o.events.length - 1].at);
    if(oldest > days[0]) note = `<p class="mv-note">${esc(u('mvTrunc', { n: o.limit }))}</p>`;
  }
  const head = `<div class="mv-h"><h3>${esc(o.title || u('mvTitle'))}</h3><span>${esc(gran)} &middot; ${esc(rangeTxt)}</span></div>`;
  if(!sum){ host.replaceChildren(); host.innerHTML = head + `<div class="mv-sum">${legend}</div>`; host.appendChild(state('empty', u('mvNone'))); if(note) host.insertAdjacentHTML('beforeend', note); return; }
  const W = 1080, H = 210, L = 40, R = 6, T = 10, B = 24, mid = T + (H - T - B) / 2, half = (H - T - B) / 2 - 3, slot = (W - L - R) / nb, bw = Math.max(3, Math.min(30, slot * .62));
  const up = bins.map(b => b.joined + b.restored), dn = bins.map(b => b.left + b.removed + b.paused);
  const mx = Math.max(1, ...up, ...dn), step = mx <= 4 ? 1 : mx <= 10 ? 2 : mx <= 20 ? 5 : 10, top = Math.ceil(mx / step) * step;
  const y = v => mid - v / top * half;
  let g = '';
  [top, 0, -top].forEach(v => { const yy = y(v); g += `<line class="${v ? 'gl' : 'zl'}" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end">${v > 0 ? '+' + v : v}</text>`; });
  const every = Math.max(1, Math.ceil(nb / 8));
  bins.forEach((b, i) => {
    const x = L + slot * i + slot / 2, bx = x - bw / 2;
    let cy = mid;
    ['joined', 'restored'].forEach(k => { if(b[k]){ const h = b[k] / top * half; cy -= h; g += `<rect x="${bx.toFixed(1)}" y="${cy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - .5).toFixed(1)}" rx="1.5" fill="${MV[k]}"/>`; } });
    cy = mid;
    ['left', 'removed', 'paused'].forEach(k => { if(b[k]){ const h = b[k] / top * half; g += `<rect x="${bx.toFixed(1)}" y="${(cy + .5).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - .5).toFixed(1)}" rx="1.5" fill="${MV[k]}"/>`; cy += h; } });
    if(i % every === 0) g += `<text x="${x.toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(dlabel(b.a))}</text>`;
  });
  const hits = bins.map((b, i) => `<rect class="mv-hit" data-i="${i}" x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" fill="transparent"/>`).join('');
  host.innerHTML = head + `<div class="mv-sum">${legend}</div><div class="mv-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(u('mvAria', tot))}">${g}<rect class="hv" id="mv-hv" width="${slot.toFixed(1)}" y="${T}" height="${H - T - B}" hidden/>${hits}</svg><div class="mv-tip" hidden></div></div>${note}`;
  const chart = host.querySelector('.mv-chart'), tip = chart.querySelector('.mv-tip'), hv = chart.querySelector('#mv-hv');
  const show = ev => {
    const r = ev.target.closest && ev.target.closest('.mv-hit'); if(!r) return hide();
    const b = bins[+r.dataset.i], x = (L + slot * (+r.dataset.i + .5)) / W * chart.clientWidth;
    hv.removeAttribute('hidden'); hv.setAttribute('x', r.getAttribute('x'));
    tip.innerHTML = `<b>${esc(b.a === b.z ? dlabel(b.a) : dlabel(b.a) + '-' + dlabel(b.z))}</b>` +
      kinds.map(k => `<i style="background:${MV[k]}"></i>${esc(u('mv' + k[0].toUpperCase() + k.slice(1)))} ${b[k]}`).join('<br>');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(chart.clientWidth - tw, x + 12 > chart.clientWidth - tw ? x - tw - 12 : x + 12)) + 'px';
  };
  const hide = () => { tip.hidden = true; hv.setAttribute('hidden', ''); };
  chart.addEventListener('pointermove', show); chart.addEventListener('pointerdown', show); chart.addEventListener('pointerleave', hide);
}
/* seat count per day derived from the event log, or null when the log is too short to cover the range */
function seatSeries(events, days, nowCount, limit){
  if(!days.length || nowCount == null) return null;
  const ev = events || [];
  if(limit && ev.length >= limit && ymd(ev[ev.length - 1].at) > days[0]) return null;
  const net = {}; let inRange = 0;
  ev.forEach(e => {
    const d = ymd(e.at), n = (e.event === 'joined' || e.event === 'restored') ? 1 : (e.event === 'left' || e.event === 'removed') ? -1 : 0;
    if(d && n && d >= days[0]){ net[d] = (net[d] || 0) + n; inRange += n; }
  });
  let after = 0; const out = new Array(days.length);
  for(let i = days.length - 1; i >= 0; i--){ out[i] = Math.max(0, nowCount - after); after += net[days[i]] || 0; }
  return { series: out, net: inRange, start: Math.max(0, nowCount - inRange) };
}

/* sinceUsage */
/* One machine's usage cut to the days since install (u.since, from team_member_usage); an old server sends no since and the row comes back unchanged.
   An identical copy lives in scene/office-scene.js (pinned by test/usage-since.test.js). */
function sinceUsage(u){
  if(!u || !u.since || !Array.isArray(u.series)) return u;
  const cut = String(u.since).slice(0, 10), kept = u.series.filter(q => String(q.day).slice(0, 10) >= cut), fin = v => v != null && Number.isFinite(Number(v));
  let spent = 0, saved = 0, total = 0, gw = null, dc = null;
  kept.forEach(q => {
    spent += Number(q.spent) || 0; saved += Number(q.saved) || 0; total += Number(q.total ?? q.spent) || 0;
    if(fin(q.gateway)) gw = (gw || 0) + Number(q.gateway);
    if(fin(q.delegated_cost)) dc = (dc || 0) + Number(q.delegated_cost);
  });
  return { ...u, series: kept, spent, saved, total_spent: total, gateway_spent: gw, delegated_cost: dc };
}
/* end of sinceUsage */

/* usage helpers */
/* Sum of team_member_usage payloads (list of {members}). sp = local (Claude) spend, sv = saved, dl = delegated runs,
   tot = total usage: machines with a daily series add the sum of their per-day totals, the gateway figure counted once per (day, gateway_user_hash)
   (the same rule as byDay and the server's usage_totals); machines without a series keep the range figure with the gateway counted once per hash.
   dc = delegation cost (null when no machine sent it), unp = unpriced parts, byDay = {day: {sp, sv, tot, dc}}.
   rtot / rdc / rByDay: the same over each machine's days since install (sinceUsage). mach = machines with spend or delegation in the range,
   dmach = machines that delegated (Claude or Codex). */
function sumUsageBasis(list){
  const o = { sp:0, sv:0, dl:0, tot:0, dc:null, unp:0, byDay:{} }, gwMax = {}, dayGw = {};
  let flat = 0;
  const fin = v => v != null && Number.isFinite(Number(v));
  list.forEach(d => ((d && d.members) || []).forEach(m => {
    o.sp += Number(m.spent) || 0; o.sv += Number(m.saved) || 0; o.dl += Number(m.delegated) || 0;
    const h = m.gateway_user_hash || null, hasSeries = Array.isArray(m.series) && m.series.length > 0;
    if(!hasSeries){
      const tot = Number(m.total_spent ?? m.spent) || 0;
      if(h && fin(m.gateway_spent)){ const g = Number(m.gateway_spent); flat += tot - g; gwMax[h] = Math.max(gwMax[h] ?? 0, g); } else flat += tot;
    }
    if(fin(m.delegated_cost)) o.dc = (o.dc || 0) + Number(m.delegated_cost);
    o.unp += Number(m.unpriced) || 0;
    (m.series || []).forEach(r => { const k = String(r.day).slice(0, 10), x = o.byDay[k] || (o.byDay[k] = { sp:0, sv:0, tot:0, dc:null }); x.sp += Number(r.spent) || 0; x.sv += Number(r.saved) || 0;
      const rt = Number(r.total ?? r.spent) || 0;
      if(h && fin(r.gateway)){ const g = Number(r.gateway), gk = k + '|' + h; x.tot += rt - g; dayGw[gk] = Math.max(dayGw[gk] ?? 0, g); } else x.tot += rt;
      if(fin(r.delegated_cost)) x.dc = (x.dc || 0) + Number(r.delegated_cost); });
  }));
  Object.entries(dayGw).forEach(([gk, g]) => { o.byDay[gk.slice(0, gk.indexOf('|'))].tot += g; });
  o.tot = flat + Object.values(gwMax).reduce((a, b) => a + b, 0) + Object.values(o.byDay).reduce((a, x) => a + x.tot, 0);
  return o;
}
function sumUsage(list){
  const o = sumUsageBasis(list), s = sumUsageBasis(list.map(d => (d && d.members ? { ...d, members: d.members.map(sinceUsage) } : d)));
  o.rtot = s.tot; o.rdc = s.dc; o.rByDay = Object.fromEntries(Object.entries(s.byDay).map(([k, x]) => [k, x.tot]));
  o.mach = 0; o.dmach = 0;
  list.forEach(d => ((d && d.members) || []).forEach(m => {
    const del = Number(m.delegated) || 0, cdel = Number(m.codex_delegated) || 0;
    if((Number(m.total_spent ?? m.spent) || 0) > 0 || del > 0) o.mach++;
    if(del + cdel > 0) o.dmach++;
  }));
  return o;
}
/* The previous period is mostly before install when its since-install spend is under half of its spend; a result without since fields is never */
function prePrev(p){
  return !!(p && p.rtot != null && Number(p.tot) > 0 && p.rtot / p.tot < 0.5);
}
/* savings rate: saved over spend since install (the plain total on an old server); null without spend */
function rateOf(s){ const d = s ? (s.rtot ?? s.tot) : 0; return d > 0 ? s.sv / d : null; }
/* Work share: what share of the work sprag handled, delegation cost plus what it saved (the cost without sprag) over spend plus savings.
   Since-install fields when present, else delegation cost over total spend; null when the cost is unknown or the denominator is 0. */
function workShare(s){
  if(!s) return null;
  const since = s.rtot != null, dc = since ? s.rdc : s.dc, sv = Number(s.sv) || 0;
  if(dc == null) return null;
  if(since){ const den = s.rtot + sv; return den > 0 ? (dc + sv) / den : null; }
  return s.tot > 0 ? dc / s.tot : null;
}
/* the KPI items shared by the organization overview and the team tab. cur/prev are sumUsage results; o = { t (page translator), money, prevLabel,
   series ({sp, sv} arrays or null), unpriced (bool), go ({sp, sv, dl, dm, dr, dc} click handlers) }. Returns {id: item}. */
function usageKpis(cur, prev, o){
  const t = (k, v) => o.t(k, v, true), money = o.money, go = o.go || {}, ser = o.series || {};
  const pct1 = v => (v * 100).toFixed(1) + '%', int = n => Math.round(n).toLocaleString('en-US');
  const pc = prePrev(prev) ? { prevPre: true } : {}, base = { prevLabel: o.prevLabel, ...pc };
  const rtot = cur.rtot ?? cur.tot, rate = rateOf(cur), ws = workShare(cur);
  const sinceSub = cur.rtot != null && cur.rtot < cur.tot ? esc(t('ux.sp.since', { v: money(cur.rtot) })) : '';
  const lines = [sinceSub, o.unpriced ? esc(t('of.unpriced')) : ''].filter(Boolean).join('<br>');
  const mach = cur.mach || 0;
  return {
    sp: { id:'sp', label:t('ch.sp'), tone:'sp', value:cur.tot, fmt:money, prev: prev ? prev.tot : null, judge:'neutral', series: ser.sp || null, onClick: go.sp, sub: lines, ...base },
    sv: { id:'sv', label:t('ch.sv'), tone:'sv', value:cur.sv, fmt:money, prev: prev ? prev.sv : null, judge:'good', series: ser.sv || null, onClick: go.sv,
      sub: cur.sv > 0 ? esc(t('ux.sv.without', { v: money(rtot + cur.sv) })) : '', ...base },
    sr: { id:'sr', label:t('ux.sr'), value:rate, text: rate == null ? t('of.unknown') : undefined, fmt:pct1, prev:rateOf(prev), judge:'good', sub: esc(t('ux.sr.sub', { v: money(rtot) })), ...base },
    dl: { id:'dl', label:t('ux.deleg'), value:cur.dl, fmt:int, prev: prev ? prev.dl : null, judge:'good', onClick: go.dl, ...base },
    dm: { id:'dm', label:t('ux.dm'), value:cur.dmach || 0, fmt: n => Math.round(n) + ' / ' + mach, prev: prev ? prev.dmach ?? null : null, judge:'good', onClick: go.dm, ...base },
    dr: { id:'dr', label:t('ch.ws'), value:ws, text: ws == null ? t('of.unknown') : undefined, fmt:pct1, prev:workShare(prev), judge:'good', onClick: go.dr, ...base },
    dc: { id:'dc', label:t('ch.dc'), value:cur.dc, text: cur.dc == null ? t('of.unknown') : undefined, fmt:money, prev: prev ? prev.dc : null, judge:'neutral', onClick: go.dc, ...base }
  };
}
/* end of usage helpers */

/* ── savings breakdown: how savings move over the range and which team saves most ─ */
/* savings model */
function savingsModel(o){
  const days = ((o && o.days) || []).slice(), tms = (o && o.teams) || [], n = days.length;
  const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
  const gran = n <= 45 ? 'day' : n <= 180 ? 'week' : 'month';
  const groups = [];
  if(gran === 'day') days.forEach(d => groups.push([d]));
  else if(gran === 'week'){ for(let i = 0; i < n; i += 7) groups.push(days.slice(i, i + 7)); }
  else { let mo = null; days.forEach(d => { const k = d.slice(0, 7); if(mo !== k){ mo = k; groups.push([]); } groups[groups.length - 1].push(d); }); }
  const dayOf = (t, d) => { const x = t.cur && t.cur.byDay && t.cur.byDay[d]; return x ? num(x.sv) : 0; };
  const teamSv = t => (t.cur && t.cur.sv != null && isFinite(Number(t.cur.sv))) ? Number(t.cur.sv) : days.reduce((s, d) => s + dayOf(t, d), 0);
  let run = 0;
  const buckets = groups.map(ds => {
    const byTeam = {}; let total = 0;
    tms.forEach(t => { const v = ds.reduce((s, d) => s + dayOf(t, d), 0); byTeam[t.id] = v; total += v; });
    run += total;
    return { a: ds[0], z: ds[ds.length - 1], byTeam, total, cum: run };
  });
  const change = (cur, prev) => prev == null ? null : prev === 0 ? (cur > 0 ? 'new' : 0) : (cur - prev) / prev;
  const orgSv = tms.reduce((s, t) => s + teamSv(t), 0);
  const rows = tms.map((t, i) => {
    /* tot is the spend column (full range); rtot is the rate denominator (spend since install, absent on an old server) */
    /* a previous period that is mostly before install says nothing about a change: no previous figure, no delta (prePrev) */
    const sv = teamSv(t), tot = t.cur ? num(t.cur.tot) : 0, rtot = t.cur ? num(t.cur.rtot ?? t.cur.tot) : 0, pre = prePrev(t.prev), prevSv = t.prev && !pre ? num(t.prev.sv) : null;
    return { id: t.id, name: t.name, slot: i < 7 ? i : (i === 7 && tms.length === 8 ? 7 : 'other'), sv, tot, rtot, dl: t.cur ? num(t.cur.dl) : 0,
      prevSv, prePrev: pre, delta: prevSv == null ? null : sv - prevSv, deltaPct: change(sv, prevSv),
      share: orgSv > 0 ? sv / orgSv : 0, rate: rtot > 0 ? sv / rtot : null,
      perMember: t.members ? sv / t.members : null, series: buckets.map(b => b.byTeam[t.id]), rank: 0 };
  });
  const ranked = rows.map((r, i) => [r, i]).sort((x, y) => y[0].sv - x[0].sv || x[1] - y[1]).map(x => x[0]);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const h = Math.floor(n / 2), dayTot = d => tms.reduce((s, t) => s + dayOf(t, d), 0);
  const firstAvg = h ? days.slice(0, h).reduce((s, d) => s + dayTot(d), 0) / h : 0;
  const secondAvg = h ? days.slice(n - h).reduce((s, d) => s + dayTot(d), 0) / h : 0;
  const orgPrePrev = tms.length > 0 && tms.every(t => t.prev) && prePrev({ tot: tms.reduce((s, t) => s + num(t.prev.tot), 0), rtot: tms.some(t => t.prev.rtot != null) ? tms.reduce((s, t) => s + num(t.prev.rtot ?? t.prev.tot), 0) : null });
  const orgPrev = tms.length && tms.every(t => t.prev) && !orgPrePrev ? tms.reduce((s, t) => s + num(t.prev.sv), 0) : null;
  const orgTot = rows.reduce((s, r) => s + r.tot, 0), orgRtot = rows.reduce((s, r) => s + r.rtot, 0);
  let peak = null; buckets.forEach(b => { if(b.total > 0 && (!peak || b.total > peak.total)) peak = b; });
  /* moving average of the bucket totals: 7 buckets for days, 3 for weeks and months; null until the window is full */
  const win = gran === 'day' ? 7 : 3;
  buckets.forEach((b, i) => { b.ma = (buckets.length >= win && i >= win - 1) ? buckets.slice(i - win + 1, i + 1).reduce((s, x) => s + x.total, 0) / win : null; });
  /* recent 7 days against the 7 before them, for the organization and for each team */
  const avgOf = (vals, a, z) => { const s = vals.slice(a, z); return s.length ? s.reduce((p, q) => p + q, 0) / s.length : 0; };
  const recentOf = vals => {
    const len = vals.length, recent = len ? avgOf(vals, Math.max(0, len - 7), len) : 0, prior = len >= 14 ? avgOf(vals, len - 14, len - 7) : null;
    return { recent, prior, pct: prior ? (recent - prior) / prior : null };
  };
  const orgDay = days.map(dayTot), rc = recentOf(orgDay);
  rows.forEach((r, i) => { r.recentPct = recentOf(days.map(d => dayOf(tms[i], d))).pct; });
  let peakDay = null; days.forEach((d, i) => { if(orgDay[i] > 0 && (!peakDay || orgDay[i] > peakDay.sv)) peakDay = { day: d, sv: orgDay[i] }; });
  /* projection: a range that is the current calendar month so far (1st through today) runs on to the month's last day */
  let projection = null;
  if(n){
    const pd2 = x => String(x).padStart(2, '0'), nw = new Date();
    const today = (o && o.today) || (nw.getFullYear() + '-' + pd2(nw.getMonth() + 1) + '-' + pd2(nw.getDate()));
    const first = days[0], last = days[n - 1];
    if(last === today && first.slice(8, 10) === '01' && first.slice(0, 7) === last.slice(0, 7)){
      const y = +last.slice(0, 4), mo = +last.slice(5, 7), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), left = dim - (+last.slice(8, 10));
      if(left > 0) projection = { to: last.slice(0, 8) + pd2(dim), days: left, total: buckets[buckets.length - 1].cum + rc.recent * left, avg: rc.recent };
    }
  }
  return { gran, buckets, teams: rows, ranked, org: {
    sv: orgSv, prevSv: orgPrev, prePrev: orgPrePrev, deltaPct: change(orgSv, orgPrev), tot: orgTot, rtot: orgRtot, rate: orgRtot > 0 ? orgSv / orgRtot : null,
    dailyAvg: n ? orgSv / n : 0, firstAvg, secondAvg, trendPct: (n < 4 || !firstAvg) ? null : (secondAvg - firstAvg) / firstAvg,
    best: orgSv > 0 ? ranked[0] : null, peak, recent7Avg: rc.recent, prior7Avg: rc.prior, recentPct: rc.pct, projection, peakDay } };
}
/* end of savings model */

const SV_PAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], SV_OTHER = '#6b6d76';
const svColor = s => s === 'other' ? SV_OTHER : SV_PAL[s];
function svNice(mx){
  if(!(mx > 0)) return { step: .25, top: 1, n: 4 };
  const raw = mx / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = [1, 2, 2.5, 5, 10].find(k => k * p >= raw - 1e-12), step = f * p;
  /* the top gridline is the first step at or above the peak, so a $491 series stops at $600 rather than $800 */
  const n = Math.max(1, Math.ceil(mx / step - 1e-9));
  return { step, top: step * n, n };
}
const svAx = v => '$' + (v >= 1000 ? Number((v / 1000).toFixed(1)) + 'k' : Number(v.toFixed(2)));
const svPct = p => (p * 100).toFixed(1) + '%';
const svSigned = p => { const a = Math.abs(p * 100), r = a < 10 ? Number(a.toFixed(1)) : Math.round(a); return (r === 0 ? '' : p > 0 ? '+' : '-') + r + '%'; };
const svChip = c => `<span class="kchip ${c.cls}" title="${esc(c.title)}">${c.dir === 'up' ? '<span class="ar">&#9650;</span>' : c.dir === 'down' ? '<span class="ar">&#9660;</span>' : ''}${esc(c.text)}</span>`;
const svTop = (x, y, w, h, r) => { r = Math.min(r, h, w / 2); return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`; };

/* savings(host, o): o = { title, days, teams, money, prevLabel, onTeam, key, today }; see savingsModel for the team shape */
function savings(host, o){
  const m = savingsModel(o), key = o.key || 'sv', money = o.money || (v => '$' + (Number(v) || 0).toFixed(2)), days = o.days || [], nb = m.buckets.length, org = m.org;
  const gname = u(m.gran === 'day' ? 'svDay' : m.gran === 'week' ? 'svWeek' : 'svMonth');
  const empty = !(org.sv > 0) && !m.buckets.some(b => b.total > 0);
  const head = `<div class="mv-h"><div class="svx-hl"><h3>${esc(o.title || '')}</h3><span>${esc(gname)}</span></div></div>`;
  if(empty){ host.innerHTML = `<div class="svx">${head}</div>`; host.firstChild.appendChild(state('empty', u('svNone'))); return; }

  /* summary strip */
  const chip = chipOf({ cur: org.sv, prev: org.prevSv, judge: 'good', fmt: money, prevLabel: o.prevLabel });
  const tp = org.trendPct, tcls = tp == null || Math.round(tp * 1000) === 0 ? '' : tp > 0 ? 'up' : 'down';
  const best = org.best;
  const cell = (label, val, sub) => `<div class="svx-c"><span class="l">${esc(label)}</span>${val}${sub ? `<small>${sub}</small>` : ''}</div>`;
  const sumHtml = '<div class="svx-sum">' +
    cell(u('svSaved'), `<b>${esc(money(org.sv))}${svChip(chip)}</b>`) +
    cell(u('svAvg'), `<b>${esc(money(org.dailyAvg))}</b>`) +
    cell(u('svTrend'), `<b class="${tcls}">${tp == null ? '-' : esc(svSigned(tp))}</b>`, tp == null ? '' : esc(u('svTrendSub', { a: money(org.firstAvg), b: money(org.secondAvg) }))) +
    cell(u('svRate'), `<b>${org.rate == null ? '-' : esc(svPct(org.rate))}</b>`) +
    cell(u('svBest'), `<b class="nm" title="${esc(best ? best.name : '')}">${best ? esc(best.name) : '-'}</b>`, best ? esc(money(best.sv) + ' (' + svPct(best.share) + ')') : '') + '</div>';

  /* insights: short sentences from the model, each skipped when its numbers are missing */
  const ins = [], pctTxt = p => { const a = Math.abs(p * 100); return Number(a < 10 ? a.toFixed(1) : Math.round(a)) + '%'; };
  if(org.recentPct != null){
    const rp = org.recentPct, flat = Number(Math.abs(rp * 100) < 10 ? Math.abs(rp * 100).toFixed(1) : Math.round(Math.abs(rp * 100))) === 0;
    ins.push(flat ? ['dim', u('svInFlat', { a: money(org.recent7Avg) })] : [rp > 0 ? 'ok' : 'bad', u(rp > 0 ? 'svInUp' : 'svInDown', { a: money(org.recent7Avg), p: pctTxt(rp) })]);
  }
  if(org.projection) ins.push(['dim', u('svInProj', { x: money(org.projection.total) })]);
  if(best && best.share >= .5 && m.teams.length >= 2) ins.push(['dim', u('svInConc', { t: best.name, p: Math.round(best.share * 100) + '%' })]);
  const withDelta = m.teams.filter(r => r.delta != null);
  const grow = withDelta.reduce((a, r) => (r.delta > 0 && (!a || r.delta > a.delta)) ? r : a, null);
  const shrink = withDelta.reduce((a, r) => (r.delta < 0 && (!a || r.delta < a.delta)) ? r : a, null);
  if(grow) ins.push(['ok', u('svInGrow', { t: grow.name, d: money(grow.delta) })]);
  if(shrink) ins.push(['bad', u('svInShrink', { t: shrink.name, d: money(-shrink.delta) })]);
  if(m.teams.length >= 2 && org.rate != null){
    const low = m.teams.reduce((a, r) => (r.rate != null && (!a || r.rate < a.rate)) ? r : a, null);
    if(low && low.rate < org.rate * .5) ins.push(['bad', u('svInLow', { t: low.name, x: svPct(low.rate), y: svPct(org.rate) })]);
  }
  if(org.peakDay) ins.push(['dim', u('svInPeak', { d: dlabel(org.peakDay.day), x: money(org.peakDay.sv) })]);
  const insHtml = ins.length ? `<div class="svx-inw"><h4>${esc(u('svIns'))}</h4><ul class="svx-ins">${ins.slice(0, 5).map(([c, s]) => `<li class="${c}">${esc(s)}</li>`).join('')}</ul></div>` : '';

  /* legend: one entry per color slot in input order, folded teams as one, plus the moving average line */
  const slots = []; m.teams.forEach(r => { if(!slots.includes(r.slot)) slots.push(r.slot); });
  const nOther = m.teams.filter(r => r.slot === 'other').length;
  const sser = slots.map(s => m.teams.reduce((a, r) => r.slot === s ? a.map((v, i) => v + r.series[i]) : a, new Array(nb).fill(0)));
  const maName = u(m.gran === 'day' ? 'svMa7' : m.gran === 'week' ? 'svMa3w' : 'svMa3m'), hasMa = m.buckets.some(b => b.ma != null);
  const legend = '<div class="mv-sum">' + slots.map(s => {
    const rs = m.teams.filter(r => r.slot === s), v = rs.reduce((a, r) => a + r.sv, 0);
    return `<span><i style="background:${svColor(s)}"></i>${esc(s === 'other' ? u('svOther', { n: nOther }) : rs[0].name)}<b>${esc(money(v))}</b></span>`;
  }).join('') + (hasMa ? `<span><i class="svx-ln"></i>${esc(maName)}</span>` : '') + '</div>';

  host.innerHTML = `<div class="svx">${head}${sumHtml}${insHtml}<div class="mv-chart svx-chart"></div>${legend}` +
    `<div class="mv-h svx-h2"><div class="svx-hl"><h3>${esc(u('svCumT'))}</h3></div></div><div class="mv-chart svx-chart svx-chart2"></div><div class="svx-t"></div></div>`;
  const chartEl = host.querySelector('.svx-chart'), cumEl = host.querySelector('.svx-chart2');

  const W = 1080, L = 54, R = 8, T = 24, B = 24;
  const lab = (x, yy, txt) => { const end = x > W - 72, start = x < L + 36; return `<text class="lab" x="${(end ? Math.min(x + 14, W - R) : start ? Math.max(x - 14, L) : x).toFixed(1)}" y="${(yy - 6).toFixed(1)}" text-anchor="${end ? 'end' : start ? 'start' : 'middle'}">${esc(txt)}</text>`; };
  const gridOf = (nz, y) => {
    let g = '';
    for(let k = 1; k <= nz.n; k++){ const yy = y(nz.step * k); g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text x="${L - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${svAx(nz.step * k)}</text>`; }
    return g + `<line class="zl" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><text x="${L - 6}" y="${(y(0) + 3.5).toFixed(1)}" text-anchor="end">$0</text>`;
  };
  /* one hover layer per chart: build(i) returns the tooltip html for slot i */
  const hover = (el, build) => {
    const tip = el.querySelector('.mv-tip'), hv = el.querySelector('.hv');
    const hide = () => { tip.hidden = true; hv.setAttribute('hidden', ''); };
    const show = ev => {
      const r = ev.target.closest && ev.target.closest('.mv-hit'); if(!r) return hide();
      const x = (+r.getAttribute('x') + +r.getAttribute('width') / 2) / W * el.clientWidth;
      hv.removeAttribute('hidden'); hv.setAttribute('x', r.getAttribute('x')); hv.setAttribute('width', r.getAttribute('width'));
      tip.innerHTML = build(+r.dataset.i); tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(el.clientWidth - tw, x + 12 > el.clientWidth - tw ? x - tw - 12 : x + 12)) + 'px';
    };
    el.addEventListener('pointermove', show); el.addEventListener('pointerdown', show); el.addEventListener('pointerleave', hide);
  };
  const cdate = b => b.a === b.z ? dlabel(b.a) : dlabel(b.a) + '-' + dlabel(b.z);
  const tr = (cls, a, b) => `<div class="svx-tr${cls ? ' ' + cls : ''}"><span>${a}</span><span>${esc(b)}</span></div>`;
  const teamRows = vals => {
    const list = m.teams.map((t, k) => ({ t, v: vals[k] })).filter(e => e.v > 0).sort((p, q) => q.v - p.v), shown = list.slice(0, 10), more = list.length - shown.length;
    return shown.map(e => tr('', `<i style="background:${svColor(e.t.slot)}"></i>${esc(e.t.name)}`, money(e.v))).join('') +
      (more > 0 ? `<div class="svx-tr svx-tc"><span>${esc(u('svMore', { n: more }))}</span></div>` : '');
  };

  /* per-period chart: stacked bars by team with the moving average of the total laid over them */
  (function(){
    const H = 240, ch = H - T - B, slotW = (W - L - R) / nb;
    const nz = svNice(Math.max(...m.buckets.map(b => b.total))), top = nz.top;
    const y = v => T + ch - v / top * ch, cx = i => L + slotW * (i + .5);
    let g = gridOf(nz, y);
    m.buckets.forEach((b, i) => {
      const bw = Math.max(2, Math.min(30, slotW * .62)), bx = cx(i) - bw / 2, parts = [];
      slots.forEach((s, k) => { if(sser[k][i] > 0) parts.push([s, sser[k][i]]); });
      let acc = 0;
      parts.forEach(([s, v], pi) => {
        const y1 = y(acc + v) + 1, hh = Math.max(1, y(acc) - y(acc + v) - 2); acc += v;
        g += pi === parts.length - 1 ? `<path d="${svTop(bx, y1, bw, hh, 3)}" fill="${svColor(s)}"/>` : `<rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${svColor(s)}"/>`;
      });
    });
    if(hasMa){
      const pts = m.buckets.map((b, i) => b.ma == null ? null : `${cx(i).toFixed(1)},${y(b.ma).toFixed(1)}`).filter(Boolean);
      g += `<polyline class="svx-ma" points="${pts.join(' ')}" fill="none" style="stroke:var(--ink)" stroke-opacity=".7" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    const pk = org.peak ? m.buckets.indexOf(org.peak) : -1, last = nb - 1;
    /* a label pulled sideways at the right edge rides above the bars it spans, so a taller neighbor cannot cover it */
    const over = i => { const n = cx(i) > W - 72 ? Math.ceil(64 / slotW) : 0; return Math.max(...m.buckets.slice(Math.max(0, i - n), i + 1).map(b => b.total)); };
    if(m.buckets[last].total > 0) g += lab(cx(last), y(over(last)), money(m.buckets[last].total));
    if(pk >= 0 && pk !== last && (last - pk) * slotW > 70) g += lab(cx(pk), y(over(pk)), money(m.buckets[pk].total));
    const every = Math.max(1, Math.ceil(nb / 8));
    m.buckets.forEach((b, i) => { if(i % every === 0) g += `<text x="${cx(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(dlabel(b.a))}</text>`; });
    const hits = m.buckets.map((b, i) => `<rect class="mv-hit" data-i="${i}" x="${(L + slotW * i).toFixed(1)}" y="0" width="${slotW.toFixed(1)}" height="${H - B}" fill="transparent"/>`).join('');
    chartEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(u('svAria'))}">${g}<rect class="hv" width="${slotW.toFixed(1)}" y="${T}" height="${ch}" hidden/>${hits}</svg><div class="mv-tip" hidden></div>`;
    hover(chartEl, i => {
      const b = m.buckets[i];
      return `<b>${esc(cdate(b))}</b>` + teamRows(m.teams.map(t => t.series[i])) + tr('svx-tt', esc(u('svTot')), money(b.total)) +
        (b.ma != null ? tr('svx-tc', esc(maName), money(b.ma)) : '') + tr('svx-tc', esc(u('svCumTo')), money(b.cum));
    });
  })();

  /* cumulative chart: stacked area by team on its own axis, with a dashed projection to the month's end */
  (function(){
    const H = 180, ch = H - T - B, pr = org.projection, pd = pr ? pr.days : 0, ns = nb + pd, slotW = (W - L - R) / ns;
    const cum = m.buckets[nb - 1].cum, nz = svNice(pr ? Math.max(cum, pr.total) : cum), top = nz.top;
    const y = v => T + ch - v / top * ch, cx = i => L + slotW * (i + .5);
    const scum = sser.map(a => { let c = 0; return a.map(v => (c += v)); });
    const stk = scum.map((_, k) => scum[0].map((__, i) => { let s = 0; for(let j = 0; j <= k; j++) s += scum[j][i]; return s; }));
    const ix = nb === 1 ? [0, 0] : m.buckets.map((_, i) => i), xs = nb === 1 ? (pd ? [cx(0), cx(0)] : [L + slotW * .3, L + slotW * .7]) : ix.map(cx);
    let g = gridOf(nz, y);
    slots.forEach((s, k) => {
      if(!(scum[k][nb - 1] > 0)) return;
      const hi = ix.map((i, p) => `${xs[p].toFixed(1)},${y(stk[k][i]).toFixed(1)}`), lo = ix.map((i, p) => `${xs[p].toFixed(1)},${y(k ? stk[k - 1][i] : 0).toFixed(1)}`).reverse();
      g += `<path d="M${hi.join('L')}L${lo.join('L')}Z" fill="${svColor(s)}" fill-opacity=".35"/><polyline points="${hi.join(' ')}" fill="none" stroke="${svColor(s)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    const endX = xs[xs.length - 1];
    g += lab(endX, y(cum), money(cum));
    if(pr){
      const x2 = cx(ns - 1);
      g += `<line class="svx-proj" x1="${endX.toFixed(1)}" y1="${y(cum).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y(pr.total).toFixed(1)}" style="stroke:var(--dim)" stroke-width="1.5" stroke-dasharray="4 4"/>` +
        `<circle cx="${endX.toFixed(1)}" cy="${y(cum).toFixed(1)}" r="3" style="fill:var(--dim)"/>` + lab(x2, y(pr.total), u('svProj', { v: money(pr.total) }));
    }
    const addDay = (s, k) => new Date(Date.parse(s + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
    const dayAt = i => i < nb ? m.buckets[i].a : addDay(days[days.length - 1], i - nb + 1);
    const every = Math.max(1, Math.ceil(ns / 8));
    for(let i = 0; i < ns; i++) if(i % every === 0) g += `<text x="${cx(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(dlabel(dayAt(i)))}</text>`;
    const hits = Array.from({ length: ns }, (_, i) => `<rect class="mv-hit" data-i="${i}" x="${(L + slotW * i).toFixed(1)}" y="0" width="${slotW.toFixed(1)}" height="${H - B}" fill="transparent"/>`).join('');
    cumEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(u('svAria2'))}">${g}<rect class="hv" width="${slotW.toFixed(1)}" y="${T}" height="${ch}" hidden/>${hits}</svg><div class="mv-tip" hidden></div>`;
    const tcum = m.teams.map(t => { let c = 0; return t.series.map(v => (c += v)); });
    hover(cumEl, i => {
      if(i >= nb) return `<b>${esc(dlabel(dayAt(i)))}</b>` + tr('svx-tt', esc(u('svProjTip', { v: '' }).trim()), money(cum + pr.avg * (i - nb + 1)));
      return `<b>${esc(cdate(m.buckets[i]))}</b>` + teamRows(tcum.map(a => a[i])) + tr('svx-tt', esc(u('svTot')), money(m.buckets[i].cum));
    });
  })();

  /* team table */
  const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4, int = v => Math.round(v).toLocaleString('en-US');
  const dChip = r => chipOf({ cur: r.sv, prev: r.prevSv, judge: 'good', fmt: money, prevLabel: o.prevLabel });
  table('svx:' + key).render(host.querySelector('.svx-t'), {
    rows: m.teams, sort: { col: 'sv', dir: -1 }, csvName: 'team-savings', pageSize: 15,
    onRow: o.onTeam ? r => o.onTeam(r.id) : undefined,
    columns: [
      { key:'rank', label:() => u('svcRank'), cls:'n', val: r => r.rank, cell: r => esc(r.rank) },
      { key:'team', label:() => u('svcTeam'), val: r => r.name, cell: r => `<i class="svx-dot" style="background:${svColor(r.slot)}"></i>${esc(r.name)}` },
      { key:'sv', label:() => u('svcSv'), cls:'n', first:-1, val: r => r.sv, cell: r => esc(money(r.sv)), csv: r => r4(r.sv) },
      { key:'share', label:() => u('svcShare'), cls:'n', first:-1, val: r => r.share, cell: r => `${esc(svPct(r.share))}<span class="bar"><i style="width:${Math.min(100, r.share * 100).toFixed(1)}%"></i></span>`, csv: r => r4(r.share) },
      { key:'delta', label:() => u('svcDelta'), cls:'n', first:-1, val: r => r.delta, csv: r => r4(r.delta),
        cell: r => { if(r.delta == null) return '-'; const c = dChip(r); return esc((r.delta > 0 ? '+' : r.delta < 0 ? '-' : '') + money(Math.abs(r.delta))) + svChip(c); } },
      { key:'trend', label:() => u('svcTrend'), noSort:true, noCsv:true, cell: r => r.series.length > 1 && r.sv > 0 ? `<span class="svx-sp" style="color:${svColor(r.slot)}">${sparkSvg(r.series)}</span>` : '-' },
      { key:'spend', label:() => u('svcSpend'), cls:'n', first:-1, val: r => r.tot, cell: r => esc(money(r.tot)), csv: r => r4(r.tot) },
      { key:'rate', label:() => u('svcRate'), cls:'n', first:-1, val: r => r.rate, cell: r => r.rate == null ? '-' : esc(svPct(r.rate)), csv: r => r4(r.rate) },
      { key:'mem', label:() => u('svcMem'), cls:'n', first:-1, val: r => r.perMember, cell: r => r.perMember == null ? '-' : esc(money(r.perMember)), csv: r => r4(r.perMember) },
      { key:'dl', label:() => u('svcDeleg'), cls:'n', first:-1, val: r => r.dl, cell: r => esc(int(r.dl)) }
    ]
  });
}

/* copyId: a member name that copies itself on click. One document listener serves every table, so a re-rendered row needs no wiring;
   the tables' row handlers already ignore clicks on buttons */
function copyId(text, shown){ return `<button type="button" class="cp-id" data-copy-id="${esc(text)}" title="${esc(u('cpTip'))}">${esc(shown ?? text)}</button>`; }
doc.addEventListener('click', async ev => {
  const b = ev.target.closest && ev.target.closest('.cp-id'); if(!b) return;
  const v = b.dataset.copyId; let ok = false;
  try{ await navigator.clipboard.writeText(v); ok = true; }
  catch(e){ const ta = doc.createElement('textarea'); ta.value = v; ta.style.cssText = 'position:fixed;opacity:0'; doc.body.appendChild(ta); ta.select(); try{ ok = doc.execCommand('copy'); }catch(e2){} ta.remove(); }
  b.dataset.cp = u(ok ? 'cpDone' : 'cpFail'); b.classList.toggle('bad', !ok); b.classList.add('on');
  clearTimeout(b._cpT); b._cpT = setTimeout(() => b.classList.remove('on', 'bad'), 1400);
});

window.AdminUX = { copyId, u, state, err, jump, kpis, rail, table, palette, hint, refreshHint, movement, seatSeries, savings, savingsModel, sinceUsage, sumUsage, prePrev, rateOf, workShare, usageKpis, ymd, esc };
})();
