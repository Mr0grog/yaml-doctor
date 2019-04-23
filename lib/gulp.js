/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const gulpTransformStream = require('./gulp-transform-stream');
const lintFile = require('./lint').lintFile;
const path = require('path');
const printIssues = require('./format').printIssues;

function lintGulpFileStream (options = null) {
  let fileCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let fixedCount = 0;

  return gulpTransformStream(
    async (file, content) => {
      const filePath = path.relative(process.cwd(), file.path);
      const {issues} = await lintFile(filePath, content, options);
      fileCount++;

      if (issues.length) {
        printIssues(filePath, issues);
        issues.forEach(issue => {
          if (issue.level === 'error') errorCount++;
          else if (issue.level === 'fixed') fixedCount++;
          else warningCount++;
        });
      }
      return issues;
    },
    async () => {
      console.log(`${errorCount} errors, ${warningCount} warnings, ${fixedCount} fixed in ${fileCount} files.`);
      if (errorCount > 0) {
        process.exitCode = 1;
      }
    }
  );
}

module.exports = lintGulpFileStream;
