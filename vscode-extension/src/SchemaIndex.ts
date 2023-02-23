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
import {
  dlog,
  errorWrapper as e,
  errorWrapperStrict as eStrict,
  log,
} from "./logging";
import { PROJECT_NAME } from "@lib/constants";
import { CurrentComment, CurrentFile, emptySchema } from "@lib/types";
import { decorate } from "./decorations";
import { getDiagnostics } from "./diagnostics";
import {
  EMPTY_SCHEMA_HASH,
  findOverlappingRanges,
  updateNonOverlappingComments,
  updateOverlappingComments,
} from "./schemaTools";
import { exists, getFs } from "@lib/fsShim";
import { fileToVscodeDocument } from "./typeConverters";
import { documentForUri } from "./vscodeUtils";

const fs = getFs();

export function activate(context: vscode.ExtensionContext) {
  const schemaIndex = new SchemaIndex();
  context.subscriptions.push(schemaIndex);
  if (vscode.window.activeTextEditor) {
    schemaIndex.decorateByEditor(vscode.window.activeTextEditor);
  }
  return schemaIndex;
}

async function loadSchemaOrEmpty(
  saveRoot: vscode.Uri,
  sourceFileUri: vscode.Uri
) {
  const currentSchema = await loadSchema(saveRoot, sourceFileUri);
  if (currentSchema == null) {
    return { schema: emptySchema(), saveRoot, hash: EMPTY_SCHEMA_HASH };
  } else {
    const { schema, hash } = currentSchema;
    return { schema, saveRoot, hash };
  }
}

// Proxies events to the correct schema root.
export class SchemaIndex {
  private disposable: vscode.Disposable;

