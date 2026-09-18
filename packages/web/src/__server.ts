import app from "./api";
import { subdomainForHost } from "./api/domains";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dirname}/../dist`;
const indexPath = `${distDir}/index.html`;

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    // Sites publiés servis sur une URL propre : /s/:subdomain → API interne.
    if (url.pathname === "/s" || url.pathname.startsWith("/s/")) {
      const apiUrl = new URL(request.url);
      apiUrl.pathname = "/api" + url.pathname;
      return app.fetch(new Request(apiUrl.toString(), request));
    }

    // DOMAINES PERSONNALISÉS : c'est l'en-tête Host qui décide quel site servir.
    // example.com raccordé + publié → on sert le site du client, pas l'app
    // Velbaz. Résolution réelle en base (cache 30 s) ; null = app Velbaz
    // (localhost, velbaz.site, hôtes de prévisualisation).
    const siteSub = await subdomainForHost(
      request.headers.get("x-forwarded-host") || request.headers.get("host"),
    ).catch(() => null);
    if (siteSub) {
      const siteUrl = new URL(request.url);
      siteUrl.pathname = `/api/s/${siteSub}${url.pathname === "/" ? "" : url.pathname}`;
      return app.fetch(new Request(siteUrl.toString(), request));
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "").replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
