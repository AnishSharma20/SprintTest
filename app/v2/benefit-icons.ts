// Superba brand benefit icons for the V2 sidebars — the red line-art icon set from the
// AKBM deck template (deck-service/assets/icon_*.png, mirrored into public/benefit-icons/).
//
// Categories are user-editable free text (renameable from Manage categories), so icons are
// matched by KEYWORD, first hit wins, and anything unmatched falls back to the whole-body
// icon — a rename can therefore never break the sidebar, at worst it changes the icon.

const KEYWORD_ICONS: [RegExp, string][] = [
  [/heart|cardio|omega/i, "icon_heart"],
  [/joint|knee|arthrit/i, "icon_joint"],
  [/brain|cogniti|mental|memory/i, "icon_cognitive"],
  [/eye|vision|dry eye/i, "icon_eye"],
  [/sport|performance|training|exercise/i, "icon_sports"],
  [/muscle|strength|recovery/i, "icon_muscle"],
  [/skin|derma/i, "icon_skin"],
  [/pms|menstrual|women/i, "icon_pms"],
  [/liver|metaboli/i, "icon_liver"],
  [/absorp|bioavail|uptake/i, "icon_absorption"],
];

const FALLBACK = "icon_whole_body";

/** Public URL of the brand icon that fits a benefit-category name. */
export function benefitIcon(categoryName: string): string {
  const hit = KEYWORD_ICONS.find(([re]) => re.test(categoryName));
  return `/benefit-icons/${(hit?.[1] ?? FALLBACK)}.png`;
}
