
-- BE-05: knowledge_entries 增加全文搜索 + embedding 列
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS embedding_text text,
  ADD COLUMN IF NOT EXISTS tags           text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category       text DEFAULT 'general';

-- 全文搜索索引（Chinese-compatible tsvector on title + embedding_text）
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(embedding_text,''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_fts ON knowledge_entries USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user ON knowledge_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_category ON knowledge_entries (category);
