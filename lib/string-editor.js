/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

// NOTE: this is a bit of an abuse to grab a private API. It might be better
// to construct our own mark object in the future.
const YamlMark = require('js-yaml/lib/js-yaml/mark');

class StringEditor {
  /**
   * StringEditor keeps track of edits to a string, allowing you to map
   * locations in the edited string correspond to locations in the original
   * string (and vice versa).
   *
   * It works by keeping a list of edit positions and edit sizes that can be
   * used to transform positions. They work kind of like a flattened set of
   * operational transforms (they can't tell you the sequence of edits or
   * exactly what changed at each step, but give you enough information to
   * translate positions). This is meant to be a little faster for our use
   * case, which is important since this is used in very hot code.
   *
   * It would be easier to keep a simple numeric offset between the length of
   * the new and the original strings, but doing so means we have to be extra
   * careful to make sure that all edits to the string happen in order. Most of
   * the time that's easy to guarantee, but in some cases, it can be hard to
   * ensure that two different check rules which may have to look at the
   * same part of the string cooperate properly so that they are in order. The
   * tools in StringEditor mean you shouldn't need to worry about that.
   *
   * @param {string} value The string to edit
   */
  constructor (value = '') {
    /**
     * The current value of the edited string.
     * @type string
     */
    this.value = value;
    /**
     * The original value of the edited string.
     * @type string
     */
    this.originalValue = value;

    /**
     * @private
     * Stores a list of edit positions/sizes so we can translate positions
     * between the original and current versions of the string. The list is
     * always in order by position of the edit, and each edit contains the
     * summed sizes of all the edits before it (so, to determine the offset at
     * a given position in the string, you only need the nearest edit before
     * the position).
     * @type Array<{position: number, size: number}>
     */
    this._edits = [];
  }

  /**
   * Remove and/or insert text at a given position in the string. This works
   * analogously to `Array.splice()`.
   * @param {int} position The location at which to remove/insert text
   * @param {int} remove Number of characters to remove from the string
   * @param {string} insert String of new text to insert
   */
  splice (position, remove = 0, insert = '') {
    const size = insert.length - remove;
    this.value =
      this.value.slice(0, position) +
      insert +
      this.value.slice(position + remove);

    // We need access to i after the loop so we know where we ended.
    let i = this._edits.length - 1;
    // If an edit removes characters, it may swallow up edits that occur later
    // in the string. This tracks how many of these edits need to be removed at
    // the current position in the _edits array. (Removing them in bulk at the
    // end of this routine is faster than doing it one-by-one.)
    let removable = 0;
    // Track the accumulated size of the new edit, including edits before it.
    let accumulatedSize = size;

    // Search for the first edit before the position of the new edit and update
    // the positions & sizes of any edits at or after the new edit. Start from
    // the end because edits before `position` don't impact anything here.
    for (i; i >= 0; i--) {
      const edit = this._edits[i];
      if (edit.position > position) {
        // If we have reached a point at which we start removing edits, just
        // mark this one for removal and continue.
        if (removable > 0) {
          removable++;
          continue;
        }

        // Since this edit comes after the new edit, we need to offset it by
        // the amount of the new edit and update its accumulated size.
        let newLocation = edit.position + size;
        if (newLocation > position) {
          edit.position = newLocation;
          edit.size += size;
        }
        // If the new edit removes enough characters to swallow up this edit,
        // mark this and all edits between it and the new edit's position for
        // removal.
        else {
          accumulatedSize += edit.size;
          removable++;
        }
      }
      else if (edit.position === position) {
        // The new edit is at the same location and will replace this one, so
        // mark it for removal. If we haven't already found a later edit to
        // remove, we need to account for this edit's size in the new edit.
        if (removable === 0) {
          accumulatedSize += edit.size;
        }
        removable++;
      }
      else {
        // We found the latest edit that occurs before the new one! If we never
        // found a later edit to remove, account for this edit's size in the
        // new edit.
        if (removable === 0) {
          accumulatedSize += edit.size;
        }
        break;
      }
    }

    // If there was nothing to remove, just insert the new edit.
    if (removable === 0) {
      this._edits.splice(i + 1, 0, {position, size: accumulatedSize});
    }
    else {
      // re-use one of the removable objects to save on allocations.
      this._edits[i + 1].position = position;
      this._edits[i + 1].size = accumulatedSize;
      if (removable > 1) this._edits.splice(i + 2, removable - 1);
    }
  }

