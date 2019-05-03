'use strict';

/**
 * Export promise-based versions of `fs` features that we use. In Node.js v10,
 * we can use fs.promises instead, but it will print a warning to the console
 * (ok for library use, but not CLI use), and in v12 it's a-ok.
 *
 * TODO: Get rid of this once we drop v8 and once v12 moves to LTS.
 */

const fs = require('fs');
const util = require('util');

module.exports = {
  readFile: util.promisify(fs.readFile),
  stat: util.promisify(fs.stat),
  writeFile: util.promisify(fs.writeFile)
};
