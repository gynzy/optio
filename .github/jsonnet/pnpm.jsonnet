local actions = import 'actions.jsonnet';
local base = import 'base.jsonnet';
local cache = import 'cache.jsonnet';
local deployment = import 'deployment.jsonnet';
local misc = import 'misc.jsonnet';
local yarn = import 'yarn.jsonnet';

{
  /**
   * Creates an action to install pnpm itself and then to run pnpm install
   *
   * @param {array} [args=[]] - Additional command line arguments for pnpm install
   * @param {object} [with={}] - Additional configuration options
   * @param {boolean} [prod=false] - Whether to install only production dependencies
   * @param {string} [storeDir=null] - Directory for pnpm store
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @param {string} [workingDirectory=null] - Directory to run pnpm in
   * @returns {steps} - Array containing a single step object
   */
  install(args=[], with={}, prod=false, storeDir=null, ifClause=null, workingDirectory=null)::
    base.action(
      'Install pnpm tool',
      'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320',  // v5
      with=with + if workingDirectory != null then {
        package_json_file: workingDirectory + '/package.json'
      } else {},
      ifClause=ifClause,
    ) +
    self.installPackages(
      args=args,
      prod=prod,
      ifClause=ifClause,
      workingDirectory=workingDirectory,
      storeDir=storeDir,
    ),

  /**
   * Creates a step to run pnpm install with configurable options.
   *
   * @param {array} [args=[]] - Additional command line arguments for pnpm install
   * @param {boolean} [prod=false] - Whether to install only production dependencies
   * @param {string} [storeDir=null] - Directory for pnpm store
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @param {string} [workingDirectory=null] - Directory to run pnpm in
   * @returns {array} - Array containing a single step object
   */
  installPackages(args=[], prod=false, storeDir=null, ifClause=null, workingDirectory=null)::
    local installArgs = (if prod then args + ['--prod'] else args);
    base.step(
      'Run pnpm install',
      (if storeDir != null then 'pnpm config set store-dir ' + storeDir + ' && ' else '') +
      'pnpm install' + (if (std.length(installArgs) > 0) then ' ' + (std.join(' ', installArgs)) else ''),
      ifClause=ifClause,
      workingDirectory=workingDirectory
    ),

  /**
   * Creates a complete workflow combining checkout, npm token setup, cache fetching, and pnpm install.
   *
   * @param {string} [cacheName=null] - Name of the cache to fetch/store pnpm dependencies
   * @param {string} [ifClause=null] - Conditional expression to determine if steps should run
   * @param {boolean} [fullClone=false] - Whether to perform a full git clone or shallow clone
   * @param {string} [ref=null] - Git ref to checkout (branch, tag, or commit)
   * @param {boolean} [prod=false] - Whether to install only production dependencies
   * @param {string} [workingDirectory=null] - Directory to run operations in
   * @param {string} [source='github'] - Registry source ('gynzy' or 'github')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install command
   * @param {boolean} [setupPnpm=true] - Whether to set up and install pnpm itself before installing all packages
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @returns {steps} - Array of step objects for the complete workflow
   */
  checkoutAndPnpm(
    cacheName=null,
    ifClause=null,
    fullClone=false,
    ref=null,
    prod=false,
    workingDirectory=null,
    source='github',
    pnpmInstallArgs=[],
    setupPnpm=true,
    blobless=null,
    retryAttempts=null,
    cloneTimeout=null,
  )::
    misc.checkout(ifClause=ifClause, fullClone=fullClone, ref=ref, blobless=blobless, retryAttempts=retryAttempts, cloneTimeout=cloneTimeout) +
    (if source == 'gynzy' then yarn.setGynzyNpmToken(ifClause=ifClause, workingDirectory=workingDirectory) else []) +
    (if source == 'github' then yarn.setGithubNpmToken(ifClause=ifClause, workingDirectory=workingDirectory) else []) +
    (if cacheName == null then [] else self.fetchPnpmCache(cacheName, ifClause=ifClause, workingDirectory=workingDirectory)) +
    (if setupPnpm then self.install(
       ifClause=ifClause,
       prod=prod,
       args=pnpmInstallArgs,
       workingDirectory=workingDirectory,
       storeDir='.pnpm-store',
     ) else
       self.installPackages(
         ifClause=ifClause,
         prod=prod,
         args=pnpmInstallArgs,
         workingDirectory=workingDirectory,
         storeDir='.pnpm-store',
       )),

  /**
   * Creates steps to fetch pnpm cache from cloud storage.
   *
   * @param {string} cacheName - Name of the cache to fetch
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @param {string} [workingDirectory=null] - Directory to extract cache to
   * @returns {steps} - Array of step objects for cache fetching
   */
  fetchPnpmCache(cacheName, ifClause=null, workingDirectory=null)::
    cache.fetchCache(
      cacheName=cacheName,
      folders=['.pnpm-store'],
      additionalCleanupCommands=["find . -type d -name 'node_modules' | xargs rm -rf"],
      ifClause=ifClause,
      workingDirectory=workingDirectory
    ),

  /**
   * Creates a complete pipeline to update pnpm cache on production deployments.
   *
   * @param {string} cacheName - Name of the cache to update
   * @param {string} [appsDir='packages'] - Directory containing applications (currently unused)
   * @param {string} [image=null] - Docker image to use for the job
   * @param {boolean} [useCredentials=null] - Whether to use Docker registry credentials
   * @param {boolean} [setupPnpm=true] - Whether to set up and install pnpm itself before installing all packages
   * @param {string} [source=null] - Registry source ('gynzy' or 'github')
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @returns {workflows} - Complete GitHub Actions pipeline configuration
   */
  updatePnpmCachePipeline(cacheName, appsDir='packages', image=null, useCredentials=null, setupPnpm=true, source=null, runsOn=null, blobless=null, retryAttempts=null, cloneTimeout=null)::
    base.pipeline(
      'update-pnpm-cache',
      [
        base.ghJob(
          'update-pnpm-cache',
          runsOn=runsOn,
          image=image,
          useCredentials=useCredentials,
          ifClause=deployment.deploymentTargets(['production']),
          steps=[
            self.checkoutAndPnpm(
              cacheName=null,  // to populate cache we want a clean install
              setupPnpm=setupPnpm,
              source=source,
              blobless=blobless,
              retryAttempts=retryAttempts,
              cloneTimeout=cloneTimeout,
            ),
            base.action(
              'setup auth',
              actions.gcp_auth_action,
              with={
                credentials_json: misc.secret('SERVICE_JSON'),
              },
              id='auth',
            ),
            base.action('setup-gcloud', actions.gcp_setup_gcloud_action),
            cache.uploadCache(
              cacheName=cacheName,
              tarCommand='tar -c .pnpm-store',
            ),
          ],
        ),
      ],
      event='deployment',
    ),

  /**
   * Creates a complete pipeline that runs pnpm audit to check for known vulnerabilities.
   *
   * @param {string} [cacheName=null] - Name of the pnpm cache to use
   * @param {string} [image=null] - Docker image to use for the job
   * @param {boolean} [setupPnpm=true] - Whether to set up and install pnpm itself
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install
   * @param {string} [auditLevel='moderate'] - Minimum severity level to fail the job ('low', 'moderate', 'high', 'critical')
   * @param {string} [runsOn=null] - GitHub Actions runner to use for the job
   * @param {string} [source='github'] - Where to install @gynzy packages from ('github', 'gynzy')
   * @param {boolean} [blobless=null] - Whether to perform a blobless clone (--filter=blob:none); null uses checkout default
   * @param {number} [retryAttempts=null] - Number of additional checkout attempts on failure; null uses checkout default
   * @param {number} [cloneTimeout=null] - Timeout for git clone operation in minutes; null uses checkout default
   * @returns {workflows} - Complete GitHub Actions pipeline configuration
   */
  pnpmAuditPipeline(cacheName=null, image=null, setupPnpm=true, pnpmInstallArgs=[], auditLevel='moderate', runsOn=null, source=null, blobless=null, retryAttempts=null, cloneTimeout=null)::
    base.pipeline(
      'pnpm-audit',
      [
        base.ghJob(
          'pnpm-audit',
          runsOn=runsOn,
          image=image,
          steps=[
            self.checkoutAndPnpm(
              cacheName=cacheName,
              ref='${{ github.event.pull_request.head.sha }}',
              setupPnpm=setupPnpm,
              pnpmInstallArgs=pnpmInstallArgs,
              source=source,
              blobless=blobless,
              retryAttempts=retryAttempts,
              cloneTimeout=cloneTimeout,
            ),
            base.step('pnpm-audit', 'pnpm audit --audit-level=' + auditLevel),
          ],
        ),
      ],
      event='pull_request',
    ),

  /**
   * Creates a step to publish a package with pnpm, handling version/tag for PR, tag and branch builds.
   *
   * @param {boolean} [isPr=true] - Whether this is a PR build (affects versioning)
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @param {string} [publishBranch=null] - The branch that triggers the publish-prod job; publishes the package <VERSION> specified in package.json and sets latest tag. When null, defaults to `main`/`master`
   * @returns {steps} - Array containing a single step object
   */
  pnpmPublish(isPr=true, ifClause=null, publishBranch=null)::
    local branchCheck =
      if publishBranch == null then
        '( "${GITHUB_REF_NAME}" == "main" || "${GITHUB_REF_NAME}" == "master" )'
      else
        '"${GITHUB_REF_NAME}" == "' + publishBranch + '"';
    base.step(
      'publish',
      |||
        bash -c 'set -xeo pipefail;

        cp package.json package.json.bak;

        VERSION=$(node -p "require(\"./package.json\").version");
        if [[ ! -z "${PR_NUMBER}" ]]; then
          echo "Setting tag/version for pr build.";
          TAG=pr-$PR_NUMBER;
          PUBLISHVERSION="$VERSION-pr$PR_NUMBER.$GITHUB_RUN_NUMBER";
        elif [[ "${GITHUB_REF_TYPE}" == "tag" ]]; then
          if [[ "${GITHUB_REF_NAME}" != "${VERSION}" ]]; then
            echo "Tag version does not match package version. They should match. Exiting";
            exit 1;
          fi
          echo "Setting tag/version for release/tag build.";
          PUBLISHVERSION=$VERSION;
          TAG="latest";
        elif [[ "${GITHUB_REF_TYPE}" == "branch" && %s ]] || [[ "${GITHUB_EVENT_NAME}" == "deployment" ]]; then
          echo "Setting tag/version for release/tag build.";
          PUBLISHVERSION=$VERSION;
          TAG="latest";
        else
          exit 1
        fi

        npm version --no-git-tag-version --allow-same-version "$PUBLISHVERSION";
        pnpm publish --no-git-checks --tag "$TAG";

        mv package.json.bak package.json;
        ';
      ||| % branchCheck,
      env={} + (if isPr then { PR_NUMBER: '${{ github.event.number }}' } else {}),
      ifClause=ifClause,
    ),

  /**
   * Creates steps to publish a package to multiple repositories with pnpm.
   *
   * @param {boolean} isPr - Whether this is a PR build (affects versioning)
   * @param {array} repositories - List of repository types ('gynzy' or 'github')
   * @param {string} [ifClause=null] - Conditional expression to determine if steps should run
   * @param {string} [publishBranch=null] - The branch that triggers the publish-prod job; publishes the package <VERSION> specified in package.json and sets latest tag. When null, defaults to `main`/`master`
   * @returns {steps} - Array of step objects for publishing to all repositories
   */
  pnpmPublishToRepositories(isPr, repositories, ifClause=null, publishBranch=null)::
    (std.flatMap(function(repository)
                   if repository == 'gynzy' then [yarn.setGynzyNpmToken(ifClause=ifClause), self.pnpmPublish(isPr=isPr, ifClause=ifClause, publishBranch=publishBranch)]
                   else if repository == 'github' then [yarn.setGithubNpmToken(ifClause=ifClause, tokenSecret='GITHUB_TOKEN'), self.pnpmPublish(isPr=isPr, ifClause=ifClause, publishBranch=publishBranch)]
                   else error 'Unknown repository type given.',
                 repositories)),

  /**
   * Creates a GitHub Actions job for publishing preview pnpm packages from PRs.
   *
   * @param {string} [image='node:24'] - Docker image to use for the job
   * @param {boolean} [useCredentials=false] - Whether to use Docker registry credentials
   * @param {string} [gitCloneRef='${{ github.event.pull_request.head.sha }}'] - Git reference to checkout
   * @param {array} [buildSteps=null] - Build steps; null defaults to `[pnpm run build]`. Pass `[]` to skip build.
   * @param {boolean} [checkVersionBump=true] - Whether to check if package version was bumped
   * @param {array} [repositories=['github']] - List of repositories to publish to
   * @param {boolean|string} [onChangedFiles=false] - Whether to only run on changed files (or glob pattern)
   * @param {string} [changedFilesHeadRef=null] - Head reference for changed files comparison
   * @param {string} [changedFilesBaseRef=null] - Base reference for changed files comparison
   * @param {string} [runsOn=null] - Runner type to use
   * @returns {jobs} - GitHub Actions job definition
   */
  pnpmPublishPreviewJob(
    image='mirror.gcr.io/node:24',
    useCredentials=false,
    gitCloneRef='${{ github.event.pull_request.head.sha }}',
    buildSteps=null,
    checkVersionBump=true,
    repositories=['github'],
    onChangedFiles=false,
    changedFilesHeadRef=null,
    changedFilesBaseRef=null,
    runsOn=null,
  )::
    local effectiveBuildSteps = if buildSteps == null then [base.step('build', 'pnpm run build')] else buildSteps;
    local ifClause = (if onChangedFiles != false then "steps.changes.outputs.package == 'true'" else null);
    base.ghJob(
      'pnpm-publish-preview',
      runsOn=runsOn,
      image=image,
      useCredentials=useCredentials,
      steps=
      [self.checkoutAndPnpm(ref=gitCloneRef, fullClone=false, source=repositories[0], pnpmInstallArgs=['--frozen-lockfile'])] +
      (if onChangedFiles != false then misc.testForChangedFiles({ package: onChangedFiles }, headRef=changedFilesHeadRef, baseRef=changedFilesBaseRef) else []) +
      (if checkVersionBump then [
         base.action('check-version-bump', uses='del-systems/check-if-version-bumped@d5d13ffd75dc8aa9c2e1dca10d9bb27be10307b2', with={  // check-if-version-bumped@d5d13 == v2
           token: '${{ github.token }}',
         }, ifClause=ifClause),
       ] else []) +
      (if onChangedFiles != false then std.map(function(step) std.map(function(s) s { 'if': ifClause }, step), effectiveBuildSteps) else effectiveBuildSteps) +
      self.pnpmPublishToRepositories(isPr=true, repositories=repositories, ifClause=ifClause),
      permissions={ packages: 'write', contents: 'read', 'pull-requests': 'read' },
    ),

  /**
   * Creates a GitHub Actions job for publishing pnpm packages from main branch or releases.
   *
   * @param {string} [image='node:24'] - Docker image to use for the job
   * @param {boolean} [useCredentials=false] - Whether to use Docker registry credentials
   * @param {string} [gitCloneRef='${{ github.sha }}'] - Git reference to checkout
   * @param {array} [buildSteps=null] - Build steps; null defaults to `[pnpm run build]`. Pass `[]` to skip build.
   * @param {array} [repositories=['github']] - List of repositories to publish to
   * @param {boolean|string} [onChangedFiles=false] - Whether to only run on changed files (or glob pattern)
   * @param {string} [changedFilesHeadRef=null] - Head reference for changed files comparison
   * @param {string} [changedFilesBaseRef=null] - Base reference for changed files comparison
   * @param {string} [ifClause=null] - Conditional expression to determine if job should run
   * @param {string} [runsOn=null] - Runner type to use
   * @param {string} [publishBranch=null] - The branch that triggers the publish-prod job; publishes the package <VERSION> specified in package.json and sets latest tag. When null, defaults to `main`/`master`
   * @returns {jobs} - GitHub Actions job definition
   */
  pnpmPublishJob(
    image='mirror.gcr.io/node:24',
    useCredentials=false,
    gitCloneRef='${{ github.sha }}',
    buildSteps=null,
    repositories=['github'],
    onChangedFiles=false,
    changedFilesHeadRef=null,
    changedFilesBaseRef=null,
    ifClause=null,
    runsOn=null,
    publishBranch=null,
  )::
    local effectiveBuildSteps = if buildSteps == null then [base.step('build', 'pnpm run build')] else buildSteps;
    local stepIfClause = (if onChangedFiles != false then "steps.changes.outputs.package == 'true'" else null);
    base.ghJob(
      'pnpm-publish',
      image=image,
      runsOn=runsOn,
      useCredentials=useCredentials,
      steps=
      [self.checkoutAndPnpm(ref=gitCloneRef, fullClone=false, source=repositories[0], pnpmInstallArgs=['--frozen-lockfile'])] +
      (if onChangedFiles != false then misc.testForChangedFiles({ package: onChangedFiles }, headRef=changedFilesHeadRef, baseRef=changedFilesBaseRef) else []) +
      (if onChangedFiles != false then std.map(function(step) std.map(function(s) s { 'if': stepIfClause }, step), effectiveBuildSteps) else effectiveBuildSteps) +
      self.pnpmPublishToRepositories(isPr=false, repositories=repositories, ifClause=stepIfClause, publishBranch=publishBranch),
      permissions={ packages: 'write', contents: 'read', 'pull-requests': 'read' },
      ifClause=ifClause,
    ),
}
