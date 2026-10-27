/**
 * Lines of a transcript file, with the file closed before the loop is over.
 *
 * Every transcript reader used to build its own readline over createReadStream.
 * That works until a loop leaves early: `return` inside `for await` closes the
 * readline interface, but on Node 20 the ReadStream underneath keeps its
 * descriptor until garbage collection. And even a loop that runs to the end is
 * not done when it ends: 'end' fires before the asynchronous fs.close() has
 * run, so a caller that deletes the directory right away still finds the file
 * open. POSIX does not mind; Windows answers ENOTEMPTY, which is how the
 * Windows CI job failed on Node 20 alone.
 *
 * A generator's finally block runs on `break`, `return` and throw alike, so
 * the stream is destroyed on every exit, and the 'close' event is awaited so
 * the descriptor is gone when the loop is.
 *
 * A `.zst` path (Codex compresses older rollouts) is decompressed on the fly:
 * through zlib where Node has zstd (22.15+/23.8+), else through the `zstd` binary.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';

/**
 * @param {string} filePath
 * @returns {AsyncGenerator<string>}
 */
export async function* transcriptLines(filePath) {
  if (filePath.endsWith('.zst')) {
    yield* typeof zlib.createZstdDecompress === 'function' ? zstdLines(filePath) : zstdBinaryLines(filePath);
    return;
  }
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    input.destroy();
    // A stream that failed to open has already closed itself; one that was
    // still open closes asynchronously, and the wait is what makes the file
    // deletable the moment the caller gets control back. 'error' after
    // destroy() is not something to surface here: the loop already threw.
    if (!input.closed) await once(input, 'close').catch(() => {});
  }
}

async function* zstdLines(filePath) {
  const input = createReadStream(filePath);
  const inflate = zlib.createZstdDecompress();
  inflate.setEncoding('utf8');
  // pipe() does not forward errors, and a failed read would leave the loop waiting forever.
  input.on('error', (err) => inflate.destroy(err));
  input.pipe(inflate);
  let decompressed = 0;
  inflate.on('data', (chunk) => { decompressed += chunk.length; });
  const rl = createInterface({ input: inflate, crlfDelay: Infinity });
  let finished = false;
  try {
    for await (const line of rl) yield line;
    finished = true;
  } finally {
    rl.close();
    inflate.destroy();
    input.destroy();
    if (!input.closed) await once(input, 'close').catch(() => {});
  }
  // Node's zstd stream can end quietly on a file cut short, while the binary path fails on a
  // non-zero exit. A non-empty file that yields nothing is such a cut, not an empty rollout.
  // A cut at a frame boundary of a multi-frame file still cannot be detected here.
  if (finished && decompressed === 0 && input.bytesRead > 0) throw new Error(`zstd: ${filePath} is truncated (no data decompressed)`);
}

// Node before 22.15 has no zstd in zlib; the binary is the only way to read these files there.
async function* zstdBinaryLines(filePath) {
  const child = spawn('zstd', ['-dc', '--', filePath], { stdio: ['ignore', 'pipe', 'ignore'] });
  // Registered before any await, so a very fast exit cannot slip past it.
  const closed = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  // A missing binary reports through 'error', not through stdout, so settle that first.
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (err) => reject(new Error(`cannot read ${filePath}: zstd is not available (${err.code || err.message})`)));
  });
  child.stdout.setEncoding('utf8');
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let finished = false;
  try {
    for await (const line of rl) yield line;
    finished = true;
  } finally {
    rl.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    // An abandoned, paused pipe with unread data would keep 'close' from ever firing.
    child.stdout.destroy();
    const code = await closed;
    // Only a loop that read to the end can judge the exit code; a killed child exits non-zero by design.
    if (finished && code !== 0) throw new Error(`zstd exited with code ${code} for ${filePath}`);
  }
}
