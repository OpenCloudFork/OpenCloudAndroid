const MAX_LINES = 500;
const buffer: string[] = [];
let verboseEnabled = false;

export function setDebugLogging(on: boolean): void {
  verboseEnabled = on;
}

export function isDebugLogging(): boolean {
  return verboseEnabled;
}

export function debugLog(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `${ts} ${tag} ${message}`;
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  if (verboseEnabled) console.log(`${tag} ${message}`);
}

export function debugWarn(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `${ts} ${tag} ✗ ${message}`;
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  console.warn(`${tag} ${message}`);
}

export function debugError(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `${ts} ${tag} ✗✗ ${message}`;
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  console.error(`${tag} ${message}`);
}

export function getDebugLines(count = 200): string[] {
  return buffer.slice(-count);
}

export function getDebugText(count = 200): string {
  return buffer.slice(-count).join("\n");
}
