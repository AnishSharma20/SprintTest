// POST /api/generate-deck
// Receives one or more summary files, generates deck content with Claude
// (forced emit_deck tool call), renders each deck to .pptx via the Python
// renderer (backend/deckgen/render.py + real Superba template), and returns
// the .pptx (single summary) or a .zip (multiple summaries).

import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import JSZip from "jszip";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DECK_SCHEMA, SYSTEM_PROMPT, validerDeck, type Deck } from "@/app/lib/deck";

export const runtime = "nodejs";
export const maxDuration = 120;

const DECKGEN = path.join(process.cwd(), "backend", "deckgen");
const RENDER_PY = path.join(DECKGEN, "render.py");
const TEMPLATE = path.join(DECKGEN, "Superba_refresh_power_point_template.pptx");

// Python interpreter: override with PYTHON env var, else the winget user-scope path.
const PYTHON =
  process.env.PYTHON ||
  path.join(
    os.homedir(),
    "AppData", "Local", "Programs", "Python", "Python312", "python.exe"
  );

async function lesFil(fil: File): Promise<string> {
  const buf = Buffer.from(await fil.arrayBuffer());
  if (fil.name.toLowerCase().endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  return buf.toString("utf-8");
}

async function lagDeckInnhold(
  anthropic: Anthropic,
  summary: string,
  retry = true
): Promise<Deck> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "emit_deck",
        description: "Emit the structured slide-deck content.",
        input_schema: DECK_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_deck" },
    messages: [{ role: "user", content: summary }],
  });

  const bruk = msg.content.find((b) => b.type === "tool_use");
  const deck = bruk && "input" in bruk ? bruk.input : null;

  if (validerDeck(deck)) return deck;

  if (retry) {
    // One retry with the validation problem fed back.
    return lagDeckInnhold(
      anthropic,
      summary +
        "\n\n(Previous attempt returned invalid deck structure. Return a valid emit_deck call with a non-empty sections array.)",
      false
    );
  }
  throw new Error("Claude returned an invalid deck structure.");
}

// Run render.py as a subprocess: deck.json -> out.pptx using the real template.
function renderPptx(deckJsonPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [RENDER_PY, deckJsonPath, outPath, TEMPLATE]);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) => reject(new Error(`Could not start Python: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Renderer failed (exit ${code}): ${stderr.slice(0, 500)}`));
    });
  });
}

export async function POST(req: Request) {
  let tmpDir: string | null = null;
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { feil: "Missing ANTHROPIC_API_KEY on the server." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const filer = form.getAll("filer").filter((f): f is File => f instanceof File);
    if (filer.length === 0) {
      return Response.json({ feil: "No files uploaded." }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deckgen-"));

    // One deck per summary.
    const decks: { navn: string; buffer: Buffer }[] = [];
    for (let i = 0; i < filer.length; i++) {
      const tekst = (await lesFil(filer[i])).trim();
      if (!tekst) throw new Error(`No text found in ${filer[i].name}.`);

      const deck = await lagDeckInnhold(anthropic, tekst);

      const deckJson = path.join(tmpDir, `deck-${i}.json`);
      const outPptx = path.join(tmpDir, `deck-${i}.pptx`);
      await fs.writeFile(deckJson, JSON.stringify(deck), "utf-8");
      await renderPptx(deckJson, outPptx);

      const base = filer[i].name.replace(/\.[^.]+$/, "") || `deck-${i + 1}`;
      decks.push({ navn: `${base}.pptx`, buffer: await fs.readFile(outPptx) });
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

    // Multiple summaries -> zip.
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
    return Response.json(
      { feil: "Generation failed: " + (e as Error).message },
      { status: 500 }
    );
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
