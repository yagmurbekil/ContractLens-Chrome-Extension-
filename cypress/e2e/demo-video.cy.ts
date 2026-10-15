/**
 * Recorded demo (≤ 90 s). Video: cypress/videos/demo-video.cy.ts.mp4
 * Runs in demo mode (rule-based, labelled) so it is reproducible without an API key.
 * Pauses (cy.wait) exist only to make the recording readable.
 */
const pause = (ms = 1200) => cy.wait(ms);

describe('ContractLens demo', () => {
  it('detect → analyze → verified quote → uncertainty → injection resistance', () => {
    // 1. Open a legal document; type is detected
    cy.openFixture('subscription.html');
    cy.get('[data-testid=doc-type]').should('have.attr', 'data-type', 'subscription_terms');
    pause(1800);
    // 2. Run analysis; verified risky clause
    cy.get('[data-testid=privacy-ack]').check();
    pause(600);
    cy.get('[data-testid=analyze-btn]').click();
    cy.get('[data-testid=state-result]').should('be.visible');
    pause(2200);
    // 3. Original quote + Turkish explanation in the full report, and source shown in the page
    cy.get('[data-testid=full-report-btn]').click();
    cy.get('[data-testid=full-report] [data-category=auto_renewal]').should('be.visible').within(() => {
      cy.get('[data-testid=original-quote]').should('contain.text', 'automatically renew');
      cy.get('[data-testid=evidence-verified]').should('exist');
    });
    pause(2500);
    cy.get('[data-category=auto_renewal]').contains('Sayfada kaynağı göster').click();
    pause(2500);
    // 4. Incomplete page → honest uncertainty
    cy.openFixture('ambiguous.html');
    pause(800);
    cy.get('[data-testid=privacy-ack]').check();
    cy.get('[data-testid=analyze-btn]').click();
    cy.get('[data-testid=score-block]').should('contain.text', 'Yetersiz veri');
    pause(3000);
    // 5. Prompt injection page → warning, nothing clicked, real risk still verified
    cy.openFixture('injection.html');
    cy.get('[data-testid=injection-warning-pre]').should('be.visible');
    pause(1800);
    cy.get('[data-testid=privacy-ack]').check();
    cy.get('[data-testid=analyze-btn]').click();
    cy.get('[data-testid=injection-warning]').should('be.visible');
    cy.frameWindow().its('__acceptedTerms').should('eq', undefined);
    pause(3000);
    cy.get('[data-testid=full-report-btn]').click();
    cy.get('[data-testid=full-report] [data-testid=injection-warning]').should('be.visible');
    pause(3500);
  });
});
