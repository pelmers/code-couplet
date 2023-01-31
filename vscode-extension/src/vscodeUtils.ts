import * as vscode from "vscode";
import { fileToVscodeDocument } from "./typeConverters";

export async function documentForUri(
  uri: vscode.Uri
): Promise<vscode.TextDocument> {
  // First see if vscode knows about the document
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.toString() === uri.toString()) {
      return doc;
    }
  }
  // Otherwise it's not open in the editor, export a TextDocument-compatible interface
  return fileToVscodeDocument(uri);
}

export function editorForUri(uri: vscode.Uri): vscode.TextEditor | undefined {
  if (
    vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.uri.toString() === uri.toString()
  ) {
    return vscode.window.activeTextEditor;
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === uri.toString()) {
      return editor;
    }
  }
}
