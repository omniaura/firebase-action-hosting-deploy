# 🔥🌎 Cached Firebase Hosting GitHub Action

> **This is a fork of [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy) with caching optimizations.**

## What's Different?

This fork adds **GitHub Actions caching for `firebase-tools`**, which significantly speeds up deployment times by avoiding redundant npm installations on every workflow run.

### How it works

- On first run, `firebase-tools` is installed and cached using `@actions/cache`
- Subsequent runs restore from cache, skipping the npm install step entirely
- Cache key is based on the `firebase-tools` version, so updates are handled automatically

### Performance improvement

Typical time savings of **30-60 seconds** per deployment by eliminating the `firebase-tools` installation step.

### Pinned Node runtime

`firebase-tools` is invoked with a **pinned Node.js** (default `24.16.0`,
configurable via the [`nodeVersion`](#nodeversion-string) input) downloaded and
cached with `@actions/tool-cache`, instead of running the `firebase` binary
directly off `PATH`.

This sidesteps the Node.js `http.Agent` keep-alive regression
([nodejs/node#63989](https://github.com/nodejs/node/issues/63989)) shipped in
Node `>=22.23.0` / `>=24.17.0` / `>=26.3.1` (the 2026-06-18 security releases),
which throws `ERR_STREAM_PREMATURE_CLOSE` in `gaxios`/`google-auth-library` and
breaks the Workload Identity Federation token exchange firebase-tools uses to
authenticate (`Failed to authenticate, have you run firebase login?`). On
self-hosted runners the global `/usr/local/bin/firebase` shebang pins it to the
system Node, so simply calling `firebase` inherits the bad runtime regardless of
`setup-node`. Running the firebase-tools entrypoint with a pinned, known-good
Node fixes this without changing how the CLI is cached or reused. Bump
`nodeVersion` once Node ships a fix.

---

## Features

- Creates a new preview channel (and its associated preview URL) for every PR on your GitHub repository.
- Adds a comment to the PR with the preview URL so that you and each reviewer can view and test the PR's changes in a "preview" version of your app.
- Updates the preview URL with changes from each commit by automatically deploying to the associated preview channel. The URL doesn't change with each new commit.
- (Optional) Deploys the current state of your GitHub repo to your live channel when the PR is merged.

## Setup

A full setup guide can be found [in the Firebase Hosting docs](https://firebase.google.com/docs/hosting/github-integration).

The [Firebase CLI](https://firebase.google.com/docs/cli) can get you set up quickly with a default configuration.

- If you've NOT set up Hosting, run this version of the command from the root of your local directory:

```bash
firebase init hosting
```

- If you've ALREADY set up Hosting, then you just need to set up the GitHub Action part of Hosting.
  Run this version of the command from the root of your local directory:

```bash
firebase init hosting:github
```

## Usage

### Deploy to a new preview channel for every PR

Add a workflow (`.github/workflows/deploy-preview.yml`):

```yaml
name: Deploy to Preview Channel

on:
  pull_request:
    # Optionally configure to run only for specific files. For example:
    # paths:
    # - "website/**"

jobs:
  build_and_preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Add any build steps here. For example:
      # - run: npm ci && npm run build
      - uses: omniaura/firebase-action-hosting-deploy@v1
        with:
          repoToken: "${{ secrets.GITHUB_TOKEN }}"
          firebaseServiceAccount: "${{ secrets.FIREBASE_SERVICE_ACCOUNT }}"
          expires: 30d
          projectId: your-Firebase-project-ID
          # Optionally add Force flag
          # force: true
```

### Deploy to your live channel on merge

Add a workflow (`.github/workflows/deploy-prod.yml`):

```yaml
name: Deploy to Live Channel

on:
  push:
    branches:
      - main
    # Optionally configure to run only for specific files. For example:
    # paths:
    # - "website/**"

jobs:
  deploy_live_website:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Add any build steps here. For example:
      # - run: npm ci && npm run build
      - uses: omniaura/firebase-action-hosting-deploy@v1
        with:
          firebaseServiceAccount: "${{ secrets.FIREBASE_SERVICE_ACCOUNT }}"
          projectId: your-Firebase-project-ID
          channelId: live
          # Optionally add Force flag
          # force: true
```

## Options

### `firebaseServiceAccount` _{string}_ (required)

This is a service account JSON key. The easiest way to set it up is to run `firebase init hosting:github`. However, it can also be [created manually](./docs/service-account.md).

It's important to store this token as an
[encrypted secret](https://help.github.com/en/actions/configuring-and-managing-workflows/creating-and-storing-encrypted-secrets)
to prevent unintended access to your Firebase project. Set it in the "Secrets" area
of your repository settings and add it as `FIREBASE_SERVICE_ACCOUNT`:
`https://github.com/USERNAME/REPOSITORY/settings/secrets`.

### `repoToken` _{string}_

Adding `repoToken: "${{secrets.GITHUB_TOKEN}}"` lets the action comment on PRs
with the preview URL for the associated preview channel. You don't need to set
this secret yourself - GitHub sets it automatically.

If you omit this option, you'll need to find the preview URL in the action's
build log.

### `expires` _{string}_

The length of time the preview channel should remain active after the last deploy.
If left blank, the action uses the default expiry of 7 days.
The expiry date will reset to this value on every new deployment.

### `projectId` _{string}_

The Firebase project that contains the Hosting site to which you
want to deploy. If left blank, you need to check in a `.firebaserc`
file so that the Firebase CLI knows which Firebase project to use.

### `channelId` _{string}_

The ID of the channel to deploy to. If you leave this blank,
a preview channel and its ID will be auto-generated per branch or PR.
If you set it to **`live`**, the action deploys to the live channel of your default Hosting site.

_You usually want to leave this blank_ so that each PR gets its own preview channel.
An exception might be that you always want to deploy a certain branch to a
long-lived preview channel (for example, you may want to deploy every commit
from your `next` branch to a `preprod` preview channel).

### `target` _{string}_

The target name of the Hosting site to deploy to. If you leave this blank,
the default target or all targets defined in the `.firebaserc` will be deployed to.

You usually want to leave this blank unless you have set up multiple sites in the Firebase Hosting UI
and are trying to target just one of those sites with this action.

Refer to the Hosting docs about [multiple sites](https://firebase.google.com/docs/hosting/multisites)
for more information about deploy targets.

### `entryPoint` _{string}_

The directory containing your [`firebase.json`](https://firebase.google.com/docs/cli#the_firebasejson_file)
file relative to the root of your repository. Defaults to `.` (the root of your repo).

### `firebaseToolsVersion` _{string}_

The version of `firebase-tools` to use. If not specified, defaults to `latest`.

### `nodeVersion` _{string}_

The Node.js version used to run `firebase-tools`. Defaults to `24.16.0`. See
[Pinned Node runtime](#pinned-node-runtime) for why this exists; you generally
shouldn't need to change it.

### `disableComment` _{boolean}_

Disable commenting in a PR with the preview URL.

### `force` _{boolean}_

Uses the Firebase CLI's `--force` flag to automatically accept all interactive prompts.

## Outputs

Values emitted by this action that can be consumed by other actions later in your workflow

### `urls`

The url(s) deployed to

### `expire_time`

The time the deployed preview urls expire, example: 2024-04-10T14:37:53.817800922Z

### `expire_time_formatted`

The time the deployed preview urls expire in the UTC format, example: Tue, 09 Apr 2024 18:24:42 GMT

### `details_url`

A single URL that was deployed to

## Credits

This action is a fork of [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy), originally created by [Jason Miller](https://github.com/developit) and the Firebase team. Full credit to them for the excellent original implementation.

## License

Apache-2.0 (see [LICENSE](./LICENSE))
