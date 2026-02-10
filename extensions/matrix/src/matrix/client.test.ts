import { describe, expect, it } from "vitest";
import type { CoreConfig } from "../types.js";
import { resolveMatrixConfig } from "./client.js";

describe("resolveMatrixConfig", () => {
  it("resolves config values", () => {
    const cfg = {
      channels: {
        matrix: {
          homeserver: "https://cfg.example.org",
          userId: "@cfg:example.org",
          accessToken: "cfg-token",
          password: "cfg-pass",
          deviceName: "CfgDevice",
          initialSyncLimit: 5,
        },
      },
    } as CoreConfig;
    const resolved = resolveMatrixConfig(cfg);
    expect(resolved).toEqual({
      homeserver: "https://cfg.example.org",
      userId: "@cfg:example.org",
      accessToken: "cfg-token",
      password: "cfg-pass",
      deviceName: "CfgDevice",
      initialSyncLimit: 5,
      encryption: false,
    });
  });

  it("returns empty strings when config is missing", () => {
    const cfg = {} as CoreConfig;
    const resolved = resolveMatrixConfig(cfg);
    expect(resolved.homeserver).toBe("");
    expect(resolved.userId).toBe("");
    expect(resolved.accessToken).toBeUndefined();
    expect(resolved.password).toBeUndefined();
    expect(resolved.deviceName).toBeUndefined();
    expect(resolved.initialSyncLimit).toBeUndefined();
    expect(resolved.encryption).toBe(false);
  });

  it("accepts flat MatrixAccountConfig", () => {
    const accountCfg = {
      homeserver: "https://account.example.org",
      userId: "@bot:account.org",
      accessToken: "tok-account",
    };
    const resolved = resolveMatrixConfig(accountCfg);
    expect(resolved.homeserver).toBe("https://account.example.org");
    expect(resolved.userId).toBe("@bot:account.org");
    expect(resolved.accessToken).toBe("tok-account");
  });
});
