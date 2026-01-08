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
 * Returns the path to the firebase binary directory.
 */
export async function getFirebaseTools(
  version: string = "latest"
): Promise<string> {
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

  // Add to PATH
  core.addPath(binPath);
  core.info(`Added ${binPath} to PATH`);

  return binPath;
}
