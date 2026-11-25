// แปลง KeyboardEvent.code (ตำแหน่งปุ่มจริงบนคีย์บอร์ด) -> ชื่อ Key ของ nut-js
// ใช้ตำแหน่งปุ่ม ทำให้พิมพ์ภาษาไทย/อังกฤษได้ตามเลย์เอาต์ของเครื่องปลายทาง
const map = {
  Escape: 'Escape', Tab: 'Tab', CapsLock: 'CapsLock', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper', ContextMenu: 'Menu',
  Minus: 'Minus', Equal: 'Equal', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backquote: 'Grave',
  PrintScreen: 'Print', ScrollLock: 'ScrollLock', Pause: 'Pause', NumLock: 'NumLock',
  NumpadAdd: 'Add', NumpadSubtract: 'Subtract', NumpadMultiply: 'Multiply', NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal', NumpadEnter: 'Enter',
};
for (let i = 0; i < 26; i++) map['Key' + String.fromCharCode(65 + i)] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) { map['Digit' + i] = 'Num' + i; map['Numpad' + i] = 'NumPad' + i; }
for (let i = 1; i <= 12; i++) map['F' + i] = 'F' + i;

module.exports = map;
