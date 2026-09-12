import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

await rm(new URL("../packages/public/dist/", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../packages/public/dist/", import.meta.url), { recursive: true });

await Promise.all([
  build({
    entryPoints: [new URL("../packages/public/src/index.ts", import.meta.url).pathname],
    outfile: new URL("../packages/public/dist/index.js", import.meta.url).pathname,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    external: ["@hiero-ledger/sdk", "@x402/core", "@x402/hedera", "dotenv", "ethers"]
  }),
  build({
    entryPoints: [new URL("../packages/public/src/verity.ts", import.meta.url).pathname],
    outfile: new URL("../packages/public/dist/verity.js", import.meta.url).pathname,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@hiero-ledger/sdk", "@x402/core", "@x402/hedera", "dotenv", "ethers"]
  })
]);
