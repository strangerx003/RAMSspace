# RBD Analyzer — Requirements & Formulas

## Architecture
- **Frontend (UI only):** Data Register + RBD Sheet. Zero calculation logic.
- **Backend (private):** All reliability calculations. `server.py` `/api/analyze-rbd`
- **Data flow:** Data Register → localStorage → RBD Sheet → backend API → results

---

## Module 1: Data Register (`/data-register`)
- Component/LRU data entry table
- Fields: Component/LRU, Part No., λ, MTBF(hrs), MTTR(hrs), Op Time(H), Repair, FIT, FPMH
- Data auto-saved to localStorage on every edit (key: `rbd_component_data`)
- Components appear in RBD Sheet left panel (same key)
- Name is always shown; values (λ, MTBF, MTTR) shown only if present
- **Auto-derive:** Enter MTBF → lambda auto-fills (λ=1/MTBF). Enter lambda → MTBF auto-fills (MTBF=1/λ)

## Module 2: RBD Sheet (`/`)
- Drag-and-drop circuit builder
- Components reference Data Register via localStorage
- Block displays: Name (always), λ (if present), MTBF (if present), MTTR (if present)
- Connection modes: Straight (—) and Right-Angle (┐)
- Click line to select, press Delete to remove
- Run analysis calls backend API

---

## Inverse Relationships (auto-derived when one value is available)

| Given | Derived | Formula |
|-------|---------|---------|
| MTBF | λ | λ = 1 / MTBF |
| λ | MTBF | MTBF = 1 / λ |
| MTTR | μ | μ = 1 / MTTR |
| μ | MTTR | MTTR = 1 / μ |

> If only MTBF is entered, λ is calculated automatically. If only λ is entered, MTBF is calculated automatically. Same for MTTR/μ.

---

## Reliability Formulas

### a. Series Model
```
λs = λ1 + λ2

MTBF = 1 / λs

MTTRs = (λ1 × MTTR1 + λ2 × MTTR2) / λs
```
Where:
- λ1, λ2 = individual equipment failure rate
- λs = system failure rate
- MTTRi = repair time for unit i

> Series model: system fails if ANY one part fails.

### b. Parallel Model (Simple — availability-based)
```
λ_eq = λ1 + λ2 + ... + λn    (conservative availability equivalent)

MTBF = 1 / λ_eq

MTTRs = average(MTTR1, MTTR2, ..., MTTRn)
```

### c. Parallel Model (Markov — repairable, different failure rates)

For repairable parallel redundant units with different failure rates and repair rates:

```
μ1 = 1 / MTTR1
μ2 = 1 / MTTR2

MTBF = [μ1 × μ2 + (λ1 + λ2)(μ1 + μ2)] / [λ1 × λ2 × (λ1 + λ2 + μ1 + μ2)]

λs = 1 / MTBF

MTTRs = 1 / (n × μ)    where μ = average repair rate, n = number of parallel units
```

Where:
- μ = repair rate = 1 / MTTR
- λ = failure rate

> Parallel model: system works if EITHER part functions.
> Failures are immediately flagged, redundant components replaced without interrupting operation.

### d. Multiple Equipment Model (r out of n — r/n)

Failure rate formula:
```
λ = [n! / ((r-1)! × (n-r+1)!)] × λi^(n-r+1) × Ti^(n-r)
```

MTTR for Multiple Equipment Models:
```
MTTRs = 1 / ((n - r + 1) × μ)
```

Where:
- n = total number of identical units
- r = number of units required to operate out of n
- λi = failure rate of equipment
- Ti = Mean Time To Replace/Repair (MTTR) in hrs
- μ = repair rate = 1/MTTR

> This model: r out of n units must be working for satisfactory operation.
> If one or more parts fail, it does not affect operation (for PAS, PIDS & MCLK systems).

---

## Backend Functions (server.py)

| Function | Formula |
|----------|---------|
| `calc_series(b1, b2)` | λs = λ1+λ2; MTBF=1/λs; MTTR=(λ1*T1+λ2*T2)/λs |
| `calc_parallel_simple(blocks)` | λeq=Σλi; MTBF=1/λeq; MTTR=avg(Ti) |
| `calc_parallel_markov(b1, b2)` | Markov: MTBF=[μ1μ2+(λ1+λ2)(μ1+μ2)]/[λ1λ2(λ1+λ2+μ1+μ2)] |
| `calc_r_of_n(b1, n, r)` | C(n,r)×λi^(n-r+1)×Ti^(n-r); MTTR=1/((n-r+1)μ) |
| `analyze_rbd(payload)` | Union-Find topology → detects series/parallel → calls above functions |
