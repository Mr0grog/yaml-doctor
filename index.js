/**
 * Copyright (C) 2019-2024, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const {check, checkFile} = require('./lib/check');
const checkGulpFileStream = require('./lib/gulp');

module.exports = {
  check,
  checkFile,
  checkGulpFileStream
};
