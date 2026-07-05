import { createProxyMiddleware } from "http-proxy-middleware";

import { config } from "../config.js";

/**
 * Proxies all /api/data/* requests to the FastAPI data engine, stripping the
 * /api/data prefix. Handles multipart uploads transparently via streaming.
 */
export const dataProxy = createProxyMiddleware({
  target: config.pythonServiceUrl,
  changeOrigin: true,
  pathRewrite: { "^/api/data": "" },
  on: {
    error: (err, _req, res) => {
      // @ts-expect-error res may be a ServerResponse
      if (res && typeof res.writeHead === "function" && !res.headersSent) {
        // @ts-expect-error writeHead exists on ServerResponse
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Data engine unavailable. Is the Python service running?",
            detail: String(err),
          })
        );
      }
    },
  },
});
