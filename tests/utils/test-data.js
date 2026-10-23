// What the demo library (src/web/seed.js) holds — the tests rely on these, not on DOM details
export const DEMO = {
  folder: 'Типографика',
  model: 'Узел',          // a 3D model in the «3D» collection
  svg: /\.svg|Сердце|Звезда/i,
  aiQuery: 'рука с наушниками',
  aiDescription: 'Рука держит серые наушники на голубом фоне.',
};

// The interface without the start-up effects: no clean screen (its panels show on hover), no animations, no sound
export const QUIET_SETTINGS = { v: 3, clean: false, anim: 'none', sound: 0, facts: false };
