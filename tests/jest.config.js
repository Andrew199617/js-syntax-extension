// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {

  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  // What folders to collect coverage from.
  collectCoverageFrom: [
    'src/**/*.js',
    '!./node_modules/'
  ],

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/logs/'
  ],

  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: [
    'json',
    'text',
    'lcov',
    'clover'
  ],

  // Make calling deprecated APIs throw helpful error messages
  errorOnDeprecated: true,

  // A path to a module which exports an async function that is triggered once before all test suites
  // globalSetup: './jest.globalSetup.js',

  // A path to a module which exports an async function that is triggered once after all test suites
  // globalTeardown: './jest.globalTeardown.js',

  // An array of file extensions your modules use
  moduleFileExtensions: [
    'js',
    'json'
  ],

  // Automatically reset mock state between every test
  resetMocks: false,

  // The root directory that Jest should scan for tests and modules within
  rootDir: '../',

  // A list of paths to directories that Jest should use to search for files in
  roots: [
    './tests'
  ],

  // The paths to modules that run some code to configure or set up the testing environment before each test
  setupFiles: [
    './tests/jest.setup.js'
  ],

  // The test environment that will be used for testing
  testEnvironment: 'node',

  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/(*.)+(test).js'
  ],

  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: [
    '\\\\node_modules\\\\'
  ],

  // Indicates whether each individual test should be reported during the run
  verbose: true
};
