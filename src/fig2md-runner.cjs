#!/usr/bin/env node
/**
 * Child-process shim between the synchronous doc2md pipeline and the async
 * fig converter. Prints the conversion result as one JSON object on stdout,
 * exactly like the Python converter does, so the caller treats both the same.
 *
 * Usage: node fig2md-runner.cjs <file.fig> <userDataDir>
 */

'use strict';

const { convertFig } = require('./fig2md.cjs');

const [file, userDataDir] = process.argv.slice(2);
convertFig(file, userDataDir)
  .then((result) => { process.stdout.write(JSON.stringify(result)); })
  .catch((e) => {
    process.stdout.write(JSON.stringify({
      ok: false, reason: 'convert-failed', detail: String(e && e.message || e).slice(0, 300),
    }));
  });
