// TODO: Should the encoded position ignore leading whitespace?
export type Position = {
  line: number;
  char: number;
};

export type Range = {
  start: Position;
  end: Position;
};

export type CommentV1 = {
  commentValue: string;
  commentRange: Range;
  codeRange: Range;
  codeValue: string;
};

export type FileV1 = {
  version: 1;
  comments: CommentV1[];
};

// When there are more versions, this should be a union of all of them
export type File = FileV1;

// This type should match the latest version
export type CurrentFile = FileV1;
