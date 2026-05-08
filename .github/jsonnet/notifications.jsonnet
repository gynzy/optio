local actions = import 'actions.jsonnet';
local base = import 'base.jsonnet';

{
  /**
   * Creates a Slack notification step that triggers on deployment failure.
   *
   * @param {string} [channel='#dev-deployments'] - Slack channel to send the notification to
   * @param {string} [name='notify-failure'] - Name of the notification step
   * @param {string} [environment='production'] - Environment name to include in the failure message
   * @returns {steps} - GitHub Actions step that sends Slack notification on job failure
   */
  notifiyDeployFailure(channel='#dev-deployments', name='notify-failure', environment='production')::
    base.action(
      name,
      actions.slack_action,
      with={
        status: '${{ job.status }}',
        channel: channel,
        'webhook-url': '${{ secrets.SLACK_WEBHOOK_DEPLOY_NOTIFICATION }}',
        message: 'Deploy of job ${{ github.job }} to env: ' + environment + ' failed!',
      },
      ifClause='failure()',
    ),

  /**
   * Creates a Slack notification step with a custom message.
   *
   * @param {string} [channel='#dev-deployments'] - Slack channel to send the message to
   * @param {string} [stepName='sendSlackMessage'] - Name of the notification step
   * @param {string} [message=null] - Custom message to send to Slack
   * @param {string} [ifClause=null] - Conditional expression to determine when to send the message
   * @returns {steps} - GitHub Actions step that sends a Slack message
   */
  sendSlackMessage(channel='#dev-deployments', stepName='sendSlackMessage', message=null, ifClause=null)::
    base.action(
      stepName,
      actions.slack_action,
      with={
        status: 'starting',
        channel: channel,
        'webhook-url': '${{ secrets.SLACK_WEBHOOK_DEPLOY_NOTIFICATION }}',
        message: message,
      },
      ifClause=ifClause,
    ),

  /**
   * Creates a New Relic deployment marker to track deployments in APM.
   *
   * This action creates a deployment marker in New Relic to help correlate performance
   * changes with deployments. The GUID can be found by navigating to:
   * All Entities > (select service) > Metadata > Entity GUID in New Relic
   *
   * @param {string} [stepName='newrelic-deployment'] - Name of the deployment marker step
   * @param {string} entityGuid - New Relic entity GUID for the application
   * @param {string} [ifClause=null] - Conditional expression to determine when to set the deployment marker
   * @returns {steps} - GitHub Actions step that creates a New Relic deployment marker
   */
  newrelicCreateDeploymentMarker(entityGuid, stepName='newrelic-deployment', ifClause=null)::
    base.action(
      stepName,
      'newrelic/deployment-marker-action@60142df2a3f5c23d3294486f474299b8f490cd90',  // v2.5.0
      with={
        apiKey: $.secret('NEWRELIC_API_KEY'),
        guid: entityGuid,
        commit: '${{ github.sha }}',
        version: '${{ github.sha }}',
      },
      ifClause=ifClause,
    ),
}
