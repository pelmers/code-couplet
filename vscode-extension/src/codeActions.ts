import { PROJECT_NAME } from "@lib/constants";
import { ErrorType, ValidationError } from "@lib/validation";
import * as vscode from "vscode";
import { log } from "./logging";
import { schemaRangeToVscode } from "./typeConverters";

export function activate(context: vscode.ExtensionContext) {
  const commands = new CodeActions();
  context.subscriptions.push(commands);
}

class CodeActions {
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.Disposable.from(
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, this, {
        providedCodeActionKinds: CodeActions.providedCodeActionKinds,
      })
    );
  }

  async provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    // Check if context contains a diagnostic we produced
    const ourDiagnostics = context.diagnostics.filter(
      (d) => d.source === PROJECT_NAME
    );
    const codeActions = [];

    const makeWorkspaceEditAction = (
      title: string,
      uri: vscode.Uri,
      fixRange: vscode.Range,
      newValue: string
    ) => {
      const action = new vscode.CodeAction(
        title,
        vscode.CodeActionKind.QuickFix
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fixRange, newValue);
      action.edit = edit;
      return action;
    };

    for (const diag of ourDiagnostics) {
      if (!diag.relatedInformation || diag.relatedInformation.length === 0) {
        continue;
      }
      const codeLocation = diag.relatedInformation[0].location;
      const error: { t: ErrorType; comment: string; code: string } = JSON.parse(
        diag.relatedInformation[0].message as string
      );
      // Available actions depend on the error type.
      // For text mismatches, offer to change schema to current value of the range.
      if (
        error.t === ErrorType.CommentMismatch ||
        error.t === ErrorType.BothMismatch
      ) {
        codeActions.push(
          makeWorkspaceEditAction(
            `Change comment to "${error.comment}"`,
            doc.uri,
            diag.range,
            error.comment
          )
        );
      }
      if (
        error.t === ErrorType.CodeMismatch ||
        error.t === ErrorType.BothMismatch
      ) {
        codeActions.push(
          makeWorkspaceEditAction(
            `Change code to "${error.code}"`,
            codeLocation.uri,
            codeLocation.range,
            error.code
          )
        );
      }
    }
    return codeActions;
  }

  dispose() {
    this.disposable.dispose();
  }
}
