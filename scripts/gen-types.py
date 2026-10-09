#!/usr/bin/env python3
"""Regenerate src/integrations/supabase/types.ts (public schema) from the local test
database built by scripts/test-db.sh, in the same format as `supabase gen types`.
Only the public schema block and the enum Constants are rewritten; the helper types
around them are kept as they are.

    PGHOST=/var/run/postgresql bash scripts/test-db.sh && python3 scripts/gen-types.py
"""
import json, os, re, subprocess, sys

DB = os.environ.get("TEST_DB", "autoflow_test")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "integrations", "supabase", "types.ts")


def q(sql):
    r = subprocess.run(["psql", "-d", DB, "-At", "-c", sql], capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip() or "null")


enums = q("""
select coalesce(json_object_agg(t.typname, vals order by t.typname), '{}') from (
  select t.typname, json_agg(e.enumlabel order by e.enumsortorder) vals
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname) t""")

columns = q("""
select json_agg(json_build_object('rel', c.relname, 'kind', c.relkind, 'col', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
  'udt', t.typname, 'elem', et.typname, 'notnull', a.attnotnull, 'hasdef', a.atthasdef or a.attidentity <> '',
  'typtype', t.typtype, 'etyptype', et.typtype) order by c.relname, a.attname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_type t on t.oid = a.atttypid left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
where n.nspname = 'public' and c.relkind in ('r', 'v')""") or []

fks = q("""
select json_agg(json_build_object('rel', c.relname, 'name', con.conname,
  'cols', (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n),
  'ref', rc.relname,
  'refcols', (select json_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n),
  'one', exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
                 and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(con.conkey) x)))
  order by c.relname, con.conname)
from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'""") or []

funcs = q("""
select json_agg(json_build_object('name', p.proname, 'args', coalesce(p.proargnames, '{}'), 'modes', coalesce(p.proargmodes::text[], '{}'),
  'argtypes', (select json_agg(json_build_object('t', t.typname, 'tt', t.typtype, 'cat', t.typcategory, 'elem', et.typname) order by k.ord)
               from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality k(oid, ord)
               join pg_type t on t.oid = k.oid left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'),
  'nargs', p.pronargs, 'ndefaults', p.pronargdefaults, 'ret', rt.typname, 'rettt', rt.typtype, 'retset', p.proretset,
  'retcat', rt.typcategory, 'retelem', ret_e.typname) order by p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
left join pg_type ret_e on ret_e.oid = rt.typelem and rt.typcategory = 'A'
where n.nspname = 'public' and rt.typname not in ('trigger', 'event_trigger') and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')""") or []

SCALAR = {
    "uuid": "string", "text": "string", "varchar": "string", "bpchar": "string", "date": "string", "timestamptz": "string",
    "timestamp": "string", "time": "string", "timetz": "string", "interval": "string", "bytea": "string", "citext": "string",
    "int2": "number", "int4": "number", "int8": "number", "numeric": "number", "float4": "number", "float8": "number",
    "bool": "boolean", "json": "Json", "jsonb": "Json", "void": "undefined", "record": "Record<string, unknown>",
}


def ts_type(name, typtype=None, elem=None, elem_tt=None):
    if elem:  # array
        return ts_type(elem, elem_tt) + "[]"
    if typtype == "e" or name in enums:
        return f'Database["public"]["Enums"]["{name}"]'
    if typtype == "c":
        return f'Database["public"]["Tables"]["{name}"]["Row"]'
    return SCALAR.get(name, "unknown")


def array_type(udt, elem):
    if udt.startswith("_") and elem:
        return ts_type(elem) + "[]"
    return None


rels = {}
for c in columns:
    rels.setdefault(c["rel"], {"kind": c["kind"], "cols": []})["cols"].append(c)


def col_type(c):
    t = array_type(c["udt"], c["elem"]) or ts_type(c["udt"], c["typtype"])
    return t


