import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./commentParser";

import { PROJECT_NAME } from "@lib/constants";
import { saveSchema } from "@lib/schema";
import { getErrorMessage } from "@lib/utils";
import { vscodeRangeToSchema, pos } from "./typeConverters";
import { findRootAndSchema, findIndexOfMatchingRanges } from "./schemaTools";
import { log } from "./logging";
import { SchemaModel } from "./SchemaModel";

export function activate(
  context: vscode.ExtensionContext,
  schemaModel: SchemaModel
) {}

/**
 * Commit the linked sections to the map file by loading the existing one and then saving it
 */
async function commitNewRangeToMap(
  editor: vscode.TextEditor,
  config: LanguageConfiguration,
  commentRange: vscode.Range,
  codeRange: vscode.Range
): Promise<{ status: "added" | "updated"; saveRoot: vscode.Uri }> {
  // TODO: move this schema loading to the schema model
  const { schema, saveRoot } = await findRootAndSchema(editor.document.uri);
  const commentConfig = await config.GetCommentConfiguration(
    editor.document.languageId
  );
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
    await saveSchema(saveRoot, editor.document.uri, schema);
    return { saveRoot, status: "added" };
  } else {
    schema.comments[existingIndex].commentValue = commentValue;
    schema.comments[existingIndex].codeValue = codeValue;
    await saveSchema(saveRoot, editor.document.uri, schema);
    return { saveRoot, status: "updated" };
  }
}

/**
 * Remove the linked sections from the map file by loading the existing one and then saving it
 */
async function removeRangeFromMap(
  editor: vscode.TextEditor,
  commentRange: vscode.Range,
  codeRange: vscode.Range
): Promise<{ status: "removed" | "not found"; saveRoot: vscode.Uri }> {
  const { schema, saveRoot } = await findRootAndSchema(editor.document.uri);
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
    await saveSchema(saveRoot, editor.document.uri, schema);
    return { saveRoot, status: "removed" };
  }
}

class Commands {
  constructor(private schemaModel: SchemaModel) {}
}

/**
 * VS Code command that expects a selection in the active editor that contains a comment followed by code
 * if we find that selection, then link the comment with the code and save to the schema
 */
export async function autoLinkSelectionCommand(config: LanguageConfiguration) {
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
  const commentsInSelection = await findSingleLineComments(editor, config, {
    range,
    throwOnEmpty: true,
  });
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
        commentRange = commentRange.with(commentRange.start, pos(line + 1, 0));
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
    result = await commitNewRangeToMap(editor, config, commentRange, codeRange);
  } catch (e) {
    throw new Error(`could not save comment link: ${getErrorMessage(e)}`);
  }

  if (result) {
    const showSuccessMessage = vscode.workspace
      .getConfiguration(PROJECT_NAME)
      .get<boolean>("showLinkingSuccessMessage");

    // Trigger our onDidSaveHandler to update decorations
    await editor.document.save();
    log(
      `Document ${editor.document.uri.fsPath} saved after applying decorations`
    );

    if (showSuccessMessage) {
      await showLinkingSuccessMessage(editor, commentRange, codeRange, result);
    } else {
      // Show a status bar message instead
      const { status } = result;
      vscode.window.setStatusBarMessage(`Comment link: ${status}`, 4000);
    }
  }
}

/**
 * Shows a linking success info message with buttons to undo and never show again
 */
async function showLinkingSuccessMessage(
  editor: vscode.TextEditor,
  commentRange: vscode.Range,
  codeRange: vscode.Range,
  result: { status: "added" | "updated"; saveRoot: vscode.Uri }
) {
  const undo = "Undo";
  const neverAgain = "Don't show again";
  const choice = await vscode.window.showInformationMessage(
    `Comment link: ${result.status}`,
    { detail: `Location: ${result.saveRoot.fsPath}` },
    undo,
    neverAgain
  );
  if (choice === undo) {
    const result = await removeRangeFromMap(editor, commentRange, codeRange);
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
