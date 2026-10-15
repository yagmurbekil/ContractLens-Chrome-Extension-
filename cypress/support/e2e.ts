/// <reference types="cypress" />

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      openFixture(fixture: string, mode?: 'demo' | 'backend'): Chainable<void>;
      analyze(): Chainable<void>;
      frameWindow(): Chainable<Window & { __acceptedTerms?: boolean; __cookieAccepted?: boolean }>;
    }
  }
}

Cypress.Commands.add('openFixture', (fixture: string, mode: 'demo' | 'backend' = 'demo') => {
  cy.visit(`/harness.html?fixture=${fixture}&mode=${mode}&backend=http://127.0.0.1:8787`);
  cy.get('[data-testid=page-meta]').should('be.visible');
});

Cypress.Commands.add('analyze', () => {
  cy.get('[data-testid=privacy-ack]').check();
  cy.get('[data-testid=analyze-btn]').should('be.enabled').click();
  cy.get('[data-testid=state-result]', { timeout: 20000 }).should('be.visible');
});

Cypress.Commands.add('frameWindow', () => {
  return cy.get('#cl-frame').its('0.contentWindow').should('exist') as never;
});

export {};
