# doc2md details

[← README](../README.md) · [한국어](./DOC2MD.ko.md)

## 📄 doc2md — documents become Markdown before the model reads them

Planning documents mostly arrive as pptx, xlsx, pdf, docx or fig, and handled as they are, one of two things happens. Claude Code refuses the file as binary and the model reads nothing, or the model unpacks the archive and burns tokens on the body XML. One 30MB deck is **540,000 tokens** of XML, which does not even fit in a 200k context window. A PDF attached whole costs 2,500–2,900 tokens a page, and `Read` takes a `.fig` as raw bytes that fill the context with noise. The savings section below measures each case.

doc2md converts the file once and hands over the Markdown instead. That same deck becomes 22,610 tokens.

**It turns on at install.** `sprag install` registers the hooks (since v3.32.0; set `SPRAG_NO_DOC2MD=1` to skip it, or run `sprag doc2md off` later). The converter is not in the install: it installs itself the first time a document shows up, as described below. Until it is there, the hooks have nothing to convert with and do nothing.

Three situations, three different interception points:

| Situation | Where it is caught |
|---|---|
| A document path typed in the prompt (`@path`, quoted, or relative) | `UserPromptSubmit`: converted, and the conversion's path is handed back as context |
| A document opened with `Read` mid-task | PDFs and `.fig` files are caught by `PreToolUse(Read)`. pptx/xlsx/docx are not: Claude Code refuses them as binary *before* any hook runs, so the session-start note tells the model to run `doc2md <path>` instead |
| A document attached to the message | **Not catchable.** No hook event receives attachment content. The session-start note has the model ask for a path next time |

That second row is measured, not assumed: a `.pdf` Read fires the hook, and a `.pptx` Read in the same session leaves no hook log entry at all. A `.fig` is not refused by `Read` (see the Figma section below), so it reaches the hook the way a PDF does.

```bash
sprag doc2md on                  # register the hooks again after `doc2md off` (the converter installs itself)
sprag doc2md                     # check converter + hook registration
sprag doc2md report.pptx         # convert by hand and see the result
sprag doc2md install-converter   # only to get the install out of the way early
```

