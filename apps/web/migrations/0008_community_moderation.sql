-- 社区内容审核
--
-- 词表存在库里、不进仓库：这是公开的 OSS，一份政治敏感词表提交进去
-- 既是敏感内容本身，也等于把绕过手册发给所有人。仓库只有机制。
-- 词通过带鉴权的 POST /api/v1/community/moderation/terms 灌入。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_blocked_terms (
  -- 已归一化的词（见 worker/community/moderation.ts 的 normalizeForMatching）。
  -- 入库时就归一化，查询时不必再算，也保证入库和比对用的是同一套规则。
  term_normalized TEXT PRIMARY KEY,
  category        TEXT NOT NULL CHECK (category IN ('political', 'sexual', 'abuse', 'spam')),
  created_at      TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS community_blocked_terms_category_idx
  ON community_blocked_terms (category);

-- 审核事件。**不存正文** —— 被拒的内容没有保存的理由，存下来反而是
-- 一份敏感内容的集合。只记谁、哪一类、哪一层拦的，够回答「这个人是不是
-- 在反复试探」和「这条规则是不是在大量误伤」。
CREATE TABLE IF NOT EXISTS community_moderation_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('lexicon', 'classifier')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS community_moderation_events_author_idx
  ON community_moderation_events (author_id, created_at DESC);
