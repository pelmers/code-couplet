# Code Couplet

**A typechecker for your comments.**

A simple VS Code extension which checks that your code and comments are in sync.
Think of it as a typechecker for your comments.

## Usage

Code Couplet itself is a Node program which reads a stored description of code-comment relationships and verifies the codebase against these relationships.
These are stored in a `.code-couplet` folder in the root of your repository.
_Commit this folder into version control._

Currently Code Couplet is a [VS Code extension](TODO-link).

### VS Code

The VS Code extension for Code Couplet provides a quick way to link comments with code.
TODO: screencast

It also verifies existing connections and provides diagnostic errors.
In case lines are moved, the diagnostic errors include
TODO: screencast

## Schema

Schema is defined in Typescript and encoded/decoded using io-ts with JSON serialization.
See [`src/schema.ts`](src/schema.ts).

## Future Plans
 - Command line interface
 - Git pre-commit hook
 - Continuous integration job
