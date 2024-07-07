/**
 * Copyright (C) 2019-2024, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

/**
 * Combine a set of strings and replacements into a single string. This is
 * basically the same as what a standard, untagged template literal does, but
 * the replacements are in an array instead of a variable number of arguments.
 * @private
 * @param {Array<string>} strings String components for template.
 * @param {Array<any>} replacements Values to substitute between strings.
 * @returns {string}
 */
function stringifyTemplate (strings, replacements) {
  return strings.reduce((result, string, index) => {
    const value = index < replacements.length ? replacements[index] : '';
    return result + string + value;
  }, '');
}

/**
 * Template tag for unindenting strings. All lines of a string will be indented
 * relative to the second line.
 *
 * @param {Array<string>} strings
 * @param  {...any} values
 *
 * @example
 * unindent`
 *   some
 *     indented
 *       string
 * ` === `
 * some
 *   indented
 *     string
 * `;
 */
function unindent (strings, ...values) {
  const lines = stringifyTemplate(strings, values).split('\n');
  if (lines.length < 2) return lines[0];

  const indent = lines[1].match(/^\s*/)[0].length;
  return [
    lines[0],
    ...lines.slice(1).map(line => line.slice(indent))
  ].join('\n');
}

module.exports = unindent;
