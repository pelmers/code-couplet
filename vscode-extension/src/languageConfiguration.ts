import { TextDecoder } from "util";
import * as path from "path";

import * as vscode from "vscode";
import * as json5 from "json5";

interface CommentConfig {
  lineComment?: string;
  blockComment?: [string, string];
}

export class LanguageConfiguration {
  // Maps language codes to comment configurations. Null if unknown.
  private readonly commentConfig = new Map<string, CommentConfig | null>();

  /**
   * Gets the configuration information for the specified language
   * @param languageCode like "rust", "python", etc. (not the file extension)
   * @returns a CommentConfig, as provided by the contributing extension
   */
  // reference: implementation ported from better-comments
  // https://github.com/aaron-bond/better-comments/blob/084a906e73a3ca96d5319441714be8e3a2a8c385/src/configuration.ts#L44
  public async GetCommentConfiguration(
    languageCode: string
  ): Promise<CommentConfig | null> {
    // Find the path to the configuration file from the extension that contributes the language
    function findExtensionContributionPath() {
      for (let extension of vscode.extensions.all) {
        let packageJSON = extension.packageJSON;

        if (packageJSON.contributes && packageJSON.contributes.languages) {
          for (const language of packageJSON.contributes.languages) {
            if (language.id === languageCode) {
              return path.join(extension.extensionPath, language.configuration);
            }
          }
        }
      }
    }

    if (this.commentConfig.has(languageCode)) {
      return this.commentConfig.get(languageCode)!;
    }

    const configPath = findExtensionContributionPath();
    if (!configPath) {
      return null;
    }

    try {
      const rawContent = await vscode.workspace.fs.readFile(
        vscode.Uri.file(configPath)
      );
      const content = new TextDecoder().decode(rawContent);

      // use json5, because the config can contains comments
      // I'm not sure why the module needs to be imported this way
      const config = (json5 as any).default.parse(content);

      this.commentConfig.set(languageCode, config.comments);

      return config.comments;
    } catch (error) {
      // TODO: Log error message to vscode output pane
      this.commentConfig.set(languageCode, null);
      return null;
    }
  }
}
