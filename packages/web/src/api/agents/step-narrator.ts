// ─────────────────────────────────────────────────────────────────────────────
// Narration entre les étapes de travail de l'IA
// ─────────────────────────────────────────────────────────────────────────────
// Problème résolu : pendant qu'elle travaille, l'IA n'affichait qu'une liste
// sèche d'étapes (« Compréhension de la demande », « Analyse du contexte »…).
// L'utilisateur ne savait jamais où en était le travail : une étape venait-elle
// de se terminer ? laquelle commence ? Il attendait devant un écran muet.
//
// Ce module habille CHAQUE changement d'étape d'une phrase de transition
// explicite : « J'ai terminé X — je passe maintenant à Y. » Elle part dans le
// même événement SSE `progress` (champ `note`), donc :
//   • aucun appel IA supplémentaire → zéro latence ajoutée (c'est déterministe),
//   • la phrase arrive AVANT que l'étape suivante ne commence réellement.
//
// Les formulations tournent pour éviter l'effet robot quand une réponse
// enchaîne 5–6 étapes.

export interface NarratedStep {
  id: string;
  label: string;
  /** Phrase de transition « j'ai fini X, je passe à Y » (générée ici). */
  note?: string;
  preview?: any;
  [k: string]: any;
}

/** Nettoie un libellé d'étape pour l'insérer dans une phrase. */
function clean(label: string): string {
  return String(label || '')
    // les libellés portent parfois un emoji de statut en préfixe
    .replace(/^[\p{Extended_Pictographic}\p{So}️\s]+/u, '')
    .replace(/\s*[.…]+\s*$/, '')
    .trim();
}

// Transitions « j'ai fini A → je commence B ».
// Les libellés d'étapes sont des groupes nominaux de genre variable
// (« l'analyse », « la rédaction », « Compréhension »…) : les formulations
// utilisent donc un deux-points ou un tiret plutôt qu'un article, pour rester
// grammaticalement correctes quel que soit le libellé.
const TRANSITIONS_FR = [
  (a: string, b: string) => `✅ J'ai terminé : ${a}. Je passe à l'étape suivante — ${b}.`,
  (a: string, b: string) => `✅ ${a} : c'est fait. J'enchaîne — ${b}.`,
  (a: string, b: string) => `✅ Étape terminée : ${a}. Je démarre maintenant — ${b}.`,
  (a: string, b: string) => `✅ ${a} : bouclé. Prochaine étape — ${b}.`,
];

// Première étape : on annonce qu'on s'y met TOUT DE SUITE (l'utilisateur voit
// une phrase dès la première seconde, plus jamais de silence au démarrage).
const OPENINGS_FR = [
  (b: string) => `Je m'y mets tout de suite — ${b}.`,
  (b: string) => `C'est parti — première étape : ${b}.`,
];

/** Dernière étape terminée, juste avant la réponse finale. */
export function narrateFinish(lastLabel: string): string {
  const a = clean(lastLabel);
  return a ? `✅ J'ai terminé : ${a}. Je te rédige la réponse.` : '';
}

/**
 * Enveloppe un émetteur de progression pour qu'il raconte les transitions.
 *
 * ```ts
 * const narrate = createStepNarrator((step) => send({ progress: step }));
 * narrate({ id: 'understand', label: 'Compréhension de la demande' });
 * ```
 */
export function createStepNarrator(
  emit: (step: NarratedStep) => void,
): ((step: NarratedStep) => void) & { finish: () => void } {
  let prevLabel = '';
  let n = 0;
  let finished = false;

  const narrate = (step: NarratedStep) => {
    const label = clean(step.label);
    // Une étape répétée (même libellé) ne mérite aucune narration.
    if (label && label === prevLabel) { emit(step); return; }

    let note = step.note;
    if (!note && label) {
      note = prevLabel
        ? TRANSITIONS_FR[n % TRANSITIONS_FR.length]!(prevLabel, label)
        : OPENINGS_FR[n % OPENINGS_FR.length]!(label);
      n++;
    }
    if (label) prevLabel = label;
    emit({ ...step, note });
  };

  narrate.finish = () => {
    if (finished || !prevLabel) return;
    finished = true;
    const note = narrateFinish(prevLabel);
    if (note) emit({ id: 'wrap-up', label: 'Rédaction de la réponse', note });
  };

  return narrate;
}
