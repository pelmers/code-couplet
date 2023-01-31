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
      const error: ValidationError = JSON.parse(diag.code as string);
      // Available actions depend on the error type.
      // For text mismatches, offer to change schema to current value of the range.
      if (
        error.errorType === ErrorType.CommentMismatch ||
        error.errorType === ErrorType.BothMismatch
      ) {
        codeActions.push(
          makeWorkspaceEditAction(
            `Change comment to "${error.expected.comment}"`,
            doc.uri,
            diag.range,
            error.expected.comment
          )
        );
      }
      if (
        error.errorType === ErrorType.CodeMismatch ||
        error.errorType === ErrorType.BothMismatch
      ) {
        codeActions.push(
          makeWorkspaceEditAction(
            `Change code to "${error.expected.code}"`,
            vscode.Uri.parse(error.codeLocation.uriString),
            schemaRangeToVscode(error.codeLocation.range),
            error.expected.code
          )
        );
      }
      if (error.moveFix) {
        // TODO: If moveFix is available, offer to update schema to the found range.
        const { start, end } = error.moveFix.commentRange;
        log(
          `Move fix at ${start.line}:${start.char} to ${end.line}:${end.char} available, not implemented yet`
        );
      }
    }
    return codeActions;
  }

  dispose() {
    this.disposable.dispose();
  }
}
