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

  activateCodeActions(context);

  activateHover(context, schemaModel);

  // TODO: similar to the hover, add a definition provider to jump to the corresponding comment/code
}
