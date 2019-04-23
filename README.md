# YAML Linter

YAML Linter attempts to identify YAML syntax errors in helpful human terms and [where possible] automatically fix them, with a focus on predicting and identifying what the YAML author probably *intended* when the syntax is questionable.

**What makes this different from most YAML linters?**

This linter is focused on correctness and syntax *errors* rather than on syntax style. For example, in the following block of invalid YAML:

```yaml
some_key: 'It's got a quoted value with an unescaped quote'
another_key: Some value
indented:
    key: 'String that breaks across lines
 but is not indented.'
```

A standard YAML parser might exit with one somewhat cryptic error here:

```
> other-yaml-linter example.yaml

can not read a block mapping entry; a multiline key may not be an implicit key at line 2, column 12:
    another_key: Some value
               ^
```

But this linter is designed to give you more useful messaging, and find all the errors it can before quitting:

```sh
> yaml-linter example.yaml

example.yaml
  1:14       error    unescaped quote in quoted string
  5:2        warning  deficient indentation
```

Instead of finding some invalid syntax before the colon on line 2, it correctly susses out that you had a quote that should have been escaped on line 1. It also flagged the under-indented value on line 5. You might think of it like [pyflakes][] in comparison to [flake8][].

Even better, you can run it with the `--fix` option to automatically fix what it can:

```sh
> yaml-linter example.yaml --fix
example.yaml
  1:14       fixed    unescaped quote in quoted string
  5:2        fixed    deficient indentation

> cat example.yaml
some_key: 'It''s got a quoted value with an unescaped quote'
another_key: Some value
indented:
    key: 'String that breaks across lines
      but is not indented.'
```

If you lint a `.md` (Markdown) file, YAML Linter is also smart enough to lint just the front-matter, and only if it looks like YAML front-matter :)


**What kinds of errors does it address?**

- Disallowed YAML characters. (e.g. Most unicode control characters, like Null, Bell, Backspace, etc.)

- Under-indented lines in multi-line values.

    ```yaml
    some_key:
        some_nested_key: "Some multi-line
    string that isn't indented like it should be."
    ```

- Unescaped quotes in single- and double-quoted scalars.

    ```yaml
    some_key: "Thess "quotes" should have been escaped"
    another: 'This should've been, too'
    ```

- Unterminated or early-terminated quoted strings:

    ```yaml
    some_key: "This string never ends.
    another: 'this is unrelated to the above'
    ```

    Or (a more common form of this mistake):

    ```yaml
    some_key: "Amazing," said Joe.
    another: "\"Yes, indeed,\" said Alice, with proper escaping."
    ```

- Invalid escape sequences in double-quoted strings.

    ```yaml
    some_key: "Escaping a \' is not only unnecessary; but it's actually an error in YAML."
    another: "Unicode escapes MUST be 4 or 8 characters, not \u22, two"
    ```

- `@` signs at the start of strings.

    ```yaml
    some_key: @this is not allowed
    ```

- `[` at the start of strings.

    ```yaml
    some_key: [TAG] you're it! But this breaks your parser.
    ```

- HTML entities at the start of strings, which are parsed as anchors in YAML:

    ```yaml
    some_key: &hellip;some text
    ```

- Mixed spaces and tabs in indentation.

- Mustache-esque template substitutions that are unquoted (depending whether your templates parse the YAML before or after substituting, you might need to quote these). e.g:

    ```yaml
    some_key: {{ premium_trial_link }}
    # vs:
    some_key: '{{ premium_trial_link }}'
    ```


## Installation and Usage

YAML Linter can be used as a CLI application or a library.


### Command-Line

You can install and use it as a command-lint application via NPM:

```sh
> npm install -g yaml-linter
```

And run it on a file:

```sh
> yaml-linter example.yaml
```

#### Options

- `--fix` Fix any issues that can be safely resolved automatically.
- `--debug` Print debug messages while parsing.
- `--help` Print information about usage and options.


### Library

