"use strict";

const fileSystem = require("node:fs");
const path = require("node:path");
const projectDirectory = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectDirectory, "_site");
const publishedFiles = [
    "index.html", "style.css", "app.js", "motion.js", "projection.js",
    "assets/wall-reference.png", "assets/site-reference.png",
    "audio/surf-loop.wav", "audio/doom.wav", "audio/industrial.wav"
];
for (let ghostIndex = 0; ghostIndex < 8; ghostIndex++) {
    publishedFiles.push("assets/ghost_" + ghostIndex + ".png");
}
for (const relativePath of publishedFiles) {
    const outputPath = path.join(outputDirectory, relativePath);
    fileSystem.mkdirSync(path.dirname(outputPath), {recursive: true});
    fileSystem.copyFileSync(path.join(projectDirectory, relativePath), outputPath);
}
const indexPath = path.join(outputDirectory, "index.html");
const pageSource = fileSystem.readFileSync(indexPath, "utf8");
const localVideoLink = '<p class="fine"><a href="exports/loop-player.html">Open the portrait and landscape 4K looping videos.</a></p>';
if (!pageSource.includes(localVideoLink)) {
    throw new Error("Local export link changed; review the hosted page before publishing.");
}
fileSystem.writeFileSync(indexPath, pageSource.replace(localVideoLink, "").replace("LIVE STUDY · 4K LOOP EXPORTS", "LIVE PROJECTION STUDY"));
fileSystem.writeFileSync(path.join(outputDirectory, ".nojekyll"), "");
console.log("Built the hosted app with all three soundtracks in _site/.");
