local actions = import 'actions.jsonnet';
local base = import 'base.jsonnet';

/**
 * Python / uv workflow helpers
 *
 * Sets up a Python toolchain for CI jobs with astral.sh's uv: installs the uv binary
 * (SHA-pinned, see actions.jsonnet) and materialises the locked dependencies of a uv
 * project into a virtualenv.
 *
 * Assumes the repository is a uv project: a pyproject.toml with a committed uv.lock next
 * to it (inside workingDirectory, when given). There is deliberately no poetry or bare-pip
 * fallback; repos on those must migrate first.
 *
 * The uv version is deliberately NOT pinned in this library. installUv() omits the action's
 * `version` input, so setup-uv falls back to `[tool.uv] required-version` in the consumer's
 * pyproject.toml. That keeps a single source of truth per repo (which renovate already reads
 * when it runs `uv lock`) and lets a repo bump uv without a lib-jsonnet release.
 */
{
  /**
   * Creates an action to install the uv binary and configure the GitHub Actions cache for
   * uv's package cache.
   *
   * Installs no dependencies; see sync() for that, or setup() for both.
   *
   * @param {string} [uvVersion=null] - uv version to install; null lets setup-uv read
   *                                    `[tool.uv] required-version` from pyproject.toml
   * @param {string} [pythonVersion=null] - Python version to set UV_PYTHON to (e.g. '3.12.13').
   *                                        Only useful on runners that do not already provide a
   *                                        suitable interpreter; container-based jobs should pin
   *                                        via the job image instead.
   * @param {boolean} [enableCache=true] - Enable the GitHub Actions cache for uv's package cache
   * @param {string} [cacheDependencyGlob='uv.lock'] - Glob, relative to workingDirectory, whose
   *                                                   contents key the cache
   * @param {string} [cacheSuffix=null] - Extra cache key component. Use when jobs in one repo sync
   *                                      disjoint dependency sets and should not share a key.
   * @param {string} [workingDirectory=null] - Directory uv runs in and looks for pyproject.toml /
   *                                           uv.lock; also the base for cacheDependencyGlob
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @returns {steps} - Array containing a single step object
   */
  installUv(
    uvVersion=null,
    pythonVersion=null,
    enableCache=true,
    cacheDependencyGlob='uv.lock',
    cacheSuffix=null,
    workingDirectory=null,
    ifClause=null,
  )::
    base.action(
      'setup uv',
      actions.setup_uv_action,
      with={
             // The action's default is 'auto', which it resolves to FALSE whenever
             // RUNNER_ENVIRONMENT != github-hosted, on the assumption that a self-hosted runner
             // keeps its filesystem between runs. arc-runner-* pods are ephemeral, so that
             // assumption does not hold and 'auto' would mean no caching at all. 'auto' also
             // disables the cache for release, tag push, pull_request_target and workflow_run
             // events even on github-hosted runners, which we do want cached.
             'enable-cache': enableCache,
             // The cache save step runs in the job's post phase and lets its errors reach
             // core.setFailed, so a missing cache dir would fail an otherwise green job.
             'ignore-nothing-to-cache': true,
             // The action's default globs include **/pyproject.toml; narrow it to the lock so
             // unrelated manifest edits (a new poe task, a lint rule) don't invalidate the cache.
             'cache-dependency-glob': cacheDependencyGlob,
           }
           // 'version' is intentionally omitted when uvVersion is null; see the module header.
           + (if uvVersion != null then { version: uvVersion } else {})
           + (if pythonVersion != null then { 'python-version': pythonVersion } else {})
           + (if cacheSuffix != null then { 'cache-suffix': cacheSuffix } else {})
           + (if workingDirectory != null then { 'working-directory': workingDirectory } else {}),
      ifClause=ifClause,
    ),

  /**
   * Creates a step to run `uv sync`, materialising the locked dependencies into a virtualenv.
   *
   * Requires uv on PATH; call installUv() first, or use setup() which does both.
   *
   * @param {string|array} [groups='all'] - Which PEP 735 dependency groups to install:
   *   - 'all'      -> `--all-groups`; every group. The CI default, and the equivalent of what
   *                   `poetry install --no-root` did.
   *   - ['a', 'b'] -> `--no-default-groups --group a --group b`
   *   - []         -> `--no-default-groups`; only [project.dependencies]
   *   - null       -> no group flags at all; uses `[tool.uv] default-groups` from pyproject.toml
   * @param {boolean} [locked=true] - Pass `--locked`, failing the job when uv.lock is out of date
   *                                  with pyproject.toml instead of silently re-resolving
   * @param {array} [extraArgs=[]] - Additional command line arguments for `uv sync`
   * @param {boolean} [venvOnPath=true] - Append the project venv's bin dir to $GITHUB_PATH, so later
   *                                      steps can invoke `python`, `pytest`, `alembic`, `poe`, ...
   *                                      directly instead of prefixing every one with `uv run`
   *                                      (which re-checks the lock on each invocation). Assumes uv's
   *                                      default environment location, `.venv` next to pyproject.toml;
   *                                      pass false when the repo sets UV_PROJECT_ENVIRONMENT.
   * @param {boolean} [useSystemPython=false] - Set UV_PYTHON_PREFERENCE=only-system and
   *                                            UV_PYTHON_DOWNLOADS=never, so uv fails loudly instead
   *                                            of silently downloading a managed interpreter when the
   *                                            job image's Python drifts from `requires-python` /
   *                                            `.python-version`. Recommended for container jobs on a
   *                                            pinned python image; leave false on github-hosted
   *                                            runners that rely on uv to provide the interpreter.
   * @param {string} [workingDirectory=null] - Directory to run `uv sync` in
   * @param {string} [ifClause=null] - Conditional expression to determine if step should run
   * @returns {steps} - Array containing a single step object
   */
  sync(
    groups='all',
    locked=true,
    extraArgs=[],
    venvOnPath=true,
    useSystemPython=false,
    workingDirectory=null,
    ifClause=null,
  )::
    assert groups == null || groups == 'all' || std.isArray(groups) : "python.sync: groups must be 'all', an array of group names, or null";
    local groupArgs =
      if groups == null then []
      else if groups == 'all' then ['--all-groups']
      else ['--no-default-groups'] + std.flatMap(function(group) ['--group', group], groups);
    local syncArgs = (if locked then ['--locked'] else []) + groupArgs + extraArgs;
    base.step(
      'uv sync',
      'uv sync' +
      (if std.length(syncArgs) > 0 then ' ' + std.join(' ', syncArgs) else '') +
      // $PWD is the step's working directory, so with workingDirectory set this resolves to
      // <workingDirectory>/.venv/bin -- exactly where uv put the environment.
      (if venvOnPath then ' && echo "$PWD/.venv/bin" >> $GITHUB_PATH' else ''),
      env=(if useSystemPython then { UV_PYTHON_PREFERENCE: 'only-system', UV_PYTHON_DOWNLOADS: 'never' } else null),
      workingDirectory=workingDirectory,
      ifClause=ifClause,
    ),

  /**
   * Creates the steps to install uv and sync the project's locked dependencies.
   *
   * This is the helper nearly every job wants. Equivalent to installUv() + sync().
   *
   * @param {string|array} [groups='all'] - See sync()
   * @param {boolean} [locked=true] - See sync()
   * @param {array} [extraArgs=[]] - See sync()
   * @param {boolean} [venvOnPath=true] - See sync()
   * @param {boolean} [useSystemPython=false] - See sync()
   * @param {string} [uvVersion=null] - See installUv()
   * @param {string} [pythonVersion=null] - See installUv()
   * @param {boolean} [enableCache=true] - See installUv()
   * @param {string} [cacheDependencyGlob='uv.lock'] - See installUv()
   * @param {string} [cacheSuffix=null] - See installUv()
   * @param {string} [workingDirectory=null] - Directory to run uv in; applies to both steps
   * @param {string} [ifClause=null] - Conditional expression; applies to both steps
   * @returns {steps} - Array of two step objects: setup-uv, then `uv sync`
   *
   * @example
   * // A test job in a single-project repo
   * util.ghJob('test', image=util.default_python_image, useCredentials=false, steps=[
   *   util.checkout(),
   *   util.python.setup(),
   *   util.step('unit tests', 'python -m pytest -vvv'),
   * ])
   *
   * @example
   * // A monorepo sub-project, only the groups that job needs
   * util.python.setup(groups=['dev'], workingDirectory='services/api')
   */
  setup(
    groups='all',
    locked=true,
    extraArgs=[],
    venvOnPath=true,
    useSystemPython=false,
    uvVersion=null,
    pythonVersion=null,
    enableCache=true,
    cacheDependencyGlob='uv.lock',
    cacheSuffix=null,
    workingDirectory=null,
    ifClause=null,
  )::
    self.installUv(
      uvVersion=uvVersion,
      pythonVersion=pythonVersion,
      enableCache=enableCache,
      cacheDependencyGlob=cacheDependencyGlob,
      cacheSuffix=cacheSuffix,
      workingDirectory=workingDirectory,
      ifClause=ifClause,
    ) +
    self.sync(
      groups=groups,
      locked=locked,
      extraArgs=extraArgs,
      venvOnPath=venvOnPath,
      useSystemPython=useSystemPython,
      workingDirectory=workingDirectory,
      ifClause=ifClause,
    ),
}
