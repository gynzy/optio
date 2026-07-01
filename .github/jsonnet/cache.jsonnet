local base = import 'base.jsonnet';
local images = import 'images.jsonnet';
local misc = import 'misc.jsonnet';

{
  /**
   * Fetch a cache from the cache server.
   *
   * This is a generic function that can be used to fetch any cache. It is advised to wrap this function
   * in a more specific function that fetches a specific cache, setting the cacheName and folders parameters.
   *
   * To be paired with the uploadCache function.
   *
   * @param {string} cacheName - The name of the cache to fetch. The name of the repository is usually a good option.
   * @param {string} [backupCacheName=null] - The name of a backup cache to fetch if the main cache fails.
   * @param {array} [folders=[]] - A list of folders that are in the cache. These will be deleted if the download fails. Can be an empty list if additionalCleanupCommands are used.
   * @param {string} [version='v1'] - The version of the cache to fetch.
   * @param {string} [backupCacheVersion=version] - The version of the backup cache to fetch.
   * @param {array} [additionalCleanupCommands=[]] - A list of additional commands to run if the download fails.
   * @param {string} [ifClause=null] - An optional if clause to conditionally run this step.
   * @param {string} [workingDirectory=null] - The working directory for this step.
   * @param {boolean} [retry=true] - Whether to retry the download if it fails.
   * @param {boolean} [continueWithoutCache=true] - Whether to continue if the cache is not found.
   * @returns {steps} - GitHub Actions step to download cache from Google Cloud Storage
   */
  fetchCache(
    cacheName,
    backupCacheName=null,
    folders=[],
    version='v1',
    backupCacheVersion=version,
    additionalCleanupCommands=[],
    ifClause=null,
    workingDirectory=null,
    retry=true,
    continueWithoutCache=true,
  )::
    assert std.length(folders) > 0 || std.length(additionalCleanupCommands) > 0;

    local downloadCommand(cacheName, version, nextSteps, indent = '') =
      indent + 'wget -q -O - "https://storage.googleapis.com/files-gynzy-com-test/ci-cache/' + cacheName + '-' + version + '.tar.zst" | tar --extract --zstd \n' +
      indent + 'if [ $? -ne 0 ]; then\n' +
      indent + '  echo "Cache download failed, cleanup up partial downloads"\n' +
      (if std.length(folders) > 0 then indent + '  rm -rf ' + std.join(' ', folders) + '\n' else '') +
      std.join(' ', std.map(function(cmd) indent + '  ' + cmd + '\n', additionalCleanupCommands)) +
      indent + '  echo "Cleanup complete"; echo\n\n' +
      nextSteps +
      indent + 'fi\n';

    local downloadCommandWithRetry(cacheName, version, nextSteps, indent = '') =
      downloadCommand(
        cacheName,
        version,
        if retry then
          indent + '  echo "Retrying download..."\n' +
          downloadCommand(cacheName, version, nextSteps, indent + '  ')
        else
          nextSteps,
        indent,
      );

    local backupIndent = (if retry then '    ' else '  ');

    local downloadFailedCommand = backupIndent + 'echo "Cache download failed :( ' + (if continueWithoutCache then 'Continuing without cache"' else 'Aborting"; exit 1') + '\n';

    base.step(
      'download ' + cacheName + ' cache',
      run=
      'set +e;\n' +
      'command -v zstd || { apt update && apt install -y zstd; }\n' +
      'echo "Downloading cache"\n' +
      downloadCommandWithRetry(
        cacheName,
        version,
        if backupCacheName != null then
          backupIndent + 'echo "Downloading backup cache"\n' +
          downloadCommandWithRetry(backupCacheName, backupCacheVersion, backupIndent + downloadFailedCommand, indent=backupIndent)
        else
          downloadFailedCommand,
      ),
      ifClause=ifClause,
      workingDirectory=workingDirectory,
    ),

  /**
   * Uploads a cache to the cache server.
   *
   * This is a generic function that can be used to upload any cache. It is advised to wrap this function
   * in a more specific function that uploads a specific cache, setting the cacheName and folders parameters.
   *
   * To be paired with the fetchCache function.
   *
   * @param {string} cacheName - The name of the cache to upload. The name of the repository is usually a good option.
   * @param {array} [folders=null] - A list of folders to include in the cache. Required unless tarCommand is given.
   * @param {string} [version='v1'] - The version of the cache to upload.
   * @param {number} [compressionLevel=10] - The compression level to use for zstd.
   * @param {string} [tarCommand='tar -c ' + std.join(' ', folders)] - The command to run to create the tar file.
   * @returns {steps} - GitHub Actions step to upload cache to Google Cloud Storage with zstd compression
   */
  uploadCache(
    cacheName,
    folders=null,
    version='v1',
    compressionLevel=10,
    tarCommand='tar -c ' + std.join(' ', folders),
  )::
    local cacheBucketPath = function(temp=false)
      'gs://files-gynzy-com-test/ci-cache/' + cacheName + '-' + version + '.tar.zst' + (if temp then '.tmp' else '');

    base.step(
      'upload-gatsby-cache',
      run=
      'set -e\n' +
      '\n' +
      'command -v zstd || { apt update && apt install -y zstd; }\n' +
      '\n' +
      'echo "Create and upload cache"\n' +
      tarCommand + ' | zstdmt -' + compressionLevel + ' | gsutil cp - "' + cacheBucketPath(temp=true) + '"\n' +
      'gsutil mv "' + cacheBucketPath(temp=true) + '" "' + cacheBucketPath(temp=false) + '"\n' +

      'echo "Upload finished"\n'
    ),

  /**
   * Removes a cache from the cache server and optionally removes local folders.
   *
   * This is a generic function that can be used to remove any cache. It is advised to wrap this function
   * in a more specific function that removes a specific cache, setting the cacheName parameter.
   *
   * @param {string} cacheName - The name of the cache to remove. The name of the repository is usually a good option.
   * @param {string} [version='v1'] - The version of the cache to remove.
   * @param {array} [folders=[]] - Local folders to delete alongside the remote cache.
   * @param {string} [ifClause=null] - An optional if clause to conditionally run this step.
   * @returns {steps} - GitHub Actions step to remove cache from Google Cloud Storage
   */
  removeCache(cacheName, version='v1', folders=[], ifClause=null)::
    base.step(
      'remove ' + cacheName + ' cache',
      run=
      'set +e;\n' +
      (if std.length(folders) > 0 then 'rm -rf ' + std.join(' ', folders) + '\n' else '') +
      'gsutil rm "gs://files-gynzy-com-test/ci-cache/' + cacheName + '-' + version + '.tar.zst"\n' +
      'echo "Cache removed"\n',
      ifClause=ifClause,
    ),

/**
   * Daily (weekday) backup of the full repository (working tree + .git) to GCS as a zstd tar archive,
   * then refreshes a 7-day signed HTTPS URL into the GIT_HTTPS_ARCHIVE_MIRROR repo secret.
   *
   * @param {string} [cron='0 1 * * 1-5'] - Schedule (UTC). Default 01:00 on weekdays.
   * @param {string} [bucketPath='gs://gynzy-internal-files/git-mirror'] - Destination prefix.
   * @returns {workflows} - GitHub Actions pipeline that mirrors the repository to GCS.
   */
  updateGitCacheCron(
    cron='0 1 * * 1-5',
  )::
    local secret = self.secret;
    local destUrl = 'gs://gynzy-internal-files/git-mirror/${GITHUB_REPOSITORY}.tar.zst';
    base.pipeline(
      'git-mirror-backup',
      [
        base.ghJob(
          'git-mirror-backup',
          image=images.cloud_sdk_image,
          useCredentials=true,
          timeoutMinutes=60,
          steps=[
            // blobless=false: a backup must contain ALL git objects, not lazily-fetched blobs.
            misc.checkout(fullClone=true, blobless=false, cloneTimeout=30, skipSeed=true),
            base.step(
              'authenticate gcloud',
              |||
                set -euo pipefail
                # Write the key OUTSIDE the workspace so it never lands in the archive.
                printf '%s' "$SERVICE_JSON" > "$RUNNER_TEMP/gce.json"
                gcloud auth activate-service-account --key-file="$RUNNER_TEMP/gce.json"
              |||,
              shell='bash',
              env={ SERVICE_JSON: misc.secret('SERVICE_JSON') },
            ),
            base.step(
              'create and upload archive',
              |||
                set -euo pipefail
                # checkStat=minimal makes git compare only mtime+size (which tar preserves),
                # not ctime/inode. Consumers that seed from this archive then see a clean tree
                # and only write the real diff during checkout instead of rewriting every file.
                git -C "$GITHUB_WORKSPACE" config --local core.checkStat minimal

                DEST="%s"

                # Upload to a temp object first, then atomically move into place so a partial
                # upload can never sit at the final destination.
                tar -C "$GITHUB_WORKSPACE" -c . | zstdmt -10 | gcloud storage cp - "${DEST}.tmp"
                gcloud storage mv "${DEST}.tmp" "$DEST"
              ||| % destUrl,
              shell='bash',
            ),
            base.step(
              'refresh signed-url secret',
              |||
                set -euo pipefail
                DEST="%s"
                URL="$(gcloud storage sign-url "$DEST" \
                  --private-key-file="$RUNNER_TEMP/gce.json" --http-verb=GET --duration=7d \
                  --format='value(signed_url)')"
                echo "::add-mask::$URL"
                gh secret set "GIT_HTTPS_ARCHIVE_MIRROR" --repo "$GITHUB_REPOSITORY" --body "$URL"
              ||| % destUrl,
              shell='bash',
              env={
                GH_TOKEN: misc.secret('VIRKO_GITHUB_TOKEN'),
              },
            ),
            base.step(
              'remove credentials',
              'rm -f "$RUNNER_TEMP/gce.json"',
              ifClause='${{ always() }}',
            ),
          ],
        ),
      ],
      event={ schedule: [{ cron: cron }], workflow_dispatch: {} },
      permissions={ contents: 'read' },
    ),
}
