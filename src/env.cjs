'use strict';
// CommonJS twin of src/env.js. Keep the two identical in behaviour;
// test/env.test.js pins them together.
function envVar(name, env = process.env) {
  return env['SPRAG_' + name] ?? env['CTS_' + name];
}
module.exports = { envVar };
