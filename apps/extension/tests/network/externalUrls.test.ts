import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const SOURCE_ROOT = new URL("../../src/", import.meta.url);

// These are syntax/serialization sentinels, never network destinations.
const NON_ENDPOINT_LITERALS = new Set([
  "http://www.w3.org/2000/svg",
  "https://extension.invalid/",
  "https://extension.invalid",
]);

function hardcodedDestinations(text: string, fileName: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const value = ts.isTemplateExpression(node) ? node.getText(source) : node.text;
      // A placeholder describes user input; it is not an outbound destination.
      const isPlaceholder = ts.isJsxAttribute(node.parent) && node.parent.name.getText(source) === "placeholder";
      const fixedHost = /\b(?:https?|wss?):\/\/[a-z0-9][a-z0-9.-]*(?=[:/?#]|$)/i.test(value);
      const fixedGatewaySuffix = ts.isTemplateExpression(node) && /^(?:https?|wss?):\/\//i.test(node.head.text) && /\}\.[a-z][a-z0-9.-]*/i.test(value);
      // The probe's hostname is supplied by the user's local Kubo settings.
      const isLocalProbe = fileName.endsWith("chrome/ensBrowsing/kubo.ts") &&
        value === '`http://bafkqaaa.ipfs.${gatewayHost}:${gatewayPort}/`';
      if ((fixedHost || fixedGatewaySuffix) && !isPlaceholder && !isLocalProbe && !NON_ENDPOINT_LITERALS.has(value)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${fileName}:${line + 1}: ${value}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

async function audit(directory = SOURCE_ROOT, prefix = ""): Promise<string[]> {
  const violations: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    // Preview fixtures never ship in the extension. Comments are ignored by AST traversal.
    if (path === "preview" || path === "constants/externalUrls.ts") continue;
    if (entry.isDirectory()) {
      violations.push(...await audit(new URL(`${entry.name}/`, directory), `${path}/`));
    } else if (/\.tsx?$/.test(path)) {
      violations.push(...hardcodedDestinations(await readFile(new URL(entry.name, directory), "utf8"), path));
    }
  }
  return violations;
}

test("shipped extension endpoints and links are declared only in externalUrls.ts", async () => {
  assert.deepEqual(await audit(), []);
});

test("URL guard catches fixed hosts, embedded links, and dynamic gateway suffixes", () => {
  for (const source of [
    'const endpoint = "https://api.example.net/v1";',
    'const endpoint = `https://api.example.net/${id}`;',
    'const endpoint = `https://${name}.example.net/path`;',
    'const help = "Open https://example.net/help to continue";',
    'const socket = "wss://relay.example.net";',
  ]) assert.equal(hardcodedDestinations(source, "fixture.ts").length, 1);
  assert.deepEqual(hardcodedDestinations('// https://docs.example.net\nconst url = `https://${userHost}/${path}`;', "fixture.ts"), []);
});
