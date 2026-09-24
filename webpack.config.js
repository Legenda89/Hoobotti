// webpack.config.js

// webpack.server.config.js
import { resolve as _resolve } from "path";
import webpack from "webpack";

export default (_env, argv) => {
  const isDevelopment = argv.mode === "development";
  const buildDir = isDevelopment ? "build-dev" : "build";
  return {
    devtool: "source-map",
    mode: isDevelopment ? "production" : "development",
    target: "node",
    entry: {
      hoobot: "./src/index.ts",
      runSimGrid: "./src/scripts/runSimGrid.ts",
    },
    output: {
      filename: "[name].js",
      path: _resolve(`./${buildDir}`),
      module: true,
      chunkFormat: "module",
      library: { type: "module" },
      libraryTarget: "module",
    },
    experiments: {
      outputModule: true,
    },
    optimization: {
      minimize: false,
      usedExports: true,
      // mangleExports: false,
      // innerGraph: false,
      // flagIncludedChunks: false,
      // emitOnErrors: false,
      // concatenateModules: false,
      // chunkIds: 'named',
      // mergeDuplicateChunks: false,
      // portableRecords: false,
      // providedExports: false,
      // realContentHash: false,
      // removeAvailableModules: false,
      // removeEmptyChunks: false,
      // moduleIds: 'deterministic',
      // sideEffects: 'flag',
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: ["ts-loader"],
        },
        {
          test: /\.css$/i,
          use: ["css-loader"],
        },
        {
          test: /\.json$/,
          loader: "json-loader",
          type: "javascript/auto",
        },
        {
          test: /\.(png\|jpg\|gif\|avif\|\/otf\/|ttf)$/i,
          loader: "ignore-loader",
        },
        {
          test: /\.node$/,
          loader: "node-loader",
        },
      ],
    },
    resolve: {
      alias: {
        "mongodb-client-encryption": "mongodb-client-encryption-browserify",
      },
      extensions: [".tsx", ".ts", ".js", ".jsx"],
    },
    // discord.js (@discordjs/ws) and express use dynamic require(); safe on Node, noisy in webpack.
    ignoreWarnings: [
      /aws-crt/,
      /mongodb\/lib\/utils.js/,
      /mongodb\/lib\/deps.js/,
      { module: /@discordjs\/ws/, message: /Critical dependency/ },
      { module: /express\/lib\/view\.js/, message: /Critical dependency/ },
    ],
    plugins: [
      new webpack.DefinePlugin({
        "global.GENTLY": false,
      }),
    ],
  };
};
