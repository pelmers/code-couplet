import * as vscode from "vscode";
import { Range as SchemaRange } from "@lib/types";
import { TextDocument as NodeTextDocument } from "vscode-languageserver-textdocument";
import { getFs } from "@lib/fsShim";

const fs = getFs();

export function pos(line: number, char: number): vscode.Position {
  return new vscode.Position(line, char);
}

export function vscodeRangeToSchema(range: vscode.Range): SchemaRange {
  return {
    start: {
      line: range.start.line,
      char: range.start.character,
    },
    end: {
      line: range.end.line,
      char: range.end.character,
    },
  };
}

export function schemaRangeToVscode(range: SchemaRange): vscode.Range {
  return new vscode.Range(
    pos(range.start.line, range.start.char),
    pos(range.end.line, range.end.char)
  );
}

export function vscodeDocumentToNode(
  doc: vscode.TextDocument
): NodeTextDocument {
  return {
    uri: doc.uri.toString(),
    languageId: doc.languageId,
    version: doc.version,
    lineCount: doc.lineCount,
    getText: (range?: vscode.Range) => {
      if (range) {
        // Really not sure why we get illegal argument exception if we don't add this wrapping
        return doc.getText(new vscode.Range(range.start, range.end));
      } else {
        return doc.getText();
      }
    },
    positionAt: (offset: number) => doc.positionAt(offset),
    offsetAt: (position: vscode.Position) => doc.offsetAt(position),
  };
}

export function nodeDocumentToVscode(
  doc: NodeTextDocument
): vscode.TextDocument {
  const uri = vscode.Uri.parse(doc.uri);
  const fileName = uri.path.split("/").pop()!;
  const lineAt: (line: number | vscode.Position) => vscode.TextLine = (
    line
  ) => {
    line = typeof line === "number" ? line : line.line;
    const text = doc.getText({
      start: { line, character: 0 },
      end: { line: line + 1, character: 0 },
    });
    return {
      lineNumber: line,
      text,
      range: new vscode.Range(pos(line, 0), pos(line, text.length)),
      rangeIncludingLineBreak: new vscode.Range(pos(line, 0), pos(line + 1, 0)),
      firstNonWhitespaceCharacterIndex: text.search(/\S/),
      isEmptyOrWhitespace: text.trim().length === 0,
    };
  };
  return {
    uri,
    fileName,
    languageId: doc.languageId,
    version: doc.version,
    lineCount: doc.lineCount,
    getText: (range: vscode.Range) => {
      return doc.getText(range);
    },
    positionAt: (offset: number) => {
      const position = doc.positionAt(offset);
      return pos(position.line, position.character);
    },
    offsetAt: (position: vscode.Position) => doc.offsetAt(position),
    isUntitled: false,
    isDirty: false,
    isClosed: false,
    eol: vscode.EndOfLine.LF,
    save: () => Promise.resolve(true),
    lineAt,
    validateRange: (range: vscode.Range) => range,
    validatePosition: (position: vscode.Position) => position,
    getWordRangeAtPosition: (position: vscode.Position, regex?: RegExp) => {
      const line = lineAt(position);
      const text = line.text;
      const start = text.substring(0, position.character).search(/\S+$/);
      const end = text.substring(position.character).search(/\s/);
      if (start === -1 || end === -1) {
        return undefined;
      }
      return new vscode.Range(
        pos(position.line, start),
        pos(position.line, start + end)
      );
    },
  };
}

export async function fileToVscodeDocument(
  uri: vscode.Uri
): Promise<vscode.TextDocument> {
  const content = (await fs.readFile(uri)).toString();
  return nodeDocumentToVscode(
    NodeTextDocument.create(uri.toString(), "plain-text", 0, content)
  );
}
