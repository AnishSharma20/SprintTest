// VM 2026-side. Henter ekte data fra TheSportsDB (FIFA World Cup, liga-id 4429):
//  - lookuptable: tabell med full statistikk per lag
//  - eventsseason: ferdigspilte kamper (resultater)
//  - eventsnextleague: neste kamp
// Server-komponent: dataene hentes på serveren og oppdateres automatisk hvert 5. minutt.

const API = "https://www.thesportsdb.com/api/v1/json/3";
const LEAGUE = "4429";
const SEASON = "2026";

type Rad = {
  intRank: string;
  strTeam: string;
  strBadge: string | null;
  strGroup: string;
  strForm: string | null;
  intPlayed: string;
  intWin: string;
  intDraw: string;
  intLoss: string;
  intGoalsFor: string;
  intGoalsAgainst: string;
  intGoalDifference: string;
  intPoints: string;
};

type Kamp = {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strTimestamp: string | null;
  strHomeTeamBadge: string | null;
  strAwayTeamBadge: string | null;
};

async function hent<T>(path: string, nokkel: string): Promise<T[]> {
  const res = await fetch(`${API}/${path}`, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();
  return data[nokkel] ?? [];
}

const erNorge = (n: string) => n.toLowerCase() === "norway";

// --- Brreg (selskapsdata) ---
type Selskap = {
  navn: string;
  organisasjonsnummer: string;
  organisasjonsform?: { beskrivelse: string };
  naeringskode1?: { beskrivelse: string };
  stiftelsesdato?: string;
  antallAnsatte?: number;
  forretningsadresse?: { poststed: string };
};

async function hentSelskap(orgnr: string): Promise<Selskap | null> {
  const res = await fetch(
    `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
  );
  if (!res.ok) return null;
  return res.json();
}

// --- MET / yr.no (værdata) ---
type Vaer = { temp: number; vind: number; symbol: string } | null;

async function hentVaer(lat: number, lon: number): Promise<Vaer> {
  const res = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
    {
      // MET krever en identifiserende User-Agent
      headers: { "User-Agent": "vm2026-app/1.0 anish.sharma@sprint.no" },
      next: { revalidate: 1800 },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const naa = data.properties.timeseries[0];
  return {
    temp: naa.data.instant.details.air_temperature,
    vind: naa.data.instant.details.wind_speed,
    symbol: naa.data.next_1_hours?.summary?.symbol_code ?? "",
  };
}

function vaerEmoji(symbol: string): string {
  if (symbol.includes("clearsky")) return "☀️";
  if (symbol.includes("fair")) return "🌤️";
  if (symbol.includes("partlycloudy")) return "⛅";
  if (symbol.includes("cloudy")) return "☁️";
  if (symbol.includes("rain")) return "🌧️";
  if (symbol.includes("snow")) return "❄️";
  if (symbol.includes("fog")) return "🌫️";
  if (symbol.includes("thunder")) return "⛈️";
  return "🌡️";
}

function formatTid(ts: string | null) {
  if (!ts) return "";
  return new Date(ts + "Z").toLocaleString("nb-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function FormPiller({ form }: { form: string | null }) {
  if (!form) return <span className="text-zinc-400">–</span>;
  const farge: Record<string, string> = {
    W: "bg-emerald-500",
    D: "bg-zinc-400",
    L: "bg-red-500",
  };
  return (
    <div className="flex justify-center gap-1">
      {form.split("").map((r, i) => (
        <span
          key={i}
          title={r}
          className={`inline-block h-4 w-4 rounded-full text-[10px] font-bold leading-4 text-white ${
            farge[r] ?? "bg-zinc-300"
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

function Badge({ src }: { src: string | null }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src.replace("/tiny", "")} alt="" className="h-6 w-6 object-contain" />;
}

export default async function Home() {
  const [tabell, resultater, neste, selskap, vaer] = await Promise.all([
    hent<Rad>(`lookuptable.php?l=${LEAGUE}&s=${SEASON}`, "table"),
    hent<Kamp>(`eventsseason.php?id=${LEAGUE}&s=${SEASON}`, "events"),
    hent<Kamp>(`eventsnextleague.php?id=${LEAGUE}`, "events"),
    hentSelskap("988497711"), // SPRINT CONSULTING AS
    hentVaer(59.91, 10.75), // Oslo
  ]);

  const ferdige = resultater
    .filter((k) => k.intHomeScore !== null && k.intHomeScore !== "")
    .reverse();

  // Litt aggregert statistikk fra tabellen
  const malTotalt = tabell.reduce((s, r) => s + Number(r.intGoalsFor || 0), 0);
  const kamperSpilt = tabell.reduce((s, r) => s + Number(r.intPlayed || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-zinc-50 px-4 py-10">
      <main className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-emerald-900">
            VM 2026 🏆⚽
          </h1>
          <p className="mt-1 text-zinc-600">USA · Canada · Mexico</p>
        </header>

        {/* Statistikk-stripe */}
        <div className="mb-8 grid grid-cols-3 gap-3 text-center">
          {[
            { tall: tabell.length, tekst: "lag i tabellen" },
            { tall: kamperSpilt, tekst: "kamper spilt" },
            { tall: malTotalt, tekst: "mål scoret" },
          ].map((s) => (
            <div key={s.tekst} className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-3xl font-extrabold text-emerald-700">{s.tall}</div>
              <div className="text-xs text-zinc-500">{s.tekst}</div>
            </div>
          ))}
        </div>

        {/* Tabell med full statistikk */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold text-zinc-800">Tabell</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Lag</th>
                  <th className="px-2 py-2 text-center" title="Gruppe">Grp</th>
                  <th className="px-2 py-2 text-center" title="Spilt">S</th>
                  <th className="px-2 py-2 text-center" title="Vunnet">V</th>
                  <th className="px-2 py-2 text-center" title="Uavgjort">U</th>
                  <th className="px-2 py-2 text-center" title="Tapt">T</th>
                  <th className="px-2 py-2 text-center" title="Mål for">MF</th>
                  <th className="px-2 py-2 text-center" title="Mål mot">MM</th>
                  <th className="px-2 py-2 text-center" title="Målforskjell">+/–</th>
                  <th className="px-2 py-2 text-center font-bold" title="Poeng">P</th>
                  <th className="px-3 py-2 text-center">Form</th>
                </tr>
              </thead>
              <tbody>
                {tabell.map((r) => (
                  <tr
                    key={r.strTeam}
                    className={`border-b border-zinc-100 last:border-0 ${
                      erNorge(r.strTeam) ? "bg-red-50 font-semibold" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-zinc-500">{r.intRank}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge src={r.strBadge} />
                        <span className={erNorge(r.strTeam) ? "text-red-600" : ""}>
                          {r.strTeam}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-xs text-zinc-500">
                      {r.strGroup?.replace("Group ", "")}
                    </td>
                    <td className="px-2 py-2 text-center">{r.intPlayed}</td>
                    <td className="px-2 py-2 text-center">{r.intWin}</td>
                    <td className="px-2 py-2 text-center">{r.intDraw}</td>
                    <td className="px-2 py-2 text-center">{r.intLoss}</td>
                    <td className="px-2 py-2 text-center">{r.intGoalsFor}</td>
                    <td className="px-2 py-2 text-center">{r.intGoalsAgainst}</td>
                    <td className="px-2 py-2 text-center">{r.intGoalDifference}</td>
                    <td className="px-2 py-2 text-center font-bold text-emerald-700">
                      {r.intPoints}
                    </td>
                    <td className="px-3 py-2">
                      <FormPiller form={r.strForm} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            S = spilt, V = vunnet, U = uavgjort, T = tapt, MF/MM = mål for/mot, P = poeng
          </p>
        </section>

        {/* Neste kamp */}
        {neste[0] && (
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-bold text-zinc-800">Neste kamp</h2>
            <div className="flex items-center justify-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-2 font-semibold">
                <Badge src={neste[0].strHomeTeamBadge} />
                {neste[0].strHomeTeam}
              </div>
              <span className="text-sm text-zinc-500">{formatTid(neste[0].strTimestamp)}</span>
              <div className="flex items-center gap-2 font-semibold">
                {neste[0].strAwayTeam}
                <Badge src={neste[0].strAwayTeamBadge} />
              </div>
            </div>
          </section>
        )}

        {/* Resultater */}
        <section>
          <h2 className="mb-3 text-xl font-bold text-zinc-800">Siste resultater</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <th className="px-3 py-2 text-left">Dato</th>
                  <th className="px-3 py-2 text-right">Hjemme</th>
                  <th className="px-3 py-2 text-center">Res.</th>
                  <th className="px-3 py-2 text-left">Borte</th>
                </tr>
              </thead>
              <tbody>
                {ferdige.map((k) => (
                  <tr key={k.idEvent} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {formatTid(k.strTimestamp)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{k.strHomeTeam}</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums">
                      {k.intHomeScore}–{k.intAwayScore}
                    </td>
                    <td className="px-3 py-2 font-medium">{k.strAwayTeam}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* To kort side om side: selskapsdata (Brreg) og vær (yr.no) */}
        <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Brreg */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-500">
              🏢 Selskapsdata (Brreg)
            </h3>
            {selskap ? (
              <div className="space-y-1.5 text-sm">
                <p className="text-lg font-bold text-zinc-900">{selskap.navn}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-600">
                  <dt className="text-zinc-400">Org.nr</dt>
                  <dd className="tabular-nums">{selskap.organisasjonsnummer}</dd>
                  <dt className="text-zinc-400">Form</dt>
                  <dd>{selskap.organisasjonsform?.beskrivelse}</dd>
                  <dt className="text-zinc-400">Bransje</dt>
                  <dd>{selskap.naeringskode1?.beskrivelse}</dd>
                  <dt className="text-zinc-400">Stiftet</dt>
                  <dd>{selskap.stiftelsesdato?.slice(0, 4)}</dd>
                  <dt className="text-zinc-400">Ansatte</dt>
                  <dd>{selskap.antallAnsatte}</dd>
                  <dt className="text-zinc-400">Sted</dt>
                  <dd>{selskap.forretningsadresse?.poststed}</dd>
                </dl>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Fikk ikke hentet selskapsdata.</p>
            )}
          </div>

          {/* Vær */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-500">
              🌤️ Været i Oslo (yr.no)
            </h3>
            {vaer ? (
              <div className="flex flex-col items-center justify-center py-2">
                <div className="text-6xl">{vaerEmoji(vaer.symbol)}</div>
                <div className="mt-2 text-4xl font-extrabold text-zinc-900">
                  {Math.round(vaer.temp)}°C
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  Vind {vaer.vind} m/s
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Fikk ikke hentet værdata.</p>
            )}
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-zinc-400">
          Data fra TheSportsDB, Brønnøysundregistrene og MET/yr.no · oppdateres automatisk
        </footer>
      </main>
    </div>
  );
}
