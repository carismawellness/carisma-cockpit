export interface Brand {
  slug: string;
  label: string;
  id: number;
}

export const brands: Brand[] = [
  { slug: "spa", label: "Spa", id: 1 },
  { slug: "aesthetics", label: "Aesthetics", id: 2 },
  { slug: "slimming", label: "Slimming", id: 3 },
];
