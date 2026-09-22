#!/usr/bin/env bash
# 启动 Neon 直连数据网关（7000 端口）。连接串只经环境变量/标准输入传入，不落盘。
# 用法：NEON_DSN=postgresql://… node 方式见下；或直接运行本脚本按提示粘贴连接串。
set -euo pipefail
cd /workspace/app
if [ -z "${NEON_DSN:-}" ]; then
  echo "请粘贴 Neon 连接串（postgresql:// 开头，输入不回显）：" >&2
  read -rs NEON_DSN
  export NEON_DSN
fi
mkdir -p logs
# 端口占用检查（容器无 lsof，用连接探测代替）
if python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',7000))==0 else 1)" 2>/dev/null; then
  echo "7000 端口已被占用，请先停止旧网关进程再启动" >&2
  exit 1
fi
nohup node server/neon-gateway.mjs >> logs/neon-gateway.log 2>&1 &
echo "网关已启动 pid $!，日志 logs/neon-gateway.log"
sleep 2
curl -sf http://127.0.0.1:7000/api/health && echo
