import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = "dist";
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "icons",
];

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of files) {
  await cp(file, `${outputDirectory}/${file}`, { recursive: true });
}

console.log(`Built ${files.length} app assets into ${outputDirectory}.`);
