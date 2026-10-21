import { build, context } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist/web", { recursive: true });
await copyFile("editor/index.html", "dist/web/index.html");
await cp("node_modules/katex/dist/fonts", "dist/web/fonts", {
  recursive: true,
});
await copyFile("node_modules/katex/dist/katex.min.css", "dist/web/katex.css");
const options = {
  entryPoints: ["editor/main.ts"],
  bundle: true,
  outdir: "dist/web",
  format: "iife",
  target: ["safari16"],
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  sourcemap: true,
};
if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ host: "127.0.0.1", port: 4173, servedir: "dist/web" });
  console.log("ReT development http://127.0.0.1:4173");
} else await build(options);
