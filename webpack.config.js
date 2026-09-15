import HtmlWebpackPlugin from "html-webpack-plugin";
import loader, { VueLoaderPlugin } from "vue-loader";
import pkg from "webpack";
const { DefinePlugin } = pkg;

import configKeybinds from "./config/custom-keybinds.json" with { type: "json" };
import configNGExtend from "./config/ng-extend.json" with { type: "json" };
import configStateServers from "./config/state_servers.json" with { type: "json" };

// The MERGER FREE service endpoints can be given as environment variables at
// build / dev-server time; a set variable wins over config/ng-extend.json, so a
// local run (demo/run_local.sh) or a CI build points the bundle at its APIs
// without editing a tracked file.  Same keys the clients read from CONFIG:
//   CANDELA_API       -> candela_api        (mergeQueueClient.ts, decisionsClient.ts)
//   CANDELA_DATASTACK -> candela_datastack  (mergeQueueClient.ts)
//   AUTOPROOF_API     -> autoproof_api      (autoproofClient.ts)
const ENV_CONFIG_KEYS = {
  CANDELA_API: "candela_api",
  CANDELA_DATASTACK: "candela_datastack",
  AUTOPROOF_API: "autoproof_api",
};
const config = { ...configNGExtend };
for (const [envVar, key] of Object.entries(ENV_CONFIG_KEYS)) {
  const v = process.env[envVar];
  if (v !== undefined && v.trim() !== "") {
    config[key] = v.trim();
    console.log(`ng-extend config: ${key} = ${config[key]} (from $${envVar})`);
  }
}

export default {
  entry: "./src/main.ts",
  mode: "development",
  devtool: "source-map",
  performance: {
    // Avoid unhelpful warnings due to large bundles.
    maxAssetSize: 3 * 1024 * 1024,
    maxEntrypointSize: 3 * 1024 * 1024,
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: "vue-loader",
      },
      // Needed to support Neuroglancer TypeScript sources when using
      // Neuroglancer source package directly.
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        options: {
          appendTsSuffixTo: [/\.vue$/]
        },
      },
      // Needed for .svg?raw imports used for embedding icons.
      {
        resourceQuery: /raw/,
        type: "asset/source",
      },
      // Needed for .html assets used for auth redirect pages for the brainmaps
      // and bossDB data sources.  Can be skipped if those data sources are
      // excluded.
      {
        test: /\.html$/,
        type: "asset/resource",
        generator: {
          // Filename must be preserved since exact redirect URLs must be allowlisted.
          filename: "[name][ext]",
        },
      },
      // Necessary to handle CSS files.
      {
        test: /\.css$/,
        use: [{ loader: "style-loader" }, { loader: "css-loader" }],
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: "file-loader",
          },
        ],
      },
    ],
  },
  devServer: {
    client: {
      overlay: {
        // Prevent intrusive notification spam.
        runtimeErrors: false,
      },
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'src/index.tpl',
    }),
    new VueLoaderPlugin(),
    new DefinePlugin({
      CONFIG: JSON.stringify(config),
      STATE_SERVERS: JSON.stringify(configStateServers),
      CUSTOM_BINDINGS: JSON.stringify(configKeybinds),
    }),
  ],
};
