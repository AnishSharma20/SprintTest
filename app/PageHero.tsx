/**
 * The dark blue page header, shared by every page.
 *
 * It used to be copy pasted three times and had drifted: the widths were max-w-3xl / 4xl / 5xl, the
 * bottom padding 10 or 12, the Findings title was missing sm:text-5xl so it stayed smaller on
 * desktop, and the Generator title was missing leading-tight. Jumping between tabs made the
 * heading move and change size. One component removes that by construction.
 *
 * The inner width matches TopNav's max-w-5xl, so the logo and the page title share a left edge.
 * MIN_HEIGHT keeps the blue block the same size whether the subtitle runs to two lines or three,
 * and whether or not the page has a Reviewer field.
 */
const MIN_HEIGHT = "min-h-[326px]";

export default function PageHero({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  /** The standfirst under the title. */
  children: React.ReactNode;
  /** Optional controls below the text, e.g. the Reviewer field. */
  actions?: React.ReactNode;
}) {
  return (
    <header
      className={`${MIN_HEIGHT} flex flex-col justify-center bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-12 pt-8`}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
          {eyebrow}
        </div>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-[#BFE3EF]">{children}</p>
        {actions ? <div className="mt-5 flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** The Reviewer field, so the two pages that record a reviewer stay identical too. */
export function ReviewerField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <label htmlFor="reviewer" className="text-xs font-semibold text-[#7FD4E6]">
        Reviewer
      </label>
      <input
        id="reviewer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-64 rounded-[4px] border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-[#8FB8D0] outline-none focus:border-[#3FD0C9]"
      />
    </>
  );
}
