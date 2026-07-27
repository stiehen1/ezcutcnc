#!/usr/bin/env node
/**
 * One-off: replace every Core_Cutter_*.step object in the R2 `cdn` bucket with
 * the inch-unit re-exports. Same object keys, so no app or DB change is needed
 * (client/src/pages/ToolFinder.tsx builds the URL from the EDP at runtime).
 *
 * Only ever issues ListObjectsV2 (GET) and PutObject (PUT). There is no delete
 * path in this file -- the .dwg/.dxf/.bak objects sharing the bucket cannot be
 * touched, even by mistake.
 *
 * Credentials come from the environment, never from disk:
 *   $env:R2_KEY / $env:R2_SECRET
 *
 * Usage:
 *   node scripts/r2-step-upload.mjs list      # what .step keys exist in R2
 *   node scripts/r2-step-upload.mjs plan      # coverage diff, writes nothing
 *   node scripts/r2-step-upload.mjs upload    # do it
 *   node scripts/r2-step-upload.mjs verify    # sample live objects for INCH
 */

import { createHash, createHmac } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const ACCOUNT_ID = process.env.R2_ACCOUNT?.trim();
const BUCKET = "cdn";
const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const REGION = "auto";
const SERVICE = "s3";
const CONTENT_TYPE = "application/octet-stream"; // matches existing objects
// Do NOT point this at "- IN": that FreeCAD export is a header-only relabel.
// It declares CONVERSION_BASED_UNIT('INCH') while leaving coordinates in
// millimetres, so every CAD package scales the model 25.4x (a 1/2" tool
// measures 12.70"). "- INCH_TRUE" is generated from the mm masters by
// scripts/step_mm_to_inch.py, which converts through the OpenCASCADE kernel
// and asserts inch magnitudes on every file it writes.
const SRC_DIR =
  "C:/Users/scott/OneDrive/Desktop/STEP-Normalized_Master/STEP_Normalized Files (Z axis) - INCH_TRUE";
const CONCURRENCY = 24;