**The converter installs itself.** Any rollout step a person has to be told about is a step some of them skip, so the converter installs in the background the moment a document first shows up, and converts as soon as it is ready. Measured: about 30s for the first document (15s install plus markitdown's first import), then 3.7s for a new document and 0.1s on a cache hit. The `.fig` parser installs in half a second on the first Figma file.

It installs on first use rather than at `install` time: the venv is 47MB, and someone who never opens a document should not pay for it. Set `SPRAG_DOC2MD_NO_AUTOINSTALL=1` to turn the automatic install off.

**Python 3.10+ is required** — markitdown's own floor, and macOS still ships 3.9 as `/usr/bin/python3`. The venv is built on an interpreter chosen by version rather than by PATH order. Built on 3.9, pip resolves markitdown to a 2019 placeholder release (0.0.1a1): the install looks like it worked and every conversion then dies at import. This was found by walking into it. When nothing on the machine is new enough, the message points at `brew install python` instead of at an install command that cannot succeed.

The converter goes into a venv this tool owns (`<state dir>/doc2md-venv`): no system interpreter is touched, and uninstalling the CLI takes it along. An existing markitdown on `uv tool` or `PATH` is preferred over building a new one.

Conversion is [markitdown](https://github.com/microsoft/markitdown). Slide numbers, heading levels, tables, speaker notes and per-sheet headings all survive, and non-Latin text comes through intact.

Several things it deliberately does not do:

- **Images are not converted.** markitdown returns nothing for them, and OCR misread resource names in testing (`c5.xlarge` as `c.xlarge`). In a document where those names *are* the content, wrong text is worse than none. The model reads images natively anyway.
- **A missing converter never fails silently.** The install command is shown once, then the original `Read` proceeds untouched. Repeating the notice on every read would be its own nuisance; saying nothing is how a broken converter hides. Run `doc2md` with no arguments to see the converter and hook registration together.
- **Conversions never land in your project.** They go under the tool's own state directory with mode `0700`, so there is nothing to add to `.gitignore`. Filenames matching payroll/contract/secret patterns are skipped entirely.
- **Zip bombs are refused.** pptx/xlsx/docx are zip containers: the declared sizes are checked first, and since those are written by whoever built the file, the real decompressed bytes are counted against a ceiling too.
- **Spreadsheets are capped by rows, not bytes.** Conversion time tracks row count (measured: a 6.3MB PDF in 0.9s, a 5.8MB workbook in 47.75s). Past 50,000 rows only the head is converted, and **the truncation and the true row count are both stated** in what the model is told.

### What a conversion saves

Every conversion is stamped with a provenance header: which original, when, how many tokens. Savings show up on the statusline's own `📄 Doc2md saved` line.

The baseline is what you would have done without a converter, and that differs by format. Both were measured on 2026-09-06.

**PDF is priced against attaching it.** The same one-line prompt was sent through `claude --print --input-format stream-json` with and without the file as a document block. The control turn cost 42,204 tokens, twice, to the token.

| Attached file | Size | Extra tokens | Per page |
|---|---|---|---|
| Report PDF | 7 pages | +20,537 | 2,934 |
| Report PDF | 5 pages | +12,709 | 2,542 |

An attached PDF is read whole, but every page costs 2,500–2,900 tokens against 5,531 for the conversion. The coefficient used is 2,500 per page — below both measurements, so the figure understates rather than flatters.

**pptx/xlsx/docx are priced against unpacking the container.** These never reach the model as attachments at all: the same probe on a docx added 78 tokens and the model replied that it had no file, and `Read` refuses the format outright. What you actually do without a converter is unzip the archive and read its XML, where tags and style attributes outweigh the words.

| Original | Body XML | Conversion | Ratio |
|---|---|---|---|
| Deck, pptx (31.8MB) | ~540,429 tokens | ~22,610 tokens | 23.8× |
| Business plan, docx (189KB) | ~79,621 tokens | ~1,684 tokens | 47.3× |

A single 30MB deck is 540,000 tokens as XML, which does not fit in a 200k context window. This baseline is measured per file from the real XML size, not applied as a per-format ratio. `.xls` is not a zip container and has no markup to measure, so it claims nothing.

If client behaviour changes, re-measure the attachment side with `scripts/doc2md-baseline.mjs` and swap only the values in the `ATTACHMENT_BASELINE` table in `src/doc2md-ledger.cjs`.

### Figma `.fig` converts too

Planning documents are moving from PowerPoint to Figma, so the same hook catches `.fig`. A `.fig` is a zip, but the `canvas.fig` inside it is Figma's private binary (kiwi format), which markitdown cannot open — so this one format is converted in Node with [openfig-core](https://github.com/OpenFig-org/openfig-core) (MIT). `doc2md install-converter` places it beside markitdown in the tool's state directory; the package itself still ships zero dependencies.

The result is an outline: pages and frames become headings, text nodes become body lines, and shapes are counted rather than listed — in a planning document the words are the content, and two hundred `Rectangle 173` lines would drown them. A file with no text at all is refused rather than dressed up as an empty document.

Verified against real files: a community Bootstrap UI kit (8.1MB, 4,155 nodes, 1,312 of them text) and a 52MB Tailwind kit, each converting in 0.2s into a 71.9KB and a 44KB outline, with Korean text surviving the round trip losslessly. Both `.fig` vintages parse — the current zip container and the older bare fig-kiwi stream.

**`.fig` saves the most of any format.** Unlike the Office containers, `Read` does not refuse a `.fig`: the extension means nothing to it, so it pulls the binary in as text and the context window fills with tokenised noise. Measured against the same 42,760-token control:

| File | Size | Extra tokens for a Read | Conversion |
|---|---|---|---|
| plan.fig | 26KB | +44,195 | 100 tokens |
| bootstrap-kit.fig | 8.1MB | +43,994 | 18,397 tokens |

Two files three hundred times apart in size cost the same, because Read truncates long before the file ends — you pay for a whole document and receive a fraction of one. The baseline is therefore a flat 44,000 tokens. For comparison, the same probe on a pptx cost +317 tokens and on a docx +185: a refusal message, and nothing else.

#### Why the baseline does not scale with file size

A baseline has to be what would actually have been spent without the converter. Intuition says a bigger file burns more, but the `Read` tool has a cap (2,000 lines by default, plus a per-line character limit), and a binary file hits it almost immediately: even the 26KB file was already truncated, which is why two files 300× apart came out 201 tokens apart. Had the 8.1MB file gone in whole it would have been millions of tokens — money nobody could have spent, since it does not fit in a 200k context window. Claiming to have saved unspendable money is flattery, not measurement.

The same principle runs through every baseline here:

- **`.fig`, flat 44,000** — set below both measurements (44,195 and 43,994). A model could burn size-proportional tokens by re-Reading at successive offsets, but one Read is what a sane agent does once the bytes turn out to be binary noise, so one Read is the honest counterfactual.
- **PDF, 2,500 per page** — below both measured values (2,542 and 2,934).
- **Office formats, the file's actual XML size** — the one case where proportional is right, because a person really does end up reading that XML; it is measured per file rather than applied as a ratio.

The common rule: wherever an estimate and a measurement diverge, the lower number wins. A figure the user can trust is worth more than one that flatters the tool.

### Editing a document: copy, then script

Conversion is one-way — editing the cached `.md` changes nothing in the source. The hook refuses `Edit`/`Write` on both the cache and the original binary, and points at the right path instead: copy the original, edit the copy with a script, re-convert the copy to verify.

`install-converter` puts the editing libraries (python-pptx, python-docx, openpyxl) in the same venv, so a structural request like "swap the chart on slide 23 for a line chart" is a short script the agent writes on the spot. `.fig` edits go through openfig-core, which encodes as well as parses.

All four formats were exercised end to end on 2026-09-06: 10 docx run replacements plus three consecutive re-saves, a pptx bar-to-line chart swap with an added data point, xlsx value edits and a new row, and a fig text edit with re-encode and re-parse. In every case the original was byte-identical afterwards and the re-converted copy showed the change. One caveat: removing a chart shape from a pptx leaves the old chart XML part orphaned — PowerPoint ignores it, but delete the part and its rels for a clean file. Charts and images never appear in a conversion, so visual edits must be confirmed in the application itself.

### DRM-wrapped documents

Encryption and DRM are detected differently but handled the same way. Enterprise DRM (Fasoo, MarkAny, SoftCamp and the like) does not password a document — it wraps the whole file, and only processes the vendor's agent has whitelisted ever see plaintext. Python is not one of them, so what sits on disk is ciphertext behind a vendor header, and **no password will open it.**

The first bytes decide which story to tell: a zip header means a truncated download, an OLE container means a password, and neither means the file is not that format at all.

```
✗ bad-archive: File is not a zip file            → download it again
✗ encrypted: password-protected Office file      → tell the user it cannot be read, and stop
✗ drm-protected: DRM-wrapped file (FASOO)        → tell the user it cannot be read, and stop
```

Vendor names are matched only as a hint in the diagnostic output; the classification stands without recognising the vendor. PDFs are judged the same way through their public DRM security-handler names (FOPN_foweb, EBX_HANDLER, Adobe.APS).

### Locked documents, and Windows

**A password-protected document is a state, not an error.** Office encrypts by wrapping the package in an OLE compound file rather than a zip, so opening one as a zip used to report "not a zip file" — which reads as a broken download and sends the user after the wrong problem. It is now identified before conversion:

```
✗ encrypted: password-protected Office file (OLE-wrapped)
✗ encrypted: password-protected PDF
```

The model is told to report that the contents cannot be read and not to work around it, and the original `Read` is refused. Company encryption is policy, so a document that will not open is the right outcome. This tool never asks for or stores a password. Claude Code refuses pptx, xlsx and docx as binary files before any settings hook runs, so the hook's notice cannot reach the model for those; the mod delivers it instead. A PDF that merely restricts printing still opens and still converts — checked against a false positive — and a legacy `.xls`, which is an OLE file by design, is not mistaken for an encrypted one.

**Windows is supported, and verified on a real Windows runner.** For teams with Windows machines:

- The Python search uses the `py -3` launcher. `python3` is rarely on PATH there, and a bare `python` may be the Store alias stub that opens a web page instead of running anything. Venv interpreters are looked for at `Scripts\python.exe`.
- The `.fig` parser installs through `npm.cmd` via the shell, and the package spec dropped its caret (`openfig-core@0.4.x`): in cmd.exe `^` is the escape character and never reaches npm.
- The background install and every child process set `windowsHide`, so no console window appears in the middle of someone's prompt.

`sprag doc2md --clean` empties the conversion cache; `doc2md off` removes the hook. Removal filters for this tool's own entry, so anything else you registered under `PreToolUse` stays.
