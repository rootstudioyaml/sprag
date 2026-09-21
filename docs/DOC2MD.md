# doc2md 상세 문서

doc2md 의 절감 산정 기준, `.fig` 변환, 문서 수정 절차, DRM·암호 문서 처리, Windows 지원을 다룹니다. 기능 개요는 [README 의 doc2md 절](../README.ko.md#-doc2md-문서를-읽기-전에-markdown-으로-바꿉니다)에 있습니다.

### 변환이 얼마를 아끼는지

변환본은 첫머리에 출처 주석을 답니다. 어떤 원본을 언제 변환했고 몇 토큰인지가 파일을 여는 순간 보입니다. 절감액은 스테이터스라인의 절감 줄 끝에 `📄 Doc2md saved` 로 붙습니다.

절감액의 기준은 변환기가 없을 때 실제로 하게 되는 일이고, 그 일이 형식마다 다릅니다. 두 경우 모두 2026-09-06 에 실측했습니다.

**PDF 는 첨부와 비교합니다.** `claude --print --input-format stream-json` 으로 같은 한 줄 프롬프트를 첨부 있이·없이 보내고 입력 토큰을 비교했습니다. 대조군은 42,204 토큰이었고 두 번 반복해 값이 같았습니다.

| 첨부 파일 | 분량 | 첨부가 더 든 토큰 | 페이지당 |
|---|---|---|---|
| 보고서 PDF | 7페이지 | +20,537 | 2,934 |
| 보고서 PDF | 5페이지 | +12,709 | 2,542 |

PDF 는 첨부하면 모델이 내용을 그대로 읽습니다. 대신 페이지마다 2,500~2,900 토큰이 붙어서, 변환본(5,531 토큰)의 서너 배가 듭니다. 계수는 두 실측치보다 낮은 페이지당 2,500 을 씁니다. 넉넉히 잡아 부풀리는 것보다 낮게 잡아 밑도는 편이 낫습니다.

**pptx·xlsx·docx 는 압축을 푸는 경우와 비교합니다.** 이 형식들은 애초에 첨부로 모델에 닿지 않습니다. 같은 방식으로 docx 를 보냈더니 78 토큰만 늘었고 모델은 파일이 없다고 답했으며, `Read` 도 이진 파일이라며 거부합니다. 그래서 변환기가 없을 때 실제로 하게 되는 일은 압축을 풀고 본문 XML 을 읽는 것입니다. 태그와 스타일 속성이 글자 수의 대부분을 차지하는 그 XML 말입니다.

| 원본 | 본문 XML | 변환본 | 차이 |
|---|---|---|---|
| 발표자료 pptx (31.8MB) | 약 540,429 토큰 | 약 22,610 토큰 | 23.8배 |
| 사업계획서 docx (189KB) | 약 79,621 토큰 | 약 1,684 토큰 | 47.3배 |

30MB 짜리 발표자료 하나가 XML 로는 54만 토큰입니다. 200k 컨텍스트에는 들어가지도 않습니다. 이 기준은 형식별 계수가 아니라 파일마다 실제 XML 크기를 재서 씁니다.

`.xls` 는 zip 컨테이너가 아니라 재어 볼 마크업이 없으므로 절감을 0 으로 둡니다.

클라이언트 동작이 바뀌면 `scripts/doc2md-baseline.mjs` 로 첨부 쪽을 다시 재고, `src/doc2md-ledger.cjs` 의 `ATTACHMENT_BASELINE` 표에 값만 갈아 끼우면 됩니다.

### 피그마 `.fig` 도 변환합니다

기획서가 PPT 에서 피그마로 옮겨 가는 추세를 따라, `.fig` 파일도 같은 훅이 잡습니다. `.fig` 는 zip 컨테이너지만 안에 든 `canvas.fig` 가 피그마의 비공개 바이너리(kiwi 포맷)라 markitdown 이 열지 못하므로, 이 형식만 Node 파서([openfig-core](https://github.com/OpenFig-org/openfig-core), MIT)로 변환합니다. `doc2md install-converter` 가 markitdown 과 함께 도구 상태 디렉터리에 설치하며, 패키지 자체는 여전히 무의존성입니다.

변환 결과는 페이지·프레임 계층을 헤딩으로, 텍스트 노드를 본문으로 정리한 아웃라인입니다. 도형·벡터 같은 시각 요소는 나열하지 않고 개수만 남깁니다. 기획서에서 내용은 글이고, `Rectangle 173` 이 이백 줄 나오면 글이 묻히기 때문입니다. 텍스트가 하나도 없는 파일(순수 그래픽)은 빈 문서로 꾸미지 않고 변환 불가로 알립니다.

실제 파일로 검증했습니다: 피그마 커뮤니티의 Bootstrap UI kit(8.1MB, 노드 4,155개, 텍스트 1,312개)와 Tailwind kit(52MB)이 각각 0.2초 안에 71.9KB·44KB 아웃라인으로 변환됐고, 한국어 텍스트 왕복도 무손실이었습니다. `.fig` 는 두 세대가 있습니다. 요즘 익스포트는 zip 컨테이너, 옛 익스포트는 fig-kiwi 바이너리 원형인데 둘 다 처리합니다.

**`.fig` 의 절감이 가장 큽니다.** 오피스 형식과 달리 `Read` 가 `.fig` 를 거부하지 않습니다. 확장자를 모르니 이진 파일을 그대로 텍스트로 읽어들이고, 컨텍스트가 토큰화된 잡음으로 찹니다. 같은 42,760 토큰 대조군으로 측정했습니다.

| 파일 | 크기 | Read 가 더 쓴 토큰 | 변환본 |
|---|---|---|---|
| plan.fig | 26KB | +44,195 | 100 토큰 |
| bootstrap-kit.fig | 8.1MB | +43,994 | 18,397 토큰 |

크기가 300배 차이인데 비용이 같습니다. Read 가 상한에서 자르기 때문인데, 바꿔 말하면 **문서 전체 값을 치르고 일부만 받습니다.** 그래서 기준선은 파일 크기와 무관한 44,000 토큰 고정입니다. 참고로 같은 방법으로 재보니 pptx 는 +317, docx 는 +185 토큰이었습니다. 거부 메시지 한 줄이 전부입니다.

#### 왜 파일 크기에 비례시키지 않는가

기준선은 "변환이 없었으면 실제로 나갔을 비용"이어야 합니다. 직관으로는 파일이 클수록 더 태울 것 같지만, `Read` 도구에는 상한이 있어(기본 2,000줄, 줄당 문자 제한) 이진 파일은 그 지점에서 잘립니다. 26KB 파일조차 이미 상한을 넘기므로, 크기가 300배 차이 나는 두 파일이 201 토큰 차이로 같은 값이 나왔습니다. 8.1MB 가 통째로 들어갔다면 수백만 토큰인데, 그 돈은 200k 컨텍스트에 물리적으로 들어가지 않아 애초에 아무도 지불할 수 없습니다. 지불할 수 없는 돈을 아꼈다고 적으면 부풀리기가 됩니다.

이 원칙은 세 곳에 일관되게 적용됩니다.

- **`.fig` 44,000 고정**: 실측 두 값(44,195·43,994)보다 낮게 잡습니다. 모델이 offset 을 바꿔 가며 반복 Read 하면 크기에 비례해 태울 수는 있지만, 첫 Read 에서 이진 잡음임이 드러나면 정상적인 에이전트는 더 읽지 않으므로 1회 Read 가 현실적인 대안입니다.
- **PDF 페이지당 2,500**: 실측치 2,542·2,934 를 밑도는 값입니다.
- **오피스 형식은 파일별 실제 XML 크기**: 이쪽은 사람이 정말 그 XML 을 읽게 되므로 비례가 맞고, 계수 대신 파일마다 잽니다.

공통 규칙: 기준선이 추정과 실측 사이에서 갈리면 항상 낮은 쪽을 택합니다. 도구를 돋보이게 하는 숫자보다 사용자가 신뢰할 수 있는 숫자가 가치 있습니다.

### 문서를 수정해야 할 때: 복사본 + 스크립트

변환은 단방향이라 변환본 .md 를 고쳐도 원본에는 반영되지 않습니다. 훅이 변환 캐시와 원본 이진 파일을 Edit·Write 로 고치려는 시도를 거부하면서 올바른 경로를 안내합니다. 원본을 복사하고, 복사본을 스크립트로 수정하고, 수정본을 doc2md 로 재변환해 검증하는 순서입니다.

`install-converter` 가 편집 라이브러리(python-pptx·python-docx·openpyxl)를 변환기 venv 에 함께 설치하므로, "23번 슬라이드 차트를 꺾은선으로 바꿔줘" 같은 구조 편집도 에이전트가 그 지점에서 스크립트로 처리할 수 있습니다. `.fig` 는 openfig-core 가 인코더까지 제공해 텍스트 수정 후 재인코드가 됩니다.

네 형식 모두 실제로 몇 바퀴 돌려 검증했습니다(2026-09-06): docx 텍스트 치환 10건과 3회 연속 재저장, pptx 막대→꺾은선 차트 교체와 데이터 행 추가, xlsx 값 정정·행 추가, fig 텍스트 수정·재인코드·재파싱. 전 케이스에서 원본은 바이트 그대로였고, 수정본 재변환에 변경 내용이 반영됐습니다. 한 가지 주의: pptx 에서 차트 도형을 제거하면 옛 차트 XML 파트가 고아로 남습니다. PowerPoint 는 무시하지만, 깔끔히 하려면 파트와 rels 도 지우십시오. 차트·이미지 같은 시각 요소는 변환본에 잡히지 않으므로, 시각 편집의 최종 확인은 해당 프로그램에서 해야 합니다.

### DRM 으로 보호된 문서

암호와 DRM 은 다른 문제이고 해법도 다릅니다. 사내 DRM(파수·마크애니·소프트캠프 등)은 문서에 암호를 거는 것이 아니라 파일 전체를 감싸며, 벤더 에이전트가 허용한 프로그램만 평문을 봅니다. 파이썬은 거기 없으므로 디스크에 있는 것은 벤더 헤더가 붙은 암호문입니다. **암호를 입력해서 풀 수 있는 문제가 아닙니다.**

판별은 첫 바이트가 무엇을 말하는지로 갈립니다. zip 헤더면 내려받다 끊긴 파일, OLE 컨테이너면 암호 걸린 문서, 둘 다 아니면 애초에 그 형식이 아닙니다.

```
✗ bad-archive: File is not a zip file            ← 다시 받으십시오
✗ encrypted: password-protected Office file      ← 암호를 푼 사본을 요청하십시오
✗ drm-protected: DRM-wrapped file (FASOO)        ← DRM 해제본이나 반출 승인 사본을 요청하십시오
```

벤더 이름은 어느 클라이언트로 가야 하는지 알려 주려고 맞춰 볼 뿐이고, 판별 자체는 벤더를 몰라도 성립합니다. PDF 는 공개된 DRM 보안 핸들러 이름(FOPN_foweb·EBX_HANDLER·Adobe.APS)으로 같은 판정을 합니다.

### 암호가 걸린 문서와 Windows

**암호 문서는 오류가 아니라 상태로 다룹니다.** 사내에서 받는 문서 중 일부는 암호가 걸려 있습니다. 이전에는 암호 걸린 docx 를 "손상된 zip"이라고 알려서 사용자가 원인을 엉뚱한 곳에서 찾게 만들었습니다. 암호가 걸린 Office 문서는 zip 이 아니라 OLE 복합 문서로 저장되기 때문입니다. 지금은 변환 전에 판별해서 이렇게 알립니다.

```
✗ encrypted: password-protected Office file (OLE-wrapped)
✗ encrypted: password-protected PDF
```

모델에게는 암호를 푼 사본을 사용자에게 요청하라고 안내합니다. 이 도구는 암호를 묻지도 저장하지도 않습니다. 어느 경우에도 원본 `Read` 를 막지 않으므로 작업이 중단되지 않습니다. 열람은 자유롭고 인쇄만 제한된 PDF 는 암호 문서가 아니므로 그대로 변환합니다(오탐 확인 완료). 구형 `.xls` 도 원래 OLE 형식이라 암호로 오인하지 않습니다.

**Windows 를 지원하며, 실제 Windows 러너에서 검증합니다.** Windows 를 쓰는 팀이 있어 다음을 맞췄습니다.

- 파이썬 탐색이 `py -3` 런처를 씁니다. Windows 에서는 `python3` 가 PATH 에 없는 경우가 많고, 맨 `python` 은 실행 대신 마이크로소프트 스토어를 여는 별칭 스텁일 수 있습니다. venv 기반 인터프리터도 `Scripts\python.exe` 경로로 찾습니다.
- `.fig` 파서 설치가 `npm.cmd` 를 셸로 호출합니다. 그리고 패키지 지정자에서 캐럿을 뺐습니다(`openfig-core@0.4.x`). cmd.exe 에서 `^` 는 이스케이프 문자라 npm 에 닿기 전에 먹힙니다.
- 백그라운드 자동 설치와 모든 하위 프로세스에 `windowsHide` 를 걸어, 프롬프트 도중에 콘솔 창이 튀어나오지 않게 했습니다.

`claude-token-saver doc2md --clean` 으로 변환 캐시를 비우고, `doc2md off` 로 훅을 제거합니다. 훅 해제는 자기 항목만 골라 지우므로 `PreToolUse` 에 등록해 둔 다른 훅은 그대로 남습니다.



---

## From the README (English)

## 📄 doc2md — documents become Markdown before the model reads them

`Read` a pptx, xlsx, pdf or docx and the raw bytes go into the context window, where the model cannot read them. This intercepts that `Read`, converts the file once, and hands over the Markdown instead.

**This is opt-in.** Installing the CLI does not turn it on: both commands below are required, and a registered hook with no converter behind it does nothing at all.

Three situations, three different interception points:

| Situation | Where it is caught |
|---|---|
| A document path typed in the prompt (`@path`, quoted, or relative) | `UserPromptSubmit`: converted, and the conversion's path is handed back as context |
| A document opened with `Read` mid-task | PDFs are caught by `PreToolUse(Read)`. pptx/xlsx/docx/fig are not: Claude Code refuses them as binary *before* any hook runs, so the session-start note tells the model to run `doc2md <path>` instead |
| A document attached to the message | **Not catchable.** No hook event receives attachment content. The session-start note has the model ask for a path next time |

That second row is measured, not assumed: a `.pdf` Read fires the hook, and a `.pptx` Read in the same session leaves no hook log entry at all.

```bash
sprag doc2md on                  # register the hooks (the converter installs itself)
sprag doc2md                     # check converter + hook registration
sprag doc2md report.pptx         # convert by hand and see the result
sprag doc2md install-converter   # only to get the install out of the way early
```

**The converter installs itself.** Any rollout step a person has to be told about is a step some of them skip, so the converter installs in the background the moment a document first shows up, and converts as soon as it is ready. Measured: about 30s for the first document (15s install plus markitdown's first import), then 3.7s for a new document and 0.1s on a cache hit. The `.fig` parser installs in half a second on the first Figma file.

It installs on first use rather than at `install` time: the venv is 47MB, and someone who never opens a document should not pay for it. Set `CTS_DOC2MD_NO_AUTOINSTALL=1` to turn the automatic install off.

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

This baseline is measured per file from the real XML size, not applied as a per-format ratio. `.xls` is not a zip container and has no markup to measure, so it claims nothing.

### Figma `.fig` converts too

Planning documents are moving from PowerPoint to Figma, so the same hook catches `.fig`. A `.fig` is a zip, but the `canvas.fig` inside it is Figma's private binary (kiwi format), which markitdown cannot open — so this one format is converted in Node with [openfig-core](https://github.com/OpenFig-org/openfig-core) (MIT). `doc2md install-converter` places it beside markitdown in the tool's state directory; the package itself still ships zero dependencies.

The result is an outline: pages and frames become headings, text nodes become body lines, and shapes are counted rather than listed — in a planning document the words are the content, and two hundred `Rectangle 173` lines would drown them. A file with no text at all is refused rather than dressed up as an empty document.

Verified against real files: a community Bootstrap UI kit (8.1MB, 4,155 nodes, 1,312 of them text) and a 52MB Tailwind kit, each converting in under a second. Both `.fig` vintages parse — the current zip container and the older bare fig-kiwi stream.

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

Encryption and DRM are different problems with different answers. Enterprise DRM (Fasoo, MarkAny, SoftCamp and the like) does not password a document — it wraps the whole file, and only processes the vendor's agent has whitelisted ever see plaintext. Python is not one of them, so what sits on disk is ciphertext behind a vendor header, and **no password will open it.**

The first bytes decide which story to tell: a zip header means a truncated download, an OLE container means a password, and neither means the file is not that format at all.

```
✗ bad-archive: File is not a zip file            → download it again
✗ encrypted: password-protected Office file      → ask for an unlocked copy
✗ drm-protected: DRM-wrapped file (FASOO)        → ask for a copy released from DRM
```

Vendor names are matched only to say which client to go to; the classification stands without recognising the vendor. PDFs are judged the same way through their public DRM security-handler names (FOPN_foweb, EBX_HANDLER, Adobe.APS).

### Locked documents, and Windows

**A password-protected document is a state, not an error.** Office encrypts by wrapping the package in an OLE compound file rather than a zip, so opening one as a zip used to report "not a zip file" — which reads as a broken download and sends the user after the wrong problem. It is now identified before conversion:

```
✗ encrypted: password-protected Office file (OLE-wrapped)
✗ encrypted: password-protected PDF
```

The model is told to ask for an unlocked copy. This tool never asks for or stores a password, and never blocks the original `Read`, so work continues either way. A PDF that merely restricts printing still opens and still converts — checked against a false positive — and a legacy `.xls`, which is an OLE file by design, is not mistaken for an encrypted one.

**Windows is supported.** For teams with Windows machines:

- The Python search uses the `py -3` launcher. `python3` is rarely on PATH there, and a bare `python` may be the Store alias stub that opens a web page instead of running anything. Venv interpreters are looked for at `Scripts\python.exe`.
- The `.fig` parser installs through `npm.cmd` via the shell, and the package spec dropped its caret (`openfig-core@0.4.x`): in cmd.exe `^` is the escape character and never reaches npm.
- The background install and every child process set `windowsHide`, so no console window appears in the middle of someone's prompt.

`sprag doc2md --clean` empties the conversion cache; `doc2md off` removes the hook. Removal filters for this tool's own entry, so anything else you registered under `PreToolUse` stays.

## README 발췌 (한국어)

## 📄 doc2md: 문서를 읽기 전에 Markdown 으로 바꿉니다

기획서와 보고서는 대부분 pptx·xlsx·pdf·docx·fig 로 옵니다. 이 형식들을 그대로 다루면 두 가지 중 하나가 일어납니다. Claude Code 가 이진 파일이라며 거부해서 아무것도 못 읽거나, 압축을 풀어 본문 XML 을 읽느라 토큰을 태우거나. 30MB 짜리 발표자료 하나가 XML 로는 **54만 토큰**이고, 200k 컨텍스트에는 들어가지도 않습니다.

doc2md 는 그 파일을 한 번 변환해 두고 원본 대신 변환본을 읽게 합니다. 같은 발표자료가 22,610 토큰이 됩니다.

**이 기능은 옵트인입니다.** 설치만으로는 켜지지 않고, 아래 두 명령을 모두 실행해야 동작합니다. 훅만 등록하고 변환기가 없으면 아무 일도 일어나지 않습니다.

세 가지 경로를 덮습니다. 각각 걸리는 지점이 다릅니다.

| 상황 | 개입 지점 |
|---|---|
| 프롬프트에 문서 경로를 적음 (`@경로`·따옴표·상대 경로 모두) | `UserPromptSubmit`. 변환한 뒤 변환본 경로를 컨텍스트로 넣습니다 |
| 작업 도중 문서를 `Read` | pdf 는 `PreToolUse(Read)` 가 잡습니다. pptx·xlsx·docx 는 Claude Code 가 이진 파일이라며 훅보다 먼저 거부하므로, 세션 시작 안내문이 모델에게 `doc2md <경로>` 를 실행하도록 지시합니다 |
| 문서를 메시지에 직접 첨부 | **훅으로 잡을 수 없습니다.** 어떤 훅 이벤트도 첨부 내용을 받지 못합니다. 세션 시작 안내문이 다음부터 경로로 달라고 사용자에게 안내하도록 모델에게 지시합니다 |

두 번째 줄의 제약은 실측으로 확인한 것입니다. `.pdf` 를 Read 하면 훅이 실행되고, 같은 세션에서 `.pptx` 를 Read 하면 훅 로그에 아무 기록도 남지 않습니다.

```bash
sprag doc2md on                  # 훅 등록 (변환기는 첫 문서에서 자동 설치)
sprag doc2md                     # 변환기·훅 등록 상태 확인
sprag doc2md 보고서.pptx          # 직접 변환해 결과 확인
sprag doc2md install-converter   # 설치를 미리 끝내 두고 싶을 때만
```

**변환기는 알아서 깔립니다.** 팀에 배포할 때 각자 설치 명령을 실행하게 만들면 그 단계에서 빠지는 사람이 생깁니다. 그래서 문서가 처음 등장하는 시점에 변환기가 백그라운드로 설치되고, 설치가 끝나는 대로 곧바로 변환합니다. 실측으로 첫 문서는 약 30초(설치 15초 + markitdown 최초 임포트), 이후로는 새 문서 3.7초, 캐시 적중 0.1초입니다. `.fig` 파서는 첫 Figma 파일에서 0.5초 만에 깔립니다.

설치는 `install` 단계가 아니라 첫 사용 시점에 합니다. venv 가 47MB 라서, 문서를 다루지 않는 사람은 낼 이유가 없는 비용입니다. 자동 설치를 끄려면 `CTS_DOC2MD_NO_AUTOINSTALL=1` 을 설정하십시오.

**파이썬 3.10 이상이 필요합니다.** markitdown 의 요구 사항이고, macOS 기본 `/usr/bin/python3` 는 3.9 입니다. 이 도구는 PATH 순서를 따르지 않고 3.10 이상인 인터프리터를 골라 venv 를 만듭니다. 3.9 로 만들면 pip 가 markitdown 을 2019 년 자리표시자 릴리스(0.0.1a1)로 해석해서, 설치는 성공한 것처럼 보이지만 모든 변환이 임포트 단계에서 죽습니다. 실제로 이 함정을 밟고 잡았습니다. 3.10 이상이 아예 없으면 설치 명령을 안내하는 대신 `brew install python` 을 안내합니다.

변환기는 도구 전용 venv(`<상태 디렉터리>/doc2md-venv`)에 설치합니다. 시스템 파이썬을 건드리지 않고, CLI를 지우면 함께 사라집니다. 이미 `uv tool` 이나 다른 경로에 markitdown 이 있으면 그쪽을 먼저 씁니다.

변환은 [markitdown](https://github.com/microsoft/markitdown)이 담당하며, 슬라이드 번호와 제목 계층, 표, 발표자 노트, 시트 구분이 모두 남습니다. 한글도 깨지지 않습니다.

몇 가지는 의도적으로 하지 않습니다.

- **이미지는 변환하지 않습니다.** markitdown 이 빈 결과를 돌려주고, OCR 은 실측에서 리소스 이름을 틀리게 읽었습니다(`c5.xlarge` 를 `c.xlarge` 로). 이름 자체가 내용인 문서에서는 텍스트가 없느니만 못합니다. 모델이 이미지는 직접 읽습니다.
- **변환기가 없어도 알리지 않고 지나가지 않습니다.** 설치 명령을 한 번 안내한 뒤 원본 `Read` 를 그대로 통과시킵니다. 매번 알리면 그것대로 방해가 되고, 아무 말도 하지 않으면 고장을 숨기게 됩니다. `doc2md` 를 인자 없이 실행하면 변환기와 훅 등록 상태를 한 번에 확인할 수 있습니다.
- **변환본은 프로젝트 안에 남기지 않습니다.** 도구의 상태 디렉터리 아래 권한 `0700` 으로 저장하므로 `.gitignore` 에 무엇을 추가할 필요가 없습니다. 파일명이 급여·계약·개인정보 같은 패턴에 걸리면 아예 변환하지 않습니다.
- **압축 폭탄은 막습니다.** pptx·xlsx·docx 는 zip 컨테이너입니다. 선언된 크기를 먼저 걸러 내고, 선언은 조작될 수 있으므로 실제 해제 바이트도 상한과 대조합니다.
- **엑셀은 행 수로 자릅니다.** 변환 시간은 파일 크기가 아니라 행 수를 따릅니다(실측: PDF 6.3MB 0.9초, 엑셀 5.8MB 47.75초). 5만 행을 넘으면 앞부분만 변환하고, **잘랐다는 사실과 전체 행 수를 안내에 함께 적습니다.**

### 더 깊은 내용은 별도 문서에 있습니다

절감액을 어떻게 실측해 산정하는지(PDF 첨부 대비, 오피스 XML 대비, `.fig` 고정 기준선), 피그마 `.fig` 변환, 문서를 수정할 때의 복사본·스크립트 절차, DRM·암호 문서 판별, Windows 지원 세부는 이 문서 앞부분에 정리되어 있습니다. 요지는 세 가지입니다.

- 절감 기준선은 항상 실측치보다 **낮게** 잡습니다. 도구를 돋보이게 하는 숫자보다 신뢰할 수 있는 숫자가 가치 있습니다.
- `.fig` 절감이 가장 큽니다. `Read` 가 이진 파일을 거부하지 않고 그대로 읽어 회당 약 44,000 토큰을 태우기 때문입니다.
- 암호 문서와 DRM 문서는 오류가 아니라 상태로 판별해 안내합니다. 원본 `Read` 를 막지 않으므로 작업이 중단되지 않습니다.