def emit_table(name, info, indent="      "):
    lines = [f"{indent}{name}: {{"]
    row = [f"{indent}    {c['col']}: {col_type(c)}{'' if c['notnull'] and info['kind'] == 'r' else ' | null'}" for c in info["cols"]]
    lines += [f"{indent}  Row: {{", *row, f"{indent}  }}"]
    if info["kind"] == "r":
        ins = []
        for c in info["cols"]:
            opt = (not c["notnull"]) or c["hasdef"]
            ins.append(f"{indent}    {c['col']}{'?' if opt else ''}: {col_type(c)}{'' if c['notnull'] else ' | null'}")
        upd = [f"{indent}    {c['col']}?: {col_type(c)}{'' if c['notnull'] else ' | null'}" for c in info["cols"]]
        lines += [f"{indent}  Insert: {{", *ins, f"{indent}  }}", f"{indent}  Update: {{", *upd, f"{indent}  }}"]
    my = [f for f in fks if f["rel"] == name]
    if my:
        lines.append(f"{indent}  Relationships: [")
        for f in sorted(my, key=lambda f: f["name"]):
            lines += [
                f"{indent}    {{",
                f'{indent}      foreignKeyName: "{f["name"]}"',
                f"{indent}      columns: [{', '.join(json.dumps(x) for x in f['cols'])}]",
                f"{indent}      isOneToOne: {'true' if f['one'] else 'false'}",
                f'{indent}      referencedRelation: "{f["ref"]}"',
                f"{indent}      referencedColumns: [{', '.join(json.dumps(x) for x in f['refcols'])}]",
                f"{indent}    }},",
            ]
        lines.append(f"{indent}  ]")
    else:
        lines.append(f"{indent}  Relationships: []")
    lines.append(f"{indent}}}")
    return lines


def emit_function(f, indent="      "):
    names, modes, types = f["args"], f["modes"], f["argtypes"] or []
    ins, outs = [], []
    n_in = f["nargs"]
    for i, t in enumerate(types):
        mode = modes[i] if modes else "i"
        nm = names[i] if i < len(names) and names[i] else f"arg{i}"
        tt = ts_type(t["elem"], None) + "[]" if t["cat"] == "A" and t["elem"] else ts_type(t["t"], t["tt"])
        (ins if mode in ("i", "b") else outs).append((nm, tt))
        if mode == "b":
            outs.append((nm, tt))
    first_default = n_in - f["ndefaults"]
    lines = [f"{indent}{f['name']}: {{"]
    if ins:
        lines.append(f"{indent}  Args: {{")
        flagged = [(nm, tt, i >= first_default) for i, (nm, tt) in enumerate(ins)]
        for nm, tt, opt in sorted(flagged):
            lines.append(f"{indent}    {nm}{'?' if opt else ''}: {tt}")
        lines.append(f"{indent}  }}")
    else:
        lines.append(f"{indent}  Args: never")
    if outs:
        lines.append(f"{indent}  Returns: {{")
        for nm, tt in sorted(outs):
            lines.append(f"{indent}    {nm}: {tt}")
        lines.append(f"{indent}  }}[]")
    else:
        rt = ts_type(f["retelem"]) + "[]" if f["retcat"] == "A" and f["retelem"] else ts_type(f["ret"], f["rettt"])
        lines.append(f"{indent}  Returns: {rt}{'[]' if f['retset'] else ''}")
    lines.append(f"{indent}}}")
    return lines


out = ["  public: {", "    Tables: {"]
for name in sorted(n for n, i in rels.items() if i["kind"] == "r"):
    out += emit_table(name, rels[name])
out += ["    }", "    Views: {"]
views = sorted(n for n, i in rels.items() if i["kind"] == "v")
if views:
    for name in views:
        out += emit_table(name, rels[name])
else:
    out.append("      [_ in never]: never")
out += ["    }", "    Functions: {"]
seen = set()
for f in funcs:
    if f["name"] in seen:
        continue
    seen.add(f["name"])
    out += emit_function(f)
out += ["    }", "    Enums: {"]
for name, vals in sorted(enums.items()):
    out.append(f"      {name}: {' | '.join(json.dumps(v) for v in vals)}")
out += ["    }", "    CompositeTypes: {", "      [_ in never]: never", "    }", "  }"]
public_block = "\n".join(out)

src = open(OUT).read()
start = src.index("  public: {\n    Tables: {")
end = src.index("\n}\n\ntype DatabaseWithoutInternals")
src = src[:start] + public_block + src[end:]

const_lines = ["  public: {", "    Enums: {"]
for name, vals in sorted(enums.items()):
    const_lines.append(f"      {name}: [{', '.join(json.dumps(v) for v in vals)}],")
const_lines += ["    },", "  },"]
cstart = src.index("export const Constants = {\n") + len("export const Constants = {\n")
cend = src.index("} as const", cstart)
src = src[:cstart] + "\n".join(const_lines) + "\n" + src[cend:]
open(OUT, "w").write(src)
print(f"types.ts: {len([n for n, i in rels.items() if i['kind'] == 'r'])} tables, {len(views)} views, {len(seen)} functions, {len(enums)} enums")
