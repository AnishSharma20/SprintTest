// API-rute: tar imot en opplastet fil + instruks, ber Claude lage en
// presentasjonsstruktur, og bygger en ekte .pptx-fil som sendes tilbake.
// Kjører i Node (ikke Edge) fordi pptxgenjs og mammoth trenger Node.

import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import PptxGenJS from "pptxgenjs";

export const runtime = "nodejs";

// Aker BioMarine-farger
const NAVY = "002A4E";
const TEAL = "00A9CE";
const LYS = "F4F8FA";

type Slide = { tittel: string; punkter: string[] };
type Presentasjon = { tittel: string; undertittel: string; slides: Slide[] };

// Hent ren tekst ut av den opplastede filen.
async function lesFil(fil: File): Promise<string> {
  const buf = Buffer.from(await fil.arrayBuffer());
  if (fil.name.toLowerCase().endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  // .txt, .md og annet ren tekst
  return buf.toString("utf-8");
}

// Be Claude lage strukturen som JSON.
async function lagStruktur(
  tekst: string,
  instruks: string
): Promise<Presentasjon> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `Du lager en profesjonell presentasjon på norsk basert på innholdet under.

Instruks fra brukeren: ${instruks || "Lag en ryddig presentasjon av innholdet."}

Innhold:
"""
${tekst.slice(0, 12000)}
"""

Svar KUN med gyldig JSON i nøyaktig dette formatet, uten forklaring eller markdown:
{
  "tittel": "Hovedtittel",
  "undertittel": "Kort undertittel",
  "slides": [
    { "tittel": "Lysbildetittel", "punkter": ["Kort punkt", "Kort punkt"] }
  ]
}

Lag mellom 4 og 10 lysbilder. Hold punktene korte og konkrete (maks ~12 ord).`,
      },
    ],
  });

  const tekstSvar = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Fjern eventuelle ```json-gjerder
  const rent = tekstSvar.replace(/```json|```/g, "").trim();
  return JSON.parse(rent);
}

// Bygg .pptx-filen med Aker BioMarine-profil.
function byggPptx(p: Presentasjon): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  // Tittel-lysbilde
  const t = pptx.addSlide();
  t.background = { color: NAVY };
  t.addText(p.tittel, {
    x: 0.6, y: 2.2, w: 12, h: 1.5,
    fontSize: 40, bold: true, color: "FFFFFF",
  });
  t.addText(p.undertittel || "", {
    x: 0.6, y: 3.7, w: 12, h: 0.8,
    fontSize: 20, color: TEAL,
  });

  // Innholds-lysbilder
  for (const s of p.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: LYS };
    // Tittel-stripe
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.1, fill: { color: NAVY } });
    slide.addText(s.tittel, {
      x: 0.6, y: 0.2, w: 12, h: 0.7,
      fontSize: 26, bold: true, color: "FFFFFF",
    });
    slide.addText(
      (s.punkter || []).map((tekst) => ({ text: tekst, options: { bullet: true } })),
      {
        x: 0.8, y: 1.5, w: 11.6, h: 5.5,
        fontSize: 18, color: "1A1A1A", lineSpacingMultiple: 1.3,
      }
    );
  }

  return pptx.write({ outputType: "nodebuffer" }) as Promise<Buffer>;
}

export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { feil: "Mangler API-nøkkel. Legg ANTHROPIC_API_KEY i .env.local." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const fil = form.get("fil") as File | null;
    const instruks = (form.get("instruks") as string) || "";

    if (!fil) {
      return Response.json({ feil: "Ingen fil lastet opp." }, { status: 400 });
    }

    const tekst = await lesFil(fil);
    if (!tekst.trim()) {
      return Response.json(
        { feil: "Fant ingen tekst i filen." },
        { status: 400 }
      );
    }

    const struktur = await lagStruktur(tekst, instruks);
    const pptxBuffer = await byggPptx(struktur);

    return new Response(new Uint8Array(pptxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="presentasjon.pptx"`,
      },
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { feil: "Noe gikk galt under generering: " + (e as Error).message },
      { status: 500 }
    );
  }
}
