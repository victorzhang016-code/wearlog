/** Accept only the journal route; unrelated entry points keep their own back action. */
export function journalReturnTarget(state: unknown) {
  const value = (state as { journalReturnTo?: unknown } | null)?.journalReturnTo;
  if (typeof value !== "string" || !/^\/aesthetic(?:\?[^#]*)?$/.test(value)) return null;
  return {
    path: value,
    label: new URLSearchParams(value.split("?")[1]).get("view") === "outfits"
      ? "返回我的穿搭" : "返回我的色卡",
  };
}

/** A garment opened inside a journal outfit returns to that outfit first. */
export function journalParentTarget(state: unknown) {
  if (!journalReturnTarget(state)) return null;
  const path = (state as { journalParent?: unknown }).journalParent;
  if (typeof path !== "string" || !/^\/best-match\/[a-zA-Z0-9_-]+$/.test(path)) return null;
  return { path, label: "返回搭配" };
}
