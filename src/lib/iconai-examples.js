// Hand-built examples for the icon AI: real constructor documents (24 grid, primitives added / cut in order),
// drawn in the constructor's style — few large soft shapes, cut details, modifiers on top.
export const EXAMPLES = [
  {
    prompt: 'замок',
    name: 'Lock', keys: 'Lock, Locked, Замок, Закрыто',
    shapes: [
      { type: 'circle', x: 7, y: 2, w: 10, h: 12, op: 'add' },
      { type: 'circle', x: 9, y: 4, w: 6, h: 8, op: 'cut' },
      { type: 'squircle', x: 4, y: 9, w: 16, h: 13, r: 5, op: 'add' },
      { type: 'capsule', x: 11, y: 13.5, w: 2, h: 4.5, op: 'cut' },
    ],
  },
  {
    prompt: 'папка',
    name: 'Folder', keys: 'Folder, Directory, Папка',
    shapes: [
      { type: 'squircle', x: 2, y: 4, w: 9.5, h: 6, r: 2.5, op: 'add' },
      { type: 'squircle', x: 2, y: 6.5, w: 20, h: 14.5, r: 5, op: 'add' },
    ],
  },
  {
    prompt: 'календарь',
    name: 'Calendar', keys: 'Calendar, Date, Календарь, Дата',
    shapes: [
      { type: 'squircle', x: 3, y: 4, w: 18, h: 17.5, r: 5.5, op: 'add' },
      { type: 'capsule', x: 3, y: 9, w: 18, h: 2, op: 'cut' },
      { type: 'capsule', x: 7, y: 2, w: 2, h: 5, op: 'add' },
      { type: 'capsule', x: 15, y: 2, w: 2, h: 5, op: 'add' },
    ],
  },
  {
    prompt: 'колокольчик, уведомления выключены',
    name: 'Notification Off', keys: 'Notification Off, Mute, Без уведомлений',
    shapes: [
      { type: 'squircle', x: 5, y: 2.5, w: 14, h: 15.5, r: 7, op: 'add' },
      { type: 'squircle', x: 3, y: 13, w: 18, h: 5, r: 2.5, op: 'add' },
      { type: 'capsule', x: 9.5, y: 20, w: 5, h: 2, op: 'add' },
      { type: 'slash', x: 3, y: 3, w: 18, h: 18, op: 'mod' },
    ],
  },
  {
    prompt: 'дом с плюсом',
    name: 'Home Add', keys: 'Home Add, Add Home, Добавить дом',
    shapes: [
      { type: 'triangle', x: 2, y: 2.5, w: 20, h: 11, r: 2, op: 'add' },
      { type: 'squircle', x: 4.5, y: 9, w: 15, h: 12, r: 4, op: 'add' },
      { type: 'plus', x: 8.5, y: 11, w: 7, h: 7, op: 'mod' },
    ],
  },
];
