#!/bin/bash
set -e
mkdir -p /data

# 启动统计后端（DuckDB 数据在 /data）
DATA_DIR=/data \
UNI_API_URL="${UNI_API_URL:?UNI_API_URL is required}" \
ANALYTICS_DB_MEMORY_LIMIT_MB="${ANALYTICS_DB_MEMORY_LIMIT_MB:-128}" \
LISTEN_ADDR="127.0.0.1:8081" \
/app/analytics-api &
BACKEND_PID=$!

# 启动 nginx（前台）
nginx -g "daemon off;" &
NGINX_PID=$!

# 任一进程退出则整体退出
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?
kill $BACKEND_PID $NGINX_PID 2>/dev/null || true
exit $EXIT_CODE
