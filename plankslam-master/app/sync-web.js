/* Copies the game source into the Capacitor web dir so the three copies
   of game.js/styles.css cannot drift:

     plankslam-master/game.js          <- you edit this one
     plankslam-master/app/www/game.js  <- copied here
     app/android/.../assets/public/    <- written by `cap sync`, runs in the APK

   Run `npm run sync:web` (copy only) or `npm run sync` (copy + cap sync).
   index.html is deliberately NOT copied: the www one carries the ad script
   tags, so the two differ on purpose. */
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

/* guard: index.html must keep its ad tags in the www build */
const wwwIndex = path.join(WWW, "index.html");
if (fs.existsSync(wwwIndex)) {
  const html = fs.readFileSync(wwwIndex, "utf8");
  for (const tag of ["capacitor.js", "admob.js", "ads.js"]) {
    if (!html.includes(tag)) console.warn(`  WARNING: app/www/index.html is missing <script src="${tag}"> - ads will not load`);
  }
}

console.log(changed ? `sync:web done - ${changed} file(s) updated` : "sync:web done - already in sync");
console.log("remember: run `npx cap sync android` before building, or the APK keeps the old code");
