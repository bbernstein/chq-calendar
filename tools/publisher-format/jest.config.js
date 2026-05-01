module.exports = {
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/jest.env.js',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
};
