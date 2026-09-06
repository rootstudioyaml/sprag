#!/usr/bin/env python3
"""Convert one office/PDF document to Markdown and print a JSON result.

Invoked as a child process by src/doc2md.cjs. Everything it needs to say
travels in the JSON on stdout, so the Node side never has to interpret a
traceback:

    {"ok": true,  "markdown": "...", "note": null, "truncated": false,
     "rows": 0, "pages": 0, "markup_bytes": 0}
    {"ok": false, "reason": "no-text", "detail": "..."}

Exit status is 0 whenever the JSON was written, including for a refusal. A
non-zero exit means the interpreter itself failed and the caller falls back to
letting the original file be read as it always was.

Two things here are defenses rather than features:

* Zip bombs. pptx/xlsx/docx are zip containers, and a hostile attachment can
  declare a small size and expand to fill the disk. The central directory is
  checked first because it is cheap, and then every member is decompressed in
  chunks against a hard ceiling, because the central directory is written by
  whoever built the file and can simply lie.
* Row count. Conversion time tracks spreadsheet rows, not bytes: a 6MB PDF
  converts in about a second while a 6MB 200,000-row workbook takes about a
  minute. Past the row cap the sheet is converted head-first by hand and the
  truncation is stated in the result, because a silently shortened table is
  worse than no table.
"""

import json
import os
import sys
import zipfile

MAX_UNCOMPRESSED = 500 * 1024 * 1024
MAX_RATIO = 200
ROW_CAP = int(os.environ.get("CTS_DOC2MD_ROW_CAP", "50000"))
ZIP_EXTS = {".pptx", ".xlsx", ".docx"}


def fail(reason, detail=""):
    json.dump({"ok": False, "reason": reason, "detail": str(detail)[:500]}, sys.stdout)
    sys.exit(0)


