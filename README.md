# RAMSspace

Reliability, Availability, Maintainability & Safety (RAMS) analysis tool for Reliability Block Diagram (RBD) modeling.

## Live Demo

**https://ramsspace001.vercel.app**

## Features

- **Data Register** — Register and manage components/LRUs with reliability parameters (λ, MTBF, MTTR, Op Time)
- **RBD Sheet** — Drag-and-drop circuit builder with series/parallel topology detection
- **Backend Analysis** — All reliability formulas computed server-side (Series N-component, Parallel Markov, R-out-of-N)
- **Real-time Results** — MTBF, MTTR, λ, Availability calculations with step-by-step breakdown

## Pages

| Page | URL |
|------|-----|
| Data Register | https://ramsspace001.vercel.app/ |
| RBD Sheet | https://ramsspace001.vercel.app/rbd |

## Local Development

```bash
pip install flask
python server.py
# Opens http://localhost:5000
```

## Docker

```bash
docker build -t ramsspace .
docker run -p 5000:5000 ramsspace
```

## Tech Stack

- **Frontend:** Vanilla JS, HTML5, CSS3, SVG
- **Backend:** Python Flask
- **Hosting:** Vercel (serverless)
