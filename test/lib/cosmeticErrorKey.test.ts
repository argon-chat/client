/**
 * Every reason the server gives for refusing an equip has its own sentence; a reason this build does
 * not know falls back to the generic one rather than rendering a key.
 */

import {
  describe,
  expect,
  test,
} from "vitest";
import { CosmeticError } from "@argon/glue";

import { cosmeticErrorKey } from "@/lib/refusals";

import en from "../../packages/i18n/src/core/en.json";
import ru from "../../packages/i18n/src/core/ru.json";

describe("cosmeticErrorKey", () => {
  test.each([
    [CosmeticError.NOT_FOUND, "cosmetic_error_not_found"],
    [CosmeticError.UNKNOWN_KIND, "cosmetic_error_unknown_kind"],
    [CosmeticError.KIND_DISABLED, "cosmetic_error_kind_disabled"],
    [CosmeticError.ITEM_UNAVAILABLE, "cosmetic_error_item_unavailable"],
    [CosmeticError.NOT_OWNED, "cosmetic_error_not_owned"],
    [CosmeticError.CHOICE_INVALID, "cosmetic_error_choice_invalid"],
    [CosmeticError.VALUE_OUT_OF_RANGE, "cosmetic_error_value_out_of_range"],
  ])("%s maps to %s", (error, key) => {
    expect(cosmeticErrorKey(error)).toBe(key);
  });

  test("a reason from a newer server gets the generic sentence", () => {
    expect(cosmeticErrorKey(99 as CosmeticError)).toBe("cosmetic_equip_failed");
  });

  test("every key it can return is written in English and Russian", () => {
    const reasons = [0, 1, 2, 3, 4, 5, 6, 99] as CosmeticError[];

    for (const reason of reasons) {
      const key = cosmeticErrorKey(reason);

      expect(en).toHaveProperty([key]);
      expect(ru).toHaveProperty([key]);
    }
  });
});
