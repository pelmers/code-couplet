# Comment Dentist (typescript module)

Node module and on-disk file schema for maintaining relationships between comments and the code it refers to.
Expected to be used with comments mostly, but it can also represent code-to-code.
But isn't that the typechecker's job usually?

## Schema
Per managed file, a new file called {filename}.comment-map,
in a folder called .comment-maps at the repo root.
Schema is defined in Typescript and encoded/decoded using io-ts.

```typescript
type Position = {
    line: number;
    char: number;
}
type Range = {
    start: Position;
    end: Position;
}
type Comment = {
    type: 'absolute' | 'relative';
    commentValue: string;
    commentRange: Range
    codeRange: Range
    codeValue: string;
    codeFile?: string;
}
type File = {
    version: number;
    comments: Comment[];
}
```

## Updating
- Try to automatically update stored config to match changes
- Uses the output of git diff
- Updating comments/code:
 - Check in the file if the comment/code value is still there.
 - Offer to update range for this value.
 - Else, check if range is still in bounds.
 - Offer to upate value to this range.

## Validation
- Validate schema against the actual comments
- Prints places where the comments no longer match the real code
### Git Hook
- You can run this script as a git hook to make sure your commits are always clean!
- Usage:
### Github Action
- See the workflow file included in this repo
- TODO: https://docs.github.com/en/actions/learn-github-actions/finding-and-customizing-actions
