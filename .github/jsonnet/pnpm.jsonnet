local actions = import 'actions.jsonnet';
local base = import 'base.jsonnet';
local cache = import 'cache.jsonnet';
local misc = import 'misc.jsonnet';
local yarn = import 'yarn.jsonnet';

{
  /**
   * Creates an action to install pnpm itself and then to run pnpm install
   *
   * @param {array} [args=[]] - Additional command line arguments for pnpm install
   * @param {object} [with={}] - Additional configuration options
   * @param {string} [version='10'] - PNPM version to use
   * @param {boolean} [prod=false] - Whether to install only production dependencies
   * @param {string} [storeDir=null] - Directory for pnpm store
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @param {string} [workingDirectory=null] - Directory to run pnpm in
   * @returns {steps} - Array containing a single step object
   */
  install(args=[], with={}, version='10', prod=false, storeDir=null, ifClause=null, workingDirectory=null)::
    base.action(
      'Install pnpm tool',
      'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320',  // v5
      with=
      { version: version } +
      with,
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
   * @param {string} [source='gynzy'] - Registry source ('gynzy' or 'github')
   * @param {array} [pnpmInstallArgs=[]] - Additional arguments for pnpm install command
   * @param {boolean} [setupPnpm=true] - Whether to set up and install pnpm itself before installing all packages
   * @returns {steps} - Array of step objects for the complete workflow
   */
  checkoutAndPnpm(
    cacheName=null,
    ifClause=null,
    fullClone=false,
    ref=null,
    prod=false,
    workingDirectory=null,
    source='gynzy',
    pnpmInstallArgs=[],
    setupPnpm=true,
  )::
    misc.checkout(ifClause=ifClause, fullClone=fullClone, ref=ref) +
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
   * @returns {workflows} - Complete GitHub Actions pipeline configuration
   */
  updatePnpmCachePipeline(cacheName, appsDir='packages', image=null, useCredentials=null, setupPnpm=true, source=null, runsOn=null)::
    base.pipeline(
      'update-pnpm-cache',
      [
        base.ghJob(
          'update-pnpm-cache',
          runsOn=runsOn,
          image=image,
          useCredentials=useCredentials,
          ifClause="${{ github.event.deployment.environment == 'production' || github.event.deployment.environment == 'prod' }}",
          steps=[
            self.checkoutAndPnpm(
              cacheName=null,  // to populate cache we want a clean install
              setupPnpm=setupPnpm,
              source=source,
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
   * @returns {workflows} - Complete GitHub Actions pipeline configuration
   */
  pnpmAuditPipeline(cacheName=null, image=null, setupPnpm=true, pnpmInstallArgs=[], auditLevel='moderate', runsOn=null)::
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
            ),
            base.step('pnpm-audit', 'pnpm audit --audit-level=' + auditLevel),
          ],
        ),
      ],
      event='pull_request',
    ),
}
