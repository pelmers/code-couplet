// TODO: when we run the program,
// 1. look for existing schema files
// 2. check schemas against repo
// 3. output warnings/errors about mismatches
// 4. (if non-quiet?) if some can be automatically fixed, then offer to fix them interactively

import { PROJECT_NAME, SCHEMA_VERSION } from "./src/constants";

console.log(`starting ${PROJECT_NAME} v${SCHEMA_VERSION}`);
