#!/bin/bash
set -e

if ! command -v ast-grep >/dev/null 2>&1; then
    echo "缺少 ast-grep，规则检查未执行。请安装 CLI 后重试。" >&2
    exit 127
fi

ast-grep scan -r .rules/SelectItem.yml

ast-grep scan -r .rules/contrast.yml

ast-grep scan -r .rules/supabase-google-sso.yml

ast-grep scan -r .rules/toast-hook.yml

ast-grep scan -r .rules/slot-nesting.yml

ast-grep scan -r .rules/require-button-interaction.yml

ast-grep scan -r .rules/supabase-edge-function-get-body.yml
