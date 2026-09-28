"use strict";
const all = ['l-os-focus','l-os-capture','l-os-study','l-os-recall','l-os-widgets','l-os-code','l-os-workbench'];
const at = process.argv.indexOf('--plugin');
const id = at < 0 ? null : process.argv[at + 1];
if (at >= 0 && !all.includes(id)) throw Error('Unknown --plugin; expected: ' + all.join(', '));
module.exports = id ? [id] : all;
