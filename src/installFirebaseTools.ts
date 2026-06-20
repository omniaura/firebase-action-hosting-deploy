/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as core from "@actions/core";
import * as cache from "@actions/cache";
import { exec } from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const TOOL_NAME = "firebase-tools";

function isSelfHostedRunner(): boolean {
  return process.env.RUNNER_ENVIRONMENT === "self-hosted";
}

async function getPreinstalledFirebaseVersion(): Promise<string | undefined> {
  let output = "";

  try {
    await exec("firebase", ["--version"], {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
      silent: true,
    });
  } catch {
    return undefined;
  }

  const version = output.trim();
  return version.length > 0 ? version : undefined;
}

/**
 * Resolves the firebase-tools JS entrypoint (e.g. `lib/bin/firebase.js`) from a
 * package directory by reading its `package.json` `bin` field. This entrypoint
 * is run directly with the action's own Node runtime (see deploy.ts), so it must
 * be the underlying script rather than the `firebase` binary on PATH — whose
 * shebang can pin it to a system Node carrying the keep-alive regression.
 *
 * Returns undefined if the entrypoint can't be located.
 */
function resolveEntrypoint(packageDir: string): string | undefined {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageDir, "package.json"), "utf8")
    );
    const bin = pkg.bin;
    const relative = typeof bin === "string" ? bin : bin?.firebase;
    if (!relative) {
      return undefined;
    }
    const entrypoint = path.join(packageDir, relative);
    return fs.existsSync(entrypoint) ? entrypoint : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Locates the entrypoint of a globally-installed (preinstalled) firebase-tools
 * by asking npm for the global node_modules root.
 */
async function resolvePreinstalledEntrypoint(): Promise<string | undefined> {
  let output = "";

  try {
    await exec("npm", ["root", "-g"], {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
      silent: true,
    });
  } catch {
    return undefined;
  }

  const globalRoot = output.trim();
  if (!globalRoot) {
    return undefined;
  }

  return resolveEntrypoint(path.join(globalRoot, TOOL_NAME));
}

/**
 * Resolves 'latest' version to actual version number from npm registry
 */
async function resolveVersion(version: string): Promise<string> {
  if (version !== "latest") {
    return version;
  }

  let output = "";
  await exec("npm", ["view", "firebase-tools", "version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
    silent: true,
  });

  return output.trim();
}

/**
 * Gets the cache key for the firebase-tools installation
 */
function getCacheKey(version: string): string {
  const platform = os.platform();
  const arch = os.arch();
  return `${TOOL_NAME}-${version}-${platform}-${arch}`;
}

/**
 * Gets the installation directory path
 */
function getInstallDir(version: string): string {
  const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
  return path.join(runnerTemp, `${TOOL_NAME}-${version}`);
}

/**
 * Installs firebase-tools to a directory
 */
async function installFirebaseTools(
  version: string,
  installDir: string
): Promise<void> {
  // Create the install directory
  fs.mkdirSync(installDir, { recursive: true });

  // Install firebase-tools to the specified directory
  await exec("npm", ["install", `firebase-tools@${version}`], {
    cwd: installDir,
    silent: false,
  });
}

/**
 * Gets or installs firebase-tools with caching.
 *
 * Returns the path to the firebase-tools JS entrypoint (e.g.
 * `.../firebase-tools/lib/bin/firebase.js`), which the deploy step runs with a
 * pinned Node interpreter. If a preinstalled entrypoint can't be resolved it
 * falls back to a managed install; if that entrypoint can't be resolved either
 * it throws, rather than silently letting the deploy step fall back to the
 * regressed `firebase` binary on PATH (which would defeat the mitigation).
 */
export async function getFirebaseTools(
  version: string = "latest"
): Promise<string> {
  const preinstalledVersion = await getPreinstalledFirebaseVersion();
  if (preinstalledVersion) {
    core.info(
      `Found preinstalled firebase-tools@${preinstalledVersion} on PATH`
    );
    if (
      isSelfHostedRunner() &&
      (version === "latest" || version === preinstalledVersion)
    ) {
      core.info(
        `Using preinstalled firebase-tools@${preinstalledVersion} on self-hosted runner; skipping cache and installation`
      );
      const entrypoint = await resolvePreinstalledEntrypoint();
      if (entrypoint) {
        core.info(`Resolved firebase-tools entrypoint: ${entrypoint}`);
        return entrypoint;
      }
      core.warning(
        "Could not resolve the preinstalled firebase-tools entrypoint; falling back to a managed firebase-tools install"
      );
    }

    if (
      isSelfHostedRunner() &&
      version !== "latest" &&
      version !== preinstalledVersion
    ) {
      core.info(
        `Requested firebase-tools version ${version} differs from preinstalled ${preinstalledVersion}; falling back to managed install`
      );
    }
  }

  // Resolve 'latest' to actual version for caching
  const resolvedVersion = await resolveVersion(version);
  core.info(`Firebase tools version: ${resolvedVersion}`);

  const cacheKey = getCacheKey(resolvedVersion);
  const installDir = getInstallDir(resolvedVersion);
  const binPath = path.join(installDir, "node_modules", ".bin");

  // Try to restore from GitHub's cache
  let cacheHit = false;
  try {
    const restoredKey = await cache.restoreCache([installDir], cacheKey);
    if (restoredKey) {
      cacheHit = true;
      core.info(`Restored firebase-tools@${resolvedVersion} from cache`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to restore cache: ${message}`);
  }

  if (!cacheHit) {
    core.info(`Installing firebase-tools@${resolvedVersion}...`);

    // Install firebase-tools
    await installFirebaseTools(resolvedVersion, installDir);

    // Save to GitHub's cache
    try {
      await cache.saveCache([installDir], cacheKey);
      core.info(`Saved firebase-tools@${resolvedVersion} to cache`);
    } catch (error: unknown) {
      // Cache save can fail if the key already exists (race condition)
      // or if there are other issues - don't fail the action for this
      const message = error instanceof Error ? error.message : String(error);
      core.warning(`Failed to save cache: ${message}`);
    }
  }

  // Add to PATH for any tooling that still expects the firebase binary there.
  core.addPath(binPath);
  core.info(`Added ${binPath} to PATH`);

  const entrypoint = resolveEntrypoint(
    path.join(installDir, "node_modules", TOOL_NAME)
  );
  if (!entrypoint) {
    throw new Error(
      "Could not resolve the installed firebase-tools entrypoint from its package.json"
    );
  }

  core.info(`Resolved firebase-tools entrypoint: ${entrypoint}`);
  return entrypoint;
}
