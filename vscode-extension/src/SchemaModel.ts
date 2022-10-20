// Class which keeps track of schemas for any opened documents
// Tracks changes to schemas during editing
// Also watches them in case they change elsewhere (e.g. source control)
// Expose methods to load current schema, add new comment to schema, remove comment

import * as vscode from "vscode";

import { CurrentFile } from "@lib/types";
import {
  countNewLines,
  findRootAndSchema,
  lastLineLength,
} from "./schemaTools";
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
    model.onDidOpenTextDocument(vscode.window.activeTextEditor.document);
  }
  return model;
}

export class SchemaModel {
  disposable: vscode.Disposable;
  // Diagnostic collection where we set all diagnostics for all documents
  diagnosticCollection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(PROJECT_NAME);
  // Map of schema uri toString to hash of schema file contents when we last loaded it (e.g. for decorations)
  // A hash of "0" indicates it's a new file with an empty schema
  lastSeenSchemaHashes: Map<string, string> = new Map();
  // Unsaved changes to documents, by uri toString
  unsavedContentChanges: Map<string, vscode.TextDocumentContentChangeEvent[]> =
    new Map();

  // TODO: Question: should we colorize each pair differently? Or same color for all texts?
  commentDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 255, 0, 0.2)",
    // Border doesn't look great because I like to draw the range to the first char of the next line
    // TODO: if we want to include border then add logic to shorten range by 1 if they do that
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });
  codeDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 100, 255, 0.2)",
    // see above note on borders
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });

  constructor() {
    this.disposable = vscode.Disposable.from(
      // 1. on open, show decorations/diagnostics (load schema)
      vscode.window.onDidChangeActiveTextEditor(
        e(this.onDidChangeActiveEditor, {
          errorPrefix: "onDidChangeActiveTextEditor",
        })
      ),
      // 2. on doc edit, track changes by offset (don't need to load?)
      vscode.workspace.onDidChangeTextDocument(
        e(this.onDidChangeTextDocument, {
          errorPrefix: "onDidChangeTextDocument",
        })
      ),
      // 3. on will save, update schema from changes
      vscode.workspace.onWillSaveTextDocument(
        e(this.onWillSaveTextDocument, {
          errorPrefix: "onWillSaveTextDocument",
        })
      ),
      // 4. on save, update diagnostics (load schema) and update schema (write schema)
      vscode.workspace.onDidSaveTextDocument(
        e(this.onDidSaveTextDocument, {
          errorPrefix: "onDidSaveTextDocument",
        })
      )
      // TODO: 5. what if schema file changes outside editor?
    );
  }

  loadSchemaByUri = e(
    async (uri: vscode.Uri, params: { checkHash: boolean }) => {
      const { schema, hash } = await findRootAndSchema(uri);
      if (params.checkHash && this.lastSeenSchemaHashes.has(uri.toString())) {
        const lastSeenHash = this.lastSeenSchemaHashes.get(uri.toString());
        if (lastSeenHash !== hash) {
          throw new Error(
            `schema for ${uri.toString()} changed outside editor`
          );
        }
      }
      this.lastSeenSchemaHashes.set(uri.toString(), hash);
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
      const { saveRoot, hash: currentHash } = await findRootAndSchema(uri);
      if (params.checkHash && this.lastSeenSchemaHashes.has(uri.toString())) {
        const lastSeenHash = this.lastSeenSchemaHashes.get(uri.toString());
        if (lastSeenHash !== currentHash) {
          throw new Error(
            `schema for ${uri.toString()} changed outside editor`
          );
        }
      }
      const { saveUri, hash: newHash } = await saveSchema(
        saveRoot,
        uri,
        schema
      );
      this.lastSeenSchemaHashes.set(uri.toString(), newHash);
      log(`Saved schema to ${saveUri.toString()}`);
    },
    { rethrow: true }
  );

  updateSchemaFromPendingChanges = (
    doc: vscode.TextDocument,
    schema: CurrentFile
  ) => {
    const { uri } = doc;
    const uriString = uri.toString();
    let wasUpdated = false;
    // For every change in the document, update the comment/code ranges in the schema
    // similar prior art: https://github.com/Dart-Code/Dart-Code/blob/d996c73d6a455135b8e532ac266ef1f33704b0e7/src/decorations/hot_reload_coverage_decorations.ts#L72-L83
    if (!this.unsavedContentChanges.has(uriString)) {
      return { wasUpdated };
    }
    const changes = this.unsavedContentChanges.get(uriString)!;
    for (const change of changes) {
      const cr = change.range;
      const linesAdded = countNewLines(change.text);
      const lastLineChars = lastLineLength(change.text);
      for (const comment of schema.comments) {
        for (const sr of [comment.commentRange, comment.codeRange]) {
          // If change.range is strictly before schemaRange, then shorten schema range
          if (
            cr.end.line < sr.start.line ||
            (cr.end.line === sr.start.line && cr.end.character < sr.start.char)
          ) {
            // Move start and end line by offset of removed lines (where offset = added - removed)
            const lineOffset = linesAdded - (cr.end.line - cr.start.line);
            sr.start.line += lineOffset;
            sr.end.line += lineOffset;
            log(`Line offset is ${lineOffset}`);
            if (cr.end.line === sr.start.line) {
              // Something was removed before the start of the schema range on the same line,
              // so move the start char by the calculated offset
              const charOffset =
                lastLineChars - (cr.end.character - cr.start.character);
              sr.start.char += charOffset;
              // If the range is only on one line, then we move the end too
              if (sr.start.line === sr.end.line) {
                sr.end.char += charOffset;
              }
              log(`Char offset is ${charOffset}`);
            }
            wasUpdated = true;
          }
          // TODO: what happens if the change range overlaps the schema range?
        }
      }
    }
    log(`Processed ${changes.length} pending changes for ${uriString}`);
    this.unsavedContentChanges.delete(uriString);
    // TODO: sanity check, what if some of the new ranges are out of bounds?
    // TODO: or maybe some end < start somewhere?
    // TODO: perhaps reset them to the original values (then how do i check identity? add an id field?)
    return { wasUpdated };
  };

  decorateByEditor(
    editor: vscode.TextEditor,
    comments: CurrentFile["comments"]
  ) {
    decorate(
      editor,
      comments,
      this.commentDecorationType,
      this.codeDecorationType
    );
  }

  onDidChangeTextDocument = (event: vscode.TextDocumentChangeEvent) => {
    const { uri } = event.document;
    const uriString = uri.toString();
    if (this.unsavedContentChanges.has(uriString)) {
      this.unsavedContentChanges.get(uriString)!.push(...event.contentChanges);
    } else {
      this.unsavedContentChanges.set(uriString, event.contentChanges.slice());
    }
  };

  onWillSaveTextDocument = async (event: vscode.TextDocumentWillSaveEvent) => {
    log("onWillSaveTextDocument", event.document.uri.toString());
    // TODO: what happens if a plugin like prettier changes the text in their own save handler?
    const doc = event.document;
    // TODO: if there's no changes then just return here
    const schema = await this.loadSchemaByUri(doc.uri, { checkHash: true });
    const { wasUpdated } = this.updateSchemaFromPendingChanges(doc, schema!);

    // If we saved even without updating then we would dump a lot of empty schemas in the save root
    if (wasUpdated) {
      await this.saveSchemaByUri(doc.uri, schema!, { checkHash: true });
    }
  };

  onDidSaveTextDocument = async (doc: vscode.TextDocument) => {
    log("onDidSaveTextDocument", doc.uri.toString());
    // When we have saved a document, reload the schema (as we do on open)
    await this.onDidOpenTextDocument(doc);
  };

  onDidOpenTextDocument = async (doc: vscode.TextDocument) => {
    log("onDidOpenTextDocument", doc.uri.toString());
    this.diagnosticCollection.delete(doc.uri);
    const schema = await this.loadSchemaByUri(doc.uri, { checkHash: true });
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
    if (diagnostics.length > 0) {
      log(
        `Publishing ${diagnostics.length} diagnostics for ${doc.uri.toString()}`
      );
    }
    this.diagnosticCollection.set(doc.uri, diagnostics);
    // If the current active editor is the one that we just opened then re-render decorations
    const { activeTextEditor } = vscode.window;
    if (activeTextEditor && activeTextEditor.document.uri === doc.uri) {
      this.decorateByEditor(activeTextEditor, schema!.comments);
    }
  };

  onDidChangeActiveEditor = async (editor: vscode.TextEditor | undefined) => {
    log(
      "onDidChangeActiveEditor",
      editor?.document.uri.toString() || "(new editor)"
    );
    if (editor != null) {
      await e(
        async () => {
          const schema = await this.loadSchemaByUri(editor.document.uri, {
            checkHash: true,
          });
          this.decorateByEditor(editor, schema!.comments);
        },
        { errorPrefix: `error decorating ${editor.document.uri.toString()}` }
      )();
    }
  };

  dispose() {
    this.disposable.dispose();
  }
}
