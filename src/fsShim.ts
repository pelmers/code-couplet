// The point of this module is to let the same code run in both VS Code extensions and as a normal node program.
// I do that by providing a shim for vscode FileSystem API when outside of VS Code.

import * as util from "util";
import { FileSystem } from "vscode";
import { URI } from "vscode-uri";

// Declaration copied from vscode.d.ts
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export function getFs(): FileSystem {
  try {
    return require("vscode").workspace.fs;
  } catch (e) {
    // Fall back to non-vscode shim below
  }
  return {
    async stat(uri: URI) {
      const fs = await import("fs");
      const stats = await util.promisify(fs.stat)(uri.fsPath);
      const typ =
        (stats.isFile() ? FileType.File : 0) |
        (stats.isDirectory() ? FileType.Directory : 0) |
        (stats.isSymbolicLink() ? FileType.SymbolicLink : 0);
      return {
        ctime: stats.ctime.getTime(),
        mtime: stats.mtime.getTime(),
        size: stats.size,
        type: typ,
      };
    },

    async readDirectory(uri: URI) {
      const fs = await import("fs");
      const files = await util.promisify(fs.readdir)(uri.fsPath);
      return files.map((f) => [f, FileType.File]);
    },

    async createDirectory(uri: URI) {
      const fs = await import("fs");
      await util.promisify(fs.mkdir)(uri.fsPath);
    },

    async readFile(uri: URI) {
      const fs = await import("fs");
      return await util.promisify(fs.readFile)(uri.fsPath);
    },

    async writeFile(uri: URI, content: Uint8Array) {
      const fs = await import("fs");
      await util.promisify(fs.writeFile)(uri.fsPath, content);
    },

    async delete(
      uri: URI,
      options?: { recursive?: boolean; useTrash?: boolean }
    ) {
      const fs = await import("fs");
      if (options?.recursive) {
        const rm = util.promisify(fs.rm);
        await rm(uri.fsPath, { recursive: true, force: true });
      } else {
        await util.promisify(fs.unlink)(uri.fsPath);
      }
    },

    async rename(src: URI, target: URI, options?: { overwrite?: boolean }) {
      const fs = await import("fs");
      await util.promisify(fs.rename)(src.fsPath, target.fsPath);
      if (options?.overwrite) {
        throw new Error("overwrite not implemented");
      }
    },

    async copy(src: URI, target: URI, options?: { overwrite?: boolean }) {
      const fs = await import("fs");
      await util.promisify(fs.copyFile)(src.fsPath, target.fsPath);
      if (options?.overwrite) {
        throw new Error("overwrite not implemented");
      }
    },

    isWritableFileSystem(scheme: string) {
      return true;
    },
  };
}

export async function exists(uri: URI) {
  try {
    await getFs().stat(uri);
    return true;
  } catch (e) {
    return false;
  }
}
