# TODO: new name for this crap.
# Guardian of Comments? GoC
# Keeper of Comments? like rice coffeehouse

# Comment Dentist (typescript module)
# C3 Code Comment Consistency (but then what domain name could I pick???)

Node module and on-disk file schema for maintaining relationships between comments and the code it refers to.
Expected to be used with comments mostly, but it can also represent code-to-code.
But isn't that the typechecker's job usually?

## Schema

Per managed file, a new file called {filename}.comment-map,
in a folder called .comment-maps at the repo root.
Schema is defined in Typescript and encoded/decoded using io-ts.
See `src/schema.ts`.

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

### TODO: new idea, ML based thing
Could be set up as a service
Train model that for given code context, predicts whether the code and comment match
ideally something self-supervised, or maybe mechanical turk powered labeling

model idea:
inputs: code/comment pairs (nearby? limited length?)
output: relevance score
then at commit time, if comment/paired code changes and the predicted relevance decreases then give alert

e.g. use some trusted / well commented repo
different model for each programming language? or can one generalize? maybe a data augmentation idea?

another question: how to tokenize comments/code for the model?
probably run it through a parser first? or just regex line prefix based?
some examples, https://huggingface.co/docs/transformers/preprocessing