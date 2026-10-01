
-- llm_cache: 补充 prompt_hash, response_text, model, tokens_saved
ALTER TABLE llm_cache
  ADD COLUMN prompt_hash    text GENERATED ALWAYS AS (cache_key) STORED,
  ADD COLUMN response_text  text GENERATED ALWAYS AS (response::text) STORED,
  ADD COLUMN model          text,
  ADD COLUMN tokens_saved   integer NOT NULL DEFAULT 0;

-- cover_candidates: 补充 task_id (alias gen_task_id), status, style_prompt
ALTER TABLE cover_candidates
  ADD COLUMN task_id      text GENERATED ALWAYS AS (gen_task_id) STORED,
  ADD COLUMN status       text NOT NULL DEFAULT 'pending',
  ADD COLUMN style_prompt text;

-- video_jobs: 补充 job_type (alias action), input_data, output_data 别名列
ALTER TABLE video_jobs
  ADD COLUMN job_type   text GENERATED ALWAYS AS (action) STORED,
  ADD COLUMN input_data jsonb GENERATED ALWAYS AS (payload) STORED,
  ADD COLUMN output_data jsonb GENERATED ALWAYS AS (result) STORED;
