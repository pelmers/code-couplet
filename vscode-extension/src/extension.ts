import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { activate as activateLogging, errorWrapper, log } from "./logging";
import { activate as activateSchemaIndex } from "./SchemaIndex";
import { activate as activateCommands } from "./commands";
import { activate as activateCodeActions } from "./codeActions";
import { activate as activateHover } from "./hover";

export async function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  activateLogging(context);
  const schemaModel = activateSchemaIndex(context);
  activateCommands(context, schemaModel, languageConfig);

  // DONE: 2. on save, invoke validation and display diagnostics
  // 2b. display quick fix ideas:
  // DONE: - update text in file to match schema
  activateCodeActions(context);

  // DONE:
  // 3. during editing, annotate linked regions with some color or decoration
  // e.g. https://vscode.rocks/decorations/

  // DONE:
  // 4. when hovering over a linked region, show a tooltip with the counterpart
  activateHover(context, schemaModel);
}
