local base = import '.github/jsonnet/base.jsonnet';
local clusters = import '.github/jsonnet/clusters.jsonnet';
local deployment = import '.github/jsonnet/deployment.jsonnet';
local docker = import '.github/jsonnet/docker.jsonnet';
local helm = import '.github/jsonnet/helm.jsonnet';
local misc = import '.github/jsonnet/misc.jsonnet';

local nodeImage = 'mirror.gcr.io/node:22';
local project = 'unicorn-985';
local imageTag = 'deploy-${{ github.event.pull_request.head.sha || github.sha }}';
local baseImageRef = 'europe-docker.pkg.dev/unicorn-985/private-images/optio-agent-base:' + imageTag;
local imageRef = '${{ github.event.pull_request.head.sha || github.sha }}';

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

local releaseServices = [
  { name: 'api', dockerfile: 'Dockerfile.api' },
  { name: 'web', dockerfile: 'Dockerfile.web' },
  { name: 'optio', dockerfile: 'Dockerfile.optio' },
];

local agentPresets = ['node', 'python', 'go', 'rust', 'full'];

// ── CI ──────────────────────────────────────────────────────────────────────
local ci = base.pipeline(
  'CI',
  [
    pnpmJob('format', [{ name: 'Format check', run: 'pnpm format:check' }]),
    pnpmJob('typecheck', [{ name: 'Typecheck', run: 'pnpm turbo typecheck' }]),
    pnpmJob('test', [{ name: 'Test', run: 'pnpm turbo test' }]),
    pnpmJob('build-web', [{ name: 'Build web', run: 'cd apps/web && npx next build' }]),
    pnpmJob('build-site', [{ name: 'Build site', run: 'cd apps/site && npx next build' }]),
  ] + [
    base.ghJob(
      'build-' + svc.name,
      image=nodeImage,
      useCredentials=false,
      steps=[
        misc.checkout(ref=imageRef),
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
        misc.checkout(ref=imageRef),
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
        misc.checkout(ref=imageRef),
        buildImage(
          'optio-agent-' + preset,
          'images/' + preset + '.Dockerfile',
          buildArgs='BASE_IMAGE=' + baseImageRef,
        ),
      ],
    )
    for preset in agentPresets
  ],
  event={ push: { branches: ['main'] }, pull_request: { branches: ['main'] } },
);

// ── Build Agent Images ──────────────────────────────────────────────────────

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
    workflow_dispatch: null,
  },
);

// ── Deployment Event Hook ───────────────────────────────────────────────────
local deployHook = deployment.masterMergeDeploymentEventHook();

// ── Release ─────────────────────────────────────────────────────────────────
local prodIfClause = deployment.deploymentTargets(['production']);

local registry = 'europe-docker.pkg.dev/' + project + '/private-images';

local release = base.pipeline(
  'Release',
  [
    base.ghJob(
      'deploy',
      image=nodeImage,
      useCredentials=false,
      ifClause=prodIfClause,
      steps=[
        misc.checkout(),
        helm.deployHelm(
          clusters['gh-runners'],
          release='optio',
          values={
            api: { image: { repository: registry + '/optio-api', tag: imageTag } },
            web: { image: { repository: registry + '/optio-web', tag: imageTag } },
            optio: { image: { repository: registry + '/optio-optio', tag: imageTag } },
            agent: { image: { repository: registry + '/optio-agent-base', tag: imageTag, pullPolicy: 'IfNotPresent' }, imagePullPolicy: 'IfNotPresent' },
            cloudSqlProxy: {
              enabled: true,
              instanceConnectionName: 'gh-runners:europe-west4:optio',
            },
            postgresql: { enabled: false },
            externalDatabase: { url: misc.secret('EXTERNAL_DATABASE_URL') },
            encryption: { key: misc.secret('ENCRYPTION_KEY') },
            ingress: {
              enabled: true,
              gke: {
                enabled: true,
                staticIpName: 'optio',
                cloudArmorPolicy: 'optio',
                managedCertificate: {
                  enabled: true,
                  domains: ['optio.gynzy.dev'],
                },
              },
              hosts: [{
                host: 'optio.gynzy.dev',
                paths: [
                  { path: '/*', pathType: 'ImplementationSpecific', service: 'web' },
                  { path: '/api/*', pathType: 'ImplementationSpecific', service: 'api' },
                  { path: '/ws/*', pathType: 'ImplementationSpecific', service: 'api' },
                ],
              }],
            },
            publicUrl: 'https://optio.gynzy.dev',
            auth: {
              google: {
                clientId: misc.secret('GOOGLE_OAUTH_CLIENT_ID'),
                clientSecret: misc.secret('GOOGLE_OAUTH_CLIENT_SECRET'),
              },
            },
          },
          chartPath='./helm/optio',
          namespace='optio',
          version='${{ github.sha }}',
        ),
        deployment.updateDeploymentStatus(),
      ],
    ),
  ],
  event='deployment',
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

ci + buildImages + deployHook + release + deploySite