const KEY = process.env.R2_KEY;
const SECRET = process.env.R2_SECRET;
if (!KEY || !SECRET || !ACCOUNT_ID) {
  console.error(
    "Missing env vars in this shell. PowerShell:\n" +
      '  $env:R2_ACCOUNT = "..."   (32-hex account id, from R2 -> Settings -> S3 API)\n' +
      '  $env:R2_KEY     = "..."\n' +
      '  $env:R2_SECRET  = "..."\n' +
      `\ngot: R2_ACCOUNT=${ACCOUNT_ID ? "set" : "MISSING"} ` +
      `R2_KEY=${KEY ? "set" : "MISSING"} R2_SECRET=${SECRET ? "set" : "MISSING"}`,
  );
  process.exit(1);
}
// A wrong-length id still resolves via wildcard DNS but dies in the TLS
// handshake, surfacing only as an unhelpful "fetch failed" -- catch it here.
if (!/^[0-9a-f]{32}$/i.test(ACCOUNT_ID)) {
  console.error(
    `R2_ACCOUNT looks wrong: "${ACCOUNT_ID}" is ${ACCOUNT_ID.length} chars.\n` +
      "Expected exactly 32 hex characters.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------- SigV4

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

/** Encode a path segment per AWS's stricter rules (space -> %20, not '+'). */
function uriEncode(str, encodeSlash = true) {
  let out = "";
  for (const ch of Buffer.from(str, "utf8")) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else if (c === "/") out += encodeSlash ? "%2F" : "/";
    else out += "%" + ch.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function sign({ method, key = "", query = {}, payload = Buffer.alloc(0) }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // Object keys hold literal spaces; each segment is encoded, slashes kept.
  const canonicalUri =
    "/" +
    [BUCKET, ...(key ? key.split("/") : [])]
      .map((s) => uriEncode(s, false))
      .join("/");

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(String(query[k]))}`)
    .join("&");

  const payloadHash = sha256hex(payload);
  const headers = {
    host: HOST,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (method === "PUT") headers["content-type"] = CONTENT_TYPE;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders =
    Object.keys(headers)
      .sort()
      .map((h) => `${h}:${String(headers[h]).trim()}\n`)
      .join("");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  let k = hmac(`AWS4${SECRET}`, dateStamp);
  k = hmac(k, REGION);
  k = hmac(k, SERVICE);
  k = hmac(k, "aws4_request");
  const signature = createHmac("sha256", k).update(stringToSign).digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${HOST}${canonicalUri}${canonicalQuery ? "?" + canonicalQuery : ""}`;
  return { url, headers };
}

async function s3(method, key, { query, payload } = {}) {
  const { url, headers } = sign({ method, key, query, payload });
  const res = await fetch(url, {
    method,
    headers,
    body: method === "PUT" ? payload : undefined,
  });
  const text = method === "PUT" ? "" : await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${key || "(list)"} -> ${res.status} ${res.statusText}\n${text.slice(0, 400)}`,
    );
  }
  return text;
}

// ---------------------------------------------------------------- operations

async function listStepKeys() {
  const keys = [];
  let token;
  do {
    const query = { "list-type": "2", "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const xml = await s3("GET", "", { query });
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      const k = m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      if (k.toLowerCase().endsWith(".step")) keys.push(k);
    }
    const t = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated && t ? t[1] : undefined;
  } while (token);
  return keys;
}

async function localFiles() {
  const names = (await readdir(SRC_DIR)).filter((n) =>
    n.toLowerCase().endsWith(".step"),
  );
  names.sort();
  return names;
}

async function plan() {
  const [live, local] = await Promise.all([listStepKeys(), localFiles()]);
  const liveSet = new Set(live);
  const localSet = new Set(local);

  const overwrite = local.filter((n) => liveSet.has(n));
  const brandNew = local.filter((n) => !liveSet.has(n));
  const orphaned = live.filter((k) => !localSet.has(k));

  console.log(`local .step files      : ${local.length}`);
  console.log(`live  .step objects    : ${live.length}`);
  console.log(`  -> overwrite in place: ${overwrite.length}`);
  console.log(`  -> new keys created  : ${brandNew.length}`);
  console.log(`  -> live w/o local src: ${orphaned.length}  (left untouched, stay mm)`);

  if (brandNew.length) {
    console.log(`\nNEW KEYS (first 20):`);
    brandNew.slice(0, 20).forEach((n) => console.log("  + " + n));
  }
  if (orphaned.length) {
    console.log(`\nNOT COVERED by your export -- these remain millimeter (first 40):`);
    orphaned.slice(0, 40).forEach((k) => console.log("  ! " + k));
    if (orphaned.length > 40) console.log(`  ... and ${orphaned.length - 40} more`);
  }
  return { local, overwrite, brandNew, orphaned };
}

async function upload() {
  const local = await localFiles();

  // Pre-flight every file BEFORE writing anything. A mislabelled catalogue
  // once went live because units were only checked after the upload; refusing
  // to start is cheaper than a second 3,595-object restore.
  process.stdout.write(`Checking units on ${local.length} files ... `);
  const rejects = [];
  for (const name of local) {
    const c = classify(await readFile(join(SRC_DIR, name), "utf8"));
    if (!c.ok) rejects.push([name, c.note]);
  }
  if (rejects.length) {
    console.log(`\n\nABORTED -- ${rejects.length} file(s) have bad units:`);
    rejects.slice(0, 15).forEach(([n, m]) => console.log(`  x ${n}: ${m}`));
    console.log("\nNothing was uploaded. R2 is unchanged.");
    process.exitCode = 1;
    return;
  }
  console.log("all clean");

  console.log(`Uploading ${local.length} .step objects to r2://${BUCKET}/ ...`);

  let done = 0,
    failed = [];
  const queue = [...local];

  async function worker() {
    for (;;) {
      const name = queue.pop();
      if (!name) return;
      try {
        const body = await readFile(join(SRC_DIR, name));
        await s3("PUT", name, { payload: body });
      } catch (e) {
        // one retry -- transient 5xx/socket resets are common at this volume
        try {
          const body = await readFile(join(SRC_DIR, name));
          await s3("PUT", name, { payload: body });
        } catch (e2) {
          failed.push([name, e2.message]);
        }
      }
      if (++done % 100 === 0 || done === local.length) {
        process.stdout.write(`\r  ${done}/${local.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");

  console.log(`uploaded: ${local.length - failed.length}   failed: ${failed.length}`);
  if (failed.length) {
    console.log("\nFAILURES:");
    failed.slice(0, 25).forEach(([n, m]) => console.log(`  x ${n}: ${m}`));
    process.exitCode = 1;
  }
}

/**
 * Largest absolute coordinate in the model, in whatever unit the file declares.
 * This is the only honest unit test: a solid carbide endmill is at most ~8"
 * / ~200 mm long, so the magnitude alone says which unit the NUMBERS are in --
 * regardless of what the header claims they are.
 */
function maxAbsCoord(body) {
  let max = 0;
  for (const m of body.matchAll(/CARTESIAN_POINT\('',\(([^)]*)\)\)/g)) {
    const parts = m[1].split(",");
    // 3-tuples only. A 2-tuple is a pcurve point in a surface's PARAMETER
    // space -- first value an angle in radians, second a length parameter.
    // Those are not model coordinates and a unit conversion correctly leaves
    // them alone, so counting them flags good inch files as still-metric.
    if (parts.length !== 3) continue;
    for (const part of parts) {
      const v = Math.abs(parseFloat(part));
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max;
}

/**
 * Classify a STEP body by comparing its DECLARED unit against the MAGNITUDE of
 * its geometry. Checking the header alone is what let a 25.4x-oversized catalog
 * ship: the "- IN" export relabelled the unit without scaling the coordinates,
 * so every INCH-header grep passed while every tool measured 25.4x too big.
 */
function classify(body) {
  const declaresInch = /CONVERSION_BASED_UNIT\('INCH'/.test(body);
  const max = maxAbsCoord(body);
  // Endmill envelope: <= ~8 in, <= ~205 mm. A file whose numbers exceed the
  // inch envelope is carrying mm coordinates no matter what it declares.
  const numbersLookInch = max > 0 && max <= 12;
  if (!declaresInch) return { ok: true, unit: "mm", max, note: "mm (declared, consistent)" };
  if (numbersLookInch) return { ok: true, unit: "inch", max, note: "inch (declared, consistent)" };
  return {
    ok: false,
    unit: "BROKEN",
    max,
    note: `declares INCH but max coord ${max.toFixed(2)} is a mm magnitude -> renders ${(25.4).toFixed(0)}x oversize`,
  };
}

/** Read live objects back through the CDN and check units against geometry. */
async function verify(sampleSize = 40) {
  const local = await localFiles();
  const step = Math.max(1, Math.floor(local.length / sampleSize));
  const sample = local.filter((_, i) => i % step === 0).slice(0, sampleSize);

  let inch = 0,
    mm = 0,
    broken = 0,
    bad = 0;
  for (const name of sample) {
    const url = `https://cdn.ezcutcnc.app/${encodeURIComponent(name)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.log(`  ? ${name} -> HTTP ${res.status}`);
        bad++;
        continue;
      }
      // Scan the WHOLE body: the unit entity sits at a byte offset that varies
      // per file, so truncating the read misreads big files.
      const c = classify(await res.text());
      if (!c.ok) {
        broken++;
        console.log(`  x ${name}: ${c.note}`);
      } else if (c.unit === "inch") inch++;
      else mm++;
    } catch (e) {
      bad++;
      console.log(`  ? ${name} -> ${e.message}`);
    }
  }
  console.log(
    `\nsampled ${sample.length}:  inch ${inch} | mm ${mm} | BROKEN ${broken} | unreadable ${bad}`,
  );
  if (broken) {
    console.log(
      "\nBROKEN = header says INCH, coordinates are mm. Renders 25.4x oversize.",
    );
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- main

const cmd = process.argv[2] ?? "plan";
try {
  if (cmd === "list") {
    const k = await listStepKeys();
    console.log(`${k.length} .step objects in r2://${BUCKET}`);
    k.slice(0, 15).forEach((x) => console.log("  " + x));
  } else if (cmd === "plan") await plan();
  else if (cmd === "upload") await upload();
  else if (cmd === "verify") await verify();
  else {
    console.error(`unknown command: ${cmd}  (list | plan | upload | verify)`);
    process.exit(1);
  }
} catch (e) {
  console.error("\nFAILED: " + e.message);
  process.exit(1);
}
