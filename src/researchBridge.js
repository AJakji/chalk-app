// Lets any component fire a pre-filled message into the Research chat
// without prop drilling through the modal stack.

let _listener = null;

export function sendToResearch(message) {
  _listener?.(message);
}

export function onResearchMessage(fn) {
  _listener = fn;
  return () => { if (_listener === fn) _listener = null; };
}
