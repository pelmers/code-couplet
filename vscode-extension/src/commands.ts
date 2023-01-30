import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./commentParser";

import { PROJECT_NAME } from "@lib/constants";
import { getCodeRelativePath } from "@lib/schema";
import { getErrorMessage } from "@lib/utils";
import {
  vscodeRangeToSchema,
  pos,
  fileToVscodeDocument,
} from "./typeConverters";
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

type Location = {
  uri: vscode.Uri;
  range: vscode.Range;
};

function lastCharacterOfLine(
  document: vscode.TextDocument,
  line: number
): number {
  const lastLine = document.lineAt(line);
  return lastLine.range.end.character;
}

async function documentForUri(uri: vscode.Uri): Promise<vscode.TextDocument> {
  // First see if vscode knows about the document
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.toString() === uri.toString()) {
      return doc;
    }
  }
  // Otherwise it's not open in the editor, export a TextDocument-compatible interface
  return fileToVscodeDocument(uri);
}

function editorForUri(uri: vscode.Uri): vscode.TextEditor | undefined {
  if (
    vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.uri.toString() === uri.toString()
  ) {
    return vscode.window.activeTextEditor;
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === uri.toString()) {
      return editor;
    }
  }
}

class Commands {
  disposable: vscode.Disposable;
  currentLinkContext: {
    commentLocation: Location;
    commentValue: string;
  } | null = null;

  constructor(
    private schemaIndex: SchemaIndex,
    private languageConfig: LanguageConfiguration
  ) {
    this.disposable = vscode.Disposable.from(
      // 1. register command to couple code + comments
      vscode.commands.registerCommand(
        "code-couplet-vscode.autoLinkSelection",
        () =>
          e(this.autoLinkSelectionCommand, {
            showErrorMessage: true,
            errorPrefix: "AutoLink Selection Command",
          })()
      ),
      vscode.commands.registerCommand("code-couplet-vscode.removeLink", () =>
        e(this.removeLinkedCommentCommand, {
          showErrorMessage: true,
          errorPrefix: "Remove Link Command",
        })()
      ),
      vscode.commands.registerCommand("code-couplet-vscode.linkSelection", () =>
        e(this.linkCommentCommand, {
          showErrorMessage: true,
          errorPrefix: "Link Comment",
        })()
      )
    );
  }

  /**
   * Commit the linked sections to the map file by loading the existing one and then saving it
   */
  async commitNewRangeToMap(
    config: LanguageConfiguration,
    commentLocation: Location,
    codeLocation: Location
    // TODO next: what if code is in another file lol
  ): Promise<{ status: string; comment: CurrentComment }> {
    const commentDocument = await documentForUri(commentLocation.uri);
    const codeDocument = await documentForUri(codeLocation.uri);
    const schema = (await this.schemaIndex.getSchemaByUri(
      commentLocation.uri
    ))!;
    const commentConfig = await config.GetCommentConfiguration(
      commentDocument.languageId
    );
    if (commentDocument.isDirty) {
      throw new Error(
        `Cannot link comment to code because of unsaved changes. Please save the document first.`
      );
    }

    const lineComment = commentConfig?.lineComment;
    schema.configuration.lineComment = lineComment || null;

    const commentValue = commentDocument.getText(commentLocation.range);
    const codeValue = codeDocument.getText(codeLocation.range);

    const existingIndex = findIndexOfMatchingRanges(
      schema,
      commentLocation.range,
      codeLocation.range
    );
    if (existingIndex == -1) {
      const id = nextId(schema);
      const comment = {
        commentRange: vscodeRangeToSchema(commentLocation.range),
        codeRange: vscodeRangeToSchema(codeLocation.range),
        codeRelativePath: getCodeRelativePath(
          commentLocation.uri,
          codeLocation.uri
        ),
        commentValue,
        codeValue,
        id,
      };
      schema.comments.push(comment);
      await this.schemaIndex.saveSchemaByUri(commentLocation.uri, schema, {
        checkHash: true,
      });
      const commentEditor = editorForUri(commentLocation.uri);
      if (commentEditor) {
        await this.schemaIndex.decorateByEditor(commentEditor);
      }
      await this.schemaIndex.publishDiagnostics(commentDocument);
      return { status: "added", comment };
    } else {
      schema.comments[existingIndex].commentValue = commentValue;
      schema.comments[existingIndex].codeValue = codeValue;
      await this.schemaIndex.saveSchemaByUri(commentLocation.uri, schema, {
        checkHash: true,
      });
      const commentEditor = editorForUri(commentLocation.uri);
      if (commentEditor) {
        await this.schemaIndex.decorateByEditor(commentEditor);
      }
      await this.schemaIndex.publishDiagnostics(commentDocument);
      return { status: "updated", comment: schema.comments[existingIndex] };
    }
  }

