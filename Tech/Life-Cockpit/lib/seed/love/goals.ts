export const goalsSeed = {
  year: 2026,
  theme: "The Year of Craft",
  themeRationale: "Depth over breadth. Master fewer things — body, business, one hobby, one relationship — instead of dabbling in many.",
  threeForTheYear: [
    { title: "VO2 max ≥ 51 (top 2.5% for age)", progress: 0.92 },
    { title: "Read 24 books — across business, fiction, longevity", progress: 0.42 },
    { title: "Complete a guitar set: 10 songs played start-to-finish", progress: 0.30 },
  ],
  okrs: [
    { id: "ok1", title: "VO2 max", target: "Reach 51 ml/kg/min by Dec 31", progress: 0.92 },
    { id: "ok2", title: "Reading", target: "24 books finished", progress: 0.42 },
    { id: "ok3", title: "Family visits", target: "6 quality visits with parents", progress: 0.66 },
    { id: "ok4", title: "Personal liquidity", target: "Years of Freedom ≥ 4.0", progress: 0.80 },
  ],
  bucketList: {
    total: 67,
    completed: 24,
    completionPct: 36,
    byCategory: [
      { name: "Travel", total: 18, done: 9 },
      { name: "Skills", total: 12, done: 4 },
      { name: "Experiences", total: 17, done: 7 },
      { name: "Milestones", total: 12, done: 3 },
      { name: "Wild cards", total: 8, done: 1 },
    ],
    topNext: [
      "Run a sub-1:40 half marathon",
      "Learn enough Italian for a real dinner conversation",
      "Visit Patagonia with Karl",
      "Publish one long-form essay",
      "Take parents on the Norwegian fjords cruise",
    ],
  },
};
