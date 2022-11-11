import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./commentParser";

import { PROJECT_NAME } from "@lib/constants";
import { getCodeRelativePath } from "@lib/schema";
import { getErrorMessage } from "@lib/utils";
import { vscodeRangeToSchema, pos } from "./typeConverters";
import { findIndexOfMatchingRanges, nextId } from "./schemaTools";
import { log, errorWrapper as e } from "./logging";
import { SchemaIndex } from "./SchemaIndex";
import { CurrentComment } from "@lib/types";

export function activate(
  context: vscode.ExtensionContext,
  SchemaIndex: SchemaIndex,
  languageConfig: LanguageConfiguration
) {
  const commands = new Commands(SchemaIndex, languageConfig);
  context.subscriptions.push(commands);
}

function lastCharacterOfLine(
  document: vscode.TextDocument,
  line: number
): number {
  const lastLine = document.lineAt(line);
  return lastLine.range.end.character;
}

class Commands {
  disposable: vscode.Disposable;

  constructor(
    private schemaIndex: SchemaIndex,
    private languageConfig: LanguageConfiguration
  ) {
    this.disposable = vscode.Disposable.from(
      // 1. register command to couple code + comments
      vscode.commands.registerCommand("code-couplet-vscode.linkSelection", () =>
        e(this.autoLinkSelectionCommand, {
          showErrorMessage: true,
          errorPrefix: "Link Selection Command",
        })()
      ),
      // TODO:
      // 1b. register command to manually link comment, then manually select code
      // TODO:
      // 1c. register command to remove a linked comment and code
      vscode.commands.registerCommand("code-couplet-vscode.removeLink", () =>
        e(this.removeLinkedCommentCommand, {
          showErrorMessage: true,
          errorPrefix: "Remove Link Command",
        })()
      )
    );
  }

  /**
   * Commit the linked sections to the map file by loading the existing one and then saving it
   */
  async commitNewRangeToMap(
    editor: vscode.TextEditor,
    config: LanguageConfiguration,
    commentRange: vscode.Range,
    codeRange: vscode.Range
  ): Promise<{ status: string; comment: CurrentComment }> {
    const { uri } = editor.document;
    const schema = (await this.schemaIndex.getSchemaByUri(uri))!;
    const commentConfig = await config.GetCommentConfiguration(
      editor.document.languageId
    );
    if (editor.document.isDirty) {
      throw new Error(
        `Cannot link comment to code because of unsaved changes. Please save the document first.`
      );
    }

    const lineComment = commentConfig?.lineComment;
    schema.configuration.lineComment = lineComment || null;

    const commentValue = editor.document.getText(commentRange);
    const codeValue = editor.document.getText(codeRange);

    const existingIndex = findIndexOfMatchingRanges(
      schema,
      codeRange,
      commentRange
    );
    if (existingIndex == -1) {
      const id = nextId(schema);
      const comment = {
        commentRange: vscodeRangeToSchema(commentRange),
        codeRange: vscodeRangeToSchema(codeRange),
        codeRelativePath: getCodeRelativePath(uri, uri),
        commentValue,
        codeValue,
        id,
        isTracked: true,
      };
      schema.comments.push(comment);
      await this.schemaIndex.saveSchemaByUri(uri, schema, {
        checkHash: true,
      });
      await this.schemaIndex.decorateByEditor(editor);
      await this.schemaIndex.publishDiagnostics(editor.document);
      return { status: "added", comment };
    } else {
      schema.comments[existingIndex].commentValue = commentValue;
      schema.comments[existingIndex].codeValue = codeValue;
      await this.schemaIndex.saveSchemaByUri(uri, schema, {
        checkHash: true,
      });
      await this.schemaIndex.decorateByEditor(editor);
      await this.schemaIndex.publishDiagnostics(editor.document);
      return { status: "updated", comment: schema.comments[existingIndex] };
    }
  }

  /**
   * Remove the linked sections from the map file by loading the existing one and then saving it
   */
  async removeCommentFromSchema(
    editor: vscode.TextEditor,
    comment: CurrentComment
  ): Promise<
    { status: "removed"; saveUri: vscode.Uri } | { status: "not found" }
  > {
    const schema = (await this.schemaIndex.getSchemaByUri(
      editor.document.uri
    ))!;
    if (editor.document.isDirty) {
      throw new Error(
        `Cannot remove link because of unsaved changes. Please save the document first.`
      );
    }
    // Find the codeRange and commentRange in the existing comments, and remove them
    const existingIndex = schema.comments.findIndex((c) => c.id === comment.id);
    if (existingIndex == -1) {
      return { status: "not found" };
    } else {
      schema.comments.splice(existingIndex, 1);
      const saveUri = await this.schemaIndex.saveSchemaByUri(
        editor.document.uri,
        schema,
        {
          checkHash: true,
        }
      );
      await this.schemaIndex.decorateByEditor(editor);
      await this.schemaIndex.publishDiagnostics(editor.document);
      return { saveUri, status: "removed" };
    }
  }

