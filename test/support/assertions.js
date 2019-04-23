/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const assert = require('assert');
const util = require('util');

/**
 * Assert that the given object has a particular set of properties. The
 * properties are specified as an object (so you can think of this as asserting
 * that the given object is a superset of it). If the value of any property on
 * the expected object is not `undefined`, this will also check to make sure
 * the two values are equal.
 *
 * @param {object} actual The object to check
 * @param {object} properties A set of properties to look for
 *
 * @example
 * assertHas({a: 1, b: 5, c: 'hello'}, {a: 1, c: 'hello'});   // pass
 * assertHas({a: 1, b: 5, c: 'hello'}, {a: 1, c: 'hi'});      // fail
 * assertHas({a: 1, b: 5, c: 'hello'}, {a: 1, c: undefined}); // pass
 */
function assertHas (actual, properties) {
  try {
    [
      ...Object.getOwnPropertyNames(properties),
      ...Object.getOwnPropertySymbols(properties)
    ].forEach(key => {
      assert(key in actual);
      const value = properties[key];
      if (value !== undefined) assert.equal(actual[key], value);
    });
  }
  catch (error) {
    const actualText = util.inspect(actual);
    const expectText = util.inspect(properties);
    error.message = `Expected ${actualText} to have properties: ${expectText}`;
    throw error;
  }
}

/**
 * Assert that a string has a given substring or an array has a given item.
 * @param {string|Array} value Collection to test for inclusion in
 * @param {any} inclusion Value you expect to be included
 * @param {string} [message] Optional message if assertion fails
 */
function assertIncludes (value, inclusion, message = null) {
  message = message || `\`${value}\` does not include \`${inclusion}\``;
  assert(value.includes(inclusion), message);
}

module.exports = {
  assertHas,
  assertIncludes
};
