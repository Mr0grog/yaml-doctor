/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const chalk = require('chalk');

const issueLevelColors = {
  error: 'red',
  warning: 'yellow',
  fixed: 'green'
};

/**
 * Pretty-print issues found by the checker to the console.
 * @param {Object} issues
 */
function printIssues (filePath, issues) {
  console.log(chalk.underline(filePath));
  issues.forEach(issue => {
    const line = issue.mark.line + 1;
    const column = issue.mark.column + 1;
    const position = `${line}:${column}`.padEnd(9, ' ');
    let level = issue.level.padEnd(7, ' ');
    level = chalk[issueLevelColors[issue.level] || 'red'](level);
    console.log(`  ${position}  ${level}  ${issue.reason || issue.message}`);
  });
  console.log('');
}

module.exports = {
  issueLevelColors,
  printIssues
};
