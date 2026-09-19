/**
 * Testes de resolução de layout (npm run test:layout)
 * Padrão da plataforma: modern.
 */
import assert from "node:assert/strict";
import { resolveLayoutMode, layoutCacheKey, DEFAULT_LAYOUT_MODE } from "./layoutMode.js";

assert.equal(DEFAULT_LAYOUT_MODE, "modern");
assert.equal(resolveLayoutMode("classic"), "classic");
assert.equal(resolveLayoutMode("modern"), "modern");
assert.equal(resolveLayoutMode(undefined), "modern");
assert.equal(resolveLayoutMode("invalid"), "modern");
assert.equal(resolveLayoutMode(null), "modern");
assert.equal(resolveLayoutMode(""), "modern");
assert.equal(layoutCacheKey("grp_a"), "alldebt:layout:grp_a");

console.log("layoutMode ok: modern-default/classic-opt-in/invalid-fallback");
