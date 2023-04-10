import { PROJECT_NAME } from "@lib/constants";
import { ErrorType, ValidationError } from "@lib/validation";
import * as vscode from "vscode";
import { SchemaIndex } from "./SchemaIndex";
import { schemaRangeToVscode } from "./typeConverters";
import { CurrentComment } from "@lib/types";
import { errorWrapper as e } from "./logging";
import { documentForUri } from "./vscodeUtils";
import { resolveCodePath } from "@lib/schema";

const FIX_MOVED_COMMENT_COMMAND = "code-couplet:fixMovedComment";

export function activate(
  context: vscode.ExtensionContext,
  schemaIndex: SchemaIndex
) {
  const commands = new CodeActions(schemaIndex);
  context.subscriptions.push(commands);
}

class CodeActions {
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  disposable: vscode.Disposable;

  constructor(private schemaIndex: SchemaIndex) {
    this.disposable = vscode.Disposable.from(
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, this, {
        providedCodeActionKinds: CodeActions.providedCodeActionKinds,
      }),
      vscode.commands.registerCommand(FIX_MOVED_COMMENT_COMMAND, (...args) =>
        e(this.fixMovedComment, {
          showErrorMessage: true,
          errorPrefix: "Quickfix move pinned comment",
        })(args[0])
      )
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
    const codeActions: vscode.CodeAction[] = [];

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

    const makeMoveCommentAction = (
      title: string,
      oldCommentUri: vscode.Uri,
      oldCommentId: number,
      newComment: CurrentComment
    ) => {
      const action = new vscode.CodeAction(
        title,
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        title: "Fix moved comment",
        command: FIX_MOVED_COMMENT_COMMAND,
        arguments: [{ oldCommentId, oldCommentUri, newComment }],
      };
      action.isPreferred = true;
      return action;
    };

    for (const diag of ourDiagnostics) {
      // We sneak the error into the code field of the diagnostic, as the location uri fragment
      if (!diag.code || typeof diag.code !== "object" || !diag.code.target) {
        continue;
      }
      const error: ValidationError = JSON.parse(diag.code.target.fragment);
      const { commentId, commentUriString, errorType } = error;
      if (error.moveFix) {
        const newComment = error.moveFix;
        const oldCommentUri = vscode.Uri.parse(commentUriString);
        const updateType =
          errorType === ErrorType.CommentMismatch
            ? "comment"
            : errorType === ErrorType.CodeMismatch
            ? "code"
            : "comment and code";
        const title = `New location found: Move ${updateType} pin data`;
        codeActions.push(
          makeMoveCommentAction(title, oldCommentUri, commentId, newComment)
        );
      }

      // Available actions depend on the error type.
      // For text mismatches, offer to change schema to current value of the range.
      if (
        errorType === ErrorType.CommentMismatch ||
        errorType === ErrorType.BothMismatch
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
        errorType === ErrorType.CodeMismatch ||
        errorType === ErrorType.BothMismatch
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
    }
    return codeActions;
  }

  fixMovedComment = async ({
    oldCommentId,
    oldCommentUri,
    newComment,
  }: {
    oldCommentId: number;
    oldCommentUri: vscode.Uri;
    newComment: CurrentComment;
  }) => {
    const schema = await this.schemaIndex.getSchemaByUri(oldCommentUri);
    if (!schema) {
      throw new Error("Schema not found");
    }
    // Find the old comment with the given id and replace with the new comment, then save schema and publish diagnostics
    const oldCommentIndex = schema.comments.findIndex(
      (c) => c.id === oldCommentId
    );
    if (oldCommentIndex === -1) {
      throw new Error("Old comment not found, cannot update");
    }
    schema.comments[oldCommentIndex] = newComment;
    await this.schemaIndex.saveSchemaByUri(oldCommentUri, schema, {
      checkHash: true,
    });
    const codeUri = resolveCodePath(oldCommentUri, newComment);
    await this.schemaIndex.decorateByUri(codeUri);
    await this.schemaIndex.decorateByUri(oldCommentUri);
    await this.schemaIndex.publishDiagnostics(
      await documentForUri(oldCommentUri)
    );
  };

  dispose() {
    this.disposable.dispose();
  }
}
