import assert from "node:assert/strict";
import test from "node:test";
import { journalReturnTarget, journalParentTarget } from "../src/lib/journalNavigation";

test("detail returns to its journal chapter with colour filters intact", () => {
  const path = "/aesthetic?view=colors&color=%E8%93%9D&role=accent";
  assert.deepEqual(journalReturnTarget({ journalReturnTo: path }), { path, label: "返回我的色卡" });
  assert.equal(journalReturnTarget({ journalReturnTo: "/aesthetic?view=outfits" })?.label, "返回我的穿搭");
});

test("nested garments return through the outfit while retaining the journal context", () => {
  const state = { journalReturnTo: "/aesthetic?view=outfits&insight=record%3Aformal", journalParent: "/best-match/look-1" };
  assert.deepEqual(journalParentTarget(state), { path: "/best-match/look-1", label: "返回搭配" });
  assert.equal(journalReturnTarget(state)?.path, state.journalReturnTo);
  for (const journalParent of ["https://example.com", "/best-match/../admin", "/item/a", null]) {
    assert.equal(journalParentTarget({ ...state, journalParent }), null);
  }
  assert.equal(journalParentTarget({ journalParent: "/best-match/look-1" }), null);
});

test("other entry routes retain their normal back action, and untrusted destinations are rejected", () => {
  for (const value of [undefined, null, 42, "https://example.com", "//example.com", "/aesthetic-lab", "/item/a", "/aesthetic/../admin"]) {
    assert.equal(journalReturnTarget({ journalReturnTo: value }), null);
  }
  assert.equal(journalReturnTarget(null), null);
});
