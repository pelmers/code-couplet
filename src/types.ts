// TODO: Should the encoded char start at 0 or at the first non whitespace character?
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

export type ConfigurationV1 = {
  lineComment?: string;
};

export type FileV1 = {
  version: 1;
  comments: CommentV1[];
  configuration: ConfigurationV1;
};

// * When there are more versions, this should be a union of all of them
export type File = FileV1;

// * This type should match the latest version
export type CurrentFile = FileV1;
