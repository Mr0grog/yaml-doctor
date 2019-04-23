/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const {lint, lintFile} = require('./lib/lint');
const lintGulpFileStream = require('./lib/gulp');

module.exports = {
  lint,
  lintFile,
  lintGulpFileStream
};
