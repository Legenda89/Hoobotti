/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  // Windows: vähennä rinnakkaisuutta ja muistipaineita (OOM).
  maxWorkers: 1,
  workerIdleMemoryLimit: "512MB",
};
