# Ghost Wallet Campaign — Verifiable Prize Draw

This repository contains the code and data for a fair prize draw for the Ghost Wallet Campaign. Anyone can independently verify the results using the exact same inputs.

## Why This Draw Is Verifiable

The draw uses a **commit-reveal** scheme with publicly auditable randomness:

1. **Commitment Phase** — This repository (code + participant snapshot) is published **before** the draw takes place. The algorithm is fixed and cannot be changed.

2. **Randomness Source** — We use the [NIST Randomness Beacon](https://beacon.nist.gov/), a public service that emits unpredictable random values every minute. The beacon values are:
   - **Unpredictable** — Even NIST cannot know future values
   - **Publicly verifiable** — Anyone can query the same timestamp and get the same value
   - **Immutable** — Historical beacon values cannot be altered

3. **Deterministic Execution** — Given the same snapshot and NIST beacon value, the draw algorithm produces identical results every time.

### The Verifiability Guarantee

Since the code and snapshot are published **before** the NIST timestamp is reached:
- We cannot manipulate the code to favor specific participants
- We cannot predict the random seed that will be used
- Anyone can re-run the draw and confirm the results match

---

## How the Draw Works

### Eligibility & Tickets

- Each participant's **INIT spent** during the campaign is recorded in `snapshot.csv`
- **1 ticket** is awarded per **100 INIT spent** (rounded down)
- More INIT spent = more tickets = higher chance of winning

### Prize Tiers

| Tier | Winners | INIT per Winner | Total INIT |
|------|---------|-----------------|------------|
| Grand Prize | 5 | 2,500 | 12,500 |
| Major Prize | 20 | 1,125 | 22,500 |
| Minor Prize | 50 | 300 | 15,000 |
| **Total** | **75** | — | **50,000** |

### Selection Process

1. Fetch the NIST Beacon value for the designated timestamp
2. Use the beacon's 512-bit output as a seed for a deterministic PRNG
3. For each prize tier (Grand → Major → Minor):
   - Perform weighted random selection based on ticket counts
   - Remove winners from the pool (each address can only win once)
4. Output all results to `draw_results.csv`

---

## Verifying the Results

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node.js)

### Steps

```bash
# 1. Clone this repository
git clone <repository-url>
cd gw-campaign-draw

# 2. Install dependencies
npm install

# 3. Run the draw with the official NIST timestamp
npx ts-node draw.ts snapshot.csv my_results.csv 1765881000000

# 4. Compare your results with the published draw_results.csv
diff my_results.csv draw_results.csv
```

If the diff shows no differences, the draw was conducted fairly.

---

## Official Draw Parameters

| Parameter | Value |
|-----------|-------|
| Snapshot File | `snapshot.csv` |
| NIST Beacon Timestamp | `1765881000000` (Tuesday, December 16, 2025 10:30:00 AM GMT) |
| Results File | `draw_results.csv` |

> **Note:** The NIST beacon timestamp is chosen to be after the snapshot has been taken, and is made public before the draw. This ensures the randomness could not influence or alter the participant list.

---

## File Reference

| File | Description |
|------|-------------|
| `snapshot.csv` | Participant addresses and INIT spent (frozen at campaign end) |
| `draw.ts` | The draw algorithm (TypeScript) |
| `draw_results.csv` | Official results (generated after the draw) |
| `package.json` | Node.js dependencies |

---

## Technical Details

### NIST Beacon API

The draw fetches randomness from:
```
https://beacon.nist.gov/beacon/2.0/pulse/time/{unix_timestamp}
```

The `outputValue` field (512-bit hex string) is used as the random seed.

### PRNG Algorithm

The code uses **Mulberry32**, a simple and fast 32-bit PRNG. The NIST beacon output is hashed down to a 32-bit seed, then used to generate all random selections deterministically.

