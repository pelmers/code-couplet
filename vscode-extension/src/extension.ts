import * as vscode from "vscode";
import { LanguageConfiguration } from "./languageConfiguration";
import { activate as activateLogging, errorWrapper, log } from "./logging";
import { activate as activateSchemaIndex } from "./SchemaIndex";
import { activate as activateCommands } from "./commands";
import { activate as activateCodeActions } from "./codeActions";
import { activate as activateHover } from "./hover";
import { activate as activateDefinition } from "./definition";

export async function activate(context: vscode.ExtensionContext) {
  const languageConfig = new LanguageConfiguration();

  activateLogging(context);

  const schemaModel = activateSchemaIndex(context);

  activateCommands(context, schemaModel, languageConfig);

  activateCodeActions(context, schemaModel);

  activateHover(context, schemaModel);

  activateDefinition(context, schemaModel);
}