  /**
   * Save link between given ranges and show a status message indicating success or failure
   */
  async commitNewRangeAndShowMessage(
    commentLocation: Location,
    codeLocation: Location
  ) {
    let result;
    try {
      result = await this.commitNewRangeToMap(
        this.languageConfig,
        commentLocation,
        codeLocation
      );
    } catch (e) {
      throw new Error(`could not save comment link: ${getErrorMessage(e)}`);
    }

    if (result) {
      const showSuccessMessage = vscode.workspace
        .getConfiguration(PROJECT_NAME)
        .get<boolean>("showLinkingSuccessMessage");

      if (showSuccessMessage) {
        await this.showLinkingSuccessMessage(commentLocation.uri, result);
      } else {
        // Show a status bar message instead
        const { status } = result;
        vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
      }
    }
  }

  /**
   * Remove the linked sections from the map file by loading the existing one and then saving it
   */
  async removeCommentFromSchema(
    docUri: vscode.Uri,
    comment: CurrentComment
  ): Promise<
    { status: "removed"; saveUri: vscode.Uri } | { status: "not found" }
  > {
    const document = await documentForUri(docUri);
    const schema = (await this.schemaIndex.getSchemaByUri(docUri))!;
    if (document.isDirty) {
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
      const saveUri = await this.schemaIndex.saveSchemaByUri(docUri, schema, {
        checkHash: true,
      });
      const editor = editorForUri(docUri);
      if (editor) {
        await this.schemaIndex.decorateByEditor(editor);
      }
      await this.schemaIndex.publishDiagnostics(document);
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
    await this.commitNewRangeAndShowMessage(
      { range: commentRange, uri: editor.document.uri },
      { range: codeRange, uri: editor.document.uri }
    );
  };

  /**
   * VS Code command that shows a menu of all the comments in the current file
   * Selecting a comment from the menu will remove it from the file's schema
   */
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
      uri,
      selectedComment.comment
    );
    if (status === "removed") {
      vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
    } else {
      throw new Error(`could not remove comment link: ${status}`);
    }
  };

  /**
   * VS Code command that will set the current selection as a comment,
   * then tell the user to select the corresponding code and run the link command
   */
  linkCommentCommand = async () => {
    // First check that the selection is nonempty
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    // If the document is dirty then ask the user to save it first
    if (editor.document.isDirty) {
      throw new Error("Please save the document before linking comment");
    }
    const { selection } = editor;
    if (selection.isEmpty) {
      if (this.currentLinkContext) {
        this.currentLinkContext = null;
        throw new Error("Nothing selected, aborting link operation");
      } else {
        throw new Error("Nothing selected, please select a comment");
      }
    } else if (this.currentLinkContext) {
      // If the new selection identically matches the link, then abort
      if (
        this.currentLinkContext.commentLocation.range.isEqual(selection) &&
        this.currentLinkContext.commentLocation.uri.toString() ===
          editor.document.uri.toString()
      ) {
        this.currentLinkContext = null;
        throw new Error("Selection identical to previous selection, aborting");
      }
    }
    // If the current link context is empty then this is the first step,
    // set the link context and tell the user to select the code and run the link command again
    // the user can cancel the link operation by running the command again with nothing selected
    if (!this.currentLinkContext) {
      this.currentLinkContext = {
        commentLocation: {
          range: selection,
          uri: editor.document.uri,
        },
        commentValue: editor.document.getText(selection),
      };
      await vscode.window.showInformationMessage(
        "Comment selected, now select the corresponding code and run the link command again"
      );
    } else {
      const { commentLocation } = this.currentLinkContext;
      const codeLocation = {
        range: selection,
        uri: editor.document.uri,
      };
      this.currentLinkContext = null;
      await this.commitNewRangeAndShowMessage(commentLocation, codeLocation);
    }
  };

  /**
   * Shows a linking success info message with buttons to undo and never show again
   */
  async showLinkingSuccessMessage(
    commentDocUri: vscode.Uri,
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
      const undoResult = await this.removeCommentFromSchema(
        commentDocUri,
        comment
      );
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
