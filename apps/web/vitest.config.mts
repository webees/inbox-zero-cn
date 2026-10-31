import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { config } from "dotenv";
import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);
const zodV4CorePath = require.resolve("zod/v4/core");
// apps/web and apps/worker can resolve different physical copies of these
// packages (pnpm peer graphs). Alias them so vi.mock("bullmq"|"ioredis")
// applies to both the web dispatch path and the worker runtime.
const bullmqPath = require.resolve("bullmq");
const ioredisPath = require.resolve("ioredis");
const isE2E = process.env.RUN_E2E_FLOW_TESTS === "true";
const envFile = isE2E ? "./.env.e2e" : "./.env.test";
const env = existsSync(envFile) ? config({ path: envFile }).parsed : undefined;

// 5s 的默认超时在 CI 上跑满并行时不够用：每个文件的首个用例要承担整个模块图的
// 加载与转译时间，负载高时会被误判成超时失败。CI 放宽到 20s，本地保持紧凑的
// 5s；需要时用 VITEST_TEST_TIMEOUT_MS 覆盖。
const testTimeoutMs = Number(
  process.env.VITEST_TEST_TIMEOUT_MS ?? (process.env.CI ? 20_000 : 5000),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Vitest runs outside Next, so it must compile JSX instead of inheriting
  // Next's tsconfig `jsx: "preserve"` setting.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "zod/v4/core": zodV4CorePath,
      bullmq: bullmqPath,
      ioredis: ioredisPath,
    },
  },
  test: {
    environment: "node",
    testTimeout: testTimeoutMs,
    hookTimeout: testTimeoutMs,
    setupFiles: ["./__tests__/setup.ts"],
    exclude: [...configDefaults.exclude, "__tests__/playwright/**"],
    server: {
      deps: {
        inline: [/@hookform\/resolvers/],
      },
    },
    env: {
      ...env,
    },
  },
});
