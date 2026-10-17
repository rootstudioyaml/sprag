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
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

/**
 * @param {string} filePath
 * @returns {AsyncGenerator<string>}
 */
export async function* transcriptLines(filePath) {
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
