import { File, CurrentFile, emptySchema } from "./types";
import { URI, Utils } from "vscode-uri";
import { exists, FileType, getFs } from "./fsShim";

const fs = getFs();

const PATH_TRANSFORM_FRAGMENT = "cCCc";
const KNOWN_FOLDER_NAME = ".cc_mappings";

async function findClosestParentContainingFolder(
  from: URI,
  folderName: string
): Promise<URI | null> {
  // If from is already a folder, then start there. Otherwise start at the containing folder.
  let parent =
    (await fs.stat(from)).type === FileType.Directory
      ? from
      : Utils.dirname(from);
  while (parent.path.length > 1) {
    const entries = await fs.readDirectory(parent);
    for (const [name, typ] of entries) {
      if (typ === FileType.Directory && name === folderName) {
        return parent;
      }
    }
    parent = Utils.dirname(parent);
  }
  return null;
}

/**
 * Find an appropriate place for the save root for comment schema of the given source path
 * This is determined in the following way:
 * 1. the closest repo root (e.g. .git folder),
 * 3. the closest workspace folder,
 * 2. the closest comment schema folder (i.e. KNOWN_FOLDER_NAME folder),
 * 4. the folder of the source file path itself
 */
export async function findSaveRoot(
  sourceFilePath: URI,
  workspaceFolders?: URI[]
): Promise<URI> {
  // Case 1: repo root
  const repoRoots = (
    await Promise.all([
      findClosestParentContainingFolder(sourceFilePath, ".git").catch(
        () => null
      ),
      findClosestParentContainingFolder(sourceFilePath, ".svn").catch(
        () => null
      ),
      findClosestParentContainingFolder(sourceFilePath, ".hg").catch(
        () => null
      ),
    ])
  ).filter(Boolean);
  // If any of repoRoots are non-empty, pick the closest one and return its URI
  // Sorting: the closest one to sourceFilePath is the longest path
  repoRoots.sort((a, b) => b!.fsPath.length - a!.fsPath.length);
  if (repoRoots.length > 0 && repoRoots[0] != null) {
    return repoRoots[0];
  }
  // Case 2: workspace folder
  if (workspaceFolders != null) {
    const sortedWorkspaceFolders = workspaceFolders
      .slice()
      .sort((a, b) => b.fsPath.length - a.fsPath.length);
    for (const wsFolder of sortedWorkspaceFolders) {
      // If the wsFolder contains sourceFilePath, then return it
      if (sourceFilePath.fsPath.startsWith(wsFolder.fsPath)) {
        return wsFolder;
      }
    }
  }
  // Case 3: closest known name folder
  const knownRoot = await findClosestParentContainingFolder(
    sourceFilePath,
    KNOWN_FOLDER_NAME
  ).catch(() => null);
  if (knownRoot != null) {
    return knownRoot;
  }
  // Case 4: the folder containing the current file itself
  return Utils.dirname(sourceFilePath);
}

/**
 * Join save root and relative source file path into a path to its schema file
 * If the sourcePath is not located under saveRoot, then throw an error.
 * Input saveRoot is the path to the workspace/repository root, computed by findSaveRoot.
 */
export function buildSchemaPath(saveRoot: URI, sourcePath: URI): URI {
  const transformedSourcePath = sourcePath.path.replace(
    /\//g,
    PATH_TRANSFORM_FRAGMENT
  );
  return Utils.joinPath(saveRoot, KNOWN_FOLDER_NAME, transformedSourcePath);
}

// Save the comment schema to its map file.
export async function saveSchema(
  saveRoot: URI,
  sourceFilePath: URI,
  schema: CurrentFile
): Promise<void> {
  await fs.writeFile(
    buildSchemaPath(saveRoot, sourceFilePath),
    Buffer.from(JSON.stringify(schema))
  );
}

function validateSchema(schema: unknown): asserts schema is File {
}

// Load the existing comment schema for the given file. If not found, then null.
// May throw an error if the schema is invalid.
export async function loadSchema(
  saveRoot: URI,
  sourceFilePath: URI
): Promise<File | null> {
  const schemaPath = buildSchemaPath(saveRoot, sourceFilePath);
  if (!(await exists(schemaPath))) {
    return null;
  }

  const contents = JSON.parse((await fs.readFile(schemaPath)).toString())
  validateSchema(contents)
  return contents;
}

export function migrateToLatestFormat(file: File): CurrentFile {
  return file;
}
