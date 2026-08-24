// catalog/categories.json here is a vendored mirror of the same file in the
// catalog repository (imsai-sh/awesome-deepseek-harness-plugins). A category
// change must land in BOTH repositories and only takes effect for the site
// when this Worker is redeployed.
import categoriesConfig from '../../../../catalog/categories.json' with { type: 'json' }
import type { CategoryDescriptor, RegistryCategory } from '../types'

export const UNCLASSIFIED_CATEGORY: CategoryDescriptor = {
  id: 'unclassified',
  order: 1000,
  label: { en: 'Unclassified', zh: '待分类' },
}

function isCategoryDefinition(value: unknown): value is CategoryDescriptor {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const label = item.label as Record<string, unknown> | undefined
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.order === 'number' &&
    Boolean(label) &&
    typeof label?.en === 'string' &&
    typeof label?.zh === 'string'
  )
}

const configuredCategories: unknown = categoriesConfig.categories
if (!Array.isArray(configuredCategories) || !configuredCategories.every(isCategoryDefinition)) {
  throw new Error('catalog/categories.json does not match the Worker category schema')
}

/** Canonical category definitions, sorted by display order. catalog/categories.json is the single source of truth. */
export const CATALOG_CATEGORIES: CategoryDescriptor[] = [...configuredCategories]
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))

const CATEGORIES_BY_ID = new Map<string, CategoryDescriptor>([
  ...CATALOG_CATEGORIES.map((category) => [category.id, category] as const),
  [UNCLASSIFIED_CATEGORY.id, UNCLASSIFIED_CATEGORY],
])

export function isKnownCategoryId(id: string): boolean {
  return CATALOG_CATEGORIES.some((category) => category.id === id)
}

/** Resolve the descriptor for a plugin category id; unknown ids resolve to null. */
export function categoryDescriptor(id: string): CategoryDescriptor | null {
  return CATEGORIES_BY_ID.get(id) ?? null
}

/** Snapshot-shaped `{ id: { en, zh } }` label map for every configured category. */
export function categoryLabelMap(): Record<string, RegistryCategory> {
  return Object.fromEntries(
    CATALOG_CATEGORIES.map((category) => [category.id, { ...category.label }]),
  )
}

/** Project a snapshot category map into ordered registry descriptors. */
export function projectCategories(
  categories: Record<string, RegistryCategory>,
): CategoryDescriptor[] {
  return Object.entries(categories)
    .map(([id, label]) => CATEGORIES_BY_ID.get(id) ?? { id, order: 1000, label: { ...label } })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}
