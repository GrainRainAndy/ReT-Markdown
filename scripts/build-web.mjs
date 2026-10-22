import { build, context } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist/web", { recursive: true });
await copyFile("editor/index.html", "dist/web/index.html");
await copyFile("editor/protocol/commands.json", "dist/web/commands.json");
await cp("node_modules/katex/dist/fonts", "dist/web/fonts", {
  recursive: true,
});
await copyFile("node_modules/katex/dist/katex.min.css", "dist/web/katex.css");
const options = {
  bundle: true,
  outdir: "dist/web",
  format: "iife",
  target: ["safari16"],
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  sourcemap: true,
};
const mainOptions = { ...options, entryPoints: { main: "editor/main.ts" } };
// Micromark's decoder provides a DOM-free conditional export for workers.
const workerOptions = {
  ...options,
  entryPoints: { "render-worker": "editor/render/worker.ts" },
  conditions: ["worker"],
};
if (process.argv.includes("--serve")) {
  const contexts = await Promise.all([
    context(mainOptions),
    context(workerOptions),
  ]);
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  await contexts[0].serve({
    host: "127.0.0.1",
    port: 4173,
    servedir: "dist/web",
  });
  console.log("ReT development http://127.0.0.1:4173");
} else {
  await build(mainOptions);
  await build(workerOptions);
}