  /**
   * Get the position in the original version of the string that corresponds to
   * a given position in the current value of the string.
   *
   * @param {int} position A position in the current string to find the
   *   original position of.
   * @returns {int}
   *
   * @example
   * const editor = new StringEditor('hello');
   * editor.splice(1, 1);  // Delete the 'e', editor.value === 'hllo'
   * editor.originalPosition(3);  // 4 (The 'o' at index 3 was originally at 4)
   */
  originalPosition (position) {
    // Find the edit at or immediately before the position; subtract its size.
    // Search backwards under the assumption that most edits and lookups will
    // be made sequentially from the start, so there will usually be few or no
    // edits after `position` and many before `position`.
    for (let i = this._edits.length - 1; i >= 0; i--) {
      if (this._edits[i].position <= position) {
        return position - this._edits[i].size;
      }
    }
    return position;
  }

  /**
   * Get the position in the current string that corresponds to a position in
   * the original, pre-edit value of the string.
   *
   * @param {int} originalPosition A position in the original string to find
   *   the new position of.
   * @returns {int}
   */
  currentPosition (originalPosition) {
    // Find the edit at or immediately before the position and add its size.
    // Search backwards under the assumption that most edits and lookups will
    // be made sequentially from the start, so there will usually be few or no
    // edits after `position` and many before `position`.
    let position = originalPosition;
    for (let i = this._edits.length - 1; i >= 0; i--) {
      if (this._edits[i].position <= position) {
        position += this._edits[i].size;

        // The above may have moved us into a later area with a bigger offset,
        // so now we start rolling *forward* looking for later edit locations
        // that are now larger than ours.
        let offset = this._edits[i].size;
        for (i += 1; i < this._edits.length; i++) {
          if (this._edits[i].position > position) break;

          position += this._edits[i].size - offset;
          offset = this._edits[i].size;
        }
        break;
      }
    }
    return position;
  }

  /**
   * Create a mark object to log a position as it would have been in the
   * original string, given a position in the current version of the string.
   * Marks keep all the information necessary to describe a location in a
   * human-friendly way.
   * @param {int} position Position in the current string to mark
   * @param {string} [filename] Optional filename to use in the mark
   * @returns {YamlMark}
   */
  markOriginalPosition (position, filename = null) {
    const originalPosition = this.originalPosition(position);

    // TODO: keep a list of line break locations to optimize this operation so
    // we don’t have to search the whole string for breaks every time?
    const lineStart = this.originalValue.lastIndexOf(
      '\n',
      originalPosition - 1
    ) + 1;
    // Count up to `lineStart - 2` then add 1 as a very minor optimization
    const line = countCharactersSparse('\n', this.originalValue, 0, lineStart);

    return new YamlMark(
      filename,
      this.originalValue,
      originalPosition,
      line,
      (originalPosition - lineStart)
    );
  }
}

/**
 * Count the number of occurrences of a character in a string. This method is
 * fastest when the character is expected to be sparsely located in the string.
 * If you expect to find the characters densely located, it's better to iterate
 * through each and check character codes. (See `isIndented()` for an example.)
 * @param {string} character The character to count
 * @param {string} string The string to count characters in
 * @param {int} [start=0] The position to start counting from.
 * @param {int} [end=Infinity] The position to stop counting at. Defaults to
 *   the end of the input string.
 * @returns {int}
 */
function countCharactersSparse (character, string, start = 0, end = Infinity) {
  if (end > string.length) end = string.length;
  let count = 0;
  start = string.indexOf(character, start);
  while (start > -1 && start < end) {
    count++;
    start = string.indexOf(character, start + 1);
  }
  return count;
}

module.exports = StringEditor;
