import { findSaveRoot, loadSchema, migrateToLatestFormat } from "@lib/schema";
import { CurrentFile, emptySchema } from "@lib/types";
import { schemaRangeToVscode } from "./typeConverters";

import * as vscode from "vscode";

export const EMPTY_SCHEMA_HASH = "0";

export async function findRootAndSchema(uri: vscode.Uri) {
  const { workspaceFolders } = vscode.workspace;
  const saveRoot = await findSaveRoot(
    uri,
    (workspaceFolders || []).map((ws) => ws.uri)
  );
  const currentSchema = await loadSchema(saveRoot, uri);
  if (currentSchema == null) {
    return { schema: emptySchema(), saveRoot, hash: EMPTY_SCHEMA_HASH };
  } else {
    const { schema, hash } = currentSchema;
    return { schema: migrateToLatestFormat(schema), saveRoot, hash };
  }
}

export function findIndexOfMatchingRanges(
  schema: CurrentFile,
  codeRange: vscode.Range,
  commentRange: vscode.Range
): number {
  return schema.comments.findIndex((comment) => {
    const existingCommentRange = schemaRangeToVscode(comment.commentRange);
    const existingCodeRange = schemaRangeToVscode(comment.codeRange);
    return (
      existingCommentRange.isEqual(commentRange) &&
      existingCodeRange.isEqual(codeRange)
    );
  });
}

export function countNewLines(text: string): number {
  let pos = text.indexOf("\n");
  let count = 0;
  while (pos >= 0) {
    count++;
    pos = text.indexOf("\n", pos + 1);
  }
  return count;
}

export function lastLineLength(text: string): number {
  const lastLineIndex = text.lastIndexOf("\n");
  if (lastLineIndex === -1) {
    return text.length;
  }
  return text.length - lastLineIndex - 1;
}

export function copySchema(schema: CurrentFile): CurrentFile {
  // TODO: obviously this could be made more efficient
  return JSON.parse(JSON.stringify(schema));
}

/**
 * Return a unique id for the given schema by taking its current max and adding one
 */
export function nextId(schema: CurrentFile): number {
  let currentMax = -1;
  for (const comment of schema.comments) {
    currentMax = Math.max(currentMax, comment.id);
  }
  return currentMax + 1;
}
