import type { CategoryDescriptor, RegistryCategory } from '../types'

// Category definitions live in D1 (`catalog_categories`, migration 0014) and are
// reconciled by the catalog repository's sync workflow through the `categories`
// field of POST /api/v1/catalog/sync. The Worker bundles no category data:
// runtime consumers read the ordered list from the catalog snapshot
// (`snapshot.categoryList`), which the snapshot builder loads from D1. Only the
// synthetic unclassified bucket stays in code — it is a projection rule for
// plugins no curator or classifier has categorized, not a real category, and its
// label must stay aligned with the catalog repo's README generator.
export const UNCLASSIFIED_CATEGORY: CategoryDescriptor = {
  id: 'unclassified',
  order: 1000,
  label: { en: 'Unclassified', zh: '待分类' },
}

interface CategoryRow {
  id: string
  sort_order: number
  label_en: string
  label_zh: string
}

/**
 * Ordered category definitions from D1. Failures propagate DELIBERATELY: a
 * missing table (a Worker deployed ahead of migration 0014) or a transient D1
 * error must abort whatever the caller is building — the snapshot rebuild
 * degrades to the previous snapshot, and the sync endpoint answers 503 —
 * rather than silently minting a catalog with zero categories. A swallowed
 * error here once meant a poisoned snapshot that reads never rebuild.
 */
export async function loadCategoriesFromD1(db: D1Database): Promise<CategoryDescriptor[]> {
  const result = await db
    .prepare('SELECT id, sort_order, label_en, label_zh FROM catalog_categories ORDER BY sort_order, id')
    .all<CategoryRow>()
  return (result.results ?? []).map((row) => ({
    id: row.id,
    order: row.sort_order,
    label: { en: row.label_en, zh: row.label_zh },
  }))
}

/** Snapshot-shaped `{ id: { en, zh } }` label map for the given category list. */
export function categoryLabelMap(categories: CategoryDescriptor[]): Record<string, RegistryCategory> {
  return Object.fromEntries(categories.map((category) => [category.id, { ...category.label }]))
}

/** True when `id` names a real (non-synthetic) category in the list. */
export function isKnownCategoryIdIn(categories: CategoryDescriptor[], id: string): boolean {
  return categories.some((category) => category.id === id)
}

/** Resolve a plugin category id against the list; unknown ids resolve to null. */
export function categoryDescriptorFrom(
  categories: CategoryDescriptor[],
  id: string,
): CategoryDescriptor | null {
  if (id === UNCLASSIFIED_CATEGORY.id) return UNCLASSIFIED_CATEGORY
  return categories.find((category) => category.id === id) ?? null
}

/** Project a snapshot category map into ordered registry descriptors. */
export function projectCategories(
  categories: Record<string, RegistryCategory>,
  categoryList: CategoryDescriptor[],
): CategoryDescriptor[] {
  const byId = new Map<string, CategoryDescriptor>([
    ...categoryList.map((category) => [category.id, category] as const),
    [UNCLASSIFIED_CATEGORY.id, UNCLASSIFIED_CATEGORY],
  ])
  return Object.entries(categories)
    .map(([id, label]) => byId.get(id) ?? { id, order: 1000, label: { ...label } })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}
