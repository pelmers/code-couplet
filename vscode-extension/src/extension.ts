import * as vscode from "vscode";
import { autoLinkSelectionCommand } from "./commands";
import { LanguageConfiguration } from "./languageConfiguration";
import { activate as activateLogging, errorWrapper, log } from "./logging";
import { activate as activateDecorations } from "./decorations";

export async function activate(context: vscode.ExtensionContext) {
  activateLogging(context);
  activateDecorations(context);

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
  // 1c. register command to remove a linked comment and code

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
