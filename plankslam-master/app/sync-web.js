/* Copies the game source into the Capacitor web dir so the three copies
   of game.js/styles.css cannot drift:

     plankslam-master/game.js          <- you edit this one
     plankslam-master/app/www/game.js  <- copied here
     app/android/.../assets/public/    <- written by `cap sync`, runs in the APK

   Run `npm run sync:web` (copy only) or `npm run sync` (copy + cap sync).
   index.html IS copied, but the ad script tags the native build needs are
   re-inserted on the way through - edit only the root index.html. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");   // plankslam-master
const WWW = path.join(__dirname, "www");
const FILES = ["game.js", "styles.css", "icon.png"];

let changed = 0;
for (const name of FILES) {
  const src = path.join(ROOT, name);
  const dst = path.join(WWW, name);
  if (!fs.existsSync(src)) { console.warn(`  skip   ${name} (not found in ${ROOT})`); continue; }
  const a = fs.readFileSync(src);
  const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
  if (b && a.equals(b)) { console.log(`  same   ${name}`); continue; }
  fs.writeFileSync(dst, a);
  console.log(`  copied ${name}  (${a.length} bytes)`);
  changed++;
}

/* index.html: copy the root one but re-insert the native-only ad scripts,
   so you never have to edit two copies by hand. */
const AD_TAGS = ["capacitor.js", "admob.js", "ads.js"];
const ANCHOR = '<script src="https://cdnjs.cloudflare.com';
const srcIndex = path.join(ROOT, "index.html");
const wwwIndex = path.join(WWW, "index.html");
if (fs.existsSync(srcIndex)) {
  let html = fs.readFileSync(srcIndex, "utf8");
  const at = html.indexOf(ANCHOR);
  if (at === -1) {
    console.warn("  WARNING: index.html not copied - could not find the three.js <script> to insert the ad tags before.");
  } else {
    const inject = AD_TAGS.map(t => `<script src="${t}"></script>`).join("\n") + "\n";
    html = html.slice(0, at) + inject + html.slice(at);
    for (const t of AD_TAGS) {
      if (!html.includes(`src="${t}"`)) { console.warn(`  WARNING: ${t} tag missing after injection`); }
    }
    const prev = fs.existsSync(wwwIndex) ? fs.readFileSync(wwwIndex, "utf8") : null;
    if (prev === html) { console.log("  same   index.html"); }
    else { fs.writeFileSync(wwwIndex, html); console.log("  copied index.html  (+ad tags re-inserted)"); changed++; }
  }
}

console.log(changed ? `sync:web done - ${changed} file(s) updated` : "sync:web done - already in sync");
/* `npm run sync` chains cap sync straight after, so only nag when run alone */
if (!process.argv.includes("--with-cap")) {
  console.log("NOTE: this copied into app/www only. Run `npx cap sync android` too,");
  console.log("      or use `npm run sync` next time, or the APK keeps the old code.");
}
