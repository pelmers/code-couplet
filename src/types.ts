import * as t from "io-ts";

function optional<X extends t.Mixed>(typ: X) {
  return t.union([t.null, typ]);
}

const Position = t.type({
  line: t.number,
  char: t.number,
});
export type Position = t.TypeOf<typeof Position>;

const Range = t.type({
  start: Position,
  end: Position,
});
export type Range = t.TypeOf<typeof Range>;

const CommentV1 = t.type({
  commentValue: t.string,
  commentRange: Range,
  codeRange: Range,
  codeValue: t.string,
  id: t.number,
});
export type CommentV1 = t.TypeOf<typeof CommentV1>;

const ConfigurationV1 = t.type({
  lineComment: optional(t.string),
});
export type ConfigurationV1 = t.TypeOf<typeof ConfigurationV1>;

const FileV1 = t.type({
  version: t.literal(1),
  configuration: ConfigurationV1,
  comments: t.array(CommentV1),
});
export type FileV1 = t.TypeOf<typeof FileV1>;

// * When there are more versions, this should be a union of all of them
export const File = FileV1;
export type TFile = t.TypeOf<typeof File>;

// * This type should match the latest version
export type CurrentFile = t.TypeOf<typeof FileV1>;

export function emptySchema(): CurrentFile {
  return {
    version: 1,
    comments: [],
    configuration: { lineComment: null },
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
