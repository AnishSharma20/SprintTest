// VM 2026-side. Henter ekte kampdata fra TheSportsDB (FIFA World Cup, liga-id 4429).
// Dette er en server-komponent: dataene hentes på serveren når siden bygges/oppdateres.

const API = "https://www.thesportsdb.com/api/v1/json/3";
const WORLD_CUP_LEAGUE = "4429";

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

async function hentKamper(endpoint: string): Promise<Kamp[]> {
  const res = await fetch(`${API}/${endpoint}?id=${WORLD_CUP_LEAGUE}`, {
    // Oppdater dataene fra API-et hvert 5. minutt (300 sekunder).
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.events ?? [];
}

function erNorge(navn: string) {
  return navn.toLowerCase() === "norway";
}

function formatTid(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts + "Z"); // API-tid er UTC
  return d.toLocaleString("nb-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function Lag({ navn, badge }: { navn: string; badge: string | null }) {
  return (
    <div className="flex flex-1 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {badge && <img src={badge} alt="" className="h-7 w-7 object-contain" />}
      <span className={erNorge(navn) ? "font-bold text-red-600" : "font-medium"}>
        {navn}
      </span>
    </div>
  );
}

function KampRad({ kamp, ferdig }: { kamp: Kamp; ferdig: boolean }) {
  const norgeMed = erNorge(kamp.strHomeTeam) || erNorge(kamp.strAwayTeam);
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        norgeMed ? "border-red-300 bg-red-50" : "border-zinc-200 bg-white"
      }`}
    >
      <Lag navn={kamp.strHomeTeam} badge={kamp.strHomeTeamBadge} />
      <div className="min-w-[88px] text-center">
        {ferdig ? (
          <span className="text-lg font-bold tabular-nums">
            {kamp.intHomeScore} – {kamp.intAwayScore}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">{formatTid(kamp.strTimestamp)}</span>
        )}
      </div>
      <div className="flex flex-1 flex-row-reverse">
        <Lag navn={kamp.strAwayTeam} badge={kamp.strAwayTeamBadge} />
      </div>
    </li>
  );
}

export default async function Home() {
  const [kommende, resultater] = await Promise.all([
    hentKamper("eventsnextleague.php"),
    hentKamper("eventspastleague.php"),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-zinc-50 px-4 py-10">
      <main className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-emerald-900">
            VM 2026 🏆⚽
          </h1>
          <p className="mt-1 text-zinc-600">USA · Canada · Mexico</p>
          <p className="mt-2 text-sm text-zinc-500">
            Live kampdata, oppdatert automatisk. 🇳🇴 Norge er uthevet.
          </p>
        </header>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold text-zinc-800">Kommende kamper</h2>
          {kommende.length === 0 ? (
            <p className="text-zinc-500">Ingen kommende kamper akkurat nå.</p>
          ) : (
            <ul className="space-y-2">
              {kommende.slice(0, 10).map((k) => (
                <KampRad key={k.idEvent} kamp={k} ferdig={false} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold text-zinc-800">Siste resultater</h2>
          {resultater.length === 0 ? (
            <p className="text-zinc-500">Ingen resultater ennå.</p>
          ) : (
            <ul className="space-y-2">
              {resultater.slice(0, 10).map((k) => (
                <KampRad key={k.idEvent} kamp={k} ferdig={true} />
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-10 text-center text-xs text-zinc-400">
          Data fra TheSportsDB
        </footer>
      </main>
    </div>
  );
}
