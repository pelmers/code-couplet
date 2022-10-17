import { CurrentFile } from "@lib/types";
import * as vscode from "vscode";
import { log } from "./logging";
import { findRootAndSchema } from "./schemaTools";
import { schemaRangeToVscode } from "./typeConverters";

const DECORATION_MAX_LINES = 10000;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(new DecorationModel());
}

// TODO: as i write this i'm thinking maybe it should be an LSP instead???
// that's kind of the whole point of lsp right?
// and also that was my whole job for years lol...
// memories, which ones did i make? thrift, cquery, test runner
// anyway, won't that be a problem if i want to distribute extension as one file via webpack?
// TODO: figure out if that's a problem!
// example: https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-web-extension-sample

class DecorationModel {
  disposable: vscode.Disposable;
  activeEditor: vscode.TextEditor | undefined;
  // Maps document uri path to a list of change events since it was dirty
  dirtyDocumentChangeEvents: Map<string, vscode.TextDocumentChangeEvent[]> = new Map();
  // Maps opened document uri to its current schema
  openedDocumentSchemas: Map<string, Promise<CurrentFile>> = new Map();

  constructor() {
    this.activeEditor = vscode.window.activeTextEditor;
    this.disposable = vscode.Disposable.from(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.activeEditor = editor;
        if (editor != null) {
          this.decorate(editor);
        }
      }),
      vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument),
      vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument),
      vscode.workspace.onWillSaveTextDocument(this.onWillSaveTextDocument),
      vscode.workspace.onDidSaveTextDocument(this.onDidSaveTextDocument),
      // TODO: don't forget to remove from change events mapping
    );
    if (this.activeEditor != null) {
      this.decorate(this.activeEditor);
    }
  }

  onWillSaveTextDocument = async (event: vscode.TextDocumentWillSaveEvent) => {
    const doc = event.document;
      // TODO: on save, apply dirty changes to update decorations and save schema
      const pendingSchema = this.openedDocumentSchemas.get(doc.uri.path);
      if (!pendingSchema) {
        return;
      }
      const schema = await pendingSchema;
      let hasUpdated = false;
      // TODO: update the schema based on the changes
      // each content change has range, rangeOffset, rangeLength, text (new text)
      // then for each change, for each decoration that occurs entirely after,
      // move it either up or down based on range vs. rangeOffset + rangeLength
      // if range is bigger, then it moves down. otherwise it moves up.

      // If we saved even without updating then we would 
      if (hasUpdated) {
        // TODO: save the new schema
      }
  };

  async loadSchemaByUri(uri: vscode.Uri) {
    const {schema} = await findRootAndSchema(uri);
    return schema;
  }

  onDidOpenTextDocument = (doc: vscode.TextDocument) => {
    this.openedDocumentSchemas.set(doc.uri.path, this.loadSchemaByUri(doc.uri));
    // TODO: vscode already does some kind of decoration tracking on edit,
    // can I re-use it to auto-update ranges?
    // issue: https://github.com/microsoft/vscode/issues/54147
    this.dirtyDocumentChangeEvents.set(doc.uri.path, []);
  }

  onDidSaveTextDocument = (doc: vscode.TextDocument) => {
    // When we have saved a document, reload the schema (as we do on open)
    this.onDidOpenTextDocument(doc);
  }

  /**
   * Decorate a document with comment and code linked ranges by reading the schema
   * Only applies when the document is not dirty (call after saving or on open)
   */
  async decorate(editor: vscode.TextEditor) {
    const {path} = editor.document.uri;
    if (editor.document.lineCount > DECORATION_MAX_LINES) {
      log(
        `Skipped decoration of ${editor.document.uri.fsPath} because it has more than ${DECORATION_MAX_LINES} lines`
      );
      return;
    }
    if (editor.document.isDirty) {
      log(
        `Skipped decoration of ${editor.document.uri.fsPath} because it is dirty`
      );
      return;
    }
    if (!this.openedDocumentSchemas.has(path)) {
      return;
    }
    const schema = await this.openedDocumentSchemas.get(path)!;

    // TODO: Question: should we colorize each pair differently? Or same color for all texts?
    const commentDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(0, 255, 0, 0.2)",
      // Border doesn't look great because I like to draw the range to the first char of the next line
      // TODO: if we want to include border then add logic to shorten range by 1 if they do that
      // border: "1px solid rgba(255, 255, 255, 0.5)",
    });
    const codeDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(0, 100, 255, 0.2)",
      // see above note on borders
      // border: "1px solid rgba(255, 255, 255, 0.5)",
    });
    const commentRanges = [];
    const codeRanges = [];
    for (const comment of schema.comments) {
      // If the comment and code values match the document, then we can decorate them
      // otherwise we will show a diagnostic to the user
      const commentRange = schemaRangeToVscode(comment.commentRange);
      const codeRange = schemaRangeToVscode(comment.codeRange);
      if (
        comment.commentValue === editor.document.getText(commentRange) &&
        comment.codeValue === editor.document.getText(codeRange)
      ) {
        commentRanges.push(commentRange);
        codeRanges.push(codeRange);
      }
    }
    editor.setDecorations(commentDecorationType, commentRanges);
    editor.setDecorations(codeDecorationType, codeRanges);

    log(
      `Applied ${commentRanges.length} decorations to ${editor.document.uri.fsPath}`
    );
  }

  onDidChangeTextDocument = (event: vscode.TextDocumentChangeEvent) => {
    if (event.document.isDirty) {
      const key = event.document.uri.path;
      if (this.dirtyDocumentChangeEvents.has(key)) {
        this.dirtyDocumentChangeEvents.get(key)?.push(event);
      }
    }
  }

  dispose() {
    this.disposable.dispose();
  }
}
