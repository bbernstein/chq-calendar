// Jest setup file for global test configuration
import { jest } from '@jest/globals';

// Set longer timeout for integration tests
jest.setTimeout(10000);

// Mock AWS SDK for tests
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};