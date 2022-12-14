/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const path = require('path');
const originalWebpackHelpers =
    require('../third_party/neuroglancer/config/webpack_helpers');
const resolveReal = require('../third_party/neuroglancer/config/resolve_real');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const VueLoaderPlugin = require('vue-loader/lib/plugin');

function modifyViewerOptions(options) {
  options = options || {};
  options.resolveLoaderRoots = [
    ...(options.resolveLoaderRoots || []),

    // Allow loader modules to be resolved from node_modules directory of this
    // project in addition to the node_modules directory of neuroglancer.
    resolveReal(__dirname, '../node_modules')
  ];

  // This references the tsconfig.json file of this project, rather than of
  // neuroglancer.
  options.tsconfigPath = resolveReal(__dirname, '../tsconfig.json');

  // This references the main.ts of this project, rather than of
  // neuroglancer.
  options.frontendModules = [resolveReal(__dirname, '../src/main.ts')];

  options.frontendPlugins = [
    new VueLoaderPlugin(),
    new CopyWebpackPlugin([{'from': 'images', 'to': 'images'}]),
    new CopyWebpackPlugin(
        [{'from': 'src/config.json', 'to': 'src/config.json'}])
  ];

  options.htmlPlugin = new HtmlWebpackPlugin(
      {template: resolveReal(__dirname, '../src/index.html')});

  options.resolveAliases = {
    'vue': resolveReal(__dirname, '../node_modules/vue/dist/vue.esm.js'),
  };

  return options;
}

exports.getViewerConfigFromEnv = function(options, env) {
  const res = originalWebpackHelpers.getViewerConfigFromEnv(
      modifyViewerOptions(options), env);

  const frontEndModule = res[0].module;
  const frontEndTsLoader = frontEndModule.rules[0].loader[0];
  frontEndTsLoader.options['appendTsSuffixTo'] = [/\.vue$/];

  frontEndModule.rules.push({test: /\.vue$/, loader: 'vue-loader'});
  frontEndModule.rules.push({test: /\.txt$/, loader: 'raw-loader'});
  frontEndModule.rules.push({test: /\.tcss$/, loader: 'raw-loader'});

  return res;
};
