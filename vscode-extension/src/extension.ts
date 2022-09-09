import * as vscode from "vscode";
import { linkSelectionCommand } from "./commands";
import { LanguageConfiguration } from "./languageConfiguration";

export function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  // TODO:
  // 1. register command to couple code + comments
  context.subscriptions.push(
    vscode.commands.registerCommand("code-couplet-vscode.linkSelection", () =>
      linkSelectionCommand(languageConfig)
    )
  );
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
}
