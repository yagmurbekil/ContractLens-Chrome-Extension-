/**
 * Test-harness bridge. Injected by the harness into a same-origin fixture
 * iframe so that the REAL extraction code and the REAL Page Agent
 * PageController run inside the fixture's own window/document — exactly as
 * the content script does inside a tab. Not shipped in the extension.
 */
import { inspectPage } from '../agent/pageAgent';
import { extractDocument } from '../lib/extract';

declare global {
  interface Window {
    __clAgent?: {
      extract: () => ReturnType<typeof extractDocument>;
      inspect: typeof inspectPage;
    };
  }
}

window.__clAgent = {
  extract: () => extractDocument(document, { url: location.href }),
  inspect: inspectPage,
};
