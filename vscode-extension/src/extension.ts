import * as vscode from "vscode";

function linkSelectionCommand() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	const selection = editor.selection;
	const text = editor.document.getText(selection);
	// TODO:
	// Check whether the text in the selection has a comment and code
	// Use vs code editor scope to determine if text is a comment
	// will need to work around https://github.com/Microsoft/vscode/issues/580
	// example: https://github.com/microsoft/vscode/blob/342394d1e7d43d3324dc2ede1d634cffd52ba159/src/vs/workbench/contrib/codeEditor/browser/inspectEditorTokens/inspectEditorTokens.ts#L242-L261

	// one idea: https://stackoverflow.com/questions/61536814/vscode-api-check-if-the-current-line-is-a-comment

	// another option: two-part command, then the ui is 1. select comment, 2. select code
	// that seems too clunky!

	// I might do a tree sitter thing, I suggested some examples at:
	// https://github.com/Microsoft/vscode/issues/580#issuecomment-1214160025
}

export function activate(context: vscode.ExtensionContext) {
  // TODO:
  // 1. register command to couple code + comments
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-couplet-vscode.linkSelection",
      linkSelectionCommand
    )
  );
  // TODO
  // 2. on save, invoke validation and display diagnostics (w/ quick fixes)
}

// this method is called when your extension is deactivated
export function deactivate() {}
