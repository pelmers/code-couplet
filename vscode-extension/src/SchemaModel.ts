// Class which keeps track of schemas for any opened documents
// Tracks changes to schemas during editing
// Also watches them in case they change elsewhere (e.g. source control)
// Expose methods to load current schema, add new comment to schema, remove comment

import * as vscode from "vscode";

import { CurrentFile } from "@lib/types";
import { findRootAndSchema } from "./schemaTools";
import { decorate } from "./decorations";
import { PROJECT_NAME } from "@lib/constants";
import { schemaRangeToVscode } from "./typeConverters";
import { errorWrapper as e, log } from "./logging";
import { saveSchema } from "@lib/schema";

// TODO: as i write this i'm thinking maybe it should be an LSP instead???
// that's kind of the whole point of lsp right?
// and also that was my whole job for years lol...
// memories, which ones did i make? thrift, cquery, test runner
// anyway, won't that be a problem if i want to distribute extension as one file via webpack?
// TODO: figure out if that's a problem!
// example: https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-web-extension-sample
// the biggest issue: LanguageConfiguration, how are comments for a language set?
// conclusion: i will defer this choice, for now keep the non-vscode dependent code factored out so it's possible in the future

// concurrency issues, read vs. write of schema model
// 1. on open, show decorations/diagnostics (load schema)
// 2. on doc edit, track changes by offset (don't need to load?)
// 3. on new comment, add to schema (write schema) and show its decoration (load schema)
// 4. on save, update diagnostics (load schema) and update schema (write schema)
// 5. what if schema file changes outside editor?
// before any write i think we need to materialize pending changes by offset
// the issue is, what if the schema chanaged outside the editor?
// idea: store a hash of the schema file, and if it is different, then reload it and clear pending changes

export function activate(context: vscode.ExtensionContext) {
  const model = new SchemaModel();
  context.subscriptions.push(model);
  if (vscode.window.activeTextEditor != null) {
    model.onDidChangeActiveEditor(vscode.window.activeTextEditor);
  }
}

export class SchemaModel {
  disposable: vscode.Disposable;
  // Diagnostic collection where we set all diagnostics for all documents
  diagnosticCollection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(PROJECT_NAME);
  // Map of schema uri path to hash of schema file contents when we last loaded it (e.g. for decorations)
  // A hash of "0" indicates it's a new file with an empty schema
  lastSeenSchemaHashes: Map<string, string> = new Map();

  constructor() {
    this.disposable = vscode.Disposable.from();
  }

  loadSchemaByUri = e(
    async (uri: vscode.Uri, params: { checkHash: boolean }) => {
      const { schema, hash } = await findRootAndSchema(uri);
      if (params.checkHash && this.lastSeenSchemaHashes.has(uri.path)) {
        const lastSeenHash = this.lastSeenSchemaHashes.get(uri.path);
        if (lastSeenHash !== hash) {
          throw new Error(`schema for ${uri.path} changed outside editor`);
        }
      }
      this.lastSeenSchemaHashes.set(uri.path, hash);
      return schema;
    },
    { rethrow: true }
  );

  saveSchemaByUri = e(
    async (
      uri: vscode.Uri,
      schema: CurrentFile,
      params: { checkHash: boolean }
    ) => {
      const { saveRoot, hash } = await findRootAndSchema(uri);
      if (params.checkHash && this.lastSeenSchemaHashes.has(uri.path)) {
        const lastSeenHash = this.lastSeenSchemaHashes.get(uri.path);
        if (lastSeenHash !== hash) {
          throw new Error(`schema for ${uri.path} changed outside editor`);
        }
      }
      await saveSchema(saveRoot, uri, schema);
    },
    { rethrow: true }
  );

  updateSchemaFromPendingChanges = (uri: vscode.Uri, schema: CurrentFile) => {
    // TODO: update the schema based on the changes
    // each content change has range, rangeOffset, rangeLength, text (new text)
    // then for each change, for each decoration that occurs entirely after,
    // move it either up or down based on range vs. rangeOffset + rangeLength
    // if range is bigger, then it moves down. otherwise it moves up.
    throw new Error("TODO");
    return {wasUpdated: false};
  };

  onDidChangeTextDocument = (event: vscode.TextDocumentChangeEvent) => {
    // TODO: track change events
    throw new Error("TODO");
  };

  onWillSaveTextDocument = async (event: vscode.TextDocumentWillSaveEvent) => {
    const doc = event.document;
    // TODO: if there's no changes then just return here
    const schema = await this.loadSchemaByUri(doc.uri, { checkHash: true });
    const {wasUpdated} = this.updateSchemaFromPendingChanges(doc.uri, schema!);

    // If we saved even without updating then we would dump a lot of empty schemas in the save root
    if (wasUpdated) {
        await this.saveSchemaByUri(doc.uri, schema!, { checkHash: true });
    }
  };

  onDidSaveTextDocument = async (event: vscode.TextDocumentWillSaveEvent) => {
    // When we have saved a document, reload the schema (as we do on open)
    await this.onDidOpenTextDocument(event.document);
  };

  onDidOpenTextDocument = async (doc: vscode.TextDocument) => {
    this.diagnosticCollection.delete(doc.uri);
    const schema = await this.loadSchemaByUri(doc.uri, { checkHash: false });
    // Publish diagnostics to the doc based on any mismatched comments from the schema
    const diagnostics: vscode.Diagnostic[] = [];
    for (const comment of schema!.comments) {
      const commentRange = schemaRangeToVscode(comment.commentRange);
      const codeRange = schemaRangeToVscode(comment.codeRange);
      const commentText = doc.getText(commentRange);
      const codeText = doc.getText(codeRange);
      if (commentText !== comment.commentValue) {
        diagnostics.push({
          range: commentRange,
          message: `Comment text does not match schema. Expected: "${comment.commentValue}", got: "${commentText}"`,
          severity: vscode.DiagnosticSeverity.Warning,
          source: PROJECT_NAME,
        });
      } else if (codeText !== comment.codeValue) {
        diagnostics.push({
          range: codeRange,
          message: `Code text does not match schema. Expected: "${comment.codeValue}", got: "${codeText}"`,
          severity: vscode.DiagnosticSeverity.Warning,
          source: PROJECT_NAME,
        });
      }
    }
    this.diagnosticCollection.set(doc.uri, diagnostics);
  };

  onDidChangeActiveEditor = async (editor: vscode.TextEditor | undefined) => {
    if (editor != null) {
      await e(
        async () => {
          const schema = await this.loadSchemaByUri(editor.document.uri, {
            checkHash: true,
          });
          decorate(editor, schema!.comments);
        },
        { errorPrefix: `error decorating ${editor.document.uri.path}` }
      )();
    }
  };

  dispose() {
    this.disposable.dispose();
  }
}
