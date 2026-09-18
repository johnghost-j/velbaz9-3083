import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";
import runableAnalyticsPlugin from "./vite/__plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/__plugins/hono-dev-plugin";
import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";
import xLiveWsPlugin from "./vite/plugins/x-live-ws-plugin";
import apiStreamPlugin from "./vite/plugins/api-stream-plugin";
import ports from "../../__ports.cjs";

const root = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  Object.assign(process.env, env);

  return {
    // All env files live at the repo root — keep Vite's own env loading there too,
    // so packages/web/.env* files can never shadow the root .env.
    envDir: root,
    plugins: [
      // [2026-09-05 bug 19.D] AVANT honoDevPlugin : celui-ci met en tampon la
      // réponse entière (`await response.arrayBuffer()`), ce qui tuait tout flux
      // SSE long — dont /api/genesis/stream. Le nôtre prend /api en streaming.
      apiStreamPlugin(),
      honoDevPlugin(),
      react(),
      runableAnalyticsPlugin(),
      tailwind(),
      assetOptimizerPlugin(),
      xLiveWsPlugin(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/web"),
      },
    },
    server: {
      port: ports.website,
      strictPort: true,
      allowedHosts: true,
      // [2026-09-16] `clientPort` corrige le pop-up Chrome « … souhaite
      // accéder à d'autres applis et services sur cet appareil » (permission
      // Local Network Access, Chrome 141+).
      // Cause : l'aperçu est servi en HTTPS sur le port 443, donc
      // `import.meta.url.port` est VIDE côté navigateur. Le client HMR de Vite
      // construisait alors l'URL `wss://<hôte>:/` (port manquant) — invalide →
      // la connexion échouait → et son repli intégré tentait
      // `wss://localhost:4200`, c'est-à-dire une requête de la page publique
      // vers le loopback de la MACHINE DE L'UTILISATEUR. Chrome demande donc
      // l'autorisation d'accéder au réseau local.
      // En fixant le port du client : l'URL devient `wss://<hôte>:443/` (qui
      // passe bien par le proxy de l'aperçu — testé 101 Switching Protocols),
      // et comme `hmrPort` est défini, Vite DÉSACTIVE son repli vers localhost
      // (`if (!hmrPort)` dans son client) : plus aucune requête vers le réseau
      // local, donc plus de pop-up.
      hmr: { overlay: false, clientPort: 443 },
      // Le serveur écrit des fichiers de runtime (logs d'usage IA, aperçus de marque,
      // sites générés, réglages…) pendant que l'IA travaille. Sans cette liste,
      // le watcher de Vite les voit changer et renvoie un "full-reload" au navigateur :
      // la page se rafraîchissait toute seule en plein milieu d'une génération.
      watch: {
        ignored: [
          '**/data/**',
          '**/.genesis-history.json',
          '**/genesis-history.json',
          '**/.velbaz-settings/**',
          '**/.velbaz-apps/**',
          '**/generated/**',
          '**/*.jsonl',
          '**/*.log',
          '**/*.sqlite',
          '**/*.db',
          '**/public/uploads/**',
          '**/public/generated/**',
          // Assets écrits par l'IA pendant un run (labo test1, build de sites)
          // et sorties de build : rien de tout ça n'a besoin d'être surveillé.
          '**/skill_test1/**',
          '**/dist/**',
        ],
      },
      cors: false,
    },
  };
});
