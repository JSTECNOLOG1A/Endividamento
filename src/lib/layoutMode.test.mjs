/**
 * Testes de resolução de layout (npm run test:layout)
 */
import assert from "node:assert/strict";
import { resolveLayoutMode, layoutCacheKey } from "./layoutMode.js";

assert.equal(resolveLayoutMode("classic"), "classic");
assert.equal(resolveLayoutMode("modern"), "modern");
assert.equal(resolveLayoutMode(undefined), "classic");
assert.equal(resolveLayoutMode("invalid"), "classic");
assert.equal(resolveLayoutMode(null), "classic");
assert.equal(resolveLayoutMode(""), "classic");
assert.equal(layoutCacheKey("grp_a"), "alldebt:layout:grp_a");

console.log("layoutMode ok: classic/modern/invalid/fallback");
