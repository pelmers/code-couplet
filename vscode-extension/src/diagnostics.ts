import * as vscode from "vscode";

import { CurrentFile } from "@lib/types";
import { PROJECT_NAME } from "@lib/constants";
import { validate } from "@lib/validation";
import { schemaRangeToVscode, vscodeDocumentToNode } from "./typeConverters";

export function getDiagnostics(doc: vscode.TextDocument, schema: CurrentFile) {
  // TODO: put the logic in src/validate.ts instead of implementing here
  validate(vscodeDocumentToNode(doc), schema);
  const diagnostics: vscode.Diagnostic[] = [];
  for (const comment of schema!.comments) {
    const commentRange = schemaRangeToVscode(comment.commentRange);
    const codeRange = schemaRangeToVscode(comment.codeRange);
    const commentText = doc.getText(commentRange);
    const codeText = doc.getText(codeRange);
    const makeDiagnostic = (range: vscode.Range, message: string) => ({
      range,
      message,
      severity: vscode.DiagnosticSeverity.Error,
      source: PROJECT_NAME,
      code: comment.id,
    });
    if (commentText !== comment.commentValue) {
      diagnostics.push(
        makeDiagnostic(
          commentRange,
          `Comment text does not match schema. Expected: "${comment.commentValue}", got: "${commentText}"`
        )
      );
    } else if (codeText !== comment.codeValue) {
      diagnostics.push(
        makeDiagnostic(
          codeRange,
          `Code text does not match schema. Expected: "${comment.codeValue}", got: "${codeText}"`
        )
      );
    }
  }
  return diagnostics;
}
