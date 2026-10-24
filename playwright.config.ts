import { defineConfig } from '@playwright/test';

// Smoke and QA specs run against a running stack: SpacetimeDB (npm run stdb:start),
// the worker (npm run worker) and the web app (npm run dev). WebGL uses SwiftShader
// in headless Chromium, so frame rates here say nothing about the demo laptop.
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'qa/**/*.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
