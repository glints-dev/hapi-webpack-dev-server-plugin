const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { test } = require("node:test");
const createMiddlewareExtension = require("../dist/createMiddlewareExtension").default;

const h = { continue: Symbol("continue"), abandon: Symbol("abandon") };

function request() {
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    destroy() { this.destroyed = true; },
  });
  return { raw: { req: {}, res } };
}

function assertClean(res) {
  for (const event of ["finish", "close", "error"]) {
    assert.equal(res.listenerCount(event), 0, `${event} listener leaked`);
  }
}

test("a fulfilled promise does not release a queued request", async () => {
  const req = request();
  let next;
  let released = false;
  const result = createMiddlewareExtension(async (_req, _res, callback) => {
    next = callback;
  })(req, h).then(value => { released = true; return value; });
  await nextTurn();
  assert.equal(released, false);
  next();
  assert.equal(await result, h.continue);
  assertClean(req.raw.res);
});

for (const event of ["finish", "close"]) {
  test(`abandons a response on ${event} without waiting for next`, async () => {
    const req = request();
    let next;
    const result = createMiddlewareExtension((_req, _res, callback) => {
      next = callback;
    })(req, h);
    req.raw.res.emit(event);
    next(new Error("late callback"));
    assert.equal(await result, h.abandon);
    assert.equal(req._isReplied, true);
    assertClean(req.raw.res);
  });
}

test("captures synchronous response completion", async () => {
  const req = request();
  assert.equal(await createMiddlewareExtension((_req, res) => {
    res.emit("finish");
  })(req, h), h.abandon);
  assertClean(req.raw.res);
});

for (const property of ["writableEnded", "destroyed"]) {
  test(`skips middleware when the response is already ${property}`, async () => {
    const req = request();
    req.raw.res[property] = true;
    assert.equal(await createMiddlewareExtension(() => {
      assert.fail("middleware must not run");
    })(req, h), h.abandon);
    assertClean(req.raw.res);
  });
}

for (const failure of ["throw", "reject", "next", "error"]) {
  test(`handles middleware failure via ${failure}`, async () => {
    const error = new Error("middleware failed");
    const req = request();
    const result = createMiddlewareExtension((_req, res, next) => {
      if (failure === "throw") throw error;
      if (failure === "reject") return Promise.reject(error);
      if (failure === "next") next(error);
      if (failure === "error") res.emit("error", error);
    })(req, h);
    assert.equal(await result, error);
    assertClean(req.raw.res);
  });
}

test("does not send an error response after headers were sent", async () => {
  const req = request();
  const result = createMiddlewareExtension((_req, res, next) => {
    res.headersSent = true;
    next(new Error("stream failed"));
  })(req, h);
  assert.equal(await result, h.abandon);
  assert.equal(req.raw.res.destroyed, true);
  assertClean(req.raw.res);
});

test("observes a rejected promise even after next has completed", async () => {
  const req = request();
  const result = createMiddlewareExtension((_req, _res, next) => {
    next();
    return Promise.reject(new Error("late rejection"));
  })(req, h);
  assert.equal(await result, h.continue);
  await nextTurn();
  assertClean(req.raw.res);
});
