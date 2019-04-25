/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const assert = require('assert');
const {assertIncludes} = require('./support/assertions');
const unindent = require('./support/unindent');
const yamlDoctor = require('../lib/check');

describe('checker', function () {
  it('errors for mixed space/tab indentation', function () {
    const {issues} = yamlDoctor.check(unindent`
      apps_sidebar_sections:
        - section_label: "Development"
         \tlist: values
    `);

    assert.equal(issues.length, 1, 'There should have been an issue');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'mixed spaces and tabs');
    assert.equal(issues[0].mark.line, 3, 'The error was on the wrong line');
  });

  it('warns for @ signs at the start of scalars', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: @at sign value
    `);

    assert.equal(issues.length, 1, `There should be one issue in [${issues.join(',')}]`);
    assert.equal(issues[0].level, 'warning');
    assertIncludes(issues[0].reason, '`@`');
    assert.equal(issues[0].mark.line, 1, 'The warning was on the wrong line');
  });

  it('can fix @ signs at the start of scalars', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key: @at sign value
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key: "@at sign value"
    `);
  });

  it('can fix @ signs at the start of scalars when there are quotes in the middle', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key: @at "sign" value
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key: "@at \\"sign\\" value"
    `);
  });

  it('errors for unescaped single quotes', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: 'it's a bequot'd string
                 cross'd multiple lines.'
    `);

    assert.equal(issues.length, 3, 'There should have been two issues');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'escaped');
    assert.equal(issues[0].mark.line, 1, 'The first warning was on the wrong line');
    assert.equal(issues[0].mark.column, 13, 'The first warning was on the wrong column');
    assert.equal(issues[1].level, 'error');
    assertIncludes(issues[1].reason, 'escaped');
    assert.equal(issues[1].mark.line, 1, 'The second warning was on the wrong line');
    assert.equal(issues[1].mark.column, 24, 'The second warning was on the wrong column');
    assert.equal(issues[2].level, 'error');
    assertIncludes(issues[2].reason, 'escaped');
    assert.equal(issues[2].mark.line, 2, 'The third warning was on the wrong line');
    assert.equal(issues[2].mark.column, 16, 'The third warning was on the wrong column');
  });

  it('does not error for escaped single quotes', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: 'it''s a bequot'd string'
    `);

    assert.equal(issues.length, 1, 'There should have been one issue');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'escaped');
    assert.equal(issues[0].mark.line, 1, 'The warning was on the wrong line');
  });

  it('errors for unescaped double quotes', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: "it's a \\"properly\\" "quoted" string"
    `);

    assert.equal(issues.length, 2, 'There should have been two issues');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'escaped');
    assert.equal(issues[0].mark.line, 1, 'The warning was on the wrong line');
    assert.equal(issues[1].level, 'error');
    assertIncludes(issues[1].reason, 'escaped');
    assert.equal(issues[1].mark.line, 1, 'The warning was on the wrong line');
  });

  it('errors for unescaped double quotes when overly escaped', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: "it's an escaped slash before a \\\\" quote"
    `);

    assert.equal(issues.length, 1, 'There should have been two issues');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'escaped');
    assert.equal(issues[0].mark.line, 1, 'The warning was on the wrong line');
  });

  it('warns for anchors that are probably HTML entities', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key: &copy; 2019 Asana, Inc.
    `);

    assert.equal(issues.length, 1, 'There should have been one issue');
    assert.equal(issues[0].level, 'warning');
    assertIncludes(issues[0].reason, 'anchor');
    assert.equal(issues[0].mark.line, 1, 'The warning was on the wrong line');
  });

  it('errors for bad indentation', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key:
        - key_1: value
         misindented_key: value
    `);

    assert.equal(issues.length, 1, 'There should have been one issue');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'indent');
    assert.equal(issues[0].mark.line, 3, 'The warning was on the wrong line');
  });

  it('errors for non-sequences starting with `[`', function () {
    const {issues} = yamlDoctor.check('some_key: [Something] blah blah');

    assert.equal(issues.length, 1, 'There should have been one issue');
    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, '[');
    assert.equal(issues[0].mark.line, 0, 'The error was on the wrong line');
  });

  it('can fix non-sequences starting with `[`', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key: [Something] blah blah and so on and so for forth
                blah blah just listen to me drone on...
      another_key: "We're done with that now"
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key: "[Something] blah blah and so on and so for forth
                blah blah just listen to me drone on..."
      another_key: "We're done with that now"
    `);
  });

  it('accepts comments after quoted strings', function () {
    const {issues} = yamlDoctor.check('some_key: "some value" # some comment');

    assert.deepEqual(issues, [], 'There should be no issues');
  });

  it('handles quoted keys', function () {
    const {issues} = yamlDoctor.check(`
      "some key": some value
      another_key:
        "with nested quoted keys": and another value
    `);

    assert.deepEqual(issues, [], 'There should be no issues');
  });

  it('identifies potential malformed variable substitutions', function () {
    const {issues} = yamlDoctor.check(`
      a_list:
        - {{ this_is_not_actually_a_variable }}
        -  "{{ this_is_a_variable }}"
        - an_object: {{ with_not_a_variable }}
    `);

    assert.equal(issues.length, 2, `There should be two issues in [${issues.join(',')}]`);
    assertIncludes(issues[0].reason, 'this_is_not_actually_a_variable');
    assertIncludes(issues[1].reason, 'with_not_a_variable');
  });

  it('can fix malformed variable substitutions', function () {
    const {fixed} = yamlDoctor.check(unindent`
      a_list:
        - {{ this_is_not_actually_a_variable }}
        -  "{{ this_is_a_variable }}"
        - an_object: {{ with_not_a_variable }}
    `, {fix: true});

    assert.equal(fixed, unindent`
      a_list:
        - '{{ this_is_not_actually_a_variable }}'
        -  "{{ this_is_a_variable }}"
        - an_object: '{{ with_not_a_variable }}'
    `);
  });

  it('can fix unescaped single quotes', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key: 'it''s a bequot'd string'
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key: 'it''s a bequot''d string'
    `);
  });

  it('errors on invalid escape sequences in double-quoted strings', function () {
    const {issues} = yamlDoctor.check(unindent`
      bad_escapes: "
        Bad:  \\'
        Good: \\\\' (the slash is escaped, not the ')
        Bad:  \\z
        Good: \\t
        Bad:  \\xZ (non-hex character after 'x')
        Bad:  \\xa (not 2 hex characters after 'x')
        Good: \\x4a
        Bad:  \\uX (non-hex character after 'u')
        Bad:  \\ua (not 4 or 8 hex characters after 'u')
        Good: \\u004a
        Good: \\U0000004a
        Good: \\P"
    `);

    assert.equal(issues.length, 6, `There should be six issues in [${issues.join(',')}]`);
  });

  it('correctly locates invalid escapes when unescaped quotes are involved', function () {
    const {issues} = yamlDoctor.check(unindent`
      bad_escapes: "Didn\\'t you say "please?""
    `);

    assert.equal(issues.length, 3, `There should be one issue in [${issues.join(',')}]`);
    const escapeIssue = issues.filter(issue => issue.reason.includes("\\'"))[0];
    assert.equal(escapeIssue.mark.column, 18, 'The column was wrong');
  });

  it('correctly handles strings that started but did not end with double quotes and where a later value was quoted', function () {
    const {issues} = yamlDoctor.check(unindent`
      unending_string: "Didn't you say please," I asked.
      a_separate_value: "Indeed."
    `);

    assert.equal(issues.length, 2, `There should be two issues in [${issues.join(',')}]`);

    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'unescaped quote');
    assert.equal(issues[0].mark.line, 1, 'The error should have been on line 0');
    assert.equal(issues[0].mark.column, 40, 'The error should have been at column 40');

    assert.equal(issues[1].level, 'error');
    assertIncludes(issues[1].reason, 'no end');
    assert.equal(issues[1].mark.line, 1, 'The error should have been on line 0');
    assert.equal(issues[1].mark.column, 50, 'The error should have been at column 57');
  });

  it('handles quoted strings that do not end but which have other paired quotes in them', function () {
    const {issues} = yamlDoctor.check(unindent`
      unending_string: "This is a so-called "double quoted" scalar.
      a_separate_value: "Indeed."
    `);

    assert.equal(issues.length, 3, `There should be three issues in [${issues.join(',')}]`);

    assert.equal(issues[0].level, 'error');
    assertIncludes(issues[0].reason, 'unescaped quote');
    assert.equal(issues[0].mark.column, 38, 'The error should have been at column 38');

    assert.equal(issues[1].level, 'error');
    assertIncludes(issues[1].reason, 'unescaped quote');
    assert.equal(issues[1].mark.column, 52, 'The error should have been at column 52');

    assert.equal(issues[2].level, 'error');
    assertIncludes(issues[2].reason, 'no end');
    assert.equal(issues[2].mark.column, 61, 'The error should have been at column 61');
  });

  it('does not merge an unended double-quote string with another, later double-quote string', function () {
    const {fixed} = yamlDoctor.check(unindent`
      unending_string: "Didn't you say please," I asked.
      a_separate_value: "Indeed."
    `, {fix: true});

    assert.equal(fixed, unindent`
      unending_string: "\\"Didn't you say please,\\" I asked."
      a_separate_value: "Indeed."
    `);
  });

  it('errors on unprintable control characters', function () {
    // Using escapes instead of the actual chars below so they are visible.
    // Note JS will parse the escapes, so the YAML Doctor will see them as the
    // literal character that is not allowed.
    const {issues} = yamlDoctor.check(unindent`
      has_unprintables: text\u0008<-backspace char\u0006<-acknowledge char
    `, {debug: false});

    assert.equal(issues.length, 2, `There should be two issues in [${issues.join(',')}]`);

    assert.equal(issues[0].level, 'error');
    assert.equal(issues[0].mark.column, 22, 'The error should have been at column 22');

    assert.equal(issues[1].level, 'error');
    assert.equal(issues[1].mark.column, 39, 'The error should have been at column 39');
  });

  it('removes unprintable control characters when `fix` and `removeInvalidCharacters` are both true', function () {
    const {fixed} = yamlDoctor.check(unindent`
      has_unprintables: text\u0008<-backspace char\u0006<-acknowledge char
    `, {fix: true, removeInvalidCharacters: true});

    assert.equal(fixed, unindent`
      has_unprintables: text<-backspace char<-acknowledge char
    `);
  });

  it('warns on unindented lines in scalars', function () {
    const {issues} = yamlDoctor.check(unindent`
      some_key:
        indented_key: "some multiline value that
      is unindented
       which really is not cool."
    `);

    assert.equal(issues.length, 2, `There should be two issues in [${issues.join(',')}]`);

    assert.equal(issues[0].level, 'warning');
    assert.equal(issues[0].mark.line, 3, 'The first bad indent line');
    assert.equal(issues[0].mark.column, 0, 'The first bad indent column');

    assert.equal(issues[1].level, 'warning');
    assert.equal(issues[1].mark.line, 4, 'The second bad indent line');
    assert.equal(issues[1].mark.column, 1, 'The second bad indent column');
  });

  it('can fix unindented lines in scalars', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key:
        indented_key: "some multiline value that
      is unindented
       which really is not cool."
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key:
        indented_key: "some multiline value that
          is unindented
          which really is not cool."
    `);
  });

  it('can fix unindented lines in scalars when mixed with other scalar errors', function () {
    const {fixed} = yamlDoctor.check(unindent`
      some_key:
        indented_key: "some multiline value with bad " quotes that
      is unindented
       which really is not cool."
    `, {fix: true});

    assert.equal(fixed, unindent`
      some_key:
        indented_key: "some multiline value with bad \\" quotes that
          is unindented
          which really is not cool."
    `);
  });
});
