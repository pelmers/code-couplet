import * as vscode from "vscode";

import { CurrentFile } from "@lib/types";
import { PROJECT_NAME } from "@lib/constants";
import { ErrorType, validate } from "@lib/validation";
import { schemaRangeToVscode, vscodeDocumentToNode } from "./typeConverters";

export async function getDiagnostics(
  doc: vscode.TextDocument,
  schema: CurrentFile
): Promise<vscode.Diagnostic[]> {
  const errors = await validate(vscodeDocumentToNode(doc), schema);
  return errors.map((error) => {
    let message: string;
    if (error.errorType === ErrorType.CommentMismatch) {
      message = `Comment text does not match schema. Expected: "${error.expected.comment}", got: "${error.actual.comment}"`;
    } else if (error.errorType === ErrorType.CodeMismatch) {
      message = `Code does not match schema. Expected: "${error.expected.code}", got: "${error.actual.code}"`;
    } else if (error.errorType === ErrorType.BothMismatch) {
      message = `Both code and comment do not match schema. Expected: "${error.expected.comment}", got: "${error.actual.comment}"`;
    } else {
      message = `Unknown error`;
    }
    // Dear copilot, how can I add extra context into the diagnostic that is hidden from the user interface?
    return {
      range: schemaRangeToVscode(error.commentRange),
      message,
      severity: vscode.DiagnosticSeverity.Error,
      source: PROJECT_NAME,
      code: error.commentId,
      // Pass along related info that tells the code action what were the expected values
      relatedInformation: [
        {
          location: {
            uri: error.codeLocation.uri,
            range: schemaRangeToVscode(error.codeLocation.range),
          },
          message: JSON.stringify({t: error.errorType, ...error.expected}),
        },
      ],
    };
  });
}
