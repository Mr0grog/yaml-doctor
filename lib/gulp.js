/**
 * Copyright (C) 2019-2024, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const Batch = require('./batch');
const gulpTransformStream = require('./gulp-transform-stream');
const path = require('path');

function checkGulpFileStream (options = null) {
  const batch = new Batch(options);

  return gulpTransformStream(
    async (file, content) => {
      const filePath = path.relative(process.cwd(), file.path);
      return await batch.reportFile(filePath, content);
    },
    async () => {
      batch.reportSummary();
      batch.setExitCode();
    }
  );
}

module.exports = checkGulpFileStream;
