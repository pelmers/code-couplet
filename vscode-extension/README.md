# Code Couplet: Comment Pinning

This VS Code extension provides a quick way to pin comments with code.
Once pinned, any change to the comment or code will be checked and a diagnostic error will appear if they are out of sync.

### Why do this?

Think of this tool as a _typechecker for your comments_.

Just like how typed code will definitely have the type you expect, a pinned comment will definitely match the code it was written for.
The idea is simple: once you have pinned your comment to your code, you don't need to worry that it does not match.
Pinned comments and code are highlighted in the editor and update their committed positions intelligently as you type.

## Usage

### Automatic Pinning

- Select a block of comments + code, then press CMD+SHIFT+A (or the command: "Code Couplet: Auto-pin Lines")
- This will link the entire comment block with every line of the selected code block.
- This link is saved in a schema file located in a `.code-couplet` folder in the root of your repository.
- **Do commit** this file!
  ![Example 1](examples/auto_pin_demo.gif)

### Manual Pinning

- For more fine-grained control, **select your comment**, then use the command "Code Couplet: Pin Selection"
- Then, **select your code** and run the same command again
- This lets you link any text with any other, _even in different files!_
  ![Example 2](examples/manual_pin_demo.gif)

### Diagnostics and Fixes

- The extension checks all pinned comments and code continuously
- If they do not match what is saved, then a diagnostic error will appear
- The error includes a quick fix to change the code or comment to match the saved value
- Of course, you can also remove a pin and reset it manually

### Hover and Definition

- Once you've pinned a pair of comment and code, hovering on one will show the other
- If they are in different files, then I also provide a "Go to Definition" to go from one to the other

## Additional

- For bugs and feature requests, please visit the repository [on GitHub](https://github.com/pelmers/code-couplet)

**Known Limitations**

- Auto-pinning only works with single-line commnents, and the comment has to be the whole line
- If schema files change outside the editor, they will not be noticed until the extension is restarted
