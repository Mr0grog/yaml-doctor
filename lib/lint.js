/* eslint-disable no-cond-assign */
/* eslint-disable no-control-regex */

/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const chalk = require('chalk');
const fs = require('fs');
const parsePage = require('./parse-page');
const path = require('path');
const StringEditor = require('./string-editor');
const util = require('util');
const yaml = require('js-yaml');

const entityAnchor = /^((#\d+)|(#x[0-9a-fA-F]+)|(\w+));$/;

// If a quote is followed by one of these things, it's reasonable that it might
// actually be the end of a quoted string (as opposed to a quote in the middle
// that needs escaping).
const tokensAfterString = /^($|\s*[:,\]}\n#])/;
// Scans for text that looks like it might be a variable inserted in a string
// but are malformed such that they parse as valid YAML representing an object:
//
//     some_key: {{ premium_link_trial_signed_in_notrans }}
//
// The above was probably meant to parse as a string like:
//
//     '{{ premium_link_trial_signed_in_notrans }}'
//
// But instead parses as an object with another object for its first key. This
// regex is meant to identify and warn for this situation.
const unquotedVariablePattern = /^\{\{\s*\w+\s*\}\}/;
const endsWithBackslashes = /\\+$/;
// When guessing at the end location of a quoted scalar value that is missing
// its end quote, this matches a next line that looks like it might not be
// meant to be part of the scalar.
const lineAfterQuotedScalar = /^(\s*)(-\s|-\s\w+\s*:\s|\w+\s*:\s|\u{0000}|$)/u;
// Used to match simplistic flow sequences (lists with square brackets instead
// of ones listed out line by line) that actually might just be at the start of
// a string. We combine this with a few more tests to determine if the sequence
// is probably the start of a string and not actually a sequence.
const simpleSequence = /\[[^\]'"]*/g;
// Identify non-printable/invalid characters that aren't in YAML at all,
// including unicode C0 and C1 control characters, surrogates without a correct
// previous/next byte, etc. See the spec:
//   https://yaml.org/spec/1.2/spec.html#id2770814
// This expression is shamelessly stolen from js-yaml:
//   https://github.com/nodeca/js-yaml/blob/2d1fbed8f3a76ff93cccb9a8a418b4c4a482d3d9/lib/js-yaml/loader.js#L26
const nonPrintablePattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g;


/**
 * Lint a string of YAML source code.
 * @param {string} yamlText YAML source code to lint.
 * @param {object} [options]
 * @param {string} [options.filename=null] Filename to include in errors/warnings.
 * @param {boolean} [options.debug=false]   Print debug messages.
 * @param {boolean} [options.fix=false]     Return a fixed version of the YAML source.
 * @param {boolean} [options.removeInvalidCharacters=true]  Some characters are not allowed in YAML at all. If `true`,
 *   this will simply remove them from the YAML source. See details in the YAML spec:
 *   https://yaml.org/spec/1.2/spec.html#id2770814
 * @returns {{issues: Array<YAMLException>, fixed: string}} A list of issues and, if `options.fix` was true, a fixed
 *   string of YAML source. Each issue is an Error object, and has a `level` property that is one of `error`,
 *   `warning`, or `fixed`.
 */
function lint (yamlText, {filename, debug = false, fix = false, removeInvalidCharacters = true} = {}) {
  if (Buffer.isBuffer(yamlText)) yamlText = yamlText.toString('utf8');
  const issues = [];
  let previousState = null;
  let unquotedVariablePosition = -1;
  let atSignPosition = -1;
  let lastTokenPosition = -1;

  // Track indentation level of the current token so we can use it to correct
  // under-indented lines. (Only the `open` operation will have the correct
  // indentation, but fix things in the `close` operation.)
  let tokenIndent = 0;
  let tokenIndentWarnings = [];

  const stateEditor = new StringEditor(yamlText);
  const fixedEditor = new StringEditor(yamlText);

  function spliceState (state, position, remove = 0, insert = '') {
    stateEditor.splice(position, remove, insert);
    state.input = stateEditor.value + '\u0000';
    state.length = stateEditor.value.length;
  }

  function fixedPositionFromState (statePosition) {
    let originalPosition = stateEditor.originalPosition(statePosition);
    return fixedEditor.currentPosition(originalPosition);
  }

  // Handle invalid, non-printable characters that are not allowed at all in a
  // YAML document. For more, see the relevant specification section:
  //   https://yaml.org/spec/1.2/spec.html#id2770814
  //
  // We'd have to handle this logic slightly differently in
  // every given context if we did it inline with the parsing routine, so for
  // now, do it in a single pass before the parser starts. The downside is that
  // means the only fix we can apply is *removing* the character (it can only
  // be escaped in certain contexts; see below for more).
  nonPrintablePattern.lastIndex = 0;
  var nonPrintableMatch;
  while (nonPrintableMatch = nonPrintablePattern.exec(stateEditor.value)) {
    const position = nonPrintableMatch.index;
    const codePoint = `#x${nonPrintableMatch[0].codePointAt(0).toString(16).padStart(2, '0')}`;
    const error = new yaml.YAMLException(
      `The non-printable character ${codePoint} is not allowed in YAML`,
      stateEditor.markOriginalPosition(position, filename)
    );
    error.level = 'error';

    // Only fix it if we are allowed to *remove* invalid characters. Replacing
    // invalid characters with escape sequences is only allowed in
    // double-quoted strings, which would be a much more complex operation and
    // would have to happen in-line with the parser:
    //   - If in an unquoted flow scalar, double-quote the scalar and escape
    //   - If in a double-quoted scalar, escape
    //   - If in a single-quoted scalar or a block scalar...
    //     - Can't fix? Or...
    //     - Do a stupid amount of work to convert to a double-quoted scalar
    //       and escape?
    //   - If in a tag, anchor, or reference, remove or can't fix.
    //   - Not sure if I'm missing any other relevant spots. In whitespace
    //     around a token? (Would we treat it as part of the token?)
    if (fix && removeInvalidCharacters) {
      const fixedPosition = fixedPositionFromState(position);
      fixedEditor.splice(fixedPosition, 1);
      error.level = 'fixed';
    }

    // Use stateEditor.splice() instead of spliceState() because we don't have
    // a state object yet (because the actual parser hasn't started).
    stateEditor.splice(position, 1);
    issues.push(error);
  }

  try {
    // NOTE: we use loadAll() and specify `schema` instead of safeLoadAll()
    // because options don't get passed through without an iterator:
    // https://github.com/nodeca/js-yaml/pull/381
    const parsed = yaml.loadAll(stateEditor.value, null, {
      filename,
      json: true,
      schema: yaml.DEFAULT_SAFE_SCHEMA,
      onWarning (warning) {
        warning.level = 'warning';
        warning.mark = stateEditor.markOriginalPosition(warning.mark.position, filename);
        issues.push(warning);

        // Keep track of indentation warnings so can update them if they get
        // fixed later on.
        if (warning.message.includes('deficient indentation')) {
          tokenIndentWarnings.push(warning);
        }
      },
      listener (operation, state) {
        if (operation === 'open') {
          // Keep track of values used across operations.
          tokenIndent = state.lineIndent;
          tokenIndentWarnings = [];

          // "Peek" ahead to the next token. The 'open' operation occurs where
          // the previous token closed, so there may be whitespace between the
          const nextTokenStart = findNextNonSpace(state.input, state.position);
          const nextTokenChar = state.input[nextTokenStart];

          // Detect unescaped quotes in quoted strings. e.g:
          // `key: 'a quoted scalar's quotes must be escaped!'
          //                       ^ This should have been escaped
          //
          // PERF: comparing character codes is faster, but harder to read.
          if (nextTokenChar === "'" || nextTokenChar === '"') {
            // TODO: it might be nice to determine whether the quoted thing we
            // are examining is a mapping value, in which case it can't be
            // followed by a colon. Doing so is a little complicated, though
            // (if the previous token was a mapping key, the next token *could*
            // be its value or the value could be a new mapping). I'm not sure
            // we can do that until we actually encounter the colon, in which
            // case the whole approach here needs to flip from the `open` to
            // the `close` event and do a lot of work to re-write what the
            // parser has parsed after the fact. That feels tough to do well.
            const quoteType = nextTokenChar;
            let startPosition = nextTokenStart + 1;
            let endPosition = -1;
            const guessable = quoteType === '"';
            let unescapedCount = 0;
            while (startPosition > -1) {
              const [position, exact] = findProbableEndOfScalar(state.input, quoteType, startPosition, !guessable, state.lineIndent);

              if (!exact) {
                // This is meant to handle YAML like:
                //
                //   key: "This is a quote" and so on.
                //   next: "Some more text"
                //
                // What we expect was intended here is more like:
                //
                //   key: "\"This is a quote\" and so on."
                //   next: "some more text"
                //
                // The inexact end will see that the `next:` line looks like a
                // new YAML key/value and stop after `on.`. If we didn't guess
                // this, we'd wind up escaping the first quote in `"some more
                // text"` and treating this YAML like:
                //
                //   key: "This is a quote\" and so on."
                //   next: \"some more text"
                //
                //   ^ There's only one key + one value there instead of two!
                //
                // NOTE: no need to handle the opposite situation, where a
                // string ends but doesn't start with a quote, because YAML's
                // tries-to-do-the-right-thing parsing handles that fine.
                //
                // TODO: is there a similar case for single-quote strings we
                // can handle here? Going back to the beginning, quoting, and
                // escaping feels like it might be more complicated.
                // (Note: we only guess inexact endings for double-quote
                // quote strings because of this; see above code.)
                //
                // TODO: refine our guessing? Only accept the guess if there
                // were an odd number of double quotes in the string (plus the
                // one at the start), suggesting an actual quote?
                const error = new yaml.YAMLException(
                  'quoted string has no end quote (did you start the string with quotes, but those weren\'t meant to quote the whole string?)',
                  stateEditor.markOriginalPosition(position, state.filename)
                );
                error.level = fix ? 'fixed' : 'error';
                issues.push(error);

                const fullString = state.input.slice(nextTokenStart, position);
                // If there were an odd number of unescaped quotes in the
                // string, the first one was probably part of a matched pair in
                // a string starting with a quoted passage of text. If so, we
                // need to escape the existing quote at the start and put a new
                // quote (to start the scalar value) before it. Otherwise, we
                // only need to add the quote at the end.
                //
                // NOTE: this is making a big assumption that the double quotes
                // are being used in pairs. In English, we might refine this if
                // the quote is directly after a number (e.g. 5" for inches or
                // seconds), but I'm not sure about other languages. We're
                // getting especially speculative here.
                const prefix = (unescapedCount % 2 == 0) ? '' : '"\\';
                const replacement = `${prefix}${fullString}"`;
                if (fix) {
                  const fixedStart = fixedPositionFromState(nextTokenStart);
                  const fixedPosition = fixedPositionFromState(position);
                  fixedEditor.splice(fixedStart, fixedPosition - fixedStart, replacement);
                }
                spliceState(state, nextTokenStart, fullString.length, replacement);
                // Move ahead by the number of added characters - 1. (Subtract
                // one so that on the next pass, we hit the new ending quote.)
                startPosition = position + prefix.length;
                continue;
              }

              if (position === -1 || tokensAfterString.test(state.input.slice(position + 1))) {
                startPosition = -1;
                endPosition = position;
                break;
              }

              unescapedCount++;
              const error = new yaml.YAMLException(
                'unescaped quote in quoted string',
                stateEditor.markOriginalPosition(position, state.filename)
              );
              error.level = fix ? 'fixed' : 'error';
              issues.push(error);
              // Repair the error in memory so that parsing can continue past it and
              // find other issues.
              const escape = quoteType === "'" ? "'" : '\\';
              if (fix) {
                const fixedPosition = fixedPositionFromState(position);
                fixedEditor.splice(fixedPosition, 0, escape);
              }
              spliceState(state, position, 0, escape);
              startPosition = position + 2;

              continue;
            }

            // Identify invalid escape sequences in double-quoted strings
            if (endPosition > -1 && quoteType === '"') {
              let position = nextTokenStart;

              while (position > -1 && position < endPosition) {
                position = state.input.indexOf('\\', position);

                // TODO: provide smarter feedback around \x##, \u####, and
                // \U######## that have the wrong number of digits?
                if (position === -1 || position >= endPosition) break;
                if (
                  isSimpleEscape(state.input.charCodeAt(position + 1)) ||
                  isHexEscape(state.input, position + 1)
                ) {
                  position += 2;
                  continue;
                }

                const error = new yaml.YAMLException(
                  `Invalid escape sequence: "\\${state.input[position + 1]}"`,
                  stateEditor.markOriginalPosition(position, state.filename)
                );
                error.level = fix ? 'fixed' : 'error';
                issues.push(error);

                // Repair the error by just dropping the slash. This lets us
                // continue parsing and find further errors later.
                if (fix) {
                  const fixedPosition = fixedPositionFromState(position);
                  fixedEditor.splice(fixedPosition, 1);
                }
                spliceState(state, position, 1);

                // No need to update position because we removed a char, so
                // position is now directly after the slash.
              }
            }
          }

          // Look for improperly quoted variable substitutions like:
          //
          //     some_key: {{ this_should_be_a_variable }}
          //
          // The above is actually perfectly valid YAML, though it won't result
          // in a string with the substitution instruction in it, so this
          // is a warning and operates on a relatively simple heuristic.
          //
          // Keep track of the position because we might check the same part of
          // the YAML source multiple times -- if there's a new context
          // involved, like the start of a sequence or the start of a mapping,
          // we'll see two `open` operations at the same location. (E.g. one
          // for a sequence as a whole and one for the first sequence item.)
          if (nextTokenChar === '{' && state.position > unquotedVariablePosition) {
            const unquotedVariableMatch = state.input
              .slice(nextTokenStart)
              .match(unquotedVariablePattern);
            if (unquotedVariableMatch) {
              let match = unquotedVariableMatch;
              unquotedVariablePosition = nextTokenStart;
              const error = new yaml.YAMLException(
                `Did you mean to substitute a variable? It must be quoted: '${match[0]}'`,
                stateEditor.markOriginalPosition(unquotedVariablePosition, state.filename)
              );
              error.level = fix ? 'fixed' : 'warning';
              issues.push(error);

              if (fix) {
                const fixedPosition = fixedPositionFromState(nextTokenStart);
                fixedEditor.splice(fixedPosition, match[0].length, `'${match[0]}'`);
                spliceState(state, nextTokenStart, match[0].length, `'${match[0]}'`);
              }
            }
          }

          // Handle @ signs that start string values
          if (state.position > atSignPosition && nextTokenChar === '@') {
            atSignPosition = nextTokenStart;
            const error = new yaml.YAMLException(
              '`@` cannot start any token',
              stateEditor.markOriginalPosition(nextTokenStart, state.filename)
            );
            error.level = 'warning';
            issues.push(error);

            // Figure out where this string should probably end, because we
            // are going to wrap the whole thing in double quotes.
            const quoteType = '"';
            let startPosition = nextTokenStart;
            let endPosition = -1;
            while (startPosition > -1) {
              const [position, exact] = findProbableEndOfScalar(state.input, quoteType, startPosition, false, state.lineIndent);

              // If we couldn't find an end, we can't fix this.
              if (position === -1) {
                startPosition = -1;
                break;
              }

              // An exact ending is a quote. Because we are *wrapping* in a
              // new set of quotes, we need to escape the quote here.
              if (exact) {
                // Escape the quote we found.
                const escape = quoteType === "'" ? "'" : '\\';
                if (fix) {
                  const fixedPosition = fixedPositionFromState(position);
                  fixedEditor.splice(fixedPosition, 0, escape);
                }
                spliceState(state, position, 0, escape);
                startPosition = position + 2;

                if (tokensAfterString.test(state.input.slice(startPosition))) {
                  endPosition = startPosition;
                }
              }
              else {
                endPosition = position;
              }

              // If we guessed at an ending, then we're done. Wrap everything
              // up in quotes.
              if (endPosition > -1) {
                const scalar = state.input.slice(nextTokenStart, endPosition);
                if (fix) {
                  const fixedPosition = fixedPositionFromState(nextTokenStart);
                  fixedEditor.splice(fixedPosition, scalar.length, `"${scalar}"`);
                  error.level = 'fixed';
                }
                spliceState(state, nextTokenStart, scalar.length, `"${scalar}"`);
                break;
              }

              continue;
            }
          }

          // TODO: detect unterminated quoted strings. The parser sort-of does
          // this, but only if no other string with the same kind of quotes
          // occurs later in the file to cause the unterminated string to end.
          // We could do a reasonable-effort test to detect what *looks* like
          // it should be a string termination. e.g. this situation doesn't
          // provide the clearest messaging without more help:
          //
          //     parent:
          //       key: "Something" and some more stuff
          //     next_key: "Whatever"
          //
          // We detect the failure to escape the quote after `Something`, but
          // then allowing the parser to continue as we do means that the
          // string keeps going until the end of `Whatever` and we detect the
          // starting quote for `Whatever` as an enescaped quote in the prior
          // string *and* we get a `deficient indentation` warning because the
          // line for `next_key` is outdented.
          //
          // EXAMPLE:
          //   _content/how-to/marketing/chapters/3.campaign-management.md:17

          // Handle strings that start with `[`, which actually get parsed as
          // sequences (and then they probably end incorrectly).
          // For example, this is an entry in one of our files:
          //
          //     quote: '[Asana] blah blah blah'
          //
          // ...but someone might unintentionally write:
          //
          //     quote: [Asana] blah blah blah
          //
          // That parses wrong, and gets us an unclear error message: "can not
          // read a block mapping entry; a multiline key may not be an implicit
          // key"
          if (nextTokenStart > lastTokenPosition && nextTokenChar === '[') {
            simpleSequence.lastIndex = nextTokenStart;
            // The regex here looks for pretty simple situations, where the
            // square brackets don't have any quotes. Then we check that the
            // closing square bracket isn't followed by something that might
            // not be regular text (i.e. this could really be a sequence).
            // We could probably do better with more work, but this handles
            // all the situations we've seen in practice well.
            const sequenceMatch = simpleSequence.exec(state.input);
            const sequenceEnd = nextTokenStart + sequenceMatch[0].length;
            if (state.input[sequenceEnd] === ']' && !tokensAfterString.test(state.input.slice(sequenceEnd + 1))) {
              const suggestion = `"${sequenceMatch[0]}]${state.input.slice(sequenceEnd + 1, sequenceEnd + 5)}..."`;
              const error = new yaml.YAMLException(
                `\`[\` cannot start a string. If this was supposed to be a string, add quotes around it: ${suggestion}`,
                stateEditor.markOriginalPosition(nextTokenStart, state.filename)
              );
              error.level = 'error';
              issues.push(error);

              // Figure out where this string should probably end, because we
              // are going to wrap the whole thing in double quotes.
              // TODO: unify this with how we handle `@` signs.
              const quoteType = '"';
              let startPosition = nextTokenStart;
              let endPosition = -1;
              while (startPosition > -1) {
                const [position, exact] = findProbableEndOfScalar(state.input, quoteType, startPosition, false, state.lineIndent);

                // If we couldn't find an end, we can't fix this.
                if (position === -1) {
                  startPosition = -1;
                  break;
                }

                // An exact ending is a quote. Because we are *wrapping* in a
                // new set of quotes, we need to escape the quote here.
                if (exact) {
                  // Escape the quote we found.
                  const escape = quoteType === "'" ? "'" : '\\';
                  if (fix) {
                    const fixedPosition = fixedPositionFromState(position);
                    fixedEditor.splice(fixedPosition, 0, escape);
                  }
                  spliceState(state, position, 0, escape);
                  startPosition = position + 2;

                  if (tokensAfterString.test(state.input.slice(startPosition))) {
                    endPosition = startPosition;
                  }
                }
                else {
                  endPosition = position;
                }

                // If we guessed at an ending, then we're done. Wrap everything
                // up in quotes.
                if (endPosition > -1) {
                  const newScalar = state.input.slice(nextTokenStart, endPosition);
                  if (fix) {
                    const fixedPosition = fixedPositionFromState(nextTokenStart);
                    fixedEditor.splice(fixedPosition, newScalar.length, `"${newScalar}"`);
                    error.level = 'fixed';
                  }
                  spliceState(state, nextTokenStart, newScalar.length, `"${newScalar}"`);
                  break;
                }

                continue;
              }
            }
          }

          lastTokenPosition = nextTokenStart;
        }

        if (operation === 'close') {
          // js-yaml accepts `&something;` as an anchor, while pyyaml does not
          // allow it on account of the `;` at the end. Reading the spec, it
          // seems like js-yaml is right, but most occurrences of this in our
          // codebase are HTML entities that should have been quoted (so they
          // are part of the value instead of an anchor name). Warn for this.
          if (operation === 'close' && state.anchor && entityAnchor.test(state.anchor)) {
            const warning = new yaml.YAMLException(
              'This value has an anchor that appears to be an HTML entity. If you want it to be part of the value, make sure the value is quoted.',
              stateEditor.markOriginalPosition(previousState.position, previousState.filename)
            );
            warning.level = 'warning';
            return issues.push(warning);
          }

          // Attempt to fix unindented lines in a multi-line scalar. We do this
          // after the fact so we can rely on the parser to correctly parse the
          // complete scalar for us. "Deficient indentation" warnings are
          // captured in the warning handler and we address them here.
          // TODO: consider addressing non-scalars, like flow sequences.
          if (fix && state.kind === 'scalar' && tokenIndentWarnings.length) {
            // To be technically correct, we need to indent subsequent lines by
            // at least one character, but to look nice (since most people use
            // multiples of two) use two spaces.
            // TODO: autodetect indentation size that is used in the file?
            const indent = tokenIndent + 2;
            for (const warning of tokenIndentWarnings) {
              const position = fixedEditor.currentPosition(warning.mark.position);
              const lineStart = fixedEditor.value.lastIndexOf('\n', position) + 1;
              // The first line should define the expected indentation, so
              // there should be nothing to fix.
              if (lineStart > 0) {
                // TODO: should we do more to validate expectations here --
                // e.g. that there is actually text at `position` and the
                // indentation we're adding is still needed?
                const existingIndent = position - lineStart;
                // TODO: this only supports space indentation; but we should
                // detect or have a setting for tabs.
                fixedEditor.splice(position, 0, ' '.repeat(indent - existingIndent));
                warning.level = 'fixed';
              }
            }
          }
        }

        if (debug) {
          // Strip repeated, verbose items from state
          const info = Object.keys(state).reduce((clean, key) => {
            let value = state[key];
            if (['onWarning', 'schema', 'listener', 'implicitTypes', 'typeMap', 'documents'].includes(key)) {
              value = undefined;
            }
            else if (key === 'input' && value.length > 50) {
              clean['input_behind'] = value.slice(Math.max(state.position - 20, 0), state.position);
              clean['input_ahead'] = value.slice(state.position, state.position + 30);
              value = undefined;
            }
            if (value !== undefined) {
              clean[key] = value;
            }
            return clean;
          }, {});
          console.debug(`YAML Parser: '${chalk.blue(operation)}'`);
          console.debug(util.inspect(info, {depth: 2, colors: true}));
        }

        previousState = {
          filename: state.filename,
          input: state.input,
          position: state.position,
          line: state.line,
          lineStart: state.lineStart
        };
      }
    });

    if (debug) {
      console.log('Parsed result:', util.inspect(parsed, {
        colors: true,
        depth: 8
      }));
    }
  }
  catch (error) {
    // js-yaml uses the same exception type for all errors, but we only want to
    // catch syntax errors, which have a mark pointing to their location.
    if (!error.mark) throw error;

    let issue = error;
    issue.level = 'error';

    // Provide a nicer, more specific error for mixed spaces and tabs
    if (issue.reason.toLowerCase().includes('bad indentation')) {
      const lineStart = issue.mark.position - issue.mark.column;
      const indent = yamlText.slice(lineStart).match(/^\s*/);
      if (indent && indent[0].includes(' ') && indent[0].includes('\t')) {
        issue.reason = 'line is indented with mixed spaces and tabs';
      }

      // TODO: provide nicer error for wrong level of indentation with expected
      // level of indentation?
    }

    // This is handled earlier on during the parsing phase, so swallow it here.
    if (yamlText[issue.mark.position] === '@') {
      issue = null;
    }

    if (issue) issues.push(issue);
  }

  return {
    issues,
    fixed: fix ? fixedEditor.value : null
  };
}

/**
 * Finds the likely end of a quoted scalar in a YAML string. The return value
 * is an array where the first value is the location of the scalar's end and
 * the second is a boolean indicating whether that location is certain (true
 * if certain, false if the scalar didn't end there but probably should have).
 *
 * The goal here is help identify likely locations for fixes in potentially
 * malformed YAML code.
 *
 * NOTE: this method only handles flow scalars/strings, *not* block scalars
 * where the content is indented, like:
 *
 *     key: >
 *       Some text
 *       # More text, not a comment
 *       And so on, not handled by this function
 *
 * For now, this also does not support *plain* scalars (that is, scalars not
 * surrounded by quotes of some sort).
 * @param {string} string
 * @param {string} quoteType
 * @param {int} start
 * @returns {Array<int, bool>}
 */
function findProbableEndOfScalar (string, quoteType, start = 0, exact = true, indent = Infinity) {
  if (quoteType != null && quoteType !== '"' && quoteType !== "'") {
    throw new TypeError('quoteType must be null, `\'`, or `"`');
  }
  if (typeof start !== 'number' || start < 0) {
    throw new TypeError('start must be >= 0');
  }

  if (quoteType == null) {
    return findProbableEndOfPlainScalar(string, start);
  }

  return findProbableEndOfQuotedScalar(string, quoteType, start, exact, indent);
}

function findProbableEndOfPlainScalar (string, start = 0) {
  // NOTE: for plain (quoteType = null) strings, we assume they are in a
  // `flow-out` context (that is, they are not a key and are not inside a
  // `flow`, or inline, collection, like `[ a, sequence ]` or `{a: mapping}`).
  // js-yaml doesn't generally tell us what context we're in anyway :(
  // Spec: https://yaml.org/spec/1.2/spec.html#id2788859

  // NOTE: we only handle no indent right now, but this code should work if
  // can reliably get the current indent from the parser instead.
  const indent = 0;
  let lastPossibleEnd;
  let lastOffset = start;
  let offset = start;
  let upcoming = string.slice(offset);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const possibleEnd = upcoming.match(/(:\s|\s#|\n|$)/);
    if (possibleEnd[1] !== '\n') {
      // if a continuation line was not actually a complete string, the
      // string ended on the previous line.
      if (lastPossibleEnd) {
        return [lastOffset + lastPossibleEnd.index, true];
      }
      return [offset + possibleEnd.index, true];

      // TODO: for a *probable* ending, we might want to continue through
      // a `: ` sequence. If there was text after it that was not a } or ].
    }

    // Keep a handle on this possible ending and offset, because it still
    // might be the place the string ended.
    lastOffset = offset;
    lastPossibleEnd = possibleEnd;

    // Grab the next line and check its indentation.
    offset += possibleEnd.index + 1;
    upcoming = string.slice(offset);
    // Continuations must be indented at least the current level + 1
    // NOTE: not strictly true for the `flow-in` context, which we don't
    // handle right now anyway.
    if (!isIndented(upcoming, indent + 1)) {
      return [lastOffset + possibleEnd.index, true];
    }

    // Loop back around to parse the line.
  }
}

function findProbableEndOfQuotedScalar (string, quoteType, start = 0, exact = true, indent = Infinity) {
  while (start > -1) {
    const nextQuote = string.indexOf(quoteType, start);

    // This is a really weak guess, but it covers most of our existing cases:
    // if the line ends before we find a quote and the next line looks like a
    // normal YAML `key: value` or `- sequence item` or `- key: value`, guess
    // that the quote should have ended at the end of the line.
    if (!exact) {
      const nextBreak = string.indexOf('\n', start);

      // If this is the last line and no quotes, guess the end of the string.
      if (nextBreak === -1 && nextQuote === -1) {
        return [string.length, false];
      }
      // Otherwise start peeking ahead, line by line, until we hit a quote or
      // the next line looks like some normal YAML code instead more of the
      // current string.
      else if (nextBreak > -1) {
        if (nextQuote === -1 || nextQuote > nextBreak) {
          const nextLine = string.slice(nextBreak + 1, nextBreak + 100);

          // Check the next line to see if it looks like a normal YAML list
          // item or `key: value` pair that is indented at the same or lesser
          // level relative to the line where the current token started.
          // NOTE: the expression checked here is fairly simple and won't find
          // flow collections or more complicated YAML constructs like tags or
          // explicit keys. It's a best-effort guess.
          const nextLineFormat = nextLine.match(lineAfterQuotedScalar);
          if (nextLineFormat && nextLineFormat[1].length <= indent) {
            return [nextBreak, false];
          }
        }
        if (nextQuote > nextBreak) {
          start = nextBreak + 1;
          continue;
        }
      }
    }

    if (nextQuote > -1) {
      // if the quote was escaped, keep going. If not, this is the end.
      if (quoteType === "'") {
        if (string[nextQuote + 1] !== "'") {
          return [nextQuote, true];
        }
        // Move 2 to get past the escape quote.
        start = nextQuote + 2;
      }
      else if (quoteType === '"') {
        const escapes = string.slice(start, nextQuote).match(endsWithBackslashes);
        if (!escapes || escapes[0].length % 2 === 0) {
          return [nextQuote, true];
        }
        start = nextQuote + 1;
      }
    }
    else {
      start = -1;
    }
  }

  return [-1, true];
}

function isIndented (string, n, start = 0) {
  let length = string.length - start;
  if (n > length) n = length;
  for (let i = start; i < n; i++) {
    const code = string.charCodeAt(i);
    if (code !== 32 && code !== 9) {
      return false;
    }
  }
  return true;
}

function findNextNonSpace (string, start = 0) {
  const end = string.length;
  for (let i = start; i < end; i++) {
    const code = string.charCodeAt(i);
    if (code !== 32 && code !== 9) {
      return i;
    }
  }
  return -1;
}

/**
 * Determine whether a character represents a simple, single-character escape
 * sequence. This takes the character code for the character after a slash.
 *
 * @example
 * // Determine if `\f` is a simple escape:
 * isSimpleEscape('\\f'.charCodeAt(1))
 *
 * @param {int} charCode Integer character code that might be an escape
 * @returns {boolean}
 */
function isSimpleEscape (charCode) {
  return (
    charCode === 0x30 ||  // 0
    charCode === 0x61 ||  // a
    charCode === 0x62 ||  // b
    charCode === 0x74 ||  // t
    charCode === 0x09 ||  // Tab
    charCode === 0x6E ||  // n
    charCode === 0x76 ||  // v
    charCode === 0x66 ||  // f
    charCode === 0x72 ||  // r
    charCode === 0x65 ||  // e
    charCode === 0x20 ||  // Space
    charCode === 0x22 ||  // "
    charCode === 0x2F ||  // /
    charCode === 0x5C ||  // \
    charCode === 0x4E ||  // N
    charCode === 0x5F ||  // _
    charCode === 0x4C ||  // L
    charCode === 0x50     // P
  );
}

const CODE_0 = '0'.charCodeAt(0);
const CODE_9 = '9'.charCodeAt(0);
const CODE_A = 'A'.charCodeAt(0);
const CODE_F = 'F'.charCodeAt(0);
const CODE_a = 'a'.charCodeAt(0);
const CODE_f = 'f'.charCodeAt(0);
const CODE_x = 'x'.charCodeAt(0);
const CODE_u = 'u'.charCodeAt(0);
const CODE_U = 'U'.charCodeAt(0);

/**
 * Determine whether a string represents a numeric hex character escape
 * sequence, such as `\x4f` or `\u004f` or `\u0000004f`. Because this requires
 * reading N characters, it takes the string to read from and a start point
 * where the potential escape sequence after a backslash begins.
 *
 * @example
 * // Determine if `\x4f` is a hex escape:
 * isHexEscape('\\x4f', 1)
 *
 * @param {string} string The string to look for an escape sequence in.
 * @param {int} start The position after the slash to start checking.
 * @returns {boolean}
 */
function isHexEscape (string, start) {
  const typeCode = string.charCodeAt(start);
  const end =
    typeCode === CODE_x ? start + 2 :
    typeCode === CODE_u ? start + 4 :
    typeCode === CODE_U ? start + 8 : 0;

  if (end === 0) return false;

  for (start++; start <= end; start++) {
    if (!isHexDigit(string.charCodeAt(start))) return false;
  }
  return true;
}

/**
 * Determine whether a given character code represents a hexadecimal digit.
 * @param {int} charCode
 * @returns {boolean}
 */
function isHexDigit (charCode) {
  return (
    (charCode >= CODE_0 && charCode <= CODE_9) ||
    (charCode >= CODE_A && charCode <= CODE_F) ||
    (charCode >= CODE_a && charCode <= CODE_f)
  );
}


/**
 * Lint the file at a given path. If `filePath` has the `.md` extension, it
 * will be treated as a Markdown file, and this function will try to extract
 * any YAML-ish front-matter from it and lint that.
 * @param {string} filePath Path to the file to lint.
 * @param {string|Buffer} [content] The content of the file to lint. If not
 *   provided, this function will read the file at `filePath`.
 * @param {object} [options] Options to pass to `lint`.
 * @returns {Promise<{issues: Array<YAMLException>, fixed: string}>} A promise
 *   for the return value of `lint()`.
 */
async function lintFile (filePath, content = null, options = {}) {
  if (content == null) {
    // FIXME: once we update to Node.js 10, use the new fs promises API
    content = await util.promisify(fs.readFile)(filePath, 'utf8');
  }
  else if (!Buffer.isBuffer(content) && typeof content !== 'string') {
    throw new TypeError('`content` must be a string');
  }

  let yamlText = content;
  let markdown = null;
  if (path.extname(filePath) === '.md') {
    [yamlText, markdown] = parsePage.getPageSegments(content);
  }

  const result = lint(yamlText, Object.assign({}, options, {
    filename: filePath
  }));

  // If linting fixed any problems, save the results.
  if (result.fixed && yamlText !== result.fixed) {
    let fixedContent = result.fixed;
    if (markdown !== null) {
      fixedContent = parsePage.joinPageSegments(result.fixed, markdown);
    }

    if (options.write === false || options.debug) {
      console.debug(`New content for ${filePath}:\n${fixedContent}`);
    }
    else {
      // FIXME: once we update to Node.js 10, use the new fs promises API
      await util.promisify(fs.writeFile)(filePath, fixedContent, 'utf8');
    }
  }

  return result;
}

module.exports = {
  lint,
  lintFile
};
