import * as Hapi from "@hapi/hapi";
import * as Webpack from "webpack";

import * as WebpackDevMiddleware from "webpack-dev-middleware";
import * as WebpackHotMiddleware from "webpack-hot-middleware";

import createMiddlewareExtension from "./createMiddlewareExtension";

export interface WebpackDevServerPluginOptions {
  compiler: Webpack.Compiler;
  devMiddlewareOptions: WebpackDevMiddleware.Options<
    WebpackDevMiddleware.IncomingMessage,
    WebpackDevMiddleware.ServerResponse
  >;
}

export interface WebpackDevServerPluginProperties {
  devMiddleware: WebpackDevMiddleware.API<
    WebpackDevMiddleware.IncomingMessage,
    WebpackDevMiddleware.ServerResponse
  >;
}

declare module "@hapi/hapi" {
  interface PluginProperties {
    WebpackDevServerPlugin?: WebpackDevServerPluginProperties;
  }
}

/**
 * WebpackDevServerPlugin provides access to the Webpack development server.
 */
const WebpackDevServerPlugin: Hapi.Plugin<WebpackDevServerPluginOptions> &
  Hapi.PluginNameVersion = {
  name: "WebpackDevServerPlugin",
  register: async (server, options) => {
    const webpackDevMiddleware = WebpackDevMiddleware(
      options.compiler,
      options.devMiddlewareOptions
    );
    const webpackHotMiddleware = WebpackHotMiddleware(options.compiler, {
      path: "/__webpack_hmr",
    });

    server.ext("onRequest", createMiddlewareExtension(webpackDevMiddleware));
    server.ext("onRequest", createMiddlewareExtension(webpackHotMiddleware));

    server.expose("devMiddleware", webpackDevMiddleware);
  },
};

export default WebpackDevServerPlugin;
