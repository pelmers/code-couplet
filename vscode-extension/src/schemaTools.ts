import { findSaveRoot, loadSchema, migrateToLatestFormat } from "@lib/schema";
import { CurrentFile, emptySchema } from "@lib/types";
import { schemaRangeToVscode } from "./typeConverters";

import * as vscode from "vscode";

export async function findRootAndSchema(uri: vscode.Uri) {
  const { workspaceFolders } = vscode.workspace;
  const saveRoot = await findSaveRoot(
    uri,
    (workspaceFolders || []).map((ws) => ws.uri)
  );
  const currentSchema = await loadSchema(saveRoot, uri);
  if (currentSchema == null) {
    return { schema: emptySchema(), saveRoot };
  } else {
    return { schema: migrateToLatestFormat(currentSchema), saveRoot };
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
