import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";

/**
 * Escapes a given string for use in a regular expression
 * @param input The input string to be escaped
 * @returns {string} The escaped string
 */
// source: https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

/**
 * Find single line comments from a vscode active editor
 * If range is not provided, the entire document is searched
 * @returns ranges for each comment found
 */
export async function findSingleLineComments(
  editor: vscode.TextEditor,
  config: LanguageConfiguration,
  range?: vscode.Range
): Promise<vscode.Range[]> {
  const commentConfig = await config.GetCommentConfiguration(
    editor.document.languageId
  );
  if (commentConfig == null || !commentConfig.lineComment) {
    return [];
  }
  const { lineComment } = commentConfig;
  // remember to also escape forward slashes
  const expression = escapeRegExp(lineComment).replace(/\//gi, "\\/");
  // make a regex from expression, "g" required to match all lines
  // add the .$ to match the end of the line
  const regex = new RegExp(expression + ".*$", "igm");
  // apply regex across the content of the editor in the given range
  // note that undefined range = entire document
  const content = editor.document.getText(range);
  const matches = [];
  const offset = range ? editor.document.offsetAt(range.start) : 0;
  let match;
  while ((match = regex.exec(content))) {
    let startPos = editor.document.positionAt(offset + match.index);
    let endPos = editor.document.positionAt(
      offset + match.index + match[0].length
    );
    matches.push(new vscode.Range(startPos, endPos));
  }
  return matches;
}
