import { beforeEach, describe, expect, it } from "vitest";

import {
  isHeldByFavorite,
  toggleFavoriteLabel,
  useFavoriteLabelsStore,
} from "../src/renderer/src/components/shell/sidebar/favorite-labels";
import {
  parseFavoriteLabels,
  serializeFavoriteLabels,
} from "../src/renderer/src/components/shell/sidebar/sidebar-preferences";

const ONE = "one@example.com";
const TWO = "two@example.com";

describe(toggleFavoriteLabel, () => {
  it("adds to the end and takes out without regard to case", () => {
    const favorites = toggleFavoriteLabel(
      [{ accountId: ONE, label: "Travel" }],
      { accountId: ONE, label: "Work" }
    );

    expect(favorites).toStrictEqual([
      { accountId: ONE, label: "Travel" },
      { accountId: ONE, label: "Work" },
    ]);
    expect(
      toggleFavoriteLabel(favorites, { accountId: ONE, label: "work" })
    ).toStrictEqual([{ accountId: ONE, label: "Travel" }]);
  });

  it("keeps the same label in two accounts apart", () => {
    expect(
      toggleFavoriteLabel([{ accountId: ONE, label: "Work" }], {
        accountId: TWO,
        label: "Work",
      })
    ).toHaveLength(2);
  });
});

describe("favorite label storage", () => {
  it("stores only connected accounts' favorites, in order", () => {
    expect(
      parseFavoriteLabels(
        serializeFavoriteLabels(
          [
            { accountId: TWO, label: "Work" },
            { accountId: "gone@example.com", label: "Old" },
            { accountId: ONE, label: "Travel" },
          ],
          [ONE, TWO]
        )
      )
    ).toStrictEqual([
      { accountId: TWO, label: "Work" },
      { accountId: ONE, label: "Travel" },
    ]);
  });

  it.each([null, "{", "[{}]", JSON.stringify([{ accountId: ONE, label: "" }])])(
    "starts with no favorites from %s",
    (value) => {
      expect(parseFavoriteLabels(value)).toStrictEqual([]);
    }
  );
});

describe(isHeldByFavorite, () => {
  const favorites = [{ accountId: ONE, label: "Work" }];

  it("holds the place only for the favorite's own account and label", () => {
    const view = {
      currentPath: "/",
      mailbox: { label: "work" },
      selectedAccountId: ONE,
    } as const;

    expect(isHeldByFavorite(view, favorites)).toBeTruthy();
    expect(
      isHeldByFavorite({ ...view, selectedAccountId: TWO }, favorites)
    ).toBeFalsy();
    expect(
      isHeldByFavorite({ ...view, currentPath: "/settings" }, favorites)
    ).toBeFalsy();
  });
});

describe("favorite labels store", () => {
  beforeEach(() => {
    useFavoriteLabelsStore.setState({ favorites: [] });
  });

  it("toggles a favorite", () => {
    const { toggleFavorite } = useFavoriteLabelsStore.getState();

    toggleFavorite({ accountId: ONE, label: "Work" });
    expect(useFavoriteLabelsStore.getState().favorites).toStrictEqual([
      { accountId: ONE, label: "Work" },
    ]);

    toggleFavorite({ accountId: ONE, label: "WORK" });
    expect(useFavoriteLabelsStore.getState().favorites).toStrictEqual([]);
  });
});
