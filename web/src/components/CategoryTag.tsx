import type { CategoryResult } from '../lib/api'
import { useI18n } from '../lib/i18n'

// 每一行是独立的 grid，靠自动排布填格子。分类解析不出来时如果返回 null，
// 这一格就消失了，后面的指标、安装按钮、外链箭头会整体左移一列，整行错位。
// 所以这里渲染一个不可见的占位格，保证列数恒定。
export function CategoryTag({ category }: { category?: CategoryResult }) {
  const { language } = useI18n()
  if (!category) return <span className="category-tag is-placeholder" aria-hidden="true" />
  return (
    <span className={`category-tag category-${category.id}`}>
      <span className="category-dot" aria-hidden="true" />
      {category[language]}
    </span>
  )
}
