import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 邮件客户端 UI 是单独构建的，在大多数部署中不存在。
const bundleDirectory = path.join(process.cwd(), "generated/mcp-app");
const manifestPath = path.join(bundleDirectory, "manifest.json");

let resourceUri: string | null | undefined;
let html: Promise<string> | undefined;

export function getMailClientResourceUri() {
  if (resourceUri === undefined) {
    resourceUri = existsSync(manifestPath)
      ? (
          JSON.parse(readFileSync(manifestPath, "utf8")) as {
            resourceUri: string;
          }
        ).resourceUri
      : null;
  }
  return resourceUri;
}

export function readMailClientHtml() {
  html ??= readFile(path.join(bundleDirectory, "mail.html"), "utf8").catch(
    (error) => {
      html = undefined;
      throw error;
    },
  );
  return html;
}
