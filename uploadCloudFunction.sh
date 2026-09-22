#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 可选：从项目根目录的 .env 读取本机 CLI、云环境和项目路径。
# .env 已被 .gitignore 排除；公开仓库只保留 .env.example。
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/.env"
  set +a
fi

: "${WECHAT_CLI_PATH:?请在 .env 中设置 WECHAT_CLI_PATH}"
: "${WECHAT_CLOUD_ENV_ID:?请在 .env 中设置 WECHAT_CLOUD_ENV_ID}"

PROJECT_PATH=${WECHAT_PROJECT_PATH:-$SCRIPT_DIR}
FUNCTION_NAME=${1:?用法：./uploadCloudFunction.sh 云函数目录名}

"$WECHAT_CLI_PATH" cloud functions deploy \
  --e "$WECHAT_CLOUD_ENV_ID" \
  --n "$FUNCTION_NAME" \
  --r \
  --project "$PROJECT_PATH"
