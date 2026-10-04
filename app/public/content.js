// Teaching copy for the interactive guide. Behaviour lives in app.js and labs.js.
const stages = {
  checkout: {
    kicker: 'STAGE 01 · SOURCE',
    title: 'Bring the exact code into the runner',
    body: 'GitHub Actions creates a fresh, temporary Ubuntu virtual machine for every job. The checkout action downloads the selected Git commit into that machine so later commands can read the same files you reviewed.',
    why: 'A clean runner prevents files from an older build from changing the result. Pinning the work to one commit also makes a failed run reproducible: you can check out the same SHA locally and investigate identical source.',
    verify: 'Open .github/workflows/ci.yml and find actions/checkout@v4.',
    command: 'actions/checkout@v4',
    facts: [
      ['Runner', 'ubuntu-latest'],
      ['Trigger', 'push / pull_request'],
      ['Input', 'Git commit'],
    ],
  },
  install: {
    kicker: 'STAGE 02 · DEPENDENCIES',
    title: 'Reproduce the dependency tree',
    body: 'npm ci deletes any existing dependency tree and installs the exact package versions recorded in package-lock.json. It stops if package.json and the lockfile disagree instead of silently rewriting the lockfile.',
    why: 'The lockfile turns a broad request such as “Fastify 5 compatible” into one repeatable dependency graph. CI and a developer laptop therefore test the same transitive packages, reducing “works on my machine” failures.',
    verify: 'Compare package.json with package-lock.json, then run npm ci in app/.',
    command: 'npm ci',
    facts: [
      ['Runtime', 'Node.js 22'],
      ['Cache', 'npm lock hash'],
      ['Input', 'package-lock.json'],
    ],
  },
  verify: {
    kicker: 'STAGE 03 · QUALITY GATE',
    title: 'Prove the change is safe to package',
    body: 'TypeScript first checks every typed boundary without emitting JavaScript. Vitest then creates the Fastify application in memory and injects HTTP requests into it. CI supplies PostgreSQL 16 so database behavior can be exercised without a separately managed server.',
    why: 'These checks fail before an image is published. Type checking catches mismatched assumptions at build time, while request-level tests prove routes, status codes, headers, and response bodies behave together.',
    verify: 'Run npm run lint and npm test from app/; inspect app/tests/server.test.ts.',
    command: 'npm run lint && npm test',
    facts: [
      ['Database', 'Postgres 16 Alpine'],
      ['Typecheck', 'tsc --noEmit'],
      ['Tests', 'Vitest + inject'],
    ],
  },
  image: {
    kicker: 'STAGE 04 · ARTIFACT',
    title: 'Turn source into a portable image',
    body: 'The Dockerfile uses one stage to compile TypeScript and a second stage for runtime files only. The final image contains the compiled server, public assets, and production dependencies, then starts the process as the unprivileged node user.',
    why: 'The image becomes the immutable delivery unit used in every environment. A smaller runtime image downloads faster, exposes fewer unnecessary tools, and limits damage if the application process is compromised.',
    verify: 'Run docker history opslab-api:test after building to inspect its layers.',
    command: 'docker build -t opslab-api:test .',
    facts: [
      ['Base', 'node:22-alpine'],
      ['User', 'node (non-root)'],
      ['Port', 'TCP 3000'],
    ],
  },
};
const views = {
  compose: {
    html: '<div class="flow"><div class="node active" data-node="browser"><span class="node-icon">◎</span><b>Your browser</b><small>localhost:3000</small></div><span class="arrow">→</span><div class="stack"><div class="node" data-node="api"><span class="node-icon">⬡</span><b>Fastify API</b><small>api container :3000</small></div><div class="node" data-node="db"><span class="node-icon">▱</span><b>PostgreSQL 16</b><small>postgres :5432</small></div></div></div>',
    first: 'browser',
    nodes: {
      browser: [
        'Host → container NAT',
        'The browser connects to localhost:3000 on your host. Docker owns that listening port and forwards each TCP connection to port 3000 in the api container; the browser does not need to know the container address.',
        [
          ['Address', 'localhost:3000'],
          ['Protocol', 'HTTP/1.1'],
          ['Mapping', '3000:3000'],
        ],
        'docker-compose.yml · ports',
        'Port publishing creates the explicit bridge from your host into an otherwise isolated container network.',
        'Run docker compose ps and compare the PORTS column with the Compose file.',
      ],
      api: [
        'Fastify application',
        'The Node.js process listens on 0.0.0.0, meaning every network interface inside the container rather than loopback only. Compose injects DATABASE_HOST=postgres, so the app can locate the database by service name.',
        [
          ['Image', 'opslab-api:local'],
          ['Process', 'node dist/server.js'],
          ['DB host', 'postgres'],
        ],
        'app/src/server.ts',
        'Binding and DNS solve different reachability problems: 0.0.0.0 accepts traffic, while the service name tells the API where to send database traffic.',
        'Inspect app.listen() in server.ts and environment in docker-compose.yml.',
      ],
      db: [
        'Persistent database',
        'Compose DNS resolves postgres to the current database container address. PostgreSQL listens on 5432, while the named volume mounts its data directory outside the disposable container layer.',
        [
          ['Image', 'postgres:16-alpine'],
          ['Port', '5432/tcp'],
          ['Volume', 'postgres_data'],
        ],
        'docker-compose.yml · postgres',
        'Containers can be replaced at any time. The named volume preserves table data independently from that container lifecycle.',
        'Run docker volume ls, then inspect the postgres service declaration.',
      ],
    },
  },
  kubernetes: {
    html: '<div class="flow"><div class="node" data-node="service"><span class="node-icon">⇄</span><b>Service</b><small>ClusterIP :80</small></div><span class="arrow">→</span><div class="cluster"><div class="node active" data-node="pod"><span class="node-icon">⬡</span><b>Pod 01</b><small>ready · :3000</small></div><div class="node" data-node="pod"><span class="node-icon">⬡</span><b>Pod 02</b><small>ready · :3000</small></div></div></div>',
    first: 'pod',
    nodes: {
      service: [
        'Stable virtual endpoint',
        'The Service receives traffic on a stable cluster IP and port 80. Its selector continuously finds ready pods labeled app=opslab-api, then forwards connections to port 3000 on one of those pods.',
        [
          ['Type', 'ClusterIP'],
          ['Selector', 'app=opslab-api'],
          ['Port', '80 → 3000'],
        ],
        'kubernetes/service.yaml',
        'Pod IP addresses change during rollout and recovery. The Service gives callers one durable destination while Kubernetes updates the backing endpoint list.',
        'Run kubectl get svc,endpoints -n opslab and compare their selectors.',
      ],
      pod: [
        'Deployment replica',
        'The Deployment asks Kubernetes to keep two identical pod replicas running. Readiness decides whether a pod receives Service traffic; liveness decides whether the kubelet should restart its container.',
        [
          ['Replicas', '2 desired'],
          ['Ready probe', '5s → every 10s'],
          ['Live probe', '10s → every 15s'],
        ],
        'kubernetes/deployment.yaml',
        'Separating traffic eligibility from restart policy prevents a warming or dependency-blocked app from receiving requests without creating an unnecessary restart loop.',
        'Run kubectl describe pod -n opslab and inspect Conditions and Events.',
      ],
    },
  },
  terraform: {
    html: '<div class="flow"><div class="node active" data-node="config"><span class="node-icon">⌁</span><b>main.tf</b><small>desired state</small></div><span class="arrow">→</span><div class="node" data-node="provider"><span class="node-icon">↻</span><b>K8s provider</b><small>reconcile</small></div><span class="arrow">→</span><div class="node" data-node="state"><span class="node-icon">▦</span><b>4 resources</b><small>real cluster</small></div></div>',
    first: 'config',
    nodes: {
      config: [
        'Declarative configuration',
        'HCL describes the end state rather than a list of shell commands. References between resources form a dependency graph, so Terraform knows the namespace and ConfigMap must exist before the Deployment.',
        [
          ['Language', 'HCL'],
          ['Resources', '4'],
          ['Terraform', '≥ 1.6.0'],
        ],
        'terraform/main.tf',
        'A declarative graph can be planned, reviewed, repeated, and applied consistently instead of relying on an operator to remember an imperative sequence.',
        'Run terraform plan from terraform/ and read each proposed action.',
      ],
      provider: [
        'Kubernetes provider',
        'The provider is Terraform’s adapter for the Kubernetes API. It reads kubeconfig credentials, translates HCL resources into API requests, and reads the resulting objects back for comparison.',
        [
          ['Source', 'hashicorp/kubernetes'],
          ['Version', '~> 2.31'],
          ['Auth', 'kubeconfig'],
        ],
        'terraform/providers.tf',
        'Terraform core understands graphs and state; the provider supplies Kubernetes-specific schemas and operations. Pinning its version avoids surprise behavior changes.',
        'Run terraform providers to see which plugin satisfies each resource.',
      ],
      state: [
        'Managed resource graph',
        'State maps each Terraform address to a real Kubernetes object and remembers attributes returned by the API. During planning, Terraform compares configuration, state, and the live cluster.',
        [
          ['Namespace', 'opslab'],
          ['Replicas', '2'],
          ['Service', 'ClusterIP'],
        ],
        'terraform/main.tf',
        'Without that mapping, Terraform could not reliably decide whether to create, update, replace, or leave an existing object alone. State may contain sensitive data and should be protected.',
        'After apply, run terraform state list; do not edit the state file by hand.',
      ],
    },
  },
};
const hops = {
  client: {
    kicker: 'HOP 01 · CLIENT',
    title: 'The browser creates an HTTP request',
    body: 'fetch() builds a GET request to /api/services on the same origin that served this page. The method and path identify the operation; the Accept header says the browser can process JSON. A GET has no request body here.',
    why: 'HTTP turns a UI action into a language-independent message. Because this is same-origin traffic, the browser can reuse the current host and port and no cross-origin permission check is needed.',
    verify: 'Open browser DevTools → Network, send the request, and inspect Headers.',
    facts: [
      ['Method', 'GET'],
      ['Path', '/api/services'],
      ['Accept', 'application/json'],
      ['Body', 'none'],
    ],
  },
  nat: {
    kicker: 'HOP 02 · CONTAINER BOUNDARY',
    title: 'Docker publishes the container port',
    body: 'The TCP connection first reaches port 3000 on the host. Docker’s port-publishing rule forwards it to port 3000 inside the api container, where Fastify listens on 0.0.0.0.',
    why: 'A container has its own network namespace, so listening inside it does not automatically expose the process to your laptop. The explicit 3000:3000 mapping creates that controlled entry point.',
    verify: 'Run docker compose ps; the PORTS column shows host → container mapping.',
    facts: [
      ['Host port', '3000'],
      ['Container port', '3000'],
      ['Bind address', '0.0.0.0'],
      ['Network', 'opslab_default'],
    ],
  },
  fastify: {
    kicker: 'HOP 03 · APPLICATION',
    title: 'Fastify matches and executes the handler',
    body: 'Fastify compares the request method and path with its registered routes, selects GET /api/services, and awaits loadServices(). DATABASE_HOST is present under Compose, so the function chooses the PostgreSQL-backed branch.',
    why: 'Routing keeps transport details separate from data access. Awaiting the promise lets Node.js work on other connections while the database is responding instead of blocking the event loop.',
    verify: "Find app.get('/api/services') and loadServices() in app/src/server.ts.",
    facts: [
      ['Framework', 'Fastify 5'],
      ['Handler', 'loadServices()'],
      ['Mode', 'async / await'],
      ['Branch', 'pool enabled'],
    ],
  },
  pool: {
    kicker: 'HOP 04 · CONNECTION MANAGEMENT',
    title: 'The pg pool lends a connection',
    body: 'The pg Pool maintains reusable PostgreSQL connections. For this query it checks out an available connection, sends the SQL over TCP, waits for the result, and returns the connection to the pool.',
    why: 'Creating a database connection requires authentication and a network handshake. Reuse removes that setup from most requests and limits concurrency so a traffic spike does not open unlimited connections.',
    verify: 'Inspect new Pool(...) and pool.query(...) in app/src/server.ts.',
    facts: [
      ['Driver', 'pg 8'],
      ['Host', 'postgres'],
      ['Port', '5432'],
      ['Database', 'opslab'],
    ],
  },
  database: {
    kicker: 'HOP 05 · PERSISTENCE',
    title: 'PostgreSQL executes and returns rows',
    body: 'PostgreSQL parses SELECT * FROM services ORDER BY name, reads matching table rows, sorts them by name, and returns a structured result. The handler places result.rows under services; Fastify serializes that object as JSON and sends the HTTP response back.',
    why: 'The database owns durable state and query semantics, while the API owns the public response shape. That boundary lets the storage schema evolve without forcing every client to speak SQL.',
    verify: 'Send GET /api/services and match its JSON fields to the services table schema.',
    facts: [
      ['Query', 'SELECT *'],
      ['Table', 'services'],
      ['Order', 'name ASC'],
      ['Result', 'JSON array'],
    ],
  },
};
const notes = {
  '/health/live':
    'Liveness answers one narrow question: can this Node.js process still answer HTTP? Kubernetes restarts the container after repeated failures. It intentionally does not query PostgreSQL, because a database outage should not cause every API replica to restart at once.',
  '/health/ready':
    'Readiness answers whether this replica can safely receive traffic. OpsLab checks its required dependency and answers 503 with status degraded when PostgreSQL is unavailable. Kubernetes can then remove the pod from Service endpoints without killing it, allowing recovery in place.',
  '/api/services':
    'This read route calls loadServices(). With DATABASE_HOST configured it executes SELECT * FROM services ORDER BY name through the shared pg Pool; without that variable it uses the in-memory records so lightweight local development still works.',
  '/api/incidents':
    'This route returns operational incidents. Severity describes customer or system impact; status describes workflow state. Keeping those concepts separate allows a critical incident to move from open to investigating to resolved without rewriting its historical impact.',
  '/api/ops/summary':
    'This is the JSON view of the same signals Prometheus scrapes from /metrics. It adds a rolling ten-second window with request rate and latency percentiles, which is what the live charts in the operations console draw. Machines read the exposition format; people and UIs usually want JSON.',
  '/metrics':
    'Metrics expose numeric observations that a monitoring system can scrape repeatedly. Counters describe accumulated work, duration values reveal latency, and gauges such as active_incidents describe current state. In production these samples become charts and alert conditions.',
};

// Lines streamed into the pipeline terminal. `fail` replaces `lines` when "Break the build" is on.
const stageLogs = {
  checkout: {
    lines: ['→ Fetching refs/heads/main', '→ Checking out 8f31ca (depth 1)', '✓ Working tree ready'],
  },
  install: {
    lines: ['→ Cache restored from package-lock.json hash', '→ Installing exact versions from the lockfile', '✓ Lockfile reproduced exactly'],
  },
  verify: {
    lines: ['→ tsc --noEmit · 0 type errors', '→ vitest · creating Fastify in memory', '→ health, incidents, metrics, chaos routes pass', '✓ Quality gate passed'],
    fail: [
      '→ tsc --noEmit · 0 type errors',
      '→ vitest · creating Fastify in memory',
      '✗ returns ready status for the service',
      '   expected 503 to be 200',
      '✗ Quality gate failed · exit code 1',
    ],
  },
  image: {
    lines: ['→ [builder] npm ci && npm run build', '→ [runner] copying dist/ and public/', '→ exporting layers', '✓ Immutable artifact packaged'],
  },
};
