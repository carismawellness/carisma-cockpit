export type GarmentCategory = "Tops" | "Bottoms" | "Outerwear" | "Footwear" | "Accessories" | "Tailoring";
export type Season = "Warm" | "Cool" | "All";

export interface Garment {
  id: string;
  name: string;
  brand: string;
  color: string;
  category: GarmentCategory;
  formality: 1 | 2 | 3 | 4 | 5;
  season: Season;
  costPerWear: number;
  wornInLast90: number;
}

export interface Outfit {
  id: string;
  name: string;
  occasion: string;
  rating: 1 | 2 | 3 | 4 | 5;
  lastWorn: string;
  garmentIds: string[];
}

const brands = ["COS", "Uniqlo", "Drake's", "Loro Piana", "Mango", "Acne", "Massimo Dutti", "Sunspel", "Common Projects", "A.P.C."];
const colors = ["Navy", "White", "Black", "Camel", "Olive", "Stone", "Cream", "Charcoal", "Sand", "Ivory"];
const categories: GarmentCategory[] = ["Tops", "Bottoms", "Outerwear", "Footwear", "Accessories", "Tailoring"];
const seasons: Season[] = ["Warm", "Cool", "All"];

const sampleNames: Record<GarmentCategory, string[]> = {
  Tops: ["Oxford shirt", "Linen shirt", "Crew tee", "Polo", "Knit jumper", "Henley", "Overshirt"],
  Bottoms: ["Chinos", "Linen trousers", "Selvedge denim", "Wool trousers", "Shorts", "Joggers"],
  Outerwear: ["Linen blazer", "Cashmere coat", "Field jacket", "Denim jacket", "Bomber", "Trench"],
  Footwear: ["White sneakers", "Loafers", "Suede chukkas", "Espadrilles", "Derbies", "Boat shoes"],
  Accessories: ["Leather belt", "Watch", "Sunglasses", "Silk scarf", "Tote", "Cap"],
  Tailoring: ["Navy 2-piece suit", "Glen plaid jacket", "Tuxedo", "Charcoal blazer"],
};

export const lookBookSeed = {
  garments: Array.from({ length: 30 }, (_, i) => {
    const cat = categories[i % categories.length];
    const names = sampleNames[cat];
    const name = names[Math.floor(Math.random() * names.length)];
    return {
      id: `g${i + 1}`,
      name,
      brand: brands[i % brands.length],
      color: colors[i % colors.length],
      category: cat,
      formality: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      season: seasons[i % seasons.length],
      costPerWear: +(2 + Math.random() * 18).toFixed(2),
      wornInLast90: Math.floor(Math.random() * 18),
    } as Garment;
  }),
  outfits: [
    { id: "o1", name: "Lisbon dinner", occasion: "Date night", rating: 5, lastWorn: "2026-04-22", garmentIds: ["g1", "g2", "g4", "g11"] },
    { id: "o2", name: "Sunday brunch Sliema", occasion: "Casual", rating: 4, lastWorn: "2026-04-28", garmentIds: ["g3", "g8", "g13"] },
    { id: "o3", name: "Carisma board meeting", occasion: "Business", rating: 4, lastWorn: "2026-04-15", garmentIds: ["g25", "g16", "g26"] },
    { id: "o4", name: "Beach day Gozo", occasion: "Casual warm", rating: 4, lastWorn: "2026-04-19", garmentIds: ["g7", "g14", "g23"] },
    { id: "o5", name: "Wedding guest", occasion: "Formal", rating: 5, lastWorn: "2025-09-12", garmentIds: ["g25", "g26", "g16", "g28"] },
    { id: "o6", name: "Hotel rooftop", occasion: "Smart casual", rating: 4, lastWorn: "2026-04-04", garmentIds: ["g6", "g8", "g11"] },
    { id: "o7", name: "Travel — Milan", occasion: "Business travel", rating: 4, lastWorn: "2026-03-18", garmentIds: ["g4", "g8", "g19"] },
    { id: "o8", name: "Gym → coffee", occasion: "Athleisure", rating: 3, lastWorn: "2026-04-30", garmentIds: ["g3", "g14", "g13"] },
    { id: "o9", name: "Family Sunday lunch", occasion: "Casual", rating: 4, lastWorn: "2026-04-26", garmentIds: ["g6", "g2", "g11"] },
    { id: "o10", name: "Spa launch event", occasion: "Brand", rating: 4, lastWorn: "2026-02-14", garmentIds: ["g1", "g8", "g26"] },
    { id: "o11", name: "Winter Paris", occasion: "Travel", rating: 5, lastWorn: "2025-12-10", garmentIds: ["g6", "g8", "g16", "g11"] },
    { id: "o12", name: "Morning Valletta walk", occasion: "Casual", rating: 3, lastWorn: "2026-04-29", garmentIds: ["g3", "g13", "g4"] },
  ] as Outfit[],
  weather: { tempC: 27, condition: "Sunny / humid", source: "Malta · Sliema" },
};

export function garmentImage(id: string, w = 300, h = 400) {
  return `https://picsum.photos/seed/garment-${id}/${w}/${h}`;
}
