export interface Contact {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  cadenceDays: number;
  lastContactDays: number;
  context: string;
  avatarSeed: string;
}

const seedContacts: Omit<Contact, "id" | "avatarSeed">[] = [
  { name: "David Cassar", tier: 1, cadenceDays: 14, lastContactDays: 87, context: "Closing his Series A — check in" },
  { name: "Maria Fenech", tier: 1, cadenceDays: 21, lastContactDays: 54, context: "New baby in Feb" },
  { name: "Tom Bartolo", tier: 2, cadenceDays: 30, lastContactDays: 41, context: "Moved to London" },
  { name: "Anna Borg", tier: 2, cadenceDays: 60, lastContactDays: 38, context: "Doctor friend, ApoB convo" },
  { name: "Marco Vella", tier: 1, cadenceDays: 14, lastContactDays: 9, context: "Just back from Sicily" },
  { name: "Sara Mizzi", tier: 1, cadenceDays: 14, lastContactDays: 12, context: "Co-founder catch-up" },
  { name: "James Camilleri", tier: 2, cadenceDays: 30, lastContactDays: 28, context: "Tennis partner" },
  { name: "Claire Spiteri", tier: 2, cadenceDays: 30, lastContactDays: 33, context: "Mentor — quarterly" },
  { name: "Jorge Sanchez", tier: 3, cadenceDays: 90, lastContactDays: 102, context: "Madrid friend" },
  { name: "Liam O'Connell", tier: 2, cadenceDays: 30, lastContactDays: 21, context: "Investor lead" },
  { name: "Yasmin Naser", tier: 2, cadenceDays: 60, lastContactDays: 45, context: "Aesthetics industry" },
  { name: "Pierre Dubois", tier: 3, cadenceDays: 90, lastContactDays: 70, context: "Paris contact" },
  { name: "Isabella Rossi", tier: 2, cadenceDays: 60, lastContactDays: 18, context: "Italian wholesale supplier" },
  { name: "Luca Schembri", tier: 1, cadenceDays: 14, lastContactDays: 6, context: "Best friend since school" },
  { name: "Nina Patel", tier: 2, cadenceDays: 30, lastContactDays: 25, context: "Ex-colleague, AI advisor" },
  { name: "Hans Müller", tier: 3, cadenceDays: 90, lastContactDays: 65, context: "Berlin biotech" },
  { name: "Olivia Grech", tier: 2, cadenceDays: 30, lastContactDays: 14, context: "Yoga teacher friend" },
  { name: "Andre Saliba", tier: 3, cadenceDays: 90, lastContactDays: 52, context: "Property developer contact" },
  { name: "Emma Bianchi", tier: 2, cadenceDays: 60, lastContactDays: 32, context: "Carisma Slimming MD" },
  { name: "Sophie Laurent", tier: 3, cadenceDays: 90, lastContactDays: 110, context: "Geneva contact" },
  { name: "Karl Bonnici", tier: 2, cadenceDays: 30, lastContactDays: 20, context: "Lawyer / advisor" },
  { name: "Elena Caruana", tier: 1, cadenceDays: 14, lastContactDays: 4, context: "Sister-in-law, weekly call" },
  { name: "Mark Brincat", tier: 3, cadenceDays: 90, lastContactDays: 85, context: "Old uni friend" },
  { name: "Gabriella Zammit", tier: 2, cadenceDays: 60, lastContactDays: 55, context: "Designer, Carisma branding" },
  { name: "Tomas Andersen", tier: 3, cadenceDays: 90, lastContactDays: 95, context: "Copenhagen wellness peer" },
];

export const innerCircleSeed: Contact[] = seedContacts.map((c, i) => ({
  ...c,
  id: `c${i + 1}`,
  avatarSeed: c.name.toLowerCase().replace(/\s+/g, "-"),
}));
