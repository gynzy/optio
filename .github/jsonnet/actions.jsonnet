/**
 * GitHub Action plugin references
 *
 * Centralised SHA-pinned references for external GitHub Actions used across workflows.
 * Pinning to a SHA (rather than a tag) protects against supply-chain attacks where a
 * tag is moved to point at a malicious commit. The trailing comment records the
 * human-readable version that the SHA corresponds to at the time of pinning.
 */
{
  checkout_action: 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',  // v7
  gcp_auth_action: 'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',  // v3
  gcp_setup_gcloud_action: 'google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db',  // v3
  pulumi_action: 'pulumi/actions@cd99a7f8865434dd3532b586a26f9ebea596894f',  // v5
  onepassword_load_secrets_action: '1password/load-secrets-action@92467eb28f72e8255933372f1e0707c567ce2259',  // v4
  slack_action: 'act10ns/slack@d96404edccc6d6467fc7f8134a420c851b1e9054',  // v2
}
