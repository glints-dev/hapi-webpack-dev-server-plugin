import * as Hapi from "@hapi/hapi";

type Middleware = (
  req: Hapi.Request["raw"]["req"],
  res: Hapi.Request["raw"]["res"],
  next: (error?: Error) => void
) => unknown;

export default function createMiddlewareExtension(
  middleware: Middleware
): Hapi.Lifecycle.Method {
  return async (request, h) => {
    const { req, res } = request.raw;
    try {
      const handled = await new Promise<boolean>((resolve, reject) => {
        let settled = false;
        const settle = (handled: boolean, error?: unknown) => {
          if (settled) return;
          settled = true;
          res.removeListener("finish", onFinish);
          res.removeListener("close", onFinish);
          res.removeListener("error", onError);
          if (error) reject(error);
          else resolve(handled);
        };
        const onFinish = () => settle(true);
        const onError = (error: unknown) => settle(true, error);

        res.once("finish", onFinish);
        res.once("close", onFinish);
        res.once("error", onError);
        if (res.writableEnded || res.destroyed) {
          onFinish();
          return;
        }

        try {
          // A fulfilled middleware promise can mean the request was only queued.
          // Only next() or response completion can release Hapi's lifecycle.
          Promise.resolve(
            middleware(req, res, error => {
              settle(res.writableEnded || res.destroyed, error);
            })
          ).catch(onError);
        } catch (error) {
          onError(error);
        }
      });

      // Preserve compatibility with Hapi versions affected by hapijs/hapi#3884.
      (request as Hapi.Request & { _isReplied: boolean })._isReplied = handled;
      return handled ? h.abandon : h.continue;
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return h.abandon;
      }
      return error;
    }
  };
}
