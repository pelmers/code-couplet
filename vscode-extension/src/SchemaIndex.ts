// Class which keeps track of current state of schema for all known files in the project.
// When new files are opened, load all schemas for the matching project root.
// If there is no existing schema then create a new one.

import * as vscode from "vscode";

import {
  buildSchemaPath,
  findSaveRoot,
  loadSchema,
  migrateToLatestFormat,
  resolveCodePath,
  saveSchema,
  schemaFileUriToSourceUri,
} from "@lib/schema";
import { dlog, errorWrapper as e, log } from "./logging";
import { PROJECT_NAME } from "@lib/constants";
import {
  CurrentFile,
  emptySchema,
  Range as SchemaRange,
  CurrentComment,
} from "@lib/types";
import { decorate } from "./decorations";
import { getDiagnostics } from "./diagnostics";
import {
  copySchema,
  countNewLines,
  EMPTY_SCHEMA_HASH,
  lastLineLength,
} from "./schemaTools";
import { exists, getFs } from "@lib/fsShim";

const fs = getFs();

export function activate(context: vscode.ExtensionContext) {
  const schemaIndex = new SchemaIndex();
  context.subscriptions.push(schemaIndex);
  return schemaIndex;
}

async function findRootAndSchema(uri: vscode.Uri) {
  const { workspaceFolders } = vscode.workspace;
  const saveRoot = await findSaveRoot(
    uri,
    (workspaceFolders || []).map((ws) => ws.uri)
  );
  const currentSchema = await loadSchema(saveRoot, uri);
  if (currentSchema == null) {
    return { schema: emptySchema(), saveRoot, hash: EMPTY_SCHEMA_HASH };
  } else {
    const { schema, hash } = currentSchema;
    return { schema: migrateToLatestFormat(schema), saveRoot, hash };
  }
}

// Proxies events to the correct schema root.
export class SchemaIndex {
  private disposable: vscode.Disposable;

  // Map of project root to schema root
  private schemaModels = new Map<string, SchemaModel>();

  constructor() {
    this.disposable = vscode.Disposable.from(
      // 1. on open, show decorations/diagnostics (load schema)
      vscode.window.onDidChangeActiveTextEditor(
        e(
          this.delegateToModel(
            (editor) => editor?.document.uri,
            (model) => model.onDidChangeActiveEditor
          ),
          {
            errorPrefix: "onDidChangeActiveTextEditor",
          }
        )
      ),
      // 2. on doc edit, track changes by offset (don't need to load?)
      vscode.workspace.onDidChangeTextDocument(
        e(
          this.delegateToModel(
            (event) => event.document.uri,
            (model) => model.onDidChangeTextDocument
          ),
          {
            errorPrefix: "onDidChangeTextDocument",
          }
        )
      ),
      // 4. on save, update diagnostics (load schema) and update schema (write schema)
      vscode.workspace.onDidSaveTextDocument(
        e(
          this.delegateToModel(
            (event) => event.uri,
            (model) => model.onDidSaveTextDocument
          ),
          {
            errorPrefix: "onDidSaveTextDocument",
          }
        )
      )
      // TODO: 5. what if schema file changes outside editor?
    );
  }

  // Get the schema root for the given file
  // If there is no schema root for the given file, create one
  async getSchemaRoot(uri: vscode.Uri): Promise<SchemaModel> {
    const rootUri = await findSaveRoot(uri);
    const rootPath = rootUri.fsPath;
    if (!this.schemaModels.has(rootPath)) {
      const schemaMap = await this.loadExistingSchemas(rootUri);
      this.schemaModels.set(rootPath, new SchemaModel(rootUri, schemaMap));
    }
    return this.schemaModels.get(rootPath)!;
  }

  private async loadExistingSchemas(rootUri: vscode.Uri) {
    const schemaFolderUri = buildSchemaPath(rootUri);
    const schemaMap = new Map();
    if (!(await exists(schemaFolderUri))) {
      return schemaMap;
    }
    log(`Loading existing schemas for ${rootUri.fsPath}`);
    for (const [schemaName, fileType] of await fs.readDirectory(
      schemaFolderUri
    )) {
      if (fileType === vscode.FileType.File) {
        const schemaUri = vscode.Uri.joinPath(schemaFolderUri, schemaName);
        const sourceUri = schemaFileUriToSourceUri(schemaUri);
        schemaMap.set(
          sourceUri.toString(),
          await e(loadSchema)(rootUri, sourceUri)
        );
      }
    }
    return schemaMap;
  }

  private delegateToModel<TInput>(
    uriSelector: (event: TInput) => vscode.Uri | undefined,
    methodSelector: (model: SchemaModel) => (event: TInput) => unknown
  ) {
    return async (event: TInput) => {
      const uri = uriSelector(event);
      if (!uri) {
        return () => {};
      }
      const model = await this.getSchemaRoot(uri);
      return methodSelector(model)(event);
    };
  }

