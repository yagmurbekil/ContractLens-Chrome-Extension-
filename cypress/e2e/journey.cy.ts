/**
 * Full user journey on deterministic local fixtures (demo mode = rule-based,
 * clearly labelled). Runs the real extraction, Page Agent PageController,
 * schema validation, quote verification and scoring code.
 */
describe('ContractLens user journey (fixtures, demo mode)', () => {
  it('privacy policy: detects type, finds a verified data-sharing clause', () => {
    cy.openFixture('privacy-normal.html');
    cy.get('[data-testid=doc-type]').should('have.attr', 'data-type', 'privacy_policy');
    cy.get('[data-testid=privacy-notice]').should('contain.text', 'karakteri');
    cy.get('[data-testid=analyze-btn]').should('be.disabled'); // consent required first
    cy.analyze();
    cy.get('[data-testid=demo-badge]').should('be.visible');
    cy.get('[data-testid=finding][data-category=data_sharing]').first().within(() => {
      cy.get('[data-testid=evidence-verified]').should('exist');
      cy.get('[data-testid=original-quote]').should('contain.text', 'advertising partners');
      cy.get('[data-testid=explanation]').invoke('text').should('match', /[çğıöşü]/);
    });
    cy.get('[data-testid=disclaimer]').should('contain.text', 'hukuki tavsiye vermez');
  });

  it('subscription terms: auto-renewal, cancellation and refunds; full report; no clicks on the page', () => {
    cy.openFixture('subscription.html');
    cy.get('[data-testid=doc-type]').should('have.attr', 'data-type', 'subscription_terms');
    cy.analyze();
    cy.get('[data-testid=risk-score]').invoke('text').should('match', /^\d+/);
    cy.get('[data-testid=full-report-btn]').click();
    cy.get('[data-testid=full-report]').within(() => {
      cy.get('[data-category=auto_renewal]').should('exist');
      cy.get('[data-category=refunds]').should('exist');
      cy.get('[data-category=cancellation]').should('exist');
      cy.get('[data-testid=finding]').each(($f) => expect($f.attr('data-evidence')).to.eq('verified'));
    });
    cy.contains('Sayfada kaynağı göster').first().click();
    cy.frameWindow().then((w) => {
      expect(String(w.getSelection())).to.contain('automatically renew');
      expect(w.__cookieAccepted).to.eq(undefined);
    });
  });

  it('Turkish contract: Turkish rules find auto-renewal, no-refund and data sharing', () => {
    cy.openFixture('turkce-sozlesme.html');
    cy.get('[data-testid=doc-type]').should('have.attr', 'data-type', 'terms_of_service');
    cy.analyze();
    cy.get('[data-testid=full-report-btn]').click();
    cy.get('[data-testid=full-report]').within(() => {
      cy.get('[data-category=auto_renewal]').should('exist');
      cy.get('[data-category=refunds]').should('contain.text', 'iade edilmez');
      cy.get('[data-category=data_sharing]').should('exist');
    });
  });

  it('benign document: no findings, and explicitly NOT declared safe', () => {
    cy.openFixture('benign.html');
    cy.analyze();
    cy.get('[data-testid=no-findings]').should('contain.text', 'güvenli olduğunu göstermez');
    cy.get('[data-testid=score-explanation]').should('contain.text', 'güvenli olduğu anlamına gelmez');
  });

  it('ambiguous / incomplete page: shows "Yetersiz veri" instead of a score', () => {
    cy.openFixture('ambiguous.html');
    cy.analyze();
    cy.get('[data-testid=state-result]').should('have.attr', 'data-status', 'insufficient_data');
    cy.get('[data-testid=risk-score]').should('contain.text', '—');
    cy.get('[data-testid=score-block]').should('contain.text', 'Yetersiz veri');
  });

  it('prompt injection page: warning shown, instructions not followed, nothing clicked', () => {
    cy.openFixture('injection.html');
    cy.get('[data-testid=injection-warning-pre]').should('be.visible');
    cy.analyze();
    cy.get('[data-testid=injection-warning]').should('be.visible');
    cy.get('[data-testid=finding]').first().should('contain.text', 'satılabilmesi');
    cy.get('[data-testid=risk-score]').invoke('text').then((t) => expect(parseInt(t, 10)).to.be.greaterThan(0));
    cy.frameWindow().then((w) => {
      expect(w.__acceptedTerms).to.eq(undefined);
      expect(w.document.title).not.to.eq('ACCEPTED');
    });
  });
});
