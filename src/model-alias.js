/**
 * model-alias — restore a usable model name when the transcript records a
 * gateway identifier instead of a Claude model id.
 *
 * Why this exists: behind a Bedrock / LiteLLM gateway, `message.model` in the
 * transcript is an inference-profile ARN:
 *
 *   converse/arn:aws:bedrock:<region>:<account>:application-inference-profile/<id>
 *
 * Nothing in that string says "opus" or "haiku", so `detectPricingTier()`
 * falls through to its Sonnet default. Everything downstream then reads the
 * session as Sonnet: `worthDelegating('T1', 1)` is false, so every T1 rule is
 * rejected, delegation savings aggregate to zero, and cost is under-counted.
 *
 * The fix is a single normalization point rather than a change to the pricing
 * table — plain aliases (`ap-northeast-2.anthropic.claude-opus-5[1m]`) are
 * already classified correctly, region prefix and `[1m]` suffix included. So
 * all that is missing is ARN → alias.
 *
 * Resolution order, cheapest first:
 *   1. not an ARN            → return the input unchanged (direct-API users
 *                              must keep their existing behaviour)
 *   2. user override         → `modelAliases` in profile-map.json
 *   3. learned mapping       → profile id → role, learned from transcripts
 *   4. otherwise             → 'unknown' (never a silent Sonnet guess)
 *
 * A profile id is never hardcoded here. Ids differ per account and change
 * with gateway config, and the ARN embeds a 12-digit AWS account id — this
 * package is published to npm, so neither may live in the source.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, dirname, basename } from 'node:path';
import { userDataDir, claudeUserDir } from './paths.js';

/** Marker returned when a gateway id could not be resolved to a model. */
export const UNKNOWN_MODEL = 'unknown';

/** File holding user overrides plus the learned profile→role votes. */
export function profileMapPath() {
  return join(userDataDir(), 'profile-map.json');
}

// `converse/` (LiteLLM) or a bare ARN, foundation- or application-scoped.
// `foundation-model` ARNs carry the model id directly in the resource part
// (`foundation-model/anthropic.claude-haiku-…`), so they are captured too.
const ARN_RE =
  /arn:aws:bedrock:[^:]*:[^:]*:(?:foundation-model|(?:application-)?inference-profile)\/([A-Za-z0-9._:-]+)/;

/** True when the id came from a Bedrock gateway rather than the Claude API. */
export function isGatewayModelId(model) {
  return typeof model === 'string' && model.includes('arn:aws:bedrock:');
}

/** The inference-profile id inside an ARN, or null when there is none. */
export function profileIdFrom(model) {
  if (typeof model !== 'string') return null;
  const m = ARN_RE.exec(model);
  return m ? m[1] : null;
}

/**
 * Roles a profile id can carry. 'main' is the session's own model, which the
 * env declares separately from the per-tier subagent overrides.
 */
const ROLES = ['main', 'opus', 'sonnet', 'haiku', 'fable'];

/**
 * Alias for a role, taken from the environment Claude Code itself uses to
 * pick subagent models. Returns null when the variable is absent or is itself
 * an ARN (resolving an ARN to another ARN would loop).
 */
export function aliasForRole(role, env = process.env) {
  const candidates = {
    main: [env.ANTHROPIC_MODEL, env.ANTHROPIC_DEFAULT_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL],
    opus: [env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_MODEL],
    sonnet: [env.ANTHROPIC_DEFAULT_SONNET_MODEL],
    haiku: [env.ANTHROPIC_DEFAULT_HAIKU_MODEL],
    fable: [env.ANTHROPIC_DEFAULT_FABLE_MODEL],
  }[role] || [];
  for (const v of candidates) {
    if (typeof v === 'string' && v && !isGatewayModelId(v)) return v;
  }
  return null;
}

// ── override / learned map storage ───────────────────────────────────────

let cached = null;

/** Read profile-map.json (memoized). Missing or corrupt file → empty map. */
export function loadProfileMap() {
  if (cached) return cached;
  let data = {};
  try {
    data = JSON.parse(readFileSync(profileMapPath(), 'utf8'));
  } catch { /* absent on first run, and unreadable is not fatal */ }
  cached = {
    version: 1,
    modelAliases: data.modelAliases && typeof data.modelAliases === 'object' ? data.modelAliases : {},
    learned: data.learned && typeof data.learned === 'object' ? data.learned : {},
    learnedAt: data.learnedAt || null,
    scannedSessions: data.scannedSessions || 0,
  };
  return cached;
}

export function saveProfileMap(map) {
  const dir = userDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(profileMapPath(), JSON.stringify(map, null, 2));
  cached = map;
}

/** Drop the memoized map. Tests use this after pointing paths elsewhere. */
export function resetModelAliasCache() {
  cached = null;
}

/**
 * Glob match for override keys, so a user can write one entry that hides the
 * account id and region: `arn:aws:bedrock:*:*:application-inference-profile/x`.
 */
function globMatch(pattern, value) {
  const rx = new RegExp(
    '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
  );
  return rx.test(value);
}

