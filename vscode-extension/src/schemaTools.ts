import { findSaveRoot, loadSchema, migrateToLatestFormat } from "@lib/schema";
import {
  CurrentComment,
  CurrentFile,
  emptySchema,
  Range as SchemaRange,
  Position as SchemaPosition,
} from "@lib/types";
import { pos, schemaRangeToVscode } from "./typeConverters";

import * as vscode from "vscode";

export const EMPTY_SCHEMA_HASH = "0";

export function findIndexOfMatchingRanges(
  schema: CurrentFile,
  codeRange: vscode.Range,
  commentRange: vscode.Range
): number {
  return schema.comments.findIndex((comment) => {
    const existingCommentRange = schemaRangeToVscode(comment.commentRange);
    const existingCodeRange = schemaRangeToVscode(comment.codeRange);
    return (
      existingCommentRange.isEqual(commentRange) &&
      existingCodeRange.isEqual(codeRange)
    );
  });
}

export function countNewLines(text: string): number {
  let pos = text.indexOf("\n");
  let count = 0;
  while (pos >= 0) {
    count++;
    pos = text.indexOf("\n", pos + 1);
  }
  return count;
}

export function lastLineLength(text: string): number {
  const lastLineIndex = text.lastIndexOf("\n");
  if (lastLineIndex === -1) {
    return text.length;
  }
  return text.length - lastLineIndex - 1;
}

export function copySchema(schema: CurrentFile): CurrentFile {
  // TODO: obviously this could be made more efficient
  return JSON.parse(JSON.stringify(schema));
}

/**
 * Return a unique id for the given schema by taking its current max and adding one
 */
export function nextId(schema: CurrentFile): number {
  let currentMax = -1;
  for (const comment of schema.comments) {
    currentMax = Math.max(currentMax, comment.id);
  }
  return currentMax + 1;
}

function withChangeDelta(
  schemaRange: SchemaRange,
  lineDelta: number,
  charDelta: number
) {
  return schemaRange;
  // TODO: vscode does this next part, but why? seems wrong in this case
  return {
    start: {
      line: schemaRange.start.line + lineDelta,
      char: schemaRange.start.char + charDelta,
    },
    end: {
      line: schemaRange.end.line + lineDelta,
      char: schemaRange.end.char + charDelta,
    },
  };
}

/**
 * Update schemaRanges in place such that all ranges occurring after the change event
 * are shifted by the amount that was changed.
 */
export function updateNonOverlappingComments(
  change: vscode.TextDocumentContentChangeEvent,
  schemaRanges: SchemaRange[]
) {
  let wasUpdated = false;
  // A port of noOverlapReplace from vscode's intervalTree.ts
  // Of course I'm not using a tree here, it is only a flat list
  const cr = change.range;
  const newLines = countNewLines(change.text);
  // Remark: this would be a bit easier with offsets
  // lineDelta = how much to shift all ranges that start AFTER the changed line
  const lineDelta = newLines - (cr.end.line - cr.start.line);
  let originalChars = cr.end.character;
  if (cr.end.line === cr.start.line) {
    originalChars -= cr.start.character;
  }
  // charDelta = how much to shift all ranges ON the changed line (but AFTER the change)
  const charDelta = lastLineLength(change.text) - originalChars;
  for (const sr of schemaRanges) {
    // TODO: all the comparisons should be done with the delta applied???
    if (sr.start.line > cr.end.line) {
      sr.start.line += lineDelta;
      sr.end.line += lineDelta;
      wasUpdated = true;
    } else if (
      sr.start.line === cr.end.line &&
      // TODO: should be > or >= ?
      sr.start.char > cr.end.character
    ) {
      sr.start.line += lineDelta;
      sr.end.line += lineDelta;
      sr.start.char += charDelta;
      if (sr.end.line === sr.start.line) {
        sr.end.char += charDelta;
      }
    }
    wasUpdated = true;
  }
  return { wasUpdated };
}

/**
 * Return a list of all range that overlap with the changed range
 */
export function findOverlappingRanges(
  change: vscode.TextDocumentContentChangeEvent,
  schemaRanges: SchemaRange[]
) {
  const cr = change.range;
  return schemaRanges.filter((sr) => {
    const srStart = pos(sr.start.line, sr.start.char);
    const srEnd = pos(sr.end.line, sr.end.char);
    // a) schema start <= cr start end schema end >= cr start
    const startOverlaps =
      srStart.isBeforeOrEqual(cr.start) && srEnd.isAfterOrEqual(cr.start);
    // b) schema start <= cr end and schema end >= cr end
    const endOverlaps =
      srStart.isBeforeOrEqual(cr.end) && srEnd.isAfterOrEqual(cr.end);
    return startOverlaps || endOverlaps;
  });
}
