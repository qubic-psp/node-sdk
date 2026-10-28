import type { Page } from './types';

/**
 * Walks the pages of a list from `startPage` until the last one and yields the items. An item that already came
 * on an earlier page (a newest-first list shifted while it was read) is skipped, so every id comes once.
 */
export async function* paginate<T extends { id: string }>(
  fetchPage: (page: number) => Promise<Page<T>>,
  startPage = 1,
): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>();
  for (let page = startPage; ; page++) {
    const result = await fetchPage(page);
    for (const item of result.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      yield item;
    }
    if (result.items.length === 0 || result.page * result.limit >= result.total) return;
  }
}
