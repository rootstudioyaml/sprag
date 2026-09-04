#!/usr/bin/env node
// Temporary drop box for handoff notes, exposed through a cloudflare quick tunnel.
// Only the token path accepts writes, and files land in handoff/.
// Unlike the sns-agent copy this one accepts any file type, not just images.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.UPLOAD_TOKEN;
const PORT = Number(process.env.UPLOAD_PORT || 8788);
const DEST = process.env.UPLOAD_DEST || path.join(__dirname, '..', 'handoff');
const MAX_BYTES = 25 * 1024 * 1024;

if (!TOKEN) {
  console.error('UPLOAD_TOKEN is required');
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

const FORM = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>handoff upload</title>
<body style="font-family:-apple-system,sans-serif;padding:2rem;max-width:32rem;margin:auto">
<h2>handoff 파일 업로드</h2>
<p style="color:#666">md, 이미지, 그 밖의 어떤 형식이든 받습니다. 상한은 25MB입니다.</p>
<form method="post" enctype="multipart/form-data">
<input type="file" name="file" required style="font-size:1.1rem">
<button style="margin-top:1.5rem;padding:.8rem 1.6rem;font-size:1.1rem">보내기</button>
</form>
</body>`;

function extractParts(buf) {
  const head = buf.indexOf('\r\n\r\n');
  if (head === -1) return null;
  const header = buf.slice(0, head).toString('latin1');
  const nameMatch = /filename="([^"]*)"/.exec(header);
  if (!nameMatch || !nameMatch[1]) return null;
  const boundaryEnd = buf.indexOf('\r\n--', head + 4);
  return {
    name: path.basename(nameMatch[1]).replace(/[^\w.\-]/g, '_'),
    body: buf.slice(head + 4, boundaryEnd === -1 ? buf.length : boundaryEnd),
  };
}

http.createServer((req, res) => {
  if (!req.url.startsWith('/' + TOKEN)) {
    res.writeHead(404).end('not found');
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(FORM);
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed');
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BYTES) {
      res.writeHead(413).end('too large');
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    const part = extractParts(Buffer.concat(chunks));
    if (!part) {
      res.writeHead(400).end('no file');
      return;
    }
    const target = path.join(DEST, part.name);
    fs.writeFileSync(target, part.body);
    console.log(`saved ${target} (${part.body.length} bytes)`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(`<meta charset="utf-8"><p>저장했습니다: ${part.name} (${part.body.length} bytes)</p>`);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`upload server on http://127.0.0.1:${PORT}/${TOKEN}`));
