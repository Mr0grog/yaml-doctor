/**
 * Copyright (C) 2019, Rob Brackett
 * This is open source software, released under a standard 3-clause
 * BSD-style license; see the file LICENSE for details.
 */

'use strict';

const yaml = require('js-yaml');

/**
 * @type {Object} MarkdownPage
 * @property {Object} meta  The page's metadata or frontmatter. Will never be
 *   null/undefined, even if no metadata is present.
 * @property {string} content  The Markdown content of the page.
 * @property {(yamlOptions) => string} serialize  Returns a buffer representing
 *   the content of a page's file.
 * @property {(yamlOptions) => string} serializeString  Returns a string
 *   representing the content of a page's file.
 */

const yamlDivider = '---\n';
const yamlDividerPattern = /^---\s*$/m;
const yamlish = /^(---\n)?(\s*(#.*)?\n)*\s*[^#\s:]+:/;

// It's possible to have a nice regex that matches the whole frontmatter block,
// but the best I could come up with is the following, which benchmarks a full
// 10x slower than the piecemeal approach using the regexes above.
//
//   ^(---\n)?            Optionally starts with a YAML document divider
//   (\s*(#.*)?\n)*       Any number of blank or comment lines
//   \s*[^#\s:]+:         Something that looks like `some_text:` (a YAML key)
//   (.|\n)*?(\n---\n)    Everything up to the next YAML doc divider, after
//                        which is the markdown.
// const frontMatterPattern = /^(---\n)?(\s*(#.*)?\n)*\s*[^#\s:]+:(.|\n)*?(\n---\n)/;

/**
 * Split the text of a markdown page up into a YAML front-matter string and a
 * markdown content string. If there is no frontmatter, this function returns
 * an empty string for the frontmatter component.
 * @param {string} pageContent Buffer or string representing text of a page.
 * @return {Array.<string>} Array of `[frontMatter, markdown]`
 */
function getPageSegments (pageContent) {
  const text = pageContent.toString('utf8');

  // TODO: handle YAML parser instructions? (before the starting `---`)
  // NOTE: most systems require the starting `---` at the start of the file for
  //   front-matter. Statamic makes it optional & so do we; we should consider
  //   being more strict.
  // NOTE: some systems (Jekyll, Pandoc) permit a YAML document end marker
  //   (`...`) to end (but not start) the front-matter instead of just a YAML
  //   document divider. Should we follow suit here?
  // TODO: investigate the above items when upgrading to Statmic v2.
  let yamlEnd = 0;
  let contentStart = 0;
  let dividerMatch = text.match(yamlDividerPattern);
  if (dividerMatch) {
    // If there was a divider at the start, look for the next divider or assume
    // the whole doc is metadata.
    if (dividerMatch.index === 0) {
      // Find the next divider, or consider the whole doc to be metadata.
      const offset = dividerMatch[0].length + 1;
      dividerMatch = text.slice(offset).match(yamlDividerPattern);
      if (dividerMatch) {
        yamlEnd = dividerMatch.index + offset;
        contentStart = yamlEnd + dividerMatch[0].length + 1;
      }
      else {
        yamlEnd = contentStart = text.length;
      }
    }
    // The divider *in front* of the metadata is optional (see above). If the
    // first divider wasn't at the start, do a fuzzy match to see if what came
    // before it looks like YAML, or if we just hit a markdown horizontal rule.
    else if (yamlish.test(text)) {
      yamlEnd = dividerMatch.index;
      contentStart = yamlEnd + dividerMatch[0].length + 1;
    }
  }

  return [text.slice(0, yamlEnd), text.slice(contentStart)];
}

function joinPageSegments (metaText, markdown) {
  if (!metaText) return markdown;

  const segments = [metaText, markdown];

  // Ensure the meta section always starts with a divider.
  if (!metaText.startsWith(yamlDivider)) segments.unshift('');
  return segments.join(yamlDivider);
}

/**
 * Parse a buffer representing the content of a Markdown page file into a
 * metadata/frontmatter object and a Markdown string.
 *
 * Generally, you might use this by parsing a file, editing the resulting
 * object, then calling `serialize()` on it.
 *
 * @param  {Buffer} pageContent A UTF-8-encoded buffer with the full contents
 *   of a page file.
 * @param  {Object} [parserOptions] An object with parse options for js-yaml.
 *   For details: https://www.npmjs.com/package/js-yaml#api
 * @return {MarkdownPage} Object representing the parsed page.
 */
module.exports = function parsePage (pageContent, parserOptions) {
  const [yamlText, markdownText] = getPageSegments(pageContent);

  return {
    meta: yaml.safeLoad(yamlText, parserOptions),
    content: markdownText,

    serializeString (yamlOptions = null) {
      yamlOptions = Object.assign({
        skipInvalid: true,
        noRefs: true
      }, yamlOptions);
      const postProcess = yamlOptions.postProcess || (text => text);
      delete yamlOptions.postProcess;

      let metaString = '';
      if (!this.meta || typeof this.meta === 'string') {
        metaString = this.meta;
      }
      else {
        // Statamic appears to have trouble with block chomping idicators.
        // (e.g. the dash in `blah: >-`) It's ok to drop because HTML ignores
        // line breaks. (May be because of `_yaml_mode: loose` in settings.)
        metaString = yaml
          .safeDump(this.meta, yamlOptions)
          .replace(/:\s*>-\s*$/gm, ': >')
          .replace(/^(\s*-\s*)>-\s*$/gm, '$1>');
        metaString = postProcess(metaString);
      }
      return joinPageSegments(metaString, this.content);
    },

    serialize (yamlOptions) {
      return Buffer.from(this.serializeString(yamlOptions));
    }
  };
};

module.exports.getPageSegments = getPageSegments;
module.exports.joinPageSegments = joinPageSegments;
