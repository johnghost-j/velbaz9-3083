import io

p = '/home/user/velbaz/packages/web/src/api/agents/orchestrator.ts'
s = io.open(p, encoding='utf-8').read()

# 1) frontières de mot manquantes → faux positifs coûteux (2 appels LLM ≈ 1,6 s)
fixes = [
    ("'nu(e|es|s)\\\\b'", "'\\\\bnu(e|es|s)\\\\b'"),
    ("'strip\\\\w*'", "'\\\\bstrip(?!e)\\\\w*'"),
    ("'meth\\\\w*'", "'\\\\bmeth(?!od)\\\\w*'"),
    ("'ados?\\\\b'", "'\\\\bados?\\\\b'"),
    ("'intim\\\\w*'", "'\\\\bintim\\\\w*'"),
    ("'scam\\\\w*'", "'\\\\bscam\\\\w*'"),
    ("'hack\\\\w*'", "'\\\\bhack\\\\w*'"),
    ("'crack\\\\w*'", "'\\\\bcrack\\\\w*'"),
    ("'pirat\\\\w*'", "'\\\\bpirat\\\\w*'"),
    ("'cannabis'", "'\\\\bcannabis\\\\b'"),
]
for old, new in fixes:
    assert s.count(old) == 1, (old, s.count(old))
    s = s.replace(old, new)

# commentaire de mesure au-dessus du pré-filtre
anchor = "const MODERATION_SUSPICION_RE = new RegExp("
assert s.count(anchor) == 1
note = """// [2026-09-16] MESURÉ : plusieurs motifs n'avaient pas de frontière de mot à
// gauche, donc « reveNUS », « meNUS », « contiNUE », « STRIPe », « METHod »
// déclenchaient le classifieur IA de modération — 2 appels LLM, ~1,6 s d'attente
// avant le premier mot, sur des messages parfaitement banals. D'où les `\\b` et
// les exclusions ci-dessous.
"""
s = s.replace(anchor, note + anchor)

io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
