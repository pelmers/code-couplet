import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./parser";

import { PROJECT_NAME } from "@lib/constants";
import {
  findSaveRoot,
  loadSchema,
  migrateToLatestFormat,
  saveSchema,
} from "@lib/schema";
import { emptySchema, Range as SchemaRange } from "@lib/types";
import { getErrorMessage } from "@lib/utils";

function pos(line: number, char: number): vscode.Position {
  return new vscode.Position(line, char);
}

function rangeToSerialize(range: vscode.Range): SchemaRange {
  return {
    start: {
      line: range.start.line,
      char: range.start.character,
    },
    end: {
      line: range.end.line,
      char: range.end.character,
    },
  };
}

function schemaRangeToVscode(range: SchemaRange): vscode.Range {
  return new vscode.Range(
    pos(range.start.line, range.start.char),
    pos(range.end.line, range.end.char)
  );
}

async function findRootAndSchema(editor: vscode.TextEditor) {
  const { workspaceFolders } = vscode.workspace;
  const saveRoot = await findSaveRoot(
    editor.document.uri,
    (workspaceFolders || []).map((ws) => ws.uri)
  );
  const currentSchema = await loadSchema(saveRoot, editor.document.uri);
  if (currentSchema == null) {
    return { schema: emptySchema(), saveRoot };
  } else {
    return { schema: migrateToLatestFormat(currentSchema), saveRoot };
  }
}

/**
 * Commit the linked sections to the map file by loading the existing one and then saving it
 */
async function commitNewRangeToMap(
  editor: vscode.TextEditor,
  config: LanguageConfiguration,
  commentRange: vscode.Range,
  codeRange: vscode.Range
): Promise<{ status: "added" | "updated"; saveRoot: vscode.Uri }> {
  // remark: technically there's a race condition if two of these commands run at once on the same source file
  // TODO: fix that race condition haha
  const { schema, saveRoot } = await findRootAndSchema(editor);
  const commentConfig = await config.GetCommentConfiguration(
    editor.document.languageId
  );
  const lineComment = commentConfig?.lineComment;
  schema.configuration.lineComment = lineComment || null;

  const commentValue = editor.document.getText(commentRange);
  const codeValue = editor.document.getText(codeRange);

  // TODO: what if there is already a link on this line? I think we should overwrite it?
  schema.comments.push({
    commentValue,
    commentRange: rangeToSerialize(commentRange),
    codeValue,
    codeRange: rangeToSerialize(codeRange),
  });
  await saveSchema(saveRoot, editor.document.uri, schema);
  return { saveRoot, status: "added" };
}

/**
 * Remove the linked sections from the map file by loading the existing one and then saving it
 */
async function removeRangeFromMap(
  editor: vscode.TextEditor,
  commentRange: vscode.Range,
  codeRange: vscode.Range
): Promise<{ status: "removed" | "not found"; saveRoot: vscode.Uri }> {
  const { schema, saveRoot } = await findRootAndSchema(editor);
  // Find the codeRange and commentRange in the existing comments, and remove them
  for (const comment of schema.comments) {
    const existingCommentRange = schemaRangeToVscode(comment.commentRange);
    const existingCodeRange = schemaRangeToVscode(comment.codeRange);
    if (
      commentRange.isEqual(existingCommentRange) &&
      codeRange.isEqual(existingCodeRange)
    ) {
      schema.comments.splice(schema.comments.indexOf(comment), 1);
      await saveSchema(saveRoot, editor.document.uri, schema);
      return { saveRoot, status: "removed" };
    }
  }
  return { saveRoot, status: "not found" };
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

  const showSuccessMessage = vscode.workspace
    .getConfiguration(PROJECT_NAME)
    .get<boolean>("showLinkingSuccessMessage");

  if (result && showSuccessMessage) {
    const undo = "Undo";
    const neverAgain = "Don't show again";
    const choice = await vscode.window.showInformationMessage(
      "Linked comment with code",
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
      // TODO: add the config to the extension package json
      await vscode.workspace
        .getConfiguration(PROJECT_NAME)
        .update("showLinkingSuccessMessage", false);
    }
  }
}
