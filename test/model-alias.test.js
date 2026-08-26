/**
 * Gateway model ids (Bedrock inference-profile ARNs) must resolve back to a
 * Claude alias, or to 'unknown' — never to a silent Sonnet guess, which is
 * what made every T1 delegation rule unreachable.
 *
 * Fixtures use a fictional account id (000000000000) and fictional profile
 * ids: this package is published to npm, so no real gateway identifier may
 * appear in the repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveModelAlias,
  resetModelAliasCache,
  saveProfileMap,
  loadProfileMap,
  profileIdFrom,
  isGatewayModelId,
  aliasForRole,
  tallyVotes,
  learnProfileMapping,
  UNKNOWN_MODEL,
} from '../src/model-alias.js';
import { modelRank, isUnknownModel, estimateCost } from '../src/cost.js';
import { worthDelegating } from '../src/route-scan.js';

const ACCOUNT = '000000000000';
const PID_MAIN = 'aaaa1111bbbb';
const PID_SONNET = 'cccc2222dddd';
const PID_HAIKU = 'eeee3333ffff';

const arn = (pid) =>
  `converse/arn:aws:bedrock:ap-northeast-2:${ACCOUNT}:application-inference-profile/${pid}`;

const OPUS_ALIAS = 'ap-northeast-2.anthropic.claude-opus-5[1m]';
const SONNET_ALIAS = 'ap-northeast-2.anthropic.claude-sonnet-5[1m]';
const HAIKU_ALIAS = 'global.anthropic.claude-haiku-4-5[1m]';

/** Point userDataDir() and the model env at a throwaway directory. */
function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cts-alias-'));
  const prev = {
    xdg: process.env.XDG_CONFIG_HOME,
    model: process.env.ANTHROPIC_MODEL,
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  };
  process.env.XDG_CONFIG_HOME = dir;
  process.env.ANTHROPIC_MODEL = OPUS_ALIAS;
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = OPUS_ALIAS;
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = SONNET_ALIAS;
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = HAIKU_ALIAS;
  resetModelAliasCache();
  t.after(() => {
    for (const [k, v] of [
      ['XDG_CONFIG_HOME', prev.xdg],
      ['ANTHROPIC_MODEL', prev.model],
      ['ANTHROPIC_DEFAULT_OPUS_MODEL', prev.opus],
      ['ANTHROPIC_DEFAULT_SONNET_MODEL', prev.sonnet],
      ['ANTHROPIC_DEFAULT_HAIKU_MODEL', prev.haiku],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetModelAliasCache();
  });
  return dir;
}

test('plain Claude ids pass through untouched (direct-API users unaffected)', (t) => {
  isolated(t);
  assert.equal(resolveModelAlias('claude-opus-4-7'), 'claude-opus-4-7');
  assert.equal(resolveModelAlias(OPUS_ALIAS), OPUS_ALIAS);
  assert.equal(resolveModelAlias('some-unknown-model'), 'some-unknown-model');
  assert.equal(resolveModelAlias(''), UNKNOWN_MODEL);
});

test('an ARN with no mapping resolves to unknown, not to Sonnet', (t) => {
  isolated(t);
  assert.equal(resolveModelAlias(arn(PID_MAIN)), UNKNOWN_MODEL);
  assert.equal(modelRank(UNKNOWN_MODEL), -1);
  assert.equal(worthDelegating('T1', modelRank(UNKNOWN_MODEL)), false);
  assert.equal(worthDelegating('T2', modelRank(UNKNOWN_MODEL)), false);
});

test('estimateCost still costs an unknown model without crashing', (t) => {
  isolated(t);
  const totals = {
    input: 5_000_000, cacheCreation: 0, cacheRead: 0,
    ephemeral5m: 0, ephemeral1h: 0, output: 1_000_000,
  };
  assert.ok(estimateCost(totals, UNKNOWN_MODEL).actual > 0);
  assert.ok(estimateCost(totals, null).actual > 0);
  assert.equal(isUnknownModel(null), true);
  assert.equal(isUnknownModel('claude-opus-5'), false);
});

test('ARN parsing accepts the converse/ prefix and the bare ARN', () => {
  assert.equal(profileIdFrom(arn(PID_HAIKU)), PID_HAIKU);
  assert.equal(
    profileIdFrom(`arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${PID_SONNET}`),
    PID_SONNET,
  );
  assert.equal(profileIdFrom('claude-opus-5'), null);
  assert.equal(isGatewayModelId('claude-opus-5'), false);
});

test('a wildcard override hides the account id and still matches', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    modelAliases: {
      [`arn:aws:bedrock:*:*:application-inference-profile/${PID_MAIN}`]: 'claude-opus-5',
    },
  });
  resetModelAliasCache();
  assert.equal(resolveModelAlias(arn(PID_MAIN)), 'claude-opus-5');
  assert.equal(modelRank(resolveModelAlias(arn(PID_MAIN))), 2);
});