You can use it as a library in your own programs. Add it to your `package.json` with NPM:

```sh
> npm install yaml-linter
```

And then use it in your JavaScript:

```js
const yamlLinter = require('yaml-linter');

// Lint a string of YAML code:
yamlLinter.lint('some: yaml text').then(results => console.log(results));

// Lint a file:
yamlLinter.lintFile('path/to/file.yaml').then(results => console.log(results));

// There's also a helper for linting Gulp/Vinyl streams:
function lintYamlFiles () {
  return gulp
    .src('path/to/files/*.yaml')
    .pipe(yamlLinter.lintGulpFileStream());
}
```

#### Functions

##### `lint(yamlText, [options])`

Lints a string of YAML source code. Arguments:

- `yamlText: string` YAML source code to lint.
- `options: object`
    - `filename: string` Path of file being linted. Used to make nicer error messages.
    - `debug: boolean` Print debug messages.
    - `fix: boolean` Include a string of YAML source with any automatically fixable errors fixed in the returned object.
    - `removeInvalidCharacters: boolean` Some characters are not allowed in YAML at all. If `true`, this will simply remove them from the YAML source. **Note this is `true` by default.** See details in the YAML spec: https://yaml.org/spec/1.2/spec.html#id2770814

Returns an object with:

- `issues: Array` List of `YAMLException` error objects. Each has:
    - `message: string`
    - `mark: {line: number, column: number}`
    - `level: string` One of: `error`, `warning`, or `fixed`
- `fixed: string` Will be a string if the `fix` option was `true` or `null` otherwise. Contains the “fixed” YAML source code.


##### `lintFile(filePath, [content], [options])`

Lints a YAML or Markdown file. If you have the `fix` option set, this will rewrite the file at `filePath` with the new, fixed YAML string. Arguments:

- `filePath: string` Path to file to lint. If the has a `.md` extension, this will try and extract the front-matter from the file and, if it looks YAML-ish, lint/fix that.
- `content: Buffer` Optional `Buffer` object with the contents of the file. If not provided, this function will read the file at `filePath`.
- `options: object` Options to pass to `lint()`.

Returns a promise for the return value of `lint()`.


##### `lintGulpFileStream([options])`

If you use Gulp, this is a helpful convenience. It creates a stream that will call `lintFile()` on each file object it receives with the given `options`. It will also print any issues with the files along the way and, at the end of the stream, print a summary of how many warnings, errors, and fixed issues were found.


## Roadmap

First off, a HUGE thanks to [Asana, Inc.][asana] for support the development of this package. It was originally developed as part of a consulting project there, and they have graciously supported open-sourcing the results.

- Work to see how the ideas here might be integrated into existing YAML parsers. In many cases, parsers might be able to offer clearer messaging like what’s found here. Of course, this package does a lot of extra work not to stop early or to look at the surrounding context to determine what might have been intended. A lot of that might be reasonably outside the scope of a parser.
    - Work with [`js-yaml`][js-yaml] authors to solidify the private interfaces this relies on!

- Support walking directory trees in the command-line application (it currently only supports single files).

- Clean up linting code and split different issue types into separate "rule" objects so it’s a little easier to manage.

- Make it possible to specify *which* rules you’d like to fix instead of fixing everything or nothing.

- Add style-focused rules? The Python [`yamllint`][py-yamllint] already does a great job of this, so it’s not a huge priority at the moment.


## Contributing

Have errors or additional situations this doesn’t handle well? Want to help with the above roadmap items? We’d love your help. Please file an issue or PR in GitHub :)


## License

Copyright (c) 2019 Rob Brackett and [Asana, Inc.][asana]

Licensed under the BSD 3-clause license. See the `LICENSE` file for the full text of the license.


[asana]: https://asana.com
[flake8]: https://pypi.org/project/flake8/
[js-yaml]: https://www.npmjs.com/package/js-yaml
[pyflakes]: https://pypi.org/project/pyflakes/
[py-yamllint]: https://github.com/adrienverge/yamllint
