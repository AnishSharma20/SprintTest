// The AKBM product/brand list — shared by the Content Generator's product picker and the
// About page's brand picker so the two never drift apart. Only Superba is wired to anything
// today (its own studies, findings, rules, design settings, slide and photo library); the
// other three are shown as real tiles marked "Soon" so the client can see the shape of what's
// coming without us pretending they already work.

export type ProductId = "superba" | "lysoveta" | "revervia" | "pl_plus";

export const PRODUCTS: { id: ProductId; label: string; hint: string; available: boolean }[] = [
  { id: "superba", label: "Superba", hint: "Krill oil", available: true },
  { id: "lysoveta", label: "Lysoveta", hint: "", available: false },
  { id: "revervia", label: "Revervia", hint: "", available: false },
  { id: "pl_plus", label: "PL+", hint: "", available: false },
];
