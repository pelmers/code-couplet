import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./commentParser";

import { PROJECT_NAME } from "@lib/constants";
import { saveSchema } from "@lib/schema";
import { getErrorMessage } from "@lib/utils";
import { vscodeRangeToSchema, pos } from "./typeConverters";
import { findRootAndSchema, findIndexOfMatchingRanges } from "./schemaTools";
import { log, errorWrapper as e } from "./logging";
import { SchemaModel } from "./SchemaModel";

export function activate(
  context: vscode.ExtensionContext,
  schemaModel: SchemaModel,
  languageConfig: LanguageConfiguration
) {
  const commands = new Commands(schemaModel, languageConfig);
  context.subscriptions.push(commands);
}
class Commands {
  disposable: vscode.Disposable;

  constructor(
    private schemaModel: SchemaModel,
    private languageConfig: LanguageConfiguration
  ) {
    this.disposable = vscode.Disposable.from(
      // 1. register command to couple code + comments
      vscode.commands.registerCommand("code-couplet-vscode.linkSelection", () =>
        e(this.autoLinkSelectionCommand, {
          showErrorMessage: true,
          errorPrefix: "Link Selection Command",
        })()
      )
      // TODO:
      // 1b. register command to manually link comment, then manually select code
      // TODO:
      // 1c. register command to remove a linked comment and code
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
  ): Promise<{ status: string }> {
    const schema = (await this.schemaModel.loadSchemaByUri(
      editor.document.uri,
      { checkHash: true }
    ))!;
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
    // TODO: what if the file is dirty and the existing schema comments need to move first?
    // i.e. the saved schema we just loaded is out of date
    if (existingIndex == -1) {
      schema.comments.push({
        commentRange: vscodeRangeToSchema(commentRange),
        codeRange: vscodeRangeToSchema(codeRange),
        commentValue,
        codeValue,
      });
      await this.schemaModel.saveSchemaByUri(editor.document.uri, schema, {
        checkHash: true,
      });
      this.schemaModel.decorateByEditor(editor, schema.comments);
      return { status: "added" };
    } else {
      schema.comments[existingIndex].commentValue = commentValue;
      schema.comments[existingIndex].codeValue = codeValue;
      await this.schemaModel.saveSchemaByUri(editor.document.uri, schema, {
        checkHash: true,
      });
      this.schemaModel.decorateByEditor(editor, schema.comments);
      return { status: "updated" };
    }
  }

  /**
   * Remove the linked sections from the map file by loading the existing one and then saving it
   */
  async removeRangeFromMap(
    editor: vscode.TextEditor,
    commentRange: vscode.Range,
    codeRange: vscode.Range
  ): Promise<{ status: "removed" | "not found"; saveRoot: vscode.Uri }> {
    const { schema, saveRoot } = await findRootAndSchema(editor.document.uri);
    if (editor.document.isDirty) {
      throw new Error(
        `Cannot remove link because of unsaved changes. Please save the document first.`
      );
    }
    // Find the codeRange and commentRange in the existing comments, and remove them
    const existingIndex = findIndexOfMatchingRanges(
      schema,
      codeRange,
      commentRange
    );
    if (existingIndex == -1) {
      return { saveRoot, status: "not found" };
    } else {
      schema.comments.splice(existingIndex, 1);
      await this.schemaModel.saveSchemaByUri(editor.document.uri, schema, {
        checkHash: true,
      });
      this.schemaModel.decorateByEditor(editor, schema.comments);
      return { saveRoot, status: "removed" };
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
        selection.end.with({ character: 0, line: selection.end.line + 1 })
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
    for (let line = start.line; line < end.line; line++) {
      const lineType = getLineType(line);
      if (lineType === "empty") {
        continue;
      }
      if (lineType === "comment") {
        if (codeRange) {
          throw new Error(
            "multiple comment blocks detected, but I expected only one comment block followed by a code block in the selection"
          );
        }
        if (commentRange) {
          commentRange = commentRange.with(
            commentRange.start,
            pos(line + 1, 0)
          );
        } else {
          commentRange = new vscode.Range(pos(line, 0), pos(line + 1, 0));
        }
      } else if (lineType === "code") {
        if (!commentRange) {
          throw new Error(
            "code seen before comment, but I expected a comment first"
          );
        }
        if (codeRange) {
          codeRange = codeRange.with(codeRange.start, pos(line + 1, 0));
        } else {
          codeRange = new vscode.Range(pos(line, 0), pos(line + 1, 0));
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
        await this.showLinkingSuccessMessage(
          editor,
          commentRange,
          codeRange,
          result
        );
      } else {
        // Show a status bar message instead
        const { status } = result;
        vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
      }
    }
  };

  /**
   * Shows a linking success info message with buttons to undo and never show again
   */
  async showLinkingSuccessMessage(
    editor: vscode.TextEditor,
    commentRange: vscode.Range,
    codeRange: vscode.Range,
    result: { status: string }
  ) {
    const undo = "Undo";
    const neverAgain = "Don't show again";
    const choice = await vscode.window.showInformationMessage(
      `Comment link: ${result.status}`,
      undo,
      neverAgain
    );
    if (choice === undo) {
      const result = await this.removeRangeFromMap(
        editor,
        commentRange,
        codeRange
      );
      if (result.status == "not found") {
        throw new Error(`could not undo comment link: link not found`);
      } else {
        vscode.window.showInformationMessage("Unlinked comment with code", {
          detail: `Location: ${result.saveRoot.fsPath}`,
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
