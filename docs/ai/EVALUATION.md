# 版本化模型评估

[evaluation-v1.json](evaluation-v1.json) 提供32个合成输入：8个四层脚本、8个翻译、8个知识引用、4个图片编辑、4个授权语音。案例包含币种、过敏原、未知认证、资料指令注入、版本引用、蒙版及原请求恢复。没有生产秘密或预填模型结果。

```sh
node scripts/evaluate_ai.mjs --check-dataset
node scripts/evaluate_ai.mjs --results /本地已归档结果/results.jsonl > /本地评估报告/report.json
node tests/ai_evaluation.test.mjs
```

工具只读取归档结果，不调用模型。每行JSONL保存 `sample_id`、`config_version`、`prompt_version`、`input_schema_version`、`kind`（`provider`或`fixture`）、`latency_ms`和`output`。同版本重复测量需不同 `run_id`。脚本输出可为原代码块正文或含 `full_content` 的结果，使用生产的纯解析契约。其他任务输出使用样本 `required_paths` 所列字段；知识引用使用 `citation_ids`，图片/语音记录实际字节摘要及原授权引用。

```json
{"sample_id":"translation-01","config_version":"实际配置版本UUID","prompt_version":"3","input_schema_version":1,"kind":"provider","latency_ms":1200,"usage":{"total_tokens":100},"cash":{"recorded":false},"output":{"translated":"容量与价格的实际译文","target_language":"en"},"review":{"facts":true,"language":true,"citations":true}}
```

示例仅展示字段形态，不是一次实际模型评估。`review` 由具备对应语言和业务知识的人员按样本 rubric 核对后填写；没有复核时省略，报告通过率为NULL。关键词约束不能证明事实正确；图片相似、文字保真、蒙版范围以及语音语义仍需原实物复核。一次协议替身测试不能计入真实供应商质量或费用。

报告按配置、Prompt、输入schema和调用类型分别汇总结构契约、人工事实/语言/引用复核、P50/P95耗时、token、现金账单，并列出未覆盖样本。缺失用量和现金单独计数；实际现金仅接受有核对凭证的 `recorded:true`、整数 `amount_minor` 和币种，不把未知成本填成0，不跨币种相加。零现金需有真实账单凭证。实际凭证通过运营原调用成本入口登记和归档。

本轮只运行评估工具、数据结构和协议回归。未调用真实供应商，未产生32例的实际质量/延迟/价格基线；配置变更接受仍需完成对应真实样本及人工复核。
