import * as vscode from "vscode";
import { Range as SchemaRange } from "@lib/types";

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
