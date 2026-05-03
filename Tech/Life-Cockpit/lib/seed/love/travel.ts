export interface Trip {
  id: string;
  place: string;
  country: string;
  dates: string;
  rating: 1 | 2 | 3 | 4 | 5;
  withWhom: string;
  memory: string;
  imageSeed: string;
}

export interface Wish {
  id: string;
  place: string;
  season: string;
  withWhom: string;
  why: string;
}

export const travelSeed = {
  trips: [
    { id: "t1", place: "Lisbon", country: "Portugal", dates: "2026-04-18 → 22", rating: 5, withWhom: "Sarah", memory: "Tasca da Esquina dinner, Belém sunset run", imageSeed: "lisbon-2026" },
    { id: "t2", place: "Sicily", country: "Italy", dates: "2026-03-08 → 11", rating: 4, withWhom: "Solo", memory: "Etna hike, Palermo street food crawl", imageSeed: "sicily-2026" },
    { id: "t3", place: "Paris", country: "France", dates: "2025-12-08 → 14", rating: 5, withWhom: "Sarah", memory: "Christmas markets, Marais wandering", imageSeed: "paris-2025" },
    { id: "t4", place: "Athens", country: "Greece", dates: "2025-09-22 → 26", rating: 4, withWhom: "Karl", memory: "Acropolis at dawn, ouzo nights", imageSeed: "athens-2025" },
    { id: "t5", place: "Milan", country: "Italy", dates: "2025-07-04 → 06", rating: 3, withWhom: "Business", memory: "Salone trade show, Navigli evening", imageSeed: "milan-2025" },
    { id: "t6", place: "Cyprus", country: "Cyprus", dates: "2025-05-12 → 18", rating: 4, withWhom: "Family", memory: "Paphos coast, halloumi everywhere", imageSeed: "cyprus-2025" },
    { id: "t7", place: "Sardinia", country: "Italy", dates: "2025-08-02 → 10", rating: 5, withWhom: "Sarah + family", memory: "Costa Smeralda swims, La Maddalena boat day", imageSeed: "sardinia-2025" },
    { id: "t8", place: "London", country: "UK", dates: "2025-02-14 → 17", rating: 4, withWhom: "Sarah", memory: "Borough Market, Tate Modern", imageSeed: "london-2025" },
    { id: "t9", place: "Barcelona", country: "Spain", dates: "2024-10-18 → 22", rating: 4, withWhom: "Luca", memory: "Tickets standing-only at Camp Nou", imageSeed: "barcelona-2024" },
    { id: "t10", place: "Istanbul", country: "Türkiye", dates: "2024-06-08 → 13", rating: 5, withWhom: "Solo", memory: "Bosphorus ferry, Hagia Sophia, hammam", imageSeed: "istanbul-2024" },
  ] as Trip[],
  wanderlist: [
    { id: "w1", place: "Kyoto", season: "Autumn (Nov)", withWhom: "Sarah", why: "Cherry colors + temples" },
    { id: "w2", place: "Patagonia", season: "Spring (Nov)", withWhom: "Karl", why: "Torres del Paine W-trek" },
    { id: "w3", place: "Marrakech", season: "Spring", withWhom: "Sarah", why: "Riads + Atlas mountains" },
    { id: "w4", place: "Iceland", season: "Winter", withWhom: "Solo", why: "Aurora + glacier hiking" },
    { id: "w5", place: "Mexico City", season: "Spring", withWhom: "Friends", why: "Food scene + Frida museum" },
    { id: "w6", place: "Singapore + Bali", season: "Summer", withWhom: "Sarah", why: "Combine business + reset" },
    { id: "w7", place: "Buenos Aires", season: "Spring", withWhom: "Solo", why: "Tango, parrilla, weekend in Uruguay" },
    { id: "w8", place: "Cape Town", season: "Summer (Jan)", withWhom: "Karl", why: "Table Mountain + winelands" },
    { id: "w9", place: "Norwegian fjords", season: "Summer", withWhom: "Family", why: "Cruise (parents always wanted)" },
    { id: "w10", place: "Vietnam", season: "Spring", withWhom: "Sarah", why: "Hanoi → Hội An → HCM food trip" },
  ] as Wish[],
};
