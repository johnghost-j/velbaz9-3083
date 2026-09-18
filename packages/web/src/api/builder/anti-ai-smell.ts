// ─── Détection & correction de la « signature IA » ───────────────────────────
// Un site peut être 100% fonctionnel (qa.ts) et 100% dense (analyzeDensity) et
// TOUT DE MÊME se faire reconnaître en 2 secondes comme « fait par une IA ».
// Ce qui trahit n'est ni un bug ni un manque de contenu: c'est un ensemble de
// CLICHÉS VISUELS ET RÉDACTIONNELS que tous les générateurs produisent.
//
// Constats mesurés sur de vraies pages générées par ce pipeline:
//   - accent violet/indigo (#7C3AED, #6366F1, #8B5CF6) + cyan en dégradé,
//   - titre de héro en `bg-clip-text text-transparent` dégradé,
//   - icône `Sparkles` en décoration,
//   - badge pilule « MAJUSCULES tracking-widest » au-dessus du H1,
//   - halo coloré `box-shadow: 0 0 80px rgba(accent)`,
//   - toutes les sections centrées, même `py-24`, même grille 3 cartes,
//   - CTA final « Prêt à … ? », titres « Nos modèles / Pourquoi nous choisir »,
//   - preuves sociales inventées (« 10 000+ clients », « 4,9/5 »).
//
// Aucun de ces éléments n'est un défaut en soi. C'est leur ACCUMULATION
// systématique qui produit le « look IA ». Ce module:
//   1. bloque la palette-signature EN AMONT (deAiPalette) — déterministe,
//   2. mesure la signature dans le code généré (analyzeAiSmell),
//   3. produit une instruction de correction ciblée (buildAntiAiSmellInstruction),
//   4. fournit le bloc de règles injecté dans les prompts (AI_SMELL_RULES).

import { generateText } from "ai";
import { gateway } from "../agent/gateway";
import { applySearchReplace } from "./qa";

const DEAI_MODEL = "anthropic/claude-sonnet-4.6";

// ─── Utilitaires couleur ─────────────────────────────────────────────────────

export interface Hsl { h: number; s: number; l: number }

