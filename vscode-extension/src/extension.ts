import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { activate as activateLogging, errorWrapper, log } from "./logging";
import { activate as activateSchemaIndex } from "./SchemaIndex";
import { activate as activateCommands } from "./commands";

export async function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  activateLogging(context);
  const schemaModel = activateSchemaIndex(context);
  activateCommands(context, schemaModel, languageConfig);

  // DONE: 2. on save, invoke validation and display diagnostics
  // TODO:
  // 2b. display quick fix ideas:
  // - update range of code / comment
  // - remove comment
  // - jump to manually edit schema file

  // DONE:
  // 3. during editing, annotate linked regions with some color or decoration
  // e.g. https://vscode.rocks/decorations/

  // TODO:
  // 4. when hovering over a linked region, show a tooltip with the counterpart

  // TODO:
  // what if you're editing some other part of a file and the comment moves,
  // but the relative position to the code doesn't change?
  // i think the validation part should fix itself automatically by searching the text
  // for the comment
  // note in the search: should ignore leading whitespace on each line
  // and there should be an upper limit on the file size to do this auto-fixing
}
