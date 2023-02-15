import { resolveCodePath } from "@lib/schema";
import { CurrentCommentWithUri } from "@lib/types";
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
  comments: CurrentCommentWithUri[],
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
  const editorUri = editor.document.uri.toString();
  const commentRanges = [];
  const codeRanges = [];
  for (const {sourceUri, comment} of comments) {
    if (sourceUri === editorUri) {
      const commentRange = schemaRangeToVscode(comment.commentRange);
      commentRanges.push(commentRange);
    }
    if (resolveCodePath(vscode.Uri.parse(sourceUri), comment).toString() === editorUri) {
      const codeRange = schemaRangeToVscode(comment.codeRange);
      codeRanges.push(codeRange);
    }
  }
  editor.setDecorations(commentDecorationType, commentRanges);
  editor.setDecorations(codeDecorationType, codeRanges);

  log(
    `Applied ${commentRanges.length} decorations to ${editor.document.uri.fsPath}`
  );
}