function overrideAlias(model, map) {
  for (const [pattern, alias] of Object.entries(map.modelAliases || {})) {
    if (globMatch(pattern, model)) return alias;
    // Overrides are usually written without the LiteLLM `converse/` prefix.
    const bare = model.slice(model.indexOf('arn:aws:bedrock:'));
    if (globMatch(pattern, bare)) return alias;
  }
  return null;
}

// ── resolution ───────────────────────────────────────────────────────────

/**
 * Normalize one transcript model id.
 * Non-gateway ids pass through untouched; gateway ids resolve to an alias, or
 * to 'unknown' when the mapping is not confident yet.
 */
export function resolveModelAlias(rawModel, { env = process.env } = {}) {
  if (!rawModel) return UNKNOWN_MODEL;
  const model = String(rawModel);
  if (!isGatewayModelId(model)) return model;

  const map = loadProfileMap();

  const override = overrideAlias(model, map);
  if (override) return override;

  const pid = profileIdFrom(model);
  if (!pid) return UNKNOWN_MODEL;

  // Self-describing resource ids need no learning: foundation-model ARNs and
  // system cross-region inference profiles both embed the model id
  // (`anthropic.claude-haiku-4-5-…` / `us.anthropic.claude-haiku-4-5-…`).
  // detectPricingTier() already classifies those strings, region prefix
  // included — only opaque application-profile ids (random hex) fall through
  // to the override / learned paths. Without this, a fresh gateway machine
  // reported every run as 'unknown' until enough sessions accumulated to
  // learn a mapping that the string had spelled out all along.
  if (/claude/i.test(pid)) return pid;

  const entry = map.learned?.[pid];
  if (entry?.role) {
    const alias = aliasForRole(entry.role, env);
    if (alias) return alias;
  }
  return UNKNOWN_MODEL;
}

// ── learning ─────────────────────────────────────────────────────────────

// A single observation can be wrong: the time-adjacent parent records leak
// into a naive join, and a mis-set agent definition mislabels one run. Require
// a few observations that mostly agree before trusting a mapping.
export const MIN_VOTES = 3;
export const MIN_AGREEMENT = 0.8;

/** Role named directly by a Task call's `model` parameter. */
function roleFromModelParam(value) {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  return ROLES.find((r) => r !== 'main' && v.includes(r)) || null;
}

/** Role declared in a subagent definition's frontmatter (`model: haiku`). */
function roleFromAgentType(agentType, cache) {
  if (!agentType) return null;
  if (cache.has(agentType)) return cache.get(agentType);
  let role = null;
  for (const dir of [join(claudeUserDir(), 'agents'), join(process.cwd(), '.claude', 'agents')]) {
    const file = join(dir, `${agentType}.md`);
    if (!existsSync(file)) continue;
    try {
      const head = readFileSync(file, 'utf8').slice(0, 2000);
      const m = /^model:\s*([A-Za-z0-9._-]+)/m.exec(head);
      if (m) role = roleFromModelParam(m[1]);
    } catch { /* unreadable definition just yields no vote */ }
    if (role) break;
  }
  cache.set(agentType, role);
  return role;
}

/**
 * Record one observation.
 *
 * `kind` matters more than the count. An 'explicit' vote comes from a stated
 * model — a `Task(model: "haiku")` parameter or an agent definition's
 * frontmatter. An 'inferred' vote is circumstantial: the record carried no
 * sidechain flag, so it is *probably* the parent session's own model. Mixing
 * the two by volume let 4 inferred votes outrank 1 explicit one and stamped a
 * haiku profile as 'main' — see tallyVotes.
 */
function addVote(votes, pid, role, kind) {
  if (!pid || !role) return;
  const v = (votes[pid] ||= { explicit: {}, inferred: {} });
  const bucket = v[kind] || (v[kind] = {});
  bucket[role] = (bucket[role] || 0) + 1;
}

/**
 * Read one main transcript: which profile id the session itself ran on, and
 * which role each Task/Agent tool_use asked for (joined later by tool_use id).
 */
async function scanMainTranscript(path, votes, requestedByToolUse, agentTypeCache) {
  let sawGateway = false;
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.includes('arn:aws:bedrock:') && !line.includes('"Task"') && !line.includes('"Agent"')) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = entry.message;
      if (!msg) continue;

      // The session's own model: the parent side of the transcript.
      if (msg.model && entry.isSidechain !== true) {
        const pid = profileIdFrom(msg.model);
        if (pid) {
          sawGateway = true;
          // Circumstantial: a subagent's records also land in the parent file
          // without the flag often enough to outvote real evidence.
          addVote(votes, pid, 'main', 'inferred');
        }
      }

      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_use') continue;
        if (block.name !== 'Task' && block.name !== 'Agent') continue;
        const input = block.input || {};
        const role = roleFromModelParam(input.model)
          || roleFromAgentType(input.subagent_type, agentTypeCache);
        if (block.id && role) requestedByToolUse.set(block.id, role);
      }
    }
  } finally {
    rl.close();
  }
  return sawGateway;
}

/** First profile id used by a subagent transcript (a run uses exactly one). */
async function subagentProfileId(path) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.includes('arn:aws:bedrock:')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const pid = profileIdFrom(entry.message?.model);
      if (pid) return pid;
    }
  } finally {
    rl.close();
  }
  return null;
}

