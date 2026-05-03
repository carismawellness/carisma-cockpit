export interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  age: number;
  visitsPerYear: number;
  lastContactDays: number;
  upcomingEvent?: string;
  avatarSeed: string;
}

export const familySeed: FamilyMember[] = [
  { id: "f1", name: "Mum", relationship: "Mother", age: 64, visitsPerYear: 4, lastContactDays: 11, upcomingEvent: "Birthday in 32 days", avatarSeed: "mum" },
  { id: "f2", name: "Dad", relationship: "Father", age: 67, visitsPerYear: 4, lastContactDays: 9, upcomingEvent: "Birthday in 14 days", avatarSeed: "dad" },
  { id: "f3", name: "Karl", relationship: "Brother", age: 32, visitsPerYear: 12, lastContactDays: 4, avatarSeed: "karl-bro" },
  { id: "f4", name: "Marie", relationship: "Sister", age: 38, visitsPerYear: 24, lastContactDays: 2, avatarSeed: "marie-sis" },
  { id: "f5", name: "Nanna Pina", relationship: "Maternal grandmother", age: 88, visitsPerYear: 6, lastContactDays: 28, avatarSeed: "nanna-pina" },
  { id: "f6", name: "Uncle Joseph", relationship: "Uncle (paternal)", age: 71, visitsPerYear: 3, lastContactDays: 95, avatarSeed: "uncle-joe" },
  { id: "f7", name: "Aunt Rita", relationship: "Aunt (maternal)", age: 60, visitsPerYear: 4, lastContactDays: 60, avatarSeed: "aunt-rita" },
  { id: "f8", name: "Cousin Andrea", relationship: "Cousin", age: 30, visitsPerYear: 6, lastContactDays: 22, avatarSeed: "cousin-andrea" },
];

export function remainingEncounters(member: FamilyMember, lifeExpectancy = 84): number {
  const yearsLeft = Math.max(0, lifeExpectancy - member.age);
  return yearsLeft * member.visitsPerYear;
}
