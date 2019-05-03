'use strict';

const check = require('./check');
const format = require('../lib/format');

// Errors that we expect to receive if a file could not be read. These aren't
// fatal, since we expect that there might be a few bad paths in a large batch.
// `fs` could give us other errors, but these are the only ones we expect to
// see because we are are not writing directories or links.
const unreadableErrors = new Set(
  'ENOENT',
  'EPERM'
);

// Super naive pluralizer. Only works for languages like English and for simple
// words that you just need to add 's' to the end of.
function pluralize (text, count) {
  if (count !== 1) return text + 's';
  return text;
}

// Add a correctly pluralized unit to the end of a number.
function withUnit (unit, count) {
  return `${count} ${pluralize(unit, count)}`;
}

/**
 * Batch keeps a record of results across a series of file checks and can
 * report file results and summary results.
 */
class Batch {
  constructor (options = null) {
    this.options = options;
    this.summary = {
      files: 0,
      errors: 0,
      warnings: 0,
      fixed: 0,
      unreadablePaths: []
    };
  }

  /**
   * Whether the batch has encountered any errors in the files checked so far.
   */
  get hasErrors () {
    return this.summary.errors > 0;
  }

  /**
   * Check a file for YAML issues. This differs from `check.checkFile()` in
   * that it will return `null` instead of throwing an error if the file could
   * not be read, under the assumption that these errors are not fatal for a
   * whole batch of files.
   *
   * @param {string} filePath Path to file to check
   * @param {Buffer} [content] Optional content of the file.
   * @param {any} [options]  Options to pass to `check`.
   * @returns {Promise<{issues: Array<YAMLException>, fixed: string}>|null}
   */
  async checkFile (filePath, content, options = null) {
    options = Object.assign({}, this.options, options);

    try {
      const result = await check.checkFile(filePath, content, options);

      result.issues.forEach(issue => {
        if (issue.level === 'error') this.summary.errors++;
        else if (issue.level === 'fixed') this.summary.fixed++;
        else this.summary.warnings++;
      });

      return result;
    }
    catch (error) {
      // Track errors for paths that could not be read/written. Other errors
      // will be actual errors in our code and should be fatal.
      if (unreadableErrors.has(error.code)) {
        this.summary.unreadablePaths.add(filePath);
        this.summary.errors += 1;
        return null;
      }

      throw error;
    }
    finally {
      this.summary.files += 1;
    }
  }

  /**
   * Check a file for YAML issues and write the results to STDOUT/STDERR.
   * @param {string} filePath Path to file to check
   * @param {Buffer} [content] Optional content of the file.
   * @param {any} [options]  Options to pass to `check`.
   */
  async reportFile (filePath, content, options = null) {
    const result = await this.checkFile(filePath, content, options);

    if (result && result.issues.length) {
      format.printIssues(filePath, result.issues);
    }
  }

  /**
   * Write a summary of found/fixed issues to STDOUT.
   */
  reportSummary () {
    // List any files that couldn't be read.
    if (this.summary.unreadablePaths.length) {
      const unreadable = this.summary.unreadablePaths;
      const fileText = unreadable.length === 1 ? 'file' : 'files';
      console.log(`Could not read ${unreadable.length} ${fileText}:`);
      unreadable.forEach(path => console.log(`  ${path}`));
      console.log();
    }

    // Count files and types of issues.
    const breakdown = [
      withUnit('error', this.summary.errors),
      withUnit('warning', this.summary.warnings),
      `${this.summary.fixed} fixed`
    ].join(', ');
    console.log(`${breakdown} in ${withUnit('file', this.summary.files)}`);
  }

  /**
   * Set the process's exit code based on the results.
   */
  setExitCode () {
    if (this.hasErrors) {
      process.exitCode = 1;
    }
  }
}

module.exports = Batch;
