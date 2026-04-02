local base = import '.github/jsonnet/base.jsonnet';
local clusters = import '.github/jsonnet/clusters.jsonnet';
local docker = import '.github/jsonnet/docker.jsonnet';
local helm = import '.github/jsonnet/helm.jsonnet';
local misc = import '.github/jsonnet/misc.jsonnet';

local nodeImage = 'mirror.gcr.io/node:22';
local project = 'unicorn-985';
local imageTag = 'deploy-${{ github.sha }}';
local baseImageRef = 'europe-docker.pkg.dev/unicorn-985/private-images/optio-agent-base:' + imageTag;

local checkoutAndPnpm() =
  misc.checkout() +
  base.action('Install pnpm', 'pnpm/action-setup@v4') +
  base.step('Install dependencies', 'pnpm install --frozen-lockfile');

local buildImage(name, dockerfile, buildArgs=null) =
  docker.buildDocker(
    name,
    imageTag=imageTag,
    isPublic=false,
    dockerfile=dockerfile,
    project=project,
    build_args=buildArgs,
  );

local pnpmJob(name, commands) =
  base.ghJob(
    name,
    image=nodeImage,
    useCredentials=false,
    steps=[
      checkoutAndPnpm(),
    ] + [
      base.step(cmd.name, cmd.run)
      for cmd in commands
    ],
  );

// ── CI ──────────────────────────────────────────────────────────────────────
local ci = base.pipeline(
  'CI',
  [
    pnpmJob('format', [{ name: 'Format check', run: 'pnpm format:check' }]),
    pnpmJob('typecheck', [{ name: 'Typecheck', run: 'pnpm turbo typecheck' }]),
    pnpmJob('test', [{ name: 'Test', run: 'pnpm turbo test' }]),
    pnpmJob('build-web', [{ name: 'Build web', run: 'cd apps/web && npx next build' }]),
    pnpmJob('build-site', [{ name: 'Build site', run: 'cd apps/site && npx next build' }]),
    base.ghJob(
      'build-image',
      image=nodeImage,
      useCredentials=false,
      steps=[
        misc.checkout(),
        base.step('Build base image', 'docker build -t optio-base:latest -f images/base.Dockerfile .'),
        base.step('Build node image', 'docker build -t optio-node:latest -f images/node.Dockerfile .'),
      ],
    ),
  ],
  event={ push: { branches: ['main'] }, pull_request: { branches: ['main'] } },
);

// ── Build Agent Images ──────────────────────────────────────────────────────
local agentPresets = ['node', 'python', 'go', 'rust', 'full'];

local buildImages = base.pipeline(
  'Build Agent Images',
  [
    base.ghJob(
      'build-base',
      image=nodeImage,
      useCredentials=false,
      steps=[
        misc.checkout(),
        buildImage('optio-agent-base', 'images/base.Dockerfile'),
      ],
    ),
  ] + [
    base.ghJob(
      'build-' + preset,
      image=nodeImage,
      useCredentials=false,
      needs=['build-base'],
      steps=[
        misc.checkout(),
        buildImage(
          'optio-agent-' + preset,
          'images/' + preset + '.Dockerfile',
          buildArgs='BASE_IMAGE=' + baseImageRef,
        ),
      ],
    )
    for preset in agentPresets
  ],
  event={
    push: {
      branches: ['main'],
      tags: ['v*'],
      paths: ['images/**', 'scripts/repo-init.sh', 'scripts/agent-entrypoint.sh', '.github/workflows/Build Agent Images.yml'],
    },
    workflow_dispatch: null,
  },
);

// ── Release ─────────────────────────────────────────────────────────────────
local releaseServices = [
  { name: 'api', dockerfile: 'Dockerfile.api' },
  { name: 'web', dockerfile: 'Dockerfile.web' },
  { name: 'optio', dockerfile: 'Dockerfile.optio' },
];

local release = base.pipeline(
  'Release',
  [
    base.ghJob(
      'build-' + svc.name,
      image=nodeImage,
      useCredentials=false,
      steps=[
        misc.checkout(),
        buildImage('optio-' + svc.name, svc.dockerfile),
      ],
    )
    for svc in releaseServices
  ] + [
    base.ghJob(
      'build-agent-base',
      image=nodeImage,
      useCredentials=false,
      steps=[
        misc.checkout(),
        buildImage('optio-agent-base', 'images/base.Dockerfile'),
      ],
    ),
  ] + [
    base.ghJob(
      'build-agent-' + preset,
      image=nodeImage,
      useCredentials=false,
      needs=['build-agent-base'],
      steps=[
        misc.checkout(),
        buildImage(
          'optio-agent-' + preset,
          'images/' + preset + '.Dockerfile',
          buildArgs='BASE_IMAGE=' + baseImageRef,
        ),
      ],
    )
    for preset in agentPresets
  ] + [
    base.ghJob(
      'deploy',
      image=nodeImage,
      useCredentials=false,
      needs=['build-api', 'build-web', 'build-optio'] + ['build-agent-' + p for p in agentPresets],
      steps=[
        misc.checkout(),
        helm.deployHelm(
          clusters['gh-runners'],
          release='optio',
          values={ image: { tag: imageTag } },
          chartPath='./helm/optio',
          namespace='optio',
        ),
      ],
    ),
  ],
  event={
    push: { tags: ['v*'] },
    workflow_dispatch: null,
  },
);

// ── Deploy Site ─────────────────────────────────────────────────────────────
local deploySite = base.pipeline(
  'Deploy Site',
  [
    base.ghJob(
      'build',
      image=nodeImage,
      useCredentials=false,
      steps=[
        checkoutAndPnpm(),
        base.step('Build site', 'pnpm turbo build --filter=@optio/site'),
        base.action('Upload Pages artifact', 'actions/upload-pages-artifact@v3', with={ path: 'apps/site/out' }),
      ],
    ),
    base.ghJob(
      'deploy',
      image=nodeImage,
      useCredentials=false,
      needs=['build'],
      steps=[
        base.action('Deploy to Pages', 'actions/deploy-pages@v4', id='deployment'),
      ],
    ),
  ],
  event={
    push: {
      branches: ['main'],
      paths: ['apps/site/**', '.github/workflows/Deploy Site.yml'],
    },
    workflow_dispatch: null,
  },
  permissions={ contents: 'read', pages: 'write', 'id-token': 'write' },
  concurrency={ group: 'pages', 'cancel-in-progress': false },
);

ci + buildImages + release + deploySite
