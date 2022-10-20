import { PROJECT_NAME } from "@lib/constants";
import { CurrentFile } from "@lib/types";
import * as vscode from "vscode";
import { log } from "./logging";
import { schemaRangeToVscode } from "./typeConverters";

const DECORATION_MAX_LINES = 10000;

/**
 * Decorate a document with comment and code linked ranges by reading the schema
 * Only applies when the document is not dirty (call after saving or on open)
 */
export function decorate(
  editor: vscode.TextEditor,
  comments: CurrentFile["comments"],
  commentDecorationType: vscode.TextEditorDecorationType,
  codeDecorationType: vscode.TextEditorDecorationType
) {
  if (editor.document.lineCount > DECORATION_MAX_LINES) {
    log(
      `Skipped decoration of ${editor.document.uri.fsPath} because it has more than ${DECORATION_MAX_LINES} lines`
    );
    return;
  }
  if (editor.document.isDirty) {
    log(
      `Skipped decoration of ${editor.document.uri.fsPath} because it is dirty`
    );
    return;
  }
  editor.setDecorations(commentDecorationType, []);
  editor.setDecorations(codeDecorationType, []);
  const commentRanges = [];
  const codeRanges = [];
  for (const comment of comments) {
    // If the comment and code values match the document, then we can decorate them
    // otherwise we will show a diagnostic to the user
    const commentRange = schemaRangeToVscode(comment.commentRange);
    const codeRange = schemaRangeToVscode(comment.codeRange);
    commentRanges.push(commentRange);
    codeRanges.push(codeRange);
  }
  editor.setDecorations(commentDecorationType, commentRanges);
  editor.setDecorations(codeDecorationType, codeRanges);

  log(
    `Applied ${commentRanges.length} decorations to ${editor.document.uri.fsPath}`
  );
}
