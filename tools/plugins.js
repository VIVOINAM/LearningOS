"use strict";
const all = ['codex-focus','codex-capture','codex-study','codex-recall','codex-workbench'];
const at = process.argv.indexOf('--plugin');
const id = at < 0 ? null : process.argv[at + 1];
if (at >= 0 && !all.includes(id)) throw Error('Unknown --plugin; expected: ' + all.join(', '));
module.exports = id ? [id] : all;