/** #RGB / #RRGGBB → HSL (h 0-360, s/l 0-100). null si ce n'est pas un hex. */
export function hexToHsl(hex: string | undefined | null): Hsl | null {
  if (!hex || typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Teinte violette/indigo saturée — l'accent par défaut de tous les générateurs. */
function isAiViolet(hex?: string): boolean {
  const c = hexToHsl(hex);
  return !!c && c.h >= 238 && c.h <= 295 && c.s >= 38 && c.l >= 32 && c.l <= 78;
}

/** Cyan/turquoise saturé — l'autre moitié du dégradé-signature. */
function isAiCyan(hex?: string): boolean {
  const c = hexToHsl(hex);
  return !!c && c.h >= 165 && c.h <= 205 && c.s >= 45 && c.l >= 32 && c.l <= 78;
}

/** Vrai si le fond est sombre (pour remplacer une palette par une de même tonalité). */
export function isDarkBackground(hex?: string): boolean {
  const c = hexToHsl(hex);
  return !!c && c.l <= 30;
}

// ─── 1) Garde-fou palette (déterministe, avant toute génération de page) ─────

export interface PaletteVerdict { hit: boolean; reasons: string[] }

/**
 * Détecte la palette-signature IA. On ne juge QUE primary/accent: ce sont eux
 * qui colorent les CTA, les badges et les dégradés, donc eux qui trahissent.
 */
export function isAiSignaturePalette(colors: Record<string, string> | undefined): PaletteVerdict {
  const reasons: string[] = [];
  if (!colors) return { hit: false, reasons };
  const { primary, accent } = colors;
  const violet = [primary, accent].filter(isAiViolet);
  const cyan = [primary, accent].filter(isAiCyan);
  if (violet.length && cyan.length) {
    reasons.push(`dégradé violet→cyan (${violet[0]} + ${cyan[0]}) — la signature visuelle n°1 des sites générés`);
  } else if (isAiViolet(accent)) {
    reasons.push(`accent violet/indigo (${accent}) — couleur par défaut de tous les générateurs`);
  } else if (isAiViolet(primary)) {
    reasons.push(`couleur primaire violet/indigo (${primary}) — couleur par défaut de tous les générateurs`);
  }
  return { hit: reasons.length > 0, reasons };
}

export interface HumanPalette {
  name: string;
  tone: "light" | "dark";
  /** Mots-clés de secteur pour lesquels cette palette est particulièrement juste. */
  sectors: string[];
  colors: {
    primary: string; accent: string; background: string; surface: string;
    text: string; muted: string; border: string;
  };
}

/**
 * Palettes de remplacement. Aucune n'utilise de violet ni de cyan saturé: ce
 * sont des accords empruntés au monde réel (encre & papier, terre cuite, vert
 * forêt, bordeaux, or, olive) — exactement ce qu'un directeur artistique
 * humain choisit, et ce qu'aucun générateur ne propose spontanément.
 */
export const HUMAN_PALETTES: HumanPalette[] = [
  {
    name: "Encre & Crème",
    tone: "light",
    sectors: ["conseil", "consulting", "avocat", "juridique", "finance", "audit", "presse", "édition", "b2b", "cabinet"],
    colors: { primary: "#17140F", accent: "#B4531F", background: "#FAF7F2", surface: "#FFFFFF", text: "#17140F", muted: "#6B6257", border: "#E5DED2" },
  },
  {
    name: "Vert Forêt",
    tone: "light",
    sectors: ["alimentaire", "bio", "santé", "nutrition", "agriculture", "écologie", "durable", "jardin", "pharmacie", "thérapie"],
    colors: { primary: "#14211A", accent: "#2F6B4F", background: "#F7F6F1", surface: "#FFFFFF", text: "#14211A", muted: "#5E6E64", border: "#DDE3DA" },
  },
  {
    name: "Bleu Archive",
    tone: "light",
    sectors: ["éducation", "école", "formation", "assurance", "administration", "public", "recherche", "université", "banque", "immobilier"],
    colors: { primary: "#10192B", accent: "#1F4E79", background: "#F5F6F8", surface: "#FFFFFF", text: "#10192B", muted: "#5B6779", border: "#DCE1E8" },
  },
  {
    name: "Rouge Atelier",
    tone: "light",
    sectors: ["commerce", "boutique", "sport", "automobile", "mode", "artisanat", "atelier", "vélo", "outillage", "bricolage"],
    colors: { primary: "#1A1413", accent: "#B3261E", background: "#FBF8F6", surface: "#FFFFFF", text: "#1A1413", muted: "#6D5F5B", border: "#E7DCD7" },
  },
  {
    name: "Ocre Studio",
    tone: "light",
    sectors: ["architecture", "design", "photo", "créatif", "hôtel", "voyage", "café", "restaurant", "décoration", "mariage"],
    colors: { primary: "#1C1A15", accent: "#C08A2E", background: "#FCFAF5", surface: "#FFFFFF", text: "#1C1A15", muted: "#6E685A", border: "#E6E0D2" },
  },
  {
    name: "Graphite & Braise",
    tone: "dark",
    sectors: ["tech", "développement", "logiciel", "saas", "devops", "api", "data", "ingénierie", "informatique", "ordinateur", "matériel"],
    colors: { primary: "#E9EDEF", accent: "#E8552D", background: "#0B0D0E", surface: "#14171A", text: "#E9EDEF", muted: "#8A949B", border: "#242A2E" },
  },
  {
    name: "Nuit Bordeaux",
    tone: "dark",
    sectors: ["luxe", "vin", "gastronomie", "restaurant", "événement", "spectacle", "bar", "traiteur", "joaillerie", "parfum"],
    colors: { primary: "#F2E8E6", accent: "#8C2F39", background: "#120C0E", surface: "#1C1315", text: "#F2E8E6", muted: "#9A8A8C", border: "#2A1F21" },
  },
  {
    name: "Marine & Or",
    tone: "dark",
    sectors: ["fintech", "investissement", "trading", "logistique", "maritime", "transport", "courtage", "patrimoine", "crypto", "comptabilité"],
    colors: { primary: "#E6EDF3", accent: "#C9A227", background: "#0A1018", surface: "#121A24", text: "#E6EDF3", muted: "#8494A3", border: "#1D2733" },
  },
  {
    name: "Olive Terrain",
    tone: "dark",
    sectors: ["outdoor", "randonnée", "sport", "industriel", "chantier", "sécurité", "militaire", "chasse", "pêche", "camping"],
    colors: { primary: "#E8EBE5", accent: "#7A8B2F", background: "#0F1210", surface: "#181C18", text: "#E8EBE5", muted: "#8B938A", border: "#232823" },
  },
  {
    name: "Ardoise & Rose Poudré",
    tone: "dark",
    sectors: ["beauté", "bien-être", "cosmétique", "spa", "média", "musique", "mode", "coiffure", "yoga", "podcast"],
    colors: { primary: "#F3ECEE", accent: "#D98C7A", background: "#131011", surface: "#1D1819", text: "#F3ECEE", muted: "#9B8E92", border: "#2A2224" },
  },
];

/** Hash stable (pas de Math.random: deux builds du même projet = même palette). */
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** L'utilisateur a-t-il EXPLICITEMENT demandé du violet/cyan ? Alors on n'y touche pas. */
export function userAskedForAiColors(text: string | undefined): boolean {
  if (!text) return false;
  return /\b(violet|violette|purple|mauve|indigo|lilas|lavande|pourpre|cyan|turquoise|aqua)\b/i.test(text);
}

export interface DeAiPaletteResult<T> {
  design: T;
  changed: boolean;
  reason: string;
  palette?: HumanPalette;
}

/**
 * Remplace une palette-signature IA par une palette « humaine » cohérente avec
 * le secteur, en conservant la TONALITÉ d'origine (un design sombre reste
 * sombre). Ne touche à rien si la palette est déjà singulière, ou si
 * l'utilisateur a demandé ces couleurs, ou en mode clone.
 */
export function deAiPalette<T extends { colors?: Record<string, string>; designNotes?: string }>(
  design: T,
  ctx: { companyName?: string; industry?: string; idea?: string; userRequest?: string } = {},
): DeAiPaletteResult<T> {
  const verdict = isAiSignaturePalette(design?.colors);
  if (!verdict.hit) return { design, changed: false, reason: "palette déjà singulière" };

  const explicit = `${ctx.idea || ""} ${ctx.userRequest || ""}`;
  if (userAskedForAiColors(explicit)) {
    return { design, changed: false, reason: "couleurs demandées explicitement par l'utilisateur" };
  }

  const tone: "light" | "dark" = isDarkBackground(design.colors?.background) ? "dark" : "light";
  const pool = HUMAN_PALETTES.filter((p) => p.tone === tone);
  const haystack = `${ctx.industry || ""} ${ctx.idea || ""} ${ctx.companyName || ""}`.toLowerCase();
  const matching = pool.filter((p) => p.sectors.some((s) => haystack.includes(s)));
  const candidates = matching.length ? matching : pool;
  const pick = candidates[stableHash(`${ctx.companyName || ""}|${ctx.idea || ""}`) % candidates.length];

  const next = {
    ...design,
    colors: { ...(design.colors || {}), ...pick.colors },
    designNotes: `${design.designNotes || ""}\nPalette « ${pick.name} » (${pick.tone === "dark" ? "sombre" : "claire"}): accent ${pick.colors.accent} utilisé avec parcimonie (CTA principal, focus, 1 détail par section). Aucun dégradé violet→cyan, aucun texte en dégradé.`.trim(),
  } as T;

  return { design: next, changed: true, reason: verdict.reasons.join(" ; "), palette: pick };
}

// ─── 2) Détection de la signature IA dans le code généré ────────────────────

export interface AiSmellIssue {
  severity: "high" | "medium" | "low";
  code: string;
  message: string;
  count: number;
}

export interface AiSmellReport {
  file: string;
  /** 0-100, 100 = aucune signature IA détectée. */
  score: number;
  issues: AiSmellIssue[];
  /** Vrai si la page doit passer par une correction anti-signature. */
  smelly: boolean;
}

function stripComments(code: string): string {
  return code.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Textes visibles dans le JSX (>texte<) + chaînes de titres. */
// Le texte que le visiteur lit vraiment. Le JSX généré est formaté par
// prettier: le contenu est presque toujours sur SA propre ligne, entre un `>`
// en fin de ligne et un `</` en début de ligne suivante. Il faut donc accepter
// les retours à la ligne, sinon on ne voit aucun titre de la page.
function visibleText(code: string): string {
  const nodes = Array.from(code.matchAll(/>([^<>{}]{3,})</g), (m) => m[1].replace(/\s+/g, " ").trim());

  // Le texte vit aussi dans les littéraux (tableaux de contenu, labels, props).
  // On écarte ce qui est manifestement une liste de classes Tailwind.
  const looksLikeClasses = /(?:^|\s)(?:flex|grid|block|inline|hidden|relative|absolute|text-|bg-|px-|py-|pt-|pb-|mx-|my-|mt-|mb-|w-|h-|max-|min-|rounded|border|shadow|gap-|space-|hover:|focus:|md:|lg:|sm:|transition|duration|font-|leading-|tracking-|z-|overflow|items-|justify-)/;
  const literals = Array.from(code.matchAll(/["'`]([^"'`\n]{6,200})["'`]/g), (m) => m[1].trim()).filter(
    (s) => /\s/.test(s) && /[A-Za-zÀ-ÿ]{3,}/.test(s) && !looksLikeClasses.test(s) && !s.includes("//"),
  );

  return [...nodes, ...literals].filter((t) => t.length >= 3).join("\n");
}

export function analyzeAiSmell(
  file: string,
  code: string,
  ctx: { paletteHexes?: string[]; isHome?: boolean } = {},
): AiSmellReport {
  const issues: AiSmellIssue[] = [];
  const src = stripComments(code);
  const text = visibleText(code);
  const add = (severity: AiSmellIssue["severity"], c: string, message: string, count: number) => {
    if (count > 0) issues.push({ severity, code: c, message, count });
  };

  // Les couleurs du design system du projet sont LÉGITIMES (une marque peut
  // être violette si c'est un choix assumé). On ne pénalise que le violet/cyan
  // introduit par la page EN DEHORS de la palette validée.
  const allowed = new Set((ctx.paletteHexes || []).map((h) => h.toLowerCase().replace(/^#/, "")));

  // 1) Palette-signature introduite en dur dans la page.
  {
    const hexes = Array.from(src.matchAll(/#([0-9a-fA-F]{6})\b/g), (m) => m[1].toLowerCase());
    const offenders = hexes.filter((h) => !allowed.has(h) && (isAiViolet(`#${h}`) || isAiCyan(`#${h}`)));
    const uniq = Array.from(new Set(offenders));
    if (uniq.length >= 2) {
      add("high", "AI_PALETTE", `Couleurs violet/indigo/cyan codées en dur hors palette (${uniq.slice(0, 3).map((h) => "#" + h).join(", ")}) — c'est LA couleur que tout le monde reconnaît comme « générée ». Utilise exclusivement les tokens du design system.`, uniq.length);
    }
    const tw = (src.match(/\b(?:bg|text|from|via|to|border|ring|shadow)-(?:violet|purple|indigo|fuchsia)-\d{3}\b/g) || []).length;
    add("medium", "AI_PALETTE", "Classes Tailwind violet/purple/indigo/fuchsia — remplace par les couleurs du design system.", tw);
  }

  // 2) Titre en dégradé clippé: le cliché n°1 des héros générés.
  {
    const gradText = (src.match(/bg-clip-text/g) || []).length
      + (src.match(/backgroundClip\s*:\s*["'`]text["'`]/g) || []).length;
    add("high", "GRADIENT_TEXT", "Titre en dégradé (`bg-clip-text text-transparent`) — signature immédiate d'un site généré. Un vrai studio écrit le titre en UNE couleur d'encre pleine ; le dégradé va dans le fond, jamais dans la typo.", gradText);
  }

  // 3) Icônes « magie » en décoration.
  {
    const decor = (src.match(/<\s*(?:Sparkles|Sparkle|Wand2|WandSparkles|Rocket|Zap)\b/g) || []).length;
    add("high", "AI_ICON", "Icônes Sparkles/Wand/Rocket/Zap en décoration — le cliché « propulsé par l'IA ». Utilise une icône qui DÉCRIT la chose (outil, produit, secteur), ou pas d'icône du tout.", decor);
  }

  // 4) Badge pilule en majuscules au-dessus du titre (l'« eyebrow » générique).
  {
    // Les classes Tailwind arrivent dans un ordre arbitraire: on teste la
    // PRÉSENCE des trois marqueurs dans un même attribut, pas leur ordre.
    const classAttrs = Array.from(src.matchAll(/class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\})/g), (m) => m[1] || m[2] || "");
    const eyebrow = classAttrs.filter(
      (cls) => /\buppercase\b/.test(cls) && /\btracking-(?:wide|wider|widest|\[)/.test(cls) && /\brounded-full\b/.test(cls),
    ).length;
    add("medium", "AI_EYEBROW", "Badge pilule « MAJUSCULES espacées » posé au-dessus du titre — présent sur 9 pages générées sur 10. Supprime-le, ou remplace-le par une information réelle et datée (« Livraison sous 48 h », « Ouvert depuis 2019 »).", eyebrow);
  }

  // 5) Halo coloré derrière les blocs.
  {
    const glow = (src.match(/box-?[Ss]hadow[^;}]{0,24}?0\s+0\s+\d{2,}px\s+rgba?\(/g) || []).length
      + (src.match(/shadow-\[0_0_\d{2,}px_/g) || []).length;
    add("medium", "AI_GLOW", "Halo coloré (`0 0 80px rgba(accent)`) autour des images/cartes — effet « néon IA ». En sombre, la profondeur vient d'une bordure translucide fine ; en clair, d'une ombre douce et DÉCALÉE vers le bas (0 8px 24px rgba(0,0,0,.06)).", glow);
  }

  // 6) Mise en page entièrement symétrique: tout centré, même rythme partout.
  {
    const sections = (src.match(/<section\b/g) || []).length;
    const centered = (src.match(/\btext-center\b/g) || []).length;
    if (sections >= 3 && centered >= sections) {
      add("medium", "AI_SYMMETRY", `${centered} blocs centrés pour ${sections} sections — tout est centré, donc rien n'a de hiérarchie. Un vrai site alterne: au moins 2 sections en composition ASYMÉTRIQUE (texte à gauche / visuel à droite, titre aligné à gauche sur une grille 12 colonnes).`, 1);
    }
    // Le rythme se mesure sur le padding des SECTIONS uniquement. Compter tous
    // les `py-*` mélangerait le padding des boutons et des badges au calcul.
    const sectionTags = src.match(/<section\b[^>]*>/g) || [];
    const pads = sectionTags
      .map((tag) => (tag.match(/\bpy-(\d{1,2})\b/) || [])[1])
      .filter((p): p is string => Boolean(p));
    const counts = new Map<string, number>();
    for (const p of pads) counts.set(p, (counts.get(p) || 0) + 1);
    const dominant = Array.from(counts.values()).sort((a, b) => b - a)[0] || 0;
    if (sections >= 4 && dominant >= 4 && counts.size <= 2) {
      add("low", "AI_RHYTHM", "Toutes les sections ont le même padding vertical — le scroll n'a aucun rythme. Fais varier (une section dense et serrée, une respirante, une pleine largeur).", 1);
    }
  }

  // 7) Copie générique. Ce sont des formules réellement produites en boucle par
  //    les générateurs, en FR et en EN.
  {
    const cliches: Array<[RegExp, string]> = [
      [/\bPr[êe]ts?\s+à\s+\w+/i, "« Prêt à … ? » en titre de CTA"],
      [/\bReady\s+to\s+\w+/i, "« Ready to … ? » en titre de CTA"],
      [/\bBienvenue\s+(?:sur|chez|dans)\b/i, "« Bienvenue sur … »"],
      [/\bPourquoi\s+(?:nous\s+)?(?:choisir|chosir)\b/i, "« Pourquoi nous choisir »"],
      [/\bNos\s+services\b/i, "« Nos services » (titre sans information)"],
      [/\bRejoignez\s+(?:les\s+|des\s+)?(?:milliers|centaines|plus\s+de)\b/i, "« Rejoignez des milliers de … »"],
      [/\bCommencez\s+(?:d[èe]s\s+)?(?:aujourd'hui|maintenant)\b/i, "« Commencez dès aujourd'hui »"],
      [/\bTransformez\s+(?:votre|vos)\b/i, "« Transformez votre … »"],
      [/\b(?:Lib[ée]rez|D[ée]bloquez|Exploitez)\s+(?:tout\s+)?(?:le\s+)?potentiel\b/i, "« Libérez le potentiel »"],
      [/\br[ée]volutionn(?:e|er|aire)\b/i, "« révolutionne / révolutionnaire »"],
      [/\bpasse[rz]?\s+au\s+niveau\s+sup[ée]rieur\b/i, "« passez au niveau supérieur »"],
      [/\ben\s+toute\s+simplicit[ée]\b/i, "« en toute simplicité »"],
      [/\bsans\s+effort\b/i, "« sans effort »"],
      [/\b[ÉE]levez\s+(?:votre|vos)\b/i, "« Élevez votre … »"],
      [/\bl'avenir\s+(?:de|du|des)\b/i, "« L'avenir de … »"],
      [/\b(?:seamless|effortless|game.?chang|supercharge|unlock\s+the\s+power|elevate\s+your)\b/i, "formule marketing anglaise générique"],
      [/\bsolution\s+(?:tout-en-un|compl[èe]te|innovante|ultime)\b/i, "« solution tout-en-un / innovante »"],
      [/\bcon[çc]u\s+pour\s+(?:vous|les\s+pros)\b\s*[.!]/i, "« conçu pour vous »"],
    ];
    const found = cliches.filter(([re]) => re.test(text)).map(([, label]) => label);
    if (found.length) {
      add("high", "AI_COPY", `Formules génériques repérées: ${found.slice(0, 5).join(" · ")}. Remplace chacune par une phrase que SEULE cette entreprise pourrait écrire (ce qu'elle fait, pour qui, avec quelle contrainte réelle, à quel prix, dans quel délai).`, found.length);
    }
  }

  // 8) Preuve sociale inventée. Un chiffre faux est le pire signal de tous:
  //    il rend le site non crédible ET juridiquement risqué.
  {
    const fakeStats = (text.match(/\b\d[\d\s.,]{1,8}\s*(?:\+|k\b|K\b)\s*(?:clients?|utilisateurs?|users?|entreprises?|membres?|t[ée]l[ée]chargements?)/gi) || []).length
      + (text.match(/\b(?:9\d|100)\s?%\s*(?:de\s+)?(?:satisfaction|clients?\s+satisfaits?|réussite)/gi) || []).length
      + (text.match(/\b[45][.,]\d\s*\/\s*5\b/g) || []).length
      + (text.match(/★{3,}|⭐{3,}/g) || []).length;
    add("high", "FAKE_PROOF", "Chiffres / notes / avis inventés (« 10 000+ clients », « 98 % de satisfaction », « 4,9/5 », rangées d'étoiles). Supprime-les tant qu'ils ne sont pas réels: remplace par du concret vérifiable (ce qui est inclus, le délai, la garantie, la zone desservie, une FAQ).", fakeStats);
  }

  // 9) Emoji utilisés comme éléments d'interface.
  {
    const emojiInUi = (text.match(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu) || []).length;
    if (emojiInUi >= 3) {
      add("medium", "AI_EMOJI", `${emojiInUi} emoji dans l'interface — aucun site professionnel n'utilise des emoji comme icônes. Utilise lucide-react.`, 1);
    }
  }

  // 10) Micro-interactions par défaut, appliquées partout sans discernement.
  {
    const scale = (src.match(/hover:scale-1\d{2}\b/g) || []).length;
    if (scale >= 3) add("low", "AI_HOVER", `hover:scale-… sur ${scale} éléments — le survol par défaut. Garde-le sur les VISUELS (zoom d'image), et sur le reste passe à un changement de fond/bordure d'une seule nuance.`, 1);
    const pills = (src.match(/\brounded-full\b/g) || []).length;
    if (pills >= 6) add("low", "AI_PILLS", `Tout est en pilule (${pills} \`rounded-full\`) — choisis UN rayon de marque (généralement 6-12 px) et réserve la pilule à un seul usage (badge OU CTA, pas les deux).`, 1);
  }

  // Score: 100 - pénalités pondérées (plafonnées par famille de défaut).
  let penalty = 0;
  for (const i of issues) {
    const w = i.severity === "high" ? 18 : i.severity === "medium" ? 9 : 4;
    penalty += w * Math.min(i.count, 2);
  }
  const score = Math.max(0, 100 - penalty);
  return { file, score, issues, smelly: score < 70 };
}

// ─── 3) Instruction de correction ciblée ─────────────────────────────────────

export function buildAntiAiSmellInstruction(report: AiSmellReport): string {
  const lines = report.issues
    .slice()
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : b.severity === "high" ? 1 : a.severity === "medium" ? -1 : 1))
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.message}`);
  return `Cette page est fonctionnelle, mais elle PORTE LA SIGNATURE VISUELLE D'UN SITE GÉNÉRÉ (score de singularité ${report.score}/100). Un visiteur devine en 2 secondes qu'aucun designer n'est passé dessus. À corriger:
${lines.join("\n")}

Objectif: que la page ressemble au travail d'un studio qui a été PAYÉ pour ce client précis.
- Le texte doit être invérifiable par personne d'autre que cette entreprise: son métier, sa ville, sa contrainte, son délai, son prix, son process. Zéro superlatif, zéro promesse abstraite.
- Une seule couleur d'accent, issue du design system, utilisée 2-3 fois par page maximum. Le reste = encre, fond, surface, bordure.
- Les titres sont en encre pleine. Le dégradé, s'il existe, est dans le FOND, très flou, très peu opaque.
- Au moins deux sections en composition asymétrique (ex: texte 5 colonnes / visuel 7 colonnes), pas uniquement des grilles centrées à 3 cartes.
- Aucune statistique, note, avis ou logo client qui n'aurait pas été fourni. À la place: contenu concret (ce qui est inclus, comment ça se passe, FAQ, tarifs, zone d'intervention).
- Tu ne CASSES RIEN: même structure de routes, mêmes appels data.*/api/IA, mêmes états (chargement/vide/erreur), même langue, même design system. Tu changes la COULEUR, la TYPO, la COMPOSITION et le TEXTE, pas le câblage.`;
}

/**
 * Corrige la signature IA en DIFFS CIBLÉS (SEARCH/REPLACE) plutôt qu'en
 * réécrivant la page: ~70 % de tokens de sortie en moins, et le câblage
 * fonctionnel déjà validé par la QA n'est pas remis en jeu.
 */
export async function deAiPage(
  originalPrompt: string,
  currentCode: string,
  report: AiSmellReport,
  system: string,
): Promise<string> {
  const prompt = `## CONTEXTE (résumé)
${originalPrompt.slice(0, 3000)}

## ⚠️ CORRECTION — LA PAGE « SENT L'IA »
${buildAntiAiSmellInstruction(report)}

## CODE ACTUEL
\`\`\`tsx
${currentCode}
\`\`\`

## FORMAT DE RÉPONSE — DIFFS CIBLÉS UNIQUEMENT
Ne réécris PAS toute la page. Renvoie UNIQUEMENT des blocs de remplacement ciblés, un par défaut:

<<<<<<< SEARCH
(extrait EXACT du code actuel, copié caractère pour caractère, assez long pour être unique)
=======
(le remplacement corrigé)
>>>>>>> REPLACE

Règles:
- Le texte SEARCH doit exister TEL QUEL dans le code actuel (copie exacte, indentation incluse).
- Un bloc par défaut corrigé. Ne touche à rien d'autre (pas de reformatage, pas de renommage).
- N'enlève aucun import réellement utilisé, ne supprime aucun appel data.*/api/aiChat/checkout.
- FONDS: réutilise EXACTEMENT les classes de fond déjà présentes dans la page. N'introduis AUCUN nouveau fond codé en dur (\`bg-[#0…]\`, \`bg-neutral-900\`…) et ne mélange jamais fonds clairs et fonds sombres en dur: c'est un bug de thème (header clair sur page sombre), et ça se détecte automatiquement. Pour différencier une section, joue sur la bordure, l'espacement ou la composition, pas sur une nouvelle couleur.
- Aucune explication hors des blocs.`;
  try {
    const { text } = await generateText({
      model: gateway(DEAI_MODEL),
      system,
      prompt,
      maxOutputTokens: 10000,
    });
    const { code, applied } = applySearchReplace(currentCode, text || "");
    return applied > 0 ? code : currentCode;
  } catch {
    return currentCode;
  }
}

// ─── 3bis) Nettoyage MÉCANIQUE des couleurs-signature ───────────────────────
// Mesuré sur une vraie page: la passe IA corrige le dégradé, les icônes, le
// badge, le halo, la symétrie… mais laisse presque toujours traîner deux ou
// trois `#7C3AED` / `violet-500` oubliés. Or ce remplacement-là est purement
// mécanique: il n'a pas besoin d'un modèle, et le faire à la main est à la fois
// gratuit et fiable à 100%. On s'en sert avant ET après la passe IA.
const AI_TW_FAMILIES = "violet|purple|indigo|fuchsia|cyan";

export function stripAiColors(
  code: string,
  palette: { accent?: string; primary?: string; muted?: string; border?: string } = {},
): { code: string; replaced: number } {
  const accent = palette.accent || palette.primary;
  if (!accent || !/^#[0-9a-fA-F]{6}$/.test(accent)) return { code, replaced: 0 };
  // Si la marque elle-même est violette/cyan (utilisateur qui l'a demandé
  // explicitement, cf. userAskedForAiColors), alors le violet de la page n'est
  // pas une signature à corriger: on ne touche à rien, sous peine d'écraser
  // toute la nuancier de la marque sur une seule teinte.
  if (isAiViolet(accent) || isAiCyan(accent)) return { code, replaced: 0 };

  const allowed = new Set(
    Object.values(palette)
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toLowerCase()),
  );
  let replaced = 0;

  // a) Hex violet/cyan codés en dur qui ne font PAS partie de la palette.
  let out = code.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => {
    if (allowed.has(hex.toLowerCase())) return hex;
    if (!isAiViolet(hex) && !isAiCyan(hex)) return hex;
    replaced++;
    return accent;
  });

  // b) Classes Tailwind de la famille violet/cyan → couleur de marque en
  //    classe arbitraire, en conservant l'opacité (`/30`) et l'utilitaire.
  out = out.replace(
    new RegExp(`\\b(text|bg|border|ring|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret)-(?:${AI_TW_FAMILIES})-\\d{2,3}(\\/\\d{1,3})?\\b`, "g"),
    (_m, util: string, opacity?: string) => {
      replaced++;
      return `${util}-[${accent}]${opacity || ""}`;
    },
  );

  // c) `rgba(124,58,237,…)` et compagnie dans les styles inline.
  out = out.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,[^)]*)?\)/g, (m, r, g, b, a) => {
    const hex = `#${[r, g, b].map((v: string) => Number(v).toString(16).padStart(2, "0")).join("")}`;
    if (allowed.has(hex.toLowerCase())) return m;
    if (!isAiViolet(hex) && !isAiCyan(hex)) return m;
    replaced++;
    const [ar, ag, ab] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    return `rgba(${ar}, ${ag}, ${ab}${a || ""})`;
  });

  return { code: out, replaced };
}

// ─── 4) Bloc de règles injecté dans les prompts de génération ────────────────
// Préventif: mieux vaut ne jamais produire la signature que la corriger après.

export const AI_SMELL_RULES = `## 🚫 SIGNATURE IA — INTERDITE (c'est à ça qu'on reconnaît un site généré)

Un site « fait par une IA » ne se reconnaît pas à ses bugs, mais à une liste de tics visuels que tous les générateurs produisent. Ils sont INTERDITS ici, sauf demande explicite de l'utilisateur:
- ❌ Accent violet / indigo / mauve, et surtout le dégradé violet→cyan. Tu utilises la palette du design system, point. Aucune couleur inventée en dur dans la page.
- ❌ Titre en dégradé (\`bg-clip-text text-transparent\`). Les titres sont en encre PLEINE. Le dégradé vit dans le fond (très flou, faible opacité), jamais dans la typographie.
- ❌ Icônes Sparkles / Wand / Rocket / Zap en décoration ("propulsé par l'IA"). Une icône DÉCRIT une chose réelle (outil, livraison, atelier, agenda) ou n'existe pas.
- ❌ Badge pilule « MAJUSCULES ESPACÉES » au-dessus du H1. Si tu poses un élément là, ce doit être une information vraie et concrète ("Ouvert depuis 2014", "Livré en 48 h à Bruxelles").
- ❌ Halos colorés (\`0 0 80px rgba(accent)\`) autour des cartes/images. En sombre: bordure translucide fine. En clair: ombre douce décalée vers le bas.
- ❌ Emoji comme icônes d'interface.
- ❌ Tout centré partout. Au moins 2 sections en composition ASYMÉTRIQUE (texte 5 col. / visuel 7 col., titre aligné à gauche).
- ❌ Le même padding vertical sur toutes les sections. Fais respirer différemment: une section dense, une aérée, une pleine largeur.
- ❌ \`rounded-full\` sur tout. UN rayon de marque, la pilule réservée à un seul usage.
- ❌ \`hover:scale-…\` partout. Réserve le zoom aux images ; ailleurs, une nuance de fond/bordure.

**TEXTE — le tell le plus fort, avant même le visuel.** Bannis: « Prêt à … ? », « Bienvenue sur … », « Pourquoi nous choisir », « Nos services », « Rejoignez des milliers de … », « Commencez dès aujourd'hui », « Transformez votre … », « Libérez le potentiel », « révolutionnaire », « solution tout-en-un », « en toute simplicité », « sans effort », « L'avenir de … », « seamless / game-changer / supercharge ».
Règle de remplacement: **chaque phrase doit être impossible à recopier sur le site d'un concurrent.** Elle nomme le métier, la ville/zone, le délai, le prix, le matériau, le process, la contrainte réelle. Un titre de section décrit ce que contient la section ("Ce que comprend l'installation", "Délais par type de pièce"), il ne se vend pas.

**CHIFFRES — jamais inventés.** Aucune statistique, note /5, rangée d'étoiles, nombre de clients, pourcentage de satisfaction ni logo client, tant que l'utilisateur ne les a pas fournis. À leur place, du contenu concret qui, lui, convainc vraiment: ce qui est inclus / exclu, le déroulé étape par étape, les tarifs, les délais, la garantie, la zone desservie, une vraie FAQ.

**SIGNATURE ASSUMÉE.** Prends UNE décision de design que l'on reconnaîtra sur toutes les pages de ce site et sur aucun autre: une typographie de titre inhabituelle, un fond teinté au lieu du blanc, un filet de séparation, une grille éditoriale, un traitement d'image constant. Une seule, tenue partout — c'est ce qui fait « fait par un studio » plutôt que « sorti d'un générateur ».`;
