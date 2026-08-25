-- 社区：帖子 / 评论 / 点赞 / 插件引用
--
-- 社区的 UI 代码在 apps/community，但它和主站跑在同一个 Worker、同一个 D1 上，
-- 所以迁移和其他表一样排在这里：一个数据库只有一条迁移序列。
-- 本文件引用 api_users，由 0004_api_accounts.sql 建立。
--
-- 帖子和评论是同一张表，reply_to_id 非空即评论。v1 只有一层评论，而正文校验、
-- 限流、软删、插件引用解析这四套逻辑对两者完全相同——分两张表就要写两遍，
-- 而且「评论能不能点赞」会变成一个需要新表的新问题。同表之后
-- community_likes 一张表天然同时覆盖帖子和评论。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,

  -- Markdown 纯文字。长度上限由 worker/lib/post-body.ts 校验，不写成 CHECK：
  -- 上限是产品策略会调的数字，改它不应该需要一次迁移。
  body        TEXT NOT NULL,

  -- 非空 = 这是某条帖子的评论。v1 只允许一层，即被指向的行自己必须
  -- reply_to_id IS NULL —— 跨行约束 SQLite 表达不了，由 Worker 保证。
  reply_to_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,

  -- 冗余计数：时间线每页都要显示它们，COUNT(*) 子查询会让每页多两次扫表。
  -- 写入方在同一个 db.batch() 里更新，D1 是单实例 SQLite，batch 即事务。
  like_count  INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),

  created_at  TEXT NOT NULL,

  -- 软删：保留行，读取层把正文换成占位。硬删会让一条被评论过的帖子
  -- 连带删掉整串讨论（ON DELETE CASCADE），别人的内容不该被作者删掉。
  deleted_at  TEXT
);

-- 时间线按 id 倒序翻页。id 单调自增，所以它既是时间序又是唯一游标，
-- 不会出现同一时间戳多条时翻页跳行或重复。
CREATE INDEX IF NOT EXISTS community_posts_feed_idx  ON community_posts (reply_to_id, id DESC);
CREATE INDEX IF NOT EXISTS community_posts_author_idx ON community_posts (author_id, id DESC);
-- 「热门」只看最近一段时间的候选，按时间过滤后在 Worker 里排序。
CREATE INDEX IF NOT EXISTS community_posts_recent_idx ON community_posts (created_at DESC);

CREATE TABLE IF NOT EXISTS community_likes (
  post_id    INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- 复合主键就是幂等：重复点赞是一次 INSERT OR IGNORE，不需要先查再写。
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS community_likes_user_idx ON community_likes (user_id);

-- 正文里解析出的插件引用。发帖时就解析并核对插件确实在目录里，
-- 读取时只做一次 JOIN；否则每次渲染时间线都要重新扫正文。
CREATE TABLE IF NOT EXISTS community_post_plugins (
  post_id              INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  normalized_plugin_id TEXT NOT NULL,
  -- 正文中出现的先后，决定卡片顺序。
  position             INTEGER NOT NULL,
  PRIMARY KEY (post_id, normalized_plugin_id)
) WITHOUT ROWID;