test('a learned role resolves through the env alias and restores T1', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    learned: {
      [PID_MAIN]: { role: 'main', votes: { main: 40 }, total: 40 },
      [PID_SONNET]: { role: 'sonnet', votes: { sonnet: 32, main: 4 }, total: 36 },
      [PID_HAIKU]: { role: 'haiku', votes: { haiku: 4 }, total: 4 },
    },
  });
  resetModelAliasCache();

  const mainRank = modelRank(resolveModelAlias(arn(PID_MAIN)));
  assert.equal(mainRank, 2, 'the session model is opus again, not sonnet');
  assert.equal(worthDelegating('T1', mainRank), true, 'T1 rules are reachable again');
  assert.equal(modelRank(resolveModelAlias(arn(PID_SONNET))), 1);
  assert.equal(modelRank(resolveModelAlias(arn(PID_HAIKU))), 0);
});

test('an unconfident role stays unknown rather than guessing', (t) => {
  isolated(t);
  saveProfileMap({
    ...loadProfileMap(),
    learned: { [PID_SONNET]: { role: null, votes: { sonnet: 1, haiku: 1 }, total: 2 } },
  });
  resetModelAliasCache();
  assert.equal(resolveModelAlias(arn(PID_SONNET)), UNKNOWN_MODEL);
});

test('tallyVotes requires enough votes and enough agreement', () => {
  const learned = tallyVotes({
    tooFew: { sonnet: 2 },
    split: { sonnet: 5, main: 5 },
    clear: { sonnet: 32, main: 4 },
  });
  assert.equal(learned.tooFew.role, null, 'two observations is not a mapping');
  assert.equal(learned.split.role, null, '50/50 is not agreement');
  assert.equal(learned.clear.role, 'sonnet', '32 of 36 clears the 80% bar');
});

test('one stated vote outweighs several "no sidechain flag" inferences', () => {
  // The real mis-classification: a haiku profile appeared 16 times in parent
  // transcripts without the flag and once as a stated Task(model: "haiku").
  // Counting both buckets together made it 'main' at exactly the 80% line.
  const learned = tallyVotes({
    haikuProfile: { explicit: { haiku: 1 }, inferred: { main: 4 } },
  });
  assert.notEqual(learned.haikuProfile.role, 'main', 'must not be stamped as the session model');
  // Having vetoed the inference on that one stated vote, believe it: leaving
  // the id unresolved dropped every delegated run on the profile out of the
  // aggregate, which is how four T2 rules reported zero delegations.
  assert.equal(learned.haikuProfile.role, 'haiku', 'the vetoing evidence is the surviving evidence');
  assert.equal(learned.haikuProfile.source, 'explicit-veto');
});

test('a lone vote with nothing to contradict still needs the full threshold', () => {
  // The veto branch only fires against a decisive contradicting inference.
  // One stray Task(model:) on its own is still too thin to name a profile.
  const learned = tallyVotes({
    thin: { explicit: { haiku: 1 }, inferred: {} },
    thinAgreeing: { explicit: { haiku: 1 }, inferred: { haiku: 4 } },
  });
  assert.equal(learned.thin.role, null, 'no contradiction, no veto, not enough votes');
  assert.equal(learned.thinAgreeing.role, 'haiku');
  assert.equal(learned.thinAgreeing.source, 'inferred', 'agreement is not a veto');
});

test('enough stated votes decide on their own', () => {
  const learned = tallyVotes({
    haikuProfile: { explicit: { haiku: 3 }, inferred: { main: 900 } },
  });
  assert.equal(learned.haikuProfile.role, 'haiku');
  assert.equal(learned.haikuProfile.source, 'explicit');
});

test('inference still identifies the session model when nothing contradicts it', () => {
  const learned = tallyVotes({
    mainOnly: { explicit: {}, inferred: { main: 5937 } },
    // A Task that asked for opus does not contradict "this is the parent" —
    // on a default setup both names resolve to the same alias.
    mainWithOpusTasks: { explicit: { opus: 2 }, inferred: { main: 500 } },
  });
  assert.equal(learned.mainOnly.role, 'main');
  assert.equal(learned.mainOnly.source, 'inferred');
  assert.equal(learned.mainWithOpusTasks.role, 'main');
});

test('aliasForRole ignores an env value that is itself an ARN', () => {
  const env = { ANTHROPIC_DEFAULT_SONNET_MODEL: arn(PID_SONNET), ANTHROPIC_MODEL: OPUS_ALIAS };
  assert.equal(aliasForRole('sonnet', env), null);
  assert.equal(aliasForRole('main', env), OPUS_ALIAS);
});

