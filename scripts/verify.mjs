import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

for (const file of requiredFiles) {
  await access(file);
}

const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
if (manifest.display !== "standalone") throw new Error("manifest display must be standalone");
if (!manifest.icons?.some((icon) => icon.sizes === "512x512")) throw new Error("512px icon missing");

const appSource = await readFile("app.js", "utf8");
for (const feature of ["drawGabor", "periodPixels", "renderCalibration", "renderRest", "startStandard", "startGame"]) {
  if (!appSource.includes(`function ${feature}`)) throw new Error(`${feature} missing`);
}

if (/[—–]/u.test(appSource) || /[—–]/u.test(await readFile("index.html", "utf8"))) {
  throw new Error("forbidden dash character found in visible copy");
}

console.log("Static verification passed.");
