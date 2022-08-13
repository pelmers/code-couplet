import * as fs from "fs";
import * as util from "util";

import { File, CurrentFile } from "./types";

export async function loadSchema(schemaPath: string): Promise<File> {
  const contents = await util.promisify(fs.readFile)(schemaPath);
  return validateSchema(contents.toString("utf8"));
}

export function validateSchema(contents: string): File {
  // TODO: use io-ts here
  return JSON.parse(contents);
}

export async function saveSchema(
  schemaPath: string,
  schema: CurrentFile
): Promise<void> {
  // TODO: use io-ts here
  await util.promisify(fs.writeFile)(
    schemaPath,
    JSON.stringify(schema, null, 2)
  );
}

export function migrateToLatestFormat(file: File): CurrentFile {
  return file;
}