/** Subagent transcripts a session spawned (mirrors subagent-records layout). */
async function subagentFiles(sessionPath) {
  const dir = join(dirname(sessionPath), basename(sessionPath, '.jsonl'), 'subagents');
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Whether two roles describe the same model. 'main' and 'opus' routinely do:
 * the session model is the opus alias on a default setup, so a Task that asked
 * for opus does not contradict "this is the parent's own profile".
 */
function rolesAgree(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const pair = new Set([a, b]);
  return pair.has('main') && pair.has('opus');
}

/** Winner of one bucket, with the counts needed to judge confidence. */
function topRole(tally) {
  let role = null;
  let top = 0;
  let total = 0;
  for (const [r, n] of Object.entries(tally || {})) {
    total += n;
    if (n > top) { top = n; role = r; }
  }
  return { role, top, total };
}

/**
 * Decide a role per profile id.
 *
 * Explicit evidence decides alone whenever there is enough of it; inferred
 * evidence is only consulted when the explicit bucket is too thin. Counting
 * both together is what produced the original mis-classification: a haiku
 * profile appeared 16 times in parent transcripts without a sidechain flag
 * against 1,702 times as a subagent, and those 16 inferred 'main' votes beat
 * the single explicit 'haiku' one at exactly the 80% line.
 *
 * When neither bucket is decisive the id stays unresolved. An 'unknown' that
 * drops out of the aggregate beats a confident wrong answer that silently
 * re-tiers every run on that profile.
 */
export function tallyVotes(votes, { minVotes = MIN_VOTES, minAgreement = MIN_AGREEMENT } = {}) {
  const learned = {};
  for (const [pid, buckets] of Object.entries(votes)) {
    // Legacy flat shape (`{ haiku: 3 }`) is read as explicit evidence.
    const split = buckets && (buckets.explicit || buckets.inferred)
      ? { explicit: buckets.explicit || {}, inferred: buckets.inferred || {} }
      : { explicit: buckets || {}, inferred: {} };

    const explicit = topRole(split.explicit);
    const inferred = topRole(split.inferred);

    let role = null;
    let source = null;
    if (explicit.total >= minVotes && explicit.top / explicit.total >= minAgreement) {
      role = explicit.role;
      source = 'explicit';
    } else if (inferred.total >= minVotes
      && inferred.top / inferred.total >= minAgreement
      && (explicit.total === 0 || rolesAgree(explicit.role, inferred.role))) {
      // Thin explicit evidence still vetoes a contradicting inference: one
      // stated `Task(model: "haiku")` outweighs any number of "no sidechain
      // flag, so probably the session model" observations.
      role = inferred.role;
      source = 'inferred';
    }

    learned[pid] = {
      role,
      source,
      votes: split,
      total: explicit.total + inferred.total,
    };
  }
  return learned;
}

/**
 * Learn profile id → role from transcripts and persist the result.
 *
 * The join is exact rather than time-windowed: `.meta.json` carries the
 * `toolUseId` of the Task block that spawned the run, and that block names the
 * model tier. A subagent transcript uses exactly one profile id, so the run's
 * id and the requested role identify each other.
 *
 * @param {object}   opts
 * @param {string[]} opts.sessionPaths transcripts to read, newest first
 * @param {number}   opts.maxSessions  cap on files read (learning is a scan)
 * @returns {Promise<{learned: object, scannedSessions: number, gateway: boolean}>}
 */
export async function learnProfileMapping({ sessionPaths = [], maxSessions = 40 } = {}) {
  const votes = {};
  const agentTypeCache = new Map();
  let scanned = 0;
  let gateway = false;

  for (const sessionPath of sessionPaths.slice(0, maxSessions)) {
    const requestedByToolUse = new Map();
    let sawGateway = false;
    try {
      sawGateway = await scanMainTranscript(sessionPath, votes, requestedByToolUse, agentTypeCache);
    } catch {
      continue;
    }
    scanned += 1;

    for (const jsonl of await subagentFiles(sessionPath)) {
      let meta = null;
      try {
        meta = JSON.parse(await readFile(jsonl.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      } catch { /* pre-toolUseId runs simply cast no vote */ }
      const role = (meta?.toolUseId && requestedByToolUse.get(meta.toolUseId))
        || roleFromAgentType(meta?.agentType, agentTypeCache);
      if (!role) continue;
      const pid = await subagentProfileId(jsonl);
      if (!pid) continue;
      sawGateway = true;
      // Stated evidence: the Task call named this tier, or the agent
      // definition it used did.
      addVote(votes, pid, role, 'explicit');
    }
    if (sawGateway) gateway = true;
  }

  const learned = tallyVotes(votes);
  const map = loadProfileMap();
  const next = {
    ...map,
    learned,
    learnedAt: new Date().toISOString(),
    scannedSessions: scanned,
  };
  // Nothing to record on a non-gateway machine — do not create the file there.
  if (gateway || Object.keys(map.learned || {}).length) saveProfileMap(next);
  return { learned, scannedSessions: scanned, gateway };
}
