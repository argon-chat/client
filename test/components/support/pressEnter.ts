/**
 * Enter in a text field, as a browser does it: happy-dom does not implement implicit submission.
 * The keydown goes first; unless cancelled, the form's default button (its first submit button)
 * is clicked, and a disabled default button means nothing is submitted. Without a submit button
 * the form submits only when it has a single text-like field.
 */
const BLOCKING_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "date", "month", "week", "time", "datetime-local", "number",
]);

export function pressEnter(field: Element): void {
  const keydown = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
  if (!field.dispatchEvent(keydown)) return;
  if (!(field instanceof HTMLInputElement) || !BLOCKING_TYPES.has(field.type)) return;
  const form = field.form;
  if (!form) return;

  const controls = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")]
    .filter((el) => el.form === form);
  const submitter = controls.find((el) =>
    el instanceof HTMLButtonElement ? el.type === "submit" : el.type === "submit" || el.type === "image");
  if (submitter) {
    if (!submitter.disabled) submitter.click();
    return;
  }
  const fields = controls.filter((el) => el instanceof HTMLInputElement && BLOCKING_TYPES.has(el.type));
  if (fields.length === 1) form.requestSubmit();
}
