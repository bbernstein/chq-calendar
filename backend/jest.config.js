const floor = require('../.coverage-floor.json');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: './jest-environment.cjs',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/handlers/*.ts', // Exclude AWS Lambda handlers from coverage
    '!src/scripts/*.ts', // Exclude CLI scripts from coverage
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/refs/', '\\.d\\.ts$', '/__tests__/'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: { lines: floor.backend.lines },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: false }],
  },
};
