# MongoDB Docker Installation and Daily Startup Guide

Date: 7 March 2026
Workspace: `/home/shadowfox/Documents/GST MODULE`

## Why this guide
This project backend (`server/app.js`) requires MongoDB at `127.0.0.1:27017`.
If MongoDB is not running, backend startup fails with connection refused.

## Recommended approach (Docker)
Use Docker MongoDB instead of host `mongod` binary.
This avoids local binary issues like `illegal hardware instruction`.

## Prerequisites
- Docker installed
- Docker daemon running

Check:

```bash
docker --version
docker info > /dev/null && echo "Docker daemon is running"
```

## One-time setup
Run once to create container + persistent volume:

```bash
docker run -d \
  --name gst-mongo \
  -p 27017:27017 \
  -v gst_mongo_data:/data/db \
  mongo:4.4
```

## Daily startup
Start MongoDB container:

```bash
docker start gst-mongo
```

Verify:

```bash
docker ps --filter "name=gst-mongo"
```

Expected: container status should be `Up` and port mapping should include `0.0.0.0:27017->27017/tcp`.

## Start backend after MongoDB
From project root:

```bash
node server/app.js
```

Health check:

```bash
curl http://localhost:3000/api/health
```

Expected JSON:

```json
{"status":"healthy", ...}
```

## Full daily flow (copy/paste)

```bash
cd "/home/shadowfox/Documents/GST MODULE"
docker start gst-mongo
node server/app.js
```

In another terminal:

```bash
curl http://localhost:3000/api/health
```

Open frontend:
- `http://localhost:3000`

## Recommended daily flow (npm scripts)
From project root:

```bash
npm run app:start
```

This command will:
- start existing `gst-mongo` container (or create it if missing)
- start backend server (`server/app.js`)

Useful commands:

```bash
npm run app:dev
npm run app:status
npm run mongo:stop
```

## Stop commands
Stop backend: `Ctrl + C` in backend terminal.

Stop MongoDB:

```bash
docker stop gst-mongo
```

## Troubleshooting

### 1) `connect ECONNREFUSED 127.0.0.1:27017`
Cause: MongoDB not running.

Fix:

```bash
docker start gst-mongo
docker ps --filter "name=gst-mongo"
```

### 2) `zsh: illegal hardware instruction mongod ...`
Cause: Host MongoDB binary incompatibility with machine CPU/instruction set.

Fix:
- Prefer Docker MongoDB (`mongo:4.4`) as above.
- Do not rely on host `mongod` for this project.

### 3) Docker container name already in use
Use existing container instead of creating new one:

```bash
docker start gst-mongo
```

### 4) Port 27017 already in use
Find process/container using port:

```bash
sudo lsof -i :27017
```

If another Mongo container is using it, stop/remove conflicting container.

## Note
`npm run dev` in this repository is GST CLI watch mode, not frontend web server mode.
For web app start, use `npm run app:start`.
