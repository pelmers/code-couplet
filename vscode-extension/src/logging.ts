import { PROJECT_NAME } from "@lib/constants";
import { getErrorMessage } from "@lib/utils";
import * as vscode from "vscode";

let output: vscode.OutputChannel;

export const activate = (context: vscode.ExtensionContext) => {
  output = vscode.window.createOutputChannel(PROJECT_NAME);
  context.subscriptions.push(output);
  log(`Logging activated for ${PROJECT_NAME}`);
};

export function log(message: string) {
  output.appendLine(message);
}

/**
 * Given func, return new function with the same signature that wraps any errors func throws
 * and shows them in a vscode info box and error console.
 */
export function errorWrapper<TInput extends any[], TOutput>(
  func: (...args: TInput) => TOutput
) {
  return async (...args: TInput) => {
    try {
      return await func(...args);
    } catch (e) {
      vscode.window.showErrorMessage(getErrorMessage(e));
      log(getErrorMessage(e));
      console.error(e);
    }
  };
}
