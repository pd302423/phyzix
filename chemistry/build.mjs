// Builds the standalone chapter pages and their PDFs.
//   node chemistry/build.mjs            -> every chapter
//   node chemistry/build.mjs ch1 ch7    -> just those
// Each chapter needs chemistry/<id>-body.html; output is <id>.html + <id>-notes.pdf.
//
// The committed pages load KaTeX from a CDN. If that CDN is unreachable where the
// PDFs are generated, point KATEX_DIST at a local katex dist directory
// (e.g. `npm pack katex@0.16.11`) and the PDF pass will use it instead. The
// committed HTML is unaffected either way.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// playwright may live in a global prefix rather than a local node_modules;
// createRequire honours NODE_PATH, and we fall back to the usual global path.
const require_ = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require_(spec); } catch { /* try the next candidate */ }
  }
  throw new Error("playwright not found - npm i -D playwright, or set NODE_PATH");
};
const { chromium } = loadPlaywright();

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "style.css"), "utf8");

const TITLES = {
  ch1: "Some Basic Concepts of Chemistry — Chapter 1 Notes",
  ch2: "Structure of Atom — Chapter 2 Notes",
  ch3: "Classification of Elements and Periodicity in Properties — Chapter 3 Notes",
  ch4: "Chemical Bonding and Molecular Structure — Chapter 4 Notes",
  ch7: "Redox Reactions — Chapter 7 Notes",
  formulas: "All Formulas — Chemistry Chapters 1, 2, 3, 4 and 7",
};

const CDN = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";
const cdnHead = `<link rel="stylesheet" href="${CDN}/katex.min.css" crossorigin="anonymous">
<script defer src="${CDN}/katex.min.js" crossorigin="anonymous"></script>
<script defer src="${CDN}/contrib/auto-render.min.js" crossorigin="anonymous"></script>`;

const localHead = (dist) => {
  const u = (p) => pathToFileURL(join(dist, p)).href;
  return `<link rel="stylesheet" href="${u("katex.min.css")}">
<script defer src="${u("katex.min.js")}"></script>
<script defer src="${u("contrib/auto-render.min.js")}"></script>`;
};

const page_ = (title, head, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
document.addEventListener("DOMContentLoaded", function () {
  renderMathInElement(document.body, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$",  right: "$",  display: false }
    ],
    throwOnError: false, errorColor: "#cc0000", strict: false, trust: false
  });
  document.body.setAttribute("data-katex-done", "1");
});
</script>
</body>
</html>
`;

const dist = process.env.KATEX_DIST;
const scratch = mkdtempSync(join(tmpdir(), "chem-pdf-"));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TITLES);

const browser = await chromium.launch();
for (const id of ids) {
  const bodyPath = join(dir, `${id}-body.html`);
  if (!existsSync(bodyPath)) { console.log(`skip ${id} (no body)`); continue; }
  const title = TITLES[id] ?? id;
  const body = readFileSync(bodyPath, "utf8");

  writeFileSync(join(dir, `${id}.html`), page_(title, cdnHead, body));

  // Render from a copy so a local KaTeX never leaks into the committed page.
  const renderPath = join(scratch, `${id}.html`);
  writeFileSync(renderPath, page_(title, dist ? localHead(dist) : cdnHead, body));

  const page = await browser.newPage();
  await page.goto(pathToFileURL(renderPath).href, { waitUntil: "networkidle" });
  await page.waitForSelector('body[data-katex-done="1"]', { timeout: 30000 });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: join(dir, `${id}-notes.pdf`),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#7a838c;padding:0 15mm;">' +
      '<span style="float:left">CBSE Class 11 Chemistry</span>' +
      '<span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: "14mm", bottom: "16mm", left: "15mm", right: "15mm" },
  });
  await page.close();
  console.log(`built ${id}`);
}
await browser.close();
