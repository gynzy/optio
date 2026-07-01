local base = import 'base.jsonnet';
local misc = import 'misc.jsonnet';
local pnpm = import 'pnpm.jsonnet';
local yarn = import 'yarn.jsonnet';

{
  /**
   * Creates a complete set of workflows for JavaScript package publishing and testing.
   *
   * Generates three pipelines:
   * 1. 'misc' - Jsonnet validation workflow
   * 2. 'publish-prod' - Production package publishing on branch push
   * 3. 'pr' - Pull request preview publishing and testing
   *
   * @param {array} [repositories=['github']] - The repositories to publish to
   * @param {boolean} [isPublicFork=true] - Whether the repository is a public fork (affects runner selection)
   * @param {boolean} [checkVersionBump=true] - Whether to assert if the version was bumped (recommended)
   * @param {jobs} [testJob=null] - A job to be run during PR to assert tests. Can be an array of jobs
   * @param {string} [branch='main'] - The branch that triggers the publish-prod job; publishes the package <VERSION> specified in package.json and sets latest tag
   * @param {string} [packageManager='yarn'] - Package manager to use ('yarn' or 'pnpm')
   * @param {string} [image=null] - Docker image override for publish jobs; null uses the PM-specific default
   * @param {array} [buildSteps=null] - Build steps override; null uses the PM-specific default. Pass `[]` to skip build.
   * @returns {workflows} - Complete set of GitHub Actions workflows for JavaScript package lifecycle
   */
  workflowJavascriptPackage(
    repositories=['github'],
    isPublicFork=true,
    checkVersionBump=true,
    testJob=null,
    branch='main',
    packageManager='yarn',
    image='mirror.gcr.io/node:24',
    buildSteps=null,
  )::
    local runsOn = (if isPublicFork then 'ubuntu-latest' else null);
    local defaultBuildSteps = if packageManager == 'pnpm' then [base.step('build', 'pnpm run build')]
                              else [base.step('build', 'yarn build')];
    local effectiveBuildSteps = if buildSteps != null then buildSteps else defaultBuildSteps;
    local publishJob = if packageManager == 'pnpm'
                   then pnpm.pnpmPublishJob(repositories=repositories, runsOn=runsOn, image=image, buildSteps=effectiveBuildSteps, publishBranch=branch)
                   else yarn.yarnPublishJob(repositories=repositories, runsOn=runsOn, image=image, buildSteps=effectiveBuildSteps, publishBranch=branch);
    local previewJob = if packageManager == 'pnpm'
                    then pnpm.pnpmPublishPreviewJob(repositories=repositories, runsOn=runsOn, checkVersionBump=checkVersionBump, image=image, buildSteps=effectiveBuildSteps)
                    else yarn.yarnPublishPreviewJob(repositories=repositories, runsOn=runsOn, checkVersionBump=checkVersionBump, image=image, buildSteps=effectiveBuildSteps);

    base.pipeline(
      'misc',
      [misc.verifyJsonnet(fetch_upstream=false, runsOn=runsOn)],
    ) +
    base.pipeline(
      'publish-prod',
      [publishJob],
      event={ push: { branches: [branch] } },
    ) +
    base.pipeline(
      'pr',
      [previewJob] +
      (if testJob != null then
         [testJob]
       else [])
    ),
}