def check_zip(path):
    """Classify an archive before opening it as a document.

    Returns None when it is safe to convert, or a (reason, detail) pair. The
    reason distinguishes a hostile file from a merely broken one: those want
    opposite handling, and calling a truncated download a zip bomb would send
    the user hunting for an attacker who is not there.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            declared = sum(i.file_size for i in infos)
            packed = sum(i.compress_size for i in infos) or 1
            if declared > MAX_UNCOMPRESSED or declared / packed > MAX_RATIO:
                return ("unsafe-archive",
                        "declared size %d bytes at %.0fx compression" % (declared, declared / packed))
            # The numbers above came from the archive itself, so verify them by
            # actually decompressing, stopping the moment the running total
            # passes the ceiling rather than once the disk is full. Understated
            # sizes are caught here twice over: by this budget, and by the
            # CRC-32 check zipfile performs while streaming, which fails as
            # soon as a member's real contents disagree with its header.
            budget = MAX_UNCOMPRESSED
            for info in infos:
                with zf.open(info) as member:
                    while True:
                        chunk = member.read(1 << 20)
                        if not chunk:
                            break
                        budget -= len(chunk)
                        if budget <= 0:
                            return ("unsafe-archive", "expands past %d bytes" % MAX_UNCOMPRESSED)
    except zipfile.BadZipFile as e:
        return ("bad-archive", str(e))
    return None


# Which entries inside a zip container hold the document's own text. The rest
# of the archive is media, themes and relationship tables — bytes a reader
# would never wade through even without a converter.
BODY_XML = {
    ".pptx": ("ppt/slides/", "ppt/notesSlides/"),
    ".docx": ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"),
    ".xlsx": ("xl/worksheets/", "xl/sharedStrings.xml"),
}


def markup_bytes(path, ext):
    """Uncompressed size of the body markup inside a zip document, or 0.

    This prices the alternative to converting. A model cannot read the binary,
    so the fallback a reader actually reaches for is unzipping the container
    and wading through its XML — where tags and style attributes outweigh the
    text several times over.
    """
    prefixes = BODY_XML.get(ext)
    if not prefixes:
        return 0
    try:
        import zipfile
        with zipfile.ZipFile(path) as z:
            return sum(i.file_size for i in z.infolist()
                       if i.filename.endswith(".xml")
                       and any(i.filename.startswith(p) for p in prefixes))
    except Exception:
        return 0


def pdf_pages(path):
    """Page count of a PDF, or 0 when it cannot be counted.

    The count is what prices the alternative to converting: attaching a PDF
    to a message bills every page as an image, while the conversion bills
    only the extracted text. pdfminer ships with markitdown's pdf extra, so
    this costs no extra dependency.
    """
    try:
        from pdfminer.pdfpage import PDFPage
        with open(path, "rb") as fh:
            return sum(1 for _ in PDFPage.get_pages(fh))
    except Exception:
        return 0


def sheet_rows(path):
    """Total rows across every sheet, or None when openpyxl cannot say."""
    try:
        import openpyxl
    except ImportError:
        return None
    try:
        wb = openpyxl.load_workbook(path, read_only=True)
        try:
            return sum(ws.max_row or 0 for ws in wb.worksheets)
        finally:
            wb.close()
    except Exception:
        return None


def md_cell(v):
    if v is None:
        return ""
    return str(v).replace("|", "\\|").replace("\n", " ")


def head_of_workbook(path, cap):
    """Markdown for the first `cap` rows, sheet by sheet.

    Used only past the row cap. markitdown would produce nicer output, but it
    reads the whole workbook first, which is the cost being avoided.
    """
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True)
    out = []
    left = cap
    try:
        for ws in wb.worksheets:
            if left <= 0:
                break
            out.append("## %s" % ws.title)
            header_written = False
            for row in ws.iter_rows(values_only=True):
                if left <= 0:
                    break
                cells = [md_cell(c) for c in row]
                out.append("| " + " | ".join(cells) + " |")
                if not header_written:
                    out.append("| " + " | ".join(["---"] * len(cells)) + " |")
                    header_written = True
                left -= 1
            out.append("")
    finally:
        wb.close()
    return "\n".join(out)


def main():
    if len(sys.argv) < 2:
        fail("usage", "convert.py <file>")
    path = sys.argv[1]
    if not os.path.isfile(path):
        fail("missing", path)

    ext = os.path.splitext(path)[1].lower()
    if ext in ZIP_EXTS:
        problem = check_zip(path)
        if problem:
            fail(problem[0], problem[1])

    note = None
    truncated = False
    rows = 0
    pages = pdf_pages(path) if ext == ".pdf" else 0
    markup = markup_bytes(path, ext)

    if ext in (".xlsx", ".xls"):
        counted = sheet_rows(path)
        rows = counted or 0
        if counted and counted > ROW_CAP:
            try:
                text = head_of_workbook(path, ROW_CAP)
            except Exception as e:
                fail("convert-failed", e)
            note = ("전체 %d행 가운데 앞 %d행만 변환했습니다. "
                    "전수 분석이 필요하면 원본을 직접 다루십시오." % (counted, ROW_CAP))
            json.dump({"ok": True, "markdown": text, "note": note,
                       "truncated": True, "rows": counted, "pages": 0,
                       "markup_bytes": markup}, sys.stdout)
            return

    try:
        from markitdown import MarkItDown
    except ImportError as e:
        fail("no-markitdown", e)

    try:
        result = MarkItDown().convert(path)
        text = (result.text_content or "").strip()
    except Exception as e:
        fail("convert-failed", e)

    if not text:
        # An empty file would read to the model as a document with nothing in
        # it, which is a different and worse claim than "could not extract".
        fail("no-text", "converter returned nothing")

    json.dump({"ok": True, "markdown": text, "note": note,
               "truncated": truncated, "rows": rows, "pages": pages,
               "markup_bytes": markup}, sys.stdout)


if __name__ == "__main__":
    main()
