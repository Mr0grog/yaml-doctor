/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const stream = require('stream');

/**
 * Create a stream that transforms the content of Vinyl/Gulp files. Think of
 * this like `Array.map()`, but over a stream instead of an array -- and it
 * handles some boilerplate logic around obtaining content.
 *
 * The transform function can return a file or a promise for a file. If it
 * returns/resolves to an array of files, each file will be added to the stream.
 *
 * @param  {(VinylFile, Buffer) => VinylFile|Promise<VinylFile>} transform
 *   Function that transforms a file. It receives the Vinyl file object and
 *   the file's content as a Buffer, and should return a modified version of
 *   the file, a promise for a new file, or an array/promise for an array of
 *   new files. If it returns null, the file is dropped from the stream.
 * @return {DuplexStream}
 */
module.exports = function gulpTransformStream (transform, flush = null, {includeNull = false} = {}) {
  return new stream.Transform({
    objectMode: true,
    transform (file, encoding, callback) {
      // Only include null-content files (directories, symlinks) if asked.
      if (file.isNull() && !includeNull) return callback();

      // TODO: handle streams
      if (file.isStream()) {
        return callback(new Error("Stream-based files aren't supported yet."));
      }

      Promise.resolve(transform(file, file.contents))
        .then(result => {
          if (Array.isArray(result)) {
            result.forEach(file => this.push(file));
          }
          else if (result) {
            this.push(result);
          }
          callback();
        })
        .catch(callback);
    },

    flush (callback) {
      if (flush) {
        return Promise.resolve(flush())
          .then(result => {
            if (Array.isArray(result)) {
              result.forEach(file => this.push(file));
            }
            else if (result) {
              this.push(result);
            }
            callback();
          })
          .catch(callback);
      }

      callback();
    }
  });
};
