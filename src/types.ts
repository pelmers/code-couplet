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

export function emptySchema(): CurrentFile {
  return {
    version: 1,
    comments: [],
    configuration: {},
  };
}

// Borrowed from comments of https://github.com/microsoft/TypeScript/issues/1897
type AnyJson = boolean | number | string | null | JsonArray | JsonMap;
interface JsonMap {
  [key: string]: AnyJson;
}
interface JsonArray extends Array<AnyJson> {}

// This bit statically asserts that the type is a JSON object
if (1 + 1 === 3) {
  (<T extends AnyJson>(schema: T): T => schema)(emptySchema());
}
