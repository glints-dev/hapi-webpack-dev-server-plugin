const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { test } = require("node:test");
const Hapi = require("@hapi/hapi");
const webpack = require("webpack");
const { WebpackDevServerPlugin } = require("../dist");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
      response.on("error", reject);
    }).on("error", reject);
  });
}

test("holds concurrent asset requests until bulk-edit rebuilds finish", { timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hapi-webpack-test-"));
  const files = Array.from({ length: 32 }, (_, index) => `module-${index}.js`);
  await Promise.all(files.map(file => fs.writeFile(path.join(directory, file), "export default 0;")));
  await fs.writeFile(path.join(directory, "index.js"), files.map((file, index) =>
    `import value${index} from './${file}'; console.log(value${index});`
  ).join("\n"));

  const compiler = webpack({
    mode: "development",
    context: directory,
    entry: "./index.js",
    output: { path: path.join(directory, "dist"), filename: "main.js", publicPath: "/assets/" },
    infrastructureLogging: { level: "none" },
  });
  let blockBuild;
  let releaseBuild;
  compiler.hooks.make.tapAsync("HoldCompilation", (_compilation, callback) => {
    if (blockBuild) {
      releaseBuild = callback;
      const entered = blockBuild;
      blockBuild = undefined;
      entered();
    } else {
      callback();
    }
  });

  const server = Hapi.server({ host: "127.0.0.1", port: 0 });
  await server.register({
    plugin: WebpackDevServerPlugin,
    options: { compiler, devMiddlewareOptions: { publicPath: "/assets/", stats: false } },
  });
  const middleware = server.plugins.WebpackDevServerPlugin.devMiddleware;
  t.after(async () => {
    if (releaseBuild) releaseBuild();
    await new Promise(resolve => middleware.close(resolve));
    await new Promise(resolve => compiler.close(resolve));
    await server.stop({ timeout: 0 });
    await fs.rm(directory, { recursive: true, force: true });
  });
  server.route({ method: "GET", path: "/health", handler: () => "healthy" });
  await server.start();
  await new Promise(resolve => middleware.waitUntilValid(resolve));

  assert.deepEqual(await get(`${server.info.uri}/health`), { status: 200, body: "healthy" });
  assert.equal((await get(`${server.info.uri}/assets/missing.js`)).status, 404);

  for (let round = 1; round <= 3; round++) {
    const entered = new Promise(resolve => { blockBuild = resolve; });
    await Promise.all(files.map(file => fs.writeFile(path.join(directory, file), `export default ${round};`)));
    middleware.invalidate();
    await entered;

    const requests = Array.from({ length: 24 }, () => get(`${server.info.uri}/assets/main.js`));
    // Wait until the real middleware has queued all requests, without relying on a build duration.
    const deadline = Date.now() + 3000;
    while (middleware.context.callbacks.length < requests.length && Date.now() < deadline) {
      await nextTurn();
    }
    assert.equal(middleware.context.callbacks.length, requests.length);
    const release = releaseBuild;
    releaseBuild = undefined;
    release();

    const responses = await Promise.all(requests);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.match(response.body, new RegExp(`default export.*${round}`));
    }
  }
});