  async loadSchemaByUri(uri: vscode.Uri, params: { checkHash: boolean }) {
    const model = await this.getSchemaRoot(uri);
    return model.loadSchemaByUri(uri, params);
  }

  async saveSchemaByUri(
    uri: vscode.Uri,
    schema: CurrentFile,
    params: { checkHash: boolean }
  ) {
    const model = await this.getSchemaRoot(uri);
    return (await model.saveSchemaByUri(uri, schema, params))!;
  }

  async decorateByEditor(editor: vscode.TextEditor) {
    const model = await this.getSchemaRoot(editor.document.uri);
    model.decorateByEditor(editor);
  }

  // TODO: implement all the document watching stuff
  dispose() {
    this.disposable.dispose();
  }
}

// Class which handles operations for given project root.
// Watches project roots for changes to schema files.
// Handles document opens, saves, and changes to files under this root.
class SchemaModel {
  disposable: vscode.Disposable;

  // Diagnostic collection where we set all diagnostics for all documents
  diagnosticCollection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(PROJECT_NAME);
  // Map of schema uri toString to hash of schema file contents when we last loaded it (e.g. for decorations)
  // A hash of "0" indicates it's a new file with an empty schema
  lastSeenSchemaHashes: Map<string, string> = new Map();

  // This map serializes saving and loading on each file to fix races, e.g. willSave vs. save
  ioSerializationPromises: Map<string, Promise<unknown>> = new Map();

  // This set stores the uris of files whose schemas need to be saved because they changed
  unsavedSchemaUris: Set<string> = new Set();

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

  constructor(
    private rootUri: vscode.Uri,
    private schemaMap: Map<string, CurrentFile> = new Map()
  ) {
    this.disposable = vscode.Disposable.from();
    // TODO: the file watcher would go here
  }

  // TODO: we may want to cache this since it's called on every edit
  // TODO: cache would invalidate when any range is added or removed on given file
  getSchemaRangesByFile(fileUri: string) {
    const ranges = [];
    for (const [sourceUriString, file] of this.schemaMap) {
      const sourceUri = vscode.Uri.parse(sourceUriString);
      for (const comment of file.comments) {
        if (sourceUriString === fileUri) {
          ranges.push(comment.commentRange);
        }
        if (resolveCodePath(sourceUri, comment).toString() === fileUri) {
          ranges.push(comment.codeRange);
        }
      }
    }
    return ranges;
  }

  publishDiagnostics(doc: vscode.TextDocument) {
    const diagnostics = getDiagnostics(doc, this.getSchemaByUri(doc.uri));
    if (diagnostics.length > 0) {
      log(
        `Publishing ${diagnostics.length} diagnostics for ${doc.uri.toString()}`
      );
    }
    this.diagnosticCollection.set(doc.uri, diagnostics);
  }

  /**
   * Block fn until any currently running function on uri is complete
   * BEWARE: nested calls will deadlock!
   * @param uri uri to key the block
   * @param fn called when the block is released
   * @returns whatever fn returns
   */
  guardIO<TOutput>(
    uri: vscode.Uri,
    fn: () => Promise<TOutput>
  ): Promise<TOutput> {
    const key = uri.toString();
    let existingPromise;
    if (this.ioSerializationPromises.has(key)) {
      existingPromise = this.ioSerializationPromises.get(key)!;
      dlog(`Blocking IO for ${key}`);
    } else {
      existingPromise = Promise.resolve();
    }
    const promise = existingPromise.then(fn);
    this.ioSerializationPromises.set(key, promise);
    promise.finally(() => {
      if (this.ioSerializationPromises.get(key) === promise) {
        this.ioSerializationPromises.delete(key);
        dlog(`Cleared IO block for ${key}`);
      }
    });
    return promise;
  }

