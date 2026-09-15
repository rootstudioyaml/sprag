# Releasing

Tagging and publishing are manual. This file exists because one step kept being
forgotten and the cost of forgetting it is now visible to every user: the
session-start upgrade offer reads the GitHub release body for the version it is
offering, so **a release with no body leaves the user with two version numbers
and no reason to upgrade.** v3.45.0 shipped that way, with a tag and no notes.

## Steps

```bash
# 1. The changelog entry IS the release notes. Write it first.
$EDITOR CHANGELOG.md          # add "### vX.Y.Z (YYYY-MM-DD)"

# 2. Version, tag, publish to npm.
npm version X.Y.Z             # writes package.json and tags
npm test && node scripts/verify-cli.mjs
npm publish
git push upstream main --follow-tags

# 3. Draft the release notes from that changelog section.
npm run release:notes X.Y.Z     # writes docs/releases/vX.Y.Z.md, prints what users will see
$EDITOR docs/releases/vX.Y.Z.md # translate; delete the TRANSLATE line when done

# 4. Publish the release, and commit the draft with it.
GITHUB_TOKEN=… npm run release:notes X.Y.Z -- --publish
git add docs/releases/vX.Y.Z.md && git commit -m "docs(release): notes for X.Y.Z"
```

Re-running step 4 updates the existing release rather than adding a second one,
so a correction is just another run.

## Why the draft is a committed file

It started in a temp directory, which was wrong three ways. A reboot takes the
translation with it. Nobody can review it: what a release tells every user is
worth a second pair of eyes, and a file outside the repository never reaches a
diff. And `os.tmpdir()` is not `/tmp` on macOS, so "edit the draft" and "publish
the draft" referred to two different files with the same name — which is how a
publish ran against untranslated text.

`docs/releases/` is not in `package.json`'s `files`, so the drafts stay out of the
npm tarball.

## What the draft has to look like

The upgrade offer shows **the first sentence of the first three bullets**, and
nothing else. Those three lines are what most users will ever read of a release,
so the body opens with one bullet per area of the release, each a complete
sentence, and puts the detail in sections below them. `npm run release:notes`
prints the three lines it would produce, so this is checkable before publishing
rather than after.

A body written as prose yields no bullets at all. That is handled — the offer
falls back to naming the version — but it wastes the chance to answer "why would
I upgrade".

## Language

The changelog is written in Korean and English mixed; releases on this public
repo have been English. So the extracted draft is a draft: `release:notes`
marks it with a `TRANSLATE` comment and `--publish` refuses to run until that
line is gone. Translate the bullets, keep the measurements.

## From a network that blocks GitHub writes

Reads to `api.github.com` are allowed on the corporate network here; writes are
intercepted and answered with a block page, which arrives as HTML where JSON
belongs. `release:notes --publish` recognises that and says so, rather than
looking like a bad token. Two ways through:

- Publish from a network that permits the write.
- Paste the draft into `https://github.com/rootstudioyaml/sprag/releases/new?tag=vX.Y.Z`.
  The script prints that URL and the draft's path when it hits the block.

Do not look for another endpoint or a proxy. The policy is the policy.

## Checking a release afterwards

```bash
# What the offer will show for the latest version, from the published release:
node -e "import('./src/update-check.js').then(async m => \
  console.log((await m.fetchHighlights('X.Y.Z')).join('\n')))"
```

Empty output means the release body carried no bullets, or the release does not
exist. Both are worth fixing before the next person upgrades.
