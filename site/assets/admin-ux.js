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
    noprior:'No data for the previous period', vs:'Previous period', new:'new',
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
    mvAria:'Seat movement: {joined} joined, {restored} restored, {left} left, {removed} removed, {paused} paused'
  },
  ko: {
    noprior:'비교할 이전 기간 데이터가 없습니다', vs:'이전 기간', new:'신규',
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
    mvAria:'좌석 변동: 참여 {joined}, 복원 {restored}, 나감 {left}, 제거 {removed}, 중지 {paused}'
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
.kc{--sc:var(--accent2);position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left;background:none;border:0;border-radius:0;color:inherit;padding:12px 16px 10px;box-shadow:inset -1px 0 0 var(--line),inset 0 -1px 0 var(--line);transition:background .12s var(--ease)}
button.kc:hover{background:var(--hover)}
button.kc:focus-visible{outline-offset:-2px}
.kc.sv{--sc:var(--ok)} .kc.lt{--sc:var(--warn)}
.kc .kl{font-size:12px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kc .kv{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.kc .kv b{font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1.25;white-space:nowrap;font-variant-numeric:tabular-nums}
.kc.sp .kv b{color:var(--accent2)} .kc.sv .kv b{color:var(--ok)} .kc.lt .kv b{color:var(--warn)}
.kc .ksub{display:block;font-size:12px;color:var(--faint)}
.kc .ksub .bar{display:block;margin-top:6px;max-width:none}
.kchip{display:inline-flex;align-items:center;gap:3px;font:500 11px/18px var(--mono);border-radius:4px;padding:0 6px;color:var(--dim);background:var(--surface2);border:1px solid var(--line2);white-space:nowrap}
html[lang=ko] .kchip{font-family:var(--sans);font-size:11.5px}
.kchip.up{color:var(--ok);background:rgba(63,212,143,.1);border-color:rgba(63,212,143,.3)}
.kchip.down{color:var(--bad);background:rgba(240,107,107,.1);border-color:rgba(240,107,107,.3)}
.kchip.dir.up,.kchip.dir.down{color:var(--accent2);background:var(--accent-bg);border-color:rgba(94,106,210,.35)}
.kchip .ar{font-size:8px;line-height:1}
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
.rail-i[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);color:var(--ink)}
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
.dt-s input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(94,106,210,.22);outline:0}
.dt-s input::-webkit-search-cancel-button{-webkit-appearance:none}
.dt-fs{display:flex;gap:6px var(--s3);flex-wrap:wrap;align-items:center}
.dt-fg{display:flex;gap:4px;flex-wrap:wrap}
.dt-fg + .dt-fg{padding-left:var(--s3);border-left:1px solid var(--line)}
.dt-chip{height:26px;padding:0 10px;border:1px solid var(--line2);border-radius:99px;background:none;color:var(--dim);font-size:12px;font-weight:500;white-space:nowrap;transition:border-color .15s var(--ease),background .15s var(--ease),color .15s var(--ease)}
.dt-chip:hover{border-color:var(--line3);color:var(--ink)}
.dt-chip[aria-pressed=true]{border-color:var(--accent);background:var(--accent-bg);color:var(--ink)}
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
.ux-state.ux-error{border-color:rgba(240,107,107,.35);background:rgba(240,107,107,.04);color:var(--ink)}
.ux-state.ux-error svg{color:var(--bad)}
.ux-state.ux-error p{color:var(--dim)}
.err .btn,.err .ux-retry{margin-left:var(--s3);height:24px;font-size:12px}

/* command palette */
.kbd-hint{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 8px 0 9px;border:1px solid var(--line2);border-radius:var(--r);background:var(--surface);color:var(--faint);font-size:12px;transition:border-color .15s var(--ease),color .15s var(--ease)}
.kbd-hint:hover{border-color:var(--line3);color:var(--ink)}
.kbd-hint svg{width:14px;height:14px}
.kbd-hint kbd{font:500 11px var(--mono);color:var(--dim);border:1px solid var(--line2);border-radius:4px;padding:1px 5px;background:var(--surface2)}
.pal-back{position:fixed;inset:0;z-index:200;display:flex;justify-content:center;align-items:flex-start;padding:14vh 16px 16px;background:rgba(5,5,8,.62);backdrop-filter:blur(3px)}
.pal-back[hidden]{display:none}
.pal{width:min(640px,100%);display:flex;flex-direction:column;max-height:min(520px,76vh);background:var(--surface2);border:1px solid var(--line2);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden}
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
.gtoast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:210;background:var(--surface2);border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-size:12.5px;color:var(--dim);box-shadow:0 8px 24px rgba(0,0,0,.45);white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
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
.mv-chart .hv{fill:rgba(255,255,255,.04)}
.mv-tip{position:absolute;top:0;z-index:3;pointer-events:none;background:var(--surface2);border:1px solid var(--line2);border-radius:var(--r);padding:6px 10px;font-size:12px;line-height:1.55;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.mv-tip b{display:block;font-weight:600}
.mv-tip i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.mv-note{margin-top:var(--s2);font-size:12px;color:var(--faint)}
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
           series:[n] | null, sub:html, text (plain string, no count-up), static, onClick} */
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

window.AdminUX = { u, state, err, jump, kpis, rail, table, palette, hint, refreshHint, movement, seatSeries, ymd, esc };
})();
