local actions = import 'actions.jsonnet';
local base = import 'base.jsonnet';
local deployment = import 'deployment.jsonnet';
local images = import 'images.jsonnet';
local misc = import 'misc.jsonnet';
local notifications = import 'notifications.jsonnet';
local pnpm = import 'pnpm.jsonnet';
local yarn = import 'yarn.jsonnet';

local defaultPulumiVersion = '3.248.0';

// Standard setup steps required for all Pulumi operations
// Includes authentication, cloud setup, and tool installation
local pulumiSetupSteps(pulumiVersion) =
  base.action(
    'auth',
    uses=actions.gcp_auth_action,
    id='auth',
    with={
      credentials_json: misc.secret('PULUMI_SERVICE_ACCOUNT'),
    }
  ) +
  base.action('setup-gcloud', uses=actions.gcp_setup_gcloud_action) +
  base.action('pulumi-cli-setup', actions.pulumi_action, with={'pulumi-version': pulumiVersion}) +
  base.action('jsonnet-setup', 'kobtea/setup-jsonnet-action@78f57bb20bd6cf4914c27dd44610a7d923455ecf') +  // v2
  misc.install1Password() +
  misc.getLockStep(lockName='lock-pulumi', lockTimeout='1200');

// Default environment variables for Pulumi operations
// Automatically configures different credentials based on stack (prod vs test)
local pulumiDefaultEnvironment(stack) = {
  GITHUB_TOKEN: '${{ github.token }}',
  PULUMI_CONFIG_PASSPHRASE: '${{ secrets.PULUMI_CONFIG_PASSPHRASE }}',
  STATUSCAKE_API_TOKEN: '${{ secrets.STATUSCAKE_API_TOKEN }}',
  STATUSCAKE_MIN_BACKOFF: '5',  // seconds
  STATUSCAKE_MAX_BACKOFF: '30',  // seconds
  STATUSCAKE_RETRIES: '10',
  STATUSCAKE_RPS: '1',  // requests per second. https://developers.statuscake.com/guides/api/ratelimiting/
} + (
  if (stack == 'prod' || stack == 'production') then {
    ACCOUNTS_API_CLIENT_ADMIN_USERNAME: '${{ secrets.ACCOUNTS_API_CLIENT_ADMIN_USERNAME_PROD }}',
    ACCOUNTS_API_CLIENT_ADMIN_PASSWORD: '${{ secrets.ACCOUNTS_API_CLIENT_ADMIN_PASSWORD_PROD }}',
    OP_SERVICE_ACCOUNT_TOKEN: '${{ secrets.PULUMI_1PASSWORD_PROD }}',
  } else {
    ACCOUNTS_API_CLIENT_ADMIN_USERNAME: '${{ secrets.ACCOUNTS_API_CLIENT_ADMIN_USERNAME_TEST }}',
    ACCOUNTS_API_CLIENT_ADMIN_PASSWORD: '${{ secrets.ACCOUNTS_API_CLIENT_ADMIN_PASSWORD_TEST }}',
    OP_SERVICE_ACCOUNT_TOKEN: '${{ secrets.PULUMI_1PASSWORD_TEST }}',
  }
);

