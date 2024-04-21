import HtmlWebpackPlugin from "html-webpack-plugin";
import loader, { VueLoaderPlugin } from "vue-loader";
import pkg from "webpack";
const { DefinePlugin } = pkg;

import configKeybinds from "./config/custom-keybinds.json" with { type: "json" };
import configNGExtend from "./config/ng-extend.json" with { type: "json" };
import configStateServers from "./config/state_servers.json" with { type: "json" };

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
      }
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
      CONFIG: JSON.stringify(configNGExtend),
      STATE_SERVERS: JSON.stringify(configStateServers),
      CUSTOM_BINDINGS: JSON.stringify(configKeybinds),
    }),
  ],
};
