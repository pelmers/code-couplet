# Code Couplet

### (working name)

**A typechecker for your comments.**

<!-- if I keep "couplet" this intro could be a little poem -->

Code Couplet is a simple program which checks that your code and comments are in sync.
It solves the age-old problem of outdated comments no longer matching code that has been changed.
Just like a typechecker, this tool gives you confidence that your comments mean what you expect.

## Usage

Code Couplet itself is a Node program which reads a stored description of code-comment relationships and verifies the codebase against these relationships.
These are stored in a `.code-couplet` folder in the root of your repository, and you should commit them into version control.

There are several ways to interact with this program.

1. Editor plugins (e.g. VS Code)
2. Git pre-commit hook
3. Continuous integration job, such as Github Actions

### VS Code

The VS Code extension for Code Couplet provides a quick way to link comments with code.
TODO: screencast

It also verifies existing connections and provides diagnostic errors.
In case lines are moved, the diagnostic errors include
TODO: screencast

### Git pre-commit hook

TODO!

### CI Job

TODO!

## Schema

Per managed file, a new file called {filename}.comment-map,
in a folder called .comment-maps at the repo root.
Schema is defined in Typescript and encoded/decoded using io-ts.
See `src/schema.ts`.
