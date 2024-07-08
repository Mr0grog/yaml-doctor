/**
 * Copyright (C) 2019-2024, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const assert = require('assert');
const {assertIncludes} = require('./support/assertions');
const path = require('path');
const spawn = require('child_process').spawn;

// Run the CLI command with a list of arguments. This is a relatively light
// promise wrapper around `child_process.spawn()`.
function run (cliArgs, options) {
  return new Promise((resolve, reject) => {
    const command = path.resolve(__dirname, '..', 'bin', 'yaml-doctor');

    // Technically these should be buffers, but we are always dealing with text
    // so being lazy here works ok.
    let stdout = '';
    let stderr = '';

    const spawnOptions = Object.assign(
      {cwd: __dirname},
      options,
      {stdio: 'pipe'}
    );

    const child = spawn(command, cliArgs, spawnOptions)
      .on('error', reject)
      .on('close', exitCode => {
        resolve({exitCode, stdout, stderr});
      });

    child.stdout.on('data', data => {
      stdout += data;
    });

    child.stderr.on('data', data => {
      stderr += data;
    });
  });
}

describe('YAML Doctor CLI', function () {
  it('checks files', async function () {
    const {exitCode, stdout} = await run(['fixtures']);

    assert.equal(exitCode, 1, 'Should have exit code of `1` for errors.');
    assertIncludes(stdout, '1 error, 2 warnings, 0 fixed in 6 files', 'It should show a summary');
    assertIncludes(stdout, 'fixtures/only-warnings.yaml', 'It should include files with issues');
    assertIncludes(stdout, 'fixtures/some-file.yaml', 'It should include files with issues');
  });


  it('should succeed if there were only warnings', async function () {
    const {exitCode, stdout} = await run(['fixtures/*warnings*']);

    assert.equal(exitCode, 0, 'Should have exit code of `0`.');
    assertIncludes(stdout, '0 errors, 1 warning, 0 fixed in 1 file', 'It should show a summary');
  });

  it('should exit with code 1 if there were no files found', async function () {
    const {exitCode, stderr} = await run(['fixtures/ugabooga']);

    assert.equal(exitCode, 1, 'Should have exit code of `1`.');
    assertIncludes(stderr, 'No files', 'It should show a message on stderr');
  });

  it('should only look for .yaml, .yml, and .md files in a directory', async function () {
    const {exitCode, stdout} = await run(['fixtures/subfolder']);

    assert.equal(exitCode, 0, 'Should have exit code of `0`.');
    assertIncludes(stdout, '0 errors, 0 warnings, 0 fixed in 1 file', 'It should show a summary');
  });

  it('should check regardless of extension of an actual file or file pattern is listed', async function () {
    const {exitCode, stdout} = await run(['fixtures/subfolder/*.txt']);

    assert.equal(exitCode, 1, 'Should have exit code of `1` because the text file is not YAML.');
    assertIncludes(stdout, '1 error, 0 warnings, 0 fixed in 1 file', 'It should show a summary');
  });

  it('should check multiple path patterns', async function() {
    const {exitCode, stdout} = await run([
      'fixtures/*warnings*',
      'fixtures/ugabooga',
      'fixtures/subfolder/*'
    ]);

    assert.equal(exitCode, 1, 'Should have exit code of `1`.');
    assertIncludes(stdout, '1 error, 1 warning, 0 fixed in 3 files');
  });

  it('should not check the same file multiple times', async function() {
    const {exitCode, stdout} = await run([
      'fixtures/subfolder/*',
      'fixtures/subfolder/*.txt'
    ]);

    assert.equal(exitCode, 1, 'Should have exit code of `1`.');
    assertIncludes(stdout, '1 error, 0 warnings, 0 fixed in 2 files');
  });
});
