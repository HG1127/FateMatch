#!/usr/bin/env bash
# 启动数据网关看门狗（网关崩溃/假死自动拉起，端口 7000）。
# 连接串只经环境变量/标准输入传入，不落盘：
# - 已有网关在跑：看门狗从其进程内存接管连接串，停旧进程后重新拉起并看护
# - 冷启动（容器重启后）：需 NEON_DSN 环境变量，或按提示粘贴
# 停止：kill -TERM <看门狗pid>（会连同网关子进程一起干净退出）
set -euo pipefail
cd /workspace/app
mkdir -p logs

STATE=$(python3 - <<'PYEOF'
import os
wd = gw = ''
for pid in os.listdir('/proc'):
    if not pid.isdigit(): continue
    try:
        cmd = open(f'/proc/{pid}/cmdline','rb').read().decode(errors='ignore').split('\0')
    except Exception: continue
    if not cmd or not cmd[0].endswith('node'): continue
    if any(a.endswith('gateway-watchdog.mjs') for a in cmd):
        wd = pid; continue
    if len(cmd) > 1 and cmd[1] == 'server/neon-gateway.mjs':
        try: env = open(f'/proc/{pid}/environ','rb').read().decode(errors='ignore')
        except Exception: env = ''
        if not any(l.startswith('NEON_SCHEMA=') for l in env.split('\0')): gw = pid
print(f"{wd} {gw}")
PYEOF
)
WD_RUNNING="${STATE% *}"
GW_RUNNING="${STATE#* }"

if [ -n "$WD_RUNNING" ]; then
  echo "看门狗已在运行（pid $WD_RUNNING），无需重复启动" >&2
  exit 0
fi

if [ -z "${NEON_DSN:-}" ] && [ -z "$GW_RUNNING" ]; then
  echo "请粘贴 Neon 连接串（postgresql:// 开头，输入不回显）：" >&2
  read -rs NEON_DSN
  export NEON_DSN
fi

nohup node scripts/gateway-watchdog.mjs >/dev/null 2>>logs/watchdog.log &
echo "看门狗已启动 pid $!，日志 logs/watchdog.log（网关日志 logs/neon-gateway.log）"
[ -n "$GW_RUNNING" ] && echo "将接管现有网关 pid $GW_RUNNING（停旧拉新，约 20 秒）"

# 等待网关就绪：接管模式要先停旧进程再拉起，新进程需拉表结构与签名密钥
for _ in $(seq 1 45); do
  sleep 2
  if curl -sf http://127.0.0.1:7000/api/health >/dev/null 2>&1; then
    echo "网关就绪：$(curl -sf http://127.0.0.1:7000/api/health)"
    exit 0
  fi
done
echo "网关未在 90 秒内就绪，请查看 logs/watchdog.log 与 logs/neon-gateway.log" >&2
exit 1
