import { Range as SchemaRange, CurrentComment, CurrentFile } from "./types";

import { URI } from "vscode-uri";
import {
  TextDocument,
  Range as VscodeRange,
} from "vscode-languageserver-textdocument";
import { resolveCodePath } from "./schema";
import { getFs } from "./fsShim";

const fs = getFs();

export enum ErrorType {
  // The text under the comment range does not match
  CommentMismatch = 1,
  // Comment range matches, but the code does not match
  CodeMismatch,
  // Both the comment and code ranges do not match
  BothMismatch,
}

type ValidationLocation = {
  uriString: string;
  range: SchemaRange;
};

export type ValidationError = {
  commentId: number;
  commentUriString: string;
  // The range matches what is in the schema file
  commentRange: SchemaRange;
  codeLocation: ValidationLocation;
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
  moveFix?: CurrentComment;
};

function convertRangeToVS(schemaRange: SchemaRange): VscodeRange {
  return {
    start: {
      line: schemaRange.start.line,
      character: schemaRange.start.char,
    },
    end: { line: schemaRange.end.line, character: schemaRange.end.char },
  };
}

function convertRangeToSchema(vscodeRange: VscodeRange): SchemaRange {
  return {
    start: {
      line: vscodeRange.start.line,
      char: vscodeRange.start.character,
    },
    end: { line: vscodeRange.end.line, char: vscodeRange.end.character },
  };
}

/**
 * Validates a source file against a schema.
 * @param contents The contents of the file to validate
 * @param schema the pre-defined comment-code mappings for this doc
 * @returns array of validation errors,
 * note: the length may not match the number of comments in the schema (it only includes errors)
 */
export async function validate(
  doc: TextDocument,
  schema: CurrentFile
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const comment of schema!.comments) {
    const commentText = doc.getText(convertRangeToVS(comment.commentRange));
    const codeUri = resolveCodePath(URI.parse(doc.uri), comment);
    let codeDoc = doc;
    let codeText: string;
    if (codeUri.toString() === doc.uri) {
      // Then the code and comment are in the same file
      codeText = doc.getText(convertRangeToVS(comment.codeRange));
    } else {
      // Read the code text by loading its document
      codeDoc = TextDocument.create(
        codeUri.toString(),
        "text",
        0,
        (await fs.readFile(codeUri)).toString()
      );
      codeText = codeDoc.getText(convertRangeToVS(comment.codeRange));
    }

    const makeError = (errorType: ErrorType, moveFix?: CurrentComment) => ({
      commentId: comment.id,
      commentUriString: doc.uri.toString(),
      commentRange: comment.commentRange,
      errorType,
      codeLocation: {
        uriString: codeUri.toString(),
        range: comment.codeRange,
      },
      actual: {
        comment: commentText,
        code: codeText,
      },
      expected: {
        comment: comment.commentValue,
        code: comment.codeValue,
      },
      moveFix,
    });

    const commentMatches = commentText === comment.commentValue;
    const codeMatches = codeText === comment.codeValue;
    // If the comment does not match but can be found elsewhere, this is the index (otherwise -1)
    const commentMovedNewIndex =
      (commentMatches && -1) || doc.getText().indexOf(comment.commentValue);
    const codeMovedNewIndex =
      (codeMatches && -1) || codeDoc.getText().indexOf(comment.codeValue);
    // This function helps us make new comment object for moved texts
    const makeFix = (cur: CurrentComment, typ: "comment" | "code") => {
      const whichDoc = typ === "comment" ? doc : codeDoc;
      const whichIndex =
        typ === "comment" ? commentMovedNewIndex : codeMovedNewIndex;
      const whichValue = typ === "comment" ? cur.commentValue : cur.codeValue;
      const start = whichDoc.positionAt(whichIndex);
      const end = whichDoc.positionAt(whichIndex + whichValue.length);
      return {
        ...cur,
        [typ + "Range"]: convertRangeToSchema({ start, end }),
      };
    };

    // Pick which error to report
    if (!commentMatches && codeMatches) {
      if (commentMovedNewIndex !== -1) {
        errors.push(
          makeError(ErrorType.CommentMismatch, makeFix(comment, "comment"))
        );
      } else {
        errors.push(makeError(ErrorType.CommentMismatch));
      }
    } else if (commentMatches && !codeMatches) {
      if (codeMovedNewIndex !== -1) {
        errors.push(
          makeError(ErrorType.CodeMismatch, makeFix(comment, "code"))
        );
      } else {
        errors.push(makeError(ErrorType.CodeMismatch));
      }
    } else if (!commentMatches && !codeMatches) {
      if (commentMovedNewIndex !== -1 && codeMovedNewIndex !== -1) {
        const fix = makeFix(makeFix(comment, "comment"), "code");
        errors.push(makeError(ErrorType.BothMismatch, fix));
      } else {
        errors.push(makeError(ErrorType.BothMismatch));
      }
    }
  }

  return errors;
}
