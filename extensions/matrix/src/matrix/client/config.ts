import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import type { CoreConfig, MatrixAccountConfig } from "../../types.js";
import type { MatrixAuth, MatrixResolvedConfig } from "./types.js";
import { getMatrixRuntime } from "../../runtime.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";

function clean(value?: string): string {
  return value?.trim() ?? "";
}

/**
 * Resolve Matrix connection config from a merged account config object.
 *
 * All values must come from the config file — environment variables are
 * intentionally not used so that every account is fully config-driven.
 */
export function resolveMatrixConfig(
  configOrCfg: MatrixAccountConfig | CoreConfig,
): MatrixResolvedConfig {
  // Support both a flat MatrixAccountConfig and the legacy CoreConfig shape.
  const matrix: MatrixAccountConfig & Record<string, unknown> =
    "channels" in configOrCfg ? ((configOrCfg as CoreConfig).channels?.matrix ?? {}) : configOrCfg;

  const homeserver = clean(matrix.homeserver);
  const userId = clean(matrix.userId);
  const accessToken = clean(matrix.accessToken) || undefined;
  const password = clean(matrix.password) || undefined;
  const deviceName = clean(matrix.deviceName) || undefined;
  const initialSyncLimit =
    typeof matrix.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(matrix.initialSyncLimit))
      : undefined;
  const encryption = matrix.encryption ?? false;
  return {
    homeserver,
    userId,
    accessToken,
    password,
    deviceName,
    initialSyncLimit,
    encryption,
  };
}

export async function resolveMatrixAuth(params?: {
  cfg?: CoreConfig;
  /** Merged per-account config. When provided, `cfg` is ignored. */
  accountConfig?: MatrixAccountConfig;
  /** Account ID for per-account credential isolation. */
  accountId?: string | null;
}): Promise<MatrixAuth> {
  const accountId = params?.accountId;
  let resolved: MatrixResolvedConfig;

  if (params?.accountConfig) {
    resolved = resolveMatrixConfig(params.accountConfig);
  } else {
    const cfg = params?.cfg ?? (getMatrixRuntime().config.loadConfig() as CoreConfig);
    resolved = resolveMatrixConfig(cfg);
  }

  if (!resolved.homeserver) {
    throw new Error("Matrix homeserver is required (channels.matrix.homeserver in config)");
  }

  const {
    loadMatrixCredentials,
    saveMatrixCredentials,
    credentialsMatchConfig,
    touchMatrixCredentials,
  } = await import("../credentials.js");

  const cached = loadMatrixCredentials(accountId);
  const cachedCredentials =
    cached &&
    credentialsMatchConfig(cached, {
      homeserver: resolved.homeserver,
      userId: resolved.userId || "",
    })
      ? cached
      : null;

  // If we have an access token, we can fetch userId via whoami if not provided
  if (resolved.accessToken) {
    let userId = resolved.userId;
    if (!userId) {
      // Fetch userId from access token via whoami
      ensureMatrixSdkLoggingConfigured();
      const tempClient = new MatrixClient(resolved.homeserver, resolved.accessToken);
      const whoami = await tempClient.getUserId();
      userId = whoami;
      // Save the credentials with the fetched userId
      saveMatrixCredentials(
        {
          homeserver: resolved.homeserver,
          userId,
          accessToken: resolved.accessToken,
        },
        accountId,
      );
    } else if (cachedCredentials && cachedCredentials.accessToken === resolved.accessToken) {
      touchMatrixCredentials(accountId);
    }
    return {
      homeserver: resolved.homeserver,
      userId,
      accessToken: resolved.accessToken,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (cachedCredentials) {
    touchMatrixCredentials(accountId);
    return {
      homeserver: cachedCredentials.homeserver,
      userId: cachedCredentials.userId,
      accessToken: cachedCredentials.accessToken,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (!resolved.userId) {
    throw new Error(
      "Matrix userId is required when no access token is configured (channels.matrix.userId in config)",
    );
  }

  if (!resolved.password) {
    throw new Error(
      "Matrix password is required when no access token is configured (channels.matrix.password in config)",
    );
  }

  // Login with password using HTTP API
  const loginResponse = await fetch(`${resolved.homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: resolved.userId },
      password: resolved.password,
      initial_device_display_name: resolved.deviceName ?? "OpenClaw Gateway",
    }),
  });

  if (!loginResponse.ok) {
    const errorText = await loginResponse.text();
    throw new Error(`Matrix login failed: ${errorText}`);
  }

  const login = (await loginResponse.json()) as {
    access_token?: string;
    user_id?: string;
    device_id?: string;
  };

  const accessToken = login.access_token?.trim();
  if (!accessToken) {
    throw new Error("Matrix login did not return an access token");
  }

  const auth: MatrixAuth = {
    homeserver: resolved.homeserver,
    userId: login.user_id ?? resolved.userId,
    accessToken,
    deviceName: resolved.deviceName,
    initialSyncLimit: resolved.initialSyncLimit,
    encryption: resolved.encryption,
  };

  saveMatrixCredentials(
    {
      homeserver: auth.homeserver,
      userId: auth.userId,
      accessToken: auth.accessToken,
      deviceId: login.device_id,
    },
    accountId,
  );

  return auth;
}
