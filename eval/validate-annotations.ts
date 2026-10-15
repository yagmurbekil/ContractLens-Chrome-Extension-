/** Fails if any ground-truth anchor does not occur verbatim in the extracted page text. */
import { anchorRanges, loadAnnotation, loadEvalDoc, manifest } from './lib';

let bad = 0;
for (const d of manifest.documents) {
  const { doc } = loadEvalDoc(d);
  const a = loadAnnotation(d.id);
  for (const it of [...a.items, ...a.ambiguous]) {
    for (const anc of it.anchors) {
      if (anchorRanges(doc.text, anc).length === 0) {
        bad++;
        console.log(`MISSING ${d.id} ${it.id}: ${anc.slice(0, 90)}`);
      }
    }
  }
  console.log(`${d.id}: ${doc.stats.chars} chars, ${a.items.length} items, ${a.ambiguous.length} ambiguous`);
}
if (bad) { console.log(`${bad} anchors missing`); process.exit(1); }
console.log('all anchors found');
