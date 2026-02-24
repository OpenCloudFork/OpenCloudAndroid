const MAX_LINES = 500;
const buffer: string[] = new Array(MAX_LINES);
let head = 0;
let count = 0;
let verboseEnabled = false;

function pushLine(line: string): void {
  buffer[(head + count) % MAX_LINES] = line;
  if (count < MAX_LINES) {
    count++;
  } else {
    head = (head + 1) % MAX_LINES;
  }
}

function getLines(n: number): string[] {
  const want = Math.min(n, count);
  const start = (head + count - want) % MAX_LINES;
  const result: string[] = [];
  for (let i = 0; i < want; i++) {
    result.push(buffer[(start + i) % MAX_LINES]!);
  }
  return result;
}

export function setDebugLogging(on: boolean): void {
  verboseEnabled = on;
}

export function isDebugLogging(): boolean {
  return verboseEnabled;
}

export function debugLog(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  pushLine(`${ts} ${tag} ${message}`);
  if (verboseEnabled) console.log(`${tag} ${message}`);
}

export function debugWarn(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  pushLine(`${ts} ${tag} ✗ ${message}`);
  console.warn(`${tag} ${message}`);
}

export function debugError(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  pushLine(`${ts} ${tag} ✗✗ ${message}`);
  console.error(`${tag} ${message}`);
}

export function getDebugLines(n = 200): string[] {
  return getLines(n);
}

export function getDebugText(n = 200): string {
  return getLines(n).join("\n");
}
