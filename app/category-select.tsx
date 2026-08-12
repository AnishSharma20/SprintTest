"use client";

// A category <select> that shows the picked category's brand icon (the same line art icons the
// Scientific Studies sidebar uses) — shared by every "pick a category for this finding" spot:
// add-finding-modal.tsx, add-study-modal.tsx and findings-v2.tsx's New finding modal. A native
// <option> can't carry an image, so the icon sits over the select's own left padding instead,
// swapping as the value changes.

import { benefitIcon } from "./v2/benefit-icons";

export default function CategorySelect({
  value,
  onChange,
  categories,
  placeholder = "Select a category…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  categories: { id: string; name: string }[];
  placeholder?: string;
  className?: string;
}) {
  const selected = categories.find((c) => c.id === value);
  return (
    <div className={`relative ${className}`}>
      {selected && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={benefitIcon(selected.name)}
          alt=""
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
        />
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-[10px] border border-[#E8E8ED] bg-white py-1.5 pr-3 text-[12.5px] outline-none focus:border-[#C7C7CC] ${
          selected ? "pl-8" : "pl-3"
        }`}
      >
        <option value="">{placeholder}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
