import { resolveCodePath } from "@lib/schema";
import * as vscode from "vscode";
import { SchemaIndex } from "./SchemaIndex";
import { schemaRangeToVscode } from "./typeConverters";

export function activate(
  context: vscode.ExtensionContext,
  schemaIndex: SchemaIndex
) {
  const provider = new DefinitionProvider(schemaIndex);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ scheme: "file" }, provider)
  );
}

class DefinitionProvider implements vscode.DefinitionProvider {
  constructor(private schemaIndex: SchemaIndex) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    // Link to the code from the comment and to the comment from the code
    const allCommentsInFile = await this.schemaIndex.getAllCommentsByFile(
      document.uri
    );
    for (const { sourceUri, comment } of allCommentsInFile) {
      if (token.isCancellationRequested) {
        return;
      }
      const commentRange = schemaRangeToVscode(comment.commentRange);
      if (
        sourceUri === document.uri.toString() &&
        commentRange.contains(position)
      ) {
        // Only provide the definition if the code is in a different file
        const codeUri = resolveCodePath(vscode.Uri.parse(sourceUri), comment);
        if (codeUri.toString() !== document.uri.toString()) {
          return {
            uri: resolveCodePath(vscode.Uri.parse(sourceUri), comment),
            range: schemaRangeToVscode(comment.codeRange),
          };
        }
      }
      const codeRange = schemaRangeToVscode(comment.codeRange);
      const codeUri = resolveCodePath(vscode.Uri.parse(sourceUri), comment);
      if (
        codeUri.toString() === document.uri.toString() &&
        codeRange.contains(position) &&
        sourceUri !== document.uri.toString()
      ) {
        return {
          uri: vscode.Uri.parse(sourceUri),
          range: schemaRangeToVscode(comment.commentRange),
        };
      }
    }
  }
}
