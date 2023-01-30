import { File, CurrentFile, TFile, CurrentComment } from "./types";
import { URI, Utils } from "vscode-uri";
import { exists, FileType, getFs } from "./fsShim";
import { isRight } from "fp-ts/lib/Either";

import * as path from "path";

// Note: crypto is node-only, if we want to support web we'll need to use a different library
import * as crypto from "crypto";

const fs = getFs();

const PATH_TRANSFORM_FRAGMENT = "cCCc";
const KNOWN_FOLDER_NAME = ".cc_mappings";

const saveRootCache = new Map<string, URI>();

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
export const findSaveRoot = async (
  sourceFilePath: URI,
  workspaceFolders?: URI[]
): Promise<URI> => {
  async function findRoot() {
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
  if (saveRootCache.has(sourceFilePath.fsPath)) {
    return saveRootCache.get(sourceFilePath.fsPath)!;
  } else {
    const root = await findRoot();
    saveRootCache.set(sourceFilePath.fsPath, root);
    return root;
  }
};

/**
 * Join save root and relative source file path into a path to its schema file
 * If the sourcePath is not located under saveRoot, then throw an error.
 * Input saveRoot is the path to the workspace/repository root, computed by findSaveRoot.
 */
export function buildSchemaPath(saveRoot: URI, sourceURI?: URI): URI {
  if (!sourceURI) {
    return Utils.joinPath(saveRoot, KNOWN_FOLDER_NAME);
  }
  let sourcePath = sourceURI.path;
  // Remove the first part of sourcePath which overlaps saveRoot and the trailing slash
  sourcePath = sourcePath.slice(saveRoot.path.length + 1);
  const transformedSourcePath =
    sourcePath.replace(/\//g, PATH_TRANSFORM_FRAGMENT) + ".json";
  return Utils.joinPath(saveRoot, KNOWN_FOLDER_NAME, transformedSourcePath);
}

export function schemaFileUriToSourceUri(schemaFileUri: URI) {
  const sourcePath = schemaFileUri.path
    .slice(
      KNOWN_FOLDER_NAME.length +
        schemaFileUri.path.lastIndexOf(KNOWN_FOLDER_NAME) +
        1
    )
    .replace(/\.json$/, "")
    .replace(new RegExp(PATH_TRANSFORM_FRAGMENT, "g"), "/");
  // The schema file is in the folder under the root, so go up one more to reach root
  const saveRoot = Utils.dirname(Utils.dirname(schemaFileUri));
  return Utils.joinPath(saveRoot, sourcePath);
}

// Save the comment schema to its map file, returns the URI of the saved path.
export async function saveSchema(
  saveRoot: URI,
  sourceFilePath: URI,
  schema: CurrentFile
): Promise<{ saveUri: URI; hash: string }> {
  const saveUri = buildSchemaPath(saveRoot, sourceFilePath);
  const contents = Buffer.from(JSON.stringify(schema, null, 2));
  await fs.writeFile(saveUri, contents);
  return {
    saveUri,
    hash: crypto.createHash("md5").update(contents.toString()).digest("hex"),
  };
}

// Load the existing comment schema for the given file. If not found, then null.
// May throw an error if the schema is invalid.
export async function loadSchema(
  saveRoot: URI,
  sourceFilePath: URI
): Promise<{ schema: CurrentFile; hash: string } | null> {
  const schemaPath = buildSchemaPath(saveRoot, sourceFilePath);
  if (!(await exists(schemaPath))) {
    return null;
  }

  const contents = (await fs.readFile(schemaPath)).toString();
  // Parse contents with io-ts for File decoder
  const validation = File.decode(JSON.parse(contents));
  if (!isRight(validation)) {
    throw new Error(`Could not decode schema at ${sourceFilePath.path}`);
  }
  return {
    schema: migrateToLatestFormat(validation.right),
    hash: crypto.createHash("md5").update(contents).digest("hex"),
  };
}

export function migrateToLatestFormat(file: TFile): CurrentFile {
  return file;
}

export function resolveCodePath(sourceUri: URI, comment: CurrentComment) {
  // Resolve the uri based on source uri and code relative path
  return Utils.joinPath(sourceUri, comment.codeRelativePath);
}

export function getCodeRelativePath(commentUri: URI, codeUri: URI) {
  return path.relative(commentUri.path, codeUri.path);
}
