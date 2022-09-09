import * as fs from "fs";
import * as util from "util";

import { File, CurrentFile } from "./types";
import { URI } from "vscode-uri";

export function emptySchema(): CurrentFile {
  return {
    version: 1,
    comments: [],
    configuration: {},
  };
}

/**
 * Find an appropriate place for the save root for comment schema of the given source path
 * This is determined in the following way:
 * 1. the closest repo root (e.g. .git folder),
 * 3. the closest workspace folder,
 * 2. the closest comment schema folder (i.e. .c_couplet folder),
 * 4. the folder of the source file path itself
 */
export async function findSaveRoot(
  sourceFilePath: URI,
  workspaceFolders?: URI[]
): Promise<URI> {
  // TODO: implement those rules
  throw new Error("TODO");
  return sourceFilePath;
}

/**
 * Join save root and relative source file path into a path to its schema file
 * If the sourcePath is not located under saveRoot, then throw an error.
 */
export function buildSchemaPath(saveRoot: URI, sourcePath: URI): URI {
  // TODO: join save root and relative path somehow
  throw new Error("TODO");
  return sourcePath;
}

// Save the comment schema to its map file.
export async function saveSchema(
  saveRoot: URI,
  sourceFilePath: URI,
  schema: CurrentFile
): Promise<void> {
  // TODO: use io-ts here to save
  await util.promisify(fs.writeFile)(
    buildSchemaPath(saveRoot, sourceFilePath).fsPath,
    JSON.stringify(schema, null, 2)
  );
}

// Load the existing comment schema for the given file. If not found, then null.
export async function loadSchema(
  saveRoot: URI,
  sourceFilePath: URI
): Promise<File | null> {
  const schemaPath = buildSchemaPath(saveRoot, sourceFilePath);
  // TODO: check if schemapath exists
  const contents = await util.promisify(fs.readFile)(schemaPath.fsPath);
  // TODO: parse schema with io-ts
  return JSON.parse(contents.toString("utf8"));
}

export function migrateToLatestFormat(file: File): CurrentFile {
  return file;
}
