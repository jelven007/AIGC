import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseScriptResult } from '../supabase/functions/_shared/script-result.ts';

export function checkDataset(dataset) {
  if (!dataset?.version || !Array.isArray(dataset.samples) || !dataset.samples.length) throw new Error('评估样本集不正确');
  const seen = new Set();
  for (const sample of dataset.samples) {
    if (!sample.id || seen.has(sample.id) || !['script', 'translation', 'knowledge', 'image_edit', 'voice'].includes(sample.task)
      || !sample.input || !Array.isArray(sample.checks?.required_paths)) throw new Error('评估样本ID、任务或契约不正确');
    seen.add(sample.id);
  }
}
export function evaluateSamples(dataset, records) {
  checkDataset(dataset);
  const samples = new Map(dataset.samples.map(sample => [sample.id, sample])), groups = new Map(), seen = new Set();
  for (const row of records) {
    const sample = samples.get(row.sample_id);
    if (!sample) throw new Error('未知评估样本');
    if (!row.config_version || !row.prompt_version || !row.input_schema_version || !['provider', 'fixture'].includes(row.kind)
      || !Number.isFinite(row.latency_ms) || row.latency_ms < 0) throw new Error('评估版本或耗时不正确');
    const key = JSON.stringify([row.config_version, row.prompt_version, row.input_schema_version, row.kind]);
    const unique = `${key}:${row.sample_id}:${row.run_id || '1'}`;
    if (seen.has(unique)) throw new Error('重复版本样本，请明确独立run_id');
    seen.add(unique);
    if (!groups.has(key)) groups.set(key, { config_version: row.config_version, prompt_version: row.prompt_version,
      input_schema_version: row.input_schema_version, kind: row.kind, structure: { passed: 0, total: 0 },
      facts: { reviewed: 0, passed: 0 }, language: { reviewed: 0, passed: 0 }, citations: { reviewed: 0, passed: 0 },
      usage: { total_tokens: 0, unrecorded: 0 }, cash: { totals: {}, unrecorded: 0 }, latencies: [], samples: [] });
    const group = groups.get(key);
    let output = row.output, valid = true;
    try {
      if (sample.task === 'script') output = parseScriptResult(typeof output === 'string' ? output : output?.full_content);
      for (const path of sample.checks.required_paths) {
        const value = path.split('.').reduce((parent, field) => parent?.[field], output);
        if (value == null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length) valid = false;
      }
      if (sample.task === 'translation' && output?.target_language !== sample.input.target_language) valid = false;
      for (const claim of sample.checks.forbidden_claims || []) if (JSON.stringify(output).includes(claim)) valid = false;
      if (sample.checks.citations && (!Array.isArray(output?.citation_ids)
        || output.citation_ids.some(id => !sample.checks.citations.includes(id))
        || !output.citation_ids.length)) valid = false;
    } catch { valid = false; }
    group.structure.total++; if (valid) group.structure.passed++;
    for (const dimension of ['facts', 'language', 'citations']) {
      if (typeof row.review?.[dimension] === 'boolean') {
        group[dimension].reviewed++; if (row.review[dimension]) group[dimension].passed++;
      }
    }
    if (row.usage?.total_tokens != null) {
      if (!Number.isSafeInteger(row.usage.total_tokens) || row.usage.total_tokens < 0) throw new Error('评估Token用量不正确');
      group.usage.total_tokens += row.usage.total_tokens;
    } else group.usage.unrecorded++;
    if (row.cash?.recorded === true) {
      if (!Number.isSafeInteger(row.cash.amount_minor) || row.cash.amount_minor < 0
        || !['CNY', 'USD', 'EUR'].includes(row.cash.currency)) throw new Error('评估现金账单不正确');
      group.cash.totals[row.cash.currency] = (group.cash.totals[row.cash.currency] || 0) + row.cash.amount_minor;
    } else group.cash.unrecorded++;
    group.latencies.push(row.latency_ms);
    group.samples.push({ sample_id: row.sample_id, run_id: row.run_id || '1', structure: valid });
  }
  for (const group of groups.values()) {
    group.structure.pass_rate = group.structure.passed / group.structure.total;
    for (const dimension of ['facts', 'language', 'citations']) group[dimension].pass_rate =
      group[dimension].reviewed ? group[dimension].passed / group[dimension].reviewed : null;
    group.latencies.sort((a, b) => a - b);
    group.latency_ms = { p50: group.latencies[Math.ceil(group.latencies.length * .5) - 1],
      p95: group.latencies[Math.ceil(group.latencies.length * .95) - 1] };
    const completed = new Set(group.samples.map(sample => sample.sample_id));
    group.coverage = { distinct_samples: completed.size,
      missing_sample_ids: dataset.samples.filter(sample => !completed.has(sample.id)).map(sample => sample.id) };
    delete group.latencies;
  }
  return { dataset_version: dataset.version, expected_samples: dataset.samples.length, groups: [...groups.values()] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { dataset: { type: 'string', default: 'docs/ai/evaluation-v1.json' },
    results: { type: 'string' }, 'check-dataset': { type: 'boolean' } } });
  const dataset = JSON.parse(readFileSync(values.dataset, 'utf8'));
  checkDataset(dataset);
  if (values['check-dataset']) console.log(JSON.stringify({ version: dataset.version, samples: dataset.samples.length }));
  else {
    if (!values.results) throw new Error('请提供已归档JSONL结果 --results；此工具不会调用真实模型');
    const records = readFileSync(values.results, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    console.log(JSON.stringify(evaluateSamples(dataset, records), null, 2));
  }
}
