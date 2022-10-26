import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { activate as activateLogging, errorWrapper, log } from "./logging";
import { activate as activateSchemaModel } from "./SchemaModel";
import { activate as activateCommands } from "./commands";

export async function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  activateLogging(context);
  const schemaModel = activateSchemaModel(context);
  activateCommands(context, schemaModel, languageConfig);

  // TODO:
  // 2. on save, invoke validation and display diagnostics (w/ quick fixes)
  // 2b. quick fix ideas:
  // - update range of code / comment
  // - remove comment
  // - jump to manually edit schema file

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
