import test from "node:test";
import assert from "node:assert/strict";
import { stadiumFor } from "./stadiums";

test("venue value takes precedence over home-team fallback", () => {
  assert.equal(stadiumFor("KC", "London Stadium"), null);
  assert.equal(stadiumFor("KC", null)?.teamAbbreviation, "KC");
  assert.equal(stadiumFor("KC", "GEHA Field at Arrowhead Stadium")?.teamAbbreviation, "KC");
});
