// POST /api/generate-deck  (Option B — PPT Master template-fill)
// summary file(s) -> Claude emits a fill plan (real source slides + slot_ids)
// -> check-plan (capacity) -> apply -> native, on-brand Superba .pptx.
// One summary -> .pptx; several -> .zip. API key stays server-side.

import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import JSZip from "jszip";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FILL_PLAN_SCHEMA,
  SYSTEM_PROMPT,
  validerPlan,
  kompaktBibliotek,
  type FillPlan,
} from "@/app/lib/deck";

export const runtime = "nodejs";
export const maxDuration = 120;

const DECKGEN = path.join(process.cwd(), "backend", "deckgen");
const TEMPLATE = path.join(DECKGEN, "Superba_refresh_power_point_template.pptx");
const LIBRARY = path.join(DECKGEN, "Superba.slide_library.json");
const SCRIPT = path.join(
  process.cwd(),
  "vendor-ppt-master", "skills", "ppt-master", "scripts", "template_fill_pptx.py"
);
const PYTHON =
  process.env.PYTHON ||
  path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python312", "python.exe");

// Cache the compacted slide library (fixed asset) across requests.
let kompaktCache: string | null = null;
async function hentBibliotek(): Promise<string> {
  if (!kompaktCache) {
    const full = JSON.parse(await fs.readFile(LIBRARY, "utf-8"));
    kompaktCache = kompaktBibliotek(full);
  }
  return kompaktCache;
}

function kjor(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [SCRIPT, ...args], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(`Could not start Python: ${e.message}`)));
    p.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

async function lesFil(fil: File): Promise<string> {
  const buf = Buffer.from(await fil.arrayBuffer());
  if (fil.name.toLowerCase().endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  return buf.toString("utf-8");
}

async function lagFillPlan(
  anthropic: Anthropic,
  summary: string,
  bibliotek: string,
  tilbakemelding = ""
): Promise<FillPlan> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "emit_fill_plan",
        description: "Emit the template fill plan.",
        input_schema: FILL_PLAN_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_fill_plan" },
    messages: [
      {
        role: "user",
        content: `SCIENCE SUMMARY:\n${summary}\n\nSLIDE LIBRARY (choose source slides and only these slot_ids per slide):\n${bibliotek}${tilbakemelding}`,
      },
    ],
  });
  const bruk = msg.content.find((b) => b.type === "tool_use");
  const plan = bruk && "input" in bruk ? bruk.input : null;
  if (!validerPlan(plan)) throw new Error("Claude returned an invalid fill plan.");
  return plan;
}

// Generate a plan, then check-plan; retry once if the capacity check errors.
async function planlegg(
  anthropic: Anthropic,
  summary: string,
  bibliotek: string,
  tmpDir: string,
  idx: number
): Promise<string> {
  let feedback = "";
  for (let forsok = 0; forsok < 2; forsok++) {
    const plan = await lagFillPlan(anthropic, summary, bibliotek, feedback);
    const planPath = path.join(tmpDir, `plan-${idx}-${forsok}.json`);
    await fs.writeFile(
      planPath,
      JSON.stringify({
        schema: "template_fill_pptx_plan.v1",
        status: "confirmed",
        source_pptx: TEMPLATE,
        accepted_warnings: [],
        slides: plan.slides,
      }),
      "utf-8"
    );

    const chk = await kjor(["check-plan", LIBRARY, planPath]);
    const errCount = Number(/error=(\d+)/.exec(chk.out)?.[1] ?? "0");
    if (errCount === 0) return planPath;

    feedback = `\n\n(Previous plan had ${errCount} capacity/slot error(s): ${chk.out.trim().slice(0, 400)}. Fix by shortening text or using valid slot_ids for the chosen source_slide.)`;
  }
  throw new Error("Could not produce a fitting plan after retry (capacity/slot errors).");
}

export async function POST(req: Request) {
  let tmpDir: string | null = null;
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ feil: "Missing ANTHROPIC_API_KEY on the server." }, { status: 500 });
    }
    const form = await req.formData();
    const filer = form.getAll("filer").filter((f): f is File => f instanceof File);
    if (filer.length === 0) {
      return Response.json({ feil: "No files uploaded." }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const bibliotek = await hentBibliotek();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deckgen-"));

    const decks: { navn: string; buffer: Buffer }[] = [];
    for (let i = 0; i < filer.length; i++) {
      const tekst = (await lesFil(filer[i])).trim();
      if (!tekst) throw new Error(`No text found in ${filer[i].name}.`);

      const planPath = await planlegg(anthropic, tekst, bibliotek, tmpDir, i);

      const outStem = path.join(tmpDir, `deck-${i}.pptx`);
      const res = await kjor(["apply", TEMPLATE, planPath, "-o", outStem]);
      if (res.code !== 0) {
        throw new Error(`Renderer failed: ${(res.err || res.out).slice(0, 400)}`);
      }
      // apply appends a _YYYYMMDD_HHMMSS timestamp to the stem — find it.
      const laget = (await fs.readdir(tmpDir)).find(
        (f) => f.startsWith(`deck-${i}`) && f.endsWith(".pptx")
      );
      if (!laget) throw new Error("Renderer produced no output file.");

      const base = filer[i].name.replace(/\.[^.]+$/, "") || `deck-${i + 1}`;
      decks.push({ navn: `${base}.pptx`, buffer: await fs.readFile(path.join(tmpDir, laget)) });
    }

    if (decks.length === 1) {
      return new Response(new Uint8Array(decks[0].buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${decks[0].navn}"`,
        },
      });
    }
    const zip = new JSZip();
    decks.forEach((d) => zip.file(d.navn, d.buffer));
    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
    return new Response(new Uint8Array(zipBuf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="superba-decks.zip"`,
      },
    });
  } catch (e) {
    console.error(e);
    return Response.json({ feil: "Generation failed: " + (e as Error).message }, { status: 500 });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