{
  /**
   * Creates a GitHub Actions step to preview Pulumi infrastructure changes.
   *
   * Shows a preview of infrastructure changes without applying them, useful for PR reviews.
   *
   * @param {string} stack - Pulumi stack name (e.g., 'test', 'prod')
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [stepName='pulumi-preview-' + stack] - Name for the GitHub Actions step
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @returns {steps} - GitHub Actions step for Pulumi preview with PR comments
   */
  pulumiPreview(
    stack,
    pulumiDir=null,
    stepName='pulumi-preview-' + stack,
    environmentVariables={},
  )::
    base.action(
      name=stepName,
      uses=actions.pulumi_action,
      with={
        command: 'preview',
        'stack-name': stack,
        'work-dir': pulumiDir,
        'comment-on-pr': true,
        'github-token': '${{ secrets.GITHUB_TOKEN }}',
        upsert: true,
        refresh: true,
      },
      env=pulumiDefaultEnvironment(stack) + environmentVariables,
    ),

  /**
   * Creates a GitHub Actions step to deploy Pulumi infrastructure changes.
   *
   * @param {string} stack - Pulumi stack name (e.g., 'test', 'prod')
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [stepName='pulumi-deploy-' + stack] - Name for the GitHub Actions step
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @returns {steps} - GitHub Actions step for Pulumi deployment
   */
  pulumiDeploy(
    stack,
    pulumiDir=null,
    stepName='pulumi-deploy-' + stack,
    environmentVariables={},
  )::
    base.action(
      name=stepName,
      uses=actions.pulumi_action,
      with={
        command: 'up',
        'stack-name': stack,
        'work-dir': pulumiDir,
        upsert: true,
        refresh: true,
      },
      env=pulumiDefaultEnvironment(stack) + environmentVariables,
    ),

  /**
   * Creates a GitHub Actions step to destroy Pulumi infrastructure.
   *
   * SAFETY: Only works on stacks containing 'pr-' to prevent accidental production destruction.
   *
   * @param {string} stack - Pulumi stack name (must contain 'pr-' for safety)
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [stepName='pulumi-destroy-' + stack] - Name for the GitHub Actions step
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @returns {steps} - GitHub Actions step for Pulumi stack destruction
   */
  pulumiDestroy(
    stack,
    pulumiDir=null,
    stepName='pulumi-destroy-' + stack,
    environmentVariables={},
  )::
    // pulumi destroy is a destructive operation, so we only want to run it on stacks that contain pr-
    assert std.length(std.findSubstr('pr-', stack)) > 0;

    base.action(
      name=stepName,
      uses=actions.pulumi_action,
      with={
        command: 'destroy',
        remove: true,
        'stack-name': stack,
        'work-dir': pulumiDir,
        refresh: true,
      },
      env=pulumiDefaultEnvironment(stack) + environmentVariables,
    ),

  /**
   * Creates a complete GitHub Actions job to preview Pulumi changes with Node.js setup.
   *
   * @param {string} stack - Pulumi stack name
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json for dependencies
   * @param {string} [gitCloneRef='${{ github.event.pull_request.head.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [image=images.default_pulumi_node_image] - Container image for the job
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps before Pulumi preview
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - Complete GitHub Actions job for Pulumi preview
   */
  pulumiPreviewJob(
    stack,
    pulumiDir=null,
    yarnDir=null,
    gitCloneRef='${{ github.event.pull_request.head.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    yarnNpmSource=null,
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    runsOn=null,
    pulumiVersion=defaultPulumiVersion,
    packageManager='yarn',
    pnpmInstallArgs=[],
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
  )::
    base.ghJob(
      'pulumi-preview-' + stack,
      runsOn=runsOn,
      image=image,
      useCredentials=false,
      steps=[
        (
          if packageManager == 'yarn' then yarn.checkoutAndYarn(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, ignoreEngines=ignoreEngines, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
          else if packageManager == 'pnpm' then pnpm.checkoutAndPnpm(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, pnpmInstallArgs=pnpmInstallArgs, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
        ),
        pulumiSetupSteps(pulumiVersion),
        additionalSetupSteps,
        self.pulumiPreview(stack, pulumiDir=pulumiDir, environmentVariables=environmentVariables),
      ],
    ),

  /**
   * Creates a GitHub Actions job to preview Pulumi changes for test environment.
   *
   * @param {string} [stack='test'] - Test stack name
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.event.pull_request.head.sha }}'] - Git reference
   * @param {string} [cacheName=null] - Cache key for dependencies
   * @param {string} [image=images.default_pulumi_node_image] - Container image
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for test environment Pulumi preview
   */
  pulumiPreviewTestJob(
    stack='test',
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.event.pull_request.head.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    environmentVariables={},
    additionalSetupSteps=[],
    pulumiVersion=defaultPulumiVersion,
    packageManager='yarn',
    pnpmInstallArgs=[],
    ignoreEngines=false,
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
  )::
    self.pulumiPreviewJob(
      stack,
      pulumiDir=pulumiDir,
      yarnDir=yarnDir,
      yarnNpmSource=yarnNpmSource,
      gitCloneRef=gitCloneRef,
      cacheName=cacheName,
      image=image,
      environmentVariables=environmentVariables,
      additionalSetupSteps=additionalSetupSteps,
      pulumiVersion=pulumiVersion,
      packageManager=packageManager,
      pnpmInstallArgs=pnpmInstallArgs,
      ignoreEngines=ignoreEngines,
      runsOn=runsOn,
      blobless=blobless,
      retryAttempts=retryAttempts,
      cloneTimeout=cloneTimeout,
    ),

  /**
   * Creates a GitHub Actions job to preview Pulumi changes for production environment.
   *
   * @param {string} [stack='prod'] - Production stack name
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.event.pull_request.head.sha }}'] - Git reference
   * @param {string} [cacheName=null] - Cache key for dependencies
   * @param {string} [image=images.default_pulumi_node_image] - Container image
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for production Pulumi preview
   */
  pulumiPreviewProdJob(
    stack='prod',
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.event.pull_request.head.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    environmentVariables={},
    additionalSetupSteps=[],
    pulumiVersion=defaultPulumiVersion,
  )::
    self.pulumiPreviewJob(
      stack,
      pulumiDir=pulumiDir,
      yarnDir=yarnDir,
      yarnNpmSource=yarnNpmSource,
      gitCloneRef=gitCloneRef,
      cacheName=cacheName,
      image=image,
      environmentVariables=environmentVariables,
      additionalSetupSteps=additionalSetupSteps,
      pulumiVersion=pulumiVersion,
    ),

  /**
   * Creates a GitHub Actions job to preview Pulumi changes for both test and production stacks.
   *
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json for dependencies
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.event.pull_request.head.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [image=images.default_pulumi_node_image] - Container image for the job
   * @param {string} [productionStack='prod'] - Production stack name
   * @param {string} [testStack='test'] - Test stack name
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps before Pulumi preview
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job that previews both test and production stacks
   */
  pulumiPreviewTestAndProdJob(
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.event.pull_request.head.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    productionStack='prod',
    testStack='test',
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    packageManager='yarn',
    pnpmInstallArgs=[],
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    base.ghJob(
      'pulumi-preview',
      runsOn=runsOn,
      image=image,
      useCredentials=false,
      steps=[
        (
          if packageManager == 'yarn' then yarn.checkoutAndYarn(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, ignoreEngines=ignoreEngines, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
          else if packageManager == 'pnpm' then pnpm.checkoutAndPnpm(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, pnpmInstallArgs=pnpmInstallArgs, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
        ),
        pulumiSetupSteps(pulumiVersion),
        additionalSetupSteps,
        self.pulumiPreview(testStack, pulumiDir=pulumiDir, environmentVariables=environmentVariables),
        self.pulumiPreview(productionStack, pulumiDir=pulumiDir, environmentVariables=environmentVariables),
      ],
    ),

  /**
   * Creates a GitHub Actions job to deploy Pulumi infrastructure changes.
   *
   * @param {string} stack - Pulumi stack name to deploy
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json for dependencies
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [ifClause=null] - Conditional expression for job execution
   * @param {string} [image=images.default_pulumi_node_image] - Container image for the job
   * @param {string} [jobName='pulumi-deploy-' + stack] - Name for the GitHub Actions job
   * @param {boolean} [notifyOnFailure=true] - Whether to send Slack notifications on failure
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps before deployment
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for Pulumi deployment with failure notifications
   */
  pulumiDeployJob(
    stack,
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.sha }}',
    cacheName=null,
    ifClause=null,
    image=images.default_pulumi_node_image,
    jobName='pulumi-deploy-' + stack,
    notifyOnFailure=true,
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    packageManager='yarn',
    pnpmInstallArgs=[],
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    base.ghJob(
      name=jobName,
      runsOn=runsOn,
      ifClause=ifClause,
      image=image,
      useCredentials=false,
      steps=[
        (
          if packageManager == 'yarn' then yarn.checkoutAndYarn(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, ignoreEngines=ignoreEngines, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
          else if packageManager == 'pnpm' then pnpm.checkoutAndPnpm(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, pnpmInstallArgs=pnpmInstallArgs, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout)
        ),
        pulumiSetupSteps(pulumiVersion),
        additionalSetupSteps,
        self.pulumiDeploy(stack, pulumiDir=pulumiDir, stepName=jobName, environmentVariables=environmentVariables),
        if notifyOnFailure then notifications.notifiyDeployFailure(environment=stack) else [],
      ]
    ),

  /**
   * Creates a GitHub Actions job to deploy Pulumi infrastructure to test environment.
   *
   * @param {string} [stack='test'] - Test stack name
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [image=images.default_pulumi_node_image] - Container image
   * @param {string} [ifClause=deployment.deploymentTargets(['test'])] - Conditional for test deployments
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [packageManager='yarn'] - Package manager to use
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for test environment deployment
   */
  pulumiDeployTestJob(
    stack='test',
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    ifClause=deployment.deploymentTargets(['test']),
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    packageManager='yarn',
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    self.pulumiDeployJob(
      stack,
      runsOn=runsOn,
      pulumiDir=pulumiDir,
      yarnDir=yarnDir,
      yarnNpmSource=yarnNpmSource,
      gitCloneRef=gitCloneRef,
      cacheName=cacheName,
      ifClause=ifClause,
      image=image,
      environmentVariables=environmentVariables,
      additionalSetupSteps=additionalSetupSteps,
      ignoreEngines=ignoreEngines,
      packageManager=packageManager,
      blobless=blobless,
      retryAttempts=retryAttempts,
      cloneTimeout=cloneTimeout,
      pulumiVersion=pulumiVersion,
    ),

  /**
   * Creates a GitHub Actions job to deploy Pulumi infrastructure to production environment.
   *
   * @param {string} [stack='prod'] - Production stack name
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [image=images.default_pulumi_node_image] - Container image
   * @param {string} [ifClause=deployment.deploymentTargets(['production'])] - Conditional for production deployments
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [packageManager='yarn'] - Package manager to use
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for production deployment
   */
  pulumiDeployProdJob(
    stack='prod',
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.sha }}',
    cacheName=null,
    image=images.default_pulumi_node_image,
    ifClause=deployment.deploymentTargets(['production']),
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    packageManager='yarn',
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    self.pulumiDeployJob(
      stack,
      runsOn=runsOn,
      pulumiDir=pulumiDir,
      yarnDir=yarnDir,
      yarnNpmSource=yarnNpmSource,
      gitCloneRef=gitCloneRef,
      cacheName=cacheName,
      ifClause=ifClause,
      image=image,
      environmentVariables=environmentVariables,
      additionalSetupSteps=additionalSetupSteps,
      ignoreEngines=ignoreEngines,
      packageManager=packageManager,
      blobless=blobless,
      retryAttempts=retryAttempts,
      cloneTimeout=cloneTimeout,
      pulumiVersion=pulumiVersion,
    ),

  /**
   * Creates a GitHub Actions job to destroy Pulumi infrastructure.
   *
   * SAFETY: Only works on stacks containing 'pr-' to prevent accidental production destruction.
   *
   * @param {string} stack - Pulumi stack name to destroy (must contain 'pr-' for safety)
   * @param {string} [pulumiDir=null] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json for dependencies
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [gitCloneRef='${{ github.sha }}'] - Git reference to checkout
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {string} [ifClause=null] - Conditional expression for job execution
   * @param {string} [image=images.default_pulumi_node_image] - Container image for the job
   * @param {string} [jobName='pulumi-destroy-' + stack] - Name for the GitHub Actions job
   * @param {boolean} [notifyOnFailure=true] - Whether to send Slack notifications on failure
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps before destruction
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {jobs} - GitHub Actions job for Pulumi infrastructure destruction
   */
  pulumiDestroyJob(
    stack,
    pulumiDir=null,
    yarnDir=null,
    yarnNpmSource=null,
    gitCloneRef='${{ github.sha }}',
    cacheName=null,
    ifClause=null,
    image=images.default_pulumi_node_image,
    jobName='pulumi-destroy-' + stack,
    notifyOnFailure=true,
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    packageManager='yarn',
    pnpmInstallArgs=[],
    runsOn=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    base.ghJob(
      name=jobName,
      runsOn=runsOn,
      ifClause=ifClause,
      image=image,
      useCredentials=false,
      steps=[
        (
          if packageManager == 'yarn' then yarn.checkoutAndYarn(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, ignoreEngines=ignoreEngines)
          else if packageManager == 'pnpm' then pnpm.checkoutAndPnpm(ref=gitCloneRef, cacheName=cacheName, fullClone=false, workingDirectory=yarnDir, source=yarnNpmSource, pnpmInstallArgs=pnpmInstallArgs)
        ),
        pulumiSetupSteps(pulumiVersion),
        additionalSetupSteps,
        self.pulumiDestroy(stack, pulumiDir=pulumiDir, stepName=jobName, environmentVariables=environmentVariables),
        if notifyOnFailure then notifications.notifiyDeployFailure(environment=stack) else [],
      ],
    ),

  /**
   * Creates a complete set of Pulumi pipelines for preview and deployment workflows.
   *
   * Generates two pipelines:
   * 1. 'pulumi-preview' - Triggered on pull requests to preview changes
   * 2. 'pulumi-deploy' - Triggered on deployment events to deploy infrastructure
   *
   * @param {string} [pulumiDir='.'] - Directory containing Pulumi project files
   * @param {string} [yarnDir=null] - Directory containing package.json for dependencies
   * @param {string} [yarnNpmSource=null] - Custom npm registry source
   * @param {string} [cacheName=null] - Cache key for dependency caching
   * @param {boolean} [deployTestWithProd=false] - Whether test deployments should also trigger on prod events
   * @param {string} [image=images.default_pulumi_node_image] - Container image for jobs
   * @param {string} [testStack='test'] - Test stack name
   * @param {string} [productionStack='prod'] - Production stack name
   * @param {object} [environmentVariables={}] - Additional environment variables
   * @param {array} [additionalSetupSteps=[]] - Extra setup steps for all jobs
   * @param {boolean} [ignoreEngines=false] - Whether to ignore Node.js engine requirements
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the jobs
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @param {string} [pulumiVersion=defaultPulumiVersion] - Pulumi CLI version to install
   * @returns {workflows} - Complete set of Pulumi preview and deployment pipelines
   */
  pulumiDefaultPipeline(
    pulumiDir='.',
    packageManager='yarn',
    yarnDir=null,
    yarnNpmSource=null,
    cacheName=null,
    deployTestWithProd=false,
    image=images.default_pulumi_node_image,
    testStack='test',
    productionStack='prod',
    environmentVariables={},
    additionalSetupSteps=[],
    ignoreEngines=false,
    runsOn=null,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
    pulumiVersion=defaultPulumiVersion,
  )::
    base.pipeline(
      'pulumi-preview',
      [
        self.pulumiPreviewTestAndProdJob(
          pulumiDir=pulumiDir,
          packageManager=packageManager,
          yarnDir=yarnDir,
          yarnNpmSource=yarnNpmSource,
          cacheName=cacheName,
          image=image,
          productionStack=productionStack,
          testStack=testStack,
          environmentVariables=environmentVariables,
          additionalSetupSteps=additionalSetupSteps,
          ignoreEngines=ignoreEngines,
          runsOn=runsOn,
          blobless=blobless,
          retryAttempts=retryAttempts,
          cloneTimeout=cloneTimeout,
          pulumiVersion=pulumiVersion,
        ),
      ],
    ) +
    base.pipeline(
      'pulumi-deploy',
      [
        self.pulumiDeployTestJob(
          pulumiDir=pulumiDir,
          packageManager=packageManager,
          yarnDir=yarnDir,
          yarnNpmSource=yarnNpmSource,
          cacheName=cacheName,
          image=image,
          environmentVariables=environmentVariables,
          additionalSetupSteps=additionalSetupSteps,
          ifClause=if deployTestWithProd then deployment.deploymentTargets(['test', 'production']) else deployment.deploymentTargets(['test']),
          ignoreEngines=ignoreEngines,
          runsOn=runsOn,
          blobless=blobless,
          retryAttempts=retryAttempts,
          cloneTimeout=cloneTimeout,
          pulumiVersion=pulumiVersion,
        ),
        self.pulumiDeployProdJob(
          pulumiDir=pulumiDir,
          packageManager=packageManager,
          yarnDir=yarnDir,
          yarnNpmSource=yarnNpmSource,
          cacheName=cacheName,
          image=image,
          stack=productionStack,
          environmentVariables=environmentVariables,
          additionalSetupSteps=additionalSetupSteps,
          ignoreEngines=ignoreEngines,
          runsOn=runsOn,
          blobless=blobless,
          retryAttempts=retryAttempts,
          cloneTimeout=cloneTimeout,
          pulumiVersion=pulumiVersion,
        ),
      ],
      event='deployment',
    ),
}
