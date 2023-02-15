import { resolveCodePath } from "@lib/schema";
import * as vscode from "vscode";
import { SchemaIndex } from "./SchemaIndex";
import { schemaRangeToVscode } from "./typeConverters";

export function activate(
  context: vscode.ExtensionContext,
  schemaIndex: SchemaIndex
) {
  const provider = new HoverProvider(schemaIndex);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: "file" }, provider)
  );
}

class HoverProvider implements vscode.HoverProvider {
  constructor(private schemaIndex: SchemaIndex) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // Hovering on comment shows code, hovering on code shows comment
    const allCommentsInFile = await this.schemaIndex.getAllCommentsByFile(
      document.uri
    );
    for (const {sourceUri, comment} of allCommentsInFile) {
      if (token.isCancellationRequested) {
        return;
      }
      const commentRange = schemaRangeToVscode(comment.commentRange);
      if (sourceUri === document.uri.toString() && commentRange.contains(position)) {
        return new vscode.Hover(
          `**Code**: \`${comment.codeValue}\``,
          commentRange
        );
      }
      const codeRange = schemaRangeToVscode(comment.codeRange);
      const codeUri = resolveCodePath(vscode.Uri.parse(sourceUri), comment);
      if (codeUri.toString() === document.uri.toString() && codeRange.contains(position)) {
        return new vscode.Hover(
          `**Comment**: ${comment.commentValue}`,
          codeRange
        );
      }
    }
  }
}
