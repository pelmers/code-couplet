import * as vscode from "vscode";
import { Range as SchemaRange } from "@lib/types";
import { TextDocument as NodeTextDocument } from "vscode-languageserver-textdocument";

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
        return doc.getText(range);
      } else {
        return doc.getText();
      }
    },
    positionAt: (offset: number) => doc.positionAt(offset),
    offsetAt: (position: vscode.Position) => doc.offsetAt(position),
  };
}
