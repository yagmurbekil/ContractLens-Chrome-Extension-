/**
 * Backend transport states (mode=backend). Network responses are stubbed with
 * cy.intercept so these tests are deterministic and need no API key. They
 * exercise the client-side defences: response schema validation, quote
 * verification, deterministic scoring, and honest error states.
 */
const health = { ok: true, mode: 'llm', provider: 'groq', model: 'llama-3.3-70b-versatile', agentProxy: false, warnings: [] };

function llmOutput(findings: unknown[], extra: Record<string, unknown> = {}) {
  return {
    documentType: 'privacy_policy', overallRiskScore: 0, riskLevel: 'low',
    summaryTr: 'Belgede dikkat edilmesi gereken maddeler bulunmaktadır.', findings,
    limitationsTr: [], injectionSuspected: false, needsHumanReview: true, ...extra,
  };
}
const f = (quote: string, over: Record<string, unknown> = {}) => ({
  id: 'risk-001', category: 'data_sharing', concernType: 'privacy', severity: 'critical',
  titleTr: 'Kişisel verilerin satılması', originalQuote: quote,
  explanationTr: 'Bu madde, kişisel verilerinizin veri simsarlarına satılabileceğini belirtiyor.',
  potentialImpactTr: 'Verileriniz birçok şirkete ulaşabilir.', sourceSection: null,
  startOffset: null, endOffset: null, confidence: 0.9, uncertaintyTr: null, ...over,
});

describe('Backend states (stubbed network)', () => {
  beforeEach(() => cy.intercept('GET', '**/health', health).as('health'));

  it('LLM output with a fabricated quote is shown as unverified, never as a risk', () => {
    cy.intercept('POST', '**/v1/analyze', (req) => {
      req.reply({ mode: 'llm', provider: 'groq', model: 'm', results: req.body.chunks.map((c: { id: string }) => ({
        chunkId: c.id, ok: true, attempts: 1,
        output: llmOutput([f('ShopSphere guarantees it never sells any personal data to anyone.')], { overallRiskScore: 0 }),
      })) });
    });
    cy.openFixture('injection.html', 'backend');
    cy.analyze();
    cy.get('[data-testid=state-result]').should('have.attr', 'data-status', 'uncertain');
    cy.get('[data-testid=no-findings]').should('exist');
    cy.get('[data-testid=full-report-btn]').click();
    cy.get('[data-testid=unclear-section]').should('contain.text', 'Doğrulanamayan');
  });

  it('a genuine quote from the LLM is verified and scored by application code', () => {
    cy.intercept('POST', '**/v1/analyze', (req) => {
      req.reply({ mode: 'llm', provider: 'groq', model: 'm', results: req.body.chunks.map((c: { id: string }) => ({
        chunkId: c.id, ok: true, attempts: 1,
        output: llmOutput([f('We may sell your personal information to data brokers and other third parties who use it for their own marketing purposes.')], { overallRiskScore: 3, injectionSuspected: true }),
      })) });
    });
    cy.openFixture('injection.html', 'backend');
    cy.analyze();
    cy.get('[data-testid=evidence-verified]').should('exist');
    cy.get('[data-testid=risk-score]').invoke('text').then((t) => expect(parseInt(t, 10)).to.eq(38)); // 4 × 0.95 = 3.8 → 100(1 − e^(−3.8/8)) = 37.8 → 38 (model said 3)
  });

  it('malformed backend response → explicit failure state, no score', () => {
    cy.intercept('POST', '**/v1/analyze', { body: { hello: 'world' } });
    cy.openFixture('privacy-normal.html', 'backend');
    cy.analyze();
    cy.get('[data-testid=state-result]').should('have.attr', 'data-status', 'failed');
    cy.get('[data-testid=risk-score]').should('contain.text', '—');
  });

  it('network error → error state with demo fallback offered (not silently used)', () => {
    cy.intercept('POST', '**/v1/analyze', { forceNetworkError: true });
    cy.openFixture('privacy-normal.html', 'backend');
    cy.get('[data-testid=privacy-ack]').check();
    cy.get('[data-testid=analyze-btn]').click();
    cy.get('[data-testid=state-error-backend_unreachable]').should('be.visible').and('contain.text', 'Kural tabanlı modda çalıştır');
  });

  it('backend offline → analyze disabled, clearly labelled demo option', () => {
    cy.intercept('GET', '**/health', { forceNetworkError: true });
    cy.openFixture('privacy-normal.html', 'backend');
    cy.get('[data-testid=backend-offline]').should('be.visible');
    cy.get('[data-testid=privacy-ack]').check();
    cy.get('[data-testid=analyze-btn]').should('be.disabled');
    cy.get('[data-testid=demo-btn]').click();
    cy.get('[data-testid=demo-badge]').should('be.visible');
  });
});
