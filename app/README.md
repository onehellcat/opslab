# App service

This directory contains the Node.js API for OpsLab.

## Run locally

```bash
npm install
npm run dev
```

## Health endpoints

- GET /health/live
- GET /health/ready

## Key environment variables

```bash
PORT=3000
NODE_ENV=development
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=opslab
DATABASE_USER=opslab
DATABASE_PASSWORD=development
```

## Test commands

```bash
npm test
npm run build
```

## Reusable UI kit

Open `http://localhost:3000/ui-kit` for the component gallery. The standalone
stylesheet, usage notes, and examples live in `public/ui-kit/`.