  getSchemaByUri(uri: vscode.Uri) {
    if (!this.schemaMap.has(uri.toString())) {
      this.schemaMap.set(uri.toString(), emptySchema());
    }
    return this.schemaMap.get(uri.toString())!;
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
      this.unsavedSchemaUris.delete(uri.toString());
      const { saveRoot, hash: currentHash } = await findRootAndSchema(uri);
      if (params.checkHash && this.lastSeenSchemaHashes.has(uri.toString())) {
        const lastSeenHash = this.lastSeenSchemaHashes.get(uri.toString());
        if (lastSeenHash !== currentHash) {
          throw new Error(
            `schema for ${uri.toString()} changed outside editor`
          );
        }
      }
      this.schemaMap.set(uri.toString(), schema);
      const { saveUri, hash: newHash } = await saveSchema(
        saveRoot,
        uri,
        schema
      );
      this.lastSeenSchemaHashes.set(uri.toString(), newHash);
      dlog(`Saved schema to ${saveUri.toString()}`);
      return saveUri;
    },
    { rethrow: true }
  );

  updateSchemaFromPendingChanges = (
    uri: vscode.Uri,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ) => {
    let wasUpdated = false;
    // For every change in the document, update the comment/code ranges in the schema
    // similar prior art: https://github.com/Dart-Code/Dart-Code/blob/d996c73d6a455135b8e532ac266ef1f33704b0e7/src/decorations/hot_reload_coverage_decorations.ts#L72-L83
    // TODO: this is buggy, how did vs code do it?
    // search for 'acceptChanges' in IntervalTree.ts
    // it's also used for multicursor tracking and decorations for search results
    // https://github.com/microsoft/vscode/blob/3e407526a1e2ff22cacb69c7e353e81a12f41029/src/vs/editor/common/model/intervalTree.ts#L278
    for (const change of changes) {
      const cr = change.range;
      // range/rangeOffset/rangeLength = the old text that is replaced
      // text = the new text instead of that
      // otherwise how do I know which source ranges need to be updated?
      const linesAdded = countNewLines(change.text);
      const lastLineChars = lastLineLength(change.text);
      for (const sr of this.getSchemaRangesByFile(uri.toString())) {
        // If change.range is strictly before schemaRange, then shorten schema range
        if (
          cr.end.line < sr.start.line ||
          (cr.end.line === sr.start.line && cr.end.character <= sr.start.char)
        ) {
          // Move start and end line by offset of removed lines (where offset = added - removed)
          const lineOffset = linesAdded - (cr.end.line - cr.start.line);
          sr.start.line += lineOffset;
          sr.end.line += lineOffset;
          dlog(`Line offset is ${lineOffset}`);
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
            dlog(`Char offset is ${charOffset}`);
          }
          wasUpdated = true;
        } else {
          dlog("Change range overlaps schema range", cr, sr);
        }
        // TODO: what happens if the change range overlaps the schema range?
      }
    }
    dlog(`Processed ${changes.length} pending changes for ${uri.toString()}`);
    // TODO: sanity check, what if some of the new ranges are out of bounds?
    // TODO: or maybe some end < start somewhere?
    // TODO: recheck the document, for any schema ranges now incorrect, try to fix them
    // TODO: if we can't fix them, then reset to the original
    return { wasUpdated };
  };

  decorateByEditor(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (!doc.isDirty) {
      const { comments } = this.getSchemaByUri(doc.uri);
      decorate(
        editor,
        comments,
        this.commentDecorationType,
        this.codeDecorationType
      );
    }
  }

  onDidChangeTextDocument = (event: vscode.TextDocumentChangeEvent) => {
    const { uri } = event.document;
    const { wasUpdated } = this.updateSchemaFromPendingChanges(
      uri,
      event.contentChanges
    );
    if (wasUpdated) {
      this.unsavedSchemaUris.add(uri.toString());
    }
  };

  onDidSaveTextDocument = async (doc: vscode.TextDocument) => {
    this.guardIO(doc.uri, async () => {
      dlog("onDidSaveTextDocument", doc.uri.toString());
      // TODO: what happens if a plugin like prettier changes the text in their own save handler?
      // TODO: if there's no changes then just return here
      const schema = this.getSchemaByUri(doc.uri);
      if (this.unsavedSchemaUris.has(doc.uri.toString())) {
        // TODO: work harder to make sure comments with isTracked = true are consistent
        await this.saveSchemaByUri(doc.uri, schema!, { checkHash: true });
      }
      this.publishDiagnostics(doc);
      // If the current active editor is the one that we just opened then re-render decorations
      const { activeTextEditor } = vscode.window;
      if (activeTextEditor && activeTextEditor.document.uri === doc.uri) {
        this.decorateByEditor(activeTextEditor);
      }
    });
  };

  onDidOpenTextDocument = async (doc: vscode.TextDocument) => {
    dlog("onDidOpenTextDocument", doc.uri.toString());
    this.diagnosticCollection.delete(doc.uri);
    this.publishDiagnostics(doc);
    // If the current active editor is the one that we just opened then re-render decorations
    const { activeTextEditor } = vscode.window;
    if (activeTextEditor && activeTextEditor.document.uri === doc.uri) {
      this.decorateByEditor(activeTextEditor);
    }
  };

  onDidChangeActiveEditor = async (editor: vscode.TextEditor | undefined) => {
    dlog(
      "onDidChangeActiveEditor",
      editor?.document.uri.toString() || "(new editor)"
    );
    if (editor != null) {
      await e(() => this.decorateByEditor(editor), {
        errorPrefix: `error decorating ${editor.document.uri.toString()}`,
      })();
    }
  };

  dispose() {
    this.disposable.dispose();
  }
}
