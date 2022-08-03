type Position = {
  line: number;
  char: number;
};

type Range = {
  start: Position;
  end: Position;
};

type CommentCommon = {
  commentValue: string;
  commentRange: Range;
  codeRange: Range;
  codeValue: string;
}

type ManualComment = {
  type: "manual";
} & CommentCommon;

type AutomaticComment = {
  type: "automatic";
  relevance: number;
} & CommentCommon;

type Comment = ManualComment | AutomaticComment

type File = {
  version: number;
  comments: Comment[];
};
