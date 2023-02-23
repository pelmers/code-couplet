# CommentPin

**A typechecker for your comments.**

A simple VS Code extension which checks that your code and comments are in sync.
Think of it as a typechecker for your comments.

## Usage

CommentPin itself is a Node program which reads a stored description of code-comment relationships and verifies the codebase against these relationships.
These are stored in a `.pinned-comments` folder in the root of your repository.
_Commit this folder into version control._

Currently CommentPin is provided through a [VS Code extension](TODO-link).
In the future I expect to extend the tool to be accessible on the command line, as a Git pre-commit hook, and as a continuous integration job.

### VS Code

The VS Code extension for CommentPin provides a quick way to link comments with code.
TODO: screencast

It also verifies existing connections and provides diagnostic errors.
In case lines are moved, the diagnostic errors include
TODO: screencast

## Schema

Schema is defined in Typescript and encoded/decoded using io-ts with JSON serialization.
See [`src/schema.ts`](src/schema.ts).
