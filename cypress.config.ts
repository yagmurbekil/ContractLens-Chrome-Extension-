import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:4173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 800,
    defaultCommandTimeout: 15000,
    video: true,
    videoCompression: 28,
    videosFolder: 'cypress/videos',
    screenshotsFolder: 'cypress/screenshots',
    retries: 0,
  },
});
