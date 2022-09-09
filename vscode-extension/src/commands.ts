import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { findSingleLineComments } from "./parser";

import {
  emptySchema,
  findSaveRoot,
  loadSchema,
  migrateToLatestFormat,
  saveSchema,
} from "@lib/schema";
import { Range as SchemaRange } from "@lib/types";

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

export async function linkSelectionCommand(config: LanguageConfiguration) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  // TODO: split the function and wrap error handling around things
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
  const lineNumbersInRange = [];
  for (let line = start.line; line < end.line; line++) {
    lineNumbersInRange.push(line);
  }
  const commentsInSelection = await findSingleLineComments(
    editor,
    config,
    range
  );
  const linesWithComments = new Set<number>();
  for (const range of commentsInSelection) {
    linesWithComments.add(range.start.line);
  }
  // For now we only consider the case where the selection is comment(s) followed by code
  // Only one of each, and they cannot be on the same line
  // TODO: in the future consider other formats such as inline comments
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
  const contentTypeByLine = new Map(
    lineNumbersInRange.map((l) => [l, getLineType(l)])
  );
  let commentRange: vscode.Range | undefined;
  let codeRange: vscode.Range | undefined;
  for (const line of lineNumbersInRange) {
    const lineType = contentTypeByLine.get(line)!;
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
  // TODO: The final task: commit the commentRange and codeRange to the map file.
  // TODO: first figure out how to import the thing LOL
  const { workspaceFolders } = vscode.workspace;
  const saveRoot = await findSaveRoot(
    editor.document.uri,
    (workspaceFolders || []).map((ws) => ws.uri)
  );
  let currentSchema = await loadSchema(saveRoot, editor.document.uri);
  if (currentSchema == null) {
    currentSchema = emptySchema();
  } else {
    currentSchema = migrateToLatestFormat(currentSchema);
  }
  const commentConfig = await config.GetCommentConfiguration(
    editor.document.languageId
  );
  currentSchema.configuration.lineComment = commentConfig?.lineComment;

  const commentValue = editor.document.getText(commentRange);
  const codeValue = editor.document.getText(codeRange);
  // TODO:
  // also: what if there is already a link on this line? I think we should overwrite it?
  currentSchema.comments.push({
    commentValue,
    commentRange: rangeToSerialize(commentRange),
    codeValue,
    codeRange: rangeToSerialize(codeRange),
  });
  await saveSchema(saveRoot, editor.document.uri, currentSchema);
}
