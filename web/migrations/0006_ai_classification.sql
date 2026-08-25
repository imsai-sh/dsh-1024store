-- AI 自动分类：给每个插件补上分类与中英描述。
--
-- 遵循 0005 建立的列所有权约定：
--   curated_*  只有 catalog submission 写
--   github_*   只有爬虫写
--   ai_*       只有分类任务写   ← 本次新增
--
-- 因此不需要任何隔离逻辑：分类任务只碰 ai_ 前缀的列，人工策展的
-- curated_* 在物理上就不可能被它覆盖，反之亦然。两者共存，
-- 快照层按 curated_* → ai_* → github_* 的顺序回退，
-- 所以一个插件的人工条目日后被撤下时，AI 的值会自动接管。
--
-- ai_classifier_version 是去重与重跑的唯一开关：值不等于当前版本的行
-- 会重新进入队列，相等的跳过。

ALTER TABLE catalog_plugins ADD COLUMN ai_category TEXT;
ALTER TABLE catalog_plugins ADD COLUMN ai_description_en TEXT;
ALTER TABLE catalog_plugins ADD COLUMN ai_description_zh TEXT;
-- 'author_en' | 'author_zh' | 'generated'，仅供追溯，不对外展示
ALTER TABLE catalog_plugins ADD COLUMN ai_description_origin TEXT;
ALTER TABLE catalog_plugins ADD COLUMN ai_classifier_version TEXT;
ALTER TABLE catalog_plugins ADD COLUMN ai_classified_at TEXT;

-- 队列按 (是否已分类, 版本) 过滤，配合 curated_category IS NULL
CREATE INDEX catalog_plugins_ai_version_idx
  ON catalog_plugins (ai_classifier_version);
