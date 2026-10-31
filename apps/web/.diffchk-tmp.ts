import { readFileSync } from "node:fs";
const diff = readFileSync("/tmp/raw.diff", "utf8").replace(
  /^index [0-9a-f]+\.\.[0-9a-f]+.*$/gm,
  "",
);
const byFile = new Map<string, string[]>();
let file = "";
let ln = 0;
for (const l of diff.split("\n")) {
  if (l.startsWith("+++ ")) {
    file = l.slice(6).replace("b/tmp/diffchk/b/", "").replace(/^b\//, "");
    continue;
  }
  if (l.startsWith("@@")) {
    const m = l.match(/\+(\d+)/);
    ln = m ? Number(m[1]) : 0;
    continue;
  }
  if (l.startsWith("+") && !l.startsWith("+++")) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(String(ln));
    ln++;
  } else if (!l.startsWith("-") && !l.startsWith("\\")) ln++;
}
for (const f of [
  "apps/web/__tests__/integration/mailbox-change-push.test.ts",
  "apps/web/app/api/mail/v1/accounts/[accountId]/splits/route.test.ts",
])
  console.log(f, byFile.get(f)?.slice(0, 30));
