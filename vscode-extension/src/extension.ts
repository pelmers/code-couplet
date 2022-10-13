import { findSaveRoot, loadSchemaTest, saveSchema, stringifyTest } from "@lib/schema";
import { getErrorMessage } from "@lib/utils";
import * as vscode from "vscode";
import { autoLinkSelectionCommand } from "./commands";
import { LanguageConfiguration } from "./languageConfiguration";

/**
 * Given func, return new function with the same signature that wraps any errors func throws
 * and shows them in a vscode info box and error console.
 */
function errorWrapper<TInput extends any[], TOutput>(
  func: (...args: TInput) => TOutput
) {
  return async (...args: TInput) => {
    try {
      return await func(...args);
    } catch (e) {
      vscode.window.showErrorMessage(getErrorMessage(e));
      // TODO: log the error message
      console.error(e);
    }
  };
}

export async function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  // 1. register command to couple code + comments
  context.subscriptions.push(
    vscode.commands.registerCommand("code-couplet-vscode.linkSelection", () =>
      errorWrapper(autoLinkSelectionCommand)(languageConfig)
    )
  );
  // TODO:
  // 1b. register command to manually link comment, then manually select code

  // TODO:
  // 2. on save, invoke validation and display diagnostics (w/ quick fixes)

  // TODO:
  // 3. during editing, annotate linked regions with some color or decoration
  // e.g. https://vscode.rocks/decorations/

  // TODO:
  // what if you're editing some other part of a file and the comment moves,
  // but the relative position to the code doesn't change?
  // i think the validation part should fix itself automatically by searching the text
  // for the comment
  // note in the search: should ignore leading whitespace on each line
  // and there should be an upper limit on the file size to do this auto-fixing
}
