import * as Hapi from "@hapi/hapi";
import * as Webpack from "webpack";

import * as WebpackDevMiddleware from "webpack-dev-middleware";
import * as WebpackHotMiddleware from "webpack-hot-middleware";

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

    server.ext("onRequest", async (request, h) => {
      try {
        await webpackDevMiddleware(
          request.raw.req,
          request.raw.res,
          (err: Error) => {
            // webpack-dev-middleware never calls the callback with an err object.
            // See node_modules/webpack-dev-middleware/lib/middleware.js.
          }
        );
        // Hapi doesn't seem to honor h.abandon, leading to "headers already sent"
        // errors on the console. Mark the private property _isReplied as true so
        // that Hapi doesn't send anything.
        // https://github.com/hapijs/hapi/issues/3884
        (request as any)._isReplied = request.raw.res.finished;
        return request.raw.res.finished ? h.abandon : h.continue;
      } catch (err) {
        return err;
      }
    });

    server.ext("onRequest", async (request, h) => {
      try {
        await new Promise<void>((resolve, reject) => {
          webpackHotMiddleware(
            request.raw.req,
            request.raw.res,
            (err: Error) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
        (request as any)._isReplied = request.raw.res.finished;
        return request.raw.res.finished ? h.abandon : h.continue;
      } catch (err) {
        return err;
      }
    });

    server.expose("devMiddleware", webpackDevMiddleware);
  },
};

export default WebpackDevServerPlugin;
