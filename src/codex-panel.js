import { resolve, relative, isAbsolute } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readPanelBinding } from './codex-panel-session.js';
import { discoverCodexSessionFiles, parseCodexSessionFile } from './codex-parser.js';
import { codexHarnessStatus, codexRatchetCandidates } from './codex-harness.js';
import { harnessListRules, findProjectRoot } from './harness.js';
import { loadConfig, statuslineDefaults } from './config.js';
import { glyphsFor } from './glyphs.js';
import { gaugeBar, formatMoney } from './formatters/statusline.js';
import { codexCacheTimer } from './codex-cache.js';
import { readCodexCachePolicy, readCodexPrices, isDirectOpenAI } from './codex-cache-policy.js';
import { codexIssues } from './codex-brief.js';
import { labelForKey } from './window-labels.js';
import { resolveLabelMode } from './statusline-mode.js';
import { formatResetIn } from './format-time.js';
import { codexDocumentTotals } from './codex-doc2md-ledger.js';
import { codexHookStatus } from './codex-installer.js';
import { koreanStyleEnabled } from './korean-style.js';
import { codexRoutingSavedTotals } from './codex-ledger.js';
import { readCodexRouteScan, openCodexCandidates } from './codex-route-scan.js';
import { codexBudgetProvider } from './codex-budget.js';

export const CODEX_SEGMENT_ORDER = [
  'cap-warn', 'usage', 'ctx', 'ttl', 'model', 'effort',
  'hit', 'saved', 'doc2md', 'harness', 'korean', 'version',
];

// Only cache full-session parses. A moving time cutoff would make an unchanged
// file's cached totals stale. The panel reports session totals, not window totals.
export function createPanelReader({ root = process.cwd(), home, sessionId: pinnedId, sessionFile, days = 7, readBudget = () => null,
  readCachePolicy = (session) => readCodexCachePolicy(session, { home }), hasFlag = () => false } = {}) {
  if (pinnedId && sessionFile) throw new Error('Choose --session or --session-file, not both.');
  const cache = new Map();
  const ratchetCache = new Map();
  const ratchetFor = (session) => {
    if (!session?.filePath) return [];
    try {
      const s = statSync(session.filePath);
      const key = `${s.mtimeMs}:${s.size}`;
      // Candidates expire by age, so a quiet file still needs a periodic re-read.
      const hit = ratchetCache.get(session.filePath);
      if (hit?.key === key && Date.now() - hit.at < 60000) return hit.value;
      const value = codexRatchetCandidates(session.filePath);
      ratchetCache.clear();
      ratchetCache.set(session.filePath, { key, at: Date.now(), value });
      return value;
    } catch { return []; }
  };
  return async function readPanel() {
    const binding = sessionFile ? readPanelBinding(sessionFile) : null;
    const sessionId = pinnedId || binding?.sessionId;
    const selection = sessionFile ? 'bound' : pinnedId ? 'pinned' : 'project';
    let files;
    if (binding?.transcriptPath) {
      try {
        const s = await stat(binding.transcriptPath);
        if (s.isFile()) files = [{ path: binding.transcriptPath, mtime: s.mtimeMs, size: s.size }];
      } catch { /* A resumed or archived session may have moved. Search by ID. */ }
    }
    // A missing binding must never fall back to another session in the project.
    files ??= sessionFile && !sessionId ? [] : await discoverCodexSessionFiles({ home, days: sessionId ? Infinity : days });
    const existing = new Set(files.map((f) => f.path));
    for (const path of cache.keys()) if (!existing.has(path)) cache.delete(path);
    let selected = null;
    let matches = 0;
    const seen = new Set();
    for (const f of files.slice().reverse()) {
      let entry = cache.get(f.path);
      if (!entry || entry.mtime !== f.mtime || entry.size !== f.size) {
        try {
          entry = { ...f, session: await parseCodexSessionFile(f.path) };
          cache.set(f.path, entry);
        } catch { continue; }
      }
      const s = entry.session;
      if ((!sessionId || sessionFile) && s.isSubagent) continue;
      if (sessionId ? s.sessionId !== sessionId : !insideProject(root, s.projectDir)) continue;
      const key = s.sessionId || s.filePath;
      if (seen.has(key)) continue;
      seen.add(key);
      matches++;
      // Activity timestamps survive archive moves that update filesystem mtime.
      if (!selected || (s.lastActivity?.getTime() || 0) > (selected.lastActivity?.getTime() || 0)) selected = s;
    }
    const project = selected?.projectDir ? findProjectRoot(selected.projectDir, { agent: 'codex' }) : root;
    const cfg = loadConfig();
    const harness = {};
    const rules = {};
    let hooks;
    try { hooks = codexHookStatus(); } catch { hooks = null; }
    for (const scope of ['project', 'global']) {
      try { harness[scope] = codexHarnessStatus({ root: project, scope }); }
      catch (e) { harness[scope] = { error: e.message }; }
      try { rules[scope] = harnessListRules({ root: project, scope, agent: 'codex' }).rules.length; }
      catch { rules[scope] = null; }
    }
    let route = [];
    try { route = openCodexCandidates(readCodexRouteScan(), { root: project }); } catch { /* No scan yet. */ }
    let routingSaved = null;
    try { routingSaved = { ...codexRoutingSavedTotals(), pricesAvailable: isDirectOpenAI(selected?.provider, home ? { home } : {}) || !!readCodexPrices({ provider: codexBudgetProvider(home ? { home } : {}), ...(home ? { home } : {}) }) }; }
    catch { /* Unreadable ledger reads as n/a. */ }
    return { session: selected, matches, root, sessionId, selection, bindingPending: !!sessionFile && !sessionId, days, harness, rules,
      ratchet: ratchetFor(selected), route, routingSaved,
      labelMode: resolveLabelMode({ cfg: statuslineDefaults(), hasFlag }).mode,
      color: statuslineDefaults().color,
      timer: !hasFlag('--no-timer') && (hasFlag('--timer') || statuslineDefaults().timer),
      cacheTtl: cfg?.codex?.cacheTtl ?? 'auto',
      cachePolicy: selected ? await readCachePolicy(selected) : null,
      hooks,
      documents: codexDocumentTotals({ home }),
      budget: readBudget(),
      korean: koreanStyleEnabled(cfg),
      lint: cfg?.koreanStyle?.lint || 'block',
      cohesion: cfg?.cohesion?.enabled === true,
      brief: cfg?.codex?.brief !== false,
      delegate: cfg?.codex?.delegate === true,
      doc2md: cfg?.codex?.doc2md !== false && process.env.CTS_NO_DOC2MD !== '1',
      updatedAt: new Date() };
  };
}