  /**
   * VS Code command that expects a selection in the active editor that contains a comment followed by code
   * if we find that selection, then link the comment with the code and save to the schema
   */
  autoLinkSelectionCommand = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const { selection } = editor;
    let range: vscode.Range | undefined;
    if (!selection.isEmpty) {
      // Expand the selection to the start of the first line and the end of the last line
      // That way the user can be lazy about drawing selection boxes and it still works
      range = selection.with(
        selection.start.with({ character: 0 }),
        selection.end.with({
          character: lastCharacterOfLine(editor.document, selection.end.line),
          line: selection.end.line,
        })
      );
    }

    const start = range != null ? range.start : pos(0, 0);
    const end = range != null ? range.end : pos(editor.document.lineCount, 0);
    const commentsInSelection = await findSingleLineComments(
      editor,
      this.languageConfig,
      {
        range,
        throwOnEmpty: true,
      }
    );
    const linesWithComments = new Set<number>();
    for (const range of commentsInSelection) {
      linesWithComments.add(range.start.line);
    }
    // For now we only consider the case where the selection is comment(s) followed by code
    // Only one of each, and they cannot be on the same line
    // TODO later: in the future consider other formats such as inline comments
    const getLineType = (line: number): "comment" | "empty" | "code" => {
      if (linesWithComments.has(line)) {
        return "comment";
      }
      const { text } = editor.document.lineAt(line);
      // If a whitespace only search matches the whole line, then it's empty
      if (/\s*/g.exec(text)![0].length === text.length) {
        return "empty";
      }
      return "code";
    };
    let commentRange: vscode.Range | undefined;
    let codeRange: vscode.Range | undefined;
    for (let line = start.line; line <= end.line; line++) {
      const lineType = getLineType(line);
      if (lineType === "empty") {
        continue;
      }
      const endChar = lastCharacterOfLine(editor.document, line);
      if (lineType === "comment") {
        if (codeRange) {
          throw new Error(
            "multiple comment blocks detected, but I expected only one comment block followed by a code block in the selection"
          );
        }
        if (commentRange) {
          commentRange = commentRange.with(
            commentRange.start,
            pos(line, endChar)
          );
        } else {
          commentRange = new vscode.Range(pos(line, 0), pos(line, endChar));
        }
      } else if (lineType === "code") {
        if (!commentRange) {
          throw new Error(
            "code seen before comment, but I expected a comment first"
          );
        }
        if (codeRange) {
          codeRange = codeRange.with(codeRange.start, pos(line, endChar));
        } else {
          codeRange = new vscode.Range(pos(line, 0), pos(line, endChar));
        }
      }
    }
    if (!commentRange) {
      throw new Error("no comment block found in selection");
    }
    if (!codeRange) {
      throw new Error("no code block found in selection");
    }
    let result;
    try {
      result = await this.commitNewRangeToMap(
        editor,
        this.languageConfig,
        commentRange,
        codeRange
      );
    } catch (e) {
      throw new Error(`could not save comment link: ${getErrorMessage(e)}`);
    }

    if (result) {
      const showSuccessMessage = vscode.workspace
        .getConfiguration(PROJECT_NAME)
        .get<boolean>("showLinkingSuccessMessage");

      if (showSuccessMessage) {
        await this.showLinkingSuccessMessage(editor, result);
      } else {
        // Show a status bar message instead
        const { status } = result;
        vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
      }
    }
  };

  removeLinkedCommentCommand = async () => {
    // Get the list of links in the current file
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const { uri } = editor.document;
    const schema = await this.schemaIndex.getSchemaByUri(uri);
    if (!schema) {
      return;
    }
    if (schema.comments.length === 0) {
      throw new Error("No comments found in this file");
    }
    // Show the list of comments in a quickpick menu, with the corresponding code value as detail
    const commentItems = schema.comments.map((comment) => {
      const { commentRange, commentValue, codeValue, id } = comment;
      return {
        label: `Line ${commentRange.start.line + 1}: ${commentValue}`,
        detail: codeValue,
        comment,
      };
    });
    const selectedComment = await vscode.window.showQuickPick(commentItems, {
      placeHolder: "Select a comment to remove",
    });
    if (!selectedComment) {
      return;
    }
    const { status } = await this.removeCommentFromSchema(
      editor,
      selectedComment.comment
    );
    if (status === "removed") {
      vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
    } else {
      throw new Error(`could not remove comment link: ${status}`);
    }
  };

  /**
   * Shows a linking success info message with buttons to undo and never show again
   */
  async showLinkingSuccessMessage(
    editor: vscode.TextEditor,
    result: { status: string; comment: CurrentComment }
  ) {
    const { status, comment } = result;
    const undo = "Undo";
    const neverAgain = "Don't show again";
    const choice = await vscode.window.showInformationMessage(
      `Comment link: ${status}`,
      undo,
      neverAgain
    );
    if (choice === undo) {
      const undoResult = await this.removeCommentFromSchema(editor, comment);
      if (undoResult.status == "not found") {
        throw new Error(`could not undo comment link: link not found`);
      } else {
        vscode.window.showInformationMessage("Unlinked comment with code", {
          detail: `Location: ${undoResult.saveUri.fsPath}`,
        });
      }
    } else if (choice === neverAgain) {
      await vscode.workspace
        .getConfiguration(PROJECT_NAME)
        .update("showLinkingSuccessMessage", false);
    }
  }

  dispose() {
    this.disposable.dispose();
  }
}
