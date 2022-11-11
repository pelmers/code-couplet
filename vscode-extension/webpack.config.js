//@ts-check

"use strict";

const path = require("path");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: "node",
  mode: "none",

  entry: {
    extension: "./src/extension.ts",
    testIndex: "./src/test/suite/index.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
    mocha: "commonjs mocha",
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"],
    // @ts-ignore
    plugins: [new TsconfigPathsPlugin({})],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  devtool: "cheap-module-source-map",
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};

module.exports = extensionConfig;