  // Map of project root to schema root
  private schemaModels = new Map<string, Promise<SchemaModel>>();

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
      vscode.workspace.onDidOpenTextDocument(
        e(
          this.delegateToModel(
            (doc) => doc.uri,
            (model) => model.onDidOpenTextDocument
          ),
          {
            errorPrefix: "onDidOpenTextDocument",
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
      this.schemaModels.set(
        rootPath,
        new Promise(async (resolve, reject) => {
          try {
            const schemaMap = await this.loadExistingSchemas(rootUri);
            const model = new SchemaModel(rootUri, schemaMap);
            // On first load, publish all diagnostics under this root
            await model.publishAllDiagnostics();
            resolve(model);
          } catch (e) {
            reject(e);
          }
        })
      );
    }
    return this.schemaModels.get(rootPath)!;
  }

  private async loadExistingSchemas(rootUri: vscode.Uri) {
    const schemaFolderUri = buildSchemaPath(rootUri);
    const schemaMap: SchemaMap = new Map();
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
        const { schema, hash } = await eStrict(loadSchemaOrEmpty)(
          rootUri,
          sourceUri
        );
        schemaMap.set(sourceUri.toString(), {
          schema,
          hash,
          hasUnsavedChanges: false,
        });
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

  async getSchemaByUri(uri: vscode.Uri) {
    const model = await this.getSchemaRoot(uri);
    return model.getSchemaByUri(uri).schema;
  }

  async saveSchemaByUri(
    uri: vscode.Uri,
    schema: CurrentFile,
    params: { checkHash: boolean }
  ) {
    const model = await this.getSchemaRoot(uri);
    return await model.saveSchemaByUri(uri, schema, params);
  }

  async decorateByEditor(editor: vscode.TextEditor) {
    const model = await this.getSchemaRoot(editor.document.uri);
    model.decorateByEditor(editor);
  }

  async getAllCommentsByFile(uri: vscode.Uri) {
    const model = await this.getSchemaRoot(uri);
    return model.getAllCommentsByFile(uri.toString());
  }

  async publishDiagnostics(doc: vscode.TextDocument) {
    const model = await this.getSchemaRoot(doc.uri);
    await model.publishDiagnostics(doc);
  }

  // TODO: implement all the document watching stuff
  dispose() {
    this.disposable.dispose();
  }
}

// Map of source file uri to schema
type SchemaMap = Map<
  string,
  {
    schema: CurrentFile;
    hash: string;
    hasUnsavedChanges: boolean;
  }
>;

// Class which handles operations for given project root.
// Handles document opens, saves, and changes to files under this root.
// TODO: Watches project roots for changes to schema files.
class SchemaModel {
  disposable: vscode.Disposable;

  // Diagnostic collection where we set all diagnostics for all documents
  diagnosticCollection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(PROJECT_NAME);

  // This map serializes saving and loading on each file to fix races, e.g. willSave vs. save
  ioSerializationPromises: Map<string, Promise<unknown>> = new Map();

  commentDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 255, 0, 0.2)",
    // Border doesn't look great because I like to draw the range to the first char of the next line
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });
  codeDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 100, 255, 0.2)",
    // see above note on borders
    // border: "1px solid rgba(255, 255, 255, 0.5)",
  });

  constructor(
    private rootUri: vscode.Uri,
    private schemaMap: SchemaMap = new Map()
  ) {
    // Watch the rootUri for changes to schema files using the vscode workspace api
    const watchUri = buildSchemaPath(rootUri);
    const watchPattern = new vscode.RelativePattern(watchUri, "*.json");
    dlog(
      `Watching schema path: ${watchPattern.baseUri.fsPath} ${watchPattern.pattern}`
    );
    const watcher = vscode.workspace.createFileSystemWatcher(watchPattern);
    this.disposable = vscode.Disposable.from(
      watcher,
      watcher.onDidChange(this.onSchemaFileChange),
      watcher.onDidCreate(this.onSchemaFileCreate),
      watcher.onDidDelete(this.onSchemaFileDelete)
    );
  }

  // When schema file changes outside the editor, update the schema map if the hash differs
  // Check the hash because our own saves trigger the change event too
  async onSchemaFileCreateOrChange(uri: vscode.Uri, errorPrefix: string) {
    const sourceFileUri = schemaFileUriToSourceUri(uri);
    await e(this.guardIO, { errorPrefix })(uri, async () => {
      // If the schema file is created, check the hash and replace existing map if it's different
      const { schema, hash } = await loadSchemaOrEmpty(
        this.rootUri,
        sourceFileUri
      );
      const existing = this.getSchemaByUri(sourceFileUri);
      if (existing.hash !== hash) {
        dlog(
          `Replacing schema map for ${uri.toString()}, on disk hash has changed`
        );
        this.schemaMap.set(sourceFileUri.toString(), {
          schema,
          hash,
          hasUnsavedChanges: false,
        });
      } else {
        dlog(`Schema map for ${uri.toString()} is unchanged, skipping`);
      }
    });
  }

  // When schema file changes outside the editor, update the schema map
  async onSchemaFileChange(uri: vscode.Uri) {
    dlog(`onSchemaFileChange: ${uri.fsPath}`);
    await this.onSchemaFileCreateOrChange(uri, "onSchemaFileChange");
  }

  async onSchemaFileCreate(uri: vscode.Uri) {
    dlog(`onSchemaFileCreate: ${uri.fsPath}`);
    await this.onSchemaFileCreateOrChange(uri, "onSchemaFileCreate");
  }

  // When schema file changes outside the editor, update the schema map
  async onSchemaFileDelete(uri: vscode.Uri) {
    // If the schema file is deleted, remove it from the schema map
    dlog(`Schema file deleted: ${uri.fsPath}`);
    this.schemaMap.delete(schemaFileUriToSourceUri(uri).toString());
  }

  async publishAllDiagnostics() {
    await Promise.all(
      [...this.schemaMap.keys()].map(async (sourceUri) =>
        this.publishDiagnostics(
          await documentForUri(vscode.Uri.parse(sourceUri)),
          false
        )
      )
    );
  }

  getCommentReferencesByFile(fileUri: string) {
    if (!this.schemaMap.has(fileUri)) {
      return [];
    }
    return this.schemaMap.get(fileUri)!.schema.comments.map((comment) => ({
      comment,
      sourceUri: fileUri,
    }));
  }

  getCodeReferencesByFile(
    fileUri: string,
    params: { excludeSelf?: boolean } = {}
  ) {
    const comments = [];
    for (const [sourceUriString, file] of this.schemaMap) {
      if (params.excludeSelf && sourceUriString === fileUri) {
        continue;
      }
      const sourceUri = vscode.Uri.parse(sourceUriString);
      comments.push(
        ...file.schema.comments
          .filter(
            (comment) =>
              resolveCodePath(sourceUri, comment).toString() === fileUri
          )
          .map((comment) => ({
            comment,
            sourceUri: sourceUriString,
          }))
      );
    }
    return comments;
  }

  getAllCommentsByFile(fileUri: string) {
    return this.getCommentReferencesByFile(fileUri).concat(
      this.getCodeReferencesByFile(fileUri, { excludeSelf: true })
    );
  }

  getSchemaRangesByFile(fileUri: string) {
    return this.getCommentReferencesByFile(fileUri)
      .map((comment) => comment.comment.commentRange)
      .concat(
        this.getCodeReferencesByFile(fileUri).map(
          (comment) => comment.comment.codeRange
        )
      );
  }

  async publishDiagnostics(doc: vscode.TextDocument, recurse: boolean = true) {
    const diagnostics = await getDiagnostics(
      doc,
      this.getSchemaByUri(doc.uri).schema
    );
    if (diagnostics.length > 0) {
      log(
        `Publishing ${diagnostics.length} diagnostics for ${doc.uri.toString()}`
      );
    }
    this.diagnosticCollection.set(doc.uri, diagnostics);
    if (recurse) {
      // Recurse means we also want to update diagnostics for any files with originating
      // comments whose code references resolve to this one
      await Promise.all(
        [...this.schemaMap].map(async ([sourceUriString, file]) => {
          const sourceUri = vscode.Uri.parse(sourceUriString);
          const comments = file.schema.comments.filter(
            (comment) =>
              resolveCodePath(sourceUri, comment).toString() ===
              doc.uri.toString()
          );
          if (comments.length > 0) {
            const sourceDoc = await fileToVscodeDocument(sourceUri);
            await this.publishDiagnostics(sourceDoc, false);
          }
        })
      );
    }
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
      this.schemaMap.set(uri.toString(), {
        schema: emptySchema(),
        hash: EMPTY_SCHEMA_HASH,
        hasUnsavedChanges: false,
      });
    }
    return this.schemaMap.get(uri.toString())!;
  }

  saveSchemaByUri = eStrict(
    async (
      uri: vscode.Uri,
      schema: CurrentFile,
      params: { checkHash: boolean }
    ) => {
      const { saveRoot, hash: currentHash } = await loadSchemaOrEmpty(
        this.rootUri,
        uri
      );
      const lastSeenHash = this.getSchemaByUri(uri).hash;
      if (params.checkHash && lastSeenHash !== currentHash) {
        throw new Error(`schema for ${uri.toString()} changed outside editor`);
      }
      const { saveUri, hash: newHash } = await saveSchema(
        saveRoot,
        uri,
        schema
      );
      this.schemaMap.set(uri.toString(), {
        schema,
        hash: newHash,
        hasUnsavedChanges: false,
      });
      dlog(`Saved schema to ${saveUri.toString()}`);
      return saveUri;
    }
  );

  updateSchemaFromPendingChanges = (
    uri: vscode.Uri,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ) => {
    let wasUpdated = false;
    // similar logic to 'acceptChanges' in IntervalTree.ts of vscode
    // it's also used for multicursor tracking and decorations for search results
    // https://github.com/microsoft/vscode/blob/3e407526a1e2ff22cacb69c7e353e81a12f41029/src/vs/editor/common/model/intervalTree.ts#L278
    for (const change of changes) {
      const schemaComments = this.getSchemaRangesByFile(uri.toString());
      // 1. collect overlapping comments
      const schemaRangesOfInterest = findOverlappingRanges(
        change,
        schemaComments
      );
      if (schemaRangesOfInterest.length > 1) {
        dlog(`Found ${schemaRangesOfInterest.length} overlapping ranges`);
      }
      // 2. shift non-overlapping comments
      wasUpdated =
        wasUpdated ||
        updateNonOverlappingComments(change, schemaComments).wasUpdated;

      wasUpdated =
        wasUpdated ||
        updateOverlappingComments(change, schemaRangesOfInterest).wasUpdated;
    }
    return { wasUpdated };
  };

  decorateByEditor(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (!doc.isDirty) {
      const comments = this.getAllCommentsByFile(doc.uri.toString());
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
      this.getSchemaByUri(uri).hasUnsavedChanges = true;
    }
  };

  onDidSaveTextDocument = async (doc: vscode.TextDocument) => {
    this.guardIO(doc.uri, async () => {
      dlog("onDidSaveTextDocument", doc.uri.toString());
      // TODO: what happens if a plugin like prettier changes the text in their own save handler?
      const { schema, hasUnsavedChanges } = this.getSchemaByUri(doc.uri);
      if (hasUnsavedChanges) {
        await this.saveSchemaByUri(doc.uri, schema, { checkHash: true });
      }
      // If the current active editor is the one that we just opened then re-render decorations
      const { activeTextEditor } = vscode.window;
      if (activeTextEditor && activeTextEditor.document.uri === doc.uri) {
        this.decorateByEditor(activeTextEditor);
      }
      await this.publishDiagnostics(doc);
    });
  };

  onDidOpenTextDocument = async (doc: vscode.TextDocument) => {
    dlog("onDidOpenTextDocument", doc.uri.toString());
    this.diagnosticCollection.delete(doc.uri);
    // If the current active editor is the one that we just opened then re-render decorations
    const { activeTextEditor } = vscode.window;
    if (activeTextEditor && activeTextEditor.document.uri === doc.uri) {
      this.decorateByEditor(activeTextEditor);
    }
    await this.publishDiagnostics(doc);
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
