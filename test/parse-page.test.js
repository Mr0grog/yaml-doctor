/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */
'use strict';

const assert = require('assert');
const parsePage = require('../lib/parse-page');

// Fixtures --------------------------------------------------------------

const markdownFrontMatter = `---
some_key: some_value
a_list:
  - ok
  - yep
  - it's a
  - list
---
`;

const badFrontMatter = `---
some_key: @some_value
a_list:
  - ok
  - yep
  - it's a
  - list
---
`;

const markdownText = `
This is some Markdown with [a link](https://asana.com).

---

After a section divider
`.trimLeft();


// Tests --------------------------------------------------------------

describe('parse-page', function() {
  describe('getPageSegments()', function () {
    it('returns front-matter and markdown', function () {
      const pageText = markdownFrontMatter + markdownText;
      const [frontMatter, markdown] = parsePage.getPageSegments(pageText);
      assert.equal(frontMatter, markdownFrontMatter.slice(0, -4));
      assert.equal(markdown, markdownText);
    });

    it('returns empty string for absent front-matter', function () {
      const [frontMatter, markdown] = parsePage.getPageSegments(markdownText);
      assert.equal(frontMatter, '');
      assert.equal(markdown, markdownText);
    });
  });

  describe('parsePage()', function () {
    it('parsePage() returns an object version of the page and front-matter', function () {
      const pageText = markdownFrontMatter + markdownText;
      const page = parsePage(pageText);
      assert.deepEqual(page.meta, {
        some_key: 'some_value',
        a_list: ['ok', 'yep', "it's a", 'list']
      });
      assert.equal(page.content, markdownText);
    });

    it('parsePage() can take a buffer', function () {
      const pageText = markdownFrontMatter + markdownText;
      const page = parsePage(Buffer.from(pageText));
      assert.deepEqual(page.meta, {
        some_key: 'some_value',
        a_list: ['ok', 'yep', "it's a", 'list']
      });
      assert.equal(page.content, markdownText);
    });

    it('parsePage() throws an error for malformed YAML', function () {
      const pageText = badFrontMatter + markdownText;
      assert.throws(() => parsePage(pageText));
    });
  });

  describe('page.serializeString()', function () {
    it('returns a well-formatted page string', function () {
      const pageText = markdownFrontMatter + markdownText;
      const page = parsePage(pageText);
      const serialized = page.serializeString();
      assert.equal(serialized, pageText);
    });

    it('returns a buffer with the serialized page', function () {
      const pageText = markdownFrontMatter + markdownText;
      const page = parsePage(pageText);
      const serialized = page.serialize();
      assert(Buffer.isBuffer(serialized), 'return value was not a buffer');
      assert(
        Buffer.from(pageText).equals(serialized),
        'serialized buffer had different bytes than original buffer'
      );
    });

    it("doesn't add front matter there wasn't any", function () {
      const page = parsePage(markdownText);
      const serialized = page.serializeString();
      assert.equal(serialized, markdownText);
    });
  });
});