function insideProject(root, cwd) {
  if (!cwd) return false;
  const canonical = (path) => {
    try { return realpathSync(path); } catch { return resolve(path); }
  };
  const rel = relative(canonical(root), canonical(cwd));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}

// Transcript strings must never supply terminal control sequences. Restrict
// dynamic labels to printable ASCII so column counts remain exact on any font.
export function terminalText(value) {
  return String(value ?? '').replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

const number = (n) => Number.isFinite(n) ? n.toLocaleString('en-US') : 'n/a';
const short = (n) => !Number.isFinite(n) ? 'n/a' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : 'n/a';
const gauge = (n) => {
  if (!Number.isFinite(n)) return '[------------]';
  const ticks = n <= 0 ? 0 : n >= 100 ? 12 : Math.max(1, Math.min(11, Math.round(n * 12 / 100)));
  return `[${'#'.repeat(ticks)}${'.'.repeat(12 - ticks)}]`;
};
function age(date, now) {
  if (!date) return 'unknown';
  const seconds = Math.max(0, Math.floor((now - new Date(date)) / 1000));
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
function windowLabel(minutes, fallback) {
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}m`;
}

export function effortLabel(value) {
  return value === 'none' ? 'Reasoning off' : value ? terminalText(value) : 'Effort unknown';
}

const signedMoney = (usd) => usd < 0 ? `-${formatMoney(-usd)}` : formatMoney(usd);

/** Measured routing savings, or the reason they are unknown. Never a fabricated zero. */
function routingChip(totals, chip) {
  if (!totals?.runs) {
    return chip(`Routing saved n/a (${totals?.pricesAvailable ? 'no attributed runs' : 'prices unavailable'})`);
  }
  if (!totals.priced) return chip(`Routing saved n/a (${totals.runs} runs unpriced)`);
  const unpriced = totals.runs - totals.priced;
  return chip(`Routing saved ${signedMoney(totals.week)} (7d) / ${signedMoney(totals.total)} total${unpriced ? ` +${unpriced} unpriced` : ''}`,
    totals.total < 0 ? 33 : 32);
}

function sessionLabel(data) {
  const id = data.sessionId || data.session?.sessionId;
  const label = data.selection === 'bound' ? 'session' : data.sessionId ? 'pinned' : 'latest project';
  return `${label}${id ? ` ...${terminalText(id).slice(-8)}` : ''}`;
}

// Labels from logs are ASCII-sanitized; only our known glyphs need wide cells.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function panelCellWidth(text) {
  return [...graphemes.segment(text.replace(/\x1b\[[0-9;]*m/g, ''))].reduce((n, { segment }) =>
    n + (/^[\p{Mark}\u200d]+$/u.test(segment) ? 0 : segment.includes('\ufe0f') || segment.codePointAt(0) >= 0x1f000 ? 2 : 1), 0);
}

function panelGroups(data, { now, version = '', full = false, mode = full ? 'text' : data.labelMode || 'icon' }) {
  const g = glyphsFor(mode);
  const icon = (key) => mode === 'text' ? '' : `${g[key]} `;
  const s = data.session;
  const input = s ? s.totals.input + s.totals.cacheRead : null;
  const context = s?.contextWindow && s.lastContextTokens != null ? s.lastContextTokens / s.contextWindow * 100 : null;
  const h = data.harness?.project?.configured ? data.harness.project : data.harness?.global;
  const registry = new Map();
  const register = (name, group, chips) => registry.set(name, { group, chips: chips.filter(Boolean) });
  const chip = (text, tone = 90) => ({ text, tone });
  const level = (n) => n >= 90 ? 31 : n >= 70 ? 33 : 32;
  const bar = (n) => full ? gauge(n) : gaugeBar(n, mode === 'text' ? 'narrow' : mode);
  const warnings = [];
  if (data.error) warnings.push(chip(`ERROR: ${terminalText(data.error)}`, 31));
  for (const issue of codexIssues(s, { now })) {
    const key = issue.key.slice(6), win = s.rateLimits?.[key];
    const text = issue.key === 'context' ? `WARNING: Ctx ${pct(context)}`
      : `WARNING: ${windowLabel(win.window_minutes, key)} limit ${pct(win.used_percent)}`;
    warnings.push(chip(text, issue.level === 'critical' ? 31 : 33));
  }
  register('ctx', 'priority', context !== null ? [chip(full
    ? `Ctx ${bar(context)} ${pct(context)}  ${short(s.lastContextTokens)} / ${short(s.contextWindow)}`
    : `${icon('ctx')}Ctx ${short(s.contextWindow)} ${bar(context)} ${pct(context)}`, level(context))] : []);
  const timer = data.timer === false ? null : codexCacheTimer(s, { now, ttl: data.cacheTtl, policy: data.cachePolicy });
  register('ttl', 'priority', s && timer ? [chip(`${icon('ttl')}${timer.text}`, timer.tone)] : []);
  register('model', 'priority', [chip(s ? `${full ? 'Model ' : icon('model')}${terminalText(s.model)}`
    : `SPRAG / Waiting for session ${data.bindingPending ? 'binding' : 'log'}`, 35)]);
  register('effort', 'priority', s ? [chip(`${icon('effort')}${effortLabel(s.effort)}`, 36), chip(sessionLabel(data)),
    s.status && chip(terminalText(s.status), s.status === 'working' ? 36 : 90)] : []);
  const limits = [];
  const budget = data.budget;
  if (Number.isFinite(budget?.maxBudget) && budget.maxBudget > 0 && Number.isFinite(budget.spend)) {
    const used = Math.max(0, budget.spend / budget.maxBudget * 100);
    const label = labelForKey('litellm_budget');
    const prefix = mode === 'text' ? '' : `${mode === 'narrow' ? label.narrowIcon : label.icon} `;
    const stale = !budget.checkedAt || now - budget.checkedAt > 600000;
    const reset = Number.isFinite(budget.budgetResetAt) ? budget.budgetResetAt : null;
    if (used >= 90 && !stale && (reset === null || reset > now)) warnings.push(chip(`WARNING: Budget ${Math.round(used)}%`, used >= 100 ? 31 : 33));
    limits.push(chip(`${prefix}${full ? 'Budget' : 'budget'} ${bar(used)} ${Math.round(used)}% ${formatMoney(budget.spend)}/${formatMoney(budget.maxBudget)}` +
      (reset === null ? '' : reset <= now ? ' / awaiting reset update' : ` ${icon('reset')}${formatResetIn(reset / 1000, new Date(now))}`) +
      (budget.source === 'user' ? ' (user limit)' : '') + (stale ? ' STALE' : ''), stale ? 33 : level(used)));
  }
  for (const key of ['primary', 'secondary']) {
    const win = s?.rateLimits?.[key];
    if (!Number.isFinite(win?.used_percent)) continue;
    const reset = Number.isFinite(win.resets_at) ? win.resets_at * 1000 : null;
    const elapsed = reset !== null && reset <= now;
    const stale = !s.rateLimitsAt || now - new Date(s.rateLimitsAt) > 300000;
    limits.push(chip(`${windowLabel(win.window_minutes, key)} ${bar(win.used_percent)} ${pct(win.used_percent)} used` +
      (reset === null ? '' : elapsed ? ' / awaiting new usage' : ` ${icon('reset')}${formatResetIn(win.resets_at, new Date(now))}`) +
      (stale ? ' STALE' : ''), elapsed || stale ? 33 : level(win.used_percent)));
  }
  if (limits.length && s?.rateLimitsAt) limits.push(chip(`snapshot ${age(s.rateLimitsAt, now)}`));
  register('cap-warn', 'priority', warnings);
  register('usage', 'priority', limits);
  register('hit', 'totals', input > 0 ? [chip(`${icon('hit')}Cache hit ${pct(s.totals.cacheRead / input * 100)} (session)`,
    s.totals.cacheRead / input >= 0.85 ? 32 : s.totals.cacheRead / input >= 0.7 ? 33 : 31)] : []);
  register('saved', 'totals', s ? [
    chip(`${icon('hit')}Cache reused ${short(s.totals.cacheRead)} tokens`, 32),
    chip(`In ${short(input)}`), chip(`Out ${short(s.totals.output)}`),
    chip(`Reasoning ${short(s.reasoningOutputTokens)} (in output)`),
  ] : []);
  const docs = data.documents;
  register('doc2md', 'documents', docs?.scope === 'codex-total' && docs.docs > 0 ? [
    chip(`${icon('doc')}Doc2md ${number(docs.docs)} docs (Codex total)`, 32),
    ...(docs.byExt || []).map((row) => chip(`${terminalText(row.ext)} ${number(row.docs)}x`)),
  ] : []);
  register('harness', 'preferences', [
    chip(`${icon('harness')}Harness ${h?.error ? 'ERROR' : h ? `${h.configured}/${h.total}` : 'n/a'}`, h?.configured === 5 ? 32 : 33),
    chip(`Ratchet ${data.rules?.global ?? '?'}/${data.rules?.project ?? '?'}`),
    // A repeated failure outranks a delegation candidate, as in the Claude statusline.
    data.ratchet?.length ? chip(`ratchet? #${data.ratchet[0].id} x${data.ratchet[0].count}`, 33) : null,
    data.route?.length ? chip(`route? R${data.route[0].id} ${terminalText(data.route[0].category)}${data.route.length > 1 ? ` +${data.route.length - 1}` : ''}`, 33) : null,
  ]);
  register('korean', 'preferences', [
    chip(`${icon('korean')}Korean ${data.korean ? `on/${data.lint}` : 'off'}`),
    ...(data.cohesion ? [chip(`Cohesion ${data.korean ? 'via Korean' : 'on'}`)] : []),
    chip(`${icon('doc')}Doc2md ${data.doc2md ? 'on' : 'off'} (prefs)`),
    ...(data.hooks ? [chip(`Hooks ${data.hooks.filter((hook) => hook.registered).length}/${data.hooks.length} registered`)] : []),
    ...(data.brief !== undefined ? [chip(`Brief ${data.brief ? 'on' : 'off'}`)] : []),
    ...(data.delegate !== undefined ? [chip(`Delegate ${data.delegate ? 'on' : 'off'} (model routing)`)] : []),
    routingChip(data.routingSaved, chip),
  ]);
  register('version', 'preferences', [
    chip(`SPRAG${version ? ` v${terminalText(version)}` : ''} / ${s ? age(s.lastActivity, now) : 'waiting'}`,
      s && (!s.lastActivity || now - new Date(s.lastActivity) > 300000) ? 33 : 90),
  ]);
  // Keep session measurements together, before lifetime document counts.
  const groups = [];
  let lastGroup;
  for (const name of CODEX_SEGMENT_ORDER) {
    const entry = registry.get(name);
    if (!entry?.chips.length) continue;
    if (lastGroup !== entry.group) groups.push([]);
    groups.at(-1).push(...entry.chips);
    lastGroup = entry.group;
  }
  return groups;
}

