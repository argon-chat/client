/**
 * The page under test is the one being looked at. Headless Chromium runs it in an iframe that never
 * has focus, so `document.hasFocus()` is false and lib/decorativeMotion.ts would read the user as
 * away: every sticker, emoji and autoplaying video held still. A test about holding still while
 * away fires `blur` itself (test/lib/decorativeMotion.test.ts).
 */
document.hasFocus = () => true;
