import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(",")[0]?.trim() || undefined;
};

const enforceProductionSameOrigin: RequestHandler = (req, res, next) => {
  const requestOrigin = firstHeaderValue(req.headers.origin);
  if (!requestOrigin) {
    next();
    return;
  }

  const host = firstHeaderValue(req.headers["x-forwarded-host"]) ?? req.get("host");
  const protocol = firstHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const expectedOrigin = host && protocol ? `${protocol}://${host}` : null;
  if (expectedOrigin !== requestOrigin) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  next();
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (process.env.NODE_ENV === "production") {
  app.use(enforceProductionSameOrigin);
}
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(
  process.env.NODE_ENV === "production"
    ? { origin: false }
    : { credentials: true, origin: true },
));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
