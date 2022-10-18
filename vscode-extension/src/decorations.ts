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
  comments: CurrentFile["comments"]
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
  // TODO: Question: should we colorize each pair differently? Or same color for all texts?
  const commentDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 255, 0, 0.2)",
    // Border doesn't look great because I like to draw the range to the first char of the next line
    // TODO: if we want to include border then add logic to shorten range by 1 if they do that
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });
  const codeDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 100, 255, 0.2)",
    // see above note on borders
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });
  const commentRanges = [];
  const codeRanges = [];
  for (const comment of comments) {
    // If the comment and code values match the document, then we can decorate them
    // otherwise we will show a diagnostic to the user
    const commentRange = schemaRangeToVscode(comment.commentRange);
    const codeRange = schemaRangeToVscode(comment.codeRange);
    if (
      comment.commentValue === editor.document.getText(commentRange) &&
      comment.codeValue === editor.document.getText(codeRange)
    ) {
      commentRanges.push(commentRange);
      codeRanges.push(codeRange);
    }
  }
  editor.setDecorations(commentDecorationType, commentRanges);
  editor.setDecorations(codeDecorationType, codeRanges);

  log(
    `Applied ${commentRanges.length} decorations to ${editor.document.uri.fsPath}`
  );
}
