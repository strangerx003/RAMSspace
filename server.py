"""
RBD Analyzer — Backend
All reliability calculations happen here.
Component data stored in-memory (with file fallback for local dev).
"""
import math, os, json
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

COMP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "components.json")
_in_memory_store = []

def load_components():
    global _in_memory_store
    if _in_memory_store:
        return list(_in_memory_store)
    if os.path.exists(COMP_FILE):
        try:
            with open(COMP_FILE, "r", encoding="utf-8") as f:
                _in_memory_store = json.load(f)
                return list(_in_memory_store)
        except Exception:
            pass
    return []

def save_components(data):
    global _in_memory_store
    _in_memory_store = list(data)
    try:
        with open(COMP_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════
#  HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════

def fmt_sci(val):
    return f"{val:.2e}"

def fmt_indian(num):
    s = str(int(round(num)))
    if len(s) <= 3:
        return s
    last3 = s[-3:]
    rest = s[:-3]
    parts = []
    while len(rest) > 2:
        parts.append(rest[-2:])
        rest = rest[:-2]
    if rest:
        parts.append(rest)
    parts.reverse()
    return ",".join(parts) + "," + last3


# ══════════════════════════════════════════════════════════════════════
#  RELIABILITY FORMULAS
# ══════════════════════════════════════════════════════════════════════

def calc_series(blocks):
    """
    Series (N components):
      λs = λ1 + λ2 + ... + λn
      MTBF = 1 / λs
      MTTRs = (Σ λi × MTTRi) / λs
    """
    total_lambda = sum(b["lambda"] for b in blocks)
    mtbf = 1.0 / total_lambda if total_lambda > 0 else 0
    mttr = sum(b["lambda"] * b["mttr"] for b in blocks) / total_lambda if total_lambda > 0 else 0
    formula = " + ".join(fmt_sci(b["lambda"]) for b in blocks)
    result = f"lambda={fmt_sci(total_lambda)}, MTBF={fmt_indian(mtbf)} hrs, MTTR={mttr:.1f} hrs"
    return total_lambda, mtbf, mttr, formula, result


def calc_parallel_markov(b1, b2):
    """
    Parallel Markov (2 components, repairable):
      μ1=1/MTTR1, μ2=1/MTTR2
      MTBF = [μ1μ2 + (λ1+λ2)(μ1+μ2)] / [λ1λ2(λ1+λ2+μ1+μ2)]
      λs = 1/MTBF
      MTTRs = 1/(n×μ_avg)
    """
    l1, l2 = b1["lambda"], b2["lambda"]
    t1 = b1["mttr"] if b1["mttr"] > 0 else 1
    t2 = b2["mttr"] if b2["mttr"] > 0 else 1
    mu1, mu2 = 1.0 / t1, 1.0 / t2

    num = mu1 * mu2 + (l1 + l2) * (mu1 + mu2)
    den = l1 * l2 * (l1 + l2 + mu1 + mu2)
    mtbf = num / den if den > 0 else 0
    ls = 1.0 / mtbf if mtbf > 0 else 0
    avg_mu = (mu1 + mu2) / 2
    mttr = 1.0 / (2 * avg_mu) if avg_mu > 0 else 0

    formula = f"[μ1μ2+(λ1+λ2)(μ1+μ2)]/[λ1λ2(λ1+λ2+μ1+μ2)]"
    result = f"lambda={fmt_sci(ls)}, MTBF={fmt_indian(mtbf)} hrs, MTTR={mttr:.1f} hrs"
    return ls, mtbf, mttr, formula, result


def calc_parallel_simple(blocks):
    """
    Parallel (N components): pairwise Markov reduction.
    """
    if len(blocks) == 2:
        return calc_parallel_markov(blocks[0], blocks[1])

    working = list(blocks)
    while len(working) > 2:
        b1 = working.pop(0)
        b2 = working.pop(0)
        ls, mtbf, mttr, _, _ = calc_parallel_markov(b1, b2)
        eq = {"name": b1["name"] + "||" + b2["name"], "lambda": ls, "mtbf": mtbf, "mttr": mttr}
        working.insert(0, eq)

    ls, mtbf, mttr, _, _ = calc_parallel_markov(working[0], working[1])
    formula = " + ".join(fmt_sci(b["lambda"]) for b in blocks)
    result = f"lambda={fmt_sci(ls)}, MTBF={fmt_indian(mtbf)} hrs, MTTR={mttr:.1f} hrs"
    return ls, mtbf, mttr, formula, result


def calc_r_of_n(b1, n, r):
    """
    r-out-of-n:
      λ = C(n,r) × λi^(n-r+1) × Ti^(n-r)
      MTTRs = 1/((n-r+1)μ)
    """
    l1 = b1["lambda"]
    t1 = b1["mttr"] if b1["mttr"] > 0 else 1
    mu = 1.0 / t1
    coeff = math.factorial(n) / (math.factorial(r - 1) * math.factorial(n - r + 1))
    ls = coeff * (l1 ** (n - r + 1)) * (t1 ** (n - r))
    mtbf = 1.0 / ls if ls > 0 else 0
    mttr = 1.0 / ((n - r + 1) * mu) if mu > 0 else 0
    formula = f"C({n},{r}) * {fmt_sci(l1)}^{n-r+1} * {fmt_sci(t1)}^{n-r}"
    result = f"lambda={fmt_sci(ls)}, MTBF={fmt_indian(mtbf)} hrs, MTTR={mttr:.1f} hrs"
    return ls, mtbf, mttr, formula, result


# ══════════════════════════════════════════════════════════════════════
#  MAIN ANALYSIS ENGINE
# ══════════════════════════════════════════════════════════════════════

def analyze_rbd(payload):
    blocks = payload.get("blocks", [])
    connections = payload.get("connections", [])

    if not blocks:
        return {"error": "No blocks provided."}
    if not connections:
        return {"error": "No connections provided."}

    # Derive values — MTBF is always authoritative
    for b in blocks:
        l = b.get("lambda", 0)
        mb = b.get("mtbf", 0)
        t = b.get("mttr", 0)
        if mb > 0:
            b["lambda"] = 1.0 / mb
        elif l > 0:
            b["mtbf"] = 1.0 / l
        if t > 0:
            b["mu"] = 1.0 / t

    # Union-Find
    parent = {}

    def find(key):
        if key not in parent:
            parent[key] = key
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    def port_key(bid, side):
        return f"b{bid}-{side}"

    def node_of(bid, side):
        return find(port_key(bid, side))

    for b in blocks:
        find(port_key(b["id"], "left"))
        find(port_key(b["id"], "right"))

    for c in connections:
        union(port_key(c["from"]["blockId"], c["from"]["side"]),
              port_key(c["to"]["blockId"], c["to"]["side"]))

    remaining = list(blocks)
    steps = []

    for _ in range(50):
        if len(remaining) <= 1:
            break

        simplified = False

        # Parallel
        pair_map = {}
        for b in remaining:
            key = tuple(sorted([node_of(b["id"], "left"), node_of(b["id"], "right")]))
            pair_map.setdefault(key, []).append(b)

        for pair_key, group in pair_map.items():
            if len(group) >= 2:
                ls, mtbf, mttr, formula, result = calc_parallel_simple(group)
                steps.append({"type": "parallel", "blocks": [g["name"] for g in group], "formula": formula, "result": result})
                eq_id = -(len(steps) + 1)
                eq = {"id": eq_id, "name": "Eq", "lambda": ls, "mtbf": mtbf, "mttr": mttr, "opTime": 0, "repair": "Repairable"}
                find(port_key(eq_id, "left"))
                find(port_key(eq_id, "right"))
                union(port_key(eq_id, "left"), pair_key[0])
                union(port_key(eq_id, "right"), pair_key[1])
                for g in group:
                    remaining.remove(g)
                remaining.append(eq)
                simplified = True
                break

        if simplified:
            continue

        # Series
        found = False
        for b in remaining:
            b_right = node_of(b["id"], "right")
            candidates = [ob for ob in remaining if ob["id"] != b["id"] and node_of(ob["id"], "left") == b_right]
            if len(candidates) != 1:
                continue
            nb = candidates[0]
            all_at = [ob for ob in remaining if node_of(ob["id"], "left") == b_right or node_of(ob["id"], "right") == b_right]
            if len(all_at) != 2:
                continue

            b_left = node_of(b["id"], "left")
            nb_right = node_of(nb["id"], "right")
            ls, mtbf, mttr, formula, result = calc_series([b, nb])
            steps.append({"type": "series", "blocks": [b["name"], nb["name"]], "formula": formula, "result": result})
            eq_id = -(len(steps) + 1)
            eq = {"id": eq_id, "name": "Eq", "lambda": ls, "mtbf": mtbf, "mttr": mttr, "opTime": 0, "repair": "Repairable"}
            find(port_key(eq_id, "left"))
            find(port_key(eq_id, "right"))
            union(port_key(eq_id, "left"), b_left)
            union(port_key(eq_id, "right"), nb_right)
            remaining.remove(b)
            remaining.remove(nb)
            remaining.append(eq)
            found = True
            break

        if not found:
            break

    # Final
    if len(remaining) == 0:
        final_lambda = final_mtbf = final_mttr = 0
    elif len(remaining) == 1:
        final_lambda = remaining[0]["lambda"]
        final_mtbf = remaining[0]["mtbf"]
        final_mttr = remaining[0]["mttr"]
    else:
        final_lambda = sum(b["lambda"] for b in remaining)
        final_mtbf = 1.0 / final_lambda if final_lambda > 0 else 0
        final_mttr = sum(b["mttr"] for b in remaining) / len(remaining)
        names = [b["name"] for b in remaining]
        lambdas = [fmt_sci(b["lambda"]) for b in remaining]
        steps.append({"type": "final_series", "blocks": names, "formula": " + ".join(lambdas),
                      "result": f"lambda={fmt_sci(final_lambda)}, MTBF={fmt_indian(final_mtbf)} hrs, MTTR={final_mttr:.1f} hrs"})

    avail = final_mtbf / (final_mtbf + final_mttr) if (final_mtbf + final_mttr) > 0 else 0
    result_label = "System Reliability"
    result_value = (f"lambda = {fmt_sci(final_lambda)} failures/hr | MTBF = {fmt_indian(final_mtbf)} hrs | MTTR = {final_mttr:.1f} hrs | Availability = {avail*100:.4f}%")

    return {"steps": steps, "result_label": result_label, "result_value": result_value,
            "block_count": len(blocks), "connection_count": len(connections)}


# ══════════════════════════════════════════════════════════════════════
#  STATIC FILE SERVING
# ══════════════════════════════════════════════════════════════════════

def serve_file(filename):
    base = os.path.dirname(os.path.abspath(__file__))
    filepath = os.path.join(base, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    resp = Response(content, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/")
def index():
    return serve_file("index.html")


@app.route("/rbd")
def rbd():
    return serve_file("rbd.html")


@app.route("/api/analyze-rbd", methods=["POST"])
def api_analyze_rbd():
    data = request.get_json(force=True)
    result = analyze_rbd(data)
    return jsonify(result)


@app.route("/api/components", methods=["GET"])
def api_get_components():
    return jsonify(load_components())


@app.route("/api/components", methods=["POST"])
def api_save_components():
    data = request.get_json(force=True)
    save_components(data)
    return jsonify({"ok": True, "count": len(data)})


if __name__ == "__main__":
    import webbrowser
    print("Server: http://localhost:5000")
    webbrowser.open("http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
