# Releasing

Tagging and publishing are manual. This file exists because one step kept being
forgotten, and the cost of forgetting it is now visible to every user: the
session-start upgrade offer reads the GitHub release body for the version it is
offering, so **a release with no body leaves the user with two version numbers
and no reason to upgrade.** v3.45.0 shipped that way — a tag, and no notes.

Everything here runs from a network that permits writes to `api.github.com` and
`registry.npmjs.org`. Reads are enough for development; the release itself is not
possible from a network that intercepts those writes (see
[the last section](#from-a-network-that-blocks-github-writes)).

## The order matters

Notes are written and translated **before** the version is bumped, because the
suite checks them: `test/release-notes.test.js` asserts that the shipped version
has a translated draft. Bump first and `npm test` fails at a point where the tag
already exists.

```bash
# ── 1. Write the changelog entry. It IS the release notes. ──────────────
$EDITOR CHANGELOG.md                    # add "### vX.Y.Z (YYYY-MM-DD)"

# ── 2. Draft the notes from that entry, and translate them. ─────────────
node scripts/release-notes.mjs X.Y.Z    # writes docs/releases/vX.Y.Z.md
                                        # and prints the three lines users will see
$EDITOR docs/releases/vX.Y.Z.md         # translate; delete the TRANSLATE line

# ── 3. Verify. This is the gate for everything above. ──────────────────
npm test                                # fails if the draft is missing or untranslated
node scripts/verify-cli.mjs

# ── 4. Bump, tag, publish to npm. ─────────────────────────────────────
npm version X.Y.Z                       # writes package.json, commits, tags
npm publish                             # sprag-cli
git push upstream main --follow-tags

# ── 5. Publish the GitHub release from the draft. ──────────────────────
# The token is read from the environment. Export it in the shell rather than
# writing it on the command line: an inline secret lands in shell history, and
# from there into a paste or a screenshot.
export GITHUB_TOKEN=…            # or GH_TOKEN
node scripts/release-notes.mjs X.Y.Z --publish

# ── 6. Confirm what users will be shown. ──────────────────────────────
node -e "import('./src/update-check.js').then(async m => \
  console.log((await m.fetchHighlights('X.Y.Z')).join('\n')))"
```

Step 5 updates an existing release rather than adding a second one, so a
correction to the notes is just another run of it.

Step 2 refuses to overwrite a draft that has already been translated — it is the
same command you ran before translating, so re-running it by reflex would discard
the translation. Pass `--force` to start the draft over deliberately.

Step 6 reads the *published* release, not the local file. Empty output means the
body carried no bullets or the release does not exist — either way the upgrade
offer will fall back to a bare version number, so fix it before the next person
upgrades.

## What the draft has to look like

The upgrade offer shows **the first sentence of the first three bullets**, and
nothing else. Those three lines are what most users will ever read of a release.

So the body opens with one bullet per area of the release, each a complete
sentence that stands alone, and puts the detail in sections below them:

```markdown
- **The statusline stops garbling under IntelliJ.** A new `narrow` label mode
  keeps a glyph on every chip, using only characters the font ships.
- **Figures are grouped by the timeframe they cover,** so a window label claims
  the two figures it measures rather than the whole line.
- **Registered delegation rules actually get used** — rule text is half as long.

---

## The statusline stops garbling under IntelliJ

<the measurements, the cause, what was ruled out>

* the individual changes
```

`release-notes.mjs` prints the three lines it would produce, so this is
checkable before publishing rather than after. The first draft of v3.45.0 opened
with one area's details and spent all three lines there, never mentioning the
other two — which the printed preview is what caught.

A body written entirely as prose yields no bullets. That is handled (the offer
names the version and stops), but it wastes the one chance to answer "why would
I upgrade".

## Language

The changelog is Korean and English mixed; releases on this public repo are
English. So what `release-notes.mjs` extracts is a *draft*: it writes a
`TRANSLATE` marker at the top, and `--publish` refuses while that line is there.

Translate the bullets and keep the measurements — "1296 episodes, 337 eligible,
12 delegated" is the part that makes a release note worth reading.

## Why the draft is a committed file

It started in a temp directory, which was wrong three ways:

- A reboot takes the translation with it.
- Nobody can review it. What a release tells every user deserves a second pair of
  eyes, and a file outside the repository never reaches a diff.
- `os.tmpdir()` is not `/tmp` on macOS, so "edit the draft" and "publish the
  draft" referred to two different files with the same name. A publish ran
  against untranslated text because of exactly that.

`docs/releases/` is not in `package.json`'s `files`, so the drafts stay out of
the npm tarball. Verify with `npm pack --dry-run` if you change that list.

## Commit identity

This is a public repo, and the local config is already set so a corporate email
never lands in it:

```
user.name   root.studio.yaml
user.email  275496454+rootstudioyaml@users.noreply.github.com
```

A fresh clone inherits the global config instead, which may carry a work
address. Check `git config --local user.email` before the first commit on a new
machine.

## The legacy package name

Releases go out under `sprag-cli`. The older `claude-token-saver` name is
deprecated on npm and no longer receives publishes; installed copies still hear
about new versions because `update-check` always queries the canonical name.
`scripts/publish-legacy.mjs` exists for the one-off case of needing to publish
under the old name again — it is not part of a normal release.

## From a network that blocks GitHub writes

On the corporate network here, reads to `api.github.com` are allowed and writes
are intercepted: the response is a block page, HTML where JSON belongs.
`release-notes.mjs --publish` recognises that shape and says the network refused
the write, rather than looking like a bad token.

A 403 is not enough on its own to tell the two apart, and reading every 403 as a
blocked write sent a reader to the wrong network once. So the body decides: a 403
carrying GitHub's own JSON (`Resource not accessible by personal access token`)
is GitHub refusing, and the fix is on the token — a fine-grained token needs
`Contents: write` on `rootstudioyaml/sprag` before it can create a release.

Steps 4 and 5 both need writes, so a release cannot be completed there. Two ways
through:

- Run steps 4 to 6 from a network that permits the writes. The draft is committed,
  so nothing has to be carried across by hand.
- Paste the draft into the release form:
  `https://github.com/rootstudioyaml/sprag/releases/new?tag=vX.Y.Z`. Note that
  `github.com/login` is also blocked here, so an existing browser session is
  required — a fresh login is not possible on this network.

Do not look for another endpoint or a proxy. The policy is the policy.

## If a release already went out without notes

Add the changelog section if it is missing, draft and translate as in steps 1 and
2, then run step 5 alone. The tag and the npm package are already correct; only
the release body is missing, and `--publish` creates it against the existing tag.

## Pending as of 91c693d

Two releases have their steps 1 and 2 done — changelog written, notes drafted and
translated — and are waiting for a network that can perform the writes:

- **v3.45.0** is tagged and on npm with no release body. Run step 5 alone.
- **v3.46.0** is not tagged yet. Run steps 3 through 6.

Both drafts are in `docs/releases/`. Nothing has to be carried across by hand;
`git pull` is enough.
