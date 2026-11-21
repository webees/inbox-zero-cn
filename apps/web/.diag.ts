import ts from "typescript";
const codes = new Set([
  2304, 2339, 2551, 2561, 7053, 2724, 2305, 2554, 2555, 2345, 2322, 2739,
]);
for (const file of process.argv.slice(2)) {
  const program = ts.createProgram([file], {
    noEmit: true,
    strict: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    skipLibCheck: true,
    strictNullChecks: true,
    paths: { "@/*": ["./*"] },
    paths: { "@/*": ["apps/web/*"] },
    baseUrl: process.cwd(),
    allowJs: true,
    types: ["node"],
    noImplicitAny: true,
  });
  const diags = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => codes.has(d.code));
  for (const d of diags.slice(0, 200)) {
    if (!d.file) continue;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start!);
    console.log(
      `${d.file.fileName}:${line + 1}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 200)}`,
    );
  }
}
