// Standalone Jest config for the post-deploy smoke. Decoupled from
// backend/jest.config.js so changes to backend's TypeScript build options
// (target, lib, moduleResolution) cannot silently break the smoke at
// deploy time. Inline tsconfig keeps the smoke's compile contract pinned
// to what apiClient.ts and adminAuth.ts actually need.
//
// Don't add testEnvironment overrides here — node default is correct.
// The smoke runs no DOM code; everything goes through fetch().

module.exports = {
  rootDir: __dirname,
  testMatch: ['<rootDir>/*.test.ts'],
  // Same Node.js 22+ localStorage workaround backend uses. The smoke
  // doesn't touch localStorage, but jest-environment-node throws
  // SecurityError on context-copy without this wrapper.
  testEnvironment: '<rootDir>/../../backend/jest-environment.cjs',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          esModuleInterop: true,
          resolveJsonModule: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  testTimeout: 5 * 60 * 1000,
  // Don't pull in backend/setup.ts — its console.info mock and DDB
  // env-var defaults are wrong for the smoke (which talks to live HTTPS).
};
