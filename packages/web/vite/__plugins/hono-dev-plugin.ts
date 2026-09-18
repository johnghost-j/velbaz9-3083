import type { Plugin, ViteDevServer } from "vite";

export default function honoDevPlugin(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Routage par nom d'hôte (parité avec src/__server.ts) : en production,
        // un domaine client (ou un sous-domaine *.velbaz.site) est résolu vers
        // le site publié correspondant. On reproduit ce comportement en dev,
        // sinon impossible de tester un domaine connecté en local.
        let rewritten: string | null = null;
        if (!req.url?.startsWith("/api")) {
          try {
            const rawHost = (req.headers["x-forwarded-host"] || req.headers.host) as string | undefined;
            const sub = rawHost ? await resolveHost(server, rawHost) : null;
            if (sub) rewritten = `/api/s/${sub}${req.url === "/" ? "" : req.url}`;
          } catch (err) {
            console.error("[hono-dev] résolution d'hôte échouée :", err);
          }
        }
        if (!rewritten && !req.url?.startsWith("/api")) return next();

        try {
          const request = await toWebRequest(req, rewritten);
          const app = await loadApp(server);
          const response = await app.fetch(request);

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
          });
          const setCookies = response.headers.getSetCookie?.();
          if (setCookies?.length) res.setHeader("set-cookie", setCookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error("[hono-dev]", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}

async function loadApp(server: ViteDevServer) {
  const mod = await server.ssrLoadModule("/src/api/index.ts");
  return mod.default;
}

/** Sous-domaine du site publié derrière cet hôte, ou null (app Velbaz). */
async function resolveHost(server: ViteDevServer, rawHost: string): Promise<string | null> {
  const mod = await server.ssrLoadModule("/src/api/domains.ts");
  return mod.subdomainForHost(rawHost);
}

function toWebRequest(req: import("http").IncomingMessage, pathOverride?: string | null): Request {
  const url = new URL(pathOverride || req.url!, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex needed for streaming request bodies
    duplex: hasBody ? "half" : undefined,
  });
}
