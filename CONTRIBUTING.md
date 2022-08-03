# Code components and structure

**Goal**: create system that keeps comments and referenced code in sync

**Components**:

- File format that describes comment - code relationships
- Editor integration that lets users create / update these files
- Check files for violations 1. on commit, 2. within editor as diagnostics
- Diff integration that can track changes and update them automatically
- Machine learning system that learns a model to predict probability that comment and code match
