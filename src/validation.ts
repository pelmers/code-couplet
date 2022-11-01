import { Range, CurrentComment, CurrentFile } from "./types";

import { TextDocument } from "vscode-languageserver-textdocument";

export enum ErrorType {
  // The text under the comment range does not match
  CommentMismatch = 1,
  // Comment range matches, but the code does not match
  CodeMismatch,
  // The comment + code are somewhere else in the file
  CommentMoved,
}

export type ValidationError = {
  // The range matches what is in the schema file
  commentRange: Range;
  errorType: ErrorType;
  actual: {
    comment: string;
    code: string;
  };
  expected: {
    comment: string;
    code: string;
  };
  // Fix is only provided for moved comments
  fix?: CurrentComment;
};

/**
 * Validates a source file against a schema.
 * @param contents The contents of the file to validate
 * @param schema the pre-defined comment-code mappings
 * @returns array of validation errors,
 * note: the length may not match the number of comments in the schema (it only includes errors)
 */
export function validate(
  doc: TextDocument,
  schema: CurrentFile
): ValidationError[] {
  // TODO: remember to ignore leading whitespace
  return [];
}
