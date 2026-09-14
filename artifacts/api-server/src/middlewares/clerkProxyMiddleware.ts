import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

export const CLERK_PROXY_PATH = "/api/__clerk";

export function clerkProxyMiddleware(): RequestHandler {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (process.env.NODE_ENV !== "production" || !secretKey) {
    return (_req, _res, next) => next();
  }
  return createProxyMiddleware({
    target: "https://frontend-api.clerk.dev",
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: { [`^${CLERK_PROXY_PATH}`]: "" },
    on: {
      proxyReq(proxyReq, req) {
        const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
        const protocol = String(req.headers["x-forwarded-proto"] ?? "https");
        proxyReq.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);
      },
      proxyRes(proxyRes, req, res) {
        const headers = { ...proxyRes.headers };
        delete headers["transfer-encoding"];
        delete headers["connection"];
        delete headers["keep-alive"];
        const status = proxyRes.statusCode ?? 502;
        const bodyless = req.method === "HEAD" || status < 200 || status === 204 || status === 304;
        if (headers["content-length"] !== undefined || bodyless) {
          res.writeHead(status, headers);
          proxyRes.on("error", () => res.destroy());
          proxyRes.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on("error", () => res.destroy());
      },
    },
  }) as RequestHandler;
}