test('learnProfileMapping joins a Task call to the run it spawned', async (t) => {
  const dir = isolated(t);
  const sessionPath = join(dir, 'session.jsonl');
  const toolUseId = 'toolu_test_haiku_1';

  const mainLines = [
    // The session's own model — three records so the 'main' role clears MIN_VOTES.
    ...[1, 2, 3].map((i) => ({
      isSidechain: false,
      timestamp: `2026-08-20T0${i}:00:00Z`,
      message: { model: arn(PID_MAIN), usage: { output_tokens: 10 }, id: `m${i}` },
    })),
    {
      isSidechain: false,
      timestamp: '2026-08-20T04:00:00Z',
      message: {
        model: arn(PID_MAIN),
        content: [{ type: 'tool_use', id: toolUseId, name: 'Task', input: { model: 'haiku' } }],
      },
    },
  ];
  writeFileSync(sessionPath, mainLines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const subDir = join(dir, 'session', 'subagents');
  mkdirSync(subDir, { recursive: true });
  for (const n of [1, 2, 3]) {
    const jsonl = join(subDir, `agent-${n}.jsonl`);
    writeFileSync(
      jsonl,
      JSON.stringify({
        isSidechain: true,
        message: { model: arn(PID_HAIKU), usage: { output_tokens: 5 }, id: `a${n}` },
      }) + '\n',
    );
    writeFileSync(
      jsonl.replace(/\.jsonl$/, '.meta.json'),
      JSON.stringify({ agentType: 'x', toolUseId, spawnDepth: 1 }),
    );
  }

  const { learned, gateway } = await learnProfileMapping({ sessionPaths: [sessionPath] });
  assert.equal(gateway, true);
  assert.equal(learned[PID_MAIN].role, 'main');
  assert.equal(learned[PID_HAIKU].role, 'haiku');

  resetModelAliasCache();
  assert.equal(modelRank(resolveModelAlias(arn(PID_MAIN))), 2);
  assert.equal(modelRank(resolveModelAlias(arn(PID_HAIKU))), 0);
});

test('a profile used as both session model and subagent resolves to the stated role', async (t) => {
  // Reproduces the observed failure: a haiku profile showed up in parent
  // transcripts without a sidechain flag more often than it was explicitly
  // named. Counting the buckets together confirmed it as the session model
  // (ranked as opus); vetoing without adopting left it unresolved, which drops
  // it from the T2 aggregate just as completely. It must resolve to haiku.
  const dir = isolated(t);
  const sessionPath = join(dir, 'leak.jsonl');
  const toolUseId = 'toolu_leak_1';

  const lines = [
    ...[1, 2, 3, 4].map((i) => ({
      isSidechain: false,
      timestamp: `2026-08-21T0${i}:00:00Z`,
      message: { model: arn(PID_HAIKU), usage: { output_tokens: 5 }, id: `leak${i}` },
    })),
    {
      isSidechain: false,
      timestamp: '2026-08-21T05:00:00Z',
      message: {
        model: arn(PID_MAIN),
        content: [{ type: 'tool_use', id: toolUseId, name: 'Task', input: { model: 'haiku' } }],
      },
    },
  ];
  writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const subDir = join(dir, 'leak', 'subagents');
  mkdirSync(subDir, { recursive: true });
  const jsonl = join(subDir, 'agent-1.jsonl');
  writeFileSync(
    jsonl,
    JSON.stringify({ isSidechain: true, message: { model: arn(PID_HAIKU), id: 'a1' } }) + '\n',
  );
  writeFileSync(
    jsonl.replace(/\.jsonl$/, '.meta.json'),
    JSON.stringify({ agentType: 'x', toolUseId, spawnDepth: 1 }),
  );

  const { learned } = await learnProfileMapping({ sessionPaths: [sessionPath] });
  assert.notEqual(learned[PID_HAIKU].role, 'main', 'the leak must not win');
  assert.equal(learned[PID_HAIKU].role, 'haiku', 'the stated Task(model:) decides');
  assert.equal(learned[PID_HAIKU].source, 'explicit-veto');

  resetModelAliasCache();
  assert.equal(modelRank(resolveModelAlias(arn(PID_HAIKU))), 0, 'priced as haiku, not excluded');
});

test('a direct-API machine learns nothing and writes no profile map', async (t) => {
  isolated(t);
  const dir = mkdtempSync(join(tmpdir(), 'cts-plain-'));
  const sessionPath = join(dir, 'plain.jsonl');
  writeFileSync(
    sessionPath,
    JSON.stringify({
      isSidechain: false,
      message: { model: 'claude-opus-5', usage: { output_tokens: 10 }, id: 'p1' },
    }) + '\n',
  );
  const { learned, gateway } = await learnProfileMapping({ sessionPaths: [sessionPath] });
  assert.equal(gateway, false);
  assert.deepEqual(learned, {});
});

test('self-describing ARNs resolve without learning or env vars', (t) => {
  isolated(t);
  // foundation-model ARN: the resource IS the model id
  const fm = resolveModelAlias(
    'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
  );
  assert.equal(fm, 'anthropic.claude-haiku-4-5-20251001-v1:0');
  assert.equal(modelRank(fm), 0, 'classified as haiku tier');
  // system cross-region inference profile: region-prefixed model id
  const sys = resolveModelAlias(
    'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-5-v1:0',
  );
  assert.equal(sys, 'us.anthropic.claude-opus-5-v1:0');
  assert.equal(modelRank(sys), 2, 'classified as opus tier');
  // opaque application profile ids still require override/learning
  assert.equal(
    resolveModelAlias('converse/arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123'),
    UNKNOWN_MODEL,
  );
});
