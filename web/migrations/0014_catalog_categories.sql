-- Category definitions move from a bundled JSON file into D1. The catalog
-- repository (imsai-sh/awesome-deepseek-harness-plugins) remains the human
-- source of truth; its sync workflow reconciles this table through the
-- `categories` field of POST /api/v1/catalog/sync. These INSERTs are the
-- one-time seed matching the definitions bundled up to this migration.
-- The synthetic `unclassified` bucket is NOT a row: it stays a code-level
-- projection (worker/lib/categories.ts UNCLASSIFIED_CATEGORY).
CREATE TABLE catalog_categories (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  label_en TEXT NOT NULL,
  label_zh TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO catalog_categories (id, sort_order, label_en, label_zh, updated_at) VALUES
  ('ui', 10, 'UI Enhancements', 'UI 增强', '2026-08-25T00:00:00.000Z'),
  ('theme', 20, 'Themes & Appearance', '主题与外观', '2026-08-25T00:00:00.000Z'),
  ('session', 30, 'Sessions & Messages', '会话与消息', '2026-08-25T00:00:00.000Z'),
  ('memory', 40, 'Memory', '记忆', '2026-08-25T00:00:00.000Z'),
  ('tools', 50, 'Tools & Capabilities', '工具与能力', '2026-08-25T00:00:00.000Z'),
  ('skill', 60, 'Skills', '技能包', '2026-08-25T00:00:00.000Z'),
  ('workflow', 70, 'Workflow & Automation', '工作流与自动化', '2026-08-25T00:00:00.000Z'),
  ('notify', 80, 'Notifications & Integrations', '通知与集成', '2026-08-25T00:00:00.000Z'),
  ('model', 90, 'Models & Providers', '模型与账号接入', '2026-08-25T00:00:00.000Z'),
  ('dev', 100, 'Development & Runtime', '开发与运行时', '2026-08-25T00:00:00.000Z'),
  ('fun', 110, 'Just for Fun', '娱乐', '2026-08-25T00:00:00.000Z');
