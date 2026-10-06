local base = import 'base.jsonnet';
local images = import 'images.jsonnet';
local misc = import 'misc.jsonnet';
local notifications = import 'notifications.jsonnet';

local githubApiShell = |||
  set -o pipefail

  api() {
    curl -sSfL --retry 3 --retry-all-errors \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "X-GitHub-Api-Version: 2026-03-10" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}$1";
  }

  mrkdwn() {
    sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g';
  }

  write_multiline_output() {
    DELIMITER="GYNZY_EOF_$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')";
    {
      echo "$1<<${DELIMITER}";
      cat "$2";
      echo "${DELIMITER}";
    } >> $GITHUB_OUTPUT
  }
|||;

{
  /**
   * Internal function to decide whether this merge event should deploy.
   *
   * Two conditions have to hold. The commit this merge produced must still be the tip of
   * the target branch, so a closed PR whose code has since been superseded, or that was
   * merged into another branch, does not deploy. And this PR must be the one whose head
   * holds the merged result, because only that head has CI artifacts covering it.
   *
   * The parents of the merge commit decide the second condition. With one parent the PR
   * was squashed or rebased: its commits were rewritten onto the branch and the tip is this
   * PR's own last commit, so the first condition already settles it. Within a stack every
   * member gets its own such commit, and only the topmost member's is the tip. With two
   * parents it was a merge commit, which a whole stack shares; this PR releases only when
   * its head is one of those parents, which within a stack holds for the topmost member
   * alone, the lower members being mere ancestors of it.
   *
   * Every API call here is needed for that decision, so one that still fails after its
   * retries fails the step and nothing deploys.
   *
   * Emits CREATE_DEPLOY_EVENT, RELEASE_PAYLOAD (the deployment payload as JSON, holding the
   * PR number and branch), and DEPLOY_SUBJECT and DEPLOY_DETAILS with notification text
   * describing only this PR.
   *
   * `docs/stacked-pull-requests.md` records the events a stack merge emits and the payloads
   * the reasoning above rests on.
   *
   * @param {string} branch - The branch the release targets
   * @param {string} [repository='${{ github.repository }}'] - The repository to query
   * @returns {steps} - GitHub Actions steps deciding whether to deploy
   * @private
   */
  _resolveDeployment(branch, repository='${{ github.repository }}')::
    base.step('install jq curl', 'apk add --no-cache jq curl') +
    base.step(
      'resolve deployment',
      githubApiShell + |||

        HEAD_SHA=$(api "/branches/${TARGET_BRANCH}" | jq -r '.commit.sha');
        if [ "${HEAD_SHA}" != "${MERGE_SHA}" ]; then
          echo "Commit ${MERGE_SHA} is not the tip of ${TARGET_BRANCH} (that is ${HEAD_SHA}). No deployment.";
          echo "CREATE_DEPLOY_EVENT=false" >> $GITHUB_OUTPUT
          exit 0
        fi

        PARENTS=$(api "/commits/${MERGE_SHA}" | jq -r '.parents[].sha');
        PARENT_COUNT=$(printf '%s\n' "${PARENTS}" | wc -l)
        if [ "${PARENT_COUNT}" -eq 1 ]; then
          echo "Commit ${MERGE_SHA} has a single parent, so PR ${PR_NUMBER} was squashed or rebased and its own commit is the tip of ${TARGET_BRANCH}.";
        elif [ "${PARENT_COUNT}" -eq 2 ] && printf '%s\n' "${PARENTS}" | grep -qx "${PR_HEAD_SHA}"; then
          echo "Merge commit ${MERGE_SHA} has PR ${PR_NUMBER}'s head ${PR_HEAD_SHA} as a parent.";
        else
          echo "Merge commit ${MERGE_SHA} does not have PR ${PR_NUMBER}'s head ${PR_HEAD_SHA} as a parent, so another PR carries this merge. No deployment.";
          echo "CREATE_DEPLOY_EVENT=false" >> $GITHUB_OUTPUT
          exit 0
        fi

        echo "PR ${PR_NUMBER} carries the merged result and will be deployed.";
        echo "CREATE_DEPLOY_EVENT=true" >> $GITHUB_OUTPUT
        echo "RELEASE_PAYLOAD=$(jq -nc \
          --arg pr "${PR_NUMBER}" --arg branch "${PR_HEAD_REF}" \
          '{pr: ($pr | tonumber), branch: $branch}')" >> $GITHUB_OUTPUT

        if [ -z "${STACK_NUMBER}" ]; then
          echo "DEPLOY_SUBJECT=<${PR_HTML_URL}|*PR ${PR_NUMBER}*>" >> $GITHUB_OUTPUT
          printf 'Title: %s\nBranch: %s\n' \
            "$(printf '%s' "${PR_TITLE}" | mrkdwn)" \
            "$(printf '%s' "${PR_HEAD_REF}" | mrkdwn)" > /tmp/deploy-details
        else
          echo "DEPLOY_SUBJECT=Stack ${STACK_NUMBER}" >> $GITHUB_OUTPUT
          printf 'PRs in this stack:\n• <%s|PR %s>: %s\n' "${PR_HTML_URL}" "${PR_NUMBER}" \
            "$(printf '%s' "${PR_TITLE}" | mrkdwn)" > /tmp/deploy-details
        fi
        write_multiline_output DEPLOY_DETAILS /tmp/deploy-details
      |||,
      env={
        GITHUB_REPOSITORY: repository,
        GITHUB_TOKEN: '${{ github.token }}',
        TARGET_BRANCH: branch,
        MERGE_SHA: '${{ github.sha }}',
        PR_NUMBER: '${{ github.event.number }}',
        PR_HEAD_REF: '${{ github.event.pull_request.head.ref }}',
        PR_HTML_URL: '${{ github.event.pull_request.html_url }}',
        PR_TITLE: '${{ github.event.pull_request.title }}',
        PR_HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
        STACK_NUMBER: '${{ github.event.pull_request.stack.number }}',
      },
      id='resolve-deployment',
    ),

  /**
   * Internal function to list the stack members a merge releases, for the notification.
   *
   * Runs only once `_resolveDeployment` has decided this PR deploys and it is part of a
   * stack. The stack lists its members from bottom to top, and every member targets the
   * head branch of the member below it, except the lowest one of what is merged in one go:
   * that targets the release branch, either because it is the bottom of the stack or because
   * an earlier partial merge retargeted it there. The members this merge releases are
   * therefore the ones from the last member targeting the release branch up to this PR,
   * whatever the merge method.
   *
   * The listing's order is not documented, but testing shows that it is from bottom to top. To
   * simplify the code, this function makes the assumption that the stack members are listed in
   * this order.
   *
   * The deployment does not depend on this step, so the step may fail: DEPLOY_DETAILS is
   * then unset and the notification falls back to the text describing only this PR.
   *
   * @param {string} branch - The branch the release targets
   * @param {string} [repository='${{ github.repository }}'] - The repository to query
   * @returns {steps} - GitHub Actions step emitting DEPLOY_DETAILS
   * @private
   */
  _describeReleasedStackMembers(branch, repository='${{ github.repository }}')::
    base.step(
      'describe released stack members',
      githubApiShell + |||

        api "/stacks/${STACK_NUMBER}" \
          | jq -r '.pull_requests | reverse[] | [.number, .base.ref, .html_url, .title] | @tsv' > /tmp/stack-members-top-down

        FOUND_START=false
        : > /tmp/released-members-top-down
        while IFS="$(printf '\t')" read -r MEMBER_PR MEMBER_BASE MEMBER_URL MEMBER_TITLE; do
          if [ "${MEMBER_PR}" = "${PR_NUMBER}" ]; then
            FOUND_START=true
          fi
          if [ "${FOUND_START}" != true ]; then
            continue
          fi
          printf '• <%s|PR %s>: %s\n' "${MEMBER_URL}" "${MEMBER_PR}" \
            "$(printf '%s' "${MEMBER_TITLE}" | mrkdwn)" >> /tmp/released-members-top-down
          if [ "${MEMBER_BASE}" = "${TARGET_BRANCH}" ]; then
            break
          fi
        done < /tmp/stack-members-top-down

        if [ "${FOUND_START}" != true ]; then
          echo "PR ${PR_NUMBER} is not in stack ${STACK_NUMBER}.";
          exit 1
        fi
        tac /tmp/released-members-top-down > /tmp/released-members
        echo "Released by this merge:";
        cat /tmp/released-members

        printf 'PRs in this stack:\n' > /tmp/deploy-details
        cat /tmp/released-members >> /tmp/deploy-details
        write_multiline_output DEPLOY_DETAILS /tmp/deploy-details
      |||,
      env={
        GITHUB_REPOSITORY: repository,
        GITHUB_TOKEN: '${{ github.token }}',
        TARGET_BRANCH: branch,
        PR_NUMBER: '${{ github.event.number }}',
        STACK_NUMBER: '${{ github.event.pull_request.stack.number }}',
      },
      ifClause="${{ steps.resolve-deployment.outputs.CREATE_DEPLOY_EVENT == 'true' && github.event.pull_request.stack.number }}",
      id='describe-released-stack-members',
      continueOnError=true,
    ),

  /**
   * Creates a production deployment event on PR close if all conditions are met.
   *
   * Conditions:
   * - The PR is merged
   * - The merge SHA is the latest commit on the default branch
   * - The PR carries the merged result: it was squashed or rebased, or its head is a parent
   *   of the merge commit
   *
   * A stack merges as one atomic operation, so all its members close at once. The event is
   * created for the topmost member only, whose head has CI artifacts for the combined
   * changes, and the notification lists the members the merge adds.
   *
   * For more complex deployment scenarios, use the branchMergeDeploymentEventHook instead.
   * For what a stack merge emits and how its members are told apart, see
   * `docs/stacked-pull-requests.md`.
   *
   * @param {boolean} [deployToTest=false] - If true, a deployment event is also created for the test environment
   * @param {string} [prodBranch=null] - The branch to deploy to production. Defaults to the default branch of the repository, but can be set to a different release branch
   * @param {string} [testBranch=null] - The branch to deploy to test. Defaults to the default branch of the repository, but can be set to a different test branch
   * @param {array} [deployTargets=['production']] - Deploy targets to create deployment events for. These targets will trigger based on the configured prodBranch
   * @param {string} [runsOn=null] - The name of the runner to run this job on. Defaults to null, which means the default self-hosted runner will be used
   * @param {boolean} [notifyOnTestDeploy=false] - If true, a Slack message is sent when a test deployment is created
   * @returns {workflows} - GitHub Actions pipeline for deployment event creation on PR merge
   */
  masterMergeDeploymentEventHook(deployToTest=false, prodBranch=null, testBranch=null, deployTargets=['production'], runsOn=null, notifyOnTestDeploy=false)::
    local branches = [
      {
        branch: (if prodBranch != null then prodBranch else '_default_'),
        deployments: deployTargets,
        notifyOnDeploy: true,
      },
    ] + (if deployToTest then [
           {
             branch: (if testBranch != null then testBranch else '_default_'),
             deployments: ['test'],
             notifyOnDeploy: notifyOnTestDeploy,
           },
         ] else []);

    self.branchMergeDeploymentEventHook(branches, runsOn=runsOn),

  /**
   * Creates deployment events on PR close for multiple branches with different deployment targets.
   *
   * Conditions:
   * - The PR is merged
   * - The merge SHA is the latest commit on the target branch
   * - The PR carries the merged result: it was squashed or rebased, or its head is a parent
   *   of the merge commit
   *
   * For what a stack merge emits and how its members are told apart, see
   * `docs/stacked-pull-requests.md`.
   *
   * @param {array} branches - Array of branch objects to create deployment events for
   * @param {string} branches[].branch - The branch to which the PR has to be merged. If '_default_' is used, the default branch of the repository is used
   * @param {array} branches[].deployments - The environments to deploy to (e.g., ['production', 'test'])
   * @param {boolean} branches[].notifyOnDeploy - If true, a Slack message is sent when a deployment is created
   * @param {string} [runsOn=null] - The name of the runner to run this job on. Defaults to null, which means the default self-hosted runner will be used
   * @returns {workflows} - GitHub Actions pipeline for deployment event creation on PR merge to multiple branches
   */
  branchMergeDeploymentEventHook(branches, runsOn=null)::
    base.pipeline(
      'create-merge-deployment',
      [
        (
          local branchName = if branch.branch == '_default_' then '${{ github.event.pull_request.base.repo.default_branch }}' else branch.branch;
          local branchNameForJob = if branch.branch == '_default_' then 'default-branch' else branch.branch;

          local ifClause = "${{ steps.resolve-deployment.outputs.CREATE_DEPLOY_EVENT == 'true' }}";

          local releasePayload = '${{ steps.resolve-deployment.outputs.RELEASE_PAYLOAD }}';
          local deploySubject = '${{ steps.resolve-deployment.outputs.DEPLOY_SUBJECT }}';
          local deployDetails = '${{ steps.describe-released-stack-members.outputs.DEPLOY_DETAILS || steps.resolve-deployment.outputs.DEPLOY_DETAILS }}';

          base.ghJob(
            'create-merge-deployment-' + branchNameForJob + '-to-' + std.join('-', branch.deployments),
            useCredentials=false,
            runsOn=runsOn,
            permissions={ deployments: 'write', contents: 'read', 'pull-requests': 'read' },
            ifClause='${{ github.event.pull_request.merged == true}}',
            steps=[self._resolveDeployment(branch=branchName), self._describeReleasedStackMembers(branch=branchName)] +
                  std.map(
                    function(deploymentTarget)
                      base.action(
                        'publish-deploy-' + deploymentTarget + '-event',
                        'chrnorm/deployment-action@500aa6a23c81ffa1acf71072aee3cfa2cc2e556a',  // v2
                        ifClause=ifClause,
                        with={
                          token: misc.secret('VIRKO_GITHUB_TOKEN'),
                          environment: deploymentTarget,
                          'auto-merge': 'false',
                          ref: '${{ github.event.pull_request.head.sha }}',
                          description: 'Auto deploy ' + deploymentTarget + ' on PR merge. pr: ${{ github.event.number }} ref: ${{ github.event.pull_request.head.sha }}',
                          payload: releasePayload,
                        }
                      ),
                    branch.deployments,
                  ) +
                  (
                    if branch.notifyOnDeploy then
                      [
                        notifications.sendSlackMessage(
                          message='Deploy to ' + std.join(' and ', branch.deployments) + ' of ' + deploySubject + ' started!\n' + deployDetails,
                          ifClause=ifClause,
                        ),
                      ]
                    else []
                  ),
          )
        )
        for branch in branches
      ],
      event={
        pull_request: {
          types: ['closed'],
        },
      },
    ),

  /**
   * Generate a GitHub ifClause for the provided deployment targets.
   *
   * @param {array} targets - Array of deployment target environment names
   * @param {boolean} [virkoOnly=true] - If true, also require the deployment event to be created by 'gynzy-virko', preventing manually created deployment events from triggering the job
   * @returns {string} - GitHub Actions conditional expression that matches any of the provided targets
   */
  deploymentTargets(targets, virkoOnly=true)::
    "${{ github.event_name == 'deployment' && (" + std.join(' || ', std.map(function(target) "github.event.deployment.environment == '" + target + "'", targets)) + ')' + (if virkoOnly then " && github.event.deployment.creator.login == 'gynzy-virko'" else '') + ' }}',

  /**
   * Creates a step to update deployment status (success/failure) based on the result from the current job
   *
   * @returns {jobs} - GitHub Actions step that updates deployment status
   */
  updateDeploymentStatus(status='${{ job.status }}')::
    base.action(
      'Update deployment status',
      'chrnorm/deployment-status@6df8d036fd2fee9eb82936733953da1f8382b41e',  // v2
      with={
        state: status,
        'deployment-id': '${{ github.event.deployment.id }}',
        token: '${{ secrets.GITHUB_TOKEN }}',
      },
      ifClause='${{ always() }}',
    ),
}
