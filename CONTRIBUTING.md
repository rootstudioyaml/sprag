# Contributing

Thanks for looking at Sprag. Bug reports, small fixes and documentation
corrections are all welcome. For anything bigger than a small fix, open an
issue first so we can agree on the shape before you spend time on it.

## Set up

Sprag needs Node.js 18 or newer.

```bash
git clone https://github.com/rootstudioyaml/sprag.git
cd sprag
npm install
npm test
```

`npm test` runs `node --test` over everything in `test/`, a little over a
thousand tests. Run it before you open a pull request. To run one file while you
work:

```bash
node --test test/release-notes.test.js
```

## Rules the test suite enforces

**Docs come in pairs.** User-facing documents are kept in English and Korean
side by side (`docs/X.md` and `docs/X.ko.md`, and `README.md` with
`README.ko.md`). If you change one half, change the other in the same pull
request. If you do not write Korean, say so in the pull request.

**`CLAUDE.md` and `AGENTS.md` stay identical from the first `##` section on.**
`CLAUDE.md` is read by Claude Code and `AGENTS.md` by Codex. Only the title and
the note under it may differ. `test/agents-md.test.js` compares the two, so edit
both together or the suite fails.

**Release notes are the changelog.** If your change is user-visible, add a line
to the newest `### vX.Y.Z` entry in `CHANGELOG.md`. Maintainers handle version
bumps, tags and publishing; see `docs/RELEASING.md` if you want the details.

## Commits and pull requests

- Keep each commit to one logical change, with a message that says what changed
  and why. Stage files by path rather than with `git add -A`, so unrelated edits
  do not slip into the commit.
- Add or update a test with every behaviour change. When a fix covers a rule
  that is copied in more than one place, update every copy and pin the match
  with a regression test in the same commit.
- Do not put personal identifiers in the repository: no real names, personal
  email addresses or local home paths in files, comments or fixtures.
- Open the pull request against `main` and describe what you ran to check it.

## Reporting problems

Use the issue templates for bugs and feature requests. For security problems,
follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
