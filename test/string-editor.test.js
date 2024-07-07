/**
 * Copyright (C) 2019-2024, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const assert = require('assert');
const {assertHas} = require('./support/assertions');
const StringEditor = require('../lib/string-editor');

describe('StringEditor', function () {
  it('edits a string', function () {
    const editor = new StringEditor('Hello!');
    editor.splice(5, 1, ', world.');

    assert.equal(editor.value, 'Hello, world.');
  });

  it('finds the original position after several edits', function () {
    const editor = new StringEditor('abcdefghijklmnop');
    editor.splice(5, 1, 'x');
    editor.splice(2, 2);
    editor.splice(9, 0, ' elephant ');
    editor.splice(9, 0, ',');

    // Original:                abcdefghijklmnop
    assert.equal(editor.value, 'abexghijk, elephant lmnop');
    assert.equal(editor.originalPosition(1), 1);
    assert.equal(editor.originalPosition(2), 4);
    assert.equal(editor.originalPosition(21), 12);
  });

  it('finds the new position from an original position after several edits', function () {
    const editor = new StringEditor('abcdefghijklmnop');
    editor.splice(5, 1, 'x');
    editor.splice(2, 2);
    editor.splice(9, 0, ' elephant ');
    editor.splice(9, 0, ',');

    // Original:                abcdefghijklmnop
    assert.equal(editor.value, 'abexghijk, elephant lmnop');
    assert.equal(editor.currentPosition(1), 1);
    assert.equal(editor.currentPosition(4), 2);
    assert.equal(editor.currentPosition(12), 21);
  });

  it('marks the original line even after line insertions', function () {
    const editor = new StringEditor('abcdefg\nhijklmnop');
    editor.splice(5, 1, 'x');
    editor.splice(2, 2);
    editor.splice(10, 0, '\n elephant \n');
    editor.splice(10, 0, ',');

    // Original:                abcdefg\nhijklmnop
    assert.equal(editor.value, 'abexg\nhijk,\n elephant \nlmnop');

    assertHas(editor.markOriginalPosition(1), {
      position: 1,
      line: 0,
      column: 1
    });

    assertHas(editor.markOriginalPosition(24), {
      position: 13,
      line: 1,
      column: 5
    });
  });
});