function wrapPanelGroups(groups, { width, color }) {
  const lines = [];
  const paint = ({ text, tone }) => color ? `\x1b[${tone}m${text}\x1b[0m` : text;
  for (const group of groups) {
    let line = '', used = 0;
    for (const segment of group) {
      const size = panelCellWidth(segment.text);
      if (used && used + 3 + size > width) { lines.push(line); line = ''; used = 0; }
      if (size > width) {
        let part = '';
        for (const { segment: ch } of graphemes.segment(segment.text)) {
          if (panelCellWidth(part + ch) > width) { lines.push(paint({ ...segment, text: part })); part = ''; }
          if (panelCellWidth(ch) <= width) part += ch;
        }
        line = paint({ ...segment, text: part }); used = panelCellWidth(part);
      } else {
        line += (used ? paint({ text: ' | ', tone: 90 }) : '') + paint(segment);
        used += (used ? 3 : 0) + size;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function compactPanel(data, { width, height, color, now, version = '' }) {
  const lines = wrapPanelGroups(panelGroups(data, { now, version }), { width, color });
  const visible = lines.slice(0, height);
  // Make hidden rows explicit rather than silently dropping trailing metrics.
  if (lines.length > height && height > 1) {
    const text = `+${lines.length - height + 1} more rows`.slice(0, width);
    visible[height - 1] = color ? `\x1b[90m${text}\x1b[0m` : text;
  }
  return visible.join('\n');
}

/** Plain ASCII layout first; ANSI color is applied after width/height clipping. */
export function formatCodexPanel(data, { columns = 100, rows = 30, color = true, now = Date.now(), version = '', compact = false } = {}) {
  const width = Math.max(1, Math.floor(columns) || 80);
  const height = Math.max(1, Math.floor(rows) || 24);
  const lines = [];
  const add = (text = '', tone = '') => {
    const clean = terminalText(text);
    // Wrap at spaces; hard-wrap long IDs so even a narrow split stays bounded.
    if (!clean) { lines.push({ text: '', tone }); return; }
    let rest = clean;
    while (rest.length > width) {
      const space = rest.lastIndexOf(' ', width);
      const at = space > width / 2 ? space : width;
      lines.push({ text: rest.slice(0, at), tone });
      rest = rest.slice(at).trimStart();
    }
    lines.push({ text: rest, tone });
  };
  add(`SPRAG / CODEX${version ? `  v${version}` : ''}`, 'cyan');
  const s = data.session;
  if (compact) {
    return compactPanel(data, { width, height, color, now, version });
  }
  const last = s?.lastActivity ? new Date(s.lastActivity).getTime() : null;
  const stale = !last || now - last > 5 * 60000;
  const groups = panelGroups(data, { now, version, full: true });
  for (const text of wrapPanelGroups(groups, { width, color })) lines.push({ text });
  add(s ? `LOG ${stale ? 'STALE' : 'RECENT'} | updated ${age(s.lastActivity, now)} | ${sessionLabel(data)}`
    : data.bindingPending ? 'WAITING / session binding not received' : 'WAITING / no matching session log', stale ? 'yellow' : 'green');
  if (s?.branch) add(`Branch ${s.branch} (recorded)`);
  if (data.hooks) add('Hook trust: check Codex /hooks', 'dim');
  add('Cost n/a (session) | Cache expiry not reported', 'dim');
  add();
  add(`Project: ${s?.projectDir || data.root}`);
  add(`Session: ${s?.sessionId || data.sessionId || 'none'}`);
  if (s) {
    add(`Session totals: ${number(s.requestCount)} usage updates`);
    add(`Input ${number(s.totals.input + s.totals.cacheRead)} / cached ${number(s.totals.cacheRead)}`);
    add(`Output ${number(s.totals.output)} / reasoning ${number(s.reasoningOutputTokens)} (included)`);
    add(`Peak input ${number(s.maxContextPerRequest)} | matching sessions ${data.matches}`);
  } else add(`Discovery: last ${data.days} days. Waiting for Codex rollout JSONL usage.`, 'dim');
  const footer = `Refreshed ${new Date(data.updatedAt || now).toISOString().slice(11, 19)} UTC | r refresh | q quit`;
  // Keep the footer visible, including when the terminal is resized mid-frame.
  const visible = lines.slice(0, Math.max(0, height - 1));
  visible.push({ text: footer.slice(0, width), tone: 'dim' });
  const tones = { cyan: 36, green: 32, yellow: 33, red: 31, dim: 90 };
  return visible.map(({ text, tone }) => color && (tones[tone] || typeof tone === 'number') ? `\x1b[${tones[tone] || tone}m${text}\x1b[0m` : text).join('\n');
}

export async function runCodexPanel({ read, interval = 2000, once = false, color = true, version = '', compact = false, input = process.stdin, output = process.stdout, fitRows = () => {}, onFrame = () => {}, onClose = () => {} } = {}) {
  if (!Number.isFinite(interval) || interval < 500 || interval > 60000) throw new Error('--interval must be between 0.5 and 60 seconds');
  if (!once && (!input.isTTY || !output.isTTY)) throw new Error('Live panel requires a terminal. Use --once for piped output.');
  let stopped = false;
  let timer;
  let lastData = { root: process.cwd() };
  let previousLines = [];
  let previousSize = '';
  let wake;
  const wait = () => new Promise((done) => {
    wake = () => { clearTimeout(timer); wake = null; done(); };
    timer = setTimeout(wake, interval);
  });
  const stop = () => { stopped = true; wake?.(); };
  const key = (buf) => {
    if (/[q\x03\x04]/i.test(String(buf))) stop();
    else if (/r/i.test(String(buf))) wake?.();
  };
  const wasRaw = !!input.isRaw;
  const paused = input.isPaused();
  const draw = () => {
    const columns = output.columns || 100, rows = output.rows || 30;
    const text = formatCodexPanel(lastData, { columns: columns - (once ? 0 : 1), rows: rows - (once ? 0 : 1), color: color && lastData.color !== false, version, compact });
    if (once) { output.write(text + '\n'); return; }
    const lines = text.split('\n');
    const size = `${columns}x${rows}`;
    const resized = size !== previousSize;
    // A full erase and newline repaint moves the terminal's IME anchor through
    // the whole split. Address only changed rows, without scrolling or reflow.
    let frame = resized ? '\x1b[H\x1b[2J' : '';
    const count = resized ? lines.length : Math.max(lines.length, previousLines.length);
    for (let i = 0; i < count; i++) {
      if (resized || lines[i] !== previousLines[i]) frame += `\x1b[${i + 1};1H${lines[i] || ''}\x1b[K`;
    }
    if (frame) output.write(frame);
    previousLines = lines;
    previousSize = size;
    onFrame(lastData);
  };
  try {
    if (!once) {
      output.write('\x1b[?1049h\x1b[?25l');
      input.setRawMode(true);
      input.resume();
      input.on('data', key);
      output.on('resize', draw);
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      process.on('SIGHUP', stop);
    }
    do {
      try { lastData = await read(); }
      catch (e) { lastData = { ...lastData, error: e.message }; }
      if (stopped) break;
      if (compact && !once) fitRows(formatCodexPanel(lastData, { columns: (output.columns || 100) - 1, rows: 10000, color: false, compact: true }).split('\n').length);
      draw();
      if (once) break;
      await wait();
    } while (!stopped);
  } finally {
    clearTimeout(timer);
    if (!once) {
      input.off('data', key);
      output.off('resize', draw);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
      input.setRawMode(wasRaw);
      if (paused || input.listenerCount('data') === 0) input.pause();
      output.write('\x1b[0m\x1b[?25h\x1b[?1049l');
      onClose();
    }
  }
}
