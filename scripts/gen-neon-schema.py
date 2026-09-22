#!/usr/bin/env python3
"""从在线数据服务导出 schema，生成 Neon(Postgres) DDL -> scripts/neon-schema.sql

用法：PB_ADMIN=<管理邮箱> PB_PASS=<管理密码> python3 scripts/gen-neon-schema.py
"""
import json, os, subprocess, sys

PB = os.environ.get("PB_URL", "http://127.0.0.1:7000")
ADMIN = os.environ.get("PB_ADMIN")
PASS = os.environ.get("PB_PASS")
if not ADMIN or not PASS:
    sys.exit("缺少 PB_ADMIN / PB_PASS 环境变量")

TYPE = {
    "text": "text", "email": "text", "url": "text", "editor": "text",
    "password": "text", "file": "text", "number": "double precision",
    "bool": "boolean", "json": "jsonb", "date": "timestamptz",
    "autodate": "timestamptz", "relation": "text", "select": "text",
}

def curl(method, path, token=None, body=None):
    cmd = ["curl", "-s", "-X", method, PB + path, "-H", "Content-Type: application/json"]
    if token:
        cmd += ["-H", f"Authorization: {token}"]
    if body:
        cmd += ["-d", json.dumps(body)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)

auth = curl("POST", "/api/collections/_superusers/auth-with-password",
            body={"identity": ADMIN, "password": PASS})
token = auth["token"]
cols = curl("GET", "/api/collections?perPage=200", token)

def colname(fn):
    """camelCase -> snake_case，统一小写（Postgres 未加引号标识符即小写）"""
    s = "".join(("_" + ch.lower()) if ch.isupper() else ch for ch in fn)
    return s.lower()

out = [
    "-- Neon(Postgres) 表结构：由现有数据服务 schema 自动生成",
    "-- id 为主键(text)；created/updated 为时间戳；业务字段按原类型映射(text/number/bool/json)",
    "-- 列名统一 snake_case 小写并加引号（desc 等保留字可用；emailVisibility -> email_visibility）",
    "",
]
n_tables = 0
for c in cols["items"]:
    name = c["name"]
    if name.startswith("_"):
        continue
    n_tables += 1
    lines = ["id text PRIMARY KEY"]
    fields = c.get("fields", [])
    seen = set()
    for f in fields:
        fn, ft = f.get("name"), f.get("type")
        if fn in ("id", "created", "updated", "tokenKey"):
            continue  # tokenKey 是会话签名密钥，不进镜像库
        cn = colname(fn)
        if cn in seen:
            continue
        seen.add(cn)
        pgt = "text" if ft == "password" else TYPE.get(ft, "jsonb")
        if ft == "password":
            cn = "password_hash"
        lines.append(f'"{cn}" {pgt}')
    lines.append("created timestamptz NOT NULL DEFAULT now()")
    lines.append("updated timestamptz NOT NULL DEFAULT now()")
    lines.append("synced_at timestamptz NOT NULL DEFAULT now()")
    out.append(f"CREATE TABLE IF NOT EXISTS {name} (")
    out.append(",\n".join("  " + l for l in lines))
    out.append(");")
    for f in fields:
        fn = f.get("name")
        if fn.endswith("_sid") or fn in ("email", "sid"):
            cn = "password_hash" if f.get("type") == "password" else colname(fn)
            uniq = "UNIQUE " if (fn == "sid") or (name == "users" and fn == "email") else ""
            out.append(f'CREATE {uniq}INDEX IF NOT EXISTS idx_{name}_{cn} ON {name} ("{cn}");')
    out.append("")

open("scripts/neon-schema.sql", "w").write("\n".join(out))
print(f"ok: {n_tables} tables -> scripts/neon-schema.sql")